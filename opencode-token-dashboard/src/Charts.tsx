import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  ChartNoAxesCombined,
  CircleHelp,
} from "lucide-react";
import type { DashboardData } from "./api-types";
import {
  compact,
  dateLabel,
  exact,
  modelColor,
  modelName,
  money,
  percent,
} from "./format";

export function UsageChart({
  data,
  onMethodology,
}: {
  data: DashboardData;
  onMethodology: () => void;
}) {
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [hidden, setHidden] = useState<string[]>([]);
  const modelIds = data.filters.models.map((model) => model.id);
  const chartModels = data.models.filter((model) => model.tokens.total > 0);
  const points = data.timeline.map((point) => ({
    date: point.date,
    cost: point.cost,
    ...Object.fromEntries(
      chartModels.map((model, index) => [
        `model${index}`,
        point.models[model.id] ?? 0,
      ]),
    ),
  }));
  const peak = data.timeline.reduce(
    (highest, point) => (point.total > highest.total ? point : highest),
    { date: "", total: 0 },
  );
  return (
    <section className="panel usage-panel">
      <div className="panel-heading">
        <div>
          <h2>
            Token activity
            <button
              className="help-button"
              onClick={onMethodology}
              aria-label="How token activity is calculated"
            >
              <CircleHelp size={14} />
            </button>
          </h2>
          <p>Your usage over time, broken down by model.</p>
        </div>
        <div className="segmented" aria-label="Chart metric">
          <button
            aria-pressed={metric === "tokens"}
            className={metric === "tokens" ? "selected" : ""}
            onClick={() => setMetric("tokens")}
          >
            Tokens
          </button>
          <button
            aria-pressed={metric === "cost"}
            className={metric === "cost" ? "selected" : ""}
            onClick={() => setMetric("cost")}
          >
            Cost
          </button>
        </div>
      </div>
      <div className="chart-summary">
        <strong>
          {metric === "tokens"
            ? compact(data.summary.tokens.total)
            : money(data.summary.cost)}
        </strong>
        <span>
          {metric === "tokens" ? "tokens processed" : "recorded in USD"}
        </span>
        <span className="chart-bucket">
          <span className="live-dot" />
          {data.range.bucket === "month" ? "Monthly" : "Daily"} totals
        </span>
      </div>
      <div
        className="activity-chart"
        role="img"
        aria-label={`${metric === "tokens" ? exact(data.summary.tokens.total) + " total tokens" : money(data.summary.cost) + " recorded cost"} across ${data.timeline.length} ${data.range.bucket === "month" ? "months" : "days"}. ${peak.total ? `Peak token usage was ${dateLabel(peak.date)} at ${exact(peak.total)} tokens.` : "No token usage in this period."}`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart
            data={points}
            margin={{ top: 10, right: 7, left: -15, bottom: 0 }}
            accessibilityLayer
          >
            <defs>
              {chartModels.map((model, index) => (
                <linearGradient
                  key={model.id}
                  id={`fill-${index}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={modelColor(model.id, modelIds)}
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="100%"
                    stopColor={modelColor(model.id, modelIds)}
                    stopOpacity={0.03}
                  />
                </linearGradient>
              ))}
              <linearGradient id="cost-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#668a62" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#668a62" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="#e9edeb"
              strokeDasharray="3 4"
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#929995", fontSize: 11 }}
              minTickGap={40}
              tickMargin={13}
              tickFormatter={(value) =>
                dateLabel(
                  value,
                  data.range.bucket === "month"
                    ? { day: undefined, month: "short", year: "2-digit" }
                    : {},
                )
              }
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#929995", fontSize: 11 }}
              tickFormatter={(value) =>
                metric === "tokens" ? compact(value) : `$${compact(value)}`
              }
              tickCount={5}
              width={59}
            />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="chart-tooltip">
                    <strong>
                      {dateLabel(String(label), {
                        year: "numeric",
                        ...(data.range.bucket === "month"
                          ? { day: undefined }
                          : {}),
                      })}{" "}
                      <small>UTC</small>
                    </strong>
                    {payload
                      .slice()
                      .reverse()
                      .map((item) => (
                        <div key={String(item.dataKey)}>
                          <span
                            className="color-dot"
                            style={{ background: item.color }}
                          />
                          <span>{item.name}</span>
                          <b>
                            {metric === "tokens"
                              ? exact(Number(item.value))
                              : money(Number(item.value))}
                          </b>
                        </div>
                      ))}
                  </div>
                ) : null
              }
            />
            {metric === "tokens" ? (
              chartModels.map((model, index) => (
                <Area
                  key={model.id}
                  dataKey={`model${index}`}
                  name={modelName(model.name)}
                  type="monotone"
                  stackId="tokens"
                  stroke={modelColor(model.id, modelIds)}
                  fill={`url(#fill-${index})`}
                  strokeWidth={2}
                  hide={hidden.includes(model.id)}
                  isAnimationActive={false}
                  activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
                />
              ))
            ) : (
              <Area
                dataKey="cost"
                name="Recorded cost"
                type="monotone"
                stroke="#668a62"
                fill="url(#cost-fill)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        {data.summary.tokens.total === 0 && (
          <div className="chart-empty">
            <ChartNoAxesCombined size={25} />
            <span>No token usage in this period</span>
            <small>Try a wider date range or another model.</small>
          </div>
        )}
      </div>
      <div className="chart-footer">
        {metric === "tokens" ? (
          <div className="chart-legend" aria-label="Toggle models on the chart">
            {chartModels.map((model) => (
              <button
                key={model.id}
                aria-pressed={!hidden.includes(model.id)}
                className={hidden.includes(model.id) ? "legend-hidden" : ""}
                onClick={() =>
                  setHidden((current) =>
                    current.includes(model.id)
                      ? current.filter((id) => id !== model.id)
                      : [...current, model.id],
                  )
                }
              >
                <span
                  className="color-dot"
                  style={{ background: modelColor(model.id, modelIds) }}
                />
                {modelName(model.name)}
              </button>
            ))}
          </div>
        ) : (
          <span className="fine-print">
            Recorded costs only. Zero does not necessarily mean free usage.
          </span>
        )}
        <span className="timezone-label">UTC</span>
      </div>
    </section>
  );
}

export function ModelShare({
  data,
  onSelect,
  onViewAll,
}: {
  data: DashboardData;
  onSelect: (id: string) => void;
  onViewAll: () => void;
}) {
  const modelIds = data.filters.models.map((model) => model.id);
  const models = data.models.filter((model) => model.tokens.total > 0);
  return (
    <section className="panel model-share">
      <div className="panel-heading">
        <div>
          <h2>Model mix</h2>
          <p>A share of your total tokens.</p>
        </div>
        <span className="subtle-tag">
          {data.models.length} {data.models.length === 1 ? "model" : "models"}
        </span>
      </div>
      <div className="donut-wrap">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie
              data={
                models.length
                  ? models.map((model) => ({
                      name: modelName(model.name),
                      value: model.tokens.total,
                      id: model.id,
                    }))
                  : [{ name: "No usage", value: 1, id: "" }]
              }
              dataKey="value"
              innerRadius={64}
              outerRadius={81}
              paddingAngle={models.length > 1 ? 3 : 0}
              startAngle={90}
              endAngle={-270}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={false}
            >
              {(models.length ? models : [{ id: "" }]).map((model) => (
                <Cell
                  key={model.id}
                  fill={model.id ? modelColor(model.id, modelIds) : "#edf0ed"}
                />
              ))}
            </Pie>
            {models.length > 0 && (
              <Tooltip
                formatter={(value) => [compact(Number(value)), "tokens"]}
                contentStyle={{
                  borderRadius: 10,
                  fontSize: 12,
                  borderColor: "#e3e8e3",
                }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span className="tiny-label">TOTAL TOKENS</span>
          <strong>{compact(data.summary.tokens.total)}</strong>
          <span>
            across {data.models.length}{" "}
            {data.models.length === 1 ? "model" : "models"}
          </span>
        </div>
      </div>
      <div className="model-share-list">
        {models.slice(0, 4).map((model) => (
          <button
            key={model.id}
            onClick={() => onSelect(model.id)}
            title={`Filter by ${modelName(model.name)}`}
          >
            <span
              className="color-dot"
              style={{ background: modelColor(model.id, modelIds) }}
            />
            <span>{modelName(model.name)}</span>
            <b>{percent(model.tokens.total / data.summary.tokens.total)}</b>
            <ArrowUpRight size={13} />
          </button>
        ))}
        {!models.length && (
          <p className="muted centered">No model usage to show yet.</p>
        )}
        {models.length > 4 && (
          <span className="other-models">
            + {models.length - 4} more models in the breakdown
          </span>
        )}
      </div>
      <button className="panel-link" onClick={onViewAll}>
        Explore models
        <ArrowUpRight size={14} />
      </button>
    </section>
  );
}

export function ActivityNote({ data }: { data: DashboardData }) {
  const tokens = data.summary.tokens;
  return (
    <div className="activity-note">
      <span className="activity-note-icon">
        <Activity size={17} />
      </span>
      <p>
        {tokens.total ? (
          <>
            <strong>
              {percent(data.summary.cacheHitRate)} of prompt tokens came from
              cache.
            </strong>{" "}
            Reused context keeps your workflow moving.
          </>
        ) : (
          <>
            <strong>Your next session starts a new story.</strong> Token
            activity will appear here as you use OpenCode.
          </>
        )}
      </p>
      <span className="note-tag">WORKSPACE PULSE</span>
    </div>
  );
}
