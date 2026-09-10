import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BatteryFull,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  Expand,
  Gamepad2,
  Gauge,
  Glasses,
  Info,
  Keyboard,
  MapPin,
  Maximize2,
  Mountain,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Volume2,
  VolumeX,
  Wind,
  X,
  Zap,
} from "lucide-react";
import {
  Simulator,
  type CameraMode,
  type LiveTelemetry,
  type SimulatorHandle,
  type SimulatorSettings,
} from "./components/Simulator";
import { ENVIRONMENTS, type EnvironmentId } from "./sim/world";

type Phase = "ready" | "flying" | "paused" | "crashed";
type Modal = "environment" | "aircraft" | "settings" | "guide" | "log" | null;
interface FlightRecord {
  id: string;
  date: string;
  environment: string;
  mode: string;
  duration: number;
  distance: number;
  peakSpeed: number;
  peakAltitude: number;
  crashed: boolean;
}
const DEFAULT_SETTINGS: SimulatorSettings = {
  mode: "angle",
  wind: 1.5,
  fov: 105,
  cameraTilt: 15,
  rates: 480,
  expo: 0.35,
  quality: "high",
  controller: "gamepad",
  sound: false,
};
const INITIAL_TELEMETRY: LiveTelemetry = {
  speed: 0,
  altitude: 0.18,
  verticalSpeed: 0,
  batteryVoltage: 16.8,
  flightTime: 0,
  distance: 0,
  current: 0.3,
  motorOutputs: [0, 0, 0, 0],
  throttle: 0,
  heading: 0,
  pitch: 0,
  roll: 0,
  x: 0,
  z: 24,
  fps: 60,
  gamepad: null,
  gates: 0,
  peakSpeed: 0,
  peakAltitude: 0,
  groundSpeed: 0,
};
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
function readSettings(): SimulatorSettings {
  try {
    const s = JSON.parse(localStorage.getItem("fieldwork-settings") || "{}");
    const result = { ...DEFAULT_SETTINGS };
    for (const key of ["wind", "fov", "cameraTilt", "rates", "expo"] as const) {
      const bounds = {
        wind: [0, 12],
        fov: [75, 140],
        cameraTilt: [0, 45],
        rates: [180, 900],
        expo: [0, 0.8],
      }[key];
      if (typeof s[key] === "number" && Number.isFinite(s[key]))
        result[key] = Math.max(bounds[0], Math.min(bounds[1], s[key]));
    }
    if (s.mode === "angle" || s.mode === "acro") result.mode = s.mode;
    if (s.quality === "high" || s.quality === "balanced")
      result.quality = s.quality;
    if (s.controller === "gamepad" || s.controller === "radio")
      result.controller = s.controller;
    return result;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function readFlights(): FlightRecord[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem("fieldwork-flights") || "[]",
    );
    return Array.isArray(data)
      ? data
          .filter(
            (f): f is FlightRecord =>
              f &&
              typeof f.id === "string" &&
              typeof f.date === "string" &&
              !Number.isNaN(Date.parse(f.date)) &&
              typeof f.environment === "string" &&
              typeof f.mode === "string" &&
              ["duration", "distance", "peakSpeed", "peakAltitude"].every(
                (k) => typeof f[k] === "number" && Number.isFinite(f[k]),
              ) &&
              typeof f.crashed === "boolean",
          )
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "brand-mark small" : "brand-mark"}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m12 12 16 16m0-16L12 28"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <rect
        x="4"
        y="4"
        width="13"
        height="13"
        rx="5.2"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <rect
        x="23"
        y="4"
        width="13"
        height="13"
        rx="5.2"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <rect
        x="4"
        y="23"
        width="13"
        height="13"
        rx="5.2"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <rect
        x="23"
        y="23"
        width="13"
        height="13"
        rx="5.2"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <circle cx="20" cy="20" r="3.2" fill="currentColor" />
    </svg>
  );
}

function DroneIllustration({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={`drone-illustration ${large ? "large" : ""}`}
      viewBox="0 0 330 190"
      fill="none"
      role="img"
      aria-label="Carbon-fiber five-inch freestyle quadcopter with sage green propellers"
    >
      <defs>
        <linearGradient
          id="carbon"
          x1="100"
          y1="20"
          x2="210"
          y2="170"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#545b54" />
          <stop offset="0.5" stopColor="#222925" />
          <stop offset="1" stopColor="#41483f" />
        </linearGradient>
        <linearGradient
          id="battery"
          x1="150"
          y1="63"
          x2="185"
          y2="120"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#959b86" />
          <stop offset="1" stopColor="#5d6557" />
        </linearGradient>
        <linearGradient id="prop" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b7c2a1" />
          <stop offset="1" stopColor="#7e9171" />
        </linearGradient>
        <filter id="drone-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow
            dx="0"
            dy="12"
            stdDeviation="9"
            floodColor="#243023"
            floodOpacity="0.22"
          />
        </filter>
        <pattern id="cf" width="5" height="5" patternUnits="userSpaceOnUse">
          <path
            d="M0 0 5 5M-2 3 2 7"
            stroke="#8b9583"
            strokeWidth="0.5"
            opacity="0.4"
          />
        </pattern>
      </defs>
      <ellipse
        cx="168"
        cy="151"
        rx="96"
        ry="13"
        fill="#546044"
        opacity="0.08"
      />
      <g filter="url(#drone-shadow)">
        <path d="m76 58 16-5 159 83-13 11z" fill="url(#carbon)" />
        <path d="m88 138-12-10 164-80 14 7z" fill="url(#carbon)" />
        <path
          d="m80 59 166 82M83 133 247 53"
          stroke="#60695b"
          strokeWidth="2"
        />
        <path
          d="m156 49 40 18 5 56-37 26-37-23-2-50z"
          fill="#202723"
          stroke="#606957"
          strokeWidth="1.5"
        />
        <path d="m156 49 40 18 5 56-37 26-37-23-2-50z" fill="url(#cf)" />
        <path d="m137 71 37-14 19 15-2 44-29 18-26-17z" fill="url(#battery)" />
        <path
          d="m137 71 25 18 31-17M162 89v45"
          stroke="#bbc1a5"
          strokeWidth="0.8"
          opacity="0.55"
        />
        <path d="m148 65 25 17 9-4-24-17z" fill="#252d27" />
        <path d="m173 82-2 47 9-5 2-46z" fill="#252d27" />
        <path d="m137 98 25 18 30-19v10l-30 20-25-19z" fill="#252d27" />
        <path d="m146 61-8-12 7-8" stroke="#d37a43" strokeWidth="3" />
        <path d="m188 113 16 6 9-5" stroke="#303930" strokeWidth="3" />
        <path d="m145 135 11 7 17-6-2 10-17 7-11-8z" fill="#1d2521" />
        <ellipse
          cx="154"
          cy="143"
          rx="6"
          ry="5"
          fill="#0c1513"
          stroke="#707d69"
          strokeWidth="2"
        />
        <ellipse cx="153" cy="142" rx="2.5" ry="2" fill="#7d9690" />
        {[
          [82, 56],
          [246, 52],
          [82, 133],
          [245, 141],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x},${y})`}>
            <ellipse cy="3" rx="11" ry="8" fill="#2c362d" />
            <path d="M-10-3v7c0 9 20 9 20 0v-7" fill="#56664c" />
            <ellipse cy="-3" rx="10" ry="6" fill="#7a8966" />
            <g transform={`rotate(${i % 2 ? -22 : 19})`}>
              <path
                d="M-3-3C-16-14-37-17-44-12c-7 5 6 12 21 15L0 5zM3 1C16 12 37 15 44 10c7-5-6-12-21-15L0-7z"
                fill="url(#prop)"
                fillOpacity="0.88"
                stroke="#b3bea3"
                strokeWidth="0.7"
              />
              <path
                d="m0-3-27-7M0-3l27 7"
                stroke="#d4dcc4"
                strokeWidth="0.7"
                opacity="0.65"
              />
            </g>
            <ellipse cy="-3" rx="4" ry="3" fill="#34412f" />
            <ellipse cy="-4" rx="1.7" ry="1.2" fill="#c6ccb9" />
          </g>
        ))}
        {[
          [133, 76],
          [192, 75],
          [134, 119],
          [193, 118],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2" fill="#a0a68e" />
        ))}
        <path d="m179 62 10-22" stroke="#343e32" strokeWidth="2" />
        <rect
          x="185"
          y="28"
          width="7"
          height="15"
          rx="3"
          transform="rotate(20 188 35)"
          fill="#505e44"
        />
      </g>
    </svg>
  );
}

function ModalShell({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, a[href], [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RangeSetting({
  label,
  value,
  suffix,
  min,
  max,
  step = 1,
  onChange,
  description,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  description?: string;
}) {
  return (
    <label className="range-setting">
      <span className="range-label">
        <span>{label}</span>
        <span className="mono">
          {Number(value.toFixed(2))}
          <span className="muted"> {suffix}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            "--range-progress": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
      />
      {description && (
        <span className="setting-description">{description}</span>
      )}
    </label>
  );
}

function App() {
  const [settings, setSettings] = useState<SimulatorSettings>(readSettings);
  const [environment, setEnvironment] = useState<EnvironmentId>("yard");
  const [phase, setPhase] = useState<Phase>("ready");
  const [camera, setCamera] = useState<CameraMode>("orbit");
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [preview, setPreview] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [settingsTab, setSettingsTab] = useState<
    "flight" | "controller" | "display"
  >("flight");
  const [guideTab, setGuideTab] = useState<"start" | "controls" | "physics">(
    "start",
  );
  const [flights, setFlights] = useState<FlightRecord[]>(readFlights);
  const [toast, setToast] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const sim = useRef<SimulatorHandle>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const flightStart = useRef({ time: 0, distance: 0 });
  const speedHistory = useRef<number[]>(Array(24).fill(0));
  const env = ENVIRONMENTS[environment];
  const isActive = phase === "flying" || phase === "paused";

  useEffect(() => {
    try {
      localStorage.setItem("fieldwork-settings", JSON.stringify(settings));
    } catch {
      /* Storage is optional in private browsing. */
    }
  }, [settings]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const change = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const changeSetting = <K extends keyof SimulatorSettings>(
    key: K,
    value: SimulatorSettings[K],
  ) => setSettings((s) => ({ ...s, [key]: value }));
  const saveFlight = (crashed = false) => {
    const t = sim.current?.telemetry();
    if (!t || t.flightTime - flightStart.current.time < 1) return;
    const flight: FlightRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      date: new Date().toISOString(),
      environment: env.name,
      mode: settings.mode,
      duration: t.flightTime - flightStart.current.time,
      distance: Math.max(0, t.distance - flightStart.current.distance),
      peakSpeed: t.peakSpeed,
      peakAltitude: t.peakAltitude,
      crashed,
    };
    const next = [flight, ...flights].slice(0, 50);
    setFlights(next);
    try {
      localStorage.setItem("fieldwork-flights", JSON.stringify(next));
    } catch {
      setToast(
        "Browser storage is unavailable. This flight log will last for this session.",
      );
    }
  };
  const arm = () => {
    if (phase === "crashed") {
      reset();
      return;
    }
    if (isActive) {
      sim.current?.disarm();
      setPhase("ready");
      saveFlight();
      setToast(
        "Motors disarmed. Flights over one second are saved to your log.",
      );
      return;
    }
    const current = sim.current?.telemetry();
    flightStart.current = {
      time: current?.flightTime ?? 0,
      distance: current?.distance ?? 0,
    };
    if (!engineError && sim.current?.arm()) {
      setPhase("flying");
      setCamera("fpv");
      if (window.innerWidth <= 800)
        viewport.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      setToast("Armed. Hold ↑ to add throttle. H sets estimated hover thrust.");
    }
  };
  const reset = () => {
    sim.current?.disarm();
    if (isActive) saveFlight();
    sim.current?.reset();
    setPhase("ready");
    setCamera("orbit");
    setTelemetry(INITIAL_TELEMETRY);
    setToast("Back on the launch pad. Fresh battery, fresh start.");
  };
  const togglePause = () => {
    if (engineError) return;
    if (phase === "flying") setPhase("paused");
    else if (phase === "paused") setPhase("flying");
  };
  const openModal = (value: Modal) => {
    if (phase === "flying") setPhase("paused");
    if (document.fullscreenElement) void document.exitFullscreen();
    setModal(value);
  };
  const closeModal = () => setModal(null);
  const cycleCamera = () =>
    setCamera((c) => (c === "fpv" ? "chase" : c === "chase" ? "orbit" : "fpv"));
  const actions = useRef({ arm, reset, togglePause, cycleCamera, openModal });
  actions.current = { arm, reset, togglePause, cycleCamera, openModal };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        modal ||
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLButtonElement && event.code === "Space")
      )
        return;
      if (["Space", "KeyR", "KeyP", "KeyV", "Escape"].includes(event.code))
        event.preventDefault();
      if (event.code === "Space") actions.current.arm();
      if (event.code === "KeyR") actions.current.reset();
      if (
        event.code === "KeyP" ||
        (event.code === "Escape" && phaseRef.current === "flying")
      )
        actions.current.togglePause();
      if (event.code === "KeyV") actions.current.cycleCamera();
      if (event.code === "Slash" && event.shiftKey)
        actions.current.openModal("guide");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [modal]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewport.current?.requestFullscreen)
        await viewport.current.requestFullscreen();
      else setToast("Fullscreen is not supported by this browser.");
    } catch {
      setToast("Fullscreen could not be opened in this browser.");
    }
  };
  const exportFlights = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(flights, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "fieldwork-flight-log.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("Flight log exported.");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setModal(null);
          }}
          aria-label="Fieldwork flight deck"
        >
          <BrandMark />
          <span>
            fieldwork<span className="brand-period">.</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-caption">
            FPV FLIGHT
            <br />
            SIMULATOR
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={
              !modal || !["aircraft", "log"].includes(modal) ? "active" : ""
            }
            onClick={() => setModal(null)}
          >
            <Navigation size={16} />
            Fly
          </button>
          <button
            className={modal === "aircraft" ? "active" : ""}
            onClick={() => openModal("aircraft")}
          >
            Hangar
          </button>
          <button
            className={modal === "log" ? "active" : ""}
            onClick={() => openModal("log")}
          >
            Flight log
            <span className="nav-count">
              {flights.length.toString().padStart(2, "0")}
            </span>
          </button>
        </nav>
        <div className="header-right">
          <span className="local-badge">
            <span className="status-dot" />
            All systems local
          </span>
          <span className="header-line" />
          <button
            className="icon-button help-icon"
            onClick={() => openModal("guide")}
            aria-label="Open pilot guide"
          >
            <CircleHelp size={19} />
          </button>
          <span className="avatar" title="Your local pilot profile">
            P
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Flight configuration">
          <div className="sidebar-heading">
            <span className="eyebrow">YOUR FLIGHT, YOUR RULES</span>
            <span className="tiny-dot" />
          </div>
          <div className="section-label">
            <span>Environment</span>
            <button onClick={() => openModal("environment")}>
              Explore <ArrowUpRight size={13} />
            </button>
          </div>
          <button
            className="environment-card"
            onClick={() => openModal("environment")}
            aria-label={`Change environment, currently ${env.name}`}
          >
            {preview && (
              <img
                src={preview}
                alt="Aerial view of the current training environment"
              />
            )}
            <div className="environment-shade" />
            <span className="environment-number">
              {environment === "yard"
                ? "01"
                : environment === "meadow"
                  ? "02"
                  : "03"}{" "}
              <span>/ FREE FLIGHT</span>
            </span>
            <div className="environment-card-bottom">
              <div>
                <strong>{env.name}</strong>
                <span>
                  <MapPin size={11} />
                  {env.subtitle}
                </span>
              </div>
              <span className="environment-arrow">
                <ChevronRight size={17} />
              </span>
            </div>
          </button>

          <div className="section-label aircraft-label">
            <span>Your aircraft</span>
            <button
              onClick={() => openModal("aircraft")}
              aria-label="View aircraft details"
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>
          <button
            className="aircraft-card"
            onClick={() => openModal("aircraft")}
            aria-label="View FW-5 Freestyle aircraft"
          >
            <div className="aircraft-topline">
              <span className="micro-label">5-INCH FREESTYLE</span>
              <span className="aircraft-index">01</span>
            </div>
            <DroneIllustration />
            <div className="aircraft-name">
              <strong>FW-5 Freestyle</strong>
              <span>
                <span className="status-dot" />
                Ready
              </span>
            </div>
          </button>
          <div className="aircraft-specs">
            <div>
              <span>Weight</span>
              <strong>
                650 <small>g</small>
              </strong>
            </div>
            <div>
              <span>Battery</span>
              <strong>
                4S <small>LiPo</small>
              </strong>
            </div>
            <div>
              <span>Thrust / weight</span>
              <strong>
                3.45<small> : 1</small>
              </strong>
            </div>
          </div>

          <div className="sidebar-divider" />
          <div className="section-label">
            <span>Flight mode</span>
            <button
              onClick={() => {
                setGuideTab("physics");
                openModal("guide");
              }}
              aria-label="Learn about flight modes"
            >
              <Info size={14} />
            </button>
          </div>
          <div className="mode-switch" role="group" aria-label="Flight mode">
            <button
              className={settings.mode === "angle" ? "selected" : ""}
              aria-pressed={settings.mode === "angle"}
              onClick={() => changeSetting("mode", "angle")}
            >
              <ShieldCheck size={14} />
              Angle
              <span className="recommended-dot" />
            </button>
            <button
              className={settings.mode === "acro" ? "selected" : ""}
              aria-pressed={settings.mode === "acro"}
              onClick={() => changeSetting("mode", "acro")}
            >
              <Zap size={14} />
              Acro
            </button>
          </div>
          <p className="mode-description">
            {settings.mode === "angle"
              ? "Self-leveling. A little help finding your feet."
              : "Full manual. No limits on your rotation."}
          </p>

          <div className="sidebar-divider conditions-divider" />
          <div className="section-label">
            <span>Conditions</span>
            <Sun size={15} className="sun-icon" />
          </div>
          <div className="weather-row">
            <span>Clear skies</span>
            <span className="mono">
              18<span className="muted">°C</span>
            </span>
          </div>
          <RangeSetting
            label="Wind speed"
            value={settings.wind}
            suffix="m/s"
            min={0}
            max={12}
            step={0.5}
            onChange={(v) => changeSetting("wind", v)}
          />
          <div className="wind-labels">
            <span>Calm</span>
            <span>Breezy</span>
            <span>Challenging</span>
          </div>

          <div className="launch-area">
            <button
              className={`launch-button ${isActive ? "disarm" : ""}`}
              onClick={arm}
              disabled={engineError}
            >
              {phase === "crashed" ? (
                <RotateCcw size={17} />
              ) : isActive ? (
                <span className="stop-square" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              <span>
                {phase === "crashed"
                  ? "Reset aircraft"
                  : isActive
                    ? "Disarm motors"
                    : "Arm & fly"}
              </span>
              <kbd>{phase === "crashed" ? "R" : "SPACE"}</kbd>
            </button>
            <span className="launch-caption">
              <ShieldCheck size={12} />
              Real practice. No repair bill.
            </span>
          </div>
        </aside>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                <span className="eyebrow">THE FLIGHT DECK</span>
                <span className="beta-tag">EARLY ACCESS</span>
              </div>
              <h1>
                Less fear. More flight<span>.</span>
              </h1>
              <p>Your space to practice, explore, and find your flow.</p>
            </div>
            <button
              className="secondary-button settings-button"
              onClick={() => openModal("settings")}
            >
              <Settings2 size={16} />
              <span>Flight settings</span>
            </button>
          </div>

          <section
            className={`flight-viewport ${fullScreen ? "is-fullscreen" : ""}`}
            ref={viewport}
            aria-label="Live flight viewport"
          >
            <div className="viewport-toolbar">
              <button
                className="live-view-label"
                onClick={() => openModal("environment")}
                aria-label="Choose training environment"
              >
                <span
                  className={`status-dot ${phase === "flying" ? "orange-dot" : ""}`}
                />
                <span>LIVE VIEW</span>
                <span className="toolbar-separator" />
                <span className="viewport-environment">{env.name}</span>
                <ChevronDown size={12} />
              </button>
              <div
                className="camera-switch"
                role="group"
                aria-label="Camera view"
              >
                {(
                  [
                    { id: "fpv", icon: Glasses, label: "FPV" },
                    { id: "chase", icon: Navigation, label: "Chase" },
                    { id: "orbit", icon: Compass, label: "Orbit" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCamera(item.id)}
                    className={camera === item.id ? "active" : ""}
                    aria-pressed={camera === item.id}
                  >
                    <item.icon size={14} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="viewport-tools">
                {fullScreen && (
                  <button
                    className="fullscreen-arm"
                    onClick={arm}
                    disabled={engineError}
                  >
                    {isActive
                      ? "Disarm"
                      : phase === "crashed"
                        ? "Reset"
                        : "Arm & fly"}
                  </button>
                )}
                <button
                  className={`icon-button ${settings.sound ? "enabled" : ""}`}
                  onClick={() => changeSetting("sound", !settings.sound)}
                  aria-label={
                    settings.sound ? "Mute motor audio" : "Enable motor audio"
                  }
                  title={settings.sound ? "Mute audio" : "Enable audio"}
                >
                  {settings.sound ? (
                    <Volume2 size={16} />
                  ) : (
                    <VolumeX size={16} />
                  )}
                </button>
                <button
                  className="icon-button"
                  onClick={fullscreen}
                  aria-label={
                    fullScreen ? "Exit fullscreen" : "Enter fullscreen"
                  }
                  title="Fullscreen"
                >
                  <Maximize2 size={15} />
                </button>
              </div>
            </div>
            <div className="scene-container">
              <Simulator
                ref={sim}
                environment={environment}
                settings={settings}
                cameraMode={camera}
                paused={phase === "paused" || modal !== null}
                controlsEnabled={!modal}
                onTelemetry={(value) => {
                  speedHistory.current.push(value.groundSpeed);
                  speedHistory.current.shift();
                  setTelemetry(value);
                }}
                onCrash={() => {
                  if (phaseRef.current === "flying") saveFlight(true);
                  setPhase("crashed");
                }}
                onPause={() => {
                  if (phaseRef.current === "flying") setPhase("paused");
                }}
                onPreview={(image) => {
                  setPreview(image);
                  setEngineError(false);
                }}
                onError={() => setEngineError(true)}
              />
              {!engineError && (
                <div className="scene-overlay">
                  <div className="osd-top">
                    <div className="location-osd">
                      <span className="osd-kicker">
                        FIELDWORK /{" "}
                        {environment === "yard"
                          ? "01"
                          : environment === "meadow"
                            ? "02"
                            : "03"}
                      </span>
                      <span>{env.name.toUpperCase()}</span>
                      <small>
                        47° 16′ N &nbsp; 11° 24′ E <span>· VIRTUAL SITE</span>
                      </small>
                    </div>
                    <div
                      className={`arm-status ${phase === "flying" ? "armed" : ""} ${phase === "crashed" ? "crashed" : ""}`}
                    >
                      <span />
                      {phase === "flying"
                        ? "ARMED"
                        : phase === "paused"
                          ? "PAUSED"
                          : phase === "crashed"
                            ? "IMPACT DETECTED"
                            : "DISARMED"}
                    </div>
                    <div className="osd-signal">
                      <span className="signal-bars">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>SIM LINK</span>
                      <BatteryFull size={23} />
                    </div>
                  </div>
                  {camera === "fpv" && (
                    <>
                      <div
                        className="fpv-horizon"
                        style={{
                          transform: `translate(-50%, -50%) rotate(${-telemetry.roll}deg)`,
                        }}
                      >
                        <span />
                        <i />
                        <span />
                      </div>
                      <div className="fpv-heading">
                        <span>
                          {Math.round(telemetry.heading)
                            .toString()
                            .padStart(3, "0")}
                          °
                        </span>
                        <small>HEADING</small>
                      </div>
                      <div className="fpv-altitude">
                        <span>
                          {Math.max(0, telemetry.altitude - 0.18).toFixed(1)}{" "}
                          <small>m</small>
                        </span>
                        <small>ALTITUDE AGL</small>
                      </div>
                      <div className="throttle-osd">
                        <span>
                          {Math.round(telemetry.throttle * 100)}
                          <small>%</small>
                        </span>
                        <small>THROTTLE</small>
                        <div>
                          <i
                            style={{ width: `${telemetry.throttle * 100}%` }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                  {environment === "circuit" && (
                    <div className="gate-progress">
                      GATE {String((telemetry.gates % 8) + 1).padStart(2, "0")}{" "}
                      / 08
                      <span>
                        LAP{" "}
                        {String(Math.floor(telemetry.gates / 8) + 1).padStart(
                          2,
                          "0",
                        )}
                      </span>
                    </div>
                  )}
                  {phase === "ready" && camera === "orbit" && (
                    <div className="orbit-label">
                      <span className="orbit-circle">
                        <Compass size={16} />
                      </span>
                      <span>
                        Look around. Make yourself at home.
                        <small>Drag to orbit · Scroll to zoom</small>
                      </span>
                    </div>
                  )}
                  <div className="osd-bottom">
                    <div className="camera-osd">
                      <span className="camera-corner" />
                      <span>
                        {camera === "fpv"
                          ? "PILOT CAMERA"
                          : camera === "chase"
                            ? "CHASE CAMERA"
                            : "EXPLORER CAMERA"}
                        <small>
                          {camera === "fpv"
                            ? `${settings.fov}° FOV / ${settings.cameraTilt}° TILT`
                            : "FREE LOOK / EXTERNAL VIEW"}
                        </small>
                      </span>
                    </div>
                    <div className="mini-map">
                      <span className="map-north">N</span>
                      <svg
                        viewBox="0 0 110 94"
                        aria-label="Aircraft position mini-map"
                        role="img"
                      >
                        <defs>
                          <pattern
                            id="map-grid"
                            width="12"
                            height="12"
                            patternUnits="userSpaceOnUse"
                          >
                            <path
                              d="M12 0H0v12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="0.4"
                              opacity="0.2"
                            />
                          </pattern>
                        </defs>
                        <rect width="110" height="94" fill="url(#map-grid)" />
                        <path
                          d="M18 17h74v62H18z"
                          stroke="currentColor"
                          strokeWidth="0.7"
                          opacity="0.4"
                          fill="none"
                        />
                        {environment === "yard" && (
                          <path
                            d="M57 24h29v17H57zM25 34h15v5H25zM25 42h15v5H25zM67 55h20v4H67z"
                            fill="currentColor"
                            opacity="0.35"
                          />
                        )}
                        <path
                          d="M53 17v62"
                          stroke="currentColor"
                          strokeDasharray="2 3"
                          opacity="0.35"
                        />
                        <circle
                          cx="55"
                          cy="66"
                          r="2"
                          stroke="currentColor"
                          fill="none"
                          opacity="0.6"
                        />
                        <g
                          transform={`translate(${Math.max(5, Math.min(105, 55 + telemetry.x * 0.43))},${Math.max(5, Math.min(88, 53 + telemetry.z * 0.43))}) rotate(${telemetry.heading})`}
                        >
                          <path d="m0-5 4 9-4-2-4 2z" fill="#f6a774" />
                        </g>
                      </svg>
                      <span className="map-scale">
                        20 m <i />
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {phase === "paused" && !modal && (
                <div className="flight-state-overlay">
                  <div className="pause-card">
                    <span className="state-icon">
                      <Pause size={22} />
                    </span>
                    <span className="eyebrow">TAKE A BREATH</span>
                    <h2>Right where you left off.</h2>
                    <p>
                      Your flight is paused. Physics and the timer are on hold.
                    </p>
                    <button className="launch-button" onClick={togglePause}>
                      <Play size={16} fill="currentColor" />
                      Resume flight<kbd>P</kbd>
                    </button>
                    <button className="text-button" onClick={reset}>
                      Back to the launch pad <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
              {phase === "crashed" && (
                <div className="flight-state-overlay">
                  <div className="pause-card">
                    <span className="state-icon crash-icon">
                      <ShieldCheck size={23} />
                    </span>
                    <span className="eyebrow">THAT ONE WAS ON US</span>
                    <h2>No broken props here.</h2>
                    <p>
                      Impact detected. Your real drone is still in one piece.
                      Reset and give it another go.
                    </p>
                    <button className="launch-button" onClick={reset}>
                      <RotateCcw size={16} />
                      Back to the launch pad<kbd>R</kbd>
                    </button>
                  </div>
                </div>
              )}
              <div className="scene-action-buttons">
                <button
                  onClick={togglePause}
                  disabled={!isActive}
                  aria-label={
                    phase === "paused" ? "Resume flight" : "Pause flight"
                  }
                  title="Pause (P)"
                >
                  {phase === "paused" ? (
                    <Play size={15} />
                  ) : (
                    <Pause size={15} />
                  )}
                </button>
                <button
                  onClick={reset}
                  aria-label="Reset flight"
                  title="Reset (R)"
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            </div>
            <div className="telemetry-strip">
              <div className="telemetry-item">
                <Gauge size={17} />
                <div>
                  <span className="metric-label">GROUND SPEED</span>
                  <strong>
                    {(telemetry.groundSpeed * 3.6).toFixed(1)}
                    <small>km/h</small>
                  </strong>
                </div>
                <div className="sparkline">
                  <svg viewBox="0 0 54 25">
                    <polyline
                      points={speedHistory.current
                        .map(
                          (speed, i) =>
                            `${(i * 54) / 23},${22 - Math.min(20, speed)}`,
                        )
                        .join(" ")}
                    />
                  </svg>
                </div>
              </div>
              <div className="telemetry-item">
                <ArrowUpFromGround />
                <div>
                  <span className="metric-label">ALTITUDE</span>
                  <strong>
                    {Math.max(0, telemetry.altitude - 0.18).toFixed(1)}
                    <small>m</small>
                  </strong>
                </div>
                <span className="metric-tag">AGL</span>
              </div>
              <div className="telemetry-item">
                <BatteryFull size={18} />
                <div>
                  <span className="metric-label">BATTERY</span>
                  <strong>
                    {telemetry.batteryVoltage.toFixed(1)}
                    <small>V</small>
                  </strong>
                </div>
                <span className="battery-tag">4S</span>
              </div>
              <div className="telemetry-item">
                <Clock3 size={17} />
                <div>
                  <span className="metric-label">FLIGHT TIME</span>
                  <strong>{formatTime(telemetry.flightTime)}</strong>
                </div>
                <span
                  className={`timer-dot ${phase === "flying" ? "running" : ""}`}
                />
              </div>
            </div>
          </section>

          <div className="controls-bar">
            <div className="controls-label">
              <Keyboard size={17} />
              <span>You're in control</span>
            </div>
            <div className="key-group">
              <span className="key-pair">
                <kbd>
                  <ArrowUp size={11} />
                </kbd>
                <kbd>
                  <ArrowDown size={11} />
                </kbd>
              </span>
              <span>Throttle</span>
            </div>
            <div className="key-group">
              <span className="key-pair">
                <kbd>W</kbd>
                <kbd>S</kbd>
              </span>
              <span>Pitch</span>
            </div>
            <div className="key-group">
              <span className="key-pair">
                <kbd>A</kbd>
                <kbd>D</kbd>
              </span>
              <span>Roll</span>
            </div>
            <div className="key-group">
              <span className="key-pair">
                <kbd>Q</kbd>
                <kbd>E</kbd>
              </span>
              <span>Yaw</span>
            </div>
            <button
              className="all-controls"
              onClick={() => {
                setGuideTab("controls");
                openModal("guide");
              }}
            >
              All controls
              <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="mobile-flight-controls">
            <RangeSetting
              label="Throttle"
              value={Math.round(telemetry.throttle * 100)}
              suffix="%"
              min={0}
              max={100}
              onChange={(v) => sim.current?.setThrottle(v / 100)}
            />
            <TouchControls
              disabled={phase !== "flying"}
              onStick={(pitch, roll, yaw) =>
                sim.current?.setStick(pitch, roll, yaw)
              }
            />
            <button
              className="secondary-button"
              onClick={() => sim.current?.hoverThrottle()}
            >
              Hover thrust
            </button>
          </div>
          <footer className="flight-footer">
            <span>
              <span className="status-dot" />
              Physics, not shortcuts.
              <span className="footer-detail">240 Hz · 6-DOF rigid body</span>
            </span>
            <button
              onClick={() => {
                setSettingsTab("controller");
                openModal("settings");
              }}
            >
              <Gamepad2 size={15} />
              <span>
                {telemetry.gamepad
                  ? "Controller connected"
                  : "Made for your controller"}
              </span>
              <ArrowUpRight size={12} />
            </button>
          </footer>
          <div className="bottom-note">
            <BrandMark small />
            <span>Build confidence. Not a repair collection.</span>
            <span className="version">FIELDWORK v0.1</span>
          </div>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {modal === "environment" && (
        <ModalShell
          title="Find your flying ground."
          eyebrow="A CHANGE OF SCENERY"
          onClose={closeModal}
          wide
        >
          <p className="modal-intro">
            Three spaces. Endless ways to get better. Changing environments ends
            your current flight.
          </p>
          <div className="environment-options">
            {(
              Object.entries(ENVIRONMENTS) as [
                EnvironmentId,
                (typeof ENVIRONMENTS)[EnvironmentId],
              ][]
            ).map(([id, item], index) => (
              <button
                key={id}
                className={`environment-option ${id === environment ? "selected" : ""}`}
                onClick={() => {
                  if (id !== environment) {
                    if (isActive) saveFlight();
                    sim.current?.reset();
                    setPhase("ready");
                    setCamera("orbit");
                    setEnvironment(id);
                    setTelemetry(INITIAL_TELEMETRY);
                  }
                  closeModal();
                }}
              >
                <div className={`environment-art ${id}`}>
                  {id === "yard" && preview && environment === "yard" ? (
                    <img
                      src={preview}
                      alt="The Yard industrial training environment"
                    />
                  ) : (
                    <>
                      <Mountain size={110} strokeWidth={0.5} />
                      <span className="art-grid" />
                    </>
                  )}
                  <span className="art-number">0{index + 1}</span>
                  <span className="environment-select-mark">
                    {id === environment ? (
                      <Check size={15} />
                    ) : (
                      <ArrowUpRight size={15} />
                    )}
                  </span>
                </div>
                <span className="micro-label">{item.tag}</span>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div className="environment-option-footer">
                  <span>{item.difficulty}</span>
                  <span>{item.area}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="info-note">
            <Wind size={16} />
            <span>
              Wind conditions and flight settings carry over to your new
              environment.
            </span>
          </div>
        </ModalShell>
      )}

      {modal === "aircraft" && (
        <ModalShell
          title="Small frame. Big possibilities."
          eyebrow="YOUR HANGAR / 01"
          onClose={closeModal}
        >
          <div className="hangar-preview">
            <span className="micro-label">FIELDWORK ORIGINALS</span>
            <DroneIllustration large />
            <span className="hangar-ready">
              <span className="status-dot" />
              FLIGHT READY
            </span>
          </div>
          <div className="hangar-title">
            <div>
              <h3>FW-5 Freestyle</h3>
              <p>A balanced 5-inch quad for everyday progression.</p>
            </div>
            <span className="outline-tag">4S</span>
          </div>
          <div className="specification-grid">
            {[
              ["All-up weight", "650 g"],
              ["Frame / motor span", "5-inch / 340 mm"],
              ["Maximum static thrust", "22 N (2.24 kgf)"],
              ["Thrust-to-weight ratio", "3.45 : 1"],
              ["Motor response", "35 ms time constant"],
              ["Battery model", "4S · 1,500 mAh"],
              ["Flight controller", "PD rate / angle"],
              ["Collision envelope", "180 mm radius"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="info-note">
            <Info size={17} />
            <span>
              A generic training model, not a digital twin of a particular
              drone. Motor output represents normalized thrust, not stick-to-RPM
              calibration.
            </span>
          </div>
          <button
            className="launch-button modal-primary"
            onClick={() => {
              setSettingsTab("flight");
              setModal("settings");
            }}
          >
            <SlidersHorizontal size={16} />
            Tune your flight setup
            <ArrowRight size={16} />
          </button>
        </ModalShell>
      )}

      {modal === "settings" && (
        <ModalShell
          title="Make it feel like yours."
          eyebrow="FLIGHT SETTINGS"
          onClose={closeModal}
        >
          <div
            className="modal-tabs"
            role="tablist"
            aria-label="Settings sections"
          >
            {(
              [
                {
                  id: "flight",
                  label: "Flight setup",
                  icon: SlidersHorizontal,
                },
                { id: "controller", label: "Controller", icon: Gamepad2 },
                { id: "display", label: "Display & audio", icon: Expand },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={settingsTab === tab.id}
                className={settingsTab === tab.id ? "active" : ""}
                onClick={() => setSettingsTab(tab.id)}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
          {settingsTab === "flight" && (
            <div className="settings-body">
              <RangeSetting
                label="Maximum rotation rate"
                value={settings.rates}
                suffix="°/s"
                min={180}
                max={900}
                step={30}
                onChange={(v) => changeSetting("rates", v)}
                description="Acro pitch and roll rate at full stick. Yaw uses 65% of this rate."
              />
              <RangeSetting
                label="Stick expo"
                value={settings.expo}
                suffix=""
                min={0}
                max={0.8}
                step={0.05}
                onChange={(v) => changeSetting("expo", v)}
                description="Higher expo softens the center of the stick for finer adjustments."
              />
              <RangeSetting
                label="FPV camera tilt"
                value={settings.cameraTilt}
                suffix="°"
                min={0}
                max={45}
                onChange={(v) => changeSetting("cameraTilt", v)}
                description="15° is a gentle starting point. More tilt suits faster forward flight."
              />
              <RangeSetting
                label="Wind speed"
                value={settings.wind}
                suffix="m/s"
                min={0}
                max={12}
                step={0.5}
                onChange={(v) => changeSetting("wind", v)}
                description="Constant crosswind from the northwest. Set to zero for basic hover practice."
              />
              <div className="info-note">
                <ShieldCheck size={17} />
                <span>
                  Angle mode self-levels but does not hold altitude or position.
                  Hover requires active throttle management.
                </span>
              </div>
            </div>
          )}
          {settingsTab === "controller" && (
            <div className="settings-body">
              <div
                className={`controller-status ${telemetry.gamepad ? "connected" : ""}`}
              >
                <Gamepad2 size={29} />
                <div>
                  <strong>
                    {telemetry.gamepad
                      ? "Controller connected"
                      : "Bring your sticks."}
                  </strong>
                  <p>
                    {telemetry.gamepad ||
                      "Connect a USB controller, then press any controller button to wake it up."}
                  </p>
                </div>
                {telemetry.gamepad && <Check size={20} />}
              </div>
              <label className="select-setting">
                <span>Input profile</span>
                <select
                  value={settings.controller}
                  onChange={(e) =>
                    changeSetting(
                      "controller",
                      e.target.value as SimulatorSettings["controller"],
                    )
                  }
                >
                  <option value="gamepad">
                    Standard gamepad (Xbox / PlayStation)
                  </option>
                  <option value="radio">USB radio (AETR axis order)</option>
                </select>
              </label>
              <div className="controller-mapping">
                {(settings.controller === "gamepad"
                  ? [
                      ["Throttle up / down", "RT / LT (latching)"],
                      ["Yaw", "Left stick horizontal"],
                      ["Pitch / roll", "Right stick"],
                      ["Arm / disarm", "Space or on-screen button"],
                    ]
                  : [
                      ["Roll", "Axis 0"],
                      ["Pitch", "Axis 1 (up = forward)"],
                      ["Throttle", "Axis 2 (−1 = full)"],
                      ["Yaw", "Axis 3"],
                    ]
                ).map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="input-monitor">
                <span className="micro-label">LIVE INPUT / MOTOR OUTPUT</span>
                <div className="motor-bars">
                  {telemetry.motorOutputs.map((value, i) => (
                    <div key={i}>
                      <span>M{i + 1}</span>
                      <span className="motor-track">
                        <i style={{ width: `${value * 100}%` }} />
                      </span>
                      <span>{Math.round(value * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="info-note">
                <Info size={17} />
                <span>
                  {settings.controller === "radio"
                    ? "Configure your radio USB output to AETR in its firmware. Move throttle fully low after every arm to unlock input. Check directions in a safe hover before practicing."
                    : "A 6% center deadzone is applied. Trigger throttle stays where you leave it; release does not cut the motors. Keyboard controls remain available."}
                </span>
              </div>
            </div>
          )}
          {settingsTab === "display" && (
            <div className="settings-body">
              <RangeSetting
                label="FPV field of view"
                value={settings.fov}
                suffix="° vertical"
                min={75}
                max={140}
                step={5}
                onChange={(v) => changeSetting("fov", v)}
                description="Wider views improve peripheral awareness but make distances look greater."
              />
              <label className="select-setting">
                <span>Graphics quality</span>
                <select
                  value={settings.quality}
                  onChange={(e) => {
                    if (isActive) saveFlight();
                    sim.current?.reset();
                    setPhase("ready");
                    setCamera("orbit");
                    changeSetting(
                      "quality",
                      e.target.value as SimulatorSettings["quality"],
                    );
                  }}
                >
                  <option value="high">
                    High · detailed trees and 4K shadows
                  </option>
                  <option value="balanced">
                    Balanced · lighter on your GPU
                  </option>
                </select>
                <small>
                  Changing quality rebuilds the scene and resets your flight.
                </small>
              </label>
              <div className="toggle-setting">
                <div>
                  <strong>Motor audio</strong>
                  <span>Synthesized motor feedback, off by default.</span>
                </div>
                <button
                  className={`toggle ${settings.sound ? "on" : ""}`}
                  role="switch"
                  aria-checked={settings.sound}
                  aria-label="Motor audio"
                  onClick={() => changeSetting("sound", !settings.sound)}
                >
                  <span />
                </button>
              </div>
              <div className="performance-card">
                <span>
                  <span className="status-dot" />
                  Live render rate
                </span>
                <strong className="mono">
                  {telemetry.fps} <small>FPS</small>
                </strong>
              </div>
              <div className="info-note">
                <Gauge size={17} />
                <span>
                  Physics runs at fixed 240 Hz steps, independently of
                  rendering. At low frame rates, simulation time slows rather
                  than taking unstable physics steps.
                </span>
              </div>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="text-button"
              onClick={() => {
                if (settings.quality !== DEFAULT_SETTINGS.quality) {
                  if (isActive) saveFlight();
                  sim.current?.reset();
                  setPhase("ready");
                  setCamera("orbit");
                }
                setSettings(DEFAULT_SETTINGS);
                setToast("Default flight settings restored.");
              }}
            >
              <RotateCcw size={14} />
              Restore defaults
            </button>
            <button className="dark-button" onClick={closeModal}>
              Back to flight
              <ArrowRight size={15} />
            </button>
          </div>
        </ModalShell>
      )}

      {modal === "guide" && (
        <ModalShell
          title="Every good pilot starts here."
          eyebrow="THE PILOT'S FIELD GUIDE"
          onClose={closeModal}
          wide
        >
          <div
            className="modal-tabs"
            role="tablist"
            aria-label="Pilot guide sections"
          >
            {(
              [
                { id: "start", label: "Your first flight", icon: Navigation },
                { id: "controls", label: "Controls", icon: Keyboard },
                { id: "physics", label: "Under the hood", icon: Gauge },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={guideTab === tab.id}
                className={guideTab === tab.id ? "active" : ""}
                onClick={() => setGuideTab(tab.id)}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
          {guideTab === "start" && (
            <div className="guide-content">
              <div className="guide-lead">
                <BrandMark />
                <p>
                  This is your place to make mistakes.
                  <br />
                  <strong>Start slow. Stay curious. Fly again.</strong>
                </p>
              </div>
              <div className="first-flight-steps">
                {[
                  [
                    "Make room to learn.",
                    "Choose Open Range, Angle mode, and zero wind. A controller is best, but your keyboard works too.",
                  ],
                  [
                    "Arm, then find your hover.",
                    "Click Arm & fly or press Space. Hold ↑ to increase throttle. Around 29% balances gravity; H sets that estimated thrust. Add a little more to climb.",
                  ],
                  [
                    "Small inputs. Smooth flight.",
                    "W/S pitches forward/back, A/D rolls, and Q/E turns. Tilt redirects thrust, so add throttle in turns. Angle mode levels the quad when you release the sticks.",
                  ],
                  [
                    "Come back in one piece. Or don’t.",
                    "Lower throttle gently with ↓ to land. Space disarms, P pauses, and R resets everything. Move to Acro when you are ready to manage attitude yourself.",
                  ],
                ].map(([title, text], i) => (
                  <div className="guide-step" key={title}>
                    <span>0{i + 1}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="info-note">
                <ShieldCheck size={17} />
                <span>
                  Practice transfers best with a real radio. This simulator
                  cannot certify real-world readiness. Use a spotter and follow
                  your local flight rules outdoors.
                </span>
              </div>
            </div>
          )}
          {guideTab === "controls" && (
            <div className="guide-content">
              <div className="control-reference">
                {[
                  [
                    "↑ / ↓",
                    "Throttle",
                    "Increase / decrease thrust. Holds its value when released.",
                  ],
                  ["W / S", "Pitch", "Tilt forward / backward."],
                  ["A / D", "Roll", "Tilt left / right."],
                  ["Q / E", "Yaw", "Rotate left / right."],
                  [
                    "Space",
                    "Arm / disarm",
                    "Start or stop the motors. Arming always starts at zero throttle.",
                  ],
                  [
                    "H",
                    "Hover thrust",
                    "Set estimated level-hover thrust. Not an altitude hold.",
                  ],
                  [
                    "P / Esc",
                    "Pause",
                    "Freeze physics. Press P or Resume to continue.",
                  ],
                  [
                    "R",
                    "Reset",
                    "Return to the launch pad with a fresh battery.",
                  ],
                  ["V", "Camera", "Cycle FPV, Chase, and Orbit views."],
                  [
                    "Drag / scroll",
                    "Orbit camera",
                    "Look around / zoom. Right-drag to pan.",
                  ],
                ].map(([key, title, description]) => (
                  <div key={key}>
                    <kbd>{key}</kbd>
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </div>
                ))}
              </div>
              <div className="info-note">
                <Gamepad2 size={17} />
                <span>
                  For gamepad and USB radio mappings, open Flight settings →
                  Controller. Touch controls appear below the viewport on
                  smaller screens.
                </span>
              </div>
            </div>
          )}
          {guideTab === "physics" && (
            <div className="guide-content physics-guide">
              <div className="physics-headline">
                <span>
                  240<small>Hz</small>
                </span>
                <div>
                  <h3>Flight dynamics. Not canned movement.</h3>
                  <p>
                    Fixed-step six-degree-of-freedom rigid-body integration in
                    SI units.
                  </p>
                </div>
              </div>
              <div className="physics-columns">
                <div>
                  <h3>What is modeled</h3>
                  <p>
                    Gravity at 9.81 m/s², mass and principal-axis inertia,
                    gyroscopic coupling, four independently lagged motors,
                    thrust and reaction torque, wind-relative linear and
                    quadratic drag, and body angular drag.
                  </p>
                  <p>
                    Acro commands body rotation rate. Angle mode commands a
                    limited tilt and self-levels. A bounded PD controller mixes
                    the required torque into individual motor thrust.
                  </p>
                </div>
                <div>
                  <h3>Where the model stops</h3>
                  <p>
                    Contacts use a sphere against ground and box colliders, not
                    individual propellers. Impacts above 6 m/s normal speed
                    disarm the aircraft. The terrain outside the flat practice
                    area is decorative.
                  </p>
                  <p>
                    Prop wash, ground effect, blade aerodynamics, turbulent
                    gusts, RF loss, and structural damage are not modeled.
                    Battery voltage and current are estimates and do not limit
                    thrust.
                  </p>
                </div>
              </div>
              <div className="info-note">
                <Info size={17} />
                <span>
                  No simulator reproduces every law of physics or every real
                  aircraft. This is an uncalibrated practice model, not
                  Betaflight firmware or an engineering-grade digital twin.
                  Visual weather and location are illustrative.
                </span>
              </div>
            </div>
          )}
          <div className="modal-actions">
            <span className="muted small-text">
              Confidence is built one battery at a time.
            </span>
            <button className="dark-button" onClick={closeModal}>
              Let's fly
              <ArrowRight size={15} />
            </button>
          </div>
        </ModalShell>
      )}

      {modal === "log" && (
        <ModalShell
          title="Progress, one flight at a time."
          eyebrow="YOUR FLIGHT LOG"
          onClose={closeModal}
          wide
        >
          {flights.length ? (
            <>
              <div className="log-summary">
                <div>
                  <span>FLIGHTS</span>
                  <strong>{flights.length.toString().padStart(2, "0")}</strong>
                </div>
                <div>
                  <span>STICK TIME</span>
                  <strong>
                    {formatTime(
                      flights.reduce((sum, f) => sum + f.duration, 0),
                    )}
                  </strong>
                </div>
                <div>
                  <span>DISTANCE</span>
                  <strong>
                    {(
                      flights.reduce((sum, f) => sum + f.distance, 0) / 1000
                    ).toFixed(2)}
                    <small> km</small>
                  </strong>
                </div>
              </div>
              <div className="flight-log-table">
                <div className="log-table-head">
                  <span>Flight</span>
                  <span>Time</span>
                  <span>Distance</span>
                  <span>Top speed</span>
                  <span>Result</span>
                </div>
                {flights.map((f) => (
                  <div className="log-row" key={f.id}>
                    <div>
                      <strong>{f.environment}</strong>
                      <small>
                        {new Date(f.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        · {f.mode.toUpperCase()}
                      </small>
                    </div>
                    <span className="mono">{formatTime(f.duration)}</span>
                    <span className="mono">{f.distance.toFixed(0)} m</span>
                    <span className="mono">
                      {(f.peakSpeed * 3.6).toFixed(1)} km/h
                    </span>
                    <span className={`result-tag ${f.crashed ? "impact" : ""}`}>
                      {f.crashed ? "Impact" : "Completed"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button
                  className={`text-button ${clearConfirm ? "danger-text" : ""}`}
                  onClick={() => {
                    if (clearConfirm) {
                      setFlights([]);
                      try {
                        localStorage.removeItem("fieldwork-flights");
                      } catch {
                        /* Optional persistence. */
                      }
                      setClearConfirm(false);
                    } else setClearConfirm(true);
                  }}
                >
                  {clearConfirm ? "Confirm: clear all flights" : "Clear log"}
                </button>
                <button className="dark-button" onClick={exportFlights}>
                  <ArrowDownToLine size={15} />
                  Export log
                </button>
              </div>
            </>
          ) : (
            <div className="empty-log">
              <span className="empty-log-icon">
                <Navigation size={31} strokeWidth={1.3} />
              </span>
              <h3>Your story is still on the launch pad.</h3>
              <p>
                Flights longer than one second are saved when you disarm, reset,
                or crash. Your last 50 flights stay in this browser.
              </p>
              <button className="dark-button" onClick={closeModal}>
                Make your first flight
                <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          <div className="log-privacy">
            <ShieldCheck size={13} />
            Stored on your device. No account. No tracking.
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function ArrowUpFromGround() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 14V3m0 0L6 7m4-4 4 4M4 17h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TouchControls({
  disabled,
  onStick,
}: {
  disabled: boolean;
  onStick: (pitch: number, roll: number, yaw: number) => void;
}) {
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const held = useRef({ pitch: 0, roll: 0, yaw: 0 });
  const send = (patch: Partial<typeof held.current>) => {
    Object.assign(held.current, patch);
    onStick(held.current.pitch, held.current.roll, held.current.yaw);
  };
  useEffect(() => {
    if (disabled) {
      held.current = { pitch: 0, roll: 0, yaw: 0 };
      setStick({ x: 0, y: 0 });
      onStick(0, 0, 0);
    }
  }, [disabled]);
  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      -1,
      Math.min(
        1,
        (event.clientX - rect.left - rect.width / 2) / (rect.width / 2),
      ),
    );
    const y = Math.max(
      -1,
      Math.min(
        1,
        (event.clientY - rect.top - rect.height / 2) / (rect.height / 2),
      ),
    );
    setStick({ x, y });
    send({ pitch: -y * 0.6, roll: x * 0.6 });
  };
  const release = () => {
    setStick({ x: 0, y: 0 });
    send({ pitch: 0, roll: 0 });
  };
  const releaseYaw = () => send({ yaw: 0 });
  return (
    <div className="touch-controls">
      <button
        disabled={disabled}
        aria-label="Yaw left"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          send({ yaw: -0.4 });
        }}
        onPointerUp={releaseYaw}
        onPointerCancel={releaseYaw}
      >
        <ArrowLeft size={17} />
      </button>
      <div
        className={`touch-stick ${disabled ? "disabled" : ""}`}
        role="group"
        aria-label="Touch joystick, drag for pitch and roll"
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          update(e);
        }}
        onPointerMove={update}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span
          style={{
            transform: `translate(${stick.x * 22}px, ${stick.y * 22}px)`,
          }}
        />
        <small>PITCH / ROLL</small>
      </div>
      <button
        disabled={disabled}
        aria-label="Yaw right"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          send({ yaw: 0.4 });
        }}
        onPointerUp={releaseYaw}
        onPointerCancel={releaseYaw}
      >
        <ArrowRight size={17} />
      </button>
    </div>
  );
}

export default App;
