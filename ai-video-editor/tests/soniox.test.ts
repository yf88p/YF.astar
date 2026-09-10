import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assetSchema, createProject, makeClip, tokenOccurrences, type Token } from "../src/lib/timeline";
import { fillerRanges, normalizeTokens, silenceRanges } from "../src/lib/transcript";
import type { SonioxFetch, SonioxJob } from "../src/lib/server/soniox";

let service: typeof import("../src/lib/server/soniox");
let store: typeof import("../src/lib/server/store");
let directory: string;
const originalEnv = { data: process.env.DATA_DIR, key: process.env.SONIOX_API_KEY, base: process.env.SONIOX_API_BASE_URL };
const originalFetch = globalThis.fetch;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "soniox-test-"));
  process.env.DATA_DIR = directory;
  delete process.env.SONIOX_API_KEY;
  delete process.env.SONIOX_API_BASE_URL;
  service = await import("../src/lib/server/soniox");
  store = await import("../src/lib/server/store");
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [["DATA_DIR", originalEnv.data], ["SONIOX_API_KEY", originalEnv.key], ["SONIOX_API_BASE_URL", originalEnv.base]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
  await rm(directory, { recursive: true, force: true });
});

const raw = (text: string, start_ms: number, end_ms: number, extra = {}) => ({ text, start_ms, end_ms, confidence: 0.9, ...extra });
const asset = (tokens: Token[] = []) => assetSchema.parse({ id: "asset", name: "recording.mp4", kind: "video", duration: 10_000,
  hasAudio: true, bytes: 4, mime: "video/mp4", tokens });
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const deleted = () => new Response(null, { status: 204 });
const job = (patch: Partial<SonioxJob> = {}): SonioxJob => ({ id: "local-job", projectId: "project", assetId: "asset",
  filename: "recording.flac", baseUrl: "https://api.soniox.com", createdAt: 0, deadlineAt: 60_000, state: "queued", mode: "work",
  cancelRequested: false, fileIds: [], transcriptionIds: [], nextAttemptAt: 0, cleanupAttempts: 0, ...patch });

function harness(current: SonioxJob, adapter: SonioxFetch) {
  const saves: SonioxJob[] = [], states: string[] = [], results: Token[][] = [], sleeps: number[] = [];
  let clock = 0;
  const sleep = async (ms: number) => { sleeps.push(ms); clock += ms; };
  const options = {
    client: new service.SonioxClient({ apiKey: "test-secret", fetch: adapter, sleep }),
    save: async (value: SonioxJob) => { saves.push(structuredClone(value)); },
    source: async () => new Blob(["actual test media bytes"]),
    onState: async (state: string) => { states.push(state); },
    publish: async (tokens: Token[]) => { results.push(tokens); return true; },
    now: () => clock, sleep,
  };
  return { options, saves, states, results, sleeps, advance: (ms: number) => { clock += ms; },
    run: () => service.processSoniox(current, options) };
}

test("normalization groups subwords, preserves exact text and raw metadata without mutation", () => {
  const input = [raw("Beau", 300, 420, { speaker: "1", language: "en", vendor: { untouched: true } }),
    raw("ti", 420, 540, { speaker: "1", language: "en", confidence: 0.8 }),
    raw("ful", 540, 780, { speaker: "1", language: "en" }),
    raw(" morning", 800, 1100, { speaker: "1", language: "en" }), raw("!", 1100, 1120, { speaker: "1", language: "en" })];
  const before = structuredClone(input), words = normalizeTokens(input);
  assert.deepEqual(words.map(word => [word.text, word.start, word.end]), [["Beautiful", 300, 780], [" morning!", 800, 1120]]);
  assert.equal(words[0].original, "Beautiful");
  assert.equal(words[0].confidence, 0.8);
  assert.equal(words[0].speaker, "1");
  assert.equal(words[0].language, "en");
  assert.deepEqual(words[0].raw!.parts, input.slice(0, 3));
  assert.equal(words.map(word => word.text).join(""), input.map(token => token.text).join(""));
  (words[0].raw!.parts as unknown as { vendor: { untouched: boolean } }[])[0].vendor.untouched = false;
  assert.deepEqual(input, before);
});

test("normalization preserves whitespace and speaker boundaries without inventing multiword timing", () => {
  const words = normalizeTokens([raw("  Hello world", 0, 900, { speaker: "1" }), raw("\n", 900, 900),
    raw("yes", 500, 1000, { speaker: "2" }), raw(" ", 1000, 1000)]);
  assert.deepEqual(words.map(word => [word.text, word.start, word.end, word.speaker]),
    [["  Hello", 0, 900, "1"], [" world", 0, 900, "1"], ["\nyes ", 500, 1000, "2"]]);
  assert.deepEqual(normalizeTokens([]), []);
  const trailing = raw("word ", 0, 100);
  assert.deepEqual(normalizeTokens([trailing])[0].raw!.parts, [trailing]);
  assert.deepEqual(normalizeTokens([raw("translated", 0, 100, { translation_status: "translation" })]), []);
  for (const malformed of [[{ text: "missing timing" }], [raw("wrong", 100, 0)], [raw("wrong", 0, 100, { confidence: 2 })]]) {
    assert.throws(() => normalizeTokens(malformed), /Invalid Soniox token/);
  }
});

test("filler and measured silence ranges retain source coordinates, not transcript gaps", () => {
  const media = asset(normalizeTokens([raw("Um,", 100, 200), raw(" like", 800, 1000), raw(" uh", 1500, 1600)]));
  media.silence = [{ start: 1800, end: 2100 }, { start: 2000, end: 2400 }, { start: 9500, end: 11_000 }];
  assert.deepEqual(fillerRanges(media).map(range => [range.start, range.end, range.tokenIds]),
    [[100, 200, ["word-0"]], [1500, 1600, ["word-2"]]]);
  assert.deepEqual(silenceRanges(media, 500), [{ assetId: "asset", start: 1800, end: 2400 }, { assetId: "asset", start: 9500, end: 10_000 }]);
  assert.deepEqual(silenceRanges({ ...media, silence: [] }, 100), []);
  assert.throws(() => silenceRanges(media, NaN), /threshold/);
});

test("tokenOccurrences maps source trims, timeline gaps, overlaps and speed without mutating source", () => {
  const media = asset(normalizeTokens([raw("one", 500, 1500), raw(" two", 2000, 3000), raw(" three", 4000, 4500)]));
  const project = createProject();
  project.assets = [media];
  project.clips = [
    { ...makeClip(media, "video", 0), id: "fast", sourceIn: 1000, sourceOut: 3000, speed: 2 },
    { ...makeClip(media, "video", 5000), id: "slow", sourceIn: 2000, sourceOut: 4500, speed: 0.5 },
    { ...makeClip(media, "video", 5500), id: "overlap", sourceIn: 0, sourceOut: 2000, speed: 1 },
  ];
  const original = structuredClone(media.tokens);
  assert.deepEqual(tokenOccurrences(project).map(word => [word.clipId, word.token.text, word.start, word.end]), [
    ["fast", "one", 0, 250], ["fast", " two", 500, 1000], ["slow", " two", 5000, 7000],
    ["overlap", "one", 6000, 7000], ["slow", " three", 9000, 10_000],
  ]);
  assert.deepEqual(media.tokens, original);
  assert.deepEqual(tokenOccurrences(project, "unknown"), []);
});

test("real endpoint workflow persists remote intent and IDs before the next operation", async () => {
  const current = job(), calls: string[] = [];
  let polls = 0;
  const h = harness(current, async (url, init) => {
    const pathname = new URL(url).pathname, method = init.method;
    calls.push(`${method} ${pathname}`);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-secret");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    if (method === "POST" && pathname === "/v1/files") {
      assert.equal(h.saves.at(-1)!.intent, "upload");
      const form = init.body as FormData;
      assert.equal(form.get("client_reference_id"), current.id);
      assert.equal(await (form.get("file") as Blob).text(), "actual test media bytes");
      return json({ id: "file-1" }, 201);
    }
    if (method === "POST" && pathname === "/v1/transcriptions") {
      assert.deepEqual(h.saves.at(-1)!.fileIds, ["file-1"]);
      assert.equal(h.saves.at(-1)!.intent, "create");
      assert.deepEqual(JSON.parse(init.body as string), { model: "stt-async-v5", file_id: "file-1", client_reference_id: current.id,
        enable_speaker_diarization: true, enable_language_identification: true });
      return json({ id: "transcription-1", status: "queued" }, 201);
    }
    if (method === "GET" && pathname.endsWith("/transcript")) {
      return json({ id: "transcription-1", text: "Hello", tokens: [raw("Hel", 0, 100), raw("lo", 100, 200)] });
    }
    if (method === "GET") {
      assert.deepEqual(h.saves.at(-1)!.transcriptionIds, ["transcription-1"]);
      return json({ id: "transcription-1", status: ["queued", "processing", "completed"][polls++] });
    }
    if (pathname.includes("/files/")) assert.deepEqual(h.saves.at(-1)!.transcriptionIds, []);
    return deleted();
  });
  await h.run();
  assert.deepEqual(h.states, ["queued", "uploading", "processing", "queued", "processing", "completed"]);
  assert.equal(h.results[0][0].text, "Hello");
  assert.equal(current.mode, "done");
  assert.deepEqual(calls.slice(-2), ["DELETE /v1/transcriptions/transcription-1", "DELETE /v1/files/file-1"]);
});

test("cancellation during upload persists the returned file and never creates a transcription", async () => {
  const current = job(), calls: string[] = [];
  const h = harness(current, async (url, init) => {
    calls.push(`${init.method} ${new URL(url).pathname}`);
    if (init.method === "POST") { current.cancelRequested = true; return json({ id: "late-file" }, 201); }
    assert.deepEqual(h.saves.find(saved => saved.fileIds.length)?.fileIds, ["late-file"]);
    return deleted();
  });
  await h.run();
  assert.equal(current.state, "cancelled");
  assert.equal(h.results.length, 0);
  assert.deepEqual(calls, ["POST /v1/files", "DELETE /v1/files/late-file"]);
});

test("cancellation racing with transcript download suppresses publication", async () => {
  const current = job({ fileIds: ["file"], transcriptionIds: ["remote"], state: "processing" });
  const h = harness(current, async (url, init) => {
    if (init.method === "DELETE") return deleted();
    if (url.endsWith("/transcript")) {
      current.cancelRequested = true;
      return json({ id: "remote", text: "late result", tokens: [raw("late result", 0, 100)] });
    }
    return json({ id: "remote", status: "completed" });
  });
  await h.run();
  assert.equal(current.state, "cancelled");
  assert.equal(current.mode, "done");
  assert.equal(h.results.length, 0);
});

test("409 cleanup is durable, protects source files, and 404 succeeds after restart", async () => {
  const current = job({ fileIds: ["file"], transcriptionIds: ["remote"], mode: "cleanup", state: "cancelled", cancelRequested: true });
  const calls: string[] = [];
  const h = harness(current, async (url, init) => {
    calls.push(`${init.method} ${new URL(url).pathname}`);
    return json({ error_type: "transcription_invalid_state" }, 409);
  });
  await h.run();
  assert.deepEqual(calls, ["DELETE /v1/transcriptions/remote"]);
  assert.deepEqual(current.fileIds, ["file"]);
  assert.equal(current.mode, "cleanup");
  assert.ok(current.nextAttemptAt > 0);
  const restarted = structuredClone(h.saves.at(-1)!);
  const retry = harness(restarted, async (url, init) => {
    assert.equal(init.method, "DELETE");
    return json({ error_type: url.includes("/files/") ? "file_not_found" : "transcription_not_found" }, 404);
  });
  await retry.run();
  assert.equal(restarted.mode, "done");
  assert.deepEqual(restarted.fileIds, []);
  assert.deepEqual(restarted.transcriptionIds, []);
  assert.equal(retry.results.length, 0);
});

test("ambiguous upload reconciles paginated client references instead of repeating POST", async () => {
  const current = job();
  let posts = 0, pages = 0;
  const h = harness(current, async (url, init) => {
    if (init.method === "POST") { posts++; throw new TypeError("connection lost after remote acceptance"); }
    if (init.method === "DELETE") { assert.ok(url.endsWith("/lost-file") || url.endsWith("/another-file")); return deleted(); }
    const cursor = new URL(url).searchParams.get("cursor");
    pages++;
    if (!cursor) return json({ files: [{ id: "unrelated", client_reference_id: "someone-else" }, { id: "another-file", client_reference_id: current.id }], next_page_cursor: "opaque+/=" });
    assert.equal(cursor, "opaque+/=");
    assert.ok(h.saves.at(-1)!.fileIds.includes("another-file"));
    return json({ files: [{ id: "lost-file", client_reference_id: current.id }], next_page_cursor: null });
  });
  await h.run();
  assert.equal(posts, 1);
  assert.equal(pages, 2);
  assert.equal(current.state, "retryable");
  assert.equal(current.mode, "done");
  assert.equal(h.results.length, 0);
});

test("restart resumes an uncertain create by reference without creating a duplicate", async () => {
  const current = job({ fileIds: ["file"], intent: "create", state: "uploading" });
  let posts = 0;
  const h = harness(current, async (url, init) => {
    if (init.method === "POST") { posts++; throw new Error("must not POST"); }
    if (init.method === "DELETE") return deleted();
    if (new URL(url).search) return json({ transcriptions: [{ id: "found", client_reference_id: current.id }], next_page_cursor: null });
    if (url.endsWith("/transcript")) return json({ id: "found", text: "", tokens: [] });
    assert.ok(h.saves.some(saved => saved.transcriptionIds.includes("found") && !saved.intent));
    return json({ id: "found", status: "completed" });
  });
  await h.run();
  assert.equal(posts, 0);
  assert.equal(current.state, "completed");
  assert.deepEqual(h.results, [[]]);
});

test("ambiguous create keeps its file while remote processing cleanup is deferred", async () => {
  const current = job({ fileIds: ["file"] });
  let posts = 0;
  const h = harness(current, async (url, init) => {
    if (init.method === "POST") { posts++; return json({ error_type: "internal_error" }, 500); }
    if (init.method === "DELETE") {
      assert.ok(url.endsWith("/remote"));
      return json({ error_type: "transcription_invalid_state" }, 409);
    }
    return json({ transcriptions: [{ id: "remote", client_reference_id: current.id }], next_page_cursor: null });
  });
  await h.run();
  assert.equal(posts, 1);
  assert.equal(current.mode, "cleanup");
  assert.deepEqual(current.fileIds, ["file"]);
  assert.deepEqual(current.transcriptionIds, ["remote"]);
});

test("invisible ambiguous requests retain tombstones until past remote retention", async () => {
  const current = job({ fileIds: ["file"], intent: "create" });
  let deletes = 0;
  const h = harness(current, async (_url, init) => {
    assert.notEqual(init.method, "POST");
    if (init.method === "DELETE") { deletes++; return json({}, 404); }
    return json({ transcriptions: [], next_page_cursor: null });
  });
  await h.run();
  assert.equal(current.state, "retryable");
  assert.equal(current.intent, "create");
  assert.equal(deletes, 0);
  h.advance(32 * 24 * 60 * 60_000);
  await h.run();
  assert.equal(current.mode, "done");
  assert.equal(deletes, 1);
});

test("terminal errors and malformed transcripts never publish placeholder text", async () => {
  for (const status of ["error", "failed", "unexpected", "completed"]) {
    const current = job({ fileIds: ["file"], transcriptionIds: ["remote"] });
    const h = harness(current, async (url, init) => {
      if (init.method === "DELETE") return deleted();
      if (url.endsWith("/transcript")) return json({ id: "remote", text: "unusable", tokens: [{ text: "missing timestamps" }] });
      return json({ id: "remote", status, error_type: "invalid_audio_file", error_message: "invalid media" });
    });
    await h.run();
    assert.equal(current.state, status === "unexpected" ? "retryable" : "failed");
    assert.equal(h.results.length, 0);
    assert.equal(current.mode, "done");
  }
});

test("polling has a deadline, and cleanup failure does not discard remote IDs", async () => {
  const current = job({ deadlineAt: 2000, fileIds: ["file"], transcriptionIds: ["remote"] });
  const h = harness(current, async (_url, init) => init.method === "DELETE"
    ? json({ error_type: "transcription_invalid_state" }, 409) : json({ id: "remote", status: "processing" }));
  await h.run();
  assert.equal(current.state, "retryable");
  assert.match(current.error!, /time limit/);
  assert.deepEqual(current.transcriptionIds, ["remote"]);
  assert.deepEqual(h.sleeps, [1000, 1000]);
});

test("a deadline reached during preprocessing prevents upload", async () => {
  const current = job({ deadlineAt: 1000 });
  const h = harness(current, async () => { assert.fail("must not upload after deadline"); });
  h.options.source = async () => { h.advance(1001); return new Blob(["media"]); };
  await h.run();
  assert.equal(current.state, "retryable");
  assert.equal(current.intent, undefined);
  assert.equal(current.mode, "done");
});

test("safe HTTP retries honor Retry-After and request timeout aborts fetch", async () => {
  let requests = 0;
  const sleeps: number[] = [];
  const client = new service.SonioxClient({ apiKey: "secret", sleep: async ms => { sleeps.push(ms); },
    fetch: async () => ++requests === 1 ? json({ error_type: "limit_exceeded" }, 429, { "Retry-After": "2" }) : json({ id: "remote", status: "queued" }) });
  assert.equal((await client.get("remote")).status, "queued");
  assert.deepEqual(sleeps, [2000]);
  let aborts = 0;
  const timeoutClient = new service.SonioxClient({ apiKey: "secret", requestTimeoutMs: 1, sleep: async () => {},
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => { aborts++; reject(new Error("aborted")); }, { once: true });
    }) });
  await assert.rejects(timeoutClient.get("remote"), /timed out/);
  assert.equal(aborts, 3);
  assert.throws(() => new service.SonioxClient({ apiKey: "secret", baseUrl: "https://attacker.invalid" }), /base URL/);
});

test("definitive POST rejections clear intents, clean uploaded files and redact server credentials", async () => {
  for (const status of [400, 401, 402, 429]) {
    const current = job({ fileIds: ["file"] });
    let posts = 0;
    const h = harness(current, async (url, init) => {
      if (init.method === "POST") {
        posts++;
        return json({ error_type: "rejected", message: "Rejected test-secret" }, status);
      }
      assert.equal(init.method, "DELETE");
      assert.ok(url.endsWith("/files/file"));
      return deleted();
    });
    await h.run();
    assert.equal(posts, 1);
    assert.equal(current.state, status === 429 ? "retryable" : "failed");
    assert.equal(current.intent, undefined);
    assert.equal(current.mode, "done");
    assert.ok(!JSON.stringify(h.saves).includes("test-secret"));
  }
});

test("cleanup network failures keep a successful result completed and persist remaining IDs", async () => {
  const current = job({ fileIds: ["file"], transcriptionIds: ["remote"] });
  const h = harness(current, async (url, init) => {
    if (init.method === "DELETE") throw new TypeError("offline");
    if (url.endsWith("/transcript")) return json({ id: "remote", text: "real", tokens: [raw("real", 0, 100)] });
    return json({ id: "remote", status: "completed" });
  });
  await h.run();
  assert.equal(current.state, "completed");
  assert.equal(current.mode, "cleanup");
  assert.deepEqual(current.fileIds, ["file"]);
  assert.deepEqual(current.transcriptionIds, ["remote"]);
  assert.equal(h.results.length, 1);
});

async function until(predicate: () => Promise<boolean>, message: string) {
  const end = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const ledger = async () => JSON.parse(await readFile(path.join(directory, "soniox.json"), "utf8")) as { jobs: Record<string, SonioxJob>; owners: Record<string, string> };

test("boot recovery cleans an orphaned project using the external ledger and persists 409", async () => {
  const orphan = job({ projectId: "deleted-project", fileIds: ["orphan-file"], transcriptionIds: ["orphan-job"], state: "processing", createdAt: Date.now() });
  const project = await store.newProject("Committed result before crash");
  const words = normalizeTokens([raw("original", 0, 100)]);
  words[0].text = "corrected"; words[0].corrected = true;
  project.assets = [{ ...asset(words), transcription: "completed" }];
  await store.saveHistory({ project, undo: [], redo: [] });
  const resumed = job({ id: "resumed", projectId: project.id, fileIds: ["committed-file"], transcriptionIds: ["committed-job"],
    state: "queued", createdAt: Date.now(), deadlineAt: Date.now() + 60_000 });
  const obsolete = job({ ...resumed, id: "obsolete", state: "cancelled", mode: "cleanup", cancelRequested: true,
    fileIds: ["obsolete-file"], transcriptionIds: ["obsolete-job"] });
  await store.atomicJson(path.join(directory, "soniox.json"), { version: 1,
    jobs: { [orphan.id]: orphan, [obsolete.id]: obsolete, [resumed.id]: resumed },
    owners: { "deleted-project:asset": orphan.id, [`${project.id}:asset`]: resumed.id } });
  process.env.SONIOX_API_KEY = "test-secret";
  globalThis.fetch = async (url, init) => {
    if (init?.method === "DELETE") return String(url).includes("committed") ? deleted() : json({ error_type: "transcription_invalid_state" }, 409);
    if (String(url).endsWith("/transcript")) return json({ id: "committed-job", text: "original", tokens: [raw("original", 0, 100)] });
    return json({ id: "committed-job", status: "completed" });
  };
  await service.recoverTranscriptions();
  await until(async () => (await ledger()).jobs[orphan.id]?.cleanupAttempts === 1, "cleanup was not persisted");
  await until(async () => !(await ledger()).jobs[resumed.id], "committed result was not recovered");
  const recoveredAsset = (await store.loadProject(project.id)).assets[0];
  assert.equal(recoveredAsset.transcription, "completed");
  assert.equal(recoveredAsset.tokens[0].text, "corrected");
  assert.equal(recoveredAsset.tokens[0].original, "original");
  assert.equal((await ledger()).jobs[obsolete.id].mode, "cleanup");
  const saved = (await ledger()).jobs[orphan.id];
  assert.equal(saved.state, "cancelled");
  assert.equal(saved.mode, "cleanup");
  assert.deepEqual(saved.fileIds, ["orphan-file"]);
  await assert.rejects(store.loadProject("deleted-project"), /Project not found/);
  globalThis.fetch = async () => json({}, 404);
  await service.cleanupProjectTranscriptions("deleted-project");
  await service.cleanupProjectTranscriptions(project.id);
  await store.deleteProject(project.id);
  await until(async () => Object.keys((await ledger()).jobs).length === 0, "orphan cleanup did not finish");
});

test("missing server credentials report retryable without creating a remote job", async () => {
  delete process.env.SONIOX_API_KEY;
  const project = await store.newProject("Missing credentials");
  project.assets = [asset()];
  await store.saveHistory({ project, undo: [], redo: [] });
  globalThis.fetch = async () => { assert.fail("must not contact Soniox without a server key"); };
  await assert.rejects(service.startTranscription(project.id, "asset"), /SONIOX_API_KEY/);
  const media = (await store.loadProject(project.id)).assets[0];
  assert.equal(media.transcription, "retryable");
  assert.deepEqual(media.tokens, []);
  assert.equal(Object.keys((await ledger()).jobs).length, 0);
  await store.deleteProject(project.id);
  process.env.SONIOX_API_KEY = "test-secret";
});

test("background admission allows two active plus five queued; deletion survives in-flight upload", async () => {
  const project = await store.newProject("Concurrency test");
  project.assets = Array.from({ length: 8 }, (_, i) => ({ ...asset(), id: `asset-${i}` }));
  await store.saveHistory({ project, undo: [], redo: [] });
  for (const media of project.assets) await writeFile(store.mediaPath(project.id, media.id), "test");
  const release: (() => void)[] = [];
  let uploads = 0, creates = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "DELETE") return deleted();
    if (String(url).endsWith("/transcriptions")) { creates++; return json({ id: "unexpected" }, 201); }
    const fileId = `file-${++uploads}`;
    await new Promise<void>(resolve => release.push(resolve));
    return json({ id: fileId }, 201);
  };
  for (const media of project.assets.slice(0, 7)) await service.startTranscription(project.id, media.id);
  await until(async () => release.length === 2, "two workers did not reach upload");
  const pending = Object.values((await ledger()).jobs);
  assert.equal(pending.filter(item => item.state === "uploading").length, 2);
  assert.equal(pending.filter(item => item.state === "queued").length, 5);
  await assert.rejects(service.startTranscription(project.id, "asset-7"), /queue is full/);
  assert.equal((await store.loadProject(project.id)).assets[7].transcription, "retryable");
  await service.cancelTranscription(project.id, "asset-0");
  assert.equal((await store.loadProject(project.id)).assets[0].transcription, "cancelled");
  await service.cleanupProjectTranscriptions(project.id);
  await store.deleteProject(project.id);
  assert.ok(Object.keys((await ledger()).jobs).length > 0);
  release.forEach(resolve => resolve());
  await until(async () => Object.keys((await ledger()).jobs).length === 0, "cancelled uploads were not cleaned");
  assert.equal(uploads, 2);
  assert.equal(creates, 0);
  await service.recoverTranscriptions();
  await assert.rejects(store.loadProject(project.id), /Project not found/);
  assert.deepEqual((await ledger()).owners, {});
});

test("FFmpeg preprocessing uploads mono FLAC with a delayed audio track aligned to source zero", async context => {
  const exec = promisify(execFile);
  try { await exec("ffmpeg", ["-version"]); await exec("ffprobe", ["-version"]); }
  catch { context.skip("FFmpeg/ffprobe not installed; original-container fallback is covered above"); return; }
  const project = await store.newProject("Audio offset test");
  project.assets = [{ ...asset(), duration: 2000 }];
  await store.saveHistory({ project, undo: [], redo: [] });
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-filter_threads", "2",
    "-f", "lavfi", "-i", "color=c=black:s=32x32:r=10:d=2", "-itsoffset", "0.5", "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=16000:duration=1", "-map", "0:v", "-map", "1:a",
    "-c:v", "mpeg4", "-threads", "2", "-c:a", "aac", "-f", "mp4", store.mediaPath(project.id, "asset")]);
  let audio: Buffer | undefined;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "DELETE") return deleted();
    if (init?.method === "POST" && String(url).endsWith("/files")) {
      audio = Buffer.from(await ((init.body as FormData).get("file") as Blob).arrayBuffer());
      return json({ id: "extracted-file" }, 201);
    }
    if (init?.method === "POST") return json({ id: "extracted-job" }, 201);
    if (String(url).endsWith("/transcript")) return json({ id: "extracted-job", text: "", tokens: [] });
    return json({ id: "extracted-job", status: "completed" });
  };
  await service.startTranscription(project.id, "asset");
  await until(async () => Object.keys((await ledger()).jobs).length === 0, "audio extraction did not finish");
  assert.ok(audio);
  assert.equal(audio.subarray(0, 4).toString(), "fLaC");
  const extracted = path.join(directory, "captured.flac");
  await writeFile(extracted, audio);
  const result = await exec("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", extracted]);
  const metadata = JSON.parse(result.stdout);
  assert.equal(metadata.streams[0].channels, 1);
  assert.equal(metadata.streams[0].sample_rate, "16000");
  assert.ok(Number(metadata.format.duration) > 1.4, "leading source offset was lost");
  assert.ok(Number(metadata.format.duration) < 1.7, "audio was stretched beyond its source span");
  await service.cleanupProjectTranscriptions(project.id);
  await store.deleteProject(project.id);
});
