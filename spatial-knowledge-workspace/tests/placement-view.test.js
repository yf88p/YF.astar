import test from "node:test";
import assert from "node:assert/strict";
import {
  change,
  editBlock,
  exportPackage,
  validateWorkspace,
} from "../src/core.js";
import { createSeed } from "../src/seed.js";

test("canonical edits preserve independent, persistent reading positions", () => {
  const workspace = change(createSeed(), (next) => {
    next.boards[0].placements.find((p) => p.id === "big-case").view = {
      scrollTop: 120,
    };
    next.boards[2].placements.find((p) => p.id === "begin-brief").view = {
      scrollTop: 370,
    };
  });
  const updated = editBlock(workspace, "doc-brief", "doc-brief-b2", {
    text: "A new invitation to stay.",
  });
  const reloaded = validateWorkspace(JSON.parse(exportPackage(updated)));
  assert.equal(
    reloaded.boards[0].placements.find((p) => p.id === "big-case").view
      .scrollTop,
    120,
  );
  assert.equal(
    reloaded.boards[2].placements.find((p) => p.id === "begin-brief").view
      .scrollTop,
    370,
  );
  assert.equal(
    reloaded.documents.find((d) => d.id === "doc-brief").blocks[1].text,
    "A new invitation to stay.",
  );
});

test("nonfinite and out-of-bound placement view state fails recoverably", () => {
  const workspace = createSeed();
  for (const scrollTop of [NaN, Infinity, -1, 10_000_001, "100"]) {
    const invalid = change(workspace, (next) => {
      next.boards[0].placements[0].view = { scrollTop };
    });
    assert.throws(() => validateWorkspace(invalid));
  }
  assert.equal(workspace.boards[0].placements[0].view, undefined);
  assert.equal(validateWorkspace(workspace), workspace);
});
