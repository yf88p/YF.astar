import { mergeIntervals, tokenSchema, type Asset, type SourceRange, type Token } from "./timeline";

export type SonioxToken = {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
  speaker?: string | null;
  language?: string | null;
  translation_status?: string | null;
  [key: string]: unknown;
};

/** Whitespace delimits words, not Soniox's subword token boundaries. */
export function normalizeTokens(input: unknown): Token[] {
  if (!Array.isArray(input) || input.length > 1_000_000) throw new Error("Invalid Soniox tokens");
  const result: Token[] = [];
  let word: Token | undefined;
  let parts = new Map<number, SonioxToken>();
  let spaces = "";
  let spaceParts = new Map<number, SonioxToken>();
  const finish = () => {
    if (!word) return;
    word.original = word.text;
    word.raw = { ...parts.values().next().value, parts: [...parts.values()] };
    result.push(tokenSchema.parse(word));
    if (result.length > 200_000) throw new Error("Transcript exceeds token limit");
    word = undefined;
    parts = new Map();
  };

  for (const [index, value] of input.entries()) {
    if (!value || typeof value !== "object" || typeof value.text !== "string" ||
      !Number.isInteger(value.start_ms) || !Number.isInteger(value.end_ms) ||
      value.start_ms < 0 || value.end_ms < value.start_ms || value.end_ms > 18_000_000 ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      (value.speaker != null && typeof value.speaker !== "string") ||
      (value.language != null && typeof value.language !== "string")) {
      throw new Error(`Invalid Soniox token at index ${index}`);
    }
    const raw = structuredClone(value) as SonioxToken;
    // Translated text is not spoken source audio and must not drive source edits.
    if (raw.translation_status === "translation") { finish(); continue; }
    const speaker = raw.speaker ?? undefined, language = raw.language ?? undefined;
    if (word && (word.speaker !== speaker || word.language !== language)) finish();
    for (const text of raw.text.match(/\s+|\S+/g) ?? []) {
      if (/^\s+$/.test(text)) {
        finish();
        spaces += text;
        spaceParts.set(index, raw);
        continue;
      }
      if (!word) {
        word = { id: `word-${result.length}`, text: spaces + text, original: "", start: raw.start_ms,
          end: raw.end_ms, confidence: raw.confidence, speaker, language };
        parts = spaceParts;
        spaces = "";
        spaceParts = new Map();
      } else {
        word.text += text;
        word.start = Math.min(word.start, raw.start_ms);
        word.end = Math.max(word.end, raw.end_ms);
        word.confidence = Math.min(word.confidence!, raw.confidence);
      }
      parts.set(index, raw);
    }
  }
  finish();
  if (spaces && result.length) {
    const last = result[result.length - 1];
    last.text += spaces;
    last.original = last.text;
    last.raw!.parts = [...new Set([...(last.raw!.parts as SonioxToken[]), ...spaceParts.values()])];
    tokenSchema.parse(last);
  }
  return result;
}

export function fillerRanges(asset: Asset): SourceRange[] {
  return asset.tokens.flatMap(token => {
    const word = token.text.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
    const start = Math.max(0, token.start), end = Math.min(asset.duration, token.end);
    return /^(?:u+m+|u+h+|e+r+m+)$/.test(word) && end > start
      ? [{ assetId: asset.id, start, end, tokenIds: [token.id] }] : [];
  });
}

export function silenceRanges(asset: Asset, thresholdMs: number): SourceRange[] {
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) throw new Error("Invalid silence threshold");
  // Transcript gaps can contain music or unrecognized speech; use measured silence only.
  return mergeIntervals(asset.silence.map(range => ({ start: Math.max(0, range.start), end: Math.min(asset.duration, range.end) }))
    .filter(range => range.end > range.start))
    .filter(range => range.end - range.start >= thresholdMs)
    .map(range => ({ assetId: asset.id, ...range }));
}
