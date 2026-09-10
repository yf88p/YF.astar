import { createReadStream } from "node:fs";
import { stat, cp, mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { newProject, listProjects, loadHistory, loadProject, execute, historyAction, deleteProject, mediaPath, mediaDir, storageUsage, saveHistory, locked } from "@/lib/server/store";
import { importMedia } from "@/lib/server/media";
import { startRender, getRender, cancelRender, cancelProjectRenders, exportPath } from "@/lib/server/render";
import { startTranscription, cancelTranscription, cleanupProjectTranscriptions, recoverTranscriptions } from "@/lib/server/soniox";
import { runAssistant, abortAssistant, steerAssistant, disposeAssistant, applyProposal, rejectProposal } from "@/lib/server/assistant";
import { ensureSampleProject, addFixtureTranscript } from "@/lib/server/fixture";
import { type ProjectHistory } from "@/lib/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const publicHistory = (h: ProjectHistory) => ({ project: h.project, canUndo: h.undo.length > 0, canRedo: h.redo.length > 0 });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function body(req: Request, max = 1024 * 1024) {
  if (Number(req.headers.get("content-length")) > max) throw new Error("Request is too large");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new Error("Request is too large"); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return bytes;
}
async function readJson(req: Request): Promise<Record<string, unknown>> {
  try { return z.record(z.string(), z.unknown()).parse(JSON.parse(new TextDecoder().decode(await body(req)))); }
  catch { throw new Error("Invalid JSON request"); }
}
async function streamFile(req: Request, file: string, mime: string, download?: string) {
  const info = await stat(file).catch(() => { throw new Error("Media not found. Reimport the source file."); });
  let start = 0, end = info.size - 1, status = 200;
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    status = 206;
  }
  const headers: Record<string, string> = { "Content-Type": mime, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`;
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>, { status, headers });
}
function authorized(req: Request) {
  if (!process.env.EDITOR_PASSWORD) return true;
  const expected = Buffer.from(`Basic ${Buffer.from(`editor:${process.env.EDITOR_PASSWORD}`).toString("base64")}`);
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
async function handle(req: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!authorized(req)) return new Response("Sign in with username editor and your EDITOR_PASSWORD", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Frame editor"' } });
  const origin = req.headers.get("origin");
  if ((origin && new URL(origin).host !== new URL(req.url).host) || req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Cross-origin requests are not allowed" }, 403);
  try {
    const { path: parts } = await context.params;
    const [resource, id, action, subId] = parts;
    if (req.method === "GET") {
      if (resource === "bootstrap") {
        void recoverTranscriptions().catch(() => {});
        let projects = await listProjects();
        let project;
        if (projects.length) project = await loadHistory(projects[0].id);
        else if (process.env.FIXTURE_MODE !== "false") {
          try { const sample = await ensureSampleProject(); project = await loadHistory(sample.id); }
          catch { const p = await newProject(); project = await loadHistory(p.id); }
        } else { const p = await newProject(); project = await loadHistory(p.id); }
        projects = await listProjects();
        return json({ ...publicHistory(project), projects, sonioxConfigured: !!process.env.SONIOX_API_KEY, fixtureEnabled: process.env.FIXTURE_MODE !== "false" });
      }
      if (resource === "projects") return json(id ? publicHistory(await loadHistory(id)) : { projects: await listProjects() });
      if (resource === "media") {
        const p = await loadProject(id), a = p.assets.find(a => a.id === action);
        if (!a) throw new Error("Media not found");
        const variant = subId === "thumb" ? "thumb" : subId === "source" && a.kind === "image" ? "source" : "preview";
        return streamFile(req, mediaPath(id, a.id, variant), variant === "thumb" ? "image/jpeg" : variant === "source" ? a.mime : "video/mp4");
      }
      if (resource === "renders" && id && action) {
        const job = await getRender(id, action);
        if (subId === "file") { if (job.status !== "completed") throw new Error("Export is not ready"); return streamFile(req, exportPath(id, action), "video/mp4", new URL(req.url).searchParams.has("download") ? "frame-export.mp4" : undefined); }
        return json({ job });
      }
    }
    if (req.method === "POST") {
      if (resource === "projects" && id && action === "upload") {
        return await locked("upload:request", async () => {
          const max = Number(process.env.MEDIA_MAX_BYTES) || 256 * 1024 * 1024;
          if (await storageUsage() > (Number(process.env.STORAGE_MAX_BYTES) || 3 * 1024 ** 3) - max * 2) throw new Error("Storage limit reached. Delete unused projects before importing.");
          const name = decodeURIComponent(req.headers.get("x-file-name") || "");
          const data = await body(req, max);
          const file = new File([data], name, { type: req.headers.get("content-type") ?? "application/octet-stream" });
          const asset = await importMedia(id, file);
          return json({ asset, ...publicHistory(await loadHistory(id)) });
        });
      }
      const data = await readJson(req);
      if (resource === "projects") {
        if (!id) { const p = await newProject(z.string().trim().min(1).max(100).parse(data.name)); return json(publicHistory(await loadHistory(p.id))); }
        if (action === "commands") return json(publicHistory(await execute(id, data)));
        if (action === "undo" || action === "redo") return json(publicHistory(await historyAction(id, action, z.number().int().nonnegative().parse(data.revision))));
        if (action === "duplicate") {
          const source = await loadProject(id), copy = await newProject(`${source.name.slice(0, 90)} copy`);
          await mkdir(mediaDir(copy.id), { recursive: true });
          await cp(mediaDir(id), mediaDir(copy.id), { recursive: true });
          copy.assets = source.assets.map(a => ({ ...a, transcription: ["queued", "uploading", "processing"].includes(a.transcription) ? "idle" : a.transcription }));
          copy.clips = source.clips; copy.tracks = source.tracks; copy.fixture = source.fixture;
          await saveHistory({ project: copy, undo: [], redo: [] });
          return json(publicHistory(await loadHistory(copy.id)));
        }
        if (action === "transcribe") { await startTranscription(id, z.string().parse(data.assetId)); return json({ accepted: true }); }
        if (action === "cancel-transcription") { await cancelTranscription(id, z.string().parse(data.assetId)); return json({ cancelled: true }); }
        if (action === "fixture-transcript") { if (process.env.FIXTURE_MODE === "false") throw new Error("Fixture mode is disabled"); await addFixtureTranscript(id, z.string().parse(data.assetId)); return json(publicHistory(await loadHistory(id))); }
        if (action === "render") { if (await storageUsage() > (Number(process.env.STORAGE_MAX_BYTES) || 3 * 1024 ** 3) - 512 * 1024 ** 2) throw new Error("Storage limit reached. Delete unused projects before exporting."); return json({ job: await startRender(id) }); }
        if (action === "assistant") {
          const message = z.string().trim().min(1).max(12000).parse(data.message);
          const p = await loadProject(id);
          const controller = new AbortController();
          const abort = () => controller.abort();
          req.signal.addEventListener("abort", abort, { once: true });
          const stream = new ReadableStream({
            async start(writer) {
              try { for await (const event of runAssistant(id, message, { fixture: p.fixture && process.env.FIXTURE_MODE !== "false", signal: controller.signal })) writer.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); }
              catch { if (!controller.signal.aborted) writer.enqueue(new TextEncoder().encode(JSON.stringify({ type: "error", error: "Assistant could not finish. Your timeline is unchanged. Try again or check Pi authentication." }) + "\n")); }
              finally { req.signal.removeEventListener("abort", abort); try { writer.close(); } catch { /* Client already disconnected. */ } }
            }, cancel() { controller.abort(); },
          });
          return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
        }
        if (action === "abort-assistant") { await abortAssistant(id); return json({ aborted: true }); }
        if (action === "steer-assistant") { await steerAssistant(id, z.string().min(1).max(12000).parse(data.message)); return json({ accepted: true }); }
        if (action === "dispose-assistant") { await disposeAssistant(id); return json({ disposed: true }); }
        if (action === "apply-proposal") return json(publicHistory(await applyProposal(id, z.string().parse(data.proposalId))));
        if (action === "reject-proposal") { await rejectProposal(id, z.string().parse(data.proposalId)); return json({ rejected: true }); }
      }
      if (resource === "renders" && id && action) { await cancelRender(id, action); return json({ cancelled: true }); }
      if (resource === "sample") return json(publicHistory(await loadHistory((await ensureSampleProject()).id)));
    }
    if (req.method === "DELETE" && resource === "projects" && id) {
      await cleanupProjectTranscriptions(id); await cancelProjectRenders(id); await disposeAssistant(id); await deleteProject(id);
      return json({ deleted: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: `Invalid edit: ${error.issues[0]?.message ?? "Check the supplied values"}` }, 400);
    const text = error instanceof Error ? error.message : "Operation failed";
    const safe = /(?:\/home\/|\/tmp\/|ENOENT|EACCES|api[_-]?key=|Bearer )/i.test(text) ? "Operation failed. Check server configuration and available storage." : text.slice(0, 500);
    return json({ error: safe }, /stale revision/i.test(text) ? 409 : /not found/i.test(text) ? 404 : 400);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
