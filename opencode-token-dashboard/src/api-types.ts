export interface TokenUsage {
  input: number;
  /** Includes reasoning tokens; do not add reasoning to total again. */
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** input + output + cacheRead + cacheWrite */
  total: number;
}

export interface Stats {
  tokens: TokenUsage;
  sessions: number;
  /** Assistant messages only, including zero-usage messages. */
  messages: number;
  /** Distinct UTC days with matching message or session activity. */
  activeDays: number;
  cost: number;
  /** cacheRead / (input + cacheRead + cacheWrite), or zero. */
  cacheHitRate: number;
}

export interface DashboardData {
  source: {
    path: string;
    status: "connected" | "missing" | "error";
    message?: string;
    /** Time the snapshot was requested, not the latest message timestamp. */
    lastUpdated: string;
  };
  range: {
    key: string;
    /** Inclusive UTC boundary. */
    start: string;
    /** Exclusive UTC boundary: tomorrow at 00:00 UTC. */
    end: string;
    bucket: "day" | "month";
    timezone: "UTC";
  };
  filters: {
    /** Global options, independent of the selected range and filters. */
    models: Array<{ id: string; name: string; provider: string }>;
    projects: Array<{ id: string; name: string; directory: string }>;
  };
  summary: Stats & {
    /**
     * The immediately preceding equal-length interval:
     * [range.start - (range.end - range.start), range.start).
     * Uses the same model/project filters. Null for the all-time range.
     */
    previous: Stats | null;
  };
  timeline: Array<{
    /** UTC bucket start, YYYY-MM-DD; month buckets use day 01. */
    date: string;
    total: number;
    cost: number;
    models: Record<string, number>;
  }>;
  models: Array<{
    /** provider/model, with missing components represented as unknown. */
    id: string;
    name: string;
    provider: string;
    tokens: TokenUsage;
    cost: number;
    messages: number;
    sessions: number;
  }>;
  sessions: Array<{
    id: string;
    title: string;
    projectId: string;
    project: string;
    directory: string;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
    /** Usage, models, and counts are scoped to the selected interval/filters. */
    messages: number;
    cost: number;
    tokens: TokenUsage;
    models: Array<{
      id: string;
      name: string;
      provider: string;
      tokens: TokenUsage;
      cost: number;
      messages: number;
    }>;
  }>;
}

/** Validation/protocol errors; source failures instead return DashboardData. */
export interface ApiError {
  error: { code: string; message: string };
}
