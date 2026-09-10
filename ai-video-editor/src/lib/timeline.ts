import { z } from "zod";

export const TIMEBASE = 1000;
export const uid = () => crypto.randomUUID();
const time = z.number().finite().min(0).max(18_000_000);
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const tokenSchema = z.object({
  id, text: z.string().max(2000), start: time, end: time,
  confidence: z.number().min(0).max(1).optional(), speaker: z.string().max(100).optional(),
  language: z.string().max(30).optional(), original: z.string().max(2000),
  corrected: z.boolean().optional(), raw: z.record(z.string(), z.unknown()).optional(),
});
export type Token = z.infer<typeof tokenSchema>;
export const assetSchema = z.object({
  id, name: z.string().min(1).max(180), kind: z.enum(["video", "audio", "image", "subtitle"]),
  duration: time.positive(), width: z.number().optional(), height: z.number().optional(),
  hasAudio: z.boolean(), bytes: z.number().nonnegative(), mime: z.string().max(100),
  waveform: z.array(z.number().min(0).max(1)).max(2000).default([]),
  silence: z.array(z.object({ start: time, end: time })).max(10000).default([]),
  thumbnail: z.boolean().default(false), fixture: z.boolean().optional(),
  tokens: z.array(tokenSchema).max(200000).default([]),
  transcription: z.enum(["idle", "queued", "uploading", "processing", "completed", "failed", "retryable", "cancelled"]).default("idle"),
  transcriptionError: z.string().max(500).optional(),
});
export type Asset = z.infer<typeof assetSchema>;
export const effectsSchema = z.object({
  scale: z.number().min(0.1).max(4).default(1), x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0), rotation: z.number().min(-180).max(180).default(0),
  crop: z.number().min(0).max(0.45).default(0), brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(0).max(3).default(1), saturation: z.number().min(0).max(3).default(1),
});
export const clipSchema = z.object({
  id, assetId: id.optional(), trackId: id, name: z.string().max(180),
  start: time, sourceIn: time, sourceOut: time.positive(), speed: z.number().min(0.25).max(4),
  volume: z.number().min(0).max(2), fadeIn: time, fadeOut: time,
  transition: z.enum(["none", "fade"]).default("none"), groupId: id.optional(),
  text: z.string().max(2000).optional(), fontSize: z.number().min(16).max(160).default(48),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  effects: effectsSchema,
});
export type Clip = z.infer<typeof clipSchema>;
export const trackSchema = z.object({ id, name: z.string().max(100), kind: z.enum(["video", "audio", "text", "caption"]), muted: z.boolean(), solo: z.boolean() });
export type Track = z.infer<typeof trackSchema>;
export const rangeSchema = z.object({ assetId: id, start: time, end: time, tokenIds: z.array(id).max(10000).optional() });
export type SourceRange = z.infer<typeof rangeSchema>;
export const projectSchema = z.object({
  id, name: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
  createdAt: z.string(), updatedAt: z.string(), fixture: z.boolean(),
  fps: z.number().int().min(24).max(60), width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160),
  assets: z.array(assetSchema).max(100), tracks: z.array(trackSchema).max(16), clips: z.array(clipSchema).max(500),
  editLog: z.array(z.object({ id, revision: z.number(), label: z.string(), ranges: z.array(rangeSchema), at: z.string() })).max(1000),
});
export type Project = z.infer<typeof projectSchema>;
export type ProjectHistory = { project: Project; undo: Project[]; redo: Project[] };
export const duration = (clip: Clip) => (clip.sourceOut - clip.sourceIn) / clip.speed;
export const clipEnd = (clip: Clip) => clip.start + duration(clip);
export const projectDuration = (project: Project) => Math.max(0, ...project.clips.map(clipEnd));
export const toSource = (clip: Clip, timeline: number) => clip.sourceIn + (timeline - clip.start) * clip.speed;
export const toTimeline = (clip: Clip, source: number) => clip.start + (source - clip.sourceIn) / clip.speed;
export const toFrame = (ms: number, fps: number) => Math.round(ms * fps / TIMEBASE);
export const fromFrame = (frame: number, fps: number) => frame * TIMEBASE / fps;
export const frameTime = (ms: number, fps: number) => fromFrame(toFrame(ms, fps), fps);
export const timecode = (ms: number, frames = false, fps = 30) => {
  const total = Math.max(0, ms) / 1000;
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${Math.floor(total % 60).toString().padStart(2, "0")}${frames ? `:${Math.floor(total % 1 * fps).toString().padStart(2, "0")}` : ""}`;
};
export function createProject(name = "Untitled project"): Project {
  const now = new Date().toISOString();
  return { id: uid(), name, revision: 0, createdAt: now, updatedAt: now, fixture: false, fps: 30, width: 1280, height: 720,
    assets: [], clips: [], editLog: [], tracks: [
      { id: "titles", name: "Titles & captions", kind: "caption", muted: false, solo: false },
      { id: "video", name: "Video", kind: "video", muted: false, solo: false },
      { id: "audio", name: "Music & audio", kind: "audio", muted: false, solo: false },
    ] };
}
export function makeClip(asset: Asset | undefined, trackId: string, start = 0): Clip {
  return clipSchema.parse({ id: uid(), assetId: asset?.id, trackId, name: asset?.name ?? "Your story starts here", start,
    sourceIn: 0, sourceOut: asset?.duration ?? 4000, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    text: asset ? undefined : "Your story starts here", effects: {} });
}
const patchSchema = clipSchema.omit({ id: true, assetId: true }).partial();
export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rename"), name: z.string().trim().min(1).max(100) }).strict(),
  z.object({ type: z.literal("add"), clips: z.array(clipSchema).min(1).max(500) }).strict(),
  z.object({ type: z.literal("update"), ids: z.array(id).min(1).max(500), patch: patchSchema }).strict(),
  z.object({ type: z.literal("split"), clipId: id, at: time, newId: id }).strict(),
  z.object({ type: z.literal("delete"), ids: z.array(id).min(1).max(500), ripple: z.boolean() }).strict(),
  z.object({ type: z.literal("removeRanges"), ranges: z.array(rangeSchema).min(1).max(10000) }).strict(),
  z.object({ type: z.literal("correctToken"), assetId: id, tokenId: id, text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("track"), trackId: id, patch: trackSchema.omit({ id: true }).partial() }).strict(),
  z.object({ type: z.literal("addTrack"), track: trackSchema }).strict(),
  z.object({ type: z.literal("group"), ids: z.array(id).min(1).max(500), groupId: id.optional() }).strict(),
  z.object({ type: z.literal("captions"), assetId: id.optional() }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const commandSchema = z.object({ revision: z.number().int().nonnegative(), label: z.string().min(1).max(200), operations: z.array(operationSchema).min(1).max(500) }).strict();
export type Command = z.infer<typeof commandSchema>;
export type Proposal = { id: string; revision: number; title: string; rationale: string; operations: Operation[]; ranges: SourceRange[]; durationBefore: number; durationAfter: number; warnings: string[] };

export function validateProject(input: unknown): Project {
  const p = projectSchema.parse(input);
  for (const list of [p.assets, p.tracks, p.clips]) if (new Set(list.map(x => x.id)).size !== list.length) throw new Error("Duplicate ID");
  for (const a of p.assets) {
    if (a.tokens.some(t => t.end < t.start || t.end > a.duration + 1000)) throw new Error("Transcript timing exceeds source bounds");
  }
  for (const c of p.clips) {
    const track = p.tracks.find(t => t.id === c.trackId);
    const asset = p.assets.find(a => a.id === c.assetId);
    if (!track || (c.assetId && !asset)) throw new Error("Unknown asset or track");
    if (c.sourceOut <= c.sourceIn || (asset && c.sourceOut > asset.duration + 0.01)) throw new Error("Invalid source range");
    if (c.fadeIn + c.fadeOut > duration(c) + 0.01) throw new Error("Fades exceed clip duration");
    if (asset && (track.kind === "audio" ? !asset.hasAudio : track.kind !== "video" || !["video", "image"].includes(asset.kind))) throw new Error("Media is incompatible with track");
    if (!asset && (!["text", "caption"].includes(track.kind) || !c.text)) throw new Error("Text needs a text or caption track");
    if (clipEnd(c) > 18_000_000) throw new Error("Timeline exceeds five hours");
  }
  return p;
}

// A ripple interval slices every track at the same output times, keeping A/V in sync.
function ripple(p: Project, start: number, end: number) {
  p.clips = p.clips.flatMap(c => {
    const stop = clipEnd(c);
    if (stop <= start) return [c];
    if (c.start >= end) return [{ ...c, start: c.start - (end - start) }];
    const parts: Clip[] = [];
    if (c.start < start) parts.push({ ...c, sourceOut: toSource(c, start), fadeIn: 0, fadeOut: 0 });
    if (stop > end) parts.push({ ...c, id: parts.length ? uid() : c.id, start: Math.max(c.start, end) - (end - start), sourceIn: toSource(c, end), fadeIn: 0, fadeOut: 0 });
    return parts;
  });
}
export function mergeIntervals(ranges: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
export function tokenOccurrences(p: Project, assetId?: string) {
  return p.clips.flatMap(c => {
    const a = p.assets.find(a => a.id === c.assetId && (!assetId || a.id === assetId));
    if (!a) return [];
    return a.tokens.filter(t => t.end > c.sourceIn && t.start < c.sourceOut).map(t => ({
      token: t, assetId: a.id, clipId: c.id,
      start: toTimeline(c, Math.max(t.start, c.sourceIn)), end: toTimeline(c, Math.min(t.end, c.sourceOut)),
    }));
  }).sort((a, b) => a.start - b.start);
}
export function applyCommand(project: Project, input: unknown): Project {
  const command = commandSchema.parse(input);
  if (command.revision !== project.revision) throw new Error("Stale revision. Refresh and review the edit again.");
  const p = structuredClone(project);
  const trace: SourceRange[] = [];
  for (const op of command.operations) {
    if (op.type === "rename") p.name = op.name;
    if (op.type === "add") p.clips.push(...structuredClone(op.clips));
    if (op.type === "addTrack") p.tracks.push(op.track);
    if (op.type === "track") {
      const t = p.tracks.find(t => t.id === op.trackId);
      if (!t) throw new Error("Unknown track");
      Object.assign(t, op.patch);
    }
    if (op.type === "update" || op.type === "group" || op.type === "delete") {
      if (op.ids.some(id => !p.clips.some(c => c.id === id))) throw new Error("Unknown clip");
      if (op.type === "update") p.clips = p.clips.map(c => op.ids.includes(c.id) ? { ...c, ...op.patch } : c);
      if (op.type === "group") p.clips.forEach(c => { if (op.ids.includes(c.id)) c.groupId = op.groupId; });
      if (op.type === "delete") {
        const selected = p.clips.filter(c => op.ids.includes(c.id));
        p.clips = p.clips.filter(c => !op.ids.includes(c.id));
        if (op.ripple) for (const r of mergeIntervals(selected.map(c => ({ start: c.start, end: clipEnd(c) }))).reverse()) ripple(p, r.start, r.end);
      }
    }
    if (op.type === "split") {
      const c = p.clips.find(c => c.id === op.clipId);
      if (!c || op.at <= c.start + 1 || op.at >= clipEnd(c) - 1) throw new Error("Place the playhead inside the clip to split");
      const source = toSource(c, op.at);
      p.clips.push({ ...c, id: op.newId, start: op.at, sourceIn: source, fadeIn: 0, fadeOut: 0 });
      c.sourceOut = source; c.fadeIn = 0; c.fadeOut = 0;
    }
    if (op.type === "removeRanges") {
      const intervals: { start: number; end: number }[] = [];
      for (const r of op.ranges) {
        const a = p.assets.find(a => a.id === r.assetId);
        if (!a || r.end <= r.start || r.end > a.duration || r.tokenIds?.some(id => !a.tokens.some(t => t.id === id))) throw new Error("Invalid transcript source range");
        for (const c of p.clips.filter(c => c.assetId === a.id)) {
          const start = Math.max(c.sourceIn, r.start), end = Math.min(c.sourceOut, r.end);
          if (end > start) intervals.push({ start: toTimeline(c, start), end: toTimeline(c, end) });
        }
        trace.push(r);
      }
      if (!intervals.length) throw new Error("These source ranges are no longer on the timeline");
      for (const r of mergeIntervals(intervals).reverse()) ripple(p, r.start, r.end);
    }
    if (op.type === "correctToken") {
      const token = p.assets.find(a => a.id === op.assetId)?.tokens.find(t => t.id === op.tokenId);
      if (!token) throw new Error("Unknown transcript token");
      token.text = op.text; token.corrected = token.text !== token.original;
    }
    if (op.type === "captions") {
      const track = p.tracks.find(t => t.kind === "caption");
      if (!track) throw new Error("Add a caption track first");
      const words = tokenOccurrences(p, op.assetId);
      if (!words.length) throw new Error("Transcribe media before generating captions");
      p.clips = p.clips.filter(c => c.trackId !== track.id || c.assetId || !c.name.startsWith("Caption"));
      for (let i = 0; i < words.length;) {
        const group = [words[i++]];
        while (i < words.length && group.length < 7 && words[i].clipId === group[0].clipId && words[i].end - group[0].start < 3500 && words[i].start - group.at(-1)!.end < 800) group.push(words[i++]);
        const text = group.map(w => w.token.text).join("").trim();
        if (!text) continue;
        p.clips.push({ ...makeClip(undefined, track.id, group[0].start), name: `Caption ${i}`, text, sourceOut: Math.max(80, group.at(-1)!.end - group[0].start), fontSize: 42, effects: effectsSchema.parse({ y: 0.36 }) });
      }
    }
  }
  p.revision++; p.updatedAt = new Date().toISOString();
  p.editLog = [...p.editLog.slice(-999), { id: uid(), revision: p.revision, label: command.label, ranges: trace, at: p.updatedAt }];
  return validateProject(p);
}
export function transact(history: ProjectHistory, command: unknown): ProjectHistory {
  const next = applyCommand(history.project, command);
  return { project: next, undo: [...history.undo.slice(-49), history.project], redo: [] };
}
export function undoRedo(h: ProjectHistory, action: "undo" | "redo", revision: number): ProjectHistory {
  if (h.project.revision !== revision) throw new Error("Stale revision");
  const from = action === "undo" ? h.undo : h.redo;
  if (!from.length) throw new Error(`Nothing to ${action}`);
  const p = structuredClone(from.at(-1)!);
  // Media/transcription jobs are external state, not timeline history. Never discard a completed job on undo.
  p.assets = h.project.assets.map(a => ({ ...a, tokens: a.tokens.map(t => {
    const old = p.assets.find(x => x.id === a.id)?.tokens.find(x => x.id === t.id);
    return old ? { ...t, text: old.text, corrected: old.corrected } : t;
  }) }));
  p.revision = h.project.revision + 1; p.updatedAt = new Date().toISOString();
  return action === "undo" ? { project: validateProject(p), undo: from.slice(0, -1), redo: [...h.redo, h.project] } : { project: validateProject(p), undo: [...h.undo, h.project], redo: from.slice(0, -1) };
}
export function buildProposal(p: Project, title: string, rationale: string, operations: Operation[], ranges: SourceRange[] = [], warnings: string[] = []): Proposal {
  const result = applyCommand(p, { revision: p.revision, label: title, operations });
  return { id: uid(), revision: p.revision, title, rationale, operations, ranges, warnings, durationBefore: projectDuration(p), durationAfter: projectDuration(result) };
}
