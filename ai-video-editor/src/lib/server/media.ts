import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type Asset, type Token, uid } from "../timeline";
import { loadProject, mediaDir, mediaPath, mutateProject } from "./store";

function limit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export type FFmpegOptions = {
  signal?: AbortSignal;
  /** Timeline duration in milliseconds; progress receives a percentage. */
  duration?: number;
  progress?: (percent: number) => void;
  cwd?: string;
  timeoutMs?: number;
  /** Consumes PCM incrementally instead of buffering stdout. */
  onStdout?: (chunk: Buffer) => void;
};

function aborted() {
  return new DOMException("Media operation cancelled", "AbortError");
}

function runProcess(command: "ffmpeg" | "ffprobe", args: string[], options: FFmpegOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(aborted()); return; }
    const child = spawn(command, args, {
      cwd: options.cwd, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "ignore", "pipe"],
      // Native decoders do not need application/provider credentials.
      env: { NODE_ENV: process.env.NODE_ENV ?? "production", PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG ?? "C.UTF-8", OMP_NUM_THREADS: "2", OPENBLAS_NUM_THREADS: "2" },
    });
    const chunks: Buffer[] = [];
    let bytes = 0, progressBuffer = "", failure: Error | undefined, finished = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      if (failure || finished) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const abort = () => stop(aborted());
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop(new Error("Media processing timed out")), options.timeoutMs ?? limit("FFMPEG_TIMEOUT_MS", 900_000));
    timer.unref();
    // FFmpeg's max_alloc only limits individual allocations, not aggregate RSS.
    // On Linux, stop memory-heavy decoders/graphs as well; a container/cgroup is
    // still needed for a hard, instantaneous OS memory boundary.
    let checkingMemory = false;
    const memoryTimer = process.platform === "linux" ? setInterval(() => {
      if (!child.pid || checkingMemory || finished) return;
      checkingMemory = true;
      void readFile(`/proc/${child.pid}/status`, "utf8").then(status => {
        const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]) * 1024;
        if (rss > limit("FFMPEG_MAX_RSS_BYTES", 256 * 1024 * 1024)) stop(new Error("Media processing exceeded the memory limit"));
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") stop(new Error("Media resource monitoring failed"));
      }).finally(() => { checkingMemory = false; });
    }, 100) : undefined;
    memoryTimer?.unref();
    child.stdout!.on("data", (chunk: Buffer) => {
      if (failure) return;
      try {
        if (options.onStdout) options.onStdout(chunk);
        else {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { stop(new Error("Media processing output exceeds limit")); return; }
          chunks.push(chunk);
        }
      } catch { stop(new Error("Media analysis exceeds processing limits")); }
    });
    child.stdio[3]!.on("data", (chunk: Buffer) => {
      progressBuffer += chunk.toString("utf8");
      const lines = progressBuffer.split("\n");
      progressBuffer = lines.pop()!.slice(-4096);
      for (const line of lines) {
        if (!line.startsWith("out_time_us=") || !options.duration) continue;
        const ms = Number(line.slice(12)) / 1000;
        if (Number.isFinite(ms)) {
          try { options.progress?.(Math.max(0, Math.min(100, ms / options.duration * 100))); }
          catch { stop(new Error("Media progress update failed")); }
        }
      }
    });
    child.on("error", () => { failure ??= new Error("Media processor is unavailable"); });
    child.on("close", code => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearInterval(memoryTimer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error("Media processing failed"));
      else resolve(Buffer.concat(chunks));
    });
    if (options.signal?.aborted) abort();
  });
}

/** Arguments are server-owned argv, never a shell command or user-supplied filter. */
export function runFFmpeg(args: string[], options: FFmpegOptions = {}): Promise<Buffer> {
  return runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-max_alloc", String(limit("FFMPEG_MAX_ALLOC_BYTES", 256 * 1024 * 1024)),
    "-threads", "2", "-filter_threads", "1", "-filter_complex_threads", "1",
    "-progress", "pipe:3", "-nostats", ...args,
  ], options);
}

type Signature = "mov" | "matroska" | "avi" | "wav" | "mp3" | "aac" | "flac" | "ogg" | "png_pipe" | "jpeg_pipe" | "webp_pipe";
export type MediaMetadata = {
  kind: "video" | "audio" | "image";
  duration: number;
  hasAudio: boolean;
  width?: number;
  height?: number;
  videoStream?: number;
  audioStream?: number;
  videoCodec?: string;
  audioCodec?: string;
  fps?: number;
  format: Signature;
};

// Pin a demuxer from the signature. Protocol whitelisting alone still permits
// local-file playlists (concat/HLS), which must never reach a demuxer.
async function signature(file: string): Promise<Signature> {
  const info = await lstat(file);
  if (!info.isFile() || info.size < 4 || info.size > limit("MEDIA_MAX_BYTES", 256 * 1024 * 1024)) throw new Error("Invalid media size or file");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  const header = Buffer.alloc(32);
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png_pipe";
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return "jpeg_pipe";
  if (header.toString("ascii", 0, 4) === "RIFF") {
    const type = header.toString("ascii", 8, 12);
    if (type === "WAVE") return "wav";
    if (type === "AVI ") return "avi";
    if (type === "WEBP") return "webp_pipe";
  }
  if (header.toString("ascii", 4, 8) === "ftyp") return "mov";
  if (header.readUInt32BE(0) === 0x1a45dfa3) return "matroska";
  if (header.toString("ascii", 0, 4) === "fLaC") return "flac";
  if (header.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (header[0] === 255 && (header[1] & 0xf6) === 0xf0) return "aac";
  if (header.toString("ascii", 0, 3) === "ID3" || (header[0] === 255 && (header[1] & 0xe0) === 0xe0 && (header[1] & 6) !== 0)) return "mp3";
  throw new Error("Unsupported media signature");
}

export async function probeMedia(file: string): Promise<MediaMetadata> {
  try {
    const format = await signature(file);
    const output = await runProcess("ffprobe", [
      "-v", "error", "-max_alloc", String(limit("FFMPEG_MAX_ALLOC_BYTES", 256 * 1024 * 1024)),
      "-threads", "2", "-max_pixels", String(limit("MEDIA_MAX_PIXELS", 3840 * 2160)),
      "-max_streams", "16", "-protocol_whitelist", "file,pipe", "-format_whitelist", format,
      "-f", format, "-probesize", "5000000", "-analyzeduration", "5000000",
      "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,duration,avg_frame_rate:stream_disposition=attached_pic",
      "-of", "json", path.resolve(file),
    ], { timeoutMs: 30_000 });
    const result = JSON.parse(output.toString("utf8")) as {
      format?: { duration?: string };
      streams?: { index: number; codec_type: string; codec_name?: string; width?: number; height?: number; duration?: string; avg_frame_rate?: string; disposition?: { attached_pic?: number } }[];
    };
    const streams = result.streams ?? [];
    if (streams.length > 16) throw new Error();
    const video = streams.find(s => s.codec_type === "video" && !s.disposition?.attached_pic);
    const audio = streams.find(s => s.codec_type === "audio");
    const image = ["png_pipe", "jpeg_pipe", "webp_pipe"].includes(format);
    if ((!video && !audio) || (image && (!video || audio))) throw new Error();
    if (streams.some(s => !s.codec_name && ["audio", "video"].includes(s.codec_type))) throw new Error();
    if (video && (!video.width || !video.height || video.width < 1 || video.height < 1 || video.width > 8192 || video.height > 8192 || video.width * video.height > limit("MEDIA_MAX_PIXELS", 3840 * 2160))) throw new Error();
    const seconds = Math.max(0, ...[result.format?.duration, ...streams.map(s => s.duration)].map(d => Number(d)).filter(Number.isFinite));
    if (!image && (seconds <= 0 || seconds > limit("MEDIA_MAX_DURATION_SECONDS", 600))) throw new Error();
    const [numerator, denominator] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);
    const fps = numerator / denominator;
    return {
      kind: image ? "image" : video ? "video" : "audio", duration: image ? 5000 : Math.max(1, Math.round(seconds * 1000)),
      hasAudio: !!audio, width: video?.width, height: video?.height,
      videoStream: video?.index, audioStream: audio?.index, format,
      videoCodec: video?.codec_name, audioCodec: audio?.codec_name,
      fps: !image && Number.isFinite(fps) && fps > 0 ? fps : undefined,
    };
  } catch { throw new Error("Invalid, unsupported, or oversized media"); }
}

const uploads: Record<string, { mime: string[]; format: Signature | "subtitle"; kind: Asset["kind"] | "av" }> = {
  mp4: { mime: ["video/mp4", "audio/mp4"], format: "mov", kind: "av" },
  m4v: { mime: ["video/mp4", "video/x-m4v"], format: "mov", kind: "video" },
  mov: { mime: ["video/quicktime"], format: "mov", kind: "video" },
  webm: { mime: ["video/webm", "audio/webm"], format: "matroska", kind: "av" },
  mkv: { mime: ["video/x-matroska", "audio/x-matroska"], format: "matroska", kind: "av" },
  mka: { mime: ["audio/x-matroska"], format: "matroska", kind: "audio" },
  avi: { mime: ["video/x-msvideo", "video/avi"], format: "avi", kind: "video" },
  m4a: { mime: ["audio/mp4", "audio/x-m4a"], format: "mov", kind: "audio" },
  mp3: { mime: ["audio/mpeg", "audio/mp3"], format: "mp3", kind: "audio" },
  aac: { mime: ["audio/aac", "audio/x-aac"], format: "aac", kind: "audio" },
  wav: { mime: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"], format: "wav", kind: "audio" },
  flac: { mime: ["audio/flac", "audio/x-flac"], format: "flac", kind: "audio" },
  ogg: { mime: ["audio/ogg", "application/ogg"], format: "ogg", kind: "audio" },
  oga: { mime: ["audio/ogg", "application/ogg"], format: "ogg", kind: "audio" },
  png: { mime: ["image/png"], format: "png_pipe", kind: "image" },
  jpg: { mime: ["image/jpeg"], format: "jpeg_pipe", kind: "image" },
  jpeg: { mime: ["image/jpeg"], format: "jpeg_pipe", kind: "image" },
  webp: { mime: ["image/webp"], format: "webp_pipe", kind: "image" },
  srt: { mime: ["application/x-subrip", "application/srt", "text/srt", "text/plain"], format: "subtitle", kind: "subtitle" },
  vtt: { mime: ["text/vtt", "text/plain"], format: "subtitle", kind: "subtitle" },
};

function parseSubtitles(bytes: Buffer, vtt: boolean): Token[] {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); }
  catch { throw new Error("Subtitles must be UTF-8 text"); }
  if (text.includes("\0") || (vtt && !/^WEBVTT(?:[ \t].*)?\n/.test(text))) throw new Error("Invalid subtitle file");
  const tokens: Token[] = [];
  const timestamp = "((?:\\d{2,}:)?\\d{2}:\\d{2}[.,]\\d{3})";
  const timing = new RegExp(`^${timestamp}\\s+-->\\s+${timestamp}(?:[ \\t]+.*)?$`);
  const ms = (value: string) => {
    const parts = value.replace(",", ".").split(":").map(Number);
    const seconds = parts.pop()!, minutes = parts.pop()!, hours = parts.pop() ?? 0;
    if (seconds >= 60 || minutes >= 60) throw new Error("Invalid subtitle timestamp");
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  };
  for (const block of text.trim().split(/\n[ \t]*\n/)) {
    if (vtt && /^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split("\n");
    if (!lines[0].includes("-->")) lines.shift();
    const match = lines.shift()?.match(timing);
    if (!match) throw new Error("Invalid subtitle cue");
    const start = ms(match[1]), end = ms(match[2]);
    const content = lines.join("\n").replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|nbsp);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " })[entity]!).trim();
    if (end <= start || end > limit("MEDIA_MAX_DURATION_SECONDS", 600) * 1000 || !content || content.length > 2000 || tokens.length >= 200_000) throw new Error("Invalid or oversized subtitle cue");
    tokens.push({ id: uid(), text: content, original: content, start, end });
  }
  if (!tokens.length) throw new Error("Subtitle file contains no cues");
  return tokens.sort((a, b) => a.start - b.start);
}

async function analyzeAudio(source: string, metadata: MediaMetadata) {
  const rate = 8000, windowSize = 160;
  const count = Math.min(2000, Math.max(1, Math.ceil(metadata.duration / 50)));
  const waveform = Array<number>(count).fill(0);
  const silence: Asset["silence"] = [];
  let samples = 0, sum = 0, windowSamples = 0, silentStart: number | undefined, carry: number | undefined;
  const window = () => {
    if (Math.sqrt(sum / windowSamples) < 0.01) silentStart ??= (samples - windowSamples) / rate * 1000;
    else if (silentStart !== undefined) {
      const stop = (samples - windowSamples) / rate * 1000;
      if (stop - silentStart >= 300) silence.push({ start: Math.round(silentStart), end: Math.round(stop) });
      silentStart = undefined;
    }
    sum = 0; windowSamples = 0;
  };
  await runFFmpeg([
    "-protocol_whitelist", "file,pipe", "-max_streams", "16", "-f", metadata.format, "-i", source,
    "-map", `0:${metadata.audioStream}`, "-vn", "-t", String(metadata.duration / 1000),
    "-ac", "1", "-ar", String(rate), "-c:a", "pcm_s16le", "-threads", "2", "-f", "s16le", "pipe:1",
  ], { onStdout(chunk) {
    let offset = 0;
    const sample = (value: number) => {
      if (samples > Math.ceil(metadata.duration / 1000 * rate) + rate) throw new Error();
      const amplitude = Math.abs(value / 32768);
      const bin = Math.min(count - 1, Math.floor(samples / rate * 1000 / metadata.duration * count));
      waveform[bin] = Math.max(waveform[bin], amplitude);
      samples++; sum += amplitude * amplitude; windowSamples++;
      if (windowSamples === windowSize) window();
    };
    if (carry !== undefined && chunk.length) { sample((carry | chunk[0] << 8) << 16 >> 16); carry = undefined; offset = 1; }
    for (; offset + 1 < chunk.length; offset += 2) sample(chunk.readInt16LE(offset));
    if (offset < chunk.length) carry = chunk[offset];
  } });
  if (!samples) throw new Error("Media contains no decodable audio");
  if (windowSamples) window();
  const end = Math.min(metadata.duration, samples / rate * 1000);
  if (silentStart !== undefined && end - silentStart >= 300) silence.push({ start: Math.round(silentStart), end: Math.round(end) });
  return { waveform: waveform.map(v => Math.round(v * 10000) / 10000), silence };
}

const globalImports = globalThis as typeof globalThis & { __videoMediaImports?: { active: number } };
const imports = globalImports.__videoMediaImports ??= { active: 0 };

export async function importMedia(projectId: string, file: File): Promise<Asset> {
  if (imports.active >= 2) throw new Error("Two media imports are already running. Try again shortly.");
  const directory = mediaDir(projectId);
  const extension = path.extname(file.name).slice(1).toLowerCase();
  const spec = Object.hasOwn(uploads, extension) ? uploads[extension] : undefined;
  const mime = file.type.toLowerCase().split(";")[0].trim();
  // Empty/octet-stream MIME is common for local files. In that case the
  // extension AND signature/probed streams, rather than the browser, decide.
  if (!spec || (mime && mime !== "application/octet-stream" && !spec.mime.includes(mime))) throw new Error("Unsupported file extension or MIME type");
  if (!file.name || file.name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(file.name)) throw new Error("Invalid file name");
  const maxBytes = spec.kind === "subtitle" ? Math.min(2 * 1024 * 1024, limit("MEDIA_MAX_BYTES", 256 * 1024 * 1024)) : limit("MEDIA_MAX_BYTES", 256 * 1024 * 1024);
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maxBytes) throw new Error("File exceeds the upload size limit");
  imports.active++;
  const id = uid(), temp = path.join(directory, `.import-${id}`);
  const source = path.join(temp, "input.source");
  const published: string[] = [];
  try {
    const project = await loadProject(projectId);
    if (project.assets.length >= 100) throw new Error("Project asset limit reached");
    await mkdir(temp, { recursive: true, mode: 0o700 });
    const handle = await open(source, "wx", 0o600);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bytes = 0;
    try {
      reader = file.stream().getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > maxBytes || bytes > file.size) throw new Error("File exceeds the upload size limit");
        await handle.writeFile(result.value);
      }
      if (bytes !== file.size) throw new Error("Incomplete upload");
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); await handle.close(); }

    let asset: Asset;
    if (spec.kind === "subtitle") {
      const tokens = parseSubtitles(await readFile(source), extension === "vtt");
      asset = { id, name: file.name, kind: "subtitle", duration: tokens.reduce((end, token) => Math.max(end, token.end), 0), hasAudio: false, bytes, mime: extension === "vtt" ? "text/vtt" : "application/x-subrip", waveform: [], silence: [], thumbnail: false, tokens, transcription: "completed" };
    } else {
      const metadata = await probeMedia(source);
      if (metadata.format !== spec.format || (spec.kind !== "av" && metadata.kind !== spec.kind) || (mime.startsWith("audio/") && metadata.kind !== "audio") || (mime.startsWith("video/") && metadata.kind !== "video")) throw new Error("File contents do not match its extension and MIME type");
      asset = { id, name: file.name, kind: metadata.kind, duration: metadata.duration, width: metadata.width, height: metadata.height, hasAudio: metadata.hasAudio, bytes, mime: spec.mime.find(value => value.startsWith(`${metadata.kind}/`)) ?? spec.mime[0], waveform: [], silence: [], thumbnail: false, tokens: [], transcription: "idle" };
      const input = ["-protocol_whitelist", "file,pipe", "-max_pixels", String(limit("MEDIA_MAX_PIXELS", 3840 * 2160)), "-max_streams", "16", "-f", metadata.format, "-i", source];
      if (metadata.hasAudio) Object.assign(asset, await analyzeAudio(source, metadata));
      if (metadata.kind !== "image") {
        await runFFmpeg([
          ...input, ...(metadata.kind === "video" ? ["-map", `0:${metadata.videoStream}`, "-vf", "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p"] : ["-vn"]),
          ...(metadata.hasAudio ? ["-map", `0:${metadata.audioStream}`, "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000"] : ["-an"]),
          "-t", String(metadata.duration / 1000), "-threads", "2", "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-f", "mp4", path.join(temp, "preview.mp4"),
        ]);
      }
      if (metadata.kind !== "audio") {
        await runFFmpeg([...input, "-map", `0:${metadata.videoStream}`, "-frames:v", "1", "-an", "-vf", "scale=320:180:force_original_aspect_ratio=decrease", "-c:v", "mjpeg", "-threads", "2", "-q:v", "3", "-f", "image2", path.join(temp, "thumb.jpg")]);
        asset.thumbnail = true;
      }
    }
    const files: [string, "source" | "preview" | "thumb"][] = [[source, "source"]];
    if (asset.kind === "video" || asset.kind === "audio") files.push([path.join(temp, "preview.mp4"), "preview"]);
    if (asset.thumbnail) files.push([path.join(temp, "thumb.jpg"), "thumb"]);
    for (const [from, variant] of files) {
      const to = mediaPath(projectId, id, variant);
      await chmod(from, 0o600);
      await rename(from, to); published.push(to);
    }
    await mutateProject(projectId, p => {
      if (p.assets.length >= 100) throw new Error("Project asset limit reached");
      p.assets.push(asset); return p;
    });
    return asset;
  } catch (error) {
    await Promise.all(published.map(file => rm(file, { force: true }).catch(() => {})));
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code) throw new Error("Media import failed");
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
    imports.active--;
  }
}
