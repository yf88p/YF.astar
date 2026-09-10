export const compact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const exact = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
export const percent = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
export const dateLabel = (
  value: string,
  options: Intl.DateTimeFormatOptions = {},
) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
        ...options,
      }).format(new Date(value))
    : "Not recorded";

export function modelName(name: string) {
  const names: Record<string, string> = {
    "gpt-6-astra": "GPT-6 Astra",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "gemini-2.5-pro-preview-06-05": "Gemini 2.5 Pro Preview",
    "minimax-m2.5-free": "MiniMax M2.5 Free",
    "big-pickle": "Big Pickle",
    unknown: "Unknown model",
  };
  return names[name] ?? name;
}

export const providerName = (provider: string) =>
  ({
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    opencode: "OpenCode",
    unknown: "Unknown provider",
  })[provider] ?? provider;

const palette = [
  "#668a62",
  "#a8bd8b",
  "#7b9da7",
  "#d5bc82",
  "#a898bb",
  "#729a8e",
  "#ce9680",
  "#97a1ad",
];
export function modelColor(id: string, allIds: string[]) {
  return palette[Math.max(0, allIds.indexOf(id)) % palette.length];
}
