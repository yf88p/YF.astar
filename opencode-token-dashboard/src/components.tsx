import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  X,
  Database,
  Info,
} from "lucide-react";
import type { DashboardData } from "./api-types";
import {
  compact,
  dateLabel,
  exact,
  modelName,
  money,
  percent,
  providerName,
} from "./format";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!small && (
        <span>
          opencode<span className="brand-sub">INSIGHTS</span>
        </span>
      )}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  children,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="select-wrap">
      {icon}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
    </div>
  );
}

export function Change({
  value,
  previous,
}: {
  value: number;
  previous: number | undefined;
}) {
  if (previous === undefined)
    return <span className="stat-context">Across your recorded history</span>;
  if (!previous)
    return (
      <span className="stat-context">
        {value
          ? "No usage in previous period"
          : "No change from previous period"}
      </span>
    );
  const change = (value - previous) / previous;
  return (
    <span className="stat-comparison">
      <span className={`change ${change < 0 ? "down" : ""}`}>
        {change < 0 ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
        {percent(Math.abs(change))}
      </span>
      <span>vs. previous period</span>
    </span>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby="modal-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-shell">
        <header className="modal-header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function SessionDetail({
  session,
  data,
  onClose,
}: {
  session: DashboardData["sessions"][number];
  data: DashboardData;
  onClose: () => void;
}) {
  return (
    <Modal
      title={session.title}
      eyebrow="SESSION INSPECTOR"
      onClose={onClose}
      wide
    >
      <div className="session-meta">
        <span className="project-badge">{session.project}</span>
        {session.parentId && <span className="subtle-tag">Sub-session</span>}
        <span>
          {dateLabel(session.updatedAt, {
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          UTC
        </span>
      </div>
      <div className="inspector-period">
        <Info size={15} />
        <span>
          Usage for {dateLabel(data.range.start, { year: "numeric" })} to{" "}
          {dateLabel(new Date(Date.parse(data.range.end) - 1).toISOString(), {
            year: "numeric",
          })}
          . Current filters apply.
        </span>
      </div>
      <div className="detail-stats">
        <div>
          <span>Total tokens</span>
          <strong title={exact(session.tokens.total)}>
            {compact(session.tokens.total)}
          </strong>
        </div>
        <div>
          <span>Recorded cost</span>
          <strong>{money(session.cost)}</strong>
        </div>
        <div>
          <span>AI responses</span>
          <strong>{exact(session.messages)}</strong>
        </div>
      </div>
      <h3 className="detail-heading">Token breakdown</h3>
      <div className="breakdown-grid">
        {[
          ["Input", session.tokens.input],
          ["Output", session.tokens.output],
          ["Cache read", session.tokens.cacheRead],
          ["Cache write", session.tokens.cacheWrite],
          ["Reasoning (separate)", session.tokens.reasoning],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{exact(Number(value))}</strong>
          </div>
        ))}
      </div>
      <h3 className="detail-heading">
        Models in this session <span>{session.models.length}</span>
      </h3>
      <div className="detail-models">
        {session.models.length ? (
          session.models.map((model) => (
            <div key={model.id}>
              <span>
                <b>{modelName(model.name)}</b>
                <small>
                  {providerName(model.provider)}{" "}
                  <span aria-hidden="true">/</span> {exact(model.messages)}{" "}
                  responses
                </small>
              </span>
              <span>
                <b>{compact(model.tokens.total)}</b>
                <small>{money(model.cost)}</small>
              </span>
            </div>
          ))
        ) : (
          <p className="muted">
            No assistant usage was recorded for this session in the selected
            period.
          </p>
        )}
      </div>
      <details className="session-technical">
        <summary>
          Session metadata
          <ChevronDown size={15} />
        </summary>
        <dl>
          <dt>Session ID</dt>
          <dd>{session.id}</dd>
          <dt>Directory</dt>
          <dd>{session.directory || "Not recorded"}</dd>
          <dt>Created</dt>
          <dd>
            {dateLabel(session.createdAt, {
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            UTC
          </dd>
          {session.parentId && (
            <>
              <dt>Parent ID</dt>
              <dd>{session.parentId}</dd>
            </>
          )}
        </dl>
      </details>
      <p className="fine-print">
        Recorded costs can be zero for subscription or unpriced models.
        Reasoning is shown separately and is not added to the token total.
      </p>
    </Modal>
  );
}

export function SourcePanel({
  data,
  onRefresh,
}: {
  data: DashboardData | null;
  onRefresh: () => void;
}) {
  return (
    <section className="panel source-panel">
      <div className="source-illustration">
        <Database size={32} strokeWidth={1.4} />
      </div>
      <span className="eyebrow">PRIVATE BY DESIGN</span>
      <h2>Your data. Your machine.</h2>
      <p>
        Insights reads your local OpenCode database directly. No accounts, no
        uploads, no external analytics.
      </p>
      <div className="source-properties">
        <div>
          <span>Database</span>
          <code>
            {data?.source.path ?? "~/.local/share/opencode/opencode.db"}
          </code>
        </div>
        <div>
          <span>Connection</span>
          <b
            className={data?.source.status === "connected" ? "text-green" : ""}
          >
            {data?.source.status === "connected"
              ? "Connected, read-only"
              : (data?.source.status ?? "Connecting")}
          </b>
        </div>
        <div>
          <span>Last checked</span>
          <b>
            {data
              ? dateLabel(data.source.lastUpdated, {
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }) + " UTC"
              : "Waiting for server"}
          </b>
        </div>
        <div>
          <span>Automatic refresh</span>
          <b>Every 30 seconds while this tab is visible</b>
        </div>
      </div>
      {data?.source.message && (
        <p className="source-message" role="status">
          {data.source.message}
        </p>
      )}
      <button className="button primary" onClick={onRefresh}>
        Check connection
        <ChevronRight size={16} />
      </button>
      <div className="source-note">
        <Info size={17} />
        <p>
          Using another database? Set{" "}
          <code>OPENCODE_DB=/path/to/opencode.db</code> when starting the
          server. The connection is always read-only.
        </p>
      </div>
    </section>
  );
}

export function Methodology({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="A note on the numbers"
      eyebrow="HOW INSIGHTS WORKS"
      onClose={onClose}
    >
      <div className="methodology">
        <section>
          <h3>Tokens, without double counting</h3>
          <p>
            Total tokens are input + output + cache reads + cache writes, summed
            once per assistant message. Reasoning is displayed separately, not
            added again. These are processed tokens, not a count of unique
            words.
          </p>
        </section>
        <section>
          <h3>Cache hit rate</h3>
          <p>
            Cache reads divided by all prompt tokens: input + cache reads +
            cache writes. A higher rate means more context was reused, not
            necessarily a lower bill.
          </p>
        </section>
        <section>
          <h3>Recorded cost, not an invoice</h3>
          <p>
            Costs are the USD values stored by OpenCode. Subscription models and
            models without pricing may report $0.00. Insights does not guess
            prices or calculate your actual provider bill.
          </p>
        </section>
        <section>
          <h3>A consistent view of time</h3>
          <p>
            All dates use UTC. Rolling periods include today and compare against
            the preceding equal-length period. All time uses monthly buckets for
            histories longer than 120 days.
          </p>
        </section>
        <section>
          <h3>Sessions and responses</h3>
          <p>
            Sessions include activity in the chosen period, including
            sub-sessions and sessions without token usage. Response counts
            include assistant messages only. Model filters show only sessions
            with a matching response.
          </p>
        </section>
        <div className="methodology-footer">
          <Database size={16} />
          <span>
            Read-only SQLite. No conversation content is sent to the browser.
          </span>
        </div>
      </div>
    </Modal>
  );
}
