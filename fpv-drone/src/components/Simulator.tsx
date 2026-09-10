import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import {
  FIXED_DT,
  FlightPhysics,
  type ControlInput,
  type FlightMode,
  type FlightTelemetry,
} from "../sim/physics";
import { createWorld, type EnvironmentId } from "../sim/world";

export type CameraMode = "fpv" | "chase" | "orbit";
export interface SimulatorSettings {
  mode: FlightMode;
  wind: number;
  fov: number;
  cameraTilt: number;
  rates: number;
  expo: number;
  quality: "high" | "balanced";
  controller: "gamepad" | "radio";
  sound: boolean;
}
export interface LiveTelemetry extends FlightTelemetry {
  throttle: number;
  heading: number;
  pitch: number;
  roll: number;
  x: number;
  z: number;
  fps: number;
  gamepad: string | null;
  gates: number;
  peakSpeed: number;
  peakAltitude: number;
  groundSpeed: number;
}
export interface SimulatorHandle {
  arm: () => boolean;
  disarm: () => void;
  reset: () => void;
  setThrottle: (throttle: number) => void;
  hoverThrottle: () => void;
  setStick: (pitch: number, roll: number, yaw: number) => void;
  telemetry: () => LiveTelemetry | null;
}
interface Props {
  environment: EnvironmentId;
  settings: SimulatorSettings;
  cameraMode: CameraMode;
  paused: boolean;
  controlsEnabled: boolean;
  onTelemetry: (telemetry: LiveTelemetry) => void;
  onCrash: () => void;
  onPause: () => void;
  onPreview: (image: string) => void;
  onError: (message: string) => void;
}

export const Simulator = forwardRef<SimulatorHandle, Props>(
  function Simulator(props, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const physics = useRef(new FlightPhysics());
    const throttle = useRef(0);
    const radioReady = useRef(false);
    const touchStick = useRef({ pitch: 0, roll: 0, yaw: 0 });
    const live = useRef<LiveTelemetry | null>(null);
    const keys = useRef(new Set<string>());
    const peaks = useRef({ speed: 0, altitude: 0, gates: 0 });
    const audio = useRef<{
      context: AudioContext;
      gain: GainNode;
      oscillator: OscillatorNode;
    } | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    function enableAudio() {
      if (!latest.current.settings.sound) return;
      if (!audio.current) {
        const context = new AudioContext();
        const gain = context.createGain();
        const oscillator = context.createOscillator();
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1000;
        oscillator.type = "sawtooth";
        oscillator.frequency.value = 140;
        gain.gain.value = 0;
        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        audio.current = { context, gain, oscillator };
      }
      void audio.current.context.resume();
    }

    useImperativeHandle(ref, () => ({
      arm: () => {
        throttle.current = 0;
        radioReady.current = false;
        keys.current.clear();
        peaks.current.speed = 0;
        peaks.current.altitude = physics.current.position.y;
        enableAudio();
        return physics.current.arm();
      },
      disarm: () => {
        throttle.current = 0;
        radioReady.current = false;
        physics.current.disarm();
        if (audio.current) audio.current.gain.gain.value = 0;
        keys.current.clear();
      },
      reset: () => {
        physics.current.reset();
        if (audio.current) audio.current.gain.gain.value = 0;
        radioReady.current = false;
        throttle.current = 0;
        keys.current.clear();
        peaks.current = { speed: 0, altitude: 0, gates: 0 };
      },
      setThrottle: (value) => {
        throttle.current = THREE.MathUtils.clamp(value, 0, 1);
      },
      hoverThrottle: () => {
        const c = physics.current.config;
        throttle.current = (c.mass * c.gravity) / (4 * c.maxThrustPerMotor);
      },
      setStick: (pitch, roll, yaw) => {
        touchStick.current = { pitch, roll, yaw };
      },
      telemetry: () =>
        live.current
          ? {
              ...live.current,
              ...physics.current.telemetry,
              throttle: throttle.current,
              peakSpeed: peaks.current.speed,
              peakAltitude: peaks.current.altitude,
              gates: peaks.current.gates,
              x: physics.current.position.x,
              z: physics.current.position.z,
            }
          : null,
    }));

    useEffect(() => {
      const clear = () => {
        keys.current.clear();
        touchStick.current = { pitch: 0, roll: 0, yaw: 0 };
        if (physics.current.armed) latest.current.onPause();
      };
      const onVisibility = () => {
        if (document.hidden) clear();
      };
      const down = (e: KeyboardEvent) => {
        if (
          !latest.current.controlsEnabled ||
          latest.current.paused ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLSelectElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
        if (
          [
            "KeyW",
            "KeyS",
            "KeyA",
            "KeyD",
            "KeyQ",
            "KeyE",
            "ArrowUp",
            "ArrowDown",
            "KeyH",
          ].includes(e.code)
        ) {
          e.preventDefault();
          keys.current.add(e.code);
          if (e.code === "KeyH" && physics.current.armed) {
            const c = physics.current.config;
            throttle.current = (c.mass * c.gravity) / (4 * c.maxThrustPerMotor);
          }
        }
      };
      const up = (e: KeyboardEvent) => keys.current.delete(e.code);
      window.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
      window.addEventListener("blur", clear);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("keydown", down);
        window.removeEventListener("keyup", up);
        window.removeEventListener("blur", clear);
        document.removeEventListener("visibilitychange", onVisibility);
        if (audio.current) {
          void audio.current.context.close();
          audio.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (props.paused || !props.controlsEnabled) {
        keys.current.clear();
        touchStick.current = { pitch: 0, roll: 0, yaw: 0 };
      }
    }, [props.paused, props.controlsEnabled]);
    useEffect(() => {
      if (props.settings.sound) enableAudio();
    }, [props.settings.sound]);

    useEffect(() => {
      const mount = mountRef.current!;
      setLoading(true);
      setError("");
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
        });
      } catch {
        const message =
          "WebGL is unavailable. Enable hardware acceleration in your browser to enter the flight deck.";
        setError(message);
        setLoading(false);
        latest.current.onError(message);
        return;
      }
      renderer.setPixelRatio(
        Math.min(
          window.devicePixelRatio,
          props.settings.quality === "high" ? 1.75 : 1.25,
        ),
      );
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.91;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive three-dimensional FPV training environment",
      );
      renderer.domElement.setAttribute("role", "img");
      mount.appendChild(renderer.domElement);
      const world = createWorld(props.environment, props.settings.quality);
      physics.current.reset();
      physics.current.setObstacles(world.obstacles);
      throttle.current = 0;
      peaks.current = { speed: 0, altitude: 0, gates: 0 };
      const camera = new THREE.PerspectiveCamera(58, 1, 0.04, 6000);
      camera.position.set(48, 23, 61);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.target.set(-3, 3, -18);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.06;
      orbit.minDistance = 3;
      orbit.maxDistance = 180;
      orbit.maxPolarAngle = Math.PI / 2 - 0.025;
      orbit.enablePan = true;
      orbit.update();
      const resize = () => {
        const { width, height } = mount.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(mount);
      resize();
      const clock = new THREE.Clock();
      const cameraTilt = new THREE.Quaternion();
      const chaseOffset = new THREE.Vector3();
      const forward = new THREE.Vector3();
      const euler = new THREE.Euler(0, 0, 0, "YXZ");
      const previous = new THREE.Vector3();
      let accumulator = 0,
        telemetryTimer = 0,
        frame = 0,
        fpsTimer = 0,
        fpsFrames = 0,
        fps = 60;
      let lastCamera: CameraMode = "orbit";
      let lastCrashed = false;
      let animation = 0;
      let stopped = false;
      let previousGamepad: string | null = null;
      let previousController = latest.current.settings.controller;

      const animate = () => {
        if (stopped) return;
        animation = requestAnimationFrame(animate);
        const realElapsed = clock.getDelta();
        const elapsed = Math.min(realElapsed, 0.05);
        const { settings, paused, cameraMode, controlsEnabled } =
          latest.current;
        const p = physics.current;
        p.mode = settings.mode;
        p.wind.set(settings.wind * 0.85, 0, settings.wind * 0.526);
        p.config.maxRate = (settings.rates * Math.PI) / 180;
        p.config.maxYawRate = (settings.rates * 0.65 * Math.PI) / 180;
        let pad: Gamepad | null = null;
        try {
          if (typeof navigator.getGamepads === "function")
            pad =
              Array.from(navigator.getGamepads()).find((g) => g?.connected) ??
              null;
        } catch {
          /* Embedded pages may be denied Gamepad API permission. Keyboard remains usable. */
        }
        const padKey = pad ? `${pad.index}:${pad.id}` : null;
        const controllerLost =
          previousGamepad !== null && padKey !== previousGamepad && p.armed;
        if (
          padKey !== previousGamepad ||
          settings.controller !== previousController
        ) {
          radioReady.current = false;
          if (
            settings.controller === "radio" ||
            settings.controller !== previousController
          )
            throttle.current = 0;
          previousGamepad = padKey;
          previousController = settings.controller;
        }
        if (controllerLost) {
          keys.current.clear();
          touchStick.current = { pitch: 0, roll: 0, yaw: 0 };
          latest.current.onPause();
        }
        const frozen = paused || controllerLost;
        const input: ControlInput = {
          throttle: throttle.current,
          pitch: 0,
          roll: 0,
          yaw: 0,
        };
        if (!frozen && controlsEnabled && p.armed) {
          const k = keys.current;
          throttle.current = THREE.MathUtils.clamp(
            throttle.current +
              ((k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0)) *
                elapsed *
                0.24,
            0,
            1,
          );
          const amount = settings.mode === "angle" ? 0.75 : 0.45;
          input.pitch =
            ((k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0)) * amount;
          input.roll =
            ((k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0)) * amount;
          input.yaw = ((k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0)) * 0.5;
          input.pitch += touchStick.current.pitch;
          input.roll += touchStick.current.roll;
          input.yaw += touchStick.current.yaw;
          if (pad) {
            const deadzone = (value: number) =>
              Math.abs(value) < 0.06
                ? 0
                : (Math.sign(value) * (Math.abs(value) - 0.06)) / 0.94;
            if (settings.controller === "gamepad") {
              input.yaw += deadzone(pad.axes[0] ?? 0);
              input.roll += deadzone(pad.axes[2] ?? 0);
              input.pitch -= deadzone(pad.axes[3] ?? 0);
              throttle.current = THREE.MathUtils.clamp(
                throttle.current +
                  ((pad.buttons[7]?.value ?? 0) -
                    (pad.buttons[6]?.value ?? 0)) *
                    elapsed *
                    0.35,
                0,
                1,
              );
            } else {
              input.roll += deadzone(pad.axes[0] ?? 0);
              input.pitch -= deadzone(pad.axes[1] ?? 0);
              input.yaw += deadzone(pad.axes[3] ?? 0);
              // A radio must be brought to its low-throttle endpoint before it can command thrust.
              const rawThrottle = THREE.MathUtils.clamp(
                (1 - (pad.axes[2] ?? 1)) / 2,
                0,
                1,
              );
              if (radioReady.current || rawThrottle < 0.05) {
                radioReady.current = true;
                throttle.current = rawThrottle;
              }
            }
          }
          input.throttle = throttle.current;
          for (const axis of ["pitch", "roll", "yaw"] as const) {
            const v = THREE.MathUtils.clamp(input[axis], -1, 1);
            input[axis] = v * (1 - settings.expo) + v * v * v * settings.expo;
          }
        } else if (!p.armed) {
          radioReady.current = false;
          throttle.current = 0;
          input.throttle = 0;
        }

        if (!frozen) {
          accumulator += elapsed;
          while (accumulator >= FIXED_DT) {
            previous.copy(p.position);
            p.step(input, FIXED_DT);
            accumulator -= FIXED_DT;
            const gate = world.gates[peaks.current.gates % world.gates.length];
            if (
              p.armed &&
              gate &&
              (previous.z - gate.z) * (p.position.z - gate.z) < 0 &&
              Math.abs(p.position.x - gate.x) < 2.3 &&
              p.position.y > 0.2 &&
              p.position.y < gate.y * 2 - 0.18
            )
              peaks.current.gates++;
          }
        } else accumulator = 0;
        if (p.crashed && !lastCrashed) latest.current.onCrash();
        lastCrashed = p.crashed;
        peaks.current.speed = Math.max(
          peaks.current.speed,
          p.velocity.length(),
        );
        peaks.current.altitude = Math.max(peaks.current.altitude, p.position.y);
        world.drone.position.copy(p.position);
        world.drone.quaternion.copy(p.orientation);
        world.drone.visible = cameraMode !== "fpv";
        if (!frozen)
          world.propellers.forEach((prop, i) => {
            prop.rotation.y += elapsed * p.motors[i] * 500;
          });

        orbit.enabled = cameraMode === "orbit";
        if (cameraMode !== lastCamera) {
          if (cameraMode === "orbit") {
            camera.position.copy(p.position).add(new THREE.Vector3(25, 16, 30));
            orbit.target.copy(p.position);
          }
          lastCamera = cameraMode;
        }
        if (cameraMode === "fpv") {
          camera.position
            .copy(p.position)
            .add(
              new THREE.Vector3(0, 0.045, -0.07).applyQuaternion(p.orientation),
            );
          cameraTilt.setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            (settings.cameraTilt * Math.PI) / 180,
          );
          camera.quaternion.copy(p.orientation).multiply(cameraTilt);
        } else if (cameraMode === "chase") {
          chaseOffset.set(0, 2.4, 6).applyQuaternion(p.orientation);
          chaseOffset.y = Math.max(chaseOffset.y, 1.5);
          camera.position.lerp(
            chaseOffset.add(p.position),
            1 - Math.exp(-elapsed * 6),
          );
          camera.position.y = Math.max(0.4, camera.position.y);
          camera.lookAt(p.position);
        } else orbit.update();
        const fov = cameraMode === "fpv" ? settings.fov : 58;
        if (camera.fov !== fov) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        renderer.render(world.scene, camera);
        if (frame++ === 2) {
          setLoading(false);
          latest.current.onPreview(
            renderer.domElement.toDataURL("image/jpeg", 0.6),
          );
        }

        if (audio.current) {
          const { context, gain, oscillator } = audio.current;
          const motor = p.motors.reduce((a, b) => a + b, 0) / 4;
          gain.gain.setTargetAtTime(
            settings.sound && p.armed && !frozen ? 0.018 + motor * 0.025 : 0,
            context.currentTime,
            0.08,
          );
          oscillator.frequency.setTargetAtTime(
            95 + Math.sqrt(motor) * 310,
            context.currentTime,
            0.06,
          );
        }
        fpsTimer += realElapsed;
        fpsFrames++;
        if (fpsTimer > 0.5) {
          fps = Math.round(fpsFrames / fpsTimer);
          fpsFrames = 0;
          fpsTimer = 0;
        }
        telemetryTimer += elapsed;
        if (telemetryTimer > 0.09) {
          telemetryTimer = 0;
          forward.set(0, 0, -1).applyQuaternion(p.orientation);
          euler.setFromQuaternion(p.orientation);
          live.current = {
            ...p.telemetry,
            throttle: throttle.current,
            heading:
              ((Math.atan2(forward.x, -forward.z) * 180) / Math.PI + 360) % 360,
            pitch: (euler.x * 180) / Math.PI,
            roll: (euler.z * 180) / Math.PI,
            x: p.position.x,
            z: p.position.z,
            fps,
            gamepad: pad?.id ?? null,
            gates: peaks.current.gates,
            peakSpeed: peaks.current.speed,
            peakAltitude: peaks.current.altitude,
            groundSpeed: Math.hypot(p.velocity.x, p.velocity.z),
          };
          latest.current.onTelemetry(live.current);
        }
      };
      animate();
      const contextLost = (event: Event) => {
        event.preventDefault();
        stopped = true;
        cancelAnimationFrame(animation);
        physics.current.disarm();
        if (audio.current) audio.current.gain.gain.value = 0;
        const message =
          "The graphics context was interrupted. Reload the page to restore the flight deck.";
        latest.current.onPause();
        latest.current.onError(message);
        setError(message);
      };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      return () => {
        stopped = true;
        cancelAnimationFrame(animation);
        observer.disconnect();
        orbit.dispose();
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          contextLost,
        );
        world.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }, [props.environment, props.settings.quality]);

    return (
      <>
        <div className="scene-canvas" ref={mountRef} />
        {loading && !error && (
          <div className="scene-loading">
            <LoaderCircle className="spin" size={25} />
            <span>Preparing the flight deck</span>
            <small>Building your practice environment</small>
          </div>
        )}
        {error && (
          <div className="scene-error">
            <AlertTriangle size={30} />
            <h3>Flight deck unavailable</h3>
            <p>{error}</p>
            <button onClick={() => window.location.reload()}>
              Reload simulator
            </button>
          </div>
        )}
      </>
    );
  },
);
