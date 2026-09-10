import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import type { Project } from "../../src/lib/timeline";

const exec = promisify(execFile);
const filename = "Generated six second clip.mp4";
let temporaryDirectory: string;
let mediaFile: string;
let project: Project;
let createdIds: string[];
let browserErrors: string[];
let unexpectedRequests: string[];

async function edit(page: Page, endpoint: string, action: () => Promise<unknown>): Promise<Project> {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === endpoint && response.request().method() === "POST",
  );
  await action();
  const response = await responsePromise;
  expect(response.ok(), `${response.status()} ${endpoint}`).toBeTruthy();
  await expect(page.locator(".save-status")).toHaveText("All changes saved");
  // Read persisted state independently; Chromium can evict binary-upload response bodies.
  const saved = endpoint === "/api/editor/projects" ? response
    : await page.request.get(endpoint.slice(0, endpoint.lastIndexOf("/")));
  expect(saved.ok()).toBeTruthy();
  const data = await saved.json() as { project: Project };
  return data.project;
}

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "frame-browser-"));
  mediaFile = path.join(temporaryDirectory, filename);
  const args: string[] = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
    "-map", "0:v:0", "-map", "1:a:0", "-t", "6",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", mediaFile,
  ];
  await exec("ffmpeg", args, { timeout: 60_000 });
  expect((await stat(mediaFile)).size).toBeGreaterThan(10_000);
});

test.afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test.beforeEach(async ({ page, context, request, baseURL }, testInfo) => {
  createdIds = [];
  browserErrors = [];
  unexpectedRequests = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await context.route(url => (["http:", "https:"].includes(url.protocol) && url.origin !== baseURL)
    || /\/(assistant|transcribe)$/.test(url.pathname), async route => {
    const url = new URL(route.request().url());
    unexpectedRequests.push(url.origin + url.pathname);
    await route.abort("blockedbyclient");
  });

  // Seed only an empty project so bootstrap never generates the 38-second sample.
  // The project being edited is still created with the real All projects modal.
  const seed = await request.post("/api/editor/projects", { data: { name: "Browser bootstrap" } });
  expect(seed.ok(), await seed.text()).toBeTruthy();
  const { project: blank } = await seed.json() as { project: Project };
  createdIds.push(blank.id);
  const bootstrapPromise = page.waitForResponse("**/api/editor/bootstrap");
  await page.goto("/");
  const bootstrap = await (await bootstrapPromise).json();
  expect(bootstrap).toMatchObject({
    fixtureEnabled: true,
    sonioxConfigured: false,
    project: { id: blank.id, assets: [], clips: [] },
  });
  await expect(page.getByRole("button", { name: blank.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Your projects" });
  const name = `Browser ${testInfo.title.includes("mobile") ? "mobile" : "workflow"}`;
  await modal.getByRole("textbox", { name: "New project name" }).fill(name);
  project = await edit(page, "/api/editor/projects", () => modal.getByRole("button", { name: "New project", exact: true }).click());
  createdIds.push(project.id);
  await expect(modal).not.toBeVisible();
  expect(project).toMatchObject({ name, assets: [], clips: [], fixture: false });
});

test.afterEach(async ({ request }, testInfo) => {
  if (project && createdIds.includes(project.id)) {
    const saved = await request.get(`/api/editor/projects/${project.id}`);
    await testInfo.attach("saved-project", { body: await saved.body(), contentType: "application/json" });
  }
  for (const id of createdIds) {
    const deleted = await request.delete(`/api/editor/projects/${id}`);
    expect.soft(deleted.ok(), await deleted.text()).toBeTruthy();
  }
  expect.soft(browserErrors, "Uncaught browser errors").toEqual([]);
  expect.soft(unexpectedRequests, "No external services or live transcription/AI requests").toEqual([]);
});

test("imports, trims, splits, ripple-edits fixture words, captions, reloads and exports real media", async ({ page, request }, testInfo) => {
  const endpoint = `/api/editor/projects/${project.id}`;
  project = await edit(page, `${endpoint}/upload`, () => page.getByLabel("Import media files").setInputFiles(mediaFile));
  expect(project.assets).toHaveLength(1);
  const asset = project.assets[0];
  expect(asset).toMatchObject({ name: filename, kind: "video", hasAudio: true, thumbnail: true, tokens: [] });
  expect(asset.duration).toBeCloseTo(6000, -1);
  expect(asset.waveform.some(peak => peak > 0)).toBeTruthy();
  const thumbnail = page.getByRole("img", { name: filename, exact: true });
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  project = await edit(page, `${endpoint}/commands`, () => page.getByRole("button", { name: `Add ${filename} to timeline`, exact: true }).click());
  await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
  expect(project.clips[0]).toMatchObject({ assetId: asset.id, start: 0, sourceIn: 0, sourceOut: asset.duration });

  await test.step("Trim and split with inspector and playhead controls", async () => {
    await page.getByRole("button", { name: "Show clip inspector", exact: true }).click();
    const sourceOut = page.getByRole("spinbutton", { name: "Source out", exact: true });
    await sourceOut.fill("5");
    project = await edit(page, `${endpoint}/commands`, () => sourceOut.press("Tab"));
    expect(project.clips[0].sourceOut).toBe(5000);

    const zoom = Number(await page.getByRole("slider", { name: "Timeline zoom" }).inputValue());
    await page.locator(".timeline-ruler").click({ position: { x: 2 * zoom, y: 10 } });
    await expect(page.locator(".time-display b")).toHaveText("00:02:00");
    project = await edit(page, `${endpoint}/commands`, () => page.getByRole("button", { name: "Split at playhead (S)", exact: true }).click());
    await expect(page.getByTestId("timeline-clip")).toHaveCount(2);
    expect(project.clips.map(clip => ({ start: clip.start, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut }))).toEqual([
      { start: 0, sourceIn: 0, sourceOut: 2000 },
      { start: 2000, sourceIn: 2000, sourceOut: 5000 },
    ]);
  });

  let expectedDuration = 5000;
  await test.step("Review source-linked fixture word removal before applying one transaction", async () => {
    await page.getByRole("navigation", { name: "Workspace panels" }).getByRole("button", { name: "Captions", exact: true }).click();
    project = await edit(page, `${endpoint}/fixture-transcript`, () => page.getByRole("button", { name: "Use labeled fixture words for testing", exact: true }).click());
    const sourceTokens = project.assets[0].tokens;
    expect(project.assets[0]).toMatchObject({ fixture: true, transcription: "completed" });
    expect(sourceTokens[0]).toMatchObject({ text: "Sometimes, ", raw: { fixture: true, synthetic: true } });
    await expect(page.getByText("Labeled fixture words added. These are not Soniox results.", { exact: true })).toBeVisible();
    const words = page.locator(".transcript-words");
    await words.getByRole("button", { name: "Sometimes,", exact: true }).click();
    await words.getByRole("button", { name: "the", exact: true }).first().click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 words selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ripple remove", exact: true }).click();
    const proposal = page.locator(".proposal-card");
    await expect(proposal).toContainText("Edit the words. Shape the story.");
    await proposal.getByText("Inspect changes", { exact: true }).click();
    await expect(proposal).toContainText("Ripple-remove 2 source ranges");
    const before = await (await request.get(endpoint)).json() as { project: Project };
    expect(before.project).toEqual(project);

    const removedEnd = sourceTokens[1].end;
    expectedDuration -= removedEnd;
    const revision = project.revision;
    project = await edit(page, `${endpoint}/commands`, () => proposal.getByRole("button", { name: "Apply edits", exact: true }).click());
    expect(project.revision).toBe(revision + 1);
    expect(project.assets[0].tokens).toEqual(sourceTokens);
    expect(project.editLog.at(-1)?.ranges).toEqual(sourceTokens.slice(0, 2).map(token => ({
      assetId: asset.id, start: token.start, end: token.end, tokenIds: [token.id],
    })));
    expect(project.clips.map(clip => ({ start: clip.start, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut }))).toEqual([
      { start: 0, sourceIn: removedEnd, sourceOut: 2000 },
      { start: 2000 - removedEnd, sourceIn: 2000, sourceOut: 5000 },
    ]);
    await expect(words.getByRole("button", { name: "Sometimes,", exact: true })).toHaveCount(0);
    await expect(proposal).not.toBeVisible();
  });

  await test.step("Generate captions and restore the exact saved project after reload", async () => {
    project = await edit(page, `${endpoint}/commands`, () => page.getByRole("button", { name: "Generate captions", exact: true }).click());
    const captions = project.clips.filter(clip => clip.trackId === "titles");
    expect(captions.length).toBeGreaterThan(0);
    expect(captions.every(clip => clip.text && !clip.text.includes("Sometimes,"))).toBeTruthy();
    expect(Math.max(...project.clips.map(clip => clip.start + (clip.sourceOut - clip.sourceIn) / clip.speed))).toBe(expectedDuration);
    await expect(page.getByTestId("timeline-clip")).toHaveCount(project.clips.length);
    await page.getByRole("button", { name: "Selection tool", exact: true }).click();
    await page.keyboard.press("Control+s");
    await expect(page.getByText("All changes are automatically saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: project.name, exact: true })).toBeVisible();
    await expect(page.getByTestId("timeline-clip")).toHaveCount(project.clips.length);
    const persisted = await request.get(endpoint);
    expect(persisted.ok(), await persisted.text()).toBeTruthy();
    expect((await persisted.json()).project).toEqual(project);
    expect(await page.evaluate(() => localStorage.getItem("frame-project"))).toBe(project.id);
    await expect(page.getByRole("region", { name: "Video preview", exact: true }).locator(".preview-text")).toHaveText(captions[0].text!);
  });

  await test.step("Play the actual preview across both cuts", async () => {
    const preview = page.getByRole("region", { name: "Video preview", exact: true });
    await expect(preview).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Play preview", exact: true }).click();
    await expect.poll(() => preview.locator("video").evaluateAll(nodes => nodes.some(node => {
      const video = node as HTMLVideoElement;
      return !video.paused && video.currentTime > 0.6 && video.getVideoPlaybackQuality().totalVideoFrames > 2;
    }))).toBeTruthy();
    const secondClip = project.clips.filter(clip => clip.trackId === "video")[1];
    const secondVideo = preview.locator(`[data-clip-id="${secondClip.id}"] video`);
    await expect.poll(() => secondVideo.evaluate(node => {
      const video = node as HTMLVideoElement;
      return !video.paused && video.currentTime > 2.2 && video.getVideoPlaybackQuality().totalVideoFrames > 2;
    })).toBeTruthy();
    await expect(page.getByRole("button", { name: "Play preview", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  await test.step("Render, play and download the real composited MP4", async () => {
    await page.getByRole("button", { name: "Export video", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Export video" });
    const renderPromise = page.waitForResponse(response => new URL(response.url()).pathname === `${endpoint}/render` && response.request().method() === "POST");
    await modal.getByRole("button", { name: /Export MP4|Start export|Start render|Render video/ }).click();
    const render = await renderPromise;
    expect(render.ok(), await render.text()).toBeTruthy();
    const { job } = await render.json();
    expect(job).toMatchObject({ projectId: project.id, revision: project.revision, duration: expectedDuration });
    const player = modal.getByLabel("Completed export preview");
    await expect(player).toBeVisible({ timeout: 120_000 });
    const completed = await request.get(`/api/editor/renders/${project.id}/${job.id}`);
    expect((await completed.json()).job).toMatchObject({ status: "completed", progress: 100, duration: expectedDuration });
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    expect(await player.evaluate(node => (node as HTMLVideoElement).duration)).toBeCloseTo(expectedDuration / 1000, 1);
    await player.focus();
    await player.press("Space");
    await expect.poll(() => player.evaluate(node => {
      const video = node as HTMLVideoElement;
      return !video.paused && video.currentTime > 0.3 && video.videoWidth === 1280
        && video.videoHeight === 720 && video.getVideoPlaybackQuality().totalVideoFrames > 2 && !video.error;
    })).toBeTruthy();
    await expect.poll(() => player.evaluate(node => (node as HTMLVideoElement).ended)).toBeTruthy();

    const downloadPromise = page.waitForEvent("download");
    await modal.getByRole("link", { name: "Download MP4", exact: true }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    const exportedFile = testInfo.outputPath("edited-export.mp4");
    await download.saveAs(exportedFile);
    expect((await stat(exportedFile)).size).toBeGreaterThan(10_000);
    const probe = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", exportedFile], { timeout: 30_000 });
    const metadata = JSON.parse(probe.stdout);
    expect(Number(metadata.format.duration)).toBeCloseTo(expectedDuration / 1000, 1);
    expect(metadata.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 1280, height: 720 }),
      expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
    ]));
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-xerror", "-i", exportedFile, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { timeout: 30_000 });
    await testInfo.attach("export-metadata", { body: probe.stdout, contentType: "application/json" });
  });
});

test("mobile layout imports and plays real media without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const endpoint = `/api/editor/projects/${project.id}`;
  project = await edit(page, `${endpoint}/upload`, () => page.getByLabel("Import media files").setInputFiles(mediaFile));
  project = await edit(page, `${endpoint}/commands`, () => page.getByRole("button", { name: `Add ${filename} to timeline`, exact: true }).click());
  await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth), `No page overflow at ${width}px`).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Play preview", exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = page.getByRole("region", { name: "Video preview", exact: true });
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Play preview", exact: true }).click();
  const video = preview.locator("video");
  await expect.poll(() => video.evaluate(node => {
    const media = node as HTMLVideoElement;
    return !media.paused && media.currentTime > 0.5 && media.getVideoPlaybackQuality().totalVideoFrames > 2;
  })).toBeTruthy();
  await page.getByRole("button", { name: "Pause preview", exact: true }).click();
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).paused)).toBeTruthy();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
