import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Flag,
  Gamepad2,
  Settings2,
  Signal,
  Trophy,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import {
  NEUTRAL,
  type CarState,
  type Controls,
  type InputCommand,
  type RoomView,
  type Snapshot,
} from "../shared/protocol";
import { TRACKS } from "../shared/tracks";
import { rankCars } from "../shared/simulation";
import { Prediction, SnapshotBuffer } from "./netcode";
import { connection, type ConnectionState } from "./connection";
import { RacingWorld } from "./world";
import { RaceAudio } from "./audio";
import type { Settings } from "./settings";

export function formatTime(ticks: number | null | undefined) {
  if (ticks == null || ticks < 0) return "--:--.---";
  const ms = Math.floor((ticks / 60) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function CircuitMap({
  trackId,
  cars = [],
  id = "",
  className = "",
}: {
  trackId: RoomView["settings"]["track"];
  cars?: CarState[];
  id?: string;
  className?: string;
}) {
  const track = TRACKS[trackId];
  const xs = track.points.map((p) => p.x);
  const zs = track.points.map((p) => p.z);
  const minX = Math.min(...xs) - 20;
  const minZ = Math.min(...zs) - 20;
  const width = Math.max(...xs) - minX + 20;
  const height = Math.max(...zs) - minZ + 20;
  const path =
    track.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.z}`).join(" ") + "Z";
  return (
    <svg
      className={`circuit-map ${className}`}
      viewBox={`${minX} ${minZ} ${width} ${height}`}
      role="img"
      aria-label={`${track.name} circuit map`}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        opacity="0.12"
      />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {track.checkpoints.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.z}
          r={i === 0 ? 7 : 3}
          fill={i === 0 ? "#c9f35f" : "currentColor"}
        />
      ))}
      {cars
        .filter((c) => c.id !== id)
        .map((c) => (
          <circle
            key={c.id}
            cx={c.x}
            cy={c.z}
            r="7"
            fill="#7cceff"
            stroke="#152026"
            strokeWidth="3"
          />
        ))}
      {cars
        .filter((c) => c.id === id)
        .map((c) => (
          <g
            key={c.id}
            transform={`translate(${c.x},${c.z}) rotate(${(-c.yaw * 180) / Math.PI})`}
          >
            <circle r="12" fill="#c9f35f" opacity="0.2" />
            <path
              d="M0 10 L-7 -7 L0 -3 L7 -7 Z"
              fill="#c9f35f"
              stroke="#152026"
              strokeWidth="2"
            />
          </g>
        ))}
    </svg>
  );
}

export function Race({
  state,
  settings,
  onSettings,
  updateSettings,
}: {
  state: ConnectionState;
  settings: Settings;
  onSettings: () => void;
  updateSettings: (settings: Settings) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const current = useRef({ state, settings });
  current.current = { state, settings };
  const touch = useRef({ ...NEUTRAL });
  const [renderError, setRenderError] = useState("");
  const [gamepad, setGamepad] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const [feedback, setFeedback] = useState("");
  const lastGate = useRef<{
    checkpoint: number;
    lap: number;
    resets: number;
  } | null>(null);
  const room = state.room!;
  const track = TRACKS[room.settings.track];
  const snapshot = state.snapshot;
  const self = room.players.find((player) => player.id === state.id);
  const car = snapshot?.cars.find((car) => car.id === state.id);
  const ranked = rankCars(snapshot?.cars || []);
  const position = Math.max(
    1,
    ranked.findIndex((car) => car.id === state.id) + 1,
  );
  const countdown = snapshot
    ? Math.ceil((snapshot.startTick - snapshot.tick) / 60)
    : 3;
  const finished = room.state === "finished";
  useEffect(() => {
    if (!car) return;
    const previous = lastGate.current;
    lastGate.current = {
      checkpoint: car.checkpoint,
      lap: car.lap,
      resets: car.resets,
    };
    if (!previous) return;
    const message =
      car.resets !== previous.resets
        ? "+3.0S / RESET PENALTY"
        : car.lap !== previous.lap && car.finishTick === null
          ? `LAP ${car.lap} / KEEP PUSHING`
          : car.checkpoint !== previous.checkpoint && car.finishTick === null
            ? "CHECKPOINT CLEARED"
            : "";
    if (!message) return;
    setFeedback(message);
    const timer = setTimeout(() => setFeedback(""), 1600);
    return () => clearTimeout(timer);
  }, [car?.checkpoint, car?.lap, car?.resets]);
  const cycleCamera = () =>
    updateSettings({
      ...settings,
      camera:
        settings.camera === "chase"
          ? "hood"
          : settings.camera === "hood"
            ? "aerial"
            : "chase",
    });
  useEffect(() => {
    if (!mount.current) return;
    let world: RacingWorld;
    try {
      world = new RacingWorld(mount.current, room.settings.track);
    } catch {
      setRenderError(
        "WebGL is unavailable. Enable hardware acceleration in your browser, then reload.",
      );
      return;
    }
    const prediction = new Prediction();
    const buffer = new SnapshotBuffer();
    const audio = new RaceAudio();
    let raceKey = "";
    let outgoing: InputCommand[] = [];
    let accumulator = 0;
    let sendAccumulator = 0;
    let last = performance.now();
    let frame = 0;
    let lastCheckpoint = -1;
    let lastCollision = 0;
    let lastFinish: number | null = null;
    let lastCountdown = 4;
    let receivedAt = performance.now();
    let padConnected = false;
    const keys = new Set<string>();
    const receive = (snapshot: Snapshot) => {
      const local = snapshot.cars.find(
        (c) => c.id === current.current.state.id,
      );
      const key = `${snapshot.code}:${snapshot.startTick}`;
      if (raceKey !== key || performance.now() - receivedAt > 1000) {
        raceKey = key;
        buffer.clear();
        prediction.reset(
          local || null,
          snapshot.ack[current.current.state.id] ?? -1,
        );
        outgoing = [];
        accumulator = 0;
      }
      receivedAt = performance.now();
      buffer.push(snapshot, performance.now());
      if (local)
        prediction.reconcile(
          local,
          snapshot.ack[local.id] ?? -1,
          TRACKS[room.settings.track],
          snapshot.state === "racing",
        );
    };
    connection.onSnapshot = receive;
    if (connection.state.snapshot) receive(connection.state.snapshot);
    const unlock = () => audio.unlock();
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.matches(
          "input, select, textarea, button",
        ) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (
        Object.values(current.current.settings.bindings).includes(event.code) ||
        event.code.startsWith("Arrow")
      )
        event.preventDefault();
      keys.add(event.code);
      unlock();
      if (event.code === "KeyC" && !event.repeat) {
        const prefs = current.current.settings;
        updateSettings({
          ...prefs,
          camera:
            prefs.camera === "chase"
              ? "hood"
              : prefs.camera === "hood"
                ? "aerial"
                : "chase",
        });
      }
      if (event.code === "Escape" && !event.repeat) {
        keys.clear();
        onSettings();
      }
    };
    const keyup = (event: KeyboardEvent) => keys.delete(event.code);
    const blur = () => {
      keys.clear();
      touch.current = { ...NEUTRAL };
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    window.addEventListener("pointerdown", unlock);
    const controls = (): Controls => {
      if (document.hidden || document.querySelector('[role="dialog"]'))
        return { ...NEUTRAL };
      const b = current.current.settings.bindings;
      const pressed = (key: keyof Settings["bindings"], fallback?: string) =>
        keys.has(b[key]) || !!(fallback && keys.has(fallback));
      const input: Controls = {
        throttle:
          Number(pressed("accelerate", "ArrowUp")) -
            Number(pressed("reverse", "ArrowDown")) || touch.current.throttle,
        steer:
          Number(pressed("right", "ArrowRight")) -
            Number(pressed("left", "ArrowLeft")) || touch.current.steer,
        brake: pressed("brake") || touch.current.brake,
        drift: pressed("drift") || touch.current.drift,
        reset: pressed("reset"),
      };
      keys.delete(b.reset);
      const pad = navigator
        .getGamepads?.()
        .find((pad) => pad?.connected && pad.mapping === "standard");
      if (!!pad !== padConnected) {
        padConnected = !!pad;
        setGamepad(padConnected);
      }
      if (pad) {
        input.steer = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : input.steer;
        input.throttle =
          (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0) ||
          input.throttle;
        input.brake ||= pad.buttons[0]?.pressed || false;
        input.drift ||= pad.buttons[1]?.pressed || false;
        input.reset ||= pad.buttons[2]?.pressed || false;
      }
      return input;
    };
    const loop = (now: number) => {
      const elapsed = (now - last) / 1000;
      const dt = Math.min(elapsed, 0.067);
      last = now;
      const { state, settings } = current.current;
      const active = state.room?.state === "racing";
      const driving =
        !!prediction.car &&
        !self?.spectator &&
        now - receivedAt < 1000 &&
        ["countdown", "racing"].includes(state.room?.state || "") &&
        ["online", "degraded"].includes(state.status);
      if (elapsed > 0.25) {
        outgoing = [];
        accumulator = 0;
      }
      const input = controls();
      if (driving) {
        accumulator += dt;
        while (accumulator >= 1 / 60) {
          outgoing.push(prediction.predict(input, track, now, active));
          input.reset = false;
          accumulator -= 1 / 60;
        }
        sendAccumulator += dt;
        if (sendAccumulator >= 1 / 30 && outgoing.length) {
          const commands = outgoing.splice(0, 6);
          connection.send({ type: "input", commands });
          sendAccumulator = 0;
        }
      }
      const cars = buffer.sample(now);
      const local = prediction.render(dt);
      if (local) {
        const index = cars.findIndex((car) => car.id === local.id);
        if (index >= 0) cars[index] = local;
        audio.update(
          local.speed,
          active ? input.throttle : 0,
          local.drift,
          state.room?.state === "finished" ? 0 : settings.volume,
        );
        if (lastCheckpoint !== -1 && local.checkpoint !== lastCheckpoint)
          audio.tone("checkpoint");
        lastCheckpoint = local.checkpoint;
        if (local.collision > 0.5 && lastCollision <= 0.5) audio.tone("impact");
        lastCollision = local.collision;
        if (local.finishTick !== null && lastFinish === null)
          audio.tone("finish");
        lastFinish = local.finishTick;
      }
      const count = Math.ceil(
        ((buffer.latest?.startTick || 0) - (buffer.latest?.tick || 0)) / 60,
      );
      if (count >= 0 && count < lastCountdown) audio.tone("countdown");
      lastCountdown = count;
      world.update(
        cars,
        state.room?.players || [],
        state.id,
        dt,
        settings.camera,
        settings.reducedMotion,
      );
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      connection.onSnapshot = null;
      cancelAnimationFrame(frame);
      world.dispose();
      audio.close();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointerdown", unlock);
    };
    // Scene and simulation lifetime follows the circuit; UI/preferences are read through a ref.
  }, [room.code, room.settings.track]);
  return (
    <div
      className={`race-screen ${car?.collision && car.collision > 0.4 && !settings.reducedMotion ? "impact" : ""}`}
      data-player-id={state.id}
      data-race-state={room.state}
      data-start-tick={room.startTick}
    >
      <div className="race-canvas" ref={mount} />
      {renderError && <div className="render-error">{renderError}</div>}
      <div className="race-top">
        <button
          className="icon-button glass"
          aria-label="Leave race"
          onClick={() => {
            if (confirm("Leave this race? Your result will be marked DNF."))
              connection.send({ type: "leave" });
          }}
        >
          <ArrowLeft size={19} />
        </button>
        <div className="race-brand">
          APEX<span>LIVE RACING</span>
        </div>
        <div className="race-track">
          <Flag size={16} />
          <div>
            {track.name}
            <small>
              {room.name} <span> / </span> {room.code}
            </small>
          </div>
        </div>
        <div
          className={`race-network ${state.status !== "online" ? "warning" : ""}`}
        >
          <Signal size={15} />
          {state.latency} <small>ms</small>
        </div>
        <button
          className="icon-button glass"
          onClick={cycleCamera}
          aria-label={`Camera: ${settings.camera}. Switch camera`}
        >
          <Camera size={18} />
        </button>
        <button
          className="icon-button glass"
          onClick={() =>
            updateSettings({ ...settings, volume: settings.volume ? 0 : 0.35 })
          }
          aria-label={settings.volume ? "Mute sound" : "Enable sound"}
        >
          {settings.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button
          className="icon-button glass"
          aria-label="Race settings"
          onClick={onSettings}
        >
          <Settings2 size={18} />
        </button>
      </div>
      <div className="race-leaderboard glass">
        <div className="eyebrow">
          LIVE POSITIONS <span className="live-dot" />
        </div>
        {ranked.map((racer, index) => {
          const player = room.players.find((p) => p.id === racer.id);
          return (
            <div key={racer.id} className={racer.id === state.id ? "you" : ""}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <i
                style={{
                  background: racer.id === state.id ? "#c9f35f" : player?.color,
                }}
              />
              <span>
                {player?.name || "Disconnected"}
                {racer.id === state.id ? " (you)" : player?.bot ? " [BOT]" : ""}
              </span>
              <small>
                {racer.finishTick ? (
                  <Flag size={12} />
                ) : index === 0 ? (
                  "LEADER"
                ) : (
                  `+${Math.max(0, (ranked[0].progress - racer.progress) * track.length).toFixed(0)} m`
                )}
              </small>
            </div>
          );
        })}
      </div>
      <div className="lap-panel glass">
        <span className="eyebrow">
          {self?.spectator ? "SPECTATING" : "LAP"}
        </span>
        <strong>
          {Math.min(car?.lap || 1, room.settings.laps)}
          <em> / {room.settings.laps}</em>
        </strong>
        <div>
          <span>RACE TIME</span>
          <b>
            {formatTime(
              snapshot
                ? Math.max(
                    0,
                    (car?.finishTick ?? snapshot.tick) - snapshot.startTick,
                  )
                : 0,
            )}
          </b>
        </div>
        <div>
          <span>BEST LAP</span>
          <b>{formatTime(car?.bestLapTicks)}</b>
        </div>
        <div>
          <span>LAST LAP</span>
          <b>{formatTime(car?.lastLapTicks)}</b>
        </div>
        {car?.lastLapTicks != null && car.bestLapTicks != null && (
          <div>
            <span>VS BEST</span>
            <b>+{((car.lastLapTicks - car.bestLapTicks) / 60).toFixed(3)}s</b>
          </div>
        )}
        {car?.penaltyTicks ? (
          <div className="warning">
            <span>PENALTY</span>
            <b>+{car.penaltyTicks / 60}s</b>
          </div>
        ) : null}
      </div>
      {room.state === "countdown" && (
        <div className="countdown" role="status">
          <span>GET READY</span>
          <strong key={countdown}>{Math.max(1, countdown)}</strong>
          <small>THE GRID IS YOURS.</small>
        </div>
      )}
      {room.state === "racing" &&
        snapshot &&
        snapshot.tick - snapshot.startTick < 50 && (
          <div className="countdown go">
            <strong>GO.</strong>
          </div>
        )}
      {car?.offTrack && (
        <div className="race-alert">
          ROAD EDGE <span>Ease off and rejoin your line</span>
        </div>
      )}
      {feedback && !car?.offTrack && (
        <div className="checkpoint-feedback" role="status">
          <Flag size={15} />
          {feedback}
        </div>
      )}
      {car?.drift && !car.offTrack && (
        <div className="drift-indicator">
          DRIFT <span>HOLD YOUR LINE</span>
        </div>
      )}
      {!["online", "connecting"].includes(state.status) && (
        <div className="connection-banner" role="status">
          <WifiOff size={18} />
          <div>
            {state.status === "degraded"
              ? "Connection degraded"
              : "Reconnecting to the race..."}
            <small>
              {state.status === "degraded"
                ? "Remote cars freeze safely during long network stalls."
                : "Your place is reserved for 30 seconds. Controls resume after recovery."}
            </small>
          </div>
        </div>
      )}
      {car?.finishTick !== null &&
        car?.finishTick !== undefined &&
        !finished && (
          <div className="finish-banner">
            <Flag />
            <strong>FINISH LINE. CROSSED.</strong>
            <span>Waiting for the rest of the grid...</span>
          </div>
        )}
      <div className="race-map glass">
        <CircuitMap trackId={track.id} cars={snapshot?.cars} id={state.id} />
        <div>
          <span className="live-dot" />
          {self?.spectator
            ? "LIVE SPECTATOR"
            : `CHECKPOINT ${car?.checkpoint || 0} / ${track.checkpoints.length}`}
        </div>
      </div>
      <div className="race-controls">
        <kbd>
          {["accelerate", "left", "reverse", "right"]
            .map((key) =>
              settings.bindings[key as keyof Settings["bindings"]].replace(
                "Key",
                "",
              ),
            )
            .join(" ")}
        </kbd>{" "}
        Drive <kbd>{settings.bindings.brake.replace("Key", "")}</kbd> Brake{" "}
        <kbd>
          {settings.bindings.drift
            .replace("Key", "")
            .replace("Left", "")
            .replace("Right", "")}
        </kbd>{" "}
        Drift <kbd>{settings.bindings.reset.replace("Key", "")}</kbd> Reset{" "}
        <kbd>C</kbd> Camera{" "}
        {gamepad && (
          <span>
            <Gamepad2 size={15} /> Gamepad connected
          </span>
        )}
      </div>
      {!self?.spectator && (
        <div className="speedometer">
          <div className="position">
            <span>POSITION</span>
            <b>
              {position}
              <small> / {ranked.length}</small>
            </b>
          </div>
          <div className="speed">
            <strong>{Math.round(Math.abs(car?.speed || 0) * 3.6)}</strong>
            <span>KM/H</span>
            <div className="rpm">
              <i
                style={{
                  width: `${Math.min(100, (Math.abs(car?.speed || 0) / 65) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="gear">
            <b>
              {(car?.speed || 0) < -0.2
                ? "R"
                : Math.max(
                    1,
                    Math.min(6, Math.floor(Math.abs(car?.speed || 0) / 12) + 1),
                  )}
            </b>
            <span>GEAR</span>
          </div>
        </div>
      )}
      <div className="touch-controls">
        <button
          onPointerDown={() => (touch.current.steer = -1)}
          onPointerUp={() => (touch.current.steer = 0)}
          onPointerLeave={() => (touch.current.steer = 0)}
        >
          ←
        </button>
        <button
          onPointerDown={() => (touch.current.steer = 1)}
          onPointerUp={() => (touch.current.steer = 0)}
          onPointerLeave={() => (touch.current.steer = 0)}
        >
          →
        </button>
        <button
          onPointerDown={() => (touch.current.throttle = 1)}
          onPointerUp={() => (touch.current.throttle = 0)}
          onPointerLeave={() => (touch.current.throttle = 0)}
        >
          GAS
        </button>
        <button
          onPointerDown={() => (touch.current.brake = true)}
          onPointerUp={() => (touch.current.brake = false)}
          onPointerLeave={() => (touch.current.brake = false)}
        >
          BRAKE
        </button>
      </div>
      {finished && showResults && (
        <div className="results-backdrop">
          <section className="results-panel">
            <div className="eyebrow">
              <Trophy size={16} /> THE CHECKERED FLAG
            </div>
            <h1>THAT'S A WRAP.</h1>
            <p>
              {track.name} <span> / </span> {room.settings.laps}{" "}
              {room.settings.laps === 1 ? "lap" : "laps"} <span> / </span>{" "}
              Official server results
            </p>
            <div className="results-table">
              <div className="results-row heading">
                <span>POS</span>
                <span>DRIVER</span>
                <span>BEST LAP</span>
                <span>TOTAL TIME</span>
              </div>
              {snapshot?.results.map((result) => (
                <div
                  className={`results-row ${result.id === state.id ? "you" : ""}`}
                  key={result.id}
                >
                  <b>{String(result.position).padStart(2, "0")}</b>
                  <strong>
                    {result.name}
                    {result.id === state.id && <small> YOU</small>}
                  </strong>
                  <span>{formatTime(result.bestLapTicks)}</span>
                  <span>
                    {result.dnf ? "DNF" : formatTime(result.timeTicks)}
                    {result.penaltyTicks > 0 && (
                      <small> (+{result.penaltyTicks / 60}s)</small>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="results-actions">
              <button
                className="button secondary"
                onClick={() => connection.send({ type: "leave" })}
              >
                Back to paddock
              </button>
              {room.hostId === state.id ? (
                <button
                  className="button primary"
                  onClick={() => connection.send({ type: "rematch" })}
                >
                  Run it back <Flag size={16} />
                </button>
              ) : (
                <span>Waiting for the host to set up a rematch</span>
              )}
              <button
                className="text-button"
                onClick={() => setShowResults(false)}
              >
                View circuit
              </button>
            </div>
          </section>
        </div>
      )}
      {finished && !showResults && (
        <button
          className="button primary view-results"
          onClick={() => setShowResults(true)}
        >
          Show results <Trophy size={17} />
        </button>
      )}
      {room.state === "cancelled" && (
        <div className="results-backdrop">
          <section className="results-panel">
            <h1>RACE CANCELLED.</h1>
            <p>
              The grid is no longer available. Return to the paddock to find
              another race.
            </p>
            <button
              className="button primary"
              onClick={() => connection.send({ type: "leave" })}
            >
              Back to paddock
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
