import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Project, duration, projectDuration, uid, validateProject } from "../timeline";
import { atomicJson, loadProject, locked, mediaPath, projectDir, safeId } from "./store";
import { probeMedia, runFFmpeg } from "./media";

export type RenderJob = {
  id: string;
  projectId: string;
  status: "queued" | "rendering" | "completed" | "failed" | "cancelled";
  progress: number;
  error?: string;
  /** Milliseconds, like all timeline/source times. */
  duration: number;
  revision: number;
};

export type RenderPlan = {
  duration: number;
  revision: number;
  width: 1280;
  height: 720;
  fps: 30;
  /** Back-to-front order; tracks[0] is painted last. */
  clipIds: string[];
  inputs: { assetId: string; clipId: string }[];
  textFiles: { name: string; content: string }[];
  filterComplex: string;
  /** Run in the job directory after writing textFiles. */
  args: string[];
};

const jobDir = (projectId: string, id: string) => path.join(projectDir(projectId), "renders", safeId(id));
export const exportPath = (projectId: string, id: string) => path.join(jobDir(projectId, id), "export.mp4");
const seconds = (ms: number) => Number((ms / 1000).toFixed(6));
const number = (value: number) => Number(value.toFixed(6));

export function buildRenderPlan(input: Project): RenderPlan {
  const project = validateProject(input);
  const total = projectDuration(project);
  const configured = Number(process.env.RENDER_MAX_DURATION_SECONDS);
  const maximum = Number.isFinite(configured) && configured > 0 ? Math.min(600, configured) : 600;
  const configuredPixels = Number(process.env.MEDIA_MAX_PIXELS);
  const maxPixels = Number.isSafeInteger(configuredPixels) && configuredPixels > 0 ? configuredPixels : 3840 * 2160;
  if (total <= 0) throw new Error("Add clips before exporting");
  if (total > maximum * 1000) throw new Error("Export exceeds the duration limit (maximum 10 minutes)");
  const solo = project.tracks.some(t => t.solo);
  const clips = project.tracks.slice().reverse().filter(t => !t.muted && (!solo || t.solo)).flatMap(track =>
    project.clips.filter(c => c.trackId === track.id).sort((a, b) => a.start - b.start));
  const inputs: RenderPlan["inputs"] = [], textFiles: RenderPlan["textFiles"] = [];
  const args: string[] = [], filters: string[] = [], audio: string[] = [];
  filters.push(`color=c=black:s=1280x720:r=30:d=${seconds(total)},format=rgba[base0]`);
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(total)}[silence]`);
  let layer = 0;
  for (const [index, clip] of clips.entries()) {
    const asset = project.assets.find(a => a.id === clip.assetId);
    const track = project.tracks.find(t => t.id === clip.trackId)!;
    const length = seconds(duration(clip)), start = seconds(clip.start), end = seconds(clip.start + duration(clip));
    const effects = clip.effects;
    const fadeIn = clip.fadeIn || (clip.transition === "fade" ? Math.min(250, duration(clip) / 2) : 0);
    const fadeOut = clip.fadeOut || (clip.transition === "fade" ? Math.min(250, duration(clip) / 2) : 0);
    let source = "";
    if (asset) {
      const slot = inputs.length;
      inputs.push({ assetId: asset.id, clipId: clip.id });
      args.push("-threads", "2", "-max_pixels", String(maxPixels), "-max_streams", "16", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,wav,mp3,aac,flac,ogg,png_pipe,jpeg_pipe,webp_pipe,image2");
      if (asset.kind === "image") args.push("-f", "image2", "-pattern_type", "none", "-loop", "1", "-framerate", "30", "-t", String(length));
      else args.push("-ss", String(seconds(clip.sourceIn)), "-t", String(seconds(clip.sourceOut - clip.sourceIn)));
      args.push("-i", mediaPath(project.id, asset.id));
      source = `${slot}`;
      if (asset.hasAudio && clip.volume > 0) {
        let speed = clip.speed;
        const tempo: number[] = [];
        while (speed > 2) { tempo.push(2); speed /= 2; }
        while (speed < 0.5) { tempo.push(0.5); speed /= 0.5; }
        tempo.push(speed);
        const chain = [`[${source}:a:0]asetpts=PTS-STARTPTS`, ...tempo.map(v => `atempo=${v}`), "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo", `volume=${clip.volume}`, `apad=whole_dur=${length}`, `atrim=duration=${length}`];
        if (fadeIn) chain.push(`afade=t=in:st=0:d=${seconds(fadeIn)}`);
        if (fadeOut) chain.push(`afade=t=out:st=${seconds(duration(clip) - fadeOut)}:d=${seconds(fadeOut)}`);
        chain.push(`adelay=${Math.round(clip.start * 48)}S:all=1[a${index}]`);
        filters.push(chain.join(",")); audio.push(`[a${index}]`);
      }
    }
    if (track.kind === "audio") continue;
    const chain: string[] = [];
    if (asset) {
      chain.push(`[${source}:V:0]setpts=(PTS-STARTPTS)/${asset.kind === "image" ? 1 : clip.speed}`, "fps=30", `trim=duration=${length}`);
      if (effects.crop) chain.push(`crop=iw*${number(1 - 2 * effects.crop)}:ih*${number(1 - 2 * effects.crop)}:iw*${effects.crop}:ih*${effects.crop}`);
      chain.push("scale=1280:720:force_original_aspect_ratio=decrease", "setsar=1");
    } else {
      const name = `text-${index}.txt`;
      textFiles.push({ name, content: (clip.text ?? "").replace(/\0/g, "") });
      chain.push(`color=c=black@0:s=1280x720:r=30:d=${length}`, "format=rgba", `drawtext=textfile=${name}:expansion=none:font=Sans:fontsize=${clip.fontSize}:fontcolor=0x${clip.textColor.slice(1)}:x=(w-text_w)/2:y=(h-text_h)/2`);
      if (effects.crop) chain.push(`crop=iw*${number(1 - 2 * effects.crop)}:ih*${number(1 - 2 * effects.crop)}:iw*${effects.crop}:ih*${effects.crop}`);
    }
    if (effects.scale !== 1) chain.push(`scale=trunc(iw*${effects.scale}/2)*2:trunc(ih*${effects.scale}/2)*2`);
    if (effects.brightness || effects.contrast !== 1 || effects.saturation !== 1) chain.push(`eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`);
    chain.push("format=rgba");
    if (effects.rotation) {
      const angle = number(effects.rotation * Math.PI / 180);
      chain.push(`rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none`);
    }
    if (fadeIn) chain.push(`fade=t=in:st=0:d=${seconds(fadeIn)}:alpha=1`);
    if (fadeOut) chain.push(`fade=t=out:st=${seconds(duration(clip) - fadeOut)}:d=${seconds(fadeOut)}:alpha=1`);
    chain.push(`setpts=PTS+${start}/TB[v${index}]`);
    filters.push(chain.join(","));
    filters.push(`[base${layer}][v${index}]overlay=x=(W-w)/2+${number(effects.x * 1280)}:y=(H-h)/2+${number(effects.y * 720)}:eof_action=pass:repeatlast=0:format=auto:enable='gte(t,${start})*lt(t,${end})'[base${++layer}]`);
  }
  filters.push(`[base${layer}]format=yuv420p[vout]`);
  filters.push(`[silence]${audio.join("")}amix=inputs=${audio.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=duration=${seconds(total)}[aout]`);
  const filterComplex = filters.join(";");
  args.push("-filter_complex", filterComplex, "-map", "[vout]", "-map", "[aout]", "-t", String(seconds(total)),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-map_chapters", "-1",
    "-max_muxing_queue_size", "1024", "-movflags", "+faststart", "-f", "mp4", "export.part.mp4");
  return { duration: total, revision: project.revision, width: 1280, height: 720, fps: 30, clipIds: clips.map(c => c.id), inputs, textFiles, filterComplex, args };
}

type Work = {
  job: RenderJob;
  plan: RenderPlan;
  controller: AbortController;
  writes: Promise<void>;
  done: Promise<void>;
  resolve: () => void;
};
// One queue per Node process, also retained across development module reloads.
const globalQueue = globalThis as typeof globalThis & { __videoRenderQueue?: { jobs: Map<string, Work>; queue: Work[]; running: boolean } };
const state = globalQueue.__videoRenderQueue ??= { jobs: new Map<string, Work>(), queue: [] as Work[], running: false };
const key = (projectId: string, id: string) => `${safeId(projectId)}/${safeId(id)}`;
const publicJob = (job: RenderJob): RenderJob => ({ ...job });

function persist(work: Work) {
  const snapshot = publicJob(work.job);
  work.writes = work.writes.catch(() => {}).then(() => atomicJson(path.join(jobDir(snapshot.projectId, snapshot.id), "job.json"), snapshot));
  return work.writes;
}

async function cleanup(job: RenderJob) {
  await rm(path.join(jobDir(job.projectId, job.id), "export.part.mp4"), { force: true });
  if (job.status !== "completed") await rm(exportPath(job.projectId, job.id), { force: true });
}

async function perform(work: Work) {
  const { job, plan, controller } = work;
  try {
    job.status = "rendering";
    await persist(work);
    for (const assetId of new Set(plan.inputs.map(i => i.assetId))) {
      if (controller.signal.aborted) throw new Error();
      await probeMedia(mediaPath(job.projectId, assetId));
    }
    if (controller.signal.aborted) throw new Error();
    let lastPersist = 0;
    await runFFmpeg(plan.args, {
      cwd: jobDir(job.projectId, job.id), signal: controller.signal, duration: job.duration,
      progress(percent) {
        job.progress = Math.max(job.progress, Math.min(99, Math.floor(percent)));
        if (Date.now() - lastPersist >= 1000) {
          lastPersist = Date.now();
          void persist(work).catch(() => controller.abort());
        }
      },
    });
    if (controller.signal.aborted) throw new Error();
    await rename(path.join(jobDir(job.projectId, job.id), "export.part.mp4"), exportPath(job.projectId, job.id));
    if (controller.signal.aborted) throw new Error();
    job.status = "completed"; job.progress = 100;
  } catch {
    job.status = controller.signal.aborted ? "cancelled" : "failed";
    if (job.status === "failed") job.error = "Export failed. Check that source media is available and valid.";
  } finally {
    try { await cleanup(job); await persist(work); }
    catch {
      job.status = "failed"; job.error = "Export could not be saved.";
      await cleanup(job).catch(() => {});
      await persist(work).catch(() => {});
    }
    state.jobs.delete(key(job.projectId, job.id));
    state.running = false;
    work.resolve();
    pump();
  }
}

function pump() {
  if (state.running) return;
  const work = state.queue.shift();
  if (!work) return;
  state.running = true;
  void perform(work);
}

export async function startRender(projectId: string): Promise<RenderJob> {
  safeId(projectId);
  return locked("render:queue", async () => {
    if (state.jobs.size >= 6) throw new Error("Export queue is full. Wait for an export to finish.");
    const project = await loadProject(projectId).catch(() => { throw new Error("Project could not be loaded"); });
    const plan = buildRenderPlan(project);
    const job: RenderJob = { id: uid(), projectId, status: "queued", progress: 0, duration: plan.duration, revision: project.revision };
    const directory = jobDir(projectId, job.id);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await atomicJson(path.join(directory, "project.json"), project);
      for (const file of plan.textFiles) {
        const temp = path.join(directory, `${file.name}.tmp`);
        await writeFile(temp, file.content, { flag: "wx", mode: 0o600 });
        await rename(temp, path.join(directory, file.name));
      }
      await atomicJson(path.join(directory, "job.json"), job);
    } catch {
      await rm(directory, { force: true, recursive: true }).catch(() => {});
      throw new Error("Export could not be queued");
    }
    let resolve!: () => void;
    const work: Work = { job, plan, controller: new AbortController(), writes: Promise.resolve(), done: new Promise<void>(r => { resolve = r; }), resolve: () => resolve() };
    state.jobs.set(key(projectId, job.id), work);
    state.queue.push(work);
    const result = publicJob(job);
    pump();
    return result;
  });
}

async function readJob(projectId: string, id: string): Promise<RenderJob> {
  const directory = jobDir(projectId, id);
  let job: RenderJob;
  try {
    const stored = JSON.parse(await readFile(path.join(directory, "job.json"), "utf8")) as RenderJob;
    if (stored.id !== id || stored.projectId !== projectId || !["queued", "rendering", "completed", "failed", "cancelled"].includes(stored.status) || !Number.isFinite(stored.progress) || stored.progress < 0 || stored.progress > 100 || !Number.isFinite(stored.duration) || !Number.isSafeInteger(stored.revision)) throw new Error();
    job = { id, projectId, status: stored.status, progress: stored.progress, duration: stored.duration, revision: stored.revision };
    if (job.status === "failed") job.error = "Export failed or was interrupted. Start a new export.";
  } catch { throw new Error("Render not found"); }
  if (job.status === "queued" || job.status === "rendering") {
    job.status = "failed";
    job.error = "Export interrupted. Start a new export.";
    try { await cleanup(job); await atomicJson(path.join(directory, "job.json"), job); }
    catch { throw new Error("Render recovery failed"); }
  }
  return job;
}

export async function getRender(projectId: string, id: string): Promise<RenderJob> {
  return locked("render:queue", async () => {
    const work = state.jobs.get(key(projectId, id));
    return work ? publicJob(work.job) : readJob(projectId, id);
  });
}

async function cancel(work: Work) {
  work.controller.abort();
  const index = state.queue.indexOf(work);
  if (index !== -1) {
    state.queue.splice(index, 1);
    work.job.status = "cancelled";
    try { await cleanup(work.job); await persist(work); }
    catch { throw new Error("Render cancellation failed"); }
    finally { state.jobs.delete(key(work.job.projectId, work.job.id)); work.resolve(); }
  }
  await work.done;
}

export async function cancelRender(projectId: string, id: string): Promise<void> {
  await locked("render:queue", async () => {
    const work = state.jobs.get(key(projectId, id));
    if (work) await cancel(work);
    else await readJob(projectId, id);
  });
}

export async function cancelProjectRenders(projectId: string): Promise<void> {
  safeId(projectId);
  await locked("render:queue", async () => {
    const jobs = [...state.jobs.values()].filter(work => work.job.projectId === projectId);
    // Remove waiting jobs before stopping the worker so it cannot start them.
    await Promise.all(jobs.filter(work => state.queue.includes(work)).map(cancel));
    await Promise.all(jobs.filter(work => state.jobs.has(key(projectId, work.job.id))).map(cancel));
  });
}
