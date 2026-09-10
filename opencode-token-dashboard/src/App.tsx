import { useEffect, useRef, useState, startTransition } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  CircleHelp,
  CirclePlay,
  Command,
  Cpu,
  Database,
  FolderClosed,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wallet,
  X,
} from "lucide-react";
import type { DashboardData } from "./api-types";
import {
  Brand,
  Change,
  Methodology,
  Select,
  SessionDetail,
  SourcePanel,
} from "./components";
import { ActivityNote, ModelShare, UsageChart } from "./Charts";
import SessionTable, { matchesSession } from "./SessionTable";
import {
  compact,
  dateLabel,
  exact,
  modelColor,
  modelName,
  money,
  percent,
  providerName,
} from "./format";

type View = "overview" | "sessions" | "models" | "source";
const views = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "sessions" as const, label: "Sessions", icon: Terminal },
  { id: "models" as const, label: "Models", icon: Layers },
  { id: "source" as const, label: "Data source", icon: Database },
];
const rangeNames: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

function initialFilters() {
  const query = new URLSearchParams(window.location.search);
  return {
    range: Object.hasOwn(rangeNames, query.get("range") ?? "")
      ? query.get("range")!
      : "30d",
    model: query.get("model") ?? "",
    project: query.get("project") ?? "",
  };
}

function exportCsv(data: DashboardData, search: string) {
  const escape = (value: string | number) => {
    const raw = String(value);
    const safe = /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = data.sessions.filter((session) =>
    matchesSession(session, search),
  );
  const columns = [
    "Session ID",
    "Title",
    "Project",
    "Directory",
    "Models",
    "Updated (UTC)",
    "Responses",
    "Input",
    "Output",
    "Cache read",
    "Cache write",
    "Reasoning (separate)",
    "Total tokens",
    "Recorded cost (USD)",
    "Period start (UTC)",
    "Period end exclusive (UTC)",
  ];
  const csv = [
    columns,
    ...rows.map((session) => [
      session.id,
      session.title,
      session.project,
      session.directory,
      session.models.map((model) => model.id).join("; "),
      session.updatedAt,
      session.messages,
      session.tokens.input,
      session.tokens.output,
      session.tokens.cacheRead,
      session.tokens.cacheWrite,
      session.tokens.reasoning,
      session.tokens.total,
      session.cost,
      data.range.start,
      data.range.end,
    ]),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `opencode-sessions-${data.range.key}-${data.source.lastUpdated.slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}

export default function App() {
  const [view, setView] = useState<View>(
    () =>
      views.find(
        (item) =>
          item.id === new URLSearchParams(window.location.search).get("view"),
      )?.id ?? "overview",
  );
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [methodology, setMethodology] = useState(false);
  const [toast, setToast] = useState("");
  const loadedQuery = useRef("");
  const query = new URLSearchParams({
    range: filters.range,
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.project ? { project: filters.project } : {}),
  }).toString();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (loadedQuery.current !== query) setData(null);
    const timeout = window.setTimeout(
      () => controller.abort("timeout"),
      15_000,
    );
    fetch(`/api/dashboard?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!result.source)
          throw new Error(
            result.error?.message ??
              "The local server returned an unexpected response.",
          );
        if (!controller.signal.aborted) {
          loadedQuery.current = query;
          setData(result);
        }
      })
      .catch((reason: unknown) => {
        if (
          !controller.signal.aborted ||
          controller.signal.reason === "timeout"
        )
          setError(
            controller.signal.reason === "timeout"
              ? "The database request timed out. Check the local server and try again."
              : reason instanceof Error
                ? reason.message
                : "Cannot reach the local server. Check that it is running and try again.",
          );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (
          !controller.signal.aborted ||
          controller.signal.reason === "timeout"
        )
          setLoading(false);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        setRefresh((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(query);
    if (view !== "overview") params.set("view", view);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params}`,
    );
    document.title = `OpenCode Insights | ${views.find((item) => item.id === view)?.label}`;
  }, [query, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function changeFilter(key: keyof typeof filters, value: string) {
    startTransition(() =>
      setFilters((current) => ({ ...current, [key]: value })),
    );
    setSessionId(null);
  }

  function navigate(next: View) {
    setView(next);
    setSearch("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  const connected = data?.source.status === "connected";
  const currentSession = data?.sessions.find(
    (session) => session.id === sessionId,
  );
  const heading = {
    overview: "Usage overview",
    sessions: "Your sessions",
    models: "Model analytics",
    source: "Local connection",
  }[view];
  const subheading = {
    overview: "Your OpenCode activity, in focus.",
    sessions: "Every session. Every token. One clear view.",
    models: "See which models power your workflow.",
    source: "Everything you need. Nothing leaves your machine.",
  }[view];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            <Command size={17} />
          </span>
          <span>
            <b>Local workspace</b>
            <small>Personal analytics</small>
          </span>
          <span className="workspace-key">1</span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {views.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              aria-label={item.label}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === "sessions" && data && (
                <b className="nav-count">{data.summary.sessions}</b>
              )}
              {view === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={19} />
            </span>
            <h3>Local. Private. Yours.</h3>
            <p>Your session data stays right where it belongs.</p>
            <span>
              <span className="live-dot" />
              Read-only connection
            </span>
          </div>
          <button className="sidebar-help" onClick={() => setMethodology(true)}>
            <CircleHelp size={17} />
            <span>How tokens are counted</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <Brand small />
            <span>
              Built for your flow.
              <small>
                OpenCode Insights <span>v1.0</span>
              </small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Brand small />
            </span>
            <span className="breadcrumb-home">
              <ChartNoAxesCombined size={16} />
              Workspace
            </span>
            <ChevronRight size={13} />
            <span>{views.find((item) => item.id === view)?.label}</span>
          </div>
          <div className="topbar-right">
            <span
              className={`connection-badge ${error || (data && !connected) ? "disconnected" : ""}`}
            >
              <span className="live-dot" />
              {error
                ? "Connection issue"
                : data
                  ? connected
                    ? "Local connection"
                    : "Not connected"
                  : "Connecting"}
            </span>
            <span className="topbar-divider" />
            <button
              className={`refresh-button ${loading ? "is-loading" : ""}`}
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
              aria-label="Refresh dashboard"
              title="Refresh data"
            >
              <RefreshCw size={15} />
              <span>Refresh</span>
            </button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {views.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={17} />
              {item.label}
            </button>
          ))}
        </nav>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow page-eyebrow">
                <span />
                YOUR WORKSPACE, AT A GLANCE
              </div>
              <h1>
                {heading}
                <span className="heading-period">.</span>
              </h1>
              <p>{subheading}</p>
            </div>
            {view !== "source" && (
              <button
                className="button export-button"
                disabled={!connected || loading}
                onClick={() => {
                  if (data)
                    setToast(
                      `Exported ${exportCsv(data, search)} sessions to CSV.`,
                    );
                }}
              >
                <ArrowDownToLine size={15} />
                Export CSV
              </button>
            )}
          </div>
          {view !== "source" && (
            <div className="filter-bar">
              <div className="filter-group">
                <Select
                  label="Date range"
                  value={filters.range}
                  onChange={(value) => changeFilter("range", value)}
                  icon={<CalendarDays size={15} />}
                >
                  {Object.entries(rangeNames).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Filter by model"
                  value={filters.model}
                  onChange={(value) => changeFilter("model", value)}
                  icon={<Cpu size={15} />}
                >
                  <option value="">All models</option>
                  {data?.filters.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {modelName(model.name)} ({providerName(model.provider)})
                    </option>
                  ))}
                  {filters.model &&
                    !data?.filters.models.some(
                      (model) => model.id === filters.model,
                    ) && (
                      <option value={filters.model}>
                        {filters.model.split("/").slice(1).join("/")}
                      </option>
                    )}
                </Select>
                <Select
                  label="Filter by project"
                  value={filters.project}
                  onChange={(value) => changeFilter("project", value)}
                  icon={<FolderClosed size={15} />}
                >
                  <option value="">All projects</option>
                  {data?.filters.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                  {filters.project &&
                    !data?.filters.projects.some(
                      (project) => project.id === filters.project,
                    ) && (
                      <option value={filters.project}>Selected project</option>
                    )}
                </Select>
                {(filters.model || filters.project) && (
                  <button
                    className="clear-filters"
                    onClick={() => {
                      setFilters((current) => ({
                        ...current,
                        model: "",
                        project: "",
                      }));
                      setSessionId(null);
                    }}
                  >
                    <X size={13} />
                    Clear
                  </button>
                )}
              </div>
              <span className="range-caption">
                {data && (
                  <>
                    {dateLabel(data.range.start, { year: "numeric" })}
                    <span className="date-range-line" />
                    {dateLabel(
                      new Date(Date.parse(data.range.end) - 1).toISOString(),
                      { year: "numeric" },
                    )}
                    <b>UTC</b>
                  </>
                )}
              </span>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={21} />
              <div>
                <strong>We couldn't refresh your data</strong>
                <p>
                  {error}
                  {data &&
                    " The last successful snapshot is still shown below."}
                </p>
              </div>
              <button
                className="button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {view === "source" ? (
            <SourcePanel
              data={data}
              onRefresh={() => setRefresh((value) => value + 1)}
            />
          ) : data && !connected ? (
            <section className="panel empty-source">
              <Database size={38} strokeWidth={1.4} />
              <h2>
                {data.source.status === "missing"
                  ? "Your dashboard is ready for OpenCode"
                  : "Let's reconnect your database"}
              </h2>
              <p>{data.source.message}</p>
              <code>{data.source.path}</code>
              <div>
                <button
                  className="button primary"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Check again
                  <RefreshCw size={15} />
                </button>
                <button className="button" onClick={() => navigate("source")}>
                  Connection details
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          ) : !data ? (
            <div
              className="loading-state"
              aria-live="polite"
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <div className="skeleton-stats">
                    {[0, 1, 2, 3].map((key) => (
                      <div className="skeleton" key={key} />
                    ))}
                  </div>
                  <div className="skeleton skeleton-chart" />
                  <span className="loading-label">
                    <LoaderCircle size={16} className="spin" />
                    Reading your local workspace...
                  </span>
                </>
              ) : (
                <div className="panel empty-source">
                  <Database size={35} />
                  <h2>The local server is unavailable</h2>
                  <p>
                    Start the dashboard with <code>npm run dev</code> or{" "}
                    <code>npm start</code>, then try refreshing.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="dashboard-content" aria-busy={loading}>
              <section className="stats-grid" aria-label="Usage summary">
                <article className="stat-card stat-featured">
                  <div className="stat-top">
                    <span>Total tokens</span>
                    <span className="stat-icon">
                      <Layers size={17} />
                    </span>
                  </div>
                  <div
                    className="stat-value"
                    title={exact(data.summary.tokens.total)}
                  >
                    {compact(data.summary.tokens.total)}
                    <span className="stat-unit">tokens</span>
                  </div>
                  <Change
                    value={data.summary.tokens.total}
                    previous={data.summary.previous?.tokens.total}
                  />
                  <div className="stat-spark" aria-hidden="true">
                    {data.timeline.slice(-16).map((point, index, arr) => (
                      <i
                        key={index}
                        style={{
                          height: `${Math.max(5, (point.total / Math.max(1, ...arr.map((item) => item.total))) * 100)}%`,
                        }}
                      />
                    ))}
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Active sessions</span>
                    <span className="stat-icon">
                      <Terminal size={17} />
                    </span>
                  </div>
                  <div className="stat-value">
                    {exact(data.summary.sessions)}
                    <span className="stat-unit">sessions</span>
                  </div>
                  <Change
                    value={data.summary.sessions}
                    previous={data.summary.previous?.sessions}
                  />
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>
                      Recorded cost
                      <button
                        className="help-button"
                        aria-label="About recorded costs"
                        onClick={() => setMethodology(true)}
                      >
                        <CircleHelp size={13} />
                      </button>
                    </span>
                    <span className="stat-icon">
                      <Wallet size={17} />
                    </span>
                  </div>
                  <div className="stat-value">
                    {money(data.summary.cost)}
                    <span className="stat-unit">USD</span>
                  </div>
                  <span className="stat-context">As reported by OpenCode</span>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Cache hit rate</span>
                    <span className="stat-icon">
                      <Activity size={17} />
                    </span>
                  </div>
                  <div className="stat-value">
                    {percent(data.summary.cacheHitRate)}
                    <span className="cache-indicator">
                      <i
                        style={{ width: percent(data.summary.cacheHitRate) }}
                      />
                    </span>
                  </div>
                  <span className="stat-context">
                    <b>{compact(data.summary.tokens.cacheRead)}</b> prompt
                    tokens reused
                  </span>
                </article>
              </section>
              {view === "overview" && (
                <>
                  <div className="charts-grid">
                    <UsageChart
                      data={data}
                      onMethodology={() => setMethodology(true)}
                    />
                    <ModelShare
                      data={data}
                      onSelect={(id) => changeFilter("model", id)}
                      onViewAll={() => navigate("models")}
                    />
                  </div>
                  <ActivityNote data={data} />
                  <SessionTable
                    data={data}
                    search={search}
                    onSearch={setSearch}
                    onSelect={setSessionId}
                  />
                </>
              )}
              {view === "sessions" && (
                <>
                  <div className="section-note">
                    <CirclePlay size={16} />
                    <span>
                      <b>{exact(data.summary.messages)}</b> AI responses across{" "}
                      <b>{data.summary.activeDays}</b> active days in this
                      period.
                    </span>
                    <span>
                      Click a session to explore its usage
                      <ArrowUpRight size={13} />
                    </span>
                  </div>
                  <SessionTable
                    data={data}
                    search={search}
                    onSearch={setSearch}
                    onSelect={setSessionId}
                    expanded
                  />
                </>
              )}
              {view === "models" && (
                <>
                  <div className="charts-grid">
                    <UsageChart
                      data={data}
                      onMethodology={() => setMethodology(true)}
                    />
                    <ModelShare
                      data={data}
                      onSelect={(id) => changeFilter("model", id)}
                      onViewAll={() =>
                        document
                          .getElementById("model-breakdown")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                      }
                    />
                  </div>
                  <ModelBreakdown
                    data={data}
                    onSelect={(id) => changeFilter("model", id)}
                  />
                </>
              )}
            </div>
          )}
          <footer className="main-footer">
            <span>
              <LockKeyhole size={12} />
              Local data. Read-only access. Zero tracking.
            </span>
            <button onClick={() => setMethodology(true)}>
              A note on the numbers
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {methodology && <Methodology onClose={() => setMethodology(false)} />}
      {currentSession && data && (
        <SessionDetail
          session={currentSession}
          data={data}
          onClose={() => setSessionId(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={17} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ModelBreakdown({
  data,
  onSelect,
}: {
  data: DashboardData;
  onSelect: (id: string) => void;
}) {
  const ids = data.filters.models.map((model) => model.id);
  return (
    <section className="panel model-breakdown" id="model-breakdown">
      <div className="panel-heading">
        <div>
          <h2>
            Model breakdown
            <span className="count-badge">{data.models.length}</span>
          </h2>
          <p>Compare token consumption across your models.</p>
        </div>
        <span className="subtle-tag">Click a model to filter</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th className="number-cell">Input</th>
              <th className="number-cell">Output</th>
              <th className="number-cell">Cache read</th>
              <th className="number-cell">Cache write</th>
              <th className="number-cell">Total tokens</th>
              <th className="number-cell">
                Cost <span className="column-unit">USD</span>
              </th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((model) => (
              <tr key={model.id}>
                <td>
                  <button
                    className="model-table-name"
                    onClick={() => onSelect(model.id)}
                  >
                    <span
                      className="model-provider-icon"
                      style={{
                        color: modelColor(model.id, ids),
                        background: `${modelColor(model.id, ids)}15`,
                      }}
                    >
                      <Cpu size={20} />
                    </span>
                    <span>
                      <b>{modelName(model.name)}</b>
                      <small>
                        {providerName(model.provider)}
                        <span className="middle-dot" />
                        {model.sessions} sessions
                      </small>
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                </td>
                {[
                  model.tokens.input,
                  model.tokens.output,
                  model.tokens.cacheRead,
                  model.tokens.cacheWrite,
                  model.tokens.total,
                ].map((value, index) => (
                  <td
                    key={index}
                    className={`number-cell ${index === 4 ? "token-cell" : ""}`}
                    title={exact(value)}
                  >
                    {compact(value)}
                  </td>
                ))}
                <td className="number-cell">{money(model.cost)}</td>
                <td>
                  <div className="model-share-bar">
                    <span>
                      {percent(
                        data.summary.tokens.total
                          ? model.tokens.total / data.summary.tokens.total
                          : 0,
                      )}
                    </span>
                    <i>
                      <b
                        style={{
                          width: percent(
                            data.summary.tokens.total
                              ? model.tokens.total / data.summary.tokens.total
                              : 0,
                          ),
                          background: modelColor(model.id, ids),
                        }}
                      />
                    </i>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.models.length && (
        <div className="table-empty">
          <Layers size={28} />
          <h3>No models in this period</h3>
          <p>Try a wider date range to see your model history.</p>
        </div>
      )}
      <div className="model-table-note">
        <CircleHelp size={14} />
        Total includes input, output, and both cache categories. Reasoning is
        available in the session inspector.
      </div>
    </section>
  );
}
