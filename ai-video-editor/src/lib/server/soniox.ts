import { spawn } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normalizeTokens } from "../transcript";
import { type Asset, type Token, uid } from "../timeline";
import { DATA, atomicJson, loadProject, locked, mediaPath, mutateProject, safeId } from "./store";

const API = "https://api.soniox.com";
const MAX_ACTIVE = 2, MAX_QUEUE = 5;
const JOB_TIMEOUT = 2 * 60 * 60_000;
const RETENTION = 31 * 24 * 60 * 60_000;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const remoteId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const stateSchema = z.enum(["queued", "uploading", "processing", "completed", "failed", "retryable", "cancelled"]);
const jobSchema = z.object({
  id: remoteId, projectId: remoteId, assetId: remoteId, filename: z.string(), baseUrl: z.string(),
  createdAt: z.number(), deadlineAt: z.number(), state: stateSchema,
  mode: z.enum(["work", "cleanup", "done"]), cancelRequested: z.boolean(),
  fileIds: z.array(remoteId), transcriptionIds: z.array(remoteId),
  intent: z.enum(["upload", "create"]).optional(),
  error: z.string().optional(), nextAttemptAt: z.number(), cleanupAttempts: z.number(),
});
export type SonioxJob = z.infer<typeof jobSchema>;
export type SonioxFetch = (url: string, init: RequestInit) => Promise<Response>;

export class SonioxError extends Error {
  constructor(message: string, public status = 0, public errorType = "network_error", public retryAfterMs = 0) {
    super(message);
    this.name = "SonioxError";
  }
  get retryable() { return this.status === 0 || [408, 409, 429].includes(this.status) || this.status >= 500; }
}

export class SonioxClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: SonioxFetch;
  private readonly sleep: typeof pause;
  private readonly requestTimeoutMs: number;

  constructor(options: { apiKey?: string; baseUrl?: string; fetch?: SonioxFetch; sleep?: typeof pause; requestTimeoutMs?: number } = {}) {
    if (typeof window !== "undefined") throw new Error("Soniox is server-only");
    this.apiKey = options.apiKey ?? process.env.SONIOX_API_KEY ?? "";
    if (!this.apiKey) throw new SonioxError("SONIOX_API_KEY is not configured on the server", 401, "unauthenticated");
    this.baseUrl = (options.baseUrl ?? process.env.SONIOX_API_BASE_URL ?? API).replace(/\/$/, "");
    if (!/^https:\/\/api(?:\.(?:eu|jp|in))?\.soniox\.com$/.test(this.baseUrl)) throw new Error("Invalid Soniox API base URL");
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? pause;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? "GET";
    // POST is not idempotent. An uncertain response must be reconciled, never blindly retried.
    const attempts = method === "POST" ? 1 : 3;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      let failure: SonioxError;
      try {
        const response = await this.fetcher(`${this.baseUrl}/v1${endpoint}`, {
          ...init, method, cache: "no-store", redirect: "error", signal: controller.signal,
          headers: { ...init.headers, Authorization: `Bearer ${this.apiKey}` },
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const retry = response.headers.get("retry-after");
          const retryAfterMs = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
          const type = typeof body.error_type === "string" ? body.error_type : "http_error";
          const message = typeof body.message === "string" ? body.message : `Soniox HTTP ${response.status}`;
          throw new SonioxError(message.replaceAll(this.apiKey, "[redacted]").slice(0, 450), response.status, type,
            Number.isFinite(retryAfterMs) ? Math.min(60_000, Math.max(0, retryAfterMs)) : 0);
        }
        return response.status === 204 ? undefined as T : await response.json() as T;
      } catch (error) {
        failure = error instanceof SonioxError ? error : new SonioxError("Soniox request timed out or returned an invalid response");
      } finally { clearTimeout(timer); }
      if (!failure.retryable || failure.status === 409 || attempt + 1 >= attempts) throw failure;
      await this.sleep(Math.max(failure.retryAfterMs, Math.min(10_000, 1000 * 2 ** attempt)));
    }
  }

  async upload(file: Blob, filename: string, reference: string) {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("client_reference_id", reference);
    const result = await this.request<{ id: string }>("/files", { method: "POST", body: form });
    return remoteId.parse(result.id);
  }

  async create(fileId: string, reference: string) {
    const result = await this.request<{ id: string }>("/transcriptions", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        model: "stt-async-v5", file_id: fileId, client_reference_id: reference,
        enable_speaker_diarization: true, enable_language_identification: true,
      }) });
    return remoteId.parse(result.id);
  }

  async get(id: string) {
    const result = await this.request<{ id: string; status: string; error_type?: string; error_message?: string }>(`/transcriptions/${remoteId.parse(id)}`);
    if (typeof result.error_message === "string") result.error_message = result.error_message.replaceAll(this.apiKey, "[redacted]").slice(0, 350);
    return result;
  }

  transcript(id: string) {
    return this.request<{ id: string; text: string; tokens: unknown }>(`/transcriptions/${remoteId.parse(id)}/transcript`);
  }

  async delete(kind: "files" | "transcriptions", id: string): Promise<boolean> {
    try { await this.request(`/${kind}/${remoteId.parse(id)}`, { method: "DELETE" }); return true; }
    catch (error) {
      if (error instanceof SonioxError && error.status === 404) return true;
      if (error instanceof SonioxError && error.status === 409) return false;
      throw error;
    }
  }

  async find(kind: "files" | "transcriptions", reference: string, onFound?: (ids: string[]) => Promise<void>): Promise<string[]> {
    const ids: string[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "1000", ...(cursor ? { cursor } : {}) });
      const response: Record<string, unknown> = await this.request(`/${kind}?${query}`);
      const items = response[kind];
      if (!Array.isArray(items)) throw new SonioxError("Invalid Soniox resource listing");
      const found = items.filter(item => item?.client_reference_id === reference).map(item => remoteId.parse(item.id));
      ids.push(...found);
      if (found.length) await onFound?.(found);
      const next = response.next_page_cursor;
      if (next != null && (typeof next !== "string" || !next || cursors.has(next) || cursors.size >= 100)) {
        throw new SonioxError("Invalid or excessive Soniox pagination");
      }
      cursor = (next as string | null) ?? null;
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...new Set(ids)];
  }
}

export type SonioxProcessOptions = {
  client: SonioxClient;
  save: (job: SonioxJob) => Promise<void>;
  source: () => Promise<Blob>;
  onState: (state: SonioxJob["state"], error?: string) => Promise<void>;
  // Must atomically check cancellation/ownership with the local result commit.
  publish: (tokens: Token[]) => Promise<boolean>;
  now?: () => number;
  sleep?: typeof pause;
};

/** Runs one durable job or one cleanup attempt. The caller owns scheduling and persistence. */
export async function processSoniox(job: SonioxJob, options: SonioxProcessOptions): Promise<void> {
  const { client, save, onState } = options;
  const now = options.now ?? Date.now, sleep = options.sleep ?? pause;
  const checkDeadline = () => {
    if (now() >= job.deadlineAt) throw new SonioxError("Transcription exceeded its time limit", 408, "timeout");
  };
  const state = async (value: SonioxJob["state"], error?: string) => {
    job.state = job.cancelRequested ? "cancelled" : value;
    job.error = job.cancelRequested ? undefined : error?.slice(0, 500);
    await save(job);
    await onState(job.state, job.error);
  };
  const reconcile = async () => {
    if (!job.intent) return;
    const kind = job.intent === "upload" ? "files" : "transcriptions";
    const ids = await client.find(kind, job.id, async found => {
      if (kind === "files") job.fileIds = [...new Set([...job.fileIds, ...found])];
      else job.transcriptionIds = [...new Set([...job.transcriptionIds, ...found])];
      await save(job);
    });
    // Empty listings do not prove a timed-out POST failed. Retain its intent beyond remote retention.
    if (ids.length || now() - job.createdAt > RETENTION) {
      job.intent = undefined;
      await save(job);
    }
  };
  const post = async (intent: "upload" | "create", send: () => Promise<string>) => {
    checkDeadline();
    job.intent = intent;
    await save(job);
    try {
      const id = await send();
      if (intent === "upload") job.fileIds.push(id); else job.transcriptionIds.push(id);
      job.intent = undefined;
      await save(job);
    } catch (error) {
      // Definitive validation/auth/quota rejection cannot have created this resource.
      if (error instanceof SonioxError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        job.intent = undefined;
        await save(job);
      }
      throw error;
    }
  };

  try {
    if (job.mode === "work") {
      await onState(job.cancelRequested ? "cancelled" : job.state, job.error);
      await reconcile();
      if (job.intent) throw new SonioxError("Remote request outcome is uncertain; reconciliation is pending. You may retry as a new job.");
      checkDeadline();
      if (!job.cancelRequested && !job.fileIds.length && !job.transcriptionIds.length) {
        await state("uploading");
        if (!job.cancelRequested) {
          const source = await options.source();
          if (!job.cancelRequested) await post("upload", () => client.upload(source, job.filename, job.id));
        }
      }
      if (!job.cancelRequested && !job.transcriptionIds.length) {
        await post("create", () => client.create(job.fileIds[0], job.id));
      }
      if (!job.cancelRequested) await state("processing");
      let delay = 1000;
      while (!job.cancelRequested) {
        checkDeadline();
        const id = job.transcriptionIds[0];
        const remote = await client.get(id);
        if (job.cancelRequested) break;
        if (remote.id !== id) throw new SonioxError("Soniox returned a mismatched transcription ID");
        if (remote.status === "completed") {
          checkDeadline();
          const transcript = await client.transcript(id);
          if (job.cancelRequested) break;
          checkDeadline();
          if (transcript.id !== id || typeof transcript.text !== "string") throw new SonioxError("Invalid Soniox transcript response");
          const tokens = normalizeTokens(transcript.tokens);
          if (!job.cancelRequested && await options.publish(tokens)) await state("completed");
          else job.cancelRequested = true;
          break;
        }
        // Some official error prose uses 'failed'; never leave such a response polling forever.
        if (remote.status === "error" || remote.status === "failed") {
          const type = /^[a-z_]{1,100}$/.test(remote.error_type ?? "") ? remote.error_type! : "transcription_error";
          throw new SonioxError(`Soniox transcription failed (${type}): ${remote.error_message ?? "No details returned"}`,
            type === "internal_error" ? 500 : 400, type);
        }
        if (!["queued", "processing"].includes(remote.status)) throw new SonioxError("Unexpected Soniox transcription state");
        if (job.state !== remote.status) await state(remote.status as "queued" | "processing");
        await sleep(Math.min(delay, Math.max(1, job.deadlineAt - now())));
        delay = Math.min(10_000, delay * 1.5);
      }
      job.mode = "cleanup";
      await save(job);
    }
  } catch (error) {
    job.mode = "cleanup";
    await state(job.intent || (error instanceof SonioxError && error.retryable) ? "retryable" : "failed",
      error instanceof Error ? error.message : "Transcription failed");
  }
  if (job.cancelRequested) await state("cancelled");
  if (job.mode === "done") return;

  try {
    await reconcile();
    for (const id of [...job.transcriptionIds]) {
      if (await client.delete("transcriptions", id)) {
        job.transcriptionIds = job.transcriptionIds.filter(value => value !== id);
        await save(job);
      }
    }
    // A processing transcription (409), or an uncertain create, may still need its file.
    if (!job.transcriptionIds.length && job.intent !== "create") {
      for (const id of [...job.fileIds]) {
        if (await client.delete("files", id)) {
          job.fileIds = job.fileIds.filter(value => value !== id);
          await save(job);
        }
      }
    }
    if (!job.fileIds.length && !job.transcriptionIds.length && !job.intent) job.mode = "done";
  } catch {
    // Cleanup failure must not discard IDs or turn a successfully published transcript into failure.
  }
  job.cleanupAttempts++;
  job.nextAttemptAt = now() + Math.min(60 * 60_000, 30_000 * 2 ** Math.min(job.cleanupAttempts - 1, 7));
  await save(job);
}

type Runtime = {
  jobs: Record<string, SonioxJob>;
  owners: Record<string, string>;
  ready?: Promise<void>;
  running: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
};
const globalState = globalThis as typeof globalThis & { __sonioxRuntime?: Runtime };
const runtime = globalState.__sonioxRuntime ??= { jobs: {}, owners: {}, running: new Set() };
const ledgerPath = path.join(DATA, "soniox.json");

function persist() {
  return locked("soniox:ledger", () => atomicJson(ledgerPath, { version: 1, jobs: runtime.jobs, owners: runtime.owners }));
}

async function ready() {
  runtime.ready ??= (async () => {
    try {
      const data = z.object({ version: z.literal(1), jobs: z.record(remoteId, jobSchema), owners: z.record(z.string(), remoteId) })
        .parse(JSON.parse(await readFile(ledgerPath, "utf8")));
      for (const [id, job] of Object.entries(data.jobs)) {
        if (id !== job.id) throw new Error("Invalid Soniox ledger job ID");
      }
      runtime.jobs = data.jobs;
      runtime.owners = data.owners;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  })();
  await runtime.ready;
}

async function updateAsset(job: SonioxJob, state: Asset["transcription"], error?: string, tokens?: Token[], initialize = false) {
  let published = false;
  try {
    await mutateProject(job.projectId, project => {
      const asset = project.assets.find(asset => asset.id === job.assetId);
      if (!asset || runtime.owners[`${job.projectId}:${job.assetId}`] !== job.id) {
        job.cancelRequested = true;
        return project;
      }
      if (tokens && job.cancelRequested) return project;
      // Re-publication after a crash must preserve user corrections to already committed tokens.
      if (tokens && asset.transcription === "completed") { published = true; return project; }
      if (!initialize && !tokens && asset.transcription === "completed" && ["processing", "queued", "uploading"].includes(state)) return project;
      asset.transcription = job.cancelRequested ? "cancelled" : state;
      asset.transcriptionError = job.cancelRequested ? undefined : error?.slice(0, 500);
      if (tokens) { asset.tokens = tokens; published = true; }
      return project;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") job.cancelRequested = true;
    else throw error;
  }
  return published;
}

async function audioSource(job: SonioxJob): Promise<Blob> {
  const directory = path.join(DATA, "soniox-audio");
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, `${job.id}.flac`);
  const source = mediaPath(job.projectId, job.assetId);
  // Preserve container-relative audio offsets and gaps, padding to source time zero rather than trimming them.
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
      "-copyts", "-start_at_zero", "-i", source, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
      "-af", "aresample=16000:async=1:first_pts=0", "-c:a", "flac",
      "-threads", "2", "-filter_threads", "2", output], { stdio: "ignore" });
    let stopped = false;
    const deadline = setTimeout(() => { stopped = true; child.kill("SIGKILL"); }, 10 * 60_000);
    const cancellation = setInterval(() => {
      if (job.cancelRequested) { stopped = true; child.kill("SIGKILL"); }
    }, 250);
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(deadline); clearInterval(cancellation);
      if (code === 0 && !stopped) resolve();
      else reject(new Error(stopped ? "Audio extraction cancelled or timed out" : "Audio extraction failed"));
    });
  }).catch(async error => {
    await rm(output, { force: true });
    if (job.cancelRequested) throw error;
    // Soniox accepts MP4 and other original containers; extraction is an optimization, not a requirement.
    job.filename = job.filename.replace(/\.flac$/, "") || "source.mp4";
  });
  try { return await openAsBlob(output, { type: "audio/flac" }); }
  catch { return openAsBlob(source); }
}

function pump() {
  if (runtime.timer) { clearTimeout(runtime.timer); runtime.timer = undefined; }
  if (!process.env.SONIOX_API_KEY) return;
  const now = Date.now();
  const candidates = Object.values(runtime.jobs).filter(job => job.mode !== "done" && !runtime.running.has(job.id) &&
    job.nextAttemptAt <= now).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
  for (const job of candidates) {
    if (runtime.running.size >= MAX_ACTIVE) break;
    runtime.running.add(job.id);
    void (async () => {
      try {
        if (job.mode === "cleanup") await updateAsset(job, job.state, job.error);
        await processSoniox(job, { client: new SonioxClient({ baseUrl: job.baseUrl }), save: persist,
          source: () => audioSource(job),
          onState: (state, error) => updateAsset(job, state, error).then(() => {}),
          publish: tokens => locked("soniox:control", () => updateAsset(job, "completed", undefined, tokens)),
        });
        await rm(path.join(DATA, "soniox-audio", `${job.id}.flac`), { force: true });
        if (job.mode === "done") { delete runtime.jobs[job.id]; await persist(); }
      } catch {
        // A filesystem failure must leave the last durable remote intent available for recovery.
        job.nextAttemptAt = Date.now() + 60_000;
      } finally { runtime.running.delete(job.id); pump(); }
    })();
  }
  const waiting = Object.values(runtime.jobs).filter(job => job.mode !== "done" && !runtime.running.has(job.id));
  if (waiting.length && runtime.running.size < MAX_ACTIVE) {
    runtime.timer = setTimeout(pump, Math.max(1000, Math.min(...waiting.map(job => job.nextAttemptAt)) - Date.now()));
    runtime.timer.unref();
  }
}

export async function recoverTranscriptions(): Promise<void> {
  await ready();
  await locked("soniox:control", async () => {
    for (const job of Object.values(runtime.jobs)) {
      if (runtime.running.has(job.id)) continue;
      if (job.mode === "done") {
        await rm(path.join(DATA, "soniox-audio", `${job.id}.flac`), { force: true });
        delete runtime.jobs[job.id]; continue;
      }
      try {
        const project = await loadProject(job.projectId);
        if (!project.assets.some(asset => asset.id === job.assetId)) job.cancelRequested = true;
      } catch (error) {
        if (error instanceof Error && error.message === "Project not found") {
          job.cancelRequested = true;
          delete runtime.owners[`${job.projectId}:${job.assetId}`];
        }
        else throw error;
      }
      if (job.cancelRequested) { job.mode = "cleanup"; job.state = "cancelled"; }
    }
    await persist();
    pump();
  });
}

export async function startTranscription(projectId: string, assetId: string): Promise<void> {
  safeId(projectId); safeId(assetId);
  await recoverTranscriptions();
  await locked("soniox:control", async () => {
    const project = await loadProject(projectId), asset = project.assets.find(asset => asset.id === assetId);
    if (!asset || !asset.hasAudio || !["audio", "video"].includes(asset.kind)) throw new Error("Asset has no transcribable audio");
    if (asset.duration > 18_000_000) throw new Error("Soniox audio cannot exceed 300 minutes");
    if (Object.values(runtime.jobs).some(job => job.projectId === projectId && job.assetId === assetId && job.mode === "work" && !job.cancelRequested)) return;
    const waiting = Object.values(runtime.jobs).filter(job => job.mode === "work" && !runtime.running.has(job.id)).length;
    const error = !process.env.SONIOX_API_KEY ? "SONIOX_API_KEY is not configured on the server" :
      waiting >= MAX_QUEUE + Math.max(0, MAX_ACTIVE - runtime.running.size) ? "Transcription queue is full (2 running, 5 waiting). Try again later." : undefined;
    if (error) {
      await mutateProject(projectId, project => {
        const asset = project.assets.find(asset => asset.id === assetId)!;
        asset.transcription = "retryable"; asset.transcriptionError = error;
        return project;
      });
      throw new Error(error);
    }
    new SonioxClient();
    const createdAt = Date.now();
    const job: SonioxJob = { id: uid(), projectId, assetId, filename: `${asset.name}.flac`, createdAt,
      baseUrl: process.env.SONIOX_API_BASE_URL ?? API,
      deadlineAt: createdAt + JOB_TIMEOUT, state: "queued", mode: "work", cancelRequested: false,
      fileIds: [], transcriptionIds: [], nextAttemptAt: createdAt, cleanupAttempts: 0 };
    runtime.jobs[job.id] = job;
    runtime.owners[`${projectId}:${assetId}`] = job.id;
    await persist();
    await updateAsset(job, "queued", undefined, undefined, true);
    pump();
  });
}

export async function cancelTranscription(projectId: string, assetId: string): Promise<void> {
  safeId(projectId); safeId(assetId);
  await ready();
  await locked("soniox:control", async () => {
    const jobs = Object.values(runtime.jobs).filter(job => job.projectId === projectId && job.assetId === assetId && job.mode === "work");
    for (const job of jobs) {
      job.cancelRequested = true;
      if (!runtime.running.has(job.id)) job.mode = "cleanup";
      job.state = "cancelled"; job.error = undefined; job.nextAttemptAt = Date.now();
    }
    await persist();
    for (const job of jobs) await updateAsset(job, "cancelled");
    pump();
  });
}

export async function cleanupProjectTranscriptions(projectId: string): Promise<void> {
  safeId(projectId);
  await ready();
  await locked("soniox:control", async () => {
    for (const job of Object.values(runtime.jobs).filter(job => job.projectId === projectId)) {
      job.cancelRequested = true; job.state = "cancelled"; job.nextAttemptAt = Date.now();
      if (!runtime.running.has(job.id)) job.mode = "cleanup";
    }
    for (const key of Object.keys(runtime.owners)) if (key.startsWith(`${projectId}:`)) delete runtime.owners[key];
    // This file lives outside the project directory and survives deleteProject().
    await persist();
    pump();
  });
}
