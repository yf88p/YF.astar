import test from "node:test";
import assert from "node:assert/strict";
import { DocumentHistory, Editor } from "../src/editor.js";
import { cloneDocument, validateDocument, World } from "../src/core.js";
import { LEVELS, createBlankLevel } from "../src/levels.js";

const valid = (doc) =>
  assert.deepEqual(validateDocument(doc), { valid: true, errors: [] });
const snapshot = (history) =>
  JSON.stringify({
    doc: history.doc,
    undo: history.undoStack,
    redo: history.redoStack,
  });
const blockLevel = () => {
  const doc = createBlankLevel();
  doc.blocks.push({
    id: "block-1",
    room: doc.rooms[0].id,
    position: [2, 0.5, 0],
    size: [1, 1, 1],
  });
  return doc;
};

test("history is deeply isolated from its input and retained mutator drafts", () => {
  const source = createBlankLevel(),
    history = new DocumentHistory(source);
  source.name = "Outside mutation";
  assert.notEqual(history.doc.name, source.name);
  let draft;
  assert.equal(
    history.transaction((doc) => {
      draft = doc;
      doc.name = "A new experiment";
    }, "Rename").valid,
    true,
  );
  draft.rooms[0].center[0] = 100;
  assert.equal(history.doc.rooms[0].center[0], 0);
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undoStack[0].label, "Rename");
  assert.equal(history.undo().valid, true);
  assert.equal(history.doc.name, "Untitled Observatory");
  assert.equal(history.redo().valid, true);
  assert.equal(history.doc.name, "A new experiment");
  valid(history.doc);
});

test("no-op transactions preserve history and branching clears only redo", () => {
  const history = new DocumentHistory(createBlankLevel());
  assert.equal(history.undo().changed, false);
  assert.equal(history.redo().changed, false);
  history.transaction((doc) => {
    doc.name = "One";
  });
  history.transaction((doc) => {
    doc.name = "Two";
  });
  history.undo();
  assert.equal(history.transaction(() => {}).changed, false);
  assert.equal(history.redoStack.length, 1);
  history.transaction((doc) => {
    doc.name = "Branch";
  });
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.undoStack.length, 2);
});

test("invalid transactions and thrown mutators preserve document and both stacks", () => {
  const history = new DocumentHistory(LEVELS[0]);
  history.transaction((doc) => {
    doc.name = "Temporary";
  });
  history.undo();
  const before = snapshot(history);
  const edits = [
    (doc) => {
      doc.portals[0].linkedTo = "missing";
    },
    (doc) => {
      doc.plates[0].doorIds = ["missing"];
    },
    (doc) => {
      doc.goals[0].requires = ["missing"];
    },
    (doc) => {
      doc.spawn.position[0] = Infinity;
    },
    (doc) => {
      doc.rooms[0].size[0] = NaN;
    },
    (doc) => {
      doc.version = 2;
    },
    (doc) => {
      doc.rooms = [];
    },
    (doc) => {
      doc.name = "Incomplete";
      throw new Error("Mutator failed");
    },
    (doc) => {
      doc.extra = () => {};
      doc.name = "Uncloneable";
    },
  ];
  for (const edit of edits) {
    const result = history.transaction(edit, "Rejected");
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
    assert.equal(snapshot(history), before);
  }
});

test("deleting either portal removes the linked pair in one undoable operation", () => {
  for (const portal of LEVELS[0].portals) {
    const history = new DocumentHistory(LEVELS[0]),
      original = cloneDocument(history.doc);
    assert.equal(history.deleteEntity(portal.id).valid, true);
    assert.equal(history.doc.portals.length, 0);
    assert.equal(history.undoStack.length, 1);
    valid(history.doc);
    history.undo();
    assert.deepEqual(history.doc, original);
    history.redo();
    assert.equal(history.doc.portals.length, 0);
  }
});

test("deleting a door repairs plate links and goal requirements, with exact undo/redo", () => {
  const history = new DocumentHistory(LEVELS[0]),
    original = cloneDocument(history.doc);
  assert.equal(history.deleteEntity("delivery-door").valid, true);
  assert.deepEqual(history.doc.plates[0].doorIds, []);
  assert.deepEqual(history.doc.goals[0].requires, []);
  assert.equal(history.doc.doors.length, 0);
  valid(history.doc);
  const deleted = cloneDocument(history.doc);
  history.undo();
  assert.deepEqual(history.doc, original);
  history.redo();
  assert.deepEqual(history.doc, deleted);
});

test("room deletion cascades remote portal partners and cross-room references atomically", () => {
  const doc = cloneDocument(LEVELS[2]);
  doc.goals.push({
    id: "remote-goal",
    room: "loop-origin",
    position: [-3, 0.9, 0],
    size: [1, 1.8, 1],
    requires: ["vault-door"],
  });
  const history = new DocumentHistory(doc);
  assert.equal(history.deleteEntity("loop-vault").valid, true);
  assert.equal(history.doc.rooms.length, 2);
  assert.equal(history.doc.portals.length, 2);
  assert.equal(history.doc.blocks.length, 0);
  assert.equal(history.doc.doors.length, 0);
  assert.deepEqual(history.doc.plates[0].doorIds, []);
  assert.deepEqual(history.doc.goals[0].requires, []);
  assert.equal(history.undoStack.length, 1);
  valid(history.doc);
  history.undo();
  assert.deepEqual(history.doc, doc);
  history.redo();
  valid(history.doc);
});

test("deleting the start room finds a safe replacement start; the last room cannot be deleted", () => {
  const history = new DocumentHistory(LEVELS[0]);
  assert.equal(history.deleteEntity("atrium").valid, true);
  assert.equal(history.doc.spawn.room, "annex");
  assert.equal(history.doc.cubes.length, 0);
  assert.equal(history.doc.portals.length, 0);
  valid(history.doc);
  const before = snapshot(history);
  assert.equal(history.deleteEntity("annex").valid, false);
  assert.equal(history.deleteEntity("player").valid, false);
  assert.equal(history.deleteEntity("does-not-exist").valid, false);
  assert.equal(snapshot(history), before);
  history.undo();
  assert.deepEqual(history.doc, LEVELS[0]);
});

test("room deletion with nowhere for the player to fit is rejected without partial cascade", () => {
  const doc = createBlankLevel();
  doc.rooms.push({
    id: "blocked-room",
    name: "Blocked",
    center: [20, 1, 0],
    size: [2, 2, 2],
    color: "#183b43",
  });
  doc.blocks.push({
    id: "solid",
    room: "blocked-room",
    position: [20, 1, 0],
    size: [2, 2, 2],
  });
  const history = new DocumentHistory(doc),
    before = snapshot(history);
  assert.equal(history.deleteEntity("blank-room").valid, false);
  assert.equal(snapshot(history), before);
});

test("deleting plates, cubes, blocks, and goals leaves a valid document", () => {
  for (const id of [
    "delivery-plate",
    "delivery-cube",
    "atrium-bench",
    "delivery-goal",
  ]) {
    const history = new DocumentHistory(LEVELS[0]);
    assert.equal(history.deleteEntity(id).valid, true);
    valid(history.doc);
    history.undo();
    assert.deepEqual(history.doc, LEVELS[0]);
  }
});

test("replace validates before resetting history and clones the replacement", () => {
  const history = new DocumentHistory(LEVELS[0]);
  history.transaction((doc) => {
    doc.name = "Edited";
  });
  const before = snapshot(history);
  assert.equal(history.replace({ version: 99 }).valid, false);
  assert.equal(snapshot(history), before);
  const next = createBlankLevel();
  assert.equal(history.replace(next).valid, true);
  next.rooms[0].name = "External edit";
  assert.notEqual(history.doc.rooms[0].name, next.rooms[0].name);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
  assert.throws(() => new DocumentHistory({ version: 99 }));
});

test("JSON import rejects malformed, oversized, nonfinite, versioned, and dangling data without changes", () => {
  const history = new DocumentHistory(LEVELS[0]);
  history.transaction((doc) => {
    doc.name = "Edited";
  });
  history.undo();
  const before = snapshot(history);
  const badVersion = cloneDocument(LEVELS[0]);
  badVersion.version = 42;
  const dangling = cloneDocument(LEVELS[0]);
  dangling.portals[0].linkedTo = "missing";
  const door = cloneDocument(LEVELS[0]);
  door.goals[0].requires = ["missing"];
  for (const text of [
    "{",
    "null",
    "[]",
    " ".repeat(2 * 1024 * 1024 + 1),
    '"' + "\u00e9".repeat(1024 * 1024) + '"',
    JSON.stringify(badVersion),
    JSON.stringify(dangling),
    JSON.stringify(door),
    history.exportJSON().replace("9.81", "1e999"),
    history
      .exportJSON()
      .replace('"version": 1', '"extra": 1e999, "version": 1'),
  ]) {
    const result = history.importJSON(text);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
    assert.equal(snapshot(history), before);
  }
  assert.equal(history.importJSON(null).valid, false);
  assert.equal(
    history.importJSON(JSON.stringify(createBlankLevel())).valid,
    true,
  );
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
  assert.deepEqual(JSON.parse(history.exportJSON()), createBlankLevel());
});

test("multiple valid drag samples make exactly one undo record", () => {
  const history = new DocumentHistory(blockLevel()),
    before = cloneDocument(history.doc);
  assert.equal(history.beginDrag("block-1").valid, true);
  for (const x of [2.25, 2.5, 2.75, 3]) {
    assert.equal(history.updateDrag([x, 0.5, 0]).valid, true);
    valid(history.doc);
    assert.equal(history.undoStack.length, 0);
  }
  assert.equal(history.endDrag().changed, true);
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undoStack[0].label, "Move selection");
  const after = cloneDocument(history.doc);
  history.undo();
  assert.deepEqual(history.doc, before);
  history.redo();
  assert.deepEqual(history.doc, after);
});

test("invalid final drag restores its start and preserves existing undo and redo", () => {
  const history = new DocumentHistory(blockLevel());
  history.transaction((doc) => {
    doc.name = "Temporary";
  });
  history.undo();
  const before = snapshot(history);
  history.beginDrag("block-1");
  history.updateDrag([3, 0.5, 0]);
  assert.equal(history.updateDrag([100, 0.5, 0]).valid, false);
  assert.equal(history.endDrag().valid, false);
  assert.equal(snapshot(history), before);
  history.beginDrag("block-1");
  assert.equal(history.updateDrag([NaN, 0.5, 0]).valid, false);
  assert.equal(history.endDrag().valid, false);
  assert.equal(snapshot(history), before);
  assert.equal(history.updateDrag([2, 0.5, 0]).valid, false);
  assert.equal(history.beginDrag("missing").valid, false);
});

test("a drag can recover from an invalid sample or return to its start without a history entry", () => {
  const history = new DocumentHistory(blockLevel());
  history.beginDrag("block-1");
  history.updateDrag([100, 0.5, 0]);
  history.updateDrag([3, 0.5, 0]);
  assert.equal(history.endDrag().valid, true);
  assert.equal(history.undoStack.length, 1);
  history.beginDrag("block-1");
  history.updateDrag([4, 0.5, 0]);
  history.updateDrag([3, 0.5, 0]);
  assert.equal(history.endDrag().changed, false);
  assert.equal(history.undoStack.length, 1);
});

test("dragging a room translates its contents and boundary portals, but not its partners", () => {
  const history = new DocumentHistory(LEVELS[0]),
    before = cloneDocument(history.doc);
  history.beginDrag("atrium");
  assert.equal(history.updateDrag([-3, 2.5, 0]).valid, true);
  assert.equal(history.endDrag().valid, true);
  assert.equal(history.doc.spawn.position[0], before.spawn.position[0] - 3);
  assert.equal(
    history.doc.cubes[0].position[0],
    before.cubes[0].position[0] - 3,
  );
  assert.equal(
    history.doc.portals[0].position[0],
    before.portals[0].position[0] - 3,
  );
  assert.deepEqual(history.doc.portals[1], before.portals[1]);
  valid(history.doc);
  history.undo();
  assert.deepEqual(history.doc, before);
  history.beginDrag("atrium");
  assert.equal(history.updateDrag([22, 2.5, 0]).valid, false);
  history.endDrag();
  assert.deepEqual(history.doc, before);
});

test("editor runs without DOM, emits validated changes, and uses metadata-only selection", () => {
  const changes = [],
    notices = [];
  const editor = new Editor({
    container: null,
    doc: blockLevel(),
    onChange: (doc, meta) => {
      valid(doc);
      changes.push({ doc: cloneDocument(doc), meta });
    },
    notify: (message) => notices.push(message),
  });
  assert.equal(editor.overlays, true);
  assert.equal(editor.selectedId, "player");
  assert.equal(editor.select("block-1"), true);
  assert.equal(changes.at(-1).meta.editorOnly, true);
  assert.equal(changes.at(-1).meta.selectedRoom, "blank-room");
  const count = changes.length;
  assert.equal(
    editor.transaction((doc) => {
      doc.version = 3;
    }).valid,
    false,
  );
  assert.equal(changes.length, count);
  assert.equal(notices.length, 1);
  editor.beginDrag("block-1");
  editor.updateDrag([2.37, 0.5, 0]);
  assert.deepEqual(editor.doc.blocks[0].position, [2.25, 0.5, 0]);
  editor.updateDrag([2.64, 0.5, 0]);
  editor.endDrag();
  assert.equal(editor.undoStack.length, 1);
  assert.equal(changes.at(-1).meta.dragging, false);
  assert.equal(changes.at(-1).meta.editorOnly, true);
  editor.undo();
  assert.deepEqual(editor.doc.blocks[0].position, [2, 0.5, 0]);
  editor.redo();
  assert.deepEqual(editor.doc.blocks[0].position, [2.75, 0.5, 0]);
  editor.dispose();
});

test("invalid imports preserve editor selection, document, and history; valid loads reset them", () => {
  const changes = [];
  const editor = new Editor({
    container: null,
    doc: LEVELS[0],
    onChange: (_, meta) => changes.push(meta),
  });
  editor.select("delivery-cube");
  editor.transaction((doc) => {
    doc.name = "My copy";
  });
  const before = snapshot(editor),
    count = changes.length;
  assert.equal(editor.importJSON("{").valid, false);
  assert.equal(snapshot(editor), before);
  assert.equal(editor.selectedId, "delivery-cube");
  assert.equal(changes.length, count);
  assert.equal(editor.setDocument(createBlankLevel()).valid, true);
  assert.equal(editor.undoStack.length, 0);
  assert.equal(editor.selectedId, "player");
  assert.equal(editor.selectedRoom, "blank-room");
  editor.dispose();
});

test("invalid drag previews emit only a validated restoration and leave no history record", () => {
  const emitted = [];
  const editor = new Editor({
    container: null,
    doc: blockLevel(),
    onChange: (doc, meta) => {
      valid(doc);
      emitted.push({ doc: cloneDocument(doc), meta });
    },
  });
  editor.beginDrag("block-1");
  editor.updateDrag([3, 0.5, 0]);
  assert.equal(editor.updateDrag([100, 0.5, 0]).valid, false);
  assert.deepEqual(emitted.at(-1).doc.blocks[0].position, [2, 0.5, 0]);
  assert.equal(editor.endDrag().valid, false);
  assert.equal(editor.undoStack.length, 0);
  assert.equal(emitted.at(-1).meta.editorOnly, true);
  editor.dispose();
});

test("player is the unambiguous start selection even when an imported entity is named spawn", () => {
  const doc = blockLevel();
  doc.blocks[0].id = "spawn";
  const editor = new Editor({ container: null, doc });
  editor.select("spawn");
  assert.equal(editor.selectedId, "spawn");
  editor.beginDrag("player");
  assert.equal(editor.updateDrag([1, 0.9, 4.7]).valid, true);
  editor.endDrag();
  assert.deepEqual(editor.doc.blocks[0].position, [2, 0.5, 0]);
  assert.deepEqual(editor.doc.spawn.position, [1, 0.9, 4.7]);
  editor.dispose();
});

test("default creation probes clear floor positions for each object and does not mutate supplied levels", () => {
  for (const source of [createBlankLevel(), ...LEVELS]) {
    const original = cloneDocument(source),
      editor = new Editor({ container: null, doc: source });
    for (const type of ["block", "cube", "plate", "door", "goal", "room"]) {
      assert.equal(editor._create(type).valid, true, `${source.name}: ${type}`);
      valid(editor.doc);
    }
    assert.equal(editor._create("spawn").valid, true);
    assert.equal(editor.doc.spawn.room, editor.doc.rooms.at(-1).id);
    valid(editor.doc);
    assert.deepEqual(source, original);
    editor.dispose();
  }
});

test("editor playtest callback receives the authored document; World stays isolated", () => {
  let world;
  const editor = new Editor({
    container: null,
    doc: LEVELS[0],
    onPlaytest: (doc) => {
      world = new World(doc);
    },
  });
  const before = editor.exportJSON();
  editor._action("playtest");
  world.doc.name = "Runtime only";
  world.step();
  assert.equal(editor.exportJSON(), before);
  editor.dispose();
});

test("disposing an active drag restores the authoring snapshot and suppresses later notifications", () => {
  const events = [];
  const editor = new Editor({
    container: null,
    doc: blockLevel(),
    onChange: (_, meta) => events.push(meta),
  });
  editor.beginDrag("block-1");
  editor.updateDrag([3, 0.5, 0]);
  editor.dispose();
  assert.deepEqual(editor.doc.blocks[0].position, [2, 0.5, 0]);
  assert.equal(editor.undoStack.length, 0);
  const count = events.length;
  editor.select("block-1");
  assert.equal(events.length, count);
});
