import { useDeferredValue, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Search,
  Terminal,
  X,
} from "lucide-react";
import type { DashboardData } from "./api-types";
import {
  compact,
  dateLabel,
  exact,
  modelColor,
  modelName,
  money,
} from "./format";
import { Select } from "./components";

export function matchesSession(
  session: DashboardData["sessions"][number],
  search: string,
) {
  const query = search.trim().toLowerCase();
  return (
    !query ||
    [
      session.title,
      session.id,
      session.project,
      session.directory,
      ...session.models.map(
        (model) => `${model.name} ${modelName(model.name)} ${model.provider}`,
      ),
    ].some((value) => value.toLowerCase().includes(query))
  );
}

export default function SessionTable({
  data,
  search,
  onSearch,
  onSelect,
  expanded = false,
}: {
  data: DashboardData;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (session: string) => void;
  expanded?: boolean;
}) {
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const perPage = expanded ? 12 : 6;
  const rows = data.sessions
    .filter((session) => matchesSession(session, deferredSearch))
    .sort((a, b) =>
      sort === "tokens"
        ? b.tokens.total - a.tokens.total
        : sort === "cost"
          ? b.cost - a.cost
          : sort === "responses"
            ? b.messages - a.messages
            : b.updatedAt.localeCompare(a.updatedAt),
    );
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const currentPage = Math.min(page, pages - 1);
  const modelIds = data.filters.models.map((model) => model.id);
  return (
    <section className="panel sessions-panel">
      <div className="panel-heading sessions-heading">
        <div>
          <h2>
            {expanded ? "All sessions" : "Recent sessions"}
            <span className="count-badge">{data.sessions.length}</span>
          </h2>
          <p>A closer look at the work behind the numbers.</p>
        </div>
        <div className="table-tools">
          <div className="search-field">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => {
                onSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search sessions..."
              aria-label="Search sessions"
            />
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => {
                  onSearch("");
                  setPage(0);
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Select
            label="Sort sessions"
            value={sort}
            onChange={(value) => {
              setSort(value);
              setPage(0);
            }}
            icon={<ArrowDownWideNarrow size={15} />}
          >
            <option value="recent">Most recent</option>
            <option value="tokens">Most tokens</option>
            <option value="cost">Highest cost</option>
            <option value="responses">Most responses</option>
          </Select>
        </div>
      </div>
      <div className="table-scroll">
        <table className="session-table">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Model</th>
              <th scope="col" className="number-cell">
                Tokens
              </th>
              <th scope="col" className="number-cell">
                Cost <span className="column-unit">USD</span>
              </th>
              <th scope="col">
                Last active <span className="column-unit">UTC</span>
              </th>
              <th scope="col">
                <span className="sr-only">Inspect session</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice(currentPage * perPage, (currentPage + 1) * perPage)
              .map((session) => (
                <tr key={session.id} onClick={() => onSelect(session.id)}>
                  <td>
                    <div className="session-cell">
                      <span className="session-icon">
                        {session.parentId ? (
                          <GitBranch size={17} />
                        ) : (
                          <Terminal size={17} />
                        )}
                      </span>
                      <span className="session-title-wrap">
                        <button
                          className="session-title"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(session.id);
                          }}
                          title={session.title}
                        >
                          {session.title}
                        </button>
                        <span className="session-subtitle">
                          {session.project}
                          <span className="middle-dot" />
                          {exact(session.messages)} responses
                        </span>
                      </span>
                    </div>
                  </td>
                  <td>
                    {session.models[0] ? (
                      <span
                        className="model-tag"
                        title={session.models
                          .map((model) => modelName(model.name))
                          .join(", ")}
                      >
                        <span
                          className="color-dot"
                          style={{
                            background: modelColor(
                              session.models[0].id,
                              modelIds,
                            ),
                          }}
                        />
                        <span>{modelName(session.models[0].name)}</span>
                        {session.models.length > 1 && (
                          <b>+{session.models.length - 1}</b>
                        )}
                      </span>
                    ) : (
                      <span className="muted">No model yet</span>
                    )}
                  </td>
                  <td
                    className="number-cell token-cell"
                    title={exact(session.tokens.total)}
                  >
                    {compact(session.tokens.total)}
                  </td>
                  <td className="number-cell cost-cell">
                    {money(session.cost)}
                  </td>
                  <td className="date-cell">
                    <span>
                      {dateLabel(session.updatedAt, { year: "numeric" })}
                    </span>
                    <small>
                      {dateLabel(session.updatedAt, {
                        month: undefined,
                        day: undefined,
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </small>
                  </td>
                  <td>
                    <ArrowUpRight
                      className="row-arrow"
                      size={16}
                      aria-hidden="true"
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="table-empty">
          <Search size={26} />
          <h3>
            {search
              ? "No sessions match your search"
              : "No sessions in this view"}
          </h3>
          <p>
            {search
              ? "Try a session name, project, or model."
              : "Choose a wider date range or clear your filters."}
          </p>
          {search && (
            <button className="text-button" onClick={() => onSearch("")}>
              Clear search
            </button>
          )}
        </div>
      )}
      <div className="table-footer">
        <span>
          Showing{" "}
          <b>
            {rows.length ? currentPage * perPage + 1 : 0}
            {rows.length > 0 &&
              `-${Math.min((currentPage + 1) * perPage, rows.length)}`}
          </b>{" "}
          of <b>{exact(rows.length)}</b> sessions
          {search && " matching your search"}
        </span>
        <div className="pagination">
          <button
            aria-label="Previous page"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            Page {currentPage + 1} of {pages}
          </span>
          <button
            aria-label="Next page"
            disabled={currentPage >= pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
