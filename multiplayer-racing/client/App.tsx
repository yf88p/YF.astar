import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Copy,
  Crown,
  Flag,
  Gamepad2,
  Gauge,
  Globe2,
  Home,
  Info,
  Link,
  Map,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  User,
  Users,
  Volume2,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { connection } from "./connection";
import {
  nameSchema,
  roomNameSchema,
  type RoomSettings,
  type RoomSummary,
  type TrackId,
} from "../shared/protocol";
import { TRACKS } from "../shared/tracks";
import { RacingWorld } from "./world";
import { TrackArt } from "./TrackArt";
import { CircuitMap, Race } from "./Race";
import { loadSettings, type Settings } from "./settings";

type Dialog = "create" | "join" | "settings" | "help" | "track" | null;
function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 39 36" aria-hidden="true">
        <path
          d="M0 32 18 2h8L8 32zm14 0 9-15 12 15H24l-3-5-3 5z"
          fill="currentColor"
        />
      </svg>
      <strong>APEX</strong>
      <span>
        ONLINE
        <br />
        RACING
      </span>
    </div>
  );
}
function Modal({
  title,
  eyebrow,
  children,
  close,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button, input, select, [tabindex="0"], a[href]',
          ) || []),
        ].filter((el) => !el.hasAttribute("disabled"));
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <button
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function Hero({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let world: RacingWorld;
    try {
      world = new RacingWorld(ref.current, "canyon", true);
    } catch {
      return;
    }
    let frame = 0;
    const loop = (time: number) => {
      world.renderHero(time, reducedMotion);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      world.dispose();
    };
  }, [reducedMotion]);
  return (
    <div className="hero-art" ref={ref}>
      <TrackArt track="canyon" />
    </div>
  );
}
function RoomRow({
  room,
  latency,
  join,
}: {
  room: RoomSummary;
  latency: number;
  join: (room: RoomSummary) => void;
}) {
  const active = room.state !== "lobby";
  return (
    <button
      className="room-row"
      onClick={() => join(room)}
      aria-label={`${active ? "Spectate" : "Join"} ${room.name}`}
    >
      <span className={`room-symbol ${room.track}`}>
        <Flag size={18} />
      </span>
      <span className="room-title">
        <strong>{room.name}</strong>
        <small>
          <i className={active ? "orange-dot" : "live-dot"} />
          {active
            ? room.state === "finished"
              ? "Finished"
              : "In race"
            : "In lobby"}
          <span className="room-bot-note">
            {room.bots > 0 && `${room.bots} practice bots`}
          </span>
        </small>
      </span>
      <span className="room-track">
        {TRACKS[room.track].name}
        <small>
          {room.laps} {room.laps === 1 ? "lap" : "laps"} <span>·</span>{" "}
          {room.region}
        </small>
      </span>
      <span className="room-players">
        <Users size={14} />
        <b>{String(room.players).padStart(2, "0")}</b>
        <small>/{String(room.capacity).padStart(2, "0")}</small>
      </span>
      <span className="room-ping">
        <Signal size={14} />
        {latency || "<1"}
        <small>ms</small>
      </span>
      <span className="room-arrow">
        <ArrowUpRight size={18} />
      </span>
    </button>
  );
}

export default function App() {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [settings, setSettings] = useState(loadSettings);
  const [page, setPage] = useState<"home" | "rooms" | "tracks">("home");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [trackId, setTrackId] = useState<TrackId>("canyon");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [roomName, setRoomName] = useState("My open grid");
  const [roomSettings, setRoomSettings] = useState<RoomSettings>({
    track: "canyon",
    laps: 3,
    capacity: 8,
    bots: 3,
  });
  const [joinCode, setJoinCode] = useState("");
  const [spectator, setSpectator] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [remapping, setRemapping] = useState<keyof Settings["bindings"] | null>(
    null,
  );
  const [mobileNav, setMobileNav] = useState(false);
  const urlJoined = useRef(false);
  const previousRoom = useRef<string | null>(null);
  const updateSettings = (next: Settings) => {
    setSettings(next);
    localStorage.setItem("apex-settings", JSON.stringify(next));
  };
  useEffect(() => {
    void connection.start(settings.name);
  }, []);
  useEffect(() => {
    if (state.status === "online" && !urlJoined.current) {
      urlJoined.current = true;
      const code = new URLSearchParams(location.search).get("room");
      if (
        code &&
        !state.resumed &&
        !state.room &&
        /^[a-z0-9]{4,12}$/i.test(code)
      )
        connection.send({
          type: "join",
          code: code.toUpperCase(),
          spectator: false,
        });
    }
  }, [state.status]);
  useEffect(() => {
    if (state.room && previousRoom.current !== state.room.code) {
      setDialog(null);
      setFormError("");
      history.replaceState(null, "", `?room=${state.room.code}`);
    } else if (!state.room && previousRoom.current)
      history.replaceState(null, "", location.pathname);
    previousRoom.current = state.room?.code || null;
  }, [state.room]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!remapping) return;
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setRemapping(null);
        return;
      }
      if (
        !/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right))$/.test(
          event.code,
        )
      )
        return;
      if (
        event.code === "KeyC" ||
        Object.entries(settings.bindings).some(
          ([key, value]) => key !== remapping && value === event.code,
        )
      ) {
        setFormError(
          "That key is already assigned or reserved for the camera. Choose another key.",
        );
        return;
      }
      updateSettings({
        ...settings,
        bindings: { ...settings.bindings, [remapping]: event.code },
      });
      setRemapping(null);
      setFormError("");
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [remapping, settings]);
  const open = (value: Dialog) => {
    setFormError("");
    setDialog(value);
  };
  const close = () => {
    setDialog(null);
    setRemapping(null);
    setFormError("");
  };
  const online = state.status === "online" || state.status === "degraded";
  const readyRooms = state.rooms.filter(
    (room) => room.state === "lobby" && room.players < room.capacity,
  );
  const filtered = state.rooms.filter(
    (room) =>
      (filter === "all" || room.track === filter) &&
      (!onlyAvailable ||
        (room.state === "lobby" && room.players < room.capacity)) &&
      `${room.name} ${room.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  const room = state.room;
  const inRace = room && room.state !== "lobby";
  const refresh = () => {
    connection.send({ type: "list" });
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 650);
  };
  const joinRoom = (room: RoomSummary) => {
    connection.send({
      type: "join",
      code: room.code,
      spectator: room.state !== "lobby" || room.players >= room.capacity,
    });
  };
  const create = () => {
    const name = roomNameSchema.safeParse(roomName);
    if (!name.success) {
      setFormError(
        "Use 1-40 letters, numbers, spaces, or simple punctuation for the room name.",
      );
      return;
    }
    connection.send({
      type: "create",
      name: name.data,
      settings: roomSettings,
    });
  };
  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}?room=${room?.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setNotice(`Share this room code: ${room?.code}`);
    }
  };
  const nav = (next: typeof page) => {
    if (room) {
      setNotice("Leave your current room to explore the paddock.");
      return;
    }
    setPage(next);
    setMobileNav(false);
  };
  const trackDetails = TRACKS[trackId];
  return (
    <>
      {inRace ? (
        <Race
          state={state}
          settings={settings}
          onSettings={() => open("settings")}
          updateSettings={updateSettings}
        />
      ) : (
        <div className="app-shell">
          <header className="topbar">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <button
              className="brand-button"
              aria-label="APEX home"
              onClick={() => nav("home")}
            >
              <Brand />
            </button>
            <div className="topbar-divider" />
            <span className="topbar-tagline">THE TRACK IS CALLING.</span>
            <div className="topbar-right">
              <div className={`server-status ${online ? "" : "warning"}`}>
                <i className={online ? "live-dot" : "orange-dot"} />
                {online ? "SERVERS ONLINE" : state.status.toUpperCase()}
                <span>V1.0</span>
              </div>
              <button
                className="icon-button help-button"
                aria-label="How to play"
                onClick={() => open("help")}
              >
                <CircleHelp size={19} />
              </button>
              <button
                className="profile-button"
                onClick={() => open("settings")}
              >
                <div className="avatar">
                  <User size={18} />
                </div>
                <span>
                  {settings.name}
                  <small>ROOKIE DRIVER</small>
                </span>
                <ChevronDown size={14} />
              </button>
            </div>
          </header>
          <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
            <div className="nav-main">
              <button
                className={page === "home" && !room ? "active" : ""}
                title="Paddock"
                aria-label="Paddock"
                onClick={() => nav("home")}
              >
                <Home size={21} />
                <span>PADDOCK</span>
              </button>
              <button
                className={page === "rooms" || room ? "active" : ""}
                title="Multiplayer"
                aria-label="Multiplayer rooms"
                onClick={() => nav("rooms")}
              >
                <Globe2 size={21} />
                <span>RACE</span>
              </button>
              <button
                className={page === "tracks" && !room ? "active" : ""}
                title="Circuits"
                aria-label="Explore circuits"
                onClick={() => nav("tracks")}
              >
                <Map size={21} />
                <span>CIRCUITS</span>
              </button>
              <div className="nav-rule" />
              <button
                title="Racing guide"
                aria-label="Racing guide"
                onClick={() => open("help")}
              >
                <Flag size={21} />
                <span>GUIDE</span>
              </button>
            </div>
            <div className="nav-bottom">
              <button
                title="Settings"
                aria-label="Settings"
                onClick={() => open("settings")}
              >
                <Settings2 size={21} />
              </button>
              <div className="sidebar-online">
                <span className="live-dot" />
                LIVE
              </div>
            </div>
          </aside>
          <main className="main-content">
            {room ? (
              <>
                <div className="page-heading">
                  <div>
                    <button
                      className="back-link"
                      onClick={() => connection.send({ type: "leave" })}
                    >
                      <ArrowLeft size={14} /> BACK TO PADDOCK
                    </button>
                    <h1>YOUR GRID. YOUR RACE.</h1>
                    <p>
                      Get everyone ready. Then let the racing do the talking.
                    </p>
                  </div>
                  <span className="outline-tag">
                    <span className="live-dot" /> PUBLIC LOBBY
                  </span>
                </div>
                <div
                  className="lobby-grid"
                  data-player-id={state.id}
                  data-room-code={room.code}
                >
                  <section className="panel lobby-circuit">
                    <div className="lobby-art">
                      <TrackArt track={room.settings.track} />
                      <span className="image-tag">
                        {TRACKS[room.settings.track].difficulty}
                      </span>
                    </div>
                    <div className="lobby-track-info">
                      <div className="eyebrow">THE CIRCUIT</div>
                      <h2>{TRACKS[room.settings.track].name}</h2>
                      <p>{TRACKS[room.settings.track].description}</p>
                      <div className="track-specs">
                        <span>
                          <Map size={15} />
                          {(TRACKS[room.settings.track].length / 1000).toFixed(
                            1,
                          )}{" "}
                          km
                        </span>
                        <span>
                          <Flag size={15} />
                          {room.settings.laps} laps
                        </span>
                        <span>
                          <Users size={15} />
                          {room.settings.capacity} seats
                        </span>
                      </div>
                    </div>
                    <div className="lobby-settings">
                      <div className="section-mini">
                        <Settings2 size={15} /> RACE SETUP{" "}
                        <span>
                          {room.hostId === state.id
                            ? "YOU ARE HOST"
                            : "HOST CONTROLLED"}
                        </span>
                      </div>
                      <div className="field-grid">
                        <label>
                          Circuit
                          <select
                            aria-label="Lobby track"
                            value={room.settings.track}
                            disabled={room.hostId !== state.id}
                            onChange={(e) =>
                              connection.send({
                                type: "settings",
                                settings: {
                                  ...room.settings,
                                  track: e.target.value as TrackId,
                                },
                              })
                            }
                          >
                            <option value="canyon">Sunset Canyon</option>
                            <option value="harbor">Neon Harbor</option>
                          </select>
                        </label>
                        <label>
                          Laps
                          <select
                            aria-label="Lobby laps"
                            value={room.settings.laps}
                            disabled={room.hostId !== state.id}
                            onChange={(e) =>
                              connection.send({
                                type: "settings",
                                settings: {
                                  ...room.settings,
                                  laps: Number(e.target.value),
                                },
                              })
                            }
                          >
                            {[1, 2, 3, 4, 5].map((i) => (
                              <option key={i}>{i}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Practice bots
                          <select
                            aria-label="Lobby bots"
                            value={room.settings.bots}
                            disabled={room.hostId !== state.id}
                            onChange={(e) =>
                              connection.send({
                                type: "settings",
                                settings: {
                                  ...room.settings,
                                  bots: Number(e.target.value),
                                },
                              })
                            }
                          >
                            {Array.from(
                              { length: room.settings.capacity },
                              (_, i) => (
                                <option key={i}>{i}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Capacity
                          <select
                            aria-label="Lobby capacity"
                            value={room.settings.capacity}
                            disabled={room.hostId !== state.id}
                            onChange={(e) =>
                              connection.send({
                                type: "settings",
                                settings: {
                                  ...room.settings,
                                  capacity: Number(e.target.value),
                                  bots: Math.min(
                                    room.settings.bots,
                                    Number(e.target.value) - 1,
                                  ),
                                },
                              })
                            }
                          >
                            {[2, 4, 6, 8].map((i) => (
                              <option key={i}>{i}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="field-note">
                        <ShieldCheck size={14} /> Bots, physics, and results run
                        on the server.
                      </p>
                    </div>
                  </section>
                  <section className="panel lobby-players">
                    <div className="lobby-room-title">
                      <div className="eyebrow">
                        PUBLIC ROOM <span> / </span> {room.region}
                      </div>
                      <h2>{room.name}</h2>
                      <div className="room-code">
                        <span>ROOM CODE</span>
                        <strong>{room.code}</strong>
                        <button className="text-button" onClick={copyLink}>
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? "Copied" : "Invite friends"}
                        </button>
                      </div>
                    </div>
                    <div className="roster-header">
                      <span>STARTING GRID</span>
                      <span>
                        {room.players.filter((p) => !p.spectator).length} /{" "}
                        {room.settings.capacity} DRIVERS
                      </span>
                    </div>
                    <div className="roster">
                      {room.players
                        .filter((p) => !p.spectator)
                        .map((player, index) => (
                          <div
                            className={`roster-player ${player.id === state.id ? "you" : ""}`}
                            key={player.id}
                          >
                            <span className="roster-number">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div
                              className="player-avatar"
                              style={
                                {
                                  "--player-color":
                                    player.id === state.id
                                      ? "#c9f35f"
                                      : player.color,
                                } as React.CSSProperties
                              }
                            >
                              {player.bot ? (
                                <Gamepad2 size={18} />
                              ) : (
                                <User size={18} />
                              )}
                            </div>
                            <span className="player-name">
                              <strong>
                                {player.name}{" "}
                                {player.id === state.id && <small>YOU</small>}
                                {player.id === room.hostId && (
                                  <Crown size={13} />
                                )}
                              </strong>
                              <small>
                                {player.bot
                                  ? "SERVER PRACTICE BOT"
                                  : !player.connected
                                    ? "RECONNECTING · 30S GRACE"
                                    : "HUMAN DRIVER"}
                              </small>
                            </span>
                            <span
                              className={`ready-state ${player.ready ? "is-ready" : ""}`}
                            >
                              {player.ready ? (
                                <CheckCheck size={16} />
                              ) : (
                                <span className="hollow-dot" />
                              )}
                              {player.ready ? "Ready" : "Not ready"}
                            </span>
                            {room.hostId === state.id &&
                              player.id !== state.id &&
                              !player.bot && (
                                <button
                                  className="icon-button"
                                  aria-label={`Remove ${player.name}`}
                                  onClick={() =>
                                    connection.send({
                                      type: "kick",
                                      playerId: player.id,
                                    })
                                  }
                                >
                                  <X size={14} />
                                </button>
                              )}
                          </div>
                        ))}
                      {Array.from(
                        {
                          length: Math.max(
                            0,
                            room.settings.capacity -
                              room.players.filter((p) => !p.spectator).length,
                          ),
                        },
                        (_, index) => (
                          <div className="roster-empty" key={index}>
                            <Plus size={17} />
                            <span>Open seat</span>
                            <small>WAITING FOR A DRIVER</small>
                          </div>
                        ),
                      )}
                    </div>
                    {room.players.some((p) => p.spectator) && (
                      <div className="spectators">
                        <Users size={14} /> Spectators:{" "}
                        {room.players
                          .filter((p) => p.spectator)
                          .map((p) => p.name)
                          .join(", ")}
                      </div>
                    )}
                    <div className="lobby-start">
                      <div>
                        <span className="live-dot" />
                        <p>
                          {room.players
                            .filter((p) => !p.spectator)
                            .every((p) => p.ready && p.connected)
                            ? "The grid is ready."
                            : "Waiting for drivers to ready up."}
                          <small>
                            Everyone starts on the same server tick.
                          </small>
                        </p>
                      </div>
                      <div className="lobby-start-buttons">
                        {!room.players.find((p) => p.id === state.id)
                          ?.spectator && (
                          <button
                            className={`button ${room.players.find((p) => p.id === state.id)?.ready ? "secondary" : "primary"}`}
                            onClick={() =>
                              connection.send({
                                type: "ready",
                                ready: !room.players.find(
                                  (p) => p.id === state.id,
                                )?.ready,
                              })
                            }
                          >
                            {room.players.find((p) => p.id === state.id)
                              ?.ready ? (
                              <>
                                <Check size={17} /> Ready
                              </>
                            ) : (
                              <>
                                Ready up <CheckCircle2 size={17} />
                              </>
                            )}
                          </button>
                        )}
                        {room.hostId === state.id && (
                          <button
                            className="button primary"
                            disabled={
                              !room.players
                                .filter((p) => !p.spectator)
                                .every((p) => p.ready && p.connected) ||
                              room.players.filter((p) => !p.spectator).length <
                                2
                            }
                            onClick={() => connection.send({ type: "start" })}
                          >
                            Start race <ArrowRight size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
                <div className="fair-play-note">
                  <ShieldCheck size={17} />
                  <span>Real drivers. Real competition.</span>{" "}
                  Server-authoritative racing, fair checkpoints, and no
                  shortcuts.
                </div>
              </>
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      {page === "home"
                        ? "GOOD TO SEE YOU, DRIVER"
                        : page === "rooms"
                          ? "REAL PEOPLE. REAL RACING."
                          : "LEARN THE LINE. OWN THE CORNER."}
                    </div>
                    <h1>
                      {page === "home"
                        ? "WELCOME TO THE PADDOCK."
                        : page === "rooms"
                          ? "FIND YOUR GRID."
                          : "TWO CIRCUITS. NO LIMITS."}
                    </h1>
                  </div>
                  <div className="season-label">
                    <span className="season-mark">01</span>
                    <div>
                      THE OPEN ROAD
                      <small>
                        SEASON ONE <span> / </span> NOW LIVE
                      </small>
                    </div>
                    <ArrowUpRight size={18} />
                  </div>
                </div>
                {page === "home" && (
                  <section className="hero">
                    <Hero reducedMotion={settings.reducedMotion} />
                    <div className="hero-shade" />
                    <div className="hero-content">
                      <div className="hero-label">
                        <span /> NO DOWNLOAD. JUST DRIVE.
                      </div>
                      <h2>
                        FIND YOUR
                        <br />
                        NEXT <em>GEAR.</em>
                      </h2>
                      <p>
                        Good rivals. Great roads. One more lap.
                        <br />
                        Real-time multiplayer racing, right in your browser.
                      </p>
                      <div className="hero-buttons">
                        <button
                          className="button primary"
                          disabled={!online}
                          onClick={() => connection.send({ type: "quickJoin" })}
                        >
                          <Zap size={17} fill="currentColor" /> Quick race{" "}
                          <ArrowUpRight size={18} />
                        </button>
                        <button
                          className="button hero-secondary"
                          onClick={() => setPage("rooms")}
                        >
                          Explore rooms <ArrowRight size={16} />
                        </button>
                      </div>
                      <div className="hero-proof">
                        <span>
                          <Globe2 size={14} /> LIVE MULTIPLAYER
                        </span>
                        <i />
                        <span>
                          <Gamepad2 size={14} /> KEYBOARD + GAMEPAD
                        </span>
                      </div>
                    </div>
                    <div className="hero-circuit-label">
                      <span className="small-cross">+</span>
                      <div>
                        36° 14' N / 112° 08' W
                        <small>SUNSET CANYON, ARIZONA</small>
                      </div>
                      <span className="circuit-line" />
                      <span>
                        01 <small>/ 02</small>
                      </span>
                    </div>
                    <div className="hero-top-note">
                      <span className="live-dot" /> BUILT FOR THE CHASE
                    </div>
                  </section>
                )}
                {page !== "tracks" && (
                  <div
                    className={`discovery-grid ${page === "rooms" ? "full-browser" : ""}`}
                  >
                    <section className="rooms-section">
                      <div className="section-heading">
                        <div>
                          <h2>
                            <Radio size={18} /> LIVE ROOMS{" "}
                            <span>{state.rooms.length}</span>
                          </h2>
                          <p>Your next rivalry is one click away.</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => open("join")}
                        >
                          <Link size={14} /> Join with code
                        </button>
                      </div>
                      <div className="rooms-toolbar">
                        <div className="room-tabs">
                          <button
                            className={!onlyAvailable ? "selected" : ""}
                            onClick={() => setOnlyAvailable(false)}
                          >
                            All rooms
                          </button>
                          <button
                            className={onlyAvailable ? "selected" : ""}
                            onClick={() => setOnlyAvailable(true)}
                          >
                            Available <span>{readyRooms.length}</span>
                          </button>
                        </div>
                        <div className="room-filters">
                          {page === "rooms" && (
                            <label className="room-search">
                              <Search size={14} />
                              <input
                                placeholder="Find a room..."
                                aria-label="Search rooms"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                              />
                            </label>
                          )}
                          <label className="track-filter">
                            <SlidersHorizontal size={13} />
                            <select
                              aria-label="Filter by track"
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                            >
                              <option value="all">All tracks</option>
                              <option value="canyon">Sunset Canyon</option>
                              <option value="harbor">Neon Harbor</option>
                            </select>
                            <ChevronDown size={12} />
                          </label>
                          <button
                            className={`icon-button refresh ${refreshing ? "spinning" : ""}`}
                            aria-label="Refresh rooms"
                            onClick={refresh}
                            disabled={!online}
                          >
                            <RefreshCw size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="room-table">
                        <div className="room-table-head">
                          <span>ROOM NAME</span>
                          <span>CIRCUIT</span>
                          <span>DRIVERS</span>
                          <span>PING</span>
                          <ArrowDownUp size={11} />
                        </div>
                        {!online && state.rooms.length === 0 ? (
                          <div className="empty-state">
                            <Wifi size={25} />
                            <strong>
                              {state.status === "offline"
                                ? "The server is unavailable"
                                : "Connecting to the paddock..."}
                            </strong>
                            <p>Finding live rooms on the racing server.</p>
                            <button
                              className="text-button"
                              onClick={connection.reconnect}
                            >
                              Try connecting again <RefreshCw size={13} />
                            </button>
                          </div>
                        ) : filtered.length ? (
                          filtered
                            .slice(0, page === "home" ? 4 : 100)
                            .map((room) => (
                              <RoomRow
                                key={room.code}
                                room={room}
                                latency={state.latency}
                                join={joinRoom}
                              />
                            ))
                        ) : (
                          <div className="empty-state">
                            <Flag size={26} />
                            <strong>
                              {search || filter !== "all"
                                ? "No rooms match your filters"
                                : "An open road. An empty grid."}
                            </strong>
                            <p>
                              {search || filter !== "all"
                                ? "Try another circuit or clear your search."
                                : "Create a public room and start something good."}
                            </p>
                            <button
                              className="text-button"
                              onClick={() => {
                                if (search || filter !== "all") {
                                  setSearch("");
                                  setFilter("all");
                                  setOnlyAvailable(false);
                                } else open("create");
                              }}
                            >
                              {search || filter !== "all"
                                ? "Clear filters"
                                : "Create the first room"}{" "}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="rooms-footer">
                        <span>
                          <ShieldCheck size={14} />
                          {online
                            ? "Public grids. Fair racing. Always live."
                            : "Waiting for server connection"}
                        </span>
                        <button
                          className="button create-room"
                          disabled={!online}
                          onClick={() => open("create")}
                        >
                          <Plus size={15} /> Create room
                        </button>
                      </div>
                    </section>
                    {page === "home" && (
                      <section className="circuits-section">
                        <div className="section-heading">
                          <div>
                            <h2>KNOW YOUR CIRCUIT</h2>
                            <p>Different roads. Same adrenaline.</p>
                          </div>
                          <button
                            className="round-link"
                            onClick={() => setPage("tracks")}
                            aria-label="View all circuits"
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </div>
                        {(["canyon", "harbor"] as TrackId[]).map(
                          (id, index) => (
                            <button
                              className={`circuit-card ${id}`}
                              key={id}
                              onClick={() => {
                                setTrackId(id);
                                open("track");
                              }}
                            >
                              <TrackArt track={id} />
                              <div className="circuit-card-shade" />
                              <div className="circuit-card-top">
                                <span>
                                  {index === 0
                                    ? "THE GOLDEN HOUR"
                                    : "AFTER DARK"}
                                </span>
                                <span>0{index + 1}</span>
                              </div>
                              <div className="circuit-card-bottom">
                                <div>
                                  <h3>{TRACKS[id].name}</h3>
                                  <span>
                                    {(TRACKS[id].length / 1000).toFixed(1)} KM{" "}
                                    <i />{" "}
                                    {id === "canyon"
                                      ? "SWEEPING CORNERS"
                                      : "TECHNICAL TURNS"}
                                  </span>
                                </div>
                                <span className="circuit-card-arrow">
                                  <ArrowUpRight size={16} />
                                </span>
                              </div>
                            </button>
                          ),
                        )}
                      </section>
                    )}
                  </div>
                )}
                {page === "tracks" && (
                  <div className="track-gallery">
                    {(["canyon", "harbor"] as TrackId[]).map((id) => (
                      <section className="panel track-detail-card" key={id}>
                        <div className="track-gallery-art">
                          <TrackArt track={id} />
                          <span className="image-tag">
                            {TRACKS[id].difficulty}
                          </span>
                        </div>
                        <div className="track-detail-content">
                          <div className="eyebrow">{TRACKS[id].subtitle}</div>
                          <h2>{TRACKS[id].name}</h2>
                          <p>{TRACKS[id].description}</p>
                          <div className="track-detail-map">
                            <CircuitMap trackId={id} />
                            <div>
                              <strong>
                                {(TRACKS[id].length / 1000).toFixed(1)}
                                <small> KM</small>
                              </strong>
                              <span>
                                {TRACKS[id].checkpoints.length} validated
                                checkpoints
                              </span>
                              <span>{TRACKS[id].width}m road width</span>
                              <span>
                                {id === "canyon"
                                  ? "Dry asphalt / high grip"
                                  : "Wet asphalt / low grip"}
                              </span>
                            </div>
                          </div>
                          <button
                            className="button primary"
                            disabled={!online}
                            onClick={() => {
                              setRoomSettings({ ...roomSettings, track: id });
                              open("create");
                            }}
                          >
                            Race this circuit <ArrowUpRight size={17} />
                          </button>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
                {page === "home" && (
                  <div className="bottom-strip">
                    <div className="bottom-strip-icon">
                      <Users size={24} />
                    </div>
                    <div>
                      <h3>BETTER WITH A LITTLE COMPETITION.</h3>
                      <p>
                        Create a room. Share the code. Settle it on the track.
                      </p>
                    </div>
                    <button
                      className="text-button"
                      disabled={!online}
                      onClick={() => open("create")}
                    >
                      Bring your crew <ArrowUpRight size={16} />
                    </button>
                    <div className="strip-divider" />
                    <span className="no-install">
                      <CheckCircle2 size={16} />
                      Free to play. Nothing to install.
                    </span>
                  </div>
                )}
                <footer className="footer">
                  <span>
                    © 2026 APEX RACING <i /> MADE FOR THE LOVE OF THE DRIVE.
                  </span>
                  <div>
                    <span className="live-dot" />
                    {online
                      ? `ALL SYSTEMS GO · ${state.latency || "<1"} MS`
                      : "CONNECTING TO RACE CONTROL"}
                    <button onClick={() => open("help")}>
                      How to play <ArrowUpRight size={11} />
                    </button>
                  </div>
                </footer>
              </>
            )}
          </main>
        </div>
      )}
      {dialog === "create" && (
        <Modal
          title="MAKE ROOM FOR RIVALRY."
          eyebrow="YOUR ROOM. YOUR RULES."
          close={close}
        >
          <p className="modal-intro">
            An open grid for friends, new rivals, and a few capable bots.
            Visible to everyone on this server.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <label>
              Room name
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={40}
                placeholder="Give your grid a name"
                autoComplete="off"
                required
              />
            </label>
            <div className="create-track-picker">
              {(["canyon", "harbor"] as TrackId[]).map((id) => (
                <button
                  type="button"
                  className={roomSettings.track === id ? "selected" : ""}
                  key={id}
                  onClick={() =>
                    setRoomSettings({ ...roomSettings, track: id })
                  }
                >
                  <TrackArt track={id} />
                  <span>
                    {TRACKS[id].name}
                    {roomSettings.track === id && <CheckCircle2 size={15} />}
                  </span>
                </button>
              ))}
            </div>
            <div className="field-grid three">
              <label>
                Laps
                <select
                  aria-label="Laps"
                  value={roomSettings.laps}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      laps: Number(e.target.value),
                    })
                  }
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                Grid size
                <select
                  aria-label="Grid size"
                  value={roomSettings.capacity}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      capacity: Number(e.target.value),
                      bots: Math.min(
                        roomSettings.bots,
                        Number(e.target.value) - 1,
                      ),
                    })
                  }
                >
                  {[2, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} drivers
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Practice bots
                <select
                  aria-label="Practice bots"
                  value={roomSettings.bots}
                  onChange={(e) =>
                    setRoomSettings({
                      ...roomSettings,
                      bots: Number(e.target.value),
                    })
                  }
                >
                  {Array.from({ length: roomSettings.capacity }, (_, i) => (
                    <option key={i} value={i}>
                      {i} bots
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="info-note">
              <Globe2 size={17} />
              <span>
                Public and shareable. Bots are server-controlled and clearly
                marked. Add at least one to race on your own.
              </span>
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button
              className="button primary full"
              disabled={!online}
              type="submit"
            >
              Create public room <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
      {dialog === "join" && (
        <Modal
          title="YOUR CREW IS WAITING."
          eyebrow="JOIN A ROOM"
          close={close}
        >
          <p className="modal-intro">
            Paste a room code or an APEX invite link to find your friends.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              let code = joinCode.trim();
              try {
                code = new URL(code).searchParams.get("room") || code;
              } catch {
                /* A plain room code is also valid. */
              }
              code = code.toUpperCase();
              if (!/^[A-Z0-9]{4,12}$/.test(code)) {
                setFormError("Enter a valid room code or invite URL.");
                return;
              }
              connection.send({ type: "join", code, spectator });
            }}
          >
            <label>
              Room code or invite link
              <input
                className="code-input"
                placeholder="e.g. A1B2C3"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                maxLength={256}
                required
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={spectator}
                onChange={(e) => setSpectator(e.target.checked)}
              />{" "}
              Join as a spectator
            </label>
            <div className="info-note">
              <Info size={17} />
              <span>
                Race already underway? You'll join as a spectator and can drive
                in the next race.
              </span>
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button
              type="submit"
              className="button primary full"
              disabled={!online}
            >
              Join the grid <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
      {dialog === "track" && (
        <Modal
          title={trackDetails.name.toUpperCase()}
          eyebrow="CIRCUIT SPOTLIGHT"
          close={close}
        >
          <div className="modal-track-art">
            <TrackArt track={trackId} />
          </div>
          <p className="modal-intro">{trackDetails.description}</p>
          <div className="track-detail-map">
            <CircuitMap trackId={trackId} />
            <div>
              <strong>
                {(trackDetails.length / 1000).toFixed(1)}
                <small> KM</small>
              </strong>
              <span>{trackDetails.checkpoints.length} ordered checkpoints</span>
              <span>{trackDetails.difficulty}</span>
              <span>
                {trackId === "canyon"
                  ? "Dry asphalt / high grip"
                  : "Wet asphalt / low grip"}
              </span>
            </div>
          </div>
          <button
            className="button primary full"
            disabled={!online}
            onClick={() => {
              setRoomSettings({ ...roomSettings, track: trackId });
              open("create");
            }}
          >
            Create a race here <ArrowUpRight size={17} />
          </button>
        </Modal>
      )}
      {dialog === "settings" && (
        <Modal title="DIAL IT IN." eyebrow="DRIVER SETTINGS" close={close} wide>
          <div className="settings-grid">
            <section>
              <label>
                Driver name
                <input
                  aria-label="Driver name"
                  maxLength={24}
                  value={settings.name}
                  onChange={(e) =>
                    updateSettings({ ...settings, name: e.target.value })
                  }
                  onBlur={() => {
                    const name = nameSchema.safeParse(settings.name);
                    if (name.success) {
                      connection.send({ type: "name", name: name.data });
                      setFormError("");
                    } else
                      setFormError(
                        "Driver names need 1-24 letters, numbers, spaces, or simple punctuation.",
                      );
                  }}
                />
              </label>
              <label className="volume-label">
                <span>
                  <Volume2 size={16} /> Master volume{" "}
                  <b>{Math.round(settings.volume * 100)}%</b>
                </span>
                <input
                  aria-label="Master volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.volume}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      volume: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Camera
                <select
                  value={settings.camera}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      camera: e.target.value as Settings["camera"],
                    })
                  }
                >
                  <option value="chase">Chase / follow the action</option>
                  <option value="hood">Hood / in the driver's seat</option>
                  <option value="aerial">Aerial / see the racing line</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      reducedMotion: e.target.checked,
                    })
                  }
                />{" "}
                Reduced motion
              </label>
              <p className="field-note">
                Disables speed FOV, camera sway, impact flashes, and tire
                trails. Readiness and warnings use both text and color.
              </p>
            </section>
            <section>
              <div className="section-mini">
                <Gamepad2 size={16} /> YOUR CONTROLS
              </div>
              <p className="field-note">
                Click a key to remap it. Arrow keys also work.
              </p>
              <div className="key-bindings">
                {Object.entries(settings.bindings).map(([action, key]) => (
                  <div key={action}>
                    <span>
                      {action === "reverse" ? "Brake / reverse" : action}
                    </span>
                    <button
                      className={remapping === action ? "listening" : ""}
                      onClick={() =>
                        setRemapping(action as keyof Settings["bindings"])
                      }
                    >
                      {remapping === action
                        ? "Press a key..."
                        : key
                            .replace("Key", "")
                            .replace("Left", " L")
                            .replace("Right", " R")}
                    </button>
                  </div>
                ))}
              </div>
              <p className="field-note">
                Gamepad: left stick steer, RT accelerate, LT reverse, A brake, B
                drift, X reset. Press C to cycle cameras.
              </p>
            </section>
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button
            className="button primary full"
            onClick={() => {
              const name = nameSchema.safeParse(settings.name);
              if (!name.success) {
                setFormError("Choose a valid driver name before saving.");
                return;
              }
              connection.send({ type: "name", name: name.data });
              close();
            }}
          >
            Save & back to the track <Check size={17} />
          </button>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal
          title="EVERY CORNER COUNTS."
          eyebrow="THE APEX FIELD GUIDE"
          close={close}
          wide
        >
          <div className="guide-grid">
            <section>
              <div className="guide-icon">
                <Gauge />
              </div>
              <h3>Find your rhythm.</h3>
              <p>
                W / S accelerate and reverse. A / D steer. Space brakes, Shift
                lets the rear slide. Brake before a corner, then feed the
                throttle back in.
              </p>
              <div className="guide-icon">
                <Flag />
              </div>
              <h3>Earn every lap.</h3>
              <p>
                Pass the numbered gates in order, in the forward direction. Road
                barriers are solid. R resets behind your last checkpoint with a
                3-second time penalty.
              </p>
            </section>
            <section>
              <div className="guide-icon">
                <Users />
              </div>
              <h3>Bring a rival. Or three.</h3>
              <p>
                Quick race finds an open public grid. Create a room to pick a
                track, lap count, and server-controlled bots. Ready up, then the
                host starts a shared 3-second countdown.
              </p>
              <div className="guide-icon">
                <ShieldCheck />
              </div>
              <h3>The server calls it.</h3>
              <p>
                All physics, checkpoints, bots, and times are authoritative.
                Join a running race to spectate. Disconnect? Your identity is
                reserved for 30 seconds. A new host is chosen automatically.
              </p>
            </section>
          </div>
          <div className="info-note">
            <Signal size={18} />
            <span>
              Ping measures your round trip to this deployment. The race uses a
              fixed 60 Hz simulation, 20 Hz snapshots, local prediction, and
              buffered remote movement. Results include penalties; unfinished
              drivers receive DNF.
            </span>
          </div>
          <button className="button primary full" onClick={close}>
            Find my next gear <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {(state.error || notice) && (
        <div className={`toast ${state.error ? "error" : ""}`} role="alert">
          <div className="toast-icon">
            {state.error ? <Info size={20} /> : <CheckCircle2 size={20} />}
          </div>
          <div>
            <strong>
              {state.error
                ? state.error.code.replaceAll("_", " ")
                : "RACE CONTROL"}
            </strong>
            <p>{state.error?.message || notice}</p>
            {state.error?.code === "VERSION_MISMATCH" && (
              <button className="text-button" onClick={() => location.reload()}>
                Reload client
              </button>
            )}
            {state.error?.code === "RECONNECT_PENDING" && (
              <button className="text-button" onClick={connection.newDriver}>
                Use a new driver instead
              </button>
            )}
            {state.status === "offline" && (
              <button className="text-button" onClick={connection.reconnect}>
                Reconnect
              </button>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              connection.clearError();
              setNotice("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
