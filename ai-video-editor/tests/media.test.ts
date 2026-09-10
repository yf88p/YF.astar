import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProject, makeClip, type Asset, type Project, uid } from "../src/lib/timeline";

let root: string;
let media: typeof import("../src/lib/server/media");
let render: typeof import("../src/lib/server/render");
let store: typeof import("../src/lib/server/store");
const oldData = process.env.DATA_DIR;
const fixture = (name: string) => path.join(root, name);

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "editor-media-test-"));
  process.env.DATA_DIR = path.join(root, "data");
  store = await import("../src/lib/server/store");
  media = await import("../src/lib/server/media");
  render = await import("../src/lib/server/render");
  await media.runFFmpeg([
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=1",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=1",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=2",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", fixture("video.mp4"),
  ]);
  await media.runFFmpeg(["-f", "lavfi", "-i", "aevalsrc='if(between(t,0.5,1.5),0.25*sin(2*PI*440*t),0)':s=8000:d=2", "-c:a", "pcm_s16le", fixture("tone.wav")]);
  await media.runFFmpeg(["-f", "lavfi", "-i", "color=c=lime:s=160x90", "-frames:v", "1", "-c:v", "png", "-threads", "2", fixture("green.png")]);
});

after(async () => {
  if (store && render) for (const project of await store.listProjects()) await render.cancelProjectRenders(project.id);
  if (root) await rm(root, { recursive: true, force: true });
  if (oldData === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldData;
});

async function upload(projectId: string, name: string, mime: string) {
  return media.importMedia(projectId, new File([await readFile(fixture(name))], name, { type: mime }));
}

async function finish(projectId: string, id: string) {
  const deadline = Date.now() + 30_000;
  let previous = 0;
  while (Date.now() < deadline) {
    const job = await render.getRender(projectId, id);
    assert.ok(job.progress >= previous && job.progress <= 100);
    previous = job.progress;
    if (!["queued", "rendering"].includes(job.status)) return job;
    await delay(50);
  }
  throw new Error("Render did not finish within 30 seconds");
}

async function pixel(file: string, time: number, x: number, y: number) {
  const bytes = await media.runFFmpeg(["-protocol_whitelist", "file,pipe", "-ss", String(time), "-i", file, "-vf", `crop=2:2:${x}:${y},scale=1:1`, "-frames:v", "1", "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
  assert.equal(bytes.length, 3);
  return [...bytes];
}

async function rms(file: string, time: number, length = 0.1) {
  const bytes = await media.runFFmpeg(["-protocol_whitelist", "file,pipe", "-ss", String(time), "-i", file, "-t", String(length), "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]);
  let squares = 0;
  for (let i = 0; i < bytes.length; i += 4) squares += bytes.readFloatLE(i) ** 2;
  return Math.sqrt(squares / (bytes.length / 4));
}

function fakeAsset(kind: Asset["kind"] = "video"): Asset {
  return { id: uid(), kind, name: "Source", duration: 4000, hasAudio: kind !== "image", bytes: 100, mime: kind === "image" ? "image/png" : "video/mp4", waveform: [], silence: [], thumbnail: false, tokens: [], transcription: "idle" };
}

test("probe detects real streams/signatures without relying on the stored extension", async () => {
  await writeFile(fixture("opaque.source"), await readFile(fixture("video.mp4")));
  const video = await media.probeMedia(fixture("opaque.source"));
  assert.equal(video.kind, "video");
  assert.equal(video.format, "mov");
  assert.equal(video.hasAudio, true);
  assert.equal(video.width, 160);
  assert.equal(video.height, 90);
  assert.ok(Math.abs(video.duration - 2000) < 50);
  const audio = await media.probeMedia(fixture("tone.wav"));
  assert.equal(audio.kind, "audio");
  assert.equal(audio.duration, 2000);
  const image = await media.probeMedia(fixture("green.png"));
  assert.equal(image.kind, "image");
  assert.equal(image.duration, 5000);
});

test("imports create real source, MP4 proxy, JPEG thumbnail, waveform and silence, without timeline clips", async () => {
  const project = await store.newProject("Import coverage");
  const video = await upload(project.id, "video.mp4", "video/mp4");
  const audio = await upload(project.id, "tone.wav", "audio/wav");
  const image = await upload(project.id, "green.png", "image/png");
  assert.ok(video.thumbnail && image.thumbnail);
  assert.equal(audio.thumbnail, false);
  assert.ok(video.waveform.some(value => value > 0.05));
  assert.ok(audio.waveform.every(value => value >= 0 && value <= 1));
  assert.ok(audio.waveform.some(value => value > 0.2));
  assert.ok(audio.waveform.slice(0, 8).every(value => value === 0));
  assert.ok(audio.silence.some(range => range.start === 0 && Math.abs(range.end - 500) <= 30));
  assert.ok(audio.silence.some(range => Math.abs(range.start - 1500) <= 30 && range.end === 2000));
  assert.deepEqual(await readFile(store.mediaPath(project.id, video.id)), await readFile(fixture("video.mp4")));
  for (const asset of [video, audio]) {
    const preview = await media.probeMedia(store.mediaPath(project.id, asset.id, "preview"));
    assert.equal(preview.format, "mov");
    assert.equal(preview.kind, asset.kind);
    assert.ok(Math.abs(preview.duration - asset.duration) <= 80);
  }
  for (const asset of [video, image]) {
    assert.equal((await media.probeMedia(store.mediaPath(project.id, asset.id, "thumb"))).format, "jpeg_pipe");
  }
  const saved = await store.loadProject(project.id);
  assert.equal(saved.assets.length, 3);
  assert.equal(saved.clips.length, 0);
  assert.equal(saved.revision, 3);
  assert.ok((await readdir(store.mediaDir(project.id))).every(name => !name.startsWith(".import")));
});

test("SRT and WebVTT become millisecond cue tokens, not timeline clips", async () => {
  const project = await store.newProject("Captions");
  const srt = await media.importMedia(project.id, new File(["\uFEFF1\r\n00:00:00,120 --> 00:00:01,250\r\nHello <b>world</b>!\r\n\r\n2\r\n00:00:01,400 --> 00:00:02,000\r\nSecond line\r\n"], "captions.srt", { type: "application/x-subrip" }));
  assert.equal(srt.kind, "subtitle");
  assert.equal(srt.transcription, "completed");
  assert.equal(srt.duration, 2000);
  assert.deepEqual(srt.tokens.map(({ text, start, end, original }) => ({ text, start, end, original })), [
    { text: "Hello world!", original: "Hello world!", start: 120, end: 1250 },
    { text: "Second line", original: "Second line", start: 1400, end: 2000 },
  ]);
  const vtt = await media.importMedia(project.id, new File(["WEBVTT\n\nNOTE ignored\nmetadata\n\ncue-a\n00:00.200 --> 00:01.000 align:center\nA &amp; B\nnext line\n"], "captions.vtt", { type: "text/vtt" }));
  assert.equal(vtt.tokens[0].start, 200);
  assert.equal(vtt.tokens[0].text, "A & B\nnext line");
  assert.equal((await store.loadProject(project.id)).clips.length, 0);
  for (const text of ["not subtitles", "1\n00:00:02,000 --> 00:00:01,000\nbackwards", "1\n00:60:00,000 --> 00:61:00,000\ninvalid", "1\n00:10:00,000 --> 00:10:01,000\ntoo long"]) {
    await assert.rejects(media.importMedia(project.id, new File([text], "bad.srt", { type: "text/plain" })), /subtitle/i);
  }
  assert.equal((await store.loadProject(project.id)).assets.length, 2);
});

test("audio-only MP4/WebM containers and JPEG/WebP images are signature-validated and imported", async () => {
  const project = await store.newProject("Container variants");
  for (const [extension, codec, mime] of [["mp4", "aac", "audio/mp4"], ["webm", "libopus", "audio/webm"]]) {
    const name = `audio.${extension}`;
    await media.runFFmpeg(["-i", fixture("tone.wav"), "-vn", "-c:a", codec, "-ar", "48000", "-threads", "2", fixture(name)]);
    const asset = await upload(project.id, name, mime);
    assert.equal(asset.kind, "audio");
    assert.equal(asset.mime, mime);
    assert.equal((await media.probeMedia(store.mediaPath(project.id, asset.id, "preview"))).audioCodec, "aac");
    await assert.rejects(upload(project.id, name, mime.replace("audio/", "video/")), /contents do not match/);
  }
  for (const [extension, codec, mime] of [["jpg", "mjpeg", "image/jpeg"], ["webp", "libwebp", "image/webp"]]) {
    const name = `image.${extension}`;
    await media.runFFmpeg(["-i", fixture("green.png"), "-frames:v", "1", "-c:v", codec, "-threads", "2", fixture(name)]);
    const asset = await upload(project.id, name, mime);
    assert.equal(asset.kind, "image");
    assert.equal(asset.thumbnail, true);
    assert.equal((await stat(store.mediaPath(project.id, asset.id, "thumb"))).mode & 0o777, 0o600);
    await store.mutateProject(project.id, p => { p.clips = [{ ...makeClip(asset, "video"), sourceOut: 200 }]; return p; });
    const job = await render.startRender(project.id);
    assert.equal((await finish(project.id, job.id)).status, "completed");
  }
  await media.runFFmpeg(["-i", fixture("green.png"), "-vf", "scale=1:1", "-frames:v", "1", "-threads", "2", fixture("tiny.png")]);
  const tiny = await upload(project.id, "tiny.png", "image/png");
  assert.equal(tiny.width, 1);
  assert.equal(tiny.height, 1);
  assert.equal(tiny.thumbnail, true);
});

test("rejects MIME/extension/signature mismatches, playlists, unsafe paths and truncated media with no partial assets", async () => {
  const project = await store.newProject("Untrusted files");
  const png = await readFile(fixture("green.png"));
  for (const [bytes, name, type] of [
    [png, "image.svg", "image/svg+xml"], [png, "image.png", "text/html"],
    [png, "fake.mp4", "video/mp4"], [png, "../escape.png", "image/png"],
    [png, "bad\\image.png", "image/png"], [Buffer.from("#EXTM3U\nfile:///etc/passwd\n"), "evil.mp4", "video/mp4"],
    [Buffer.from("ffconcat version 1.0\nfile '/etc/passwd'\n"), "evil.wav", "audio/wav"],
    [png.subarray(0, 16), "broken.png", "image/png"],
  ] as const) {
    await assert.rejects(media.importMedia(project.id, new File([bytes], name, { type })), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(root) && !error.message.includes("/etc/passwd"));
      return true;
    });
  }
  await assert.rejects(media.importMedia("../outside", new File([png], "image.png", { type: "image/png" })), /Invalid resource ID/);
  await assert.rejects(media.probeMedia("https://example.invalid/video.mp4"), /Invalid/);
  assert.deepEqual(await readdir(store.mediaDir(project.id)), []);
  assert.equal((await store.loadProject(project.id)).assets.length, 0);
});

test("upload byte, decoded duration, resolution and streamed size limits are enforced", async () => {
  const project = await store.newProject("Limits");
  const png = await readFile(fixture("green.png"));
  for (const [name, value, file] of [
    ["MEDIA_MAX_BYTES", "16", "green.png"],
    ["MEDIA_MAX_DURATION_SECONDS", "1", "video.mp4"],
    ["MEDIA_MAX_PIXELS", "100", "green.png"],
  ]) {
    const old = process.env[name];
    process.env[name] = value;
    try { await assert.rejects(media.probeMedia(fixture(file)), /Invalid/); }
    finally { if (old === undefined) delete process.env[name]; else process.env[name] = old; }
  }
  const fake = new File(["x"], "fake.png", { type: "image/png" });
  Object.defineProperty(fake, "stream", { value: () => new ReadableStream({ start(controller) { controller.enqueue(png); controller.close(); } }) });
  await assert.rejects(media.importMedia(project.id, fake), /upload size/);
  assert.deepEqual(await readdir(store.mediaDir(project.id)), []);
});

test("only two imports can run, and simultaneous asset mutations do not lose data", async () => {
  const project = await store.newProject("Concurrent uploads");
  const png = await readFile(fixture("green.png"));
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const held = () => {
    const file = new File([png], "held.png", { type: "image/png" });
    Object.defineProperty(file, "stream", { value: () => new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }) });
    return media.importMedia(project.id, file);
  };
  const first = held(), second = held();
  await assert.rejects(upload(project.id, "green.png", "image/png"), /Two media imports/);
  while (controllers.length < 2) await delay(5);
  for (const controller of controllers) { controller.enqueue(png); controller.close(); }
  await Promise.all([first, second]);
  assert.equal((await store.loadProject(project.id)).assets.length, 2);
});

test("FFmpeg supports bounded progress, abort, timeout, and bounded stdout without exposing diagnostics", async () => {
  const progress: number[] = [];
  await media.runFFmpeg(["-f", "lavfi", "-i", "color=s=16x16:d=0.2", "-f", "null", "-"], { duration: 200, progress: value => progress.push(value) });
  assert.ok(progress.length > 0 && progress.every(value => value >= 0 && value <= 100));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(media.runFFmpeg([], { signal: controller.signal }), { name: "AbortError" });
  const running = new AbortController();
  const operation = media.runFFmpeg(["-re", "-f", "lavfi", "-i", "color=s=16x16:d=30", "-f", "null", "-"], { signal: running.signal });
  setTimeout(() => running.abort(), 100);
  await assert.rejects(operation, { name: "AbortError" });
  await assert.rejects(media.runFFmpeg(["-re", "-f", "lavfi", "-i", "color=s=16x16:d=30", "-f", "null", "-"], { timeoutMs: 20 }), /timed out/);
  await assert.rejects(media.runFFmpeg(["-f", "lavfi", "-i", "color=s=1280x720:d=1", "-frames:v", "1", "-f", "rawvideo", "pipe:1"]), /output exceeds/);
  await assert.rejects(media.runFFmpeg(["-i", fixture("SECRET-missing.mp4"), "-f", "null", "-"]), error => error instanceof Error && error.message === "Media processing failed");
  if (process.platform === "linux") {
    const old = process.env.FFMPEG_MAX_RSS_BYTES;
    process.env.FFMPEG_MAX_RSS_BYTES = "1";
    try {
      await assert.rejects(media.runFFmpeg(["-re", "-f", "lavfi", "-i", "color=s=16x16:d=30", "-f", "null", "-"]), /memory limit/);
    } finally { if (old === undefined) delete process.env.FFMPEG_MAX_RSS_BYTES; else process.env.FFMPEG_MAX_RSS_BYTES = old; }
  }
});

test("render plan respects source milliseconds, layer order, transforms, audio mixing and literal caption files", () => {
  const project = createProject();
  const asset = fakeAsset(); project.assets.push(asset);
  project.tracks.push({ id: "bottom", name: "Background", kind: "video", muted: false, solo: false });
  const bottom = { ...makeClip(asset, "bottom"), sourceIn: 1000, sourceOut: 3000, speed: 4, start: 200, volume: 0.5, fadeIn: 100, fadeOut: 100 };
  const top = { ...makeClip(asset, "video"), sourceOut: 1000, speed: 0.25, effects: { ...makeClip(asset, "video").effects, crop: 0.1, scale: 0.5, x: 0.25, y: -0.25, rotation: 15, brightness: 0.1, contrast: 1.2, saturation: 0.7 } };
  const caption = { ...makeClip(undefined, "titles"), text: "literal %{eif:1:d} ':;[evil]\\n\nsecond line", transition: "fade" as const };
  project.clips.push(caption, top, bottom);
  const plan = render.buildRenderPlan(project);
  assert.deepEqual(plan.clipIds, [bottom.id, top.id, caption.id]);
  assert.equal(plan.duration, 4000);
  assert.equal(plan.revision, project.revision);
  assert.equal(plan.args[plan.args.indexOf("-ss") + 1], "1");
  assert.match(plan.filterComplex, /atempo=2,atempo=2/);
  assert.match(plan.filterComplex, /atempo=0.5,atempo=0.5/);
  assert.match(plan.filterComplex, /adelay=9600S:all=1/);
  assert.match(plan.filterComplex, /amix=inputs=3/);
  assert.match(plan.filterComplex, /normalize=0/);
  assert.match(plan.filterComplex, /crop=iw\*0.8/);
  assert.match(plan.filterComplex, /rotate=0.261799/);
  assert.match(plan.filterComplex, /brightness=0.1:contrast=1.2:saturation=0.7/);
  assert.match(plan.filterComplex, /x=\(W-w\)\/2\+320:y=\(H-h\)\/2\+-180/);
  assert.match(plan.filterComplex, /expansion=none/);
  assert.ok(!plan.filterComplex.includes(caption.text));
  assert.equal(plan.textFiles[0].content, caption.text);
  assert.match(plan.filterComplex, /fade=t=in.*alpha=1/);
  assert.match(plan.filterComplex, /afade=t=out:st=0.4:d=0.1/);
  assert.ok(plan.args.includes("file,pipe"));
  assert.deepEqual(project.clips.map(c => c.id), [caption.id, top.id, bottom.id]);
});

test("muted and solo tracks filter visuals/audio; zero volume omits sound; invalid/overlong plans fail", () => {
  const project = createProject();
  const asset = fakeAsset(); project.assets.push(asset);
  project.clips.push(makeClip(asset, "video"), makeClip(asset, "audio"), makeClip(undefined, "titles"));
  project.tracks[1].muted = true;
  let plan = render.buildRenderPlan(project);
  assert.ok(!plan.clipIds.includes(project.clips[0].id));
  project.tracks[2].solo = true;
  plan = render.buildRenderPlan(project);
  assert.deepEqual(plan.clipIds, [project.clips[1].id]);
  assert.match(plan.filterComplex, /amix=inputs=2/);
  project.clips[1].volume = 0;
  assert.match(render.buildRenderPlan(project).filterComplex, /amix=inputs=1/);
  assert.throws(() => render.buildRenderPlan(createProject()), /Add clips/);
  const long = createProject();
  long.clips.push({ ...makeClip(undefined, "titles"), sourceOut: 600_001 });
  assert.throws(() => render.buildRenderPlan(long), /duration limit/);
  long.clips[0].sourceOut = 600_000;
  assert.equal(render.buildRenderPlan(long).duration, 600_000);
  long.clips[0].speed = 0.1;
  assert.throws(() => render.buildRenderPlan(long));
});

test("real export composites trimmed/speed-adjusted video, transformed image, literal text and faded mixed audio", async () => {
  const project = await store.newProject("Real composition");
  const video = await upload(project.id, "video.mp4", "video/mp4");
  const image = await upload(project.id, "green.png", "image/png");
  const audio = await upload(project.id, "tone.wav", "audio/wav");
  const saved = await store.mutateProject(project.id, p => {
    p.tracks.push({ id: "background", name: "Background", kind: "video", muted: false, solo: false });
    p.clips.push(
      { ...makeClip(video, "background", 100), sourceIn: 1000, sourceOut: 2000, speed: 2, volume: 0 },
      { ...makeClip(image, "video", 300), sourceOut: 700, effects: { ...makeClip(image, "video").effects, scale: 0.5, x: 0.25, crop: 0.1, brightness: 0.02, contrast: 1.1, saturation: 0.9 } },
      { ...makeClip(undefined, "titles"), sourceOut: 1000, fontSize: 24, text: "Literal %{eif:1:d} ':;[unsafe]\\n\nCaption", effects: { ...makeClip(undefined, "titles").effects, y: -0.4 } },
      ...[0, 1].map(() => ({ ...makeClip(audio, "audio", 200), sourceIn: 500, sourceOut: 1500, speed: 2, volume: 0.5, fadeIn: 100, fadeOut: 100 })),
    );
    return p;
  });
  const queued = await render.startRender(project.id);
  assert.equal(queued.duration, 1000);
  assert.equal(queued.revision, saved.revision);
  await store.mutateProject(project.id, p => { p.clips = []; return p; });
  const job = await finish(project.id, queued.id);
  assert.equal(job.status, "completed", job.error);
  assert.equal(job.progress, 100);
  const output = render.exportPath(project.id, job.id);
  const metadata = await media.probeMedia(output);
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);
  assert.equal(metadata.hasAudio, true);
  assert.equal(metadata.videoCodec, "h264");
  assert.equal(metadata.audioCodec, "aac");
  assert.equal(metadata.fps, 30);
  assert.ok(Math.abs(metadata.duration - 1000) < 60);
  const blue = await pixel(output, 0.2, 200, 360);
  assert.ok(blue[2] > 200 && blue[0] < 30 && blue[1] < 30, `Expected trimmed blue frame: ${blue}`);
  const green = await pixel(output, 0.45, 900, 360);
  assert.ok(green[1] > 180 && green[0] < 80 && green[2] < 80, `Expected top green layer: ${green}`);
  const gap = await pixel(output, 0.85, 200, 360);
  assert.ok(gap.every(value => value < 15), `Expected black gap, not held video: ${gap}`);
  assert.ok(await rms(output, 0.35) > 0.1, "Both audio clips should be mixed at their timeline position");
  assert.ok(await rms(output, 0) < 0.005);
  assert.ok(await rms(output, 0.85) < 0.005);
  const files = await readdir(path.dirname(output));
  assert.ok(!files.some(name => name.includes(".part") || name.endsWith(".tmp")));
  const snapshot = JSON.parse(await readFile(path.join(path.dirname(output), "project.json"), "utf8")) as Project;
  assert.equal(snapshot.revision, saved.revision);
  assert.equal(snapshot.clips.length, 5);
});

test("queue has one worker/five waiting slots; individual and project cancellation remove partial output", async () => {
  const project = await store.newProject("Queue");
  await store.mutateProject(project.id, p => { p.clips.push({ ...makeClip(undefined, "titles"), sourceOut: 600_000 }); return p; });
  const jobs = [];
  for (let i = 0; i < 6; i++) jobs.push(await render.startRender(project.id));
  await assert.rejects(render.startRender(project.id), /queue is full/);
  const states = await Promise.all(jobs.map(job => render.getRender(project.id, job.id)));
  assert.equal(states.filter(job => job.status === "rendering").length, 1);
  assert.equal(states.filter(job => job.status === "queued").length, 5);
  const deadline = Date.now() + 10_000;
  while ((await render.getRender(project.id, jobs[0].id)).progress === 0 && Date.now() < deadline) await delay(20);
  assert.ok((await render.getRender(project.id, jobs[0].id)).progress > 0, "Cancel an encoder that has produced frames");
  await render.cancelRender(project.id, jobs[2].id);
  assert.equal((await render.getRender(project.id, jobs[2].id)).status, "cancelled");
  jobs.push(await render.startRender(project.id));
  await render.cancelRender(project.id, jobs[0].id);
  assert.equal((await render.getRender(project.id, jobs[0].id)).status, "cancelled");
  await render.cancelProjectRenders(project.id);
  for (const job of jobs) {
    assert.equal((await render.getRender(project.id, job.id)).status, "cancelled");
    await assert.rejects(stat(render.exportPath(project.id, job.id)), { code: "ENOENT" });
    assert.ok(!(await readdir(path.dirname(render.exportPath(project.id, job.id)))).some(name => name.endsWith(".part.mp4")));
  }
});

test("audio-only timelines export black video with correct 0.25x and 4x source timing", async () => {
  for (const speed of [0.25, 4]) {
    const project = await store.newProject(`Audio speed ${speed}`);
    const asset = await upload(project.id, "tone.wav", "audio/wav");
    const sourceOut = speed === 0.25 ? 750 : 1500;
    await store.mutateProject(project.id, p => {
      p.clips.push({ ...makeClip(asset, "audio", 100), sourceIn: 500, sourceOut, speed });
      return p;
    });
    const queued = await render.startRender(project.id);
    const job = await finish(project.id, queued.id);
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.duration, 100 + (sourceOut - 500) / speed);
    const output = render.exportPath(project.id, job.id);
    const metadata = await media.probeMedia(output);
    assert.ok(Math.abs(metadata.duration - job.duration) < 50);
    assert.ok((await pixel(output, 0.15, 640, 360)).every(channel => channel < 10));
    assert.ok(await rms(output, 0.15) > 0.08);
    assert.ok(await rms(output, 0, 0.05) < 0.005);
  }
});

test("text color effects preserve transparency, rotation and visual fades reveal lower layers", async () => {
  const project = await store.newProject("Alpha composition");
  const video = await upload(project.id, "video.mp4", "video/mp4");
  const image = await upload(project.id, "green.png", "image/png");
  await store.mutateProject(project.id, p => {
    p.tracks.push({ id: "background", name: "Background", kind: "video", muted: false, solo: false });
    p.clips.push(
      { ...makeClip(video, "background"), sourceIn: 1000, sourceOut: 2000, volume: 0 },
      { ...makeClip(image, "video"), sourceOut: 1000, fadeIn: 400, fadeOut: 400, effects: { ...makeClip(image, "video").effects, scale: 0.3, rotation: 30 } },
      { ...makeClip(undefined, "titles"), sourceOut: 1000, text: "Visible title", effects: { ...makeClip(undefined, "titles").effects, y: -0.3, brightness: 0.1, contrast: 1.2, saturation: 0.5, rotation: 10 } },
    );
    return p;
  });
  const job = await render.startRender(project.id);
  const completed = await finish(project.id, job.id);
  assert.equal(completed.status, "completed", completed.error);
  const output = render.exportPath(project.id, job.id);
  const outside = await pixel(output, 0.5, 100, 360);
  assert.ok(outside[2] > 200 && outside[0] < 30 && outside[1] < 30, `Text canvas must stay transparent: ${outside}`);
  const early = await pixel(output, 0, 640, 360);
  const middle = await pixel(output, 0.5, 640, 360);
  const late = await pixel(output, 0.9, 640, 360);
  assert.ok(early[2] > 200 && early[1] < 30, `Fade should start on lower blue layer: ${early}`);
  assert.ok(middle[1] > 200 && middle[2] < 30, `Rotated green layer should become opaque: ${middle}`);
  assert.ok(late[2] > late[1], `Fade-out should reveal lower layer: ${late}`);
});

test("missing sources fail safely and persisted incomplete jobs are recovered as failed", async () => {
  const project = await store.newProject("Recovery");
  await store.mutateProject(project.id, p => {
    const asset = fakeAsset(); p.assets.push(asset); p.clips.push(makeClip(asset, "video")); return p;
  });
  const queued = await render.startRender(project.id);
  const failed = await finish(project.id, queued.id);
  assert.equal(failed.status, "failed");
  assert.ok(failed.error && !failed.error.includes(root));
  await assert.rejects(stat(render.exportPath(project.id, queued.id)), { code: "ENOENT" });
  for (const status of ["queued", "rendering"] as const) {
    const id = uid(), directory = path.dirname(render.exportPath(project.id, id));
    await mkdir(directory, { recursive: true });
    await store.atomicJson(path.join(directory, "job.json"), { id, projectId: project.id, status, progress: 43, duration: 1000, revision: 1, error: `SECRET ${root}` });
    await writeFile(path.join(directory, "export.part.mp4"), "incomplete");
    await writeFile(path.join(directory, "export.mp4"), "unpublished");
    const job = await render.getRender(project.id, id);
    assert.equal(job.status, "failed");
    assert.ok(job.error && !job.error.includes("SECRET") && !job.error.includes(root));
    assert.equal(JSON.parse(await readFile(path.join(directory, "job.json"), "utf8")).status, "failed");
    await assert.rejects(stat(path.join(directory, "export.part.mp4")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(directory, "export.mp4")), { code: "ENOENT" });
  }
  const other = await store.newProject("Other");
  await assert.rejects(render.getRender(other.id, queued.id), /Render not found/);
  assert.throws(() => render.exportPath(project.id, "../../etc/passwd"), /Invalid resource ID/);
  await assert.rejects(render.getRender("../escape", uid()), /Invalid resource ID/);
  await render.cancelRender(project.id, queued.id);
});
