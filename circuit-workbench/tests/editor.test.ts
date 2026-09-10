import assert from "node:assert/strict";
import test from "node:test";
import {
  addJunction,
  crossings,
  nextId,
  removeSelection,
  wirePoints,
} from "../src/editor";
import { defaultExample, examples } from "../src/examples";
import { parseEngineering, validateDocument } from "../src/model";
import { buildNetlist } from "../src/netlist";
import { solveDC, solveTransient } from "../src/solver";
import { endpointKey, junction, pin } from "../src/types";

test("explicit junction insertion splits both crossing routes, joins their actual nets, and is atomic", () => {
  const doc = defaultExample(),
    before = structuredClone(doc);
  assert(crossings(doc).some((p) => p.x === 460 && p.y === 400));
  const previous = buildNetlist(doc);
  assert.notEqual(
    previous.endpointNets[endpointKey(junction("JVIN"))],
    previous.ground,
  );
  const result = addJunction(doc, { x: 460, y: 400 });
  validateDocument(result.doc);
  assert.equal(result.doc.wires.length, doc.wires.length + 2);
  assert.equal(result.doc.junctions.length, doc.junctions.length + 1);
  const next = buildNetlist(result.doc);
  assert.equal(next.endpointNets[endpointKey(junction("JVIN"))], next.ground);
  assert.equal(next.endpointNets[endpointKey(result.anchor)], next.ground);
  assert.equal(
    result.doc.wires.filter(
      (w) =>
        endpointKey(w.a) === endpointKey(result.anchor) ||
        endpointKey(w.b) === endpointKey(result.anchor),
    ).length,
    4,
  );
  assert(!crossings(result.doc).some((p) => p.x === 460 && p.y === 400));
  assert.throws(
    () => solveDC(next),
    /voltage|constraint|source/i,
    "Joining VIN to ground must diagnose the shorted ideal source",
  );
  assert.deepEqual(doc, before, "Insertion must not mutate an undo snapshot");
  assert.deepEqual(
    addJunction(result.doc, { x: 460, y: 400 }).doc,
    result.doc,
    "Repeated junction click is idempotent",
  );
});

test("junction insertion preserves the full wire route, including the downstream bends", () => {
  const doc = defaultExample();
  const original = doc.wires.find((w) => w.id === "w6")!;
  const result = addJunction(doc, { x: 400, y: 400 });
  const incoming = result.doc.wires.find((w) => w.id === original.id)!;
  const outgoing = result.doc.wires.find(
    (w) =>
      w.id !== original.id && endpointKey(w.a) === endpointKey(result.anchor),
  )!;
  assert.deepEqual(wirePoints(result.doc, incoming), [
    ...wirePoints(doc, original).slice(0, -1),
    { x: 400, y: 400 },
  ]);
  assert.deepEqual(wirePoints(result.doc, outgoing), [
    { x: 400, y: 400 },
    { x: 620, y: 400 },
  ]);
  const net = buildNetlist(result.doc);
  assert.equal(
    solveDC(net).voltages[net.endpointNets[endpointKey(junction("JOUT"))]],
    5,
  );
});

test("deletion removes only dependent references and keeps the input available for undo", () => {
  const doc = defaultExample(),
    before = structuredClone(doc);
  const withoutPart = removeSelection(doc, "R1");
  validateDocument(withoutPart);
  assert(!withoutPart.components.some((c) => c.id === "R1"));
  assert(
    !withoutPart.probes.some(
      (p) => p.kind === "current" && p.componentId === "R1",
    ),
  );
  assert(
    !withoutPart.labels.some(
      (l) => l.anchor.kind === "pin" && l.anchor.componentId === "R1",
    ),
  );
  assert(withoutPart.probes.some((p) => p.id === "PVOUT"));
  const withoutJunction = removeSelection(doc, "JOUT");
  validateDocument(withoutJunction);
  assert(!withoutJunction.probes.some((p) => p.id === "PVOUT"));
  assert.equal(removeSelection(doc, "w1").wires.length, doc.wires.length - 1);
  assert.equal(
    removeSelection(doc, "PVOUT").probes.length,
    doc.probes.length - 1,
  );
  assert.deepEqual(doc, before);
  const id = nextId(doc, "R");
  assert.equal(id, "R3");
  doc.labels.push({
    id: "R3",
    name: "An ID in another collection",
    anchor: pin("R1", 0),
  });
  assert.equal(nextId(doc, "R"), "R4");
});

test("independent solver rejects invalid switch ordering and schedules even without document validation", () => {
  const original = examples.find((e) => e.id === "switched-rc")!.create();
  for (const change of [
    (s: (typeof original.components)[0]["switch"]) => {
      s.ron = s.roff;
    },
    (s: (typeof original.components)[0]["switch"]) => {
      s.toggles = [0.002, 0.001];
    },
    (s: (typeof original.components)[0]["switch"]) => {
      s.toggles = [0.001, 0.001];
    },
  ]) {
    const doc = structuredClone(original);
    change(doc.components.find((c) => c.id === "S1")!.switch);
    const net = buildNetlist(doc);
    assert.throws(() => solveDC(net), /S1.*switch/);
    assert.throws(() => solveTransient(net, doc.settings), /S1.*switch/);
  }
});

test("field-aware SI parsing rejects mismatched physical units and import rejects unsupported probe colors", () => {
  assert.equal(parseEngineering("4.7 kohm", "ohm"), 4700);
  assert.equal(parseEngineering("2 uF", "F"), 2e-6);
  assert.equal(parseEngineering("90deg", "deg"), 90);
  assert.equal(parseEngineering("1m", "s"), 0.001);
  for (const [value, unit] of [
    ["2F", "ohm"],
    ["5V", "A"],
    ["1s", "Hz"],
    ["2A", ""],
  ])
    assert.throws(() => parseEngineering(value, unit), /Expected/);
  const doc = defaultExample();
  doc.probes[0].color = "not-a-color";
  assert.throws(() => validateDocument(doc), /color/);
});
