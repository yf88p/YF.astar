import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCommand, assetSchema, buildProposal, clipEnd, createProject, duration,
  frameTime, fromFrame, makeClip, mergeIntervals, projectDuration, timecode,
  toFrame, tokenOccurrences, toSource, toTimeline, transact, undoRedo, validateProject,
  type Clip, type Operation, type Project, type ProjectHistory,
} from "../src/lib/timeline";

function project(): Project {
  const p = createProject("Timeline test");
  const words = [
    ["find", "Find ", 0, 1000], ["a", "a ", 1000, 1600],
    ["little", "little ", 2000, 2800], ["quiet", "quiet ", 3200, 4000],
    ["outside", "outside ", 7000, 8000], ["today", "today.", 10000, 11500],
  ] as const;
  const asset = assetSchema.parse({
    id: "source", name: "Scenery.mp4", kind: "video", duration: 12000,
    width: 1280, height: 720, hasAudio: true, bytes: 100, mime: "video/mp4",
    tokens: words.map(([id, text, start, end]) => ({ id, text, original: text, start, end })),
    transcription: "completed",
  });
  p.assets = [asset];
  p.clips = [{ ...makeClip(asset, "video"), id: "main" }];
  return validateProject(p);
}

function edit(p: Project, ...operations: Operation[]) {
  return applyCommand(p, { revision: p.revision, label: "Test edit", operations });
}

function clip(p: Project, id: string): Clip {
  const c = p.clips.find(c => c.id === id);
  assert.ok(c, `Missing clip ${id}`);
  return c;
}

test("new projects and clips have valid editable defaults", () => {
  const p = createProject();
  assert.equal(p.fixture, false);
  assert.equal(p.revision, 0);
  assert.deepEqual([p.width, p.height, p.fps], [1280, 720, 30]);
  assert.equal(projectDuration(p), 0);
  assert.deepEqual(p.tracks.map(t => t.kind), ["caption", "video", "audio"]);
  const title = makeClip(undefined, "titles", 2000);
  p.clips.push(title);
  assert.deepEqual(validateProject(p), p);
  assert.equal(title.speed, 1);
  assert.equal(title.volume, 1);
  assert.equal(duration(title), 4000);
  assert.equal(projectDuration(p), 6000);
});

test("frame conversion round-trips supported rates and snaps within half a frame", () => {
  for (const fps of [24, 25, 30, 60]) {
    for (const frame of [0, 1, 29, 30, 1001, 1080000]) {
      assert.equal(toFrame(fromFrame(frame, fps), fps), frame);
    }
    for (const ms of [0, 17, 999, 1234.56, 38000, 17999999]) {
      const snapped = frameTime(ms, fps);
      assert.ok(Math.abs(snapped - ms) <= 500 / fps + 1e-8);
      assert.equal(frameTime(snapped, fps), snapped);
    }
  }
  assert.equal(toFrame(1000, 30), 30);
  assert.equal(fromFrame(45, 30), 1500);
  assert.equal(timecode(-100), "00:00");
  assert.equal(timecode(61500, true, 30), "01:01:15");
});

test("source mapping accounts for trims, timeline offsets, and playback speed", () => {
  for (const speed of [0.25, 0.5, 1, 1.5, 2, 4]) {
    const c = { ...project().clips[0], start: 3000, sourceIn: 1250, sourceOut: 11250, speed };
    assert.equal(duration(c), 10000 / speed);
    assert.equal(toSource(c, c.start), c.sourceIn);
    assert.ok(Math.abs(toSource(c, clipEnd(c)) - c.sourceOut) < 1e-8);
    for (const source of [1250, 2000, 7500, 11250]) {
      assert.ok(Math.abs(toSource(c, toTimeline(c, source)) - source) < 1e-8);
    }
  }
});

test("split preserves source continuity at speed and resets invalidated fades without mutating input", () => {
  const p = project();
  Object.assign(p.clips[0], { start: 3000, sourceIn: 2000, sourceOut: 10000, speed: 2, volume: 0.4, fadeIn: 500, fadeOut: 500, groupId: "linked", transition: "fade" });
  p.clips[0].effects.x = 0.2;
  const before = structuredClone(p);
  const next = edit(p, { type: "split", clipId: "main", at: 4500, newId: "right" });
  const left = clip(next, "main"), right = clip(next, "right");
  assert.deepEqual([left.start, left.sourceIn, left.sourceOut], [3000, 2000, 5000]);
  assert.deepEqual([right.start, right.sourceIn, right.sourceOut], [4500, 5000, 10000]);
  assert.equal(clipEnd(left), right.start);
  assert.equal(clipEnd(right), clipEnd(p.clips[0]));
  assert.equal(duration(left) + duration(right), duration(p.clips[0]));
  for (const c of [left, right]) {
    assert.equal(c.speed, 2);
    assert.equal(c.volume, 0.4);
    assert.equal(c.groupId, "linked");
    assert.equal(c.transition, "fade");
    assert.deepEqual(c.effects, p.clips[0].effects);
    assert.deepEqual([c.fadeIn, c.fadeOut], [0, 0]);
  }
  right.effects.x = -0.2;
  assert.equal(left.effects.x, 0.2);
  assert.deepEqual(p, before);
});

test("trim and move change only selected clips and retain source-relative token positions", () => {
  const p = project();
  p.clips.push({ ...makeClip(p.assets[0], "video", 15000), id: "later" });
  const next = edit(p, { type: "update", ids: ["main"], patch: { start: 2000, sourceIn: 2000, sourceOut: 8000, speed: 0.5 } });
  assert.equal(duration(clip(next, "main")), 12000);
  assert.equal(clipEnd(clip(next, "main")), 14000);
  assert.deepEqual(clip(next, "later"), clip(p, "later"));
  const words = tokenOccurrences(next).filter(w => w.clipId === "main");
  assert.deepEqual(words.map(w => [w.token.id, w.start, w.end]), [
    ["little", 2000, 3600], ["quiet", 4400, 6000], ["outside", 12000, 14000],
  ]);
  assert.deepEqual(next.assets, p.assets);
});

test("non-ripple deletion leaves gaps and does not move other tracks", () => {
  const p = project();
  p.clips = [
    { ...p.clips[0], sourceOut: 4000 },
    { ...p.clips[0], id: "middle", start: 4000, sourceIn: 4000, sourceOut: 8000 },
    { ...p.clips[0], id: "last", start: 8000, sourceIn: 8000 },
    { ...makeClip(p.assets[0], "audio"), id: "bed" },
  ];
  const next = edit(p, { type: "delete", ids: ["middle"], ripple: false });
  assert.deepEqual(next.clips, p.clips.filter(c => c.id !== "middle"));
  assert.equal(projectDuration(next), 12000);
  assert.deepEqual(next.assets, p.assets);
});

test("ripple deletion slices every track at output times, including speed-adjusted audio and titles", () => {
  const p = project();
  p.clips = [
    { ...p.clips[0], sourceOut: 2000 },
    { ...p.clips[0], id: "cut", start: 2000, sourceIn: 2000, sourceOut: 4000 },
    { ...p.clips[0], id: "last", start: 4000, sourceIn: 4000 },
    { ...makeClip(p.assets[0], "audio"), id: "bed", speed: 0.5, sourceOut: 6000, fadeIn: 500, fadeOut: 500 },
    { ...makeClip(undefined, "titles", 1000), id: "title", sourceOut: 5000 },
  ];
  const next = edit(p, { type: "delete", ids: ["cut"], ripple: true });
  assert.equal(projectDuration(next), 10000);
  assert.deepEqual([clip(next, "last").start, clip(next, "last").sourceIn], [2000, 4000]);
  const bed = next.clips.filter(c => c.trackId === "audio").sort((a, b) => a.start - b.start);
  assert.deepEqual(bed.map(c => [c.start, c.sourceIn, c.sourceOut]), [[0, 0, 1000], [2000, 2000, 6000]]);
  assert.ok(bed.every(c => c.fadeIn === 0 && c.fadeOut === 0));
  const titles = next.clips.filter(c => c.trackId === "titles").sort((a, b) => a.start - b.start);
  assert.deepEqual(titles.map(c => [c.start, c.sourceIn, c.sourceOut]), [[1000, 0, 1000], [2000, 3000, 5000]]);
  assert.equal(new Set(next.clips.map(c => c.id)).size, next.clips.length);
  assert.deepEqual(next.assets, p.assets);
});

test("overlapping ripple selections are merged once and disjoint cuts apply right-to-left", () => {
  const p = project();
  p.clips.push(
    { ...makeClip(undefined, "titles", 2000), id: "first", sourceOut: 2000 },
    { ...makeClip(undefined, "titles", 3000), id: "overlap", sourceOut: 2000 },
    { ...makeClip(undefined, "titles", 8000), id: "second", sourceOut: 1000 },
  );
  const next = edit(p, { type: "delete", ids: ["first", "overlap", "second"], ripple: true });
  assert.equal(projectDuration(next), 8000);
  assert.deepEqual(next.clips.sort((a, b) => a.start - b.start).map(c => [c.start, c.sourceIn, c.sourceOut]), [
    [0, 0, 2000], [2000, 5000, 8000], [5000, 9000, 12000],
  ]);
  const intervals = [{ start: 8, end: 9 }, { start: 2, end: 4 }, { start: 3, end: 5 }, { start: 5, end: 6 }];
  const before = structuredClone(intervals);
  assert.deepEqual(mergeIntervals(intervals), [{ start: 2, end: 6 }, { start: 8, end: 9 }]);
  assert.deepEqual(intervals, before);
  assert.deepEqual(mergeIntervals([]), []);
});

test("source-range deletion removes every occurrence at its playback speed and records provenance", () => {
  const p = project();
  Object.assign(p.clips[0], { sourceOut: 6000, speed: 2 });
  p.clips.push({ ...makeClip(p.assets[0], "video", 3000), id: "repeat", sourceOut: 6000 });
  p.clips.push({ ...makeClip(undefined, "titles"), id: "title", sourceOut: 9000 });
  const ranges = [{ assetId: "source", start: 2000, end: 2800, tokenIds: ["little"] }];
  const next = edit(p, { type: "removeRanges", ranges });
  assert.equal(projectDuration(next), 7800);
  assert.equal(tokenOccurrences(next).some(w => w.token.id === "little"), false);
  const videos = next.clips.filter(c => c.trackId === "video").sort((a, b) => a.start - b.start);
  assert.deepEqual(videos.map(c => [c.start, c.sourceIn, c.sourceOut, c.speed]), [
    [0, 0, 2000, 2], [1000, 2800, 6000, 2], [2600, 0, 2000, 1], [4600, 2800, 6000, 1],
  ]);
  assert.deepEqual(next.editLog[0].ranges, ranges);
  assert.deepEqual(next.assets, p.assets, "source words are retained even when all their occurrences are removed");
});

test("token occurrences clip partial words, omit boundary-only intersections, and sort repeated uses", () => {
  const p = project();
  Object.assign(p.clips[0], { start: 5000, sourceIn: 500, sourceOut: 2500, speed: 2 });
  p.clips.push({ ...makeClip(p.assets[0], "video"), id: "repeat", sourceIn: 1000, sourceOut: 2000 });
  const next = tokenOccurrences(p, "source");
  assert.deepEqual(next.map(w => [w.clipId, w.token.id, w.start, w.end]), [
    ["repeat", "a", 0, 600], ["main", "find", 5000, 5250],
    ["main", "a", 5250, 5550], ["main", "little", 5750, 6000],
  ]);
  assert.equal(next[1].token.start, 0, "original source timing is not clipped");
  assert.deepEqual(tokenOccurrences(p, "missing"), []);
});

test("transition, fades, audio levels and transforms form one reversible edit without changing duration", () => {
  const p = project();
  const h = transact({ project: p, undo: [], redo: [] }, { revision: 0, label: "Finish clip", operations: [
    { type: "update", ids: ["main"], patch: { transition: "fade", fadeIn: 300, fadeOut: 700, volume: 0.6, effects: { ...p.clips[0].effects, scale: 1.1, x: 0.1, saturation: 0.8 } } },
    { type: "track", trackId: "audio", patch: { muted: true, solo: false } },
  ] });
  assert.equal(projectDuration(h.project), projectDuration(p));
  assert.equal(clip(h.project, "main").transition, "fade");
  assert.equal(clip(h.project, "main").effects.scale, 1.1);
  assert.equal(h.project.tracks.find(t => t.id === "audio")?.muted, true);
  assert.equal(h.undo.length, 1);
  const undone = undoRedo(h, "undo", 1);
  assert.deepEqual(undone.project.clips, p.clips);
  assert.deepEqual(undone.project.tracks, p.tracks);
  const redone = undoRedo(undone, "redo", 2);
  assert.deepEqual(redone.project.clips, h.project.clips);
  assert.deepEqual(redone.project.tracks, h.project.tracks);
});

test("group assignment and multi-clip edits commit atomically and ungroup explicitly", () => {
  const p = project();
  p.clips.push({ ...makeClip(p.assets[0], "audio"), id: "bed" });
  const next = edit(p,
    { type: "group", ids: ["main", "bed"], groupId: "linked" },
    { type: "update", ids: ["main", "bed"], patch: { start: 2000 } },
  );
  assert.ok(next.clips.every(c => c.groupId === "linked" && c.start === 2000));
  assert.equal(next.revision, 1);
  assert.equal(next.editLog.length, 1);
  const ungrouped = edit(next, { type: "group", ids: ["main", "bed"] });
  assert.ok(ungrouped.clips.every(c => c.groupId === undefined));
  assert.ok(next.clips.every(c => c.groupId === "linked"));
});

test("a late invalid operation cannot partially mutate a project or its history", () => {
  const p = project();
  const h: ProjectHistory = { project: p, undo: [], redo: [] };
  const before = structuredClone(h);
  assert.throws(() => transact(h, { revision: 0, label: "Atomic failure", operations: [
    { type: "rename", name: "Must not persist" },
    { type: "correctToken", assetId: "source", tokenId: "quiet", text: "calm " },
    { type: "update", ids: ["main"], patch: { sourceOut: 13000 } },
  ] }), /Invalid source range/);
  assert.deepEqual(h, before);
});

test("undo and redo use monotonic revisions and a new edit clears the redo branch", () => {
  const p = project();
  const h = transact({ project: p, undo: [], redo: [] }, { revision: 0, label: "Split and rename", operations: [
    { type: "split", clipId: "main", at: 4000, newId: "right" }, { type: "rename", name: "New name" },
  ] });
  assert.equal(h.project.revision, 1);
  assert.equal(h.undo.length, 1);
  const undone = undoRedo(h, "undo", 1);
  assert.equal(undone.project.revision, 2);
  assert.deepEqual(undone.project.clips, p.clips);
  assert.equal(undone.project.name, p.name);
  assert.equal(undone.redo.length, 1);
  const redone = undoRedo(undone, "redo", 2);
  assert.equal(redone.project.revision, 3);
  assert.deepEqual(redone.project.clips, h.project.clips);
  assert.equal(redone.project.name, "New name");
  const branch = transact(undone, { revision: 2, label: "Branch", operations: [{ type: "rename", name: "Alternative" }] });
  assert.equal(branch.redo.length, 0);
  assert.throws(() => undoRedo(branch, "redo", 3), /Nothing to redo/);
  assert.equal(h.project.clips.length, 2);
});

test("undo retains newly imported media and completed transcription while reverting word corrections", () => {
  const p = project();
  p.assets[0].tokens[3].raw = { provider: "original payload" };
  const h = transact({ project: p, undo: [], redo: [] }, { revision: 0, label: "Correct word", operations: [
    { type: "correctToken", assetId: "source", tokenId: "quiet", text: "calm " },
  ] });
  const added = assetSchema.parse({ id: "imported", name: "Later.wav", kind: "audio", duration: 2000, hasAudio: true, bytes: 100, mime: "audio/wav" });
  h.project.assets.push(added);
  h.project.assets[0].tokens.push({ id: "late", text: "End", original: "End", start: 11600, end: 12000 });
  h.project.assets[0].waveform = [0.2, 0.8];
  const undone = undoRedo(h, "undo", 1);
  assert.ok(undone.project.assets.some(a => a.id === "imported"));
  assert.equal(undone.project.assets[0].tokens.at(-1)?.id, "late");
  assert.deepEqual(undone.project.assets[0].waveform, [0.2, 0.8]);
  assert.equal(undone.project.assets[0].transcription, "completed");
  const word = undone.project.assets[0].tokens[3];
  assert.equal(word.text, "quiet ");
  assert.equal(word.original, "quiet ");
  assert.deepEqual(word.raw, { provider: "original payload" });
  const redone = undoRedo(undone, "redo", 2);
  assert.equal(redone.project.assets[0].tokens[3].text, "calm ");
  assert.equal(redone.project.assets[0].tokens[3].corrected, true);
  assert.equal(redone.project.assets[0].tokens[3].original, "quiet ");
  const restored = edit(redone.project, { type: "correctToken", assetId: "source", tokenId: "quiet", text: "quiet " });
  assert.equal(restored.assets[0].tokens[3].corrected, false);
});

test("history is bounded to fifty undo steps", () => {
  let h: ProjectHistory = { project: project(), undo: [], redo: [] };
  for (let i = 0; i < 55; i++) {
    h = transact(h, { revision: h.project.revision, label: "Rename", operations: [{ type: "rename", name: `Version ${i}` }] });
  }
  assert.equal(h.undo.length, 50);
  assert.equal(h.undo[0].revision, 5);
  for (let i = 0; i < 50; i++) h = undoRedo(h, "undo", h.project.revision);
  assert.equal(h.project.name, "Version 4");
  assert.equal(h.project.revision, 105);
  assert.throws(() => undoRedo(h, "undo", 105), /Nothing to undo/);
});

test("captions follow edited occurrences, preserve opening titles, and replace rather than duplicate generated captions", () => {
  const p = project();
  Object.assign(p.clips[0], { start: 2000, sourceIn: 1000, sourceOut: 4000, speed: 2 });
  p.clips.push({ ...makeClip(undefined, "titles"), id: "opening", name: "Opening title", text: "Stay curious" });
  const corrected = edit(p, { type: "correctToken", assetId: "source", tokenId: "quiet", text: "calm " });
  const next = edit(corrected, { type: "captions", assetId: "source" });
  const captions = next.clips.filter(c => c.name.startsWith("Caption"));
  assert.equal(captions.length, 1);
  assert.equal(captions[0].text, "a little calm");
  assert.deepEqual([captions[0].start, clipEnd(captions[0])], [2000, 3500]);
  assert.deepEqual(clip(next, "opening"), clip(p, "opening"));
  const again = edit(next, { type: "captions", assetId: "source" });
  assert.equal(again.clips.filter(c => c.name.startsWith("Caption")).length, 1);
  assert.deepEqual(again.assets, corrected.assets);
});

test("proposal preview validates edits without applying them and becomes stale after a timeline change", () => {
  const p = project(), before = structuredClone(p);
  const operations: Operation[] = [{ type: "update", ids: ["main"], patch: { sourceOut: 8000 } }];
  const proposal = buildProposal(p, "Shorten", "Keep the opening", operations, [], ["Review the cut"]);
  assert.deepEqual(p, before);
  assert.equal(proposal.revision, 0);
  assert.deepEqual([proposal.durationBefore, proposal.durationAfter], [12000, 8000]);
  assert.deepEqual(proposal.warnings, ["Review the cut"]);
  const next = edit(p, { type: "rename", name: "Changed" });
  assert.throws(() => applyCommand(next, { revision: proposal.revision, label: proposal.title, operations: proposal.operations }), /Stale revision/);
});

test("stale commands, stale history actions, empty commands and unknown command fields are rejected", () => {
  const p = project();
  const command = { revision: 0, label: "Rename", operations: [{ type: "rename", name: "New" }] };
  assert.throws(() => applyCommand(p, { ...command, revision: 1 }), /Stale revision/);
  assert.throws(() => undoRedo({ project: p, undo: [p], redo: [] }, "undo", 1), /Stale revision/);
  for (const input of [
    { ...command, revision: -1 }, { ...command, revision: 0.5 }, { ...command, label: "" },
    { ...command, operations: [] }, { ...command, extra: true },
    { ...command, operations: [{ type: "rename", name: "New", extra: true }] },
    { ...command, operations: [{ type: "execute", command: "anything" }] },
  ]) assert.throws(() => applyCommand(p, input));
  assert.equal(p.revision, 0);
  assert.equal(p.editLog.length, 0);
});

test("invalid edits reject missing IDs, source bounds, incompatible tracks and non-finite timing atomically", () => {
  const p = project(), before = structuredClone(p);
  const operations: Operation[] = [
    { type: "update", ids: ["missing"], patch: { start: 1 } },
    { type: "delete", ids: ["missing"], ripple: true },
    { type: "group", ids: ["main", "missing"], groupId: "linked" },
    { type: "update", ids: ["main"], patch: { sourceIn: 12000 } },
    { type: "update", ids: ["main"], patch: { sourceOut: 12001 } },
    { type: "update", ids: ["main"], patch: { sourceIn: -1 } },
    { type: "update", ids: ["main"], patch: { speed: 0 } },
    { type: "update", ids: ["main"], patch: { volume: 3 } },
    { type: "update", ids: ["main"], patch: { start: NaN } },
    { type: "update", ids: ["main"], patch: { sourceOut: Infinity } },
    { type: "update", ids: ["main"], patch: { fadeIn: 7000, fadeOut: 6000 } },
    { type: "update", ids: ["main"], patch: { trackId: "titles" } },
    { type: "update", ids: ["main"], patch: { trackId: "missing" } },
    { type: "update", ids: ["main"], patch: { start: 18000000 } },
    { type: "track", trackId: "missing", patch: { muted: true } },
    { type: "addTrack", track: p.tracks[0] },
    { type: "add", clips: [p.clips[0]] },
    { type: "correctToken", assetId: "source", tokenId: "missing", text: "No" },
    { type: "captions", assetId: "missing" },
  ];
  for (const op of operations) {
    assert.throws(() => edit(p, { type: "rename", name: "Not committed" }, op), JSON.stringify(op));
    assert.deepEqual(p, before);
  }
  for (const at of [0, 1, 11999, 12000, 13000]) {
    assert.throws(() => edit(p, { type: "split", clipId: "main", at, newId: "right" }), /inside the clip/);
  }
  assert.throws(() => edit(p, { type: "split", clipId: "main", at: 2000, newId: "main" }), /Duplicate ID/);
});

test("transcript cuts reject invalid ranges and ranges no longer present on the timeline", () => {
  const p = project(), before = structuredClone(p);
  for (const range of [
    { assetId: "missing", start: 0, end: 1000 }, { assetId: "source", start: 1000, end: 1000 },
    { assetId: "source", start: 2000, end: 1000 }, { assetId: "source", start: 0, end: 12001 },
    { assetId: "source", start: 0, end: 1000, tokenIds: ["missing"] },
  ]) assert.throws(() => edit(p, { type: "removeRanges", ranges: [range] }), /Invalid transcript source range/);
  const trimmed = edit(p, { type: "update", ids: ["main"], patch: { sourceOut: 2000 } });
  assert.throws(() => edit(trimmed, { type: "removeRanges", ranges: [{ assetId: "source", start: 7000, end: 8000 }] }), /no longer on the timeline/);
  assert.deepEqual(p, before);
});

test("project validation rejects corrupt references, duplicate identities, and invalid transcript timing", () => {
  const corruptions: ((p: Project) => void)[] = [
    p => { p.assets.push(structuredClone(p.assets[0])); },
    p => { p.tracks.push(structuredClone(p.tracks[0])); },
    p => { p.clips.push(structuredClone(p.clips[0])); },
    p => { p.clips[0].assetId = "missing"; },
    p => { p.assets[0].tokens[0].end = 13001; },
    p => { p.assets[0].tokens[0].start = 2000; },
    p => { p.clips[0].trackId = "audio"; p.assets[0].hasAudio = false; },
    p => { p.clips = [{ ...makeClip(undefined, "video"), id: "text" }]; },
    p => { p.clips = [{ ...makeClip(undefined, "titles"), id: "text", text: "" }]; },
  ];
  for (const corrupt of corruptions) {
    const p = project();
    corrupt(p);
    assert.throws(() => validateProject(p));
  }
});
