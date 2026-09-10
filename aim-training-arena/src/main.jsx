import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crosshair,
  Flame,
  Focus,
  History,
  Layers3,
  Menu,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { createArena } from "./arena.js";
import "./styles.css";

const DRILLS = [
  {
    id: "gridshot",
    name: "Gridshot",
    category: "SPEED & PRECISION",
    description: "Find your rhythm. Hit the targets. Repeat.",
    tag: "The essential warm-up",
    icon: Crosshair,
    difficulty: "All levels",
    color: "green",
  },
  {
    id: "microflick",
    name: "Microflick",
    category: "CONTROL & ACCURACY",
    description: "Small adjustments. A big difference.",
    tag: "Make every pixel count",
    icon: Zap,
    difficulty: "Intermediate",
    color: "sand",
  },
  {
    id: "tracking",
    name: "Tracking",
    category: "CONSISTENCY & FOCUS",
    description: "Stay on target. Get into the flow.",
    tag: "Smooth is fast",
    icon: Focus,
    difficulty: "All levels",
    color: "lavender",
  },
];
const DEFAULT_SETTINGS = {
  sensitivity: 1,
  targetSize: 1,
  sound: true,
  duration: 60,
  crosshair: "cross",
};
const STORAGE_KEY = "deadset.progress.v1";
const SETTINGS_KEY = "deadset.settings.v1";
const fmt = (n) => Math.round(n || 0).toLocaleString();
const time = (n) => {
  const seconds = Math.ceil(Math.max(0, n));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const modeName = (id) =>
  DRILLS.find((drill) => drill.id === id)?.name || "Gridshot";

function readSaved(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSettings() {
  const saved = readSaved(SETTINGS_KEY, {});
  return {
    sensitivity: Number.isFinite(saved?.sensitivity)
      ? Math.min(3, Math.max(0.2, saved.sensitivity))
      : 1,
    targetSize: [0.7, 1, 1.3].includes(saved?.targetSize)
      ? saved.targetSize
      : 1,
    sound: typeof saved?.sound === "boolean" ? saved.sound : true,
    duration: [30, 60, 90].includes(saved?.duration) ? saved.duration : 60,
    crosshair: ["cross", "dot"].includes(saved?.crosshair)
      ? saved.crosshair
      : "cross",
  };
}

function Logo({ small = false }) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-symbol">
        <Crosshair size={26} strokeWidth={2.25} />
      </span>
      <span>
        deadset<span className="brand-period">.</span>
      </span>
    </div>
  );
}

function App() {
  const [page, setPage] = useState("overview");
  const [settings, setSettings] = useState(loadSettings);
  const [sessions, setSessions] = useState(() => {
    const saved = readSaved(STORAGE_KEY, []);
    return Array.isArray(saved)
      ? saved
          .filter(
            (s) =>
              s &&
              DRILLS.some((d) => d.id === s.mode) &&
              Number.isFinite(s.score) &&
              Number.isFinite(s.accuracy) &&
              Number.isFinite(s.elapsed) &&
              Number.isFinite(Date.parse(s.date)),
          )
          .slice(0, 200)
      : [];
  });
  const [modal, setModal] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState("");
  const [routineStep, setRoutineStep] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      setNotice(
        "Browser storage is unavailable. Settings will last for this visit.",
      );
    }
  }, [settings]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      setNotice(
        "Browser storage is full or unavailable. Your progress is saved for this visit.",
      );
    }
  }, [sessions]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function startSession(mode = "gridshot", step = null) {
    setModal(null);
    setResult(null);
    setRoutineStep(step);
    setSession({
      mode,
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      duration: settings.duration,
    });
  }
  function finishSession(value) {
    setSessions((previous) => [value, ...previous].slice(0, 200));
    setResult(value);
    setSession(null);
  }
  function navigate(next) {
    setPage(next);
    setMobileNav(false);
  }

  useEffect(() => {
    function onKey(event) {
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)
      )
        return;
      if (event.key === "Enter" && !session && !modal && !result) {
        event.preventDefault();
        startSession();
      }
      if (event.key === "?" && !session && !result) setModal("help");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, modal, result, settings.duration]);

  const today = new Date().toLocaleDateString("en-CA");
  const activeDays = new Set(
    sessions.map((s) => new Date(s.date).toLocaleDateString("en-CA")),
  );
  let streak = 0;
  const date = new Date();
  if (!activeDays.has(today)) date.setDate(date.getDate() - 1);
  for (
    let i = 0;
    i < 366 && activeDays.has(date.toLocaleDateString("en-CA"));
    i++
  ) {
    streak++;
    date.setDate(date.getDate() - 1);
  }

  return (
    <>
      <div className="app-shell" inert={Boolean(modal || session || result)}>
        {mobileNav && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
        )}
        <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
          <button
            className="brand-link"
            aria-label="Deadset home"
            onClick={() => navigate("overview")}
          >
            <Logo />
          </button>
          <div className="sidebar-section-label">YOUR WORKSPACE</div>
          <nav className="main-nav" aria-label="Main navigation">
            <NavItem
              icon={Crosshair}
              label="Training"
              active={page === "overview"}
              onClick={() => navigate("overview")}
            >
              <span className="nav-active-dot" />
            </NavItem>
            <NavItem
              icon={Layers3}
              label="My routines"
              active={page === "routines"}
              onClick={() => navigate("routines")}
            >
              <span className="nav-count">3</span>
            </NavItem>
            <NavItem
              icon={BarChart3}
              label="Statistics"
              active={page === "statistics"}
              onClick={() => navigate("statistics")}
            />
            <NavItem
              icon={History}
              label="Session history"
              active={page === "history"}
              onClick={() => navigate("history")}
            />
          </nav>
          <div className="sidebar-bottom">
            <div className="practice-note">
              <div className="note-illustration">
                <Crosshair size={38} strokeWidth={1.2} />
                <span className="orbit-dot" />
                <Sparkles className="note-spark" size={15} />
              </div>
              <h3>Progress, not perfection.</h3>
              <p>
                A few minutes today.
                <br />A little sharper tomorrow.
              </p>
              <span className="note-line" />
              <span className="note-label">SHOW UP. LOCK IN.</span>
            </div>
            <nav className="utility-nav" aria-label="Support and settings">
              <NavItem
                icon={Settings2}
                label="Settings"
                onClick={() => {
                  setModal("settings");
                  setMobileNav(false);
                }}
              />
              <NavItem
                icon={CircleHelp}
                label="How to play"
                onClick={() => {
                  setModal("help");
                  setMobileNav(false);
                }}
              >
                <kbd>?</kbd>
              </NavItem>
            </nav>
            <div className="player-profile">
              <div className="player-avatar">
                P<span />
              </div>
              <div>
                <strong>Player one</strong>
                <span>Your next best is ahead.</span>
              </div>
              <ShieldCheck size={17} />
            </div>
          </div>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMobileNav(true)}
              >
                <Menu size={21} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>
                {
                  {
                    overview: "Training",
                    routines: "My routines",
                    statistics: "Statistics",
                    history: "Session history",
                  }[page]
                }
              </strong>
            </div>
            <div className="topbar-right">
              <span className="local-status">
                <span />
                All systems focused
              </span>
              <span className="topbar-divider" />
              <button
                className="icon-button"
                onClick={() => setSettings((s) => ({ ...s, sound: !s.sound }))}
                aria-label={settings.sound ? "Mute sound" : "Enable sound"}
                title={settings.sound ? "Mute sound" : "Enable sound"}
              >
                {settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button
                className="help-top"
                aria-label="How to play"
                onClick={() => setModal("help")}
              >
                <CircleHelp size={18} />
              </button>
            </div>
          </header>

          <main className="main-content">
            {page === "overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      <span /> A LITTLE BETTER, EVERY DAY
                    </div>
                    <h1>Good aim isn&apos;t luck.</h1>
                    <p>
                      It&apos;s a habit. Make a little time for your next level.
                    </p>
                  </div>
                  <div className="streak-badge">
                    <Flame size={21} />
                    <div>
                      <strong>{streak} day streak</strong>
                      <span>
                        {streak
                          ? "Keep the momentum going"
                          : "A fresh start looks good on you"}
                      </span>
                    </div>
                  </div>
                </div>
                <section className="hero" aria-label="Start aim training">
                  {!session && <ArenaPreview />}
                  <div className="hero-shade" />
                  <div className="hero-content">
                    <span className="hero-eyebrow">
                      <span /> FIND YOUR FOCUS
                    </span>
                    <h2>
                      Less thinking.
                      <br />
                      More instinct.
                    </h2>
                    <p>
                      Build the muscle memory that makes
                      <br className="desktop-break" /> every shot feel
                      effortless.
                    </p>
                    <button
                      className="button button-lime"
                      onClick={() => startSession()}
                    >
                      Start training <ArrowUpRight size={19} />
                    </button>
                    <span className="hero-keyboard">
                      <kbd>↵</kbd> or press Enter to jump in
                    </span>
                  </div>
                  <span className="live-badge">
                    <span /> LIVE ARENA
                  </span>
                  <div className="hero-coordinate">
                    <Crosshair size={22} strokeWidth={1} />
                    <span>
                      THE RANGE <b> / </b> 01
                    </span>
                    <span className="coordinate-line" />
                  </div>
                </section>

                <section
                  className="drills-section"
                  aria-labelledby="drills-title"
                >
                  <div className="section-heading">
                    <div>
                      <h2 id="drills-title">
                        Pick your practice
                        <span className="number-badge">03</span>
                      </h2>
                      <p>Three ways to get one step ahead.</p>
                    </div>
                    <DurationPicker
                      value={settings.duration}
                      onChange={(duration) =>
                        setSettings((s) => ({ ...s, duration }))
                      }
                    />
                  </div>
                  <div className="drill-grid">
                    {DRILLS.map((drill, index) => (
                      <DrillCard
                        key={drill.id}
                        drill={drill}
                        index={index}
                        duration={settings.duration}
                        sessions={sessions}
                        onStart={() => startSession(drill.id)}
                      />
                    ))}
                  </div>
                </section>

                <section
                  className="progress-strip"
                  aria-label="Your progress at a glance"
                >
                  <div className="progress-intro">
                    <span className="progress-icon">
                      <BarChart3 size={21} />
                    </span>
                    <div>
                      <h3>Your work. Adding up.</h3>
                      <p>Every session is a step forward.</p>
                    </div>
                  </div>
                  <div className="mini-stat">
                    <span>SESSIONS PLAYED</span>
                    <strong>{String(sessions.length).padStart(2, "0")}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>AVERAGE ACCURACY</span>
                    <strong>
                      {sessions.length ? (
                        `${Math.round(sessions.reduce((n, s) => n + s.accuracy, 0) / sessions.length)}%`
                      ) : (
                        <>
                          &mdash;<small> %</small>
                        </>
                      )}
                    </strong>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("statistics")}
                  >
                    See your progress <ArrowUpRight size={16} />
                  </button>
                </section>
              </>
            )}

            {page === "routines" && (
              <Routines
                onStart={(mode, step) => startSession(mode, step)}
                duration={settings.duration}
              />
            )}
            {page === "statistics" && (
              <Statistics sessions={sessions} onStart={() => startSession()} />
            )}
            {page === "history" && (
              <SessionHistory
                sessions={sessions}
                onStart={() => startSession()}
                onSelect={setResult}
              />
            )}
            <footer className="page-footer">
              <span>
                <span className="footer-dot" /> BUILT FOR YOUR NEXT BEST.
              </span>
              <span>No downloads. No distractions. Just you.</span>
              <span>
                DEADSET <b>v.1.0</b>
              </span>
            </footer>
          </main>
        </div>
      </div>

      {modal && (
        <Modal
          title={
            modal === "settings"
              ? "Make it feel like you."
              : "Meet your new practice space."
          }
          eyebrow={modal === "settings" ? "YOUR SETUP" : "HOW TO PLAY"}
          onClose={() => setModal(null)}
        >
          {modal === "settings" ? (
            <Settings settings={settings} setSettings={setSettings} />
          ) : (
            <Help onStart={() => startSession()} />
          )}
        </Modal>
      )}
      {session && (
        <Game
          key={session.id}
          session={session}
          settings={settings}
          onSettings={setSettings}
          onFinish={finishSession}
          onExit={() => {
            setSession(null);
            setRoutineStep(null);
          }}
        />
      )}
      {result && (
        <Results
          result={result}
          sessions={sessions}
          onClose={() => {
            setResult(null);
            setRoutineStep(null);
          }}
          onRetry={() => startSession(result.mode, routineStep)}
          nextDrill={
            routineStep !== null && routineStep < 2
              ? DRILLS[routineStep + 1]
              : null
          }
          onNext={() =>
            startSession(DRILLS[routineStep + 1].id, routineStep + 1)
          }
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <CircleHelp size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}

function NavItem({ icon: Icon, label, active, onClick, children }) {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={18} strokeWidth={1.75} />
      <span>{label}</span>
      {children}
    </button>
  );
}

function ArenaPreview() {
  const canvas = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let arena;
    try {
      arena = createArena(canvas.current, {
        preview: true,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      });
    } catch {
      setUnavailable(true);
    }
    return () => arena?.dispose();
  }, []);
  return (
    <div className="arena-preview" aria-hidden="true">
      <canvas ref={canvas} />
      {unavailable && (
        <div className="fallback-range">
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}

function DurationPicker({ value, onChange }) {
  return (
    <div className="duration-control">
      <span>
        <Clock3 size={14} /> Session length
      </span>
      <div className="segmented" role="group" aria-label="Session duration">
        {[30, 60, 90].map((n) => (
          <button
            key={n}
            className={value === n ? "selected" : ""}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            {n}s
          </button>
        ))}
      </div>
    </div>
  );
}

function DrillArt({ type }) {
  return (
    <div className={`drill-art art-${type}`} aria-hidden="true">
      <svg viewBox="0 0 360 132" fill="none">
        <defs>
          <pattern
            id={`grid-${type}`}
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
          >
            <path d="M26 0H0V26" stroke="currentColor" strokeOpacity=".13" />
          </pattern>
          <radialGradient id={`ball-${type}`} cx=".32" cy=".22" r=".85">
            <stop
              stopColor={
                type === "microflick"
                  ? "#f8f3df"
                  : type === "tracking"
                    ? "#f2edff"
                    : "#f6ffde"
              }
            />
            <stop
              offset=".55"
              stopColor={
                type === "microflick"
                  ? "#d4c79b"
                  : type === "tracking"
                    ? "#b8a8d9"
                    : "#bedb82"
              }
            />
            <stop
              offset="1"
              stopColor={
                type === "microflick"
                  ? "#9c906d"
                  : type === "tracking"
                    ? "#7d6c9c"
                    : "#6b914f"
              }
            />
          </radialGradient>
          <filter
            id={`shadow-${type}`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect width="360" height="132" fill={`url(#grid-${type})`} />
        {type === "gridshot" && (
          <>
            <path
              d="M130 42H230V90H130Z"
              stroke="#5f7e50"
              strokeDasharray="3 5"
              strokeOpacity=".28"
            />
            {[
              [130, 42, 17],
              [230, 42, 17],
              [180, 91, 17],
            ].map(([x, y, r], i) => (
              <g key={i}>
                <ellipse
                  cx={x + 2}
                  cy={y + 20}
                  rx={r}
                  ry="5"
                  fill="#5e7446"
                  opacity=".18"
                  filter="url(#shadow-gridshot)"
                />
                <circle cx={x} cy={y} r={r} fill="url(#ball-gridshot)" />
                <circle
                  cx={x}
                  cy={y}
                  r="8"
                  stroke="#6c8b4f"
                  strokeWidth="1.2"
                />
                <circle cx={x} cy={y} r="2.5" fill="#577840" />
              </g>
            ))}
          </>
        )}
        {type === "microflick" && (
          <>
            <circle
              cx="180"
              cy="66"
              r="42"
              stroke="#99855e"
              strokeOpacity=".25"
              strokeDasharray="3 6"
            />
            <path
              d="M130 66H160M180 16V45M180 87V116M201 66H231"
              stroke="#8d7c57"
              strokeOpacity=".65"
            />
            <path d="M183 62L211 44" stroke="#927c45" strokeDasharray="3 3" />
            <circle cx="217" cy="39" r="12" fill="url(#ball-microflick)" />
            <circle cx="217" cy="39" r="5" stroke="#9e8a58" />
            <circle cx="180" cy="66" r="8" stroke="#7b6d4b" strokeWidth="1.5" />
            <circle cx="180" cy="66" r="2" fill="#7b6d4b" />
          </>
        )}
        {type === "tracking" && (
          <>
            <path
              d="M88 81C120 81 114 36 151 42S179 97 210 85 228 45 270 51"
              stroke="#8b7fa5"
              strokeOpacity=".55"
              strokeWidth="1.5"
              strokeDasharray="4 5"
            />
            <circle
              cx="128"
              cy="51"
              r="17"
              stroke="#a698be"
              strokeOpacity=".2"
            />
            <circle
              cx="144"
              cy="44"
              r="17"
              stroke="#a698be"
              strokeOpacity=".3"
            />
            <circle
              cx="162"
              cy="46"
              r="17"
              stroke="#a698be"
              strokeOpacity=".4"
            />
            <circle cx="181" cy="62" r="19" fill="url(#ball-tracking)" />
            <circle cx="181" cy="62" r="9" stroke="#8d7aa7" />
            <circle cx="181" cy="62" r="3" fill="#75628d" />
            <path
              d="M264 45L272 51 265 57"
              stroke="#8b7fa5"
              strokeWidth="1.5"
            />
          </>
        )}
        <path
          d="M13 21V13H21M339 13H347V21M13 111V119H21M339 119H347V111"
          stroke="currentColor"
          strokeOpacity=".25"
        />
      </svg>
      <span className="art-mode-label">
        {type === "gridshot"
          ? "01 / FIND YOUR RHYTHM"
          : type === "microflick"
            ? "02 / DIAL IT IN"
            : "03 / STAY WITH IT"}
      </span>
    </div>
  );
}

function DrillCard({ drill, index, duration, sessions, onStart }) {
  const best = Math.max(
    0,
    ...sessions
      .filter((s) => s.mode === drill.id && s.duration === duration)
      .map((s) => s.score),
  );
  return (
    <button
      className={`drill-card drill-${drill.color}`}
      onClick={onStart}
      aria-label={`Start ${drill.name}, ${duration} second session`}
    >
      <DrillArt type={drill.id} />
      <div className="drill-info">
        <div className="drill-category">
          {drill.category}
          <span>0{index + 1}</span>
        </div>
        <div className="drill-title-row">
          <h3>{drill.name}</h3>
          <span className="drill-launch">
            <ArrowUpRight size={18} />
          </span>
        </div>
        <p>{drill.description}</p>
        <div className="drill-meta">
          <span>
            <Clock3 size={12} /> {duration} sec <i /> {drill.difficulty}
          </span>
          <span className="drill-best">
            {best ? (
              <>
                <Trophy size={12} /> {fmt(best)}
              </>
            ) : (
              <>
                <span className="tiny-dot" /> Ready to play
              </>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}

function Routines({ onStart, duration }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> A LITTLE STRUCTURE GOES A LONG WAY
          </div>
          <h1>Find your daily rhythm.</h1>
          <p>Less deciding. More doing. A routine for every kind of session.</p>
        </div>
      </div>
      <div className="routine-feature">
        <div className="routine-icon">
          <Layers3 size={40} strokeWidth={1.2} />
        </div>
        <span className="hero-eyebrow">THE COMPLETE RESET</span>
        <h2>
          Three drills.
          <br />
          One sharper you.
        </h2>
        <p>
          Wake up your reflexes, dial in your precision, and finish in the flow.
          <br />
          Your daily practice, all lined up.
        </p>
        <div className="routine-steps">
          {DRILLS.map((drill, index) => (
            <React.Fragment key={drill.id}>
              <span>
                <b>0{index + 1}</b>
                {drill.name}
                <small>{duration}s</small>
              </span>
              {index < 2 && <ArrowRight size={16} />}
            </React.Fragment>
          ))}
        </div>
        <button
          className="button button-lime"
          onClick={() => onStart("gridshot", 0)}
        >
          Start daily routine <ArrowUpRight size={18} />
        </button>
        <span className="routine-time">
          <Clock3 size={14} /> {(duration * 3) / 60} minutes of focused practice
        </span>
      </div>
      <div className="section-heading">
        <div>
          <h2>Keep it focused</h2>
          <p>Sometimes, one thing is the right thing.</p>
        </div>
      </div>
      <div className="routine-grid">
        {DRILLS.map((drill) => (
          <div
            className={`focused-routine drill-${drill.color}`}
            key={drill.id}
          >
            <drill.icon size={25} />
            <h3>{drill.tag}</h3>
            <p>{drill.description}</p>
            <button
              className="text-button"
              onClick={() => onStart(drill.id, null)}
            >
              Practice {drill.name} <ArrowUpRight size={17} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function Statistics({ sessions, onStart }) {
  const [filter, setFilter] = useState("all");
  const filtered = sessions.filter(
    (s) => filter === "all" || s.mode === filter,
  );
  const best = Math.max(0, ...filtered.map((s) => s.score));
  const average = filtered.length
    ? filtered.reduce((n, s) => n + s.accuracy, 0) / filtered.length
    : 0;
  const totalTime = filtered.reduce((n, s) => n + s.elapsed, 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> THE BIGGER PICTURE
          </div>
          <h1>Small steps. Real progress.</h1>
          <p>Your practice tells a story. Here&apos;s where you are.</p>
        </div>
        <select
          className="filter-select"
          value={filter}
          aria-label="Filter statistics by drill"
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All drills</option>
          {DRILLS.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Sessions played",
            value: String(filtered.length).padStart(2, "0"),
            icon: Layers3,
          },
          { label: "Personal best", value: fmt(best), icon: Trophy },
          {
            label: "Average accuracy",
            value: `${Math.round(average)}%`,
            icon: Target,
          },
          {
            label: "Time well spent",
            value: `${Math.round(totalTime / 60)} min`,
            icon: Clock3,
          },
        ].map(({ label, value, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <span>
              {label}
              <Icon size={18} />
            </span>
            <strong>{value}</strong>
            <small>
              {filtered.length
                ? "Across your saved sessions"
                : "Your story starts with one session"}
            </small>
          </div>
        ))}
      </div>
      <div className="chart-card">
        <div className="section-heading">
          <div>
            <h2>Finding your consistency</h2>
            <p>Accuracy across your last 20 sessions</p>
          </div>
          <span className="chart-legend">
            <span /> ACCURACY
          </span>
        </div>
        {filtered.length ? (
          <ProgressChart sessions={filtered.slice(0, 20).reverse()} />
        ) : (
          <EmptyState
            icon={BarChart3}
            title="Your progress belongs here."
            text="Complete your first session to start connecting the dots."
            onStart={onStart}
          />
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>A closer look</h2>
          <p>Different skills. One complete player.</p>
        </div>
      </div>
      <div className="mode-stats-grid">
        {DRILLS.map((drill) => {
          const values = sessions.filter((s) => s.mode === drill.id);
          return (
            <div className="mode-stat" key={drill.id}>
              <span className={`mode-stat-icon ${drill.color}`}>
                <drill.icon size={23} />
              </span>
              <h3>{drill.name}</h3>
              <div>
                <span>Sessions</span>
                <strong>{values.length}</strong>
              </div>
              <div>
                <span>Best score</span>
                <strong>
                  {fmt(Math.max(0, ...values.map((s) => s.score)))}
                </strong>
              </div>
              <div>
                <span>Best accuracy</span>
                <strong>
                  {values.length
                    ? Math.round(Math.max(...values.map((s) => s.accuracy)))
                    : 0}
                  %
                </strong>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ProgressChart({ sessions }) {
  const points = sessions.map(
    (s, i) =>
      `${sessions.length === 1 ? 450 : 40 + (i / (sessions.length - 1)) * 830},${205 - s.accuracy * 1.7}`,
  );
  return (
    <div className="progress-chart">
      <svg
        viewBox="0 0 910 240"
        role="img"
        aria-label={`Accuracy chart for ${sessions.length} sessions. Latest accuracy ${Math.round(sessions.at(-1).accuracy)} percent.`}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#afcf75" stopOpacity=".3" />
            <stop offset="1" stopColor="#afcf75" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((n) => (
          <g key={n}>
            <line
              x1="40"
              x2="880"
              y1={205 - n * 1.7}
              y2={205 - n * 1.7}
              stroke="#e5e6df"
              strokeDasharray="4 5"
            />
            <text x="5" y={209 - n * 1.7} fontSize="10" fill="#92958a">
              {n}%
            </text>
          </g>
        ))}
        {sessions.length > 1 && (
          <>
            <polygon
              points={`40,205 ${points.join(" ")} 870,205`}
              fill="url(#chart-fill)"
            />
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke="#638542"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </>
        )}
        {points.map((point, i) => (
          <circle
            key={i}
            cx={point.split(",")[0]}
            cy={point.split(",")[1]}
            r="4"
            fill="#638542"
            stroke="#fff"
            strokeWidth="2"
          >
            <title>
              {modeName(sessions[i].mode)}: {Math.round(sessions[i].accuracy)}%
              accuracy
            </title>
          </circle>
        ))}
        <text x="40" y="233" fill="#92958a" fontSize="10">
          FIRST SESSION
        </text>
        <text x="824" y="233" fill="#92958a" fontSize="10">
          LATEST
        </text>
      </svg>
    </div>
  );
}

function SessionHistory({ sessions, onStart, onSelect }) {
  const [filter, setFilter] = useState("all");
  const filtered = sessions.filter(
    (s) => filter === "all" || s.mode === filter,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> EVERY REP COUNTS
          </div>
          <h1>A record of showing up.</h1>
          <p>
            Your recent sessions, saved on this device. All part of the process.
          </p>
        </div>
        <select
          className="filter-select"
          value={filter}
          aria-label="Filter history by drill"
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All drills</option>
          {DRILLS.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="history-card">
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>DRILL</th>
                  <th>WHEN</th>
                  <th>SCORE</th>
                  <th>ACCURACY</th>
                  <th>DURATION</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className={`history-mode ${s.mode}`}>
                        <Crosshair size={16} />
                        {modeName(s.mode)}
                      </span>
                    </td>
                    <td>
                      {new Date(s.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                      <small>
                        {new Date(s.date).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </td>
                    <td className="score-cell">{fmt(s.score)}</td>
                    <td>{Math.round(s.accuracy)}%</td>
                    <td>{Math.round(s.elapsed)}s</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${modeName(s.mode)} session from ${new Date(s.date).toLocaleString()}`}
                        onClick={() => onSelect(s)}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={History}
            title="Your first rep is waiting."
            text={
              filter === "all"
                ? "Jump into the range. We will take care of keeping track."
                : `No ${modeName(filter)} sessions yet. Try a new drill from Training.`
            }
            onStart={onStart}
          />
        )}
      </div>
      <div className="storage-note">
        <ShieldCheck size={15} />
        Your data stays yours. Progress is stored locally in this browser.
      </div>
    </>
  );
}

function EmptyState({ icon: Icon, title, text, onStart }) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={30} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="button button-dark" onClick={onStart}>
        Let&apos;s put in a rep <ArrowUpRight size={17} />
      </button>
    </div>
  );
}

function Modal({ title, eyebrow, onClose, children, className = "" }) {
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const items = panel.current?.querySelectorAll(
          'button:not([disabled]), input, select, a[href], [tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal-panel ${className}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <button
          className="modal-close icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
        <div className="eyebrow">
          <span /> {eyebrow}
        </div>
        <h2 id="modal-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}

function Settings({ settings, setSettings }) {
  const update = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  return (
    <div className="settings-content">
      <p className="modal-description">
        Your range, your rules. Changes are saved automatically.
      </p>
      <div className="setting-row">
        <div>
          <label htmlFor="sensitivity">Mouse sensitivity</label>
          <p>Find the speed that feels natural.</p>
        </div>
        <span className="setting-value">
          {settings.sensitivity.toFixed(2)}
          <small> x</small>
        </span>
      </div>
      <input
        id="sensitivity"
        className="range-input"
        type="range"
        min="0.2"
        max="3"
        step="0.05"
        value={settings.sensitivity}
        onChange={(e) => update("sensitivity", Number(e.target.value))}
      />
      <div className="range-labels">
        <span>Steady & precise</span>
        <span>Fast & responsive</span>
      </div>
      <div className="setting-row">
        <div>
          <label>Target size</label>
          <p>Smaller targets, bigger challenge.</p>
        </div>
        <div className="segmented">
          {[
            [0.7, "Small"],
            [1, "Default"],
            [1.3, "Large"],
          ].map(([n, label]) => (
            <button
              key={n}
              className={settings.targetSize === n ? "selected" : ""}
              aria-pressed={settings.targetSize === n}
              onClick={() => update("targetSize", n)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div>
          <label>Crosshair</label>
          <p>Keep your focus front and center.</p>
        </div>
        <div className="segmented crosshair-options">
          <button
            aria-label="Cross crosshair"
            aria-pressed={settings.crosshair === "cross"}
            className={settings.crosshair === "cross" ? "selected" : ""}
            onClick={() => update("crosshair", "cross")}
          >
            <Plus size={18} />
          </button>
          <button
            aria-label="Dot crosshair"
            aria-pressed={settings.crosshair === "dot"}
            className={settings.crosshair === "dot" ? "selected" : ""}
            onClick={() => update("crosshair", "dot")}
          >
            <span className="crosshair-dot-preview" />
          </button>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <label>Sound effects</label>
          <p>A little feedback with every hit.</p>
        </div>
        <button
          className={`toggle ${settings.sound ? "on" : ""}`}
          role="switch"
          aria-checked={settings.sound}
          aria-label="Sound effects"
          onClick={() => update("sound", !settings.sound)}
        >
          <span />
        </button>
      </div>
      <div className="setting-duration">
        <DurationPicker
          value={settings.duration}
          onChange={(n) => update("duration", n)}
        />
      </div>
      <button
        className="text-button settings-reset"
        onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
      >
        <RotateCcw size={14} /> Reset to defaults
      </button>
    </div>
  );
}

function Help({ onStart }) {
  return (
    <div className="help-content">
      <p className="modal-description">
        No loadouts. No waiting room. Just you and the next target.
      </p>
      <div className="help-controls">
        <div>
          <span>
            <MousePointer2 size={23} />
          </span>
          <div>
            <strong>Look & aim</strong>
            <p>Move your mouse. On touch screens, drag the range.</p>
          </div>
          <kbd>MOUSE</kbd>
        </div>
        <div>
          <span>
            <Target size={23} />
          </span>
          <div>
            <strong>Take your shot</strong>
            <p>Click to shoot. Hold to follow the Tracking target.</p>
          </div>
          <kbd>CLICK</kbd>
        </div>
        <div>
          <span>
            <ArrowDownLeft size={23} />
          </span>
          <div>
            <strong>Find your position</strong>
            <p>Move around the range, or use the touch joystick.</p>
          </div>
          <kbd>W A S D</kbd>
        </div>
        <div>
          <span>
            <Pause size={23} />
          </span>
          <div>
            <strong>Take a breath</strong>
            <p>Escape pauses. R restarts your current session.</p>
          </div>
          <kbd>ESC</kbd>
        </div>
      </div>
      <div className="help-tip">
        <Sparkles size={18} />
        <p>
          <strong>Start slow. Speed follows.</strong> Focus on clean hits before
          chasing a high score. Consistency is the real win.
        </p>
      </div>
      <button className="button button-dark full-width" onClick={onStart}>
        Meet you in the range <ArrowUpRight size={18} />
      </button>
      <p className="help-footnote">
        For the best experience, use a mouse and allow pointer lock.
      </p>
    </div>
  );
}

function Game({ session, settings, onSettings, onFinish, onExit }) {
  const screen = useRef(null);
  const canvas = useRef(null);
  const arena = useRef(null);
  const [stats, setStats] = useState({
    score: 0,
    hits: 0,
    shots: 0,
    accuracy: 0,
    timeLeft: session.duration,
    combo: 0,
    phase: "ready",
    countdown: 3,
  });
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const callbacks = useRef({ onFinish, onExit });
  callbacks.current = { onFinish, onExit };
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const fireInterval = useRef(null);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const drill = DRILLS.find((d) => d.id === session.mode);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    screen.current?.querySelector(".button-lime")?.focus();
    try {
      arena.current = createArena(canvas.current, {
        ...settings,
        mode: session.mode,
        duration: session.duration,
        onUpdate: setStats,
        onFinish: (result) => callbacks.current.onFinish(result),
        onLockChange: setLocked,
      });
    } catch {
      setError(true);
    }
    function onKey(e) {
      if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        arena.current?.start();
      }
      if (e.key === "Tab") {
        const buttons = screen.current?.querySelectorAll(
          "canvas, button:not([disabled])",
        );
        if (!buttons?.length) return;
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !screen.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !screen.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(fireInterval.current);
      arena.current?.dispose();
      arena.current = null;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    arena.current?.setOptions({
      sound: settings.sound,
      sensitivity: settings.sensitivity,
      targetSize: settings.targetSize,
    });
  }, [settings.sound, settings.sensitivity, settings.targetSize]);

  function moveJoystick(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.max(
      -1,
      Math.min(1, (e.clientX - box.left - box.width / 2) / 32),
    );
    const y = Math.max(
      -1,
      Math.min(1, (e.clientY - box.top - box.height / 2) / 32),
    );
    setJoystick({ x: x * 25, y: y * 25 });
    arena.current?.setMove(x, -y);
  }
  function resetJoystick() {
    setJoystick({ x: 0, y: 0 });
    arena.current?.setMove(0, 0);
  }
  function fire(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    arena.current?.shoot();
    if (session.mode === "tracking") {
      clearInterval(fireInterval.current);
      fireInterval.current = setInterval(() => arena.current?.shoot(), 100);
    }
  }
  function stopFire() {
    clearInterval(fireInterval.current);
  }
  const overlay =
    error || ["ready", "paused", "countdown"].includes(stats.phase);

  return (
    <div
      className="game-screen"
      ref={screen}
      role="dialog"
      aria-modal="true"
      aria-label={`${drill.name} training arena`}
    >
      <canvas
        ref={canvas}
        className="game-canvas"
        tabIndex={0}
        aria-label="First-person aim training range. Move mouse to aim, click to shoot, WASD to move."
      />
      <div className="game-vignette" />
      <header className="game-top">
        <div className="game-brand">
          <Logo small />
          <span className="game-mode">
            {drill.name}
            <small>{session.duration}s SESSION</small>
          </span>
        </div>
        <div className="game-timer">
          <Clock3 size={17} />
          <span className={stats.timeLeft <= 10 ? "time-warning" : ""}>
            {time(stats.timeLeft)}
          </span>
        </div>
        <div className="game-top-actions">
          <button
            className="game-icon-button"
            aria-label={settings.sound ? "Mute sound" : "Enable sound"}
            onClick={() => onSettings((s) => ({ ...s, sound: !s.sound }))}
          >
            {settings.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="game-icon-button"
            aria-label="Pause session"
            disabled={overlay}
            onClick={() => arena.current?.pause()}
          >
            <Pause size={19} />
          </button>
          <button
            className="game-icon-button"
            aria-label="Leave arena"
            onClick={onExit}
          >
            <X size={21} />
          </button>
        </div>
      </header>
      <div className="game-scoreboard">
        <div>
          <span>SCORE</span>
          <strong>{fmt(stats.score)}</strong>
        </div>
        <i />
        <div>
          <span>ACCURACY</span>
          <strong>
            {Math.round(stats.accuracy)}
            <small>%</small>
          </strong>
        </div>
        <i />
        <div>
          <span>STREAK</span>
          <strong>
            {stats.combo}
            <small> x</small>
          </strong>
        </div>
      </div>
      {!overlay && (
        <>
          <div
            className={`crosshair crosshair-${settings.crosshair} ${Date.now() - stats.lastHitTime < 150 && stats.lastHit ? "hit" : ""}`}
          >
            <i />
            <i />
            <span />
          </div>
          {stats.combo >= 3 && (
            <div className="combo-feedback" key={Math.floor(stats.combo / 5)}>
              <Zap size={14} />
              {stats.combo >= 10 ? "IN THE ZONE" : "FINDING YOUR RHYTHM"}
            </div>
          )}
          {!locked && !isTouch && (
            <div className="lock-hint">
              Click the range to lock your mouse, or drag to aim.
            </div>
          )}
        </>
      )}
      <div className="game-bottom">
        <span>
          <span className="footer-dot" /> RANGE_01 <b>/</b> {drill.category}
        </span>
        <div>
          <span>
            <kbd>W A S D</kbd> Move
          </span>
          <span>
            <kbd>R</kbd> Restart
          </span>
          <span>
            <kbd>ESC</kbd> Pause
          </span>
        </div>
        <span>{settings.sensitivity.toFixed(2)} SENS</span>
      </div>
      {isTouch && !overlay && (
        <div className="touch-controls">
          <div
            className="touch-joystick"
            role="application"
            aria-label="Movement joystick"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              moveJoystick(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                moveJoystick(e);
            }}
            onPointerUp={resetJoystick}
            onPointerCancel={resetJoystick}
            onLostPointerCapture={resetJoystick}
          >
            <span
              style={{
                transform: `translate(${joystick.x}px, ${joystick.y}px)`,
              }}
            >
              <Plus size={20} />
            </span>
          </div>
          <span className="touch-hint">DRAG TO AIM</span>
          <button
            className="touch-fire"
            aria-label="Fire"
            onPointerDown={fire}
            onPointerUp={stopFire}
            onPointerCancel={stopFire}
            onLostPointerCapture={stopFire}
          >
            <Crosshair size={33} />
            <span>{session.mode === "tracking" ? "HOLD" : "FIRE"}</span>
          </button>
        </div>
      )}
      {overlay && (
        <div
          className={`game-overlay ${stats.phase === "countdown" && !error ? "countdown-overlay" : ""}`}
        >
          {error ? (
            <div className="game-dialog">
              <span className="game-dialog-icon">
                <CircleHelp size={30} />
              </span>
              <div className="hero-eyebrow">A QUICK TECHNICAL TIMEOUT</div>
              <h2>The range couldn&apos;t load.</h2>
              <p>
                This arena needs WebGL. Enable hardware acceleration in your
                browser, then give it another try.
              </p>
              <button className="button button-lime" onClick={onExit}>
                Back to training <ArrowLeft size={17} />
              </button>
            </div>
          ) : stats.phase === "countdown" ? (
            <div className="countdown-content">
              <span>FIND YOUR FOCUS</span>
              <strong key={stats.countdown}>{stats.countdown || "GO"}</strong>
              <p>
                {session.mode === "tracking"
                  ? "Hold to shoot. Stay with the target."
                  : "Breathe. Aim. Make it count."}
              </p>
            </div>
          ) : (
            <div className="game-dialog">
              <span className="game-dialog-icon">
                <drill.icon size={30} strokeWidth={1.5} />
              </span>
              <div className="hero-eyebrow">
                {stats.phase === "paused"
                  ? "A MOMENT TO RESET"
                  : `THE RANGE / ${drill.category}`}
              </div>
              <h2>
                {stats.phase === "paused"
                  ? "Take a breath."
                  : `Let's play ${drill.name}.`}
              </h2>
              <p>
                {stats.phase === "paused"
                  ? "Your session is right where you left it. Ready when you are."
                  : session.mode === "tracking"
                    ? "Hold fire and keep your crosshair on the moving target. Smooth, steady, focused."
                    : session.mode === "microflick"
                      ? "Small targets. Precise flicks. Take your time and make every adjustment count."
                      : "Three targets. One at a time. Find your rhythm and hit as many as you can."}
              </p>
              {stats.phase === "ready" && (
                <div className="ready-details">
                  <span>
                    <Clock3 size={15} />
                    {session.duration} seconds
                  </span>
                  <span>
                    <Target size={15} />
                    {drill.difficulty}
                  </span>
                </div>
              )}
              <button
                className="button button-lime full-width"
                onClick={() =>
                  stats.phase === "paused"
                    ? arena.current?.resume()
                    : arena.current?.start()
                }
              >
                <Play size={17} fill="currentColor" />
                {stats.phase === "paused"
                  ? "Back in the zone"
                  : "I’m ready. Let’s go."}
                <ArrowUpRight size={18} />
              </button>
              {stats.phase === "paused" && (
                <button
                  className="button button-game-secondary full-width"
                  onClick={() => arena.current?.start()}
                >
                  <RotateCcw size={16} />
                  Start fresh
                </button>
              )}
              <button className="game-back" onClick={onExit}>
                <ArrowLeft size={14} />
                Back to training
              </button>
              <span className="ready-footnote">
                {isTouch
                  ? "Drag to aim. Use the on-screen controls to move and shoot."
                  : "Click above to capture your mouse. Press Esc anytime to pause."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Results({ result, sessions, onClose, onRetry, nextDrill, onNext }) {
  const previous = sessions.filter(
    (s) =>
      s.id !== result.id &&
      s.mode === result.mode &&
      s.duration === result.duration,
  );
  const personalBest =
    result.score > 0 &&
    result.score >= Math.max(0, ...previous.map((s) => s.score));
  return (
    <Modal
      title={
        personalBest
          ? "A new kind of personal best."
          : result.hits
            ? "That’s one rep better."
            : "Showing up is step one."
      }
      eyebrow="SESSION COMPLETE"
      onClose={onClose}
      className="results-modal"
    >
      <div className={`result-emblem ${personalBest ? "is-best" : ""}`}>
        <Trophy size={35} strokeWidth={1.35} />
      </div>
      <div className="result-mode">
        {modeName(result.mode)}
        <span />
        {Math.round(result.elapsed)} second session
        {personalBest && (
          <b>
            <Sparkles size={12} /> PERSONAL BEST
          </b>
        )}
      </div>
      <div className="result-main-score">
        <span>YOUR SCORE</span>
        <strong>{fmt(result.score)}</strong>
        <p>
          {result.accuracy >= 85 && result.hits
            ? "Clean hits. Clear focus. Keep this feeling."
            : result.hits
              ? "A little more practice. A little more instinct."
              : "Find your target, settle your crosshair, and take a shot."}
        </p>
      </div>
      <div className="result-stats">
        <div>
          <Target size={18} />
          <strong>
            {Math.round(result.accuracy)}
            <small>%</small>
          </strong>
          <span>ACCURACY</span>
        </div>
        <div>
          <Crosshair size={18} />
          <strong>
            {result.hits}
            <small> / {result.shots}</small>
          </strong>
          <span>HITS / SHOTS</span>
        </div>
        <div>
          <Zap size={18} />
          <strong>
            {result.bestCombo}
            <small> x</small>
          </strong>
          <span>BEST STREAK</span>
        </div>
      </div>
      <div className="result-reaction">
        <Clock3 size={15} />
        <span>Average acquisition time</span>
        <strong>
          {result.reactionTime
            ? `${Math.round(result.reactionTime)} ms`
            : "No targets acquired"}
        </strong>
      </div>
      {nextDrill ? (
        <button className="button button-dark full-width" onClick={onNext}>
          Next up: {nextDrill.name}
          <ArrowRight size={17} />
        </button>
      ) : (
        <button className="button button-dark full-width" onClick={onRetry}>
          <RotateCcw size={16} />
          One more rep
          <ArrowUpRight size={17} />
        </button>
      )}
      <button className="result-close text-button" onClick={onClose}>
        Back to training <ArrowRight size={15} />
      </button>
      <div className="result-saved">
        <Check size={13} />
        Session added to your progress
      </div>
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(<App />);
