import assert from "node:assert/strict";
import test from "node:test";
import {
  componentPins,
  createComponent,
  emptyDocument,
  endpointPosition,
  formatEngineering,
  parseEngineering,
  validateDocument,
} from "../src/model";
import { defaultExample, examples } from "../src/examples";
import { buildNetlist } from "../src/netlist";
import { solveDC, solveTransient, waveformValue } from "../src/solver";
import { endpointKey, junction, pin } from "../src/types";
import type {
  CircuitDocument,
  ComponentType,
  Endpoint,
  Netlist,
  Solution,
} from "../src/types";

const DC_VOLTAGE_ATOL = 1e-8;
const DC_CURRENT_ATOL = 1e-10;
const NONLINEAR_CURRENT_ATOL = 1e-10;
const NONLINEAR_CURRENT_RTOL = 1e-6;
const THERMAL_VOLTAGE = (1.380649e-23 * 300) / 1.602176634e-19;

function close(
  actual: number,
  expected: number,
  tolerance: number,
  context: string,
): void {
  assert.ok(Number.isFinite(actual), `${context}: nonfinite result ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${context}: got ${actual}, expected ${expected}, absolute tolerance ${tolerance}`,
  );
}

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function fixture() {
  const doc = emptyDocument();
  doc.components.push(createComponent("ground", "GND", 100, 400));
  const ground = pin("GND", 0);
  function node(id: string): Endpoint {
    doc.junctions.push({ id, x: 100 + doc.junctions.length * 120, y: 160 });
    return junction(id);
  }
  function wire(a: Endpoint, b: Endpoint) {
    doc.wires.push({ id: `W${doc.wires.length}`, a, b, bends: [] });
  }
  function part(
    type: ComponentType,
    id: string,
    value: number,
    a: Endpoint,
    b: Endpoint,
  ) {
    const c = createComponent(type, id, 100 + doc.components.length * 80, 240);
    c.value = value;
    doc.components.push(c);
    wire(a, pin(id, 0));
    wire(pin(id, 1), b);
    return c;
  }
  return { doc, ground, node, wire, part };
}

function voltage(net: Netlist, solution: Solution, endpoint: Endpoint): number {
  const id = net.endpointNets[endpointKey(endpoint)];
  assert.notEqual(id, undefined, `Missing net for ${endpointKey(endpoint)}`);
  return id === net.ground
    ? (solution.voltages[id] ?? 0)
    : solution.voltages[id];
}

function currentResidual(
  actual: number,
  expected: number,
  context: string,
): number {
  close(
    actual,
    expected,
    NONLINEAR_CURRENT_ATOL +
      NONLINEAR_CURRENT_RTOL * Math.max(Math.abs(actual), Math.abs(expected)),
    context,
  );
  return Math.abs(actual - expected);
}

function kcl(
  net: Netlist,
  solution: Solution,
  tolerance: number,
  relativeTolerance = 0,
): number {
  const sums = new Map(net.nets.map((n) => [n.id, 0]));
  const scales = new Map(net.nets.map((n) => [n.id, 0]));
  for (const branch of net.branches) {
    const current = solution.currents[branch.component.id];
    assert.ok(
      Number.isFinite(current),
      `Missing/nonfinite current through ${branch.component.id}`,
    );
    sums.set(branch.nodeA, (sums.get(branch.nodeA) ?? 0) + current);
    sums.set(branch.nodeB, (sums.get(branch.nodeB) ?? 0) - current);
    for (const node of [branch.nodeA, branch.nodeB])
      scales.set(node, scales.get(node)! + Math.abs(current));
  }
  for (const [node, sum] of sums)
    close(
      sum,
      0,
      tolerance + relativeTolerance * scales.get(node)!,
      `KCL at ${node}, t=${solution.time}`,
    );
  return Math.max(...Array.from(sums.values(), Math.abs));
}

test("engineering parser consumes the entire input and formatting respects SI case", () => {
  const valid: [string, number][] = [
    ["1k", 1000],
    ["1K", 1000],
    ["4.7 M", 4.7e6],
    ["-2.2m", -0.0022],
    ["+.5u", 0.5e-6],
    ["2n", 2e-9],
    ["3p", 3e-12],
    ["4f", 4e-15],
    ["2G", 2e9],
    ["3T", 3e12],
    ["  -1.25e+3  ", -1250],
    ["1e-3k", 1],
    ["0", 0],
    ["-0", -0],
    ["1.", 1],
    ["4.7 kohm", 4700],
    ["2.2 uF", 2.2e-6],
    ["1\u00b5", 1e-6],
    ["1\u03bc", 1e-6],
  ];
  for (const [text, expected] of valid)
    close(parseEngineering(text), expected, Math.abs(expected) * 1e-14, text);
  for (const text of [
    "",
    " ",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e309",
    "1e308Y",
    "1e-999",
    "0x10",
    "1foo",
    "1k garbage",
    "1kk",
    "1,000",
    "1/2",
    "1e",
    "--2",
    "2 3",
    "1KHzjunk",
  ]) {
    assert.throws(
      () => parseEngineering(text),
      Error,
      `Must reject ${JSON.stringify(text)}`,
    );
  }
  assert.equal(formatEngineering(1000), "1k");
  assert.equal(formatEngineering(1e6), "1M");
  assert.equal(formatEngineering(0.001), "1m");
  assert.equal(formatEngineering(2.2e-6, "F"), "2.2 uF");
  assert.equal(formatEngineering(0, "V"), "0 V");
  for (const value of [
    -1e20, -2.7e-12, 999.999, 0.034567, 3.14159, 8e-27, 7e28,
  ]) {
    close(
      parseEngineering(formatEngineering(value)),
      value,
      Math.abs(value) * 0.0006,
      `format round trip ${value}`,
    );
  }
});

test("factories are independent, pins rotate around their center, and ground has one pin", () => {
  const a = createComponent("capacitor", "C1", 100, 200);
  const b = createComponent("capacitor", "C2", 100, 200);
  a.waveform.amplitude = 999;
  a.switch.toggles.push(1);
  assert.equal(b.waveform.amplitude, 5);
  assert.deepEqual(b.switch.toggles, []);
  assert.deepEqual(componentPins(a), [
    { x: 60, y: 200 },
    { x: 140, y: 200 },
  ]);
  a.rotation = 90;
  assert.deepEqual(componentPins(a), [
    { x: 100, y: 160 },
    { x: 100, y: 240 },
  ]);
  a.rotation = 45;
  close(componentPins(a)[0].x, 100 - 40 / Math.sqrt(2), 1e-12, "rotated x");
  close(componentPins(a)[1].y, 200 + 40 / Math.sqrt(2), 1e-12, "rotated y");
  assert.deepEqual(componentPins(createComponent("ground", "G1", 12, 34)), [
    { x: 12, y: 34 },
  ]);
  const doc = emptyDocument();
  doc.components.push(a);
  doc.junctions.push({ id: "J1", x: 17, y: 29 });
  assert.deepEqual(endpointPosition(doc, pin("C1", 0)), componentPins(a)[0]);
  const position = endpointPosition(doc, junction("J1"));
  position.x = -100;
  assert.equal(doc.junctions[0].x, 17);
  assert.throws(() => endpointPosition(doc, pin("missing", 0)));
  assert.throws(() => endpointPosition(doc, junction("missing")));
  doc.components.push(createComponent("ground", "G1", 0, 0));
  assert.throws(() => endpointPosition(doc, pin("G1", 1)));
  assert.notEqual(emptyDocument().settings, emptyDocument().settings);
});

test("every example validates, round trips every object, and creates independent documents", (t) => {
  for (const example of examples) {
    const original = example.create();
    const input = JSON.parse(JSON.stringify(original));
    input.metadata = { nested: [{ note: "Preserve optional JSON metadata" }] };
    const cloned = validateDocument(input);
    assert.deepEqual(cloned, input);
    assert.notEqual(cloned, input);
    for (const key of [
      "components",
      "wires",
      "junctions",
      "labels",
      "probes",
    ] as const) {
      assert.notEqual(cloned[key], input[key]);
      cloned[key].forEach((item, i) => assert.notEqual(item, input[key][i]));
    }
    cloned.components[0].waveform.amplitude = 123;
    cloned.components[0].switch.toggles.push(99);
    cloned.wires[0].a = pin("missing", 0);
    cloned.settings.timestep /= 2;
    (
      cloned as CircuitDocument & { metadata: { nested: { note: string }[] } }
    ).metadata.nested[0].note = "changed";
    assert.deepEqual(example.create(), original);
    assert.notEqual(input.components[0].waveform.amplitude, 123);
    assert.equal(
      input.metadata.nested[0].note,
      "Preserve optional JSON metadata",
    );
    assert.deepEqual(
      input.components[0].switch.toggles,
      original.components[0].switch.toggles,
    );
    assert.notDeepEqual(cloned.wires[0], input.wires[0]);
  }
  assert.deepEqual(defaultExample(), examples[0].create());
  t.diagnostic(
    `Workload: ${examples.length} built-in examples, complete JSON/deep-clone round trips.`,
  );
});

test("malformed imports fail atomically, including IDs, references, numeric bounds, waveforms and settings", (t) => {
  const original = examples.find((e) => e.id === "rc")!.create();
  const invalid: [string, (doc: any) => void][] = [
    [
      "version",
      (d) => {
        d.version = 2;
      },
    ],
    [
      "title",
      (d) => {
        d.title = "";
      },
    ],
    [
      "missing collection",
      (d) => {
        delete d.probes;
      },
    ],
    [
      "wrong collection",
      (d) => {
        d.wires = {};
      },
    ],
    [
      "duplicate component",
      (d) => {
        d.components.push(structuredClone(d.components[0]));
      },
    ],
    [
      "cross-kind duplicate ID",
      (d) => {
        d.wires[0].id = d.components[0].id;
      },
    ],
    [
      "unsafe ID",
      (d) => {
        d.components[0].id = "__proto__";
      },
    ],
    [
      "endpoint-key collision",
      (d) => {
        d.components[0].id = "j:foo";
      },
    ],
    [
      "unknown type",
      (d) => {
        d.components[0].type = "battery";
      },
    ],
    [
      "NaN",
      (d) => {
        d.components[0].value = NaN;
      },
    ],
    [
      "infinite coordinate",
      (d) => {
        d.components[0].x = Infinity;
      },
    ],
    [
      "coordinate bounds",
      (d) => {
        d.components[0].y = 100001;
      },
    ],
    [
      "rotation",
      (d) => {
        d.components[0].rotation = NaN;
      },
    ],
    [
      "zero resistor",
      (d) => {
        d.components[1].value = 0;
      },
    ],
    [
      "negative capacitor",
      (d) => {
        d.components[2].value = -1;
      },
    ],
    [
      "zero inductor",
      (d) => {
        d.components[1].type = "inductor";
        d.components[1].value = 0;
      },
    ],
    [
      "invalid initial",
      (d) => {
        d.components[2].initial = Infinity;
      },
    ],
    [
      "string initial",
      (d) => {
        d.components[2].initial = "0";
      },
    ],
    [
      "missing source waveform",
      (d) => {
        delete d.components[0].waveform;
      },
    ],
    [
      "unknown waveform",
      (d) => {
        d.components[0].waveform.type = "triangle";
      },
    ],
    [
      "nonfinite offset",
      (d) => {
        d.components[0].waveform.offset = Infinity;
      },
    ],
    [
      "nonfinite amplitude",
      (d) => {
        d.components[0].waveform.amplitude = NaN;
      },
    ],
    [
      "frequency",
      (d) => {
        d.components[0].waveform.frequency = -1;
      },
    ],
    [
      "phase",
      (d) => {
        d.components[0].waveform.phase = Infinity;
      },
    ],
    [
      "negative delay",
      (d) => {
        d.components[0].waveform.delay = -1;
      },
    ],
    [
      "negative rise",
      (d) => {
        d.components[0].waveform.rise = -1;
      },
    ],
    [
      "negative fall",
      (d) => {
        d.components[0].waveform.fall = -1;
      },
    ],
    [
      "negative width",
      (d) => {
        d.components[0].waveform.width = -1;
      },
    ],
    [
      "zero period",
      (d) => {
        d.components[0].waveform.period = 0;
      },
    ],
    [
      "pulse exceeds period",
      (d) => {
        Object.assign(d.components[0].waveform, {
          type: "pulse",
          rise: 0.5,
          width: 0.5,
          fall: 0.1,
          period: 1,
        });
      },
    ],
    [
      "diode saturation",
      (d) => {
        d.components[0].diode.is = 0;
      },
    ],
    [
      "diode ideality",
      (d) => {
        d.components[0].diode.n = -1;
      },
    ],
    [
      "switch ron",
      (d) => {
        d.components[0].switch.ron = 0;
      },
    ],
    [
      "switch roff",
      (d) => {
        d.components[0].switch.roff = Infinity;
      },
    ],
    [
      "switch ordering",
      (d) => {
        d.components[0].switch.roff = d.components[0].switch.ron;
      },
    ],
    [
      "switch boolean",
      (d) => {
        d.components[0].switch.closed = "false";
      },
    ],
    [
      "negative toggle",
      (d) => {
        d.components[0].switch.toggles = [-1];
      },
    ],
    [
      "unsorted toggles",
      (d) => {
        d.components[0].switch.toggles = [0.2, 0.1];
      },
    ],
    [
      "duplicate toggles",
      (d) => {
        d.components[0].switch.toggles = [0.1, 0.1];
      },
    ],
    [
      "nonfinite toggle",
      (d) => {
        d.components[0].switch.toggles = [NaN];
      },
    ],
    [
      "missing pin component",
      (d) => {
        d.wires[0].a.componentId = "missing";
      },
    ],
    [
      "pin index",
      (d) => {
        d.wires[0].a.pin = 2;
      },
    ],
    [
      "ground second pin",
      (d) => {
        d.wires[0].a = pin("GND", 1);
      },
    ],
    [
      "missing junction",
      (d) => {
        d.wires[0].a = junction("missing");
      },
    ],
    [
      "endpoint kind",
      (d) => {
        d.wires[0].a = { kind: "position", x: 0, y: 0 };
      },
    ],
    [
      "invalid bend",
      (d) => {
        d.wires[0].bends = [{ x: 0, y: NaN }];
      },
    ],
    [
      "label reference",
      (d) => {
        d.labels[0].anchor = pin("missing", 0);
      },
    ],
    [
      "label name",
      (d) => {
        d.labels[0].name = "";
      },
    ],
    [
      "voltage probe reference",
      (d) => {
        d.probes[0].anchor = junction("missing");
      },
    ],
    [
      "current probe reference",
      (d) => {
        d.probes[2].componentId = "missing";
      },
    ],
    [
      "ground current probe",
      (d) => {
        d.probes[2].componentId = "GND";
      },
    ],
    [
      "probe kind",
      (d) => {
        d.probes[0].kind = "power";
      },
    ],
    [
      "duration",
      (d) => {
        d.settings.duration = 0;
      },
    ],
    [
      "timestep",
      (d) => {
        d.settings.timestep = -1;
      },
    ],
    [
      "oversized timestep",
      (d) => {
        d.settings.timestep = d.settings.duration * 2;
      },
    ],
    [
      "too many steps",
      (d) => {
        d.settings.timestep = d.settings.duration / 100001;
      },
    ],
    [
      "tolerance",
      (d) => {
        d.settings.tolerance = 0;
      },
    ],
    [
      "loose tolerance",
      (d) => {
        d.settings.tolerance = 1;
      },
    ],
    [
      "nonfinite setting",
      (d) => {
        d.settings.duration = Infinity;
      },
    ],
    [
      "initialization",
      (d) => {
        d.settings.initialization = "automatic";
      },
    ],
  ];
  for (const [name, mutate] of invalid) {
    const candidate = structuredClone(original);
    mutate(candidate);
    const before = structuredClone(candidate);
    assert.throws(() => validateDocument(candidate), Error, name);
    assert.deepEqual(
      candidate,
      before,
      `${name}: validation mutated the input`,
    );
    assert.deepEqual(
      original,
      examples.find((e) => e.id === "rc")!.create(),
      `${name}: previous document changed`,
    );
  }
  for (const input of [null, [], "circuit", 1, new Date()])
    assert.throws(() => validateDocument(input));
  const signed = structuredClone(original);
  signed.components[0].value = -5;
  signed.components[0].waveform.amplitude = -2;
  signed.components[0].waveform.offset = -1;
  signed.components[0].waveform.frequency = 0;
  signed.components[2].initial = -3;
  assert.deepEqual(validateDocument(signed), signed);
  signed.components[0].type = "current";
  signed.components[0].value = 0;
  signed.components[1].type = "inductor";
  signed.components[1].initial = -0.25;
  signed.components[1].switch.toggles = [0, 0.1, 0.2];
  assert.deepEqual(validateDocument(signed), signed);
  t.diagnostic(
    `Workload: ${invalid.length} malformed-document mutations + 5 invalid roots; signed/zero sources and signed capacitor/inductor initial states accepted.`,
  );
});

test("document limits accept 200 components / 1000 wires and reject one beyond either limit", () => {
  const doc = emptyDocument();
  for (let i = 0; i < 200; i++)
    doc.components.push(createComponent("resistor", `R${i}`, i * 40, 100));
  for (let i = 0; i < 1000; i++)
    doc.wires.push({
      id: `W${i}`,
      a: pin(`R${i % 200}`, 0),
      b: pin(`R${(i + 1) % 200}`, 1),
      bends: [],
    });
  assert.deepEqual(validateDocument(doc), doc);
  doc.components.push(createComponent("resistor", "R200", 0, 0));
  assert.throws(() => validateDocument(doc));
  doc.components.pop();
  doc.wires.push({ id: "W1000", a: pin("R0", 0), b: pin("R1", 0), bends: [] });
  assert.throws(() => validateDocument(doc));
});

test("crossings do not connect; explicit junctions do; moving/rotating preserves endpoint topology", () => {
  const doc = defaultExample();
  const net = buildNetlist(doc);
  assert.notEqual(
    net.endpointNets[endpointKey(junction("JVIN"))],
    net.endpointNets[endpointKey(pin("R2", 1))],
    "VIN crosses the ground return at (460,400) without connection",
  );
  assert.equal(
    net.endpointNets[endpointKey(junction("JOUT"))],
    net.endpointNets[endpointKey(pin("R1", 1))],
  );
  assert.equal(
    net.endpointNets[endpointKey(junction("JOUT"))],
    net.endpointNets[endpointKey(pin("R2", 0))],
  );
  const before = solveDC(net);
  close(
    voltage(net, before, junction("JOUT")),
    5,
    DC_VOLTAGE_ATOL,
    "divider output",
  );
  const moved = structuredClone(doc);
  moved.junctions[0].x += 83;
  moved.junctions[0].y -= 57;
  moved.components[1].x += 32;
  moved.components[1].rotation = 90;
  moved.components[2].rotation = 225;
  moved.wires[0].bends.push({ x: 460, y: 400 });
  const afterNet = buildNetlist(moved);
  assert.deepEqual(afterNet.endpointNets, net.endpointNets);
  close(
    voltage(afterNet, solveDC(afterNet), junction("JOUT")),
    5,
    DC_VOLTAGE_ATOL,
    "moved divider output",
  );
  moved.wires.push({
    id: "WCONNECT",
    a: junction("JOUT"),
    b: pin("GND", 0),
    bends: [],
  });
  const connected = buildNetlist(moved);
  assert.equal(
    connected.endpointNets[endpointKey(junction("JOUT"))],
    connected.ground,
  );
  close(
    voltage(connected, solveDC(connected), junction("JOUT")),
    0,
    DC_VOLTAGE_ATOL,
    "explicit connection changes the circuit",
  );
});

test("seeded series/parallel DC graphs match independently reduced circuits", (t) => {
  const random = seeded(0x5eed1234);
  const workload: { groups: number; resistors: number }[] = [];
  for (let run = 0; run < 24; run++) {
    const f = fixture();
    const count = 2 + Math.floor(random() * 5);
    const nodes = Array.from({ length: count }, (_, i) => f.node(`N${i}`));
    const source = (run % 3 === 0 ? -1 : 1) * (0.5 + random() * 19.5);
    f.part("voltage", "V1", source, nodes[0], f.ground);
    const equivalents: number[] = [];
    let resistors = 0;
    for (let i = 0; i < count; i++) {
      const parallel = 1 + Math.floor(random() * 4);
      let conductance = 0;
      for (let j = 0; j < parallel; j++) {
        const resistance = 50 + random() * 4950;
        conductance += 1 / resistance;
        f.part(
          "resistor",
          `R${resistors++}`,
          resistance,
          nodes[i],
          nodes[i + 1] ?? f.ground,
        );
      }
      equivalents.push(1 / conductance);
    }
    const net = buildNetlist(validateDocument(f.doc));
    const solution = solveDC(net);
    const current = source / equivalents.reduce((a, b) => a + b, 0);
    let expected = source;
    nodes.forEach((node, i) => {
      close(
        voltage(net, solution, node),
        expected,
        DC_VOLTAGE_ATOL,
        `graph ${run}, group ${i}`,
      );
      expected -= current * equivalents[i];
    });
    close(
      solution.currents.V1,
      -current,
      DC_CURRENT_ATOL,
      `graph ${run} source current orientation`,
    );
    for (const branch of net.branches.filter(
      (b) => b.component.type === "resistor",
    )) {
      const drop =
        (solution.voltages[branch.nodeA] ?? 0) -
        (solution.voltages[branch.nodeB] ?? 0);
      close(
        solution.currents[branch.component.id],
        drop / branch.component.value,
        DC_CURRENT_ATOL,
        `Ohm's law ${branch.component.id}`,
      );
    }
    kcl(net, solution, DC_CURRENT_ATOL);
    workload.push({ groups: count, resistors });
  }
  t.diagnostic(
    `Workload: seed=0x5eed1234; 24 changed series/parallel graphs; voltage atol=${DC_VOLTAGE_ATOL} V, current/KCL atol=${DC_CURRENT_ATOL} A; ${JSON.stringify(workload)}`,
  );
});

test("seeded non-series-parallel meshes recover prescribed potentials from independently computed injections", (t) => {
  const random = seeded(0xc1ac017);
  const workload: { nodes: number; resistors: number }[] = [];
  for (let run = 0; run < 12; run++) {
    const f = fixture();
    const count = 3 + (run % 7);
    const nodes = [
      f.ground,
      ...Array.from({ length: count }, (_, i) => f.node(`N${i + 1}`)),
    ];
    const expected = [
      0,
      ...Array.from({ length: count }, () => (random() - 0.5) * 12),
    ];
    const outgoing = Array(count + 1).fill(0) as number[];
    const resistors: { id: string; current: number }[] = [];
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b <= count; b++) {
        if (b !== a + 1 && random() > 0.45) continue;
        const resistance = 100 + random() * 9900;
        const current = (expected[a] - expected[b]) / resistance;
        const id = `R${resistors.length}`;
        f.part("resistor", id, resistance, nodes[a], nodes[b]);
        outgoing[a] += current;
        outgoing[b] -= current;
        resistors.push({ id, current });
      }
    }
    for (let i = 1; i <= count; i++)
      f.part("current", `I${i}`, outgoing[i], f.ground, nodes[i]);
    const net = buildNetlist(validateDocument(f.doc));
    const solution = solveDC(net);
    nodes.forEach((node, i) =>
      close(
        voltage(net, solution, node),
        expected[i],
        DC_VOLTAGE_ATOL,
        `mesh ${run}, node ${i}`,
      ),
    );
    for (const r of resistors)
      close(
        solution.currents[r.id],
        r.current,
        DC_CURRENT_ATOL,
        `mesh ${run}, ${r.id}`,
      );
    for (let i = 1; i <= count; i++)
      close(
        solution.currents[`I${i}`],
        outgoing[i],
        DC_CURRENT_ATOL,
        "current source orientation",
      );
    kcl(net, solution, DC_CURRENT_ATOL);
    workload.push({ nodes: count + 1, resistors: resistors.length });
  }
  t.diagnostic(
    `Workload: seed=0xc1ac017; 12 changed mesh graphs, strictly positive generated resistances, signed current injections; ${JSON.stringify(workload)}`,
  );
});

test("zero/negative voltage sources and DC capacitor-open / inductor-short semantics", () => {
  for (const source of [0, -5, 3.25]) {
    const f = fixture();
    const a = f.node("NA");
    const b = f.node("NB");
    const v = f.part("voltage", "V1", source, a, f.ground);
    Object.assign(v.waveform, { type: "sine", offset: 99, amplitude: 27 });
    f.part("resistor", "R1", 1000, a, b);
    f.part("capacitor", "C1", 1e-6, b, f.ground).initial = -2;
    let net = buildNetlist(f.doc);
    let result = solveDC(net);
    close(
      voltage(net, result, b),
      source,
      DC_VOLTAGE_ATOL,
      "DC capacitor open",
    );
    close(result.currents.C1, 0, DC_CURRENT_ATOL, "DC capacitor current");
    f.part("inductor", "L1", 0.01, b, f.ground).initial = -0.1;
    net = buildNetlist(f.doc);
    result = solveDC(net);
    close(voltage(net, result, b), 0, DC_VOLTAGE_ATOL, "DC inductor short");
    close(
      result.currents.L1,
      source / 1000,
      DC_CURRENT_ATOL,
      "DC inductor current",
    );
    kcl(net, result, DC_CURRENT_ATOL);
  }
});

test("source waveforms implement DC value, delayed sine with degree phase, and pulse edges", () => {
  const source = createComponent("voltage", "V1", 0, 0);
  source.value = -3;
  source.waveform.offset = 100;
  source.waveform.amplitude = 22;
  close(waveformValue(source, 100), -3, 0, "DC uses component.value");
  Object.assign(source.waveform, {
    type: "sine",
    offset: -2,
    amplitude: 3,
    frequency: 50,
    phase: 30,
    delay: 0.01,
  });
  close(waveformValue(source, 0.009), -2, 0, "sine before delay");
  for (const time of [0.01, 0.011, 0.015, 0.02, 0.037]) {
    close(
      waveformValue(source, time),
      -2 + 3 * Math.sin(2 * Math.PI * 50 * (time - 0.01) + Math.PI / 6),
      1e-12,
      `sine t=${time}`,
    );
  }
  Object.assign(source.waveform, {
    type: "pulse",
    offset: -1,
    amplitude: 4,
    delay: 0.005,
    rise: 0.002,
    width: 0.003,
    fall: 0.001,
    period: 0.01,
  });
  for (const [time, expected] of [
    [0, -1],
    [0.005, -1],
    [0.006, 1],
    [0.007, 3],
    [0.009, 3],
    [0.0105, 1],
    [0.012, -1],
    [0.016, 1],
  ]) {
    close(waveformValue(source, time), expected, 1e-10, `pulse t=${time}`);
  }
  Object.assign(source.waveform, { rise: 0, fall: 0 });
  close(waveformValue(source, 0.005), 3, 1e-12, "instant pulse rise");
  close(waveformValue(source, 0.0081), -1, 1e-12, "instant pulse fall");
  source.type = "current";
  close(waveformValue(source, 0.005), 3, 1e-12, "current source waveform");
});

test("RC charging/discharging tracks the exponential at every sample from t=0 to 5 tau", (t) => {
  const random = seeded(0xacc0123);
  const workload: object[] = [];
  for (const [source, initial, nominal] of [
    [5, 0, true],
    [5, 0, false],
    [-3, 2, false],
    [0, -1.5, false],
  ] as const) {
    const doc = examples.find((e) => e.id === "rc")!.create();
    const r = doc.components.find((c) => c.id === "R1")!;
    const c = doc.components.find((c) => c.id === "C1")!;
    r.value = nominal ? 1000 : 300 + random() * 2700;
    c.value = nominal ? 1e-6 : (0.2 + random() * 2.8) * 1e-6;
    c.initial = initial;
    doc.components.find((c) => c.id === "V1")!.value = source;
    const tau = r.value * c.value;
    doc.settings = {
      duration: 5 * tau,
      timestep: tau / 200,
      tolerance: 1e-9,
      initialization: "explicit",
    };
    const net = buildNetlist(doc);
    const result = solveTransient(net, doc.settings);
    assert.equal(
      result.steps,
      result.samples.length - 1,
      "every completed RC step has one sample",
    );
    close(result.samples[0].time, 0, 0, "RC t0 included");
    close(
      voltage(net, result.samples[0], pin("C1", 0)),
      initial,
      1e-8,
      "explicit capacitor initial voltage",
    );
    close(result.samples.at(-1)!.time, 5 * tau, tau * 1e-9, "RC final time");
    let maximumError = 0;
    for (const sample of result.samples) {
      const expected =
        source + (initial - source) * Math.exp(-sample.time / tau);
      const actual = voltage(net, sample, pin("C1", 0));
      maximumError = Math.max(maximumError, Math.abs(actual - expected));
      close(
        actual,
        expected,
        Math.abs(source - initial) * 0.002,
        `RC exponential at ${sample.time / tau} tau`,
      );
      kcl(net, sample, 1e-7);
    }
    workload.push({
      resistance: r.value,
      capacitance: c.value,
      source,
      initial,
      tau,
      samples: result.samples.length,
      maximumError,
    });
  }
  t.diagnostic(
    `Workload: nominal 5 V / 1 kOhm / 1 uF plus 3 generated RC cases, seed=0xacc0123; 1000 nominal steps/case, dt=tau/200, max allowed voltage error=0.2% of step; ${JSON.stringify(workload)}`,
  );
});

test("DC initialization is distinct from explicit storage states; signed RL initial current is respected", () => {
  const doc = examples.find((e) => e.id === "rc")!.create();
  doc.components.find((c) => c.id === "C1")!.initial = -2;
  doc.settings.initialization = "dc";
  let net = buildNetlist(doc);
  const dc = solveTransient(net, doc.settings);
  for (const sample of dc.samples)
    close(
      voltage(net, sample, pin("C1", 0)),
      5,
      1e-7,
      "DC initialized capacitor stays at 5 V",
    );
  const f = fixture();
  const a = f.node("NA");
  const b = f.node("NB");
  f.part("voltage", "V1", 4, a, f.ground);
  f.part("resistor", "R1", 400, a, b);
  f.part("inductor", "L1", 0.02, b, f.ground).initial = -0.003;
  const tau = 0.02 / 400;
  f.doc.settings = {
    duration: 5 * tau,
    timestep: tau / 200,
    tolerance: 1e-9,
    initialization: "explicit",
  };
  net = buildNetlist(f.doc);
  const result = solveTransient(net, f.doc.settings);
  close(
    result.samples[0].currents.L1,
    -0.003,
    1e-9,
    "signed explicit inductor current",
  );
  for (const sample of result.samples) {
    close(
      sample.currents.L1,
      0.01 - 0.013 * Math.exp(-sample.time / tau),
      0.013 * 0.002,
      "RL exponential",
    );
    kcl(net, sample, 1e-7);
  }
});

test("RLC capacitor voltage and independently fitted series current meet 1% / 1 degree below/at/above resonance", (t) => {
  const workload: object[] = [];
  let maximumVoltageError = 0,
    maximumCurrentError = 0;
  let maximumAmplitudeErrorPercent = 0,
    maximumPhaseErrorDegrees = 0;
  for (const ratio of [0.5, 1, 2]) {
    const doc = examples.find((e) => e.id === "rlc")!.create();
    const resistance = 40;
    const inductance = 0.01;
    const capacitance = 1e-6;
    doc.components.find((c) => c.id === "R1")!.value = resistance;
    doc.components.find((c) => c.id === "L1")!.value = inductance;
    doc.components.find((c) => c.id === "C1")!.value = capacitance;
    const frequency =
      ratio / (2 * Math.PI * Math.sqrt(inductance * capacitance));
    const sourceAmplitude = 1;
    Object.assign(doc.components.find((c) => c.id === "V1")!.waveform, {
      type: "sine",
      amplitude: sourceAmplitude,
      frequency,
      offset: 0,
      phase: 0,
      delay: 0,
    });
    const period = 1 / frequency;
    doc.settings = {
      duration: 26 * period,
      timestep: period / 800,
      tolerance: 1e-9,
      initialization: "explicit",
    };
    const net = buildNetlist(doc);
    const result = solveTransient(net, doc.settings);
    const settled = result.samples.filter(
      (sample) => sample.time >= 20 * period,
    );
    assert.ok(settled.length >= 4800, "fit covers all six settled periods");
    const omega = 2 * Math.PI * frequency;
    const real = 1 - omega ** 2 * inductance * capacitance;
    const imaginary = omega * resistance * capacitance;
    const reactance = omega * inductance - 1 / (omega * capacitance);
    for (const signal of ["V(C1)", "I(R1)"] as const) {
      const expectedAmplitude =
        sourceAmplitude /
        (signal === "V(C1)"
          ? Math.hypot(real, imaginary)
          : Math.hypot(resistance, reactance));
      const expectedPhase =
        signal === "V(C1)"
          ? -Math.atan2(imaginary, real)
          : -Math.atan2(reactance, resistance);
      let ss = 0,
        cc = 0,
        sc = 0,
        ys = 0,
        yc = 0,
        maximumSampleError = 0;
      for (const sample of settled) {
        const angle = omega * sample.time;
        const s = Math.sin(angle),
          c = Math.cos(angle);
        const y =
          signal === "V(C1)"
            ? voltage(net, sample, pin("C1", 0)) -
              voltage(net, sample, pin("C1", 1))
            : sample.currents.R1;
        ss += s * s;
        cc += c * c;
        sc += s * c;
        ys += y * s;
        yc += y * c;
        maximumSampleError = Math.max(
          maximumSampleError,
          Math.abs(y - expectedAmplitude * Math.sin(angle + expectedPhase)),
        );
      }
      // Fit each measured branch independently, without using solver state or V-to-I conversion.
      const determinant = ss * cc - sc * sc;
      const sine = (ys * cc - yc * sc) / determinant;
      const cosine = (yc * ss - ys * sc) / determinant;
      const amplitude = Math.hypot(sine, cosine);
      const phase = Math.atan2(cosine, sine);
      const phaseError = Math.atan2(
        Math.sin(phase - expectedPhase),
        Math.cos(phase - expectedPhase),
      );
      const amplitudeErrorPercent =
        100 * Math.abs(amplitude / expectedAmplitude - 1);
      const phaseErrorDegrees = (Math.abs(phaseError) * 180) / Math.PI;
      close(
        amplitude,
        expectedAmplitude,
        expectedAmplitude * 0.01,
        `${signal} amplitude at ${ratio} f0`,
      );
      close(
        phaseError,
        0,
        Math.PI / 180,
        `${signal} phase at ${ratio} f0 (radians)`,
      );
      if (signal === "V(C1)")
        maximumVoltageError = Math.max(maximumVoltageError, maximumSampleError);
      else
        maximumCurrentError = Math.max(maximumCurrentError, maximumSampleError);
      maximumAmplitudeErrorPercent = Math.max(
        maximumAmplitudeErrorPercent,
        amplitudeErrorPercent,
      );
      maximumPhaseErrorDegrees = Math.max(
        maximumPhaseErrorDegrees,
        phaseErrorDegrees,
      );
      workload.push({
        ratio,
        frequency,
        signal,
        samples: result.samples.length,
        fittedSamples: settled.length,
        amplitude,
        expectedAmplitude,
        phase,
        expectedPhase,
        amplitudeErrorPercent,
        phaseErrorDegrees,
        maximumSampleError,
      });
    }
  }
  t.diagnostic(
    `Workload: Vs=1 V, R=40 Ohm, L=10 mH, C=1 uF; f/f0=[0.5,1,2], settle 20 periods then fit final 6, 800 steps/period; V(C1) and I(R1) amplitude tolerance=1%, phase tolerance=1 degree; ${JSON.stringify(workload)}`,
  );
  t.diagnostic(
    `RLC maxima: ${JSON.stringify({ maximumVoltageError, maximumCurrentError, maximumAmplitudeErrorPercent, maximumPhaseErrorDegrees })}`,
  );
});

test("diode forward/reverse DC solutions satisfy Shockley residuals, KCL and pin orientation", (t) => {
  const workload: object[] = [];
  for (const [source, resistance, saturation, ideality, reversed] of [
    [5, 1000, 1e-12, 1, false],
    [2, 470, 2e-12, 1.4, false],
    [-5, 2200, 1e-12, 1, false],
    [5, 1000, 1e-12, 1, true],
    [-3, 1500, 5e-12, 1.2, true],
  ] as const) {
    const f = fixture();
    const a = f.node("NA");
    const b = f.node("NB");
    f.part("voltage", "V1", source, a, f.ground);
    f.part("resistor", "R1", resistance, a, b);
    const diode = f.part(
      "diode",
      "D1",
      0.7,
      reversed ? f.ground : b,
      reversed ? b : f.ground,
    );
    diode.diode = { is: saturation, n: ideality };
    const net = buildNetlist(f.doc);
    const result = solveDC(net);
    const output = voltage(net, result, b);
    const vd = reversed ? -output : output;
    const shockley = saturation * Math.expm1(vd / (ideality * THERMAL_VOLTAGE));
    const shockleyResidual = currentResidual(
      result.currents.D1,
      shockley,
      "diode Shockley current",
    );
    const loadLineResidual = currentResidual(
      (source - output) / resistance,
      reversed ? -shockley : shockley,
      "nonlinear load-line residual",
    );
    const maximumKclResidual = kcl(
      net,
      result,
      NONLINEAR_CURRENT_ATOL,
      NONLINEAR_CURRENT_RTOL,
    );
    let lo = -Math.abs(source) - 1,
      hi = Math.abs(source) + 1;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const current =
        saturation *
        Math.expm1((reversed ? -mid : mid) / (ideality * THERMAL_VOLTAGE));
      const residual =
        (mid - source) / resistance + (reversed ? -current : current);
      if (residual > 0) hi = mid;
      else lo = mid;
    }
    close(output, (lo + hi) / 2, 2e-5, "independent bisection operating point");
    workload.push({
      source,
      resistance,
      saturation,
      ideality,
      reversed,
      output,
      diodeCurrent: result.currents.D1,
      shockleyResidual,
      loadLineResidual,
      maximumKclResidual,
      voltageError: Math.abs(output - (lo + hi) / 2),
    });
  }
  t.diagnostic(
    `Workload: 5 diode load lines, both orientations and source polarities; VT=${THERMAL_VOLTAGE} V; Shockley/load-line tolerance=${NONLINEAR_CURRENT_ATOL} A + ${NONLINEAR_CURRENT_RTOL}*max(abs(I),abs(reference)); KCL tolerance=${NONLINEAR_CURRENT_ATOL} A + ${NONLINEAR_CURRENT_RTOL}*sum(abs(incident currents)); independent bisection voltage atol=2e-5 V; ${JSON.stringify(workload)}`,
  );
});

test("every half-wave sample satisfies Shockley/KCL; reversed electrical pins mirror polarity and capacitance reduces ripple", (t) => {
  const workload: object[] = [];
  const ripple: number[] = [];
  let forwardOutputs: number[] = [],
    forwardCurrents: number[] = [];
  for (const [capacitance, reversed] of [
    [0, false],
    [0, true],
    [10e-6, false],
    [47e-6, false],
  ] as const) {
    const f = fixture();
    const a = f.node("NA");
    const b = f.node("NB");
    const source = f.part("voltage", "V1", 0, a, f.ground);
    Object.assign(source.waveform, {
      type: "sine",
      offset: 0,
      amplitude: 5,
      frequency: 50,
    });
    const diode = f.part(
      "diode",
      "D1",
      0.7,
      reversed ? b : a,
      reversed ? a : b,
    );
    f.part("resistor", "R1", 1000, b, f.ground);
    if (capacitance) f.part("capacitor", "C1", capacitance, b, f.ground);
    f.doc.settings = {
      duration: 0.2,
      timestep: 0.00005,
      tolerance: 1e-9,
      initialization: "explicit",
    };
    const net = buildNetlist(f.doc);
    const result = solveTransient(net, f.doc.settings);
    const branch = net.branches.find((branch) => branch.component.id === "D1")!;
    assert.equal(
      branch.nodeA,
      net.endpointNets[endpointKey(reversed ? b : a)],
      "orientation changes electrical pin 0 reference",
    );
    assert.equal(
      branch.nodeB,
      net.endpointNets[endpointKey(reversed ? a : b)],
      "orientation changes electrical pin 1 reference",
    );
    const polarity = reversed ? -1 : 1;
    const outputs = result.samples
      .filter((s) => s.time >= 0.18 - 1e-12)
      .map((s) => polarity * voltage(net, s, b));
    const minimum = Math.min(...outputs),
      maximum = Math.max(...outputs);
    assert.ok(maximum > 4 && maximum < 5, `rectifier peak ${maximum}`);
    assert.ok(minimum > -1e-5, `rectifier negative output ${minimum}`);
    let maximumShockleyResidual = 0,
      maximumKclResidual = 0,
      maximumLoadLineResidual = 0;
    let maximumMirrorVoltageError = 0,
      maximumMirrorCurrentError = 0;
    for (const [i, sample] of result.samples.entries()) {
      maximumKclResidual = Math.max(
        maximumKclResidual,
        kcl(net, sample, NONLINEAR_CURRENT_ATOL, NONLINEAR_CURRENT_RTOL),
      );
      const vd = polarity * (voltage(net, sample, a) - voltage(net, sample, b));
      const shockley =
        diode.diode.is * Math.expm1(vd / (diode.diode.n * THERMAL_VOLTAGE));
      maximumShockleyResidual = Math.max(
        maximumShockleyResidual,
        currentResidual(
          sample.currents.D1,
          shockley,
          `transient diode residual t=${sample.time}`,
        ),
      );
      if (!capacitance) {
        const input = 5 * Math.sin(2 * Math.PI * 50 * sample.time);
        const output = voltage(net, sample, b);
        maximumLoadLineResidual = Math.max(
          maximumLoadLineResidual,
          currentResidual(
            output / 1000,
            polarity * shockley,
            `rectifier load line t=${sample.time}`,
          ),
        );
        if (polarity * input < -0.1)
          close(output, 0, 1e-7, "opposite half-cycle blocked");
        if (reversed) {
          // No storage: reversing the diode mirrors the positive trace shifted by half a period.
          const opposite = (i + 200) % (result.samples.length - 1);
          const expectedOutput = -forwardOutputs[opposite];
          close(
            output,
            expectedOutput,
            1e-7,
            `negative half-wave mirror t=${sample.time}`,
          );
          maximumMirrorVoltageError = Math.max(
            maximumMirrorVoltageError,
            Math.abs(output - expectedOutput),
          );
          maximumMirrorCurrentError = Math.max(
            maximumMirrorCurrentError,
            currentResidual(
              sample.currents.R1,
              -forwardCurrents[opposite],
              `half-wave current mirror t=${sample.time}`,
            ),
          );
        }
      }
    }
    if (!capacitance && !reversed) {
      assert.equal(
        result.samples.length,
        4001,
        "400 samples/period for exact half-period comparison",
      );
      forwardOutputs = result.samples.map((sample) => voltage(net, sample, b));
      forwardCurrents = result.samples.map((sample) => sample.currents.R1);
    }
    if (!reversed) ripple.push(maximum - minimum);
    workload.push({
      capacitance,
      reversed,
      samples: result.samples.length,
      minimum,
      maximum,
      ripple: maximum - minimum,
      maximumShockleyResidual,
      maximumLoadLineResidual: capacitance ? null : maximumLoadLineResidual,
      maximumKclResidual,
      maximumMirrorVoltageError: reversed ? maximumMirrorVoltageError : null,
      maximumMirrorCurrentError: reversed ? maximumMirrorCurrentError : null,
    });
  }
  assert.ok(
    ripple[1] < ripple[0] * 0.9,
    "10 uF reduces ripple compared with no capacitor",
  );
  assert.ok(ripple[2] < ripple[1] * 0.6, "47 uF further reduces ripple");
  t.diagnostic(
    `Workload: 5 V / 50 Hz half-wave into 1 kOhm, C=[0,10,47] uF plus electrically reversed no-capacitor diode; 10 periods, dt=50 us, every sample checked, final-period ripple; Shockley/load-line tolerance=${NONLINEAR_CURRENT_ATOL} A + ${NONLINEAR_CURRENT_RTOL}*max(abs(I),abs(reference)), KCL tolerance=${NONLINEAR_CURRENT_ATOL} A + ${NONLINEAR_CURRENT_RTOL}*sum(abs(incident currents)); mirror voltage atol=1e-7 V; ${JSON.stringify(workload)}`,
  );
});

test("scheduled switching lands on off-grid events, preserves voltage continuity, reproduces results and converges with dt", (t) => {
  const events = [0.001037, 0.003083, 0.004119];
  const errors: number[] = [];
  const workload: object[] = [];
  for (const timestep of [0.00008, 0.00004, 0.00002]) {
    const doc = examples.find((e) => e.id === "switched-rc")!.create();
    const sw = doc.components.find((c) => c.id === "S1")!;
    sw.switch.toggles = events;
    doc.settings.timestep = timestep;
    doc.settings.tolerance = 1e-9;
    const before = structuredClone(doc);
    const net = buildNetlist(doc);
    const progress: number[] = [];
    const result = solveTransient(net, doc.settings, (fraction) =>
      progress.push(fraction),
    );
    const repeat = solveTransient(net, doc.settings);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 1);
    progress.forEach((fraction, i) =>
      assert.ok(
        fraction >= 0 && fraction <= 1 && (!i || fraction >= progress[i - 1]),
        "progress is monotonic and bounded",
      ),
    );
    assert.equal(result.steps, result.samples.length - 1);
    result.samples.forEach((sample, i) =>
      assert.ok(
        !i || sample.time > result.samples[i - 1].time,
        "sample times increase strictly",
      ),
    );
    assert.deepEqual(
      result.samples,
      repeat.samples,
      "re-running the same netlist must not retain history",
    );
    assert.deepEqual(
      doc,
      before,
      "simulation must not change switch state or component initial conditions",
    );
    for (const event of events) {
      const index = result.samples.findIndex(
        (s) => Math.abs(s.time - event) < 1e-12,
      );
      assert.ok(index > 0, `Missing exact switch event at ${event}`);
      const sample = result.samples[index],
        previous = result.samples[index - 1];
      const jump = Math.abs(
        voltage(net, sample, pin("C1", 0)) -
          voltage(net, previous, pin("C1", 0)),
      );
      assert.ok(
        jump <=
          (5 / ((1000 + sw.switch.ron) * 1e-6)) *
            (sample.time - previous.time) +
            1e-7,
        "capacitor voltage must not jump at a toggle",
      );
    }
    let maximumError = 0;
    for (const sample of result.samples) {
      let expected = 0,
        start = 0,
        closed = false;
      for (const end of [
        ...events.filter((e) => e < sample.time),
        sample.time,
      ]) {
        const resistance = 1000 + (closed ? sw.switch.ron : sw.switch.roff);
        expected =
          5 + (expected - 5) * Math.exp(-(end - start) / (resistance * 1e-6));
        start = end;
        closed = !closed;
      }
      maximumError = Math.max(
        maximumError,
        Math.abs(voltage(net, sample, pin("C1", 0)) - expected),
      );
      kcl(net, sample, 2e-7);
    }
    errors.push(maximumError);
    workload.push({
      timestep,
      steps: result.steps,
      samples: result.samples.length,
      maximumError,
    });
  }
  assert.ok(
    errors[1] < errors[0] * 0.8,
    `halving dt must reduce error: ${errors}`,
  );
  assert.ok(
    errors[2] < errors[1] * 0.8,
    `halving dt again must reduce error: ${errors}`,
  );
  assert.ok(errors[2] < 0.06, `fine-grid voltage error ${errors[2]} V`);
  t.diagnostic(
    `Workload: 5 V, 1 kOhm, 1 uF, ron=0.1 Ohm, roff=1 GOhm; off-grid toggles=${JSON.stringify(events)} s; 3 timesteps x 2 identical runs, exact piecewise-exponential reference; ${JSON.stringify(workload)}`,
  );
});

test("ground, floating, singular source constraints and incompatible initial conditions fail instead of yielding NaN", (t) => {
  const failures: [string, CircuitDocument, boolean, RegExp][] = [];
  const noGround = emptyDocument();
  noGround.components.push(createComponent("resistor", "R1", 0, 0));
  failures.push([
    "missing ground",
    noGround,
    false,
    /Missing ground:.*ground component.*connected/,
  ]);
  const floating = defaultExample();
  floating.components.push(createComponent("resistor", "RFLOAT", 700, 700));
  failures.push([
    "floating island",
    floating,
    false,
    /Floating net\(s\):.+No (DC )?path to ground/,
  ]);
  for (const voltage2 of [1, 2]) {
    const f = fixture();
    const a = f.node("NA");
    f.part("voltage", "V1", 1, a, f.ground);
    f.part("voltage", "V2", voltage2, a, f.ground);
    f.part("resistor", "R1", 1000, a, f.ground);
    failures.push([
      voltage2 === 1
        ? "singular parallel equal voltage sources"
        : "conflicting voltage sources",
      f.doc,
      false,
      voltage2 === 1
        ? /Singular circuit: redundant ideal.*V2.*not uniquely determined/
        : /Conflicting voltage sources.*V2.*mismatch/,
    ]);
  }
  {
    const f = fixture();
    f.part("voltage", "V1", 1, f.ground, f.ground);
    failures.push([
      "shorted voltage source",
      f.doc,
      false,
      /Conflicting voltage sources.*V1.*mismatch/,
    ]);
  }
  {
    const f = fixture();
    const a = f.node("NA");
    f.part("voltage", "V1", 5, a, f.ground);
    f.part("capacitor", "C1", 1e-6, a, f.ground).initial = 0;
    failures.push([
      "capacitor IC conflicts with ideal source",
      f.doc,
      true,
      /Conflicting.*capacitor initial conditions.*C1.*mismatch/,
    ]);
  }
  {
    const f = fixture();
    const a = f.node("NA");
    f.part("resistor", "R1", 1000, a, f.ground);
    f.part("capacitor", "C1", 1e-6, a, f.ground).initial = 1;
    f.part("capacitor", "C2", 2e-6, a, f.ground).initial = 2;
    failures.push([
      "parallel capacitor IC conflict",
      f.doc,
      true,
      /Conflicting.*capacitor initial conditions.*C2.*mismatch/,
    ]);
  }
  {
    const f = fixture();
    const a = f.node("NA"),
      b = f.node("NB");
    f.part("resistor", "R1", 1000, a, f.ground);
    f.part("inductor", "L1", 0.01, a, b).initial = 0.001;
    f.part("inductor", "L2", 0.01, b, f.ground).initial = -0.002;
    failures.push([
      "series inductor IC conflict",
      f.doc,
      true,
      /Conflicting inductor initial conditions\/current sources: KCL imbalance/,
    ]);
  }
  for (const [name, doc, transient, pattern] of failures) {
    const net = buildNetlist(validateDocument(doc));
    if (!transient) assert.throws(() => solveDC(net), pattern, `${name} (DC)`);
    assert.throws(
      () => solveTransient(net, doc.settings),
      pattern,
      `${name} (transient)`,
    );
  }
  t.diagnostic(
    `Workload: ${failures.length} invalid physical systems: ${failures.map(([name]) => name).join("; ")}.`,
  );
});
