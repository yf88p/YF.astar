import assert from "node:assert/strict";
import test from "node:test";
import { createComponent, emptyDocument, validateDocument } from "../src/model";
import { buildNetlist } from "../src/netlist";
import {
  NUMERICS,
  solveDC,
  solveTransient,
  waveformValue,
} from "../src/solver";
import { pin } from "../src/types";
import type { ComponentType, Netlist, Settings, Solution } from "../src/types";

const SETTINGS: Settings = {
  duration: 0.001,
  timestep: 0.00007,
  tolerance: 1e-9,
  initialization: "explicit",
};

function circuit(specs: [ComponentType, string, string, string, number][]) {
  const doc = emptyDocument();
  doc.components.push(createComponent("ground", "GND", 0, 0));
  const nodes = new Map([["0", pin("GND", 0)]]);
  for (const [type, id, a, b, value] of specs) {
    const component = createComponent(type, id, 0, 0);
    component.value = value;
    doc.components.push(component);
    for (const [node, index] of [
      [a, 0],
      [b, 1],
    ] as const) {
      const endpoint = pin(id, index);
      if (nodes.has(node))
        doc.wires.push({
          id: `W${doc.wires.length}`,
          a: endpoint,
          b: nodes.get(node)!,
          bends: [],
        });
      else nodes.set(node, endpoint);
    }
  }
  doc.settings = { ...SETTINGS };
  return doc;
}

function close(
  actual: number,
  expected: number,
  tolerance: number,
  context: string,
) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${context}: got ${actual}, expected ${expected}, atol=${tolerance}`,
  );
}

function drop(net: Netlist, sample: Solution, id: string) {
  return (
    sample.voltages[net.endpointNets[`${id}:0`]] -
    sample.voltages[net.endpointNets[`${id}:1`]]
  );
}

function kcl(net: Netlist, sample: Solution) {
  for (const node of net.nets) {
    let residual = 0,
      scale = 0;
    for (const branch of net.branches) {
      const current = sample.currents[branch.component.id];
      assert.ok(
        Number.isFinite(current),
        `${branch.component.id}: finite current`,
      );
      if (branch.nodeA === node.id) {
        residual += current;
        scale += Math.abs(current);
      }
      if (branch.nodeB === node.id) {
        residual -= current;
        scale += Math.abs(current);
      }
    }
    close(
      residual,
      0,
      1e-10 + 1e-6 * scale,
      `KCL ${node.id} at t=${sample.time}`,
    );
  }
}

test("voltage/current pulse sources land exactly on repeated ramp corners and zero-rise/fall boundaries", (t) => {
  let checkedBoundaries = 0;
  for (const kind of ["voltage", "current"] as const) {
    for (const [rise, fall] of [
      [0, 0],
      [0.000021, 0.000031],
      [0, 0.000031],
      [0.000021, 0],
    ]) {
      const doc = circuit([
        [kind, "S", "a", "0", -3],
        ["resistor", "R", "a", "0", 1000],
      ]);
      const source = doc.components.find((c) => c.id === "S")!;
      const unit = kind === "voltage" ? 1 : 0.001;
      const delay = 0.000123,
        width = 0.00019,
        period = 0.000333;
      Object.assign(source.waveform, {
        type: "pulse",
        offset: unit,
        amplitude: 4 * unit,
        delay,
        rise,
        width,
        fall,
        period,
      });
      doc.settings.duration = delay + 2 * period + (rise + width + fall);
      const net = buildNetlist(validateDocument(doc));
      const result = solveTransient(net, doc.settings);
      assert.equal(result.samples[0].time, 0);
      assert.equal(result.samples.at(-1)!.time, doc.settings.duration);
      assert.equal(result.steps, result.samples.length - 1);
      result.samples.forEach((sample, i) => {
        assert.ok(
          !i || sample.time > result.samples[i - 1].time,
          "strictly increasing, no duplicate corner samples",
        );
        kcl(net, sample);
      });
      const boundaries = new Map<number, number>([[0, unit]]);
      for (let cycle = 0; cycle < 3; cycle++) {
        const start = delay + cycle * period;
        boundaries.set(start, rise ? unit : 5 * unit);
        boundaries.set(start + rise, 5 * unit);
        boundaries.set(start + (rise + width), fall ? 5 * unit : unit);
        boundaries.set(start + (rise + width + fall), unit);
        const epsilon = 1e-10;
        close(
          waveformValue(source, start - epsilon),
          unit,
          1e-12,
          `${kind} before pulse rise`,
        );
        close(
          waveformValue(source, start + rise / 2),
          (rise ? 3 : 5) * unit,
          1e-12,
          `${kind} rise midpoint`,
        );
        close(
          waveformValue(source, start + rise + width / 2),
          5 * unit,
          1e-12,
          `${kind} high plateau`,
        );
        close(
          waveformValue(source, start + rise + width + fall / 2),
          (fall ? 3 : 1) * unit,
          1e-12,
          `${kind} fall midpoint/right limit`,
        );
        if (!rise)
          close(
            waveformValue(source, start + epsilon),
            5 * unit,
            1e-12,
            `${kind} after instantaneous rise`,
          );
        if (!fall)
          close(
            waveformValue(source, start + rise + width - epsilon),
            5 * unit,
            1e-12,
            `${kind} before instantaneous fall`,
          );
      }
      for (const [time, expected] of boundaries) {
        const sample = result.samples.find((sample) => sample.time === time);
        assert.ok(
          sample,
          `${kind}, rise=${rise}, fall=${fall}: missing exact t=${time}`,
        );
        close(
          waveformValue(source, time),
          expected,
          1e-12,
          `${kind} waveform boundary at ${time}`,
        );
        close(
          kind === "voltage" ? drop(net, sample, "S") : sample.currents.S,
          expected,
          1e-12,
          `${kind} solved source boundary`,
        );
        close(
          sample.currents.R,
          (kind === "voltage" ? 1 / 1000 : -1) * expected,
          1e-12,
          `${kind} load current sign`,
        );
        checkedBoundaries++;
      }
    }
  }
  t.diagnostic(
    `8 resistive source cases; ${checkedBoundaries} exact t=0/repeated pulse/final boundaries; source/load atol=1e-12, all-sample KCL=1e-10 A + 1e-6*sum(abs(currents)).`,
  );
});

test("delayed sine is right-continuous at t=0/off-grid delay/final time for both source kinds", (t) => {
  for (const kind of ["voltage", "current"] as const) {
    for (const delay of [0, 0.000123, SETTINGS.duration]) {
      const unit = kind === "voltage" ? 1 : 0.001;
      const doc = circuit([
        [kind, "S", "a", "0", -3 * unit],
        ["resistor", "R", "a", "0", 1000],
      ]);
      const source = doc.components.find((c) => c.id === "S")!;
      Object.assign(source.waveform, {
        type: "sine",
        offset: unit,
        amplitude: 2 * unit,
        frequency: 100,
        phase: 90,
        delay,
      });
      const net = buildNetlist(doc);
      for (const initialization of ["explicit", "dc"] as const) {
        const result = solveTransient(net, { ...doc.settings, initialization });
        assert.ok(
          result.samples.some((sample) => sample.time === delay),
          `exact ${kind} delay=${delay}`,
        );
        assert.equal(result.samples.at(-1)!.time, doc.settings.duration);
        for (const sample of result.samples) {
          const expected =
            sample.time < delay
              ? unit
              : unit +
                2 * unit * Math.cos(2 * Math.PI * 100 * (sample.time - delay));
          close(
            waveformValue(source, sample.time),
            expected,
            1e-12,
            `${kind} independent delayed cosine reference`,
          );
          close(
            kind === "voltage" ? drop(net, sample, "S") : sample.currents.S,
            expected,
            1e-12,
            `${kind} transient ${initialization}`,
          );
          kcl(net, sample);
        }
      }
      const dc = solveDC(net);
      close(
        kind === "voltage" ? drop(net, dc, "S") : dc.currents.S,
        -3 * unit,
        1e-12,
        "DC ignores transient waveform",
      );
    }
  }
  t.diagnostic(
    "6 source/delay cases x explicit/DC transient initialization; every sample compared independently; phase=90 degrees tests the delay jump at t=0, off-grid, and duration; DC uses value.",
  );
});

test("off-grid source jumps preserve capacitor state without anticipatory charge for voltage and current drive", (t) => {
  const delay = 0.000123,
    width = 0.000333,
    end = delay + width,
    tau = 0.001;
  const errors: object[] = [];
  for (const kind of ["voltage", "current"] as const) {
    const doc = circuit(
      kind === "voltage"
        ? [
            ["voltage", "S", "a", "0", 0],
            ["resistor", "R", "a", "b", 1000],
            ["capacitor", "C", "b", "0", 1e-6],
          ]
        : [
            ["current", "S", "0", "b", 0],
            ["resistor", "R", "b", "0", 1000],
            ["capacitor", "C", "b", "0", 1e-6],
          ],
    );
    Object.assign(doc.components.find((c) => c.id === "S")!.waveform, {
      type: "pulse",
      offset: 0,
      amplitude: kind === "voltage" ? 5 : 0.005,
      delay,
      rise: 0,
      width,
      fall: 0,
      period: 0.002,
    });
    const net = buildNetlist(doc),
      result = solveTransient(net, doc.settings);
    const rising = result.samples.find((sample) => sample.time === delay)!;
    const falling = result.samples.find((sample) => sample.time === end)!;
    assert.ok(rising && falling, "both off-grid edges included exactly");
    close(drop(net, rising, "C"), 0, 1e-12, "no pre-edge charge");
    close(rising.currents.C, 0.005, 1e-12, "right-limit charging current");
    close(
      falling.currents.C,
      -drop(net, falling, "C") / 1000,
      1e-12,
      "right-limit discharging current",
    );
    let maximumVoltageError = 0;
    for (const sample of result.samples) {
      const expected =
        sample.time <= delay
          ? 0
          : sample.time <= end
            ? 5 * (1 - Math.exp(-(sample.time - delay) / tau))
            : 5 *
              (1 - Math.exp(-width / tau)) *
              Math.exp(-(sample.time - end) / tau);
      const error = Math.abs(drop(net, sample, "C") - expected);
      maximumVoltageError = Math.max(maximumVoltageError, error);
      close(
        drop(net, sample, "C"),
        expected,
        0.001,
        `${kind} piecewise exponential t=${sample.time}`,
      );
      kcl(net, sample);
    }
    assert.deepEqual(
      solveTransient(net, doc.settings).samples,
      result.samples,
      "event state is repeatable",
    );
    errors.push({ kind, samples: result.samples.length, maximumVoltageError });
  }
  t.diagnostic(
    `Pulse RC all-sample voltage atol=0.001 V, dt=70 us, tau=1 ms; ${JSON.stringify(errors)}`,
  );
});

test("switch toggles at t=0, an off-grid event, and duration use right-limit resistance without changing DC state", () => {
  const doc = circuit([
    ["voltage", "V", "a", "0", 5],
    ["switch", "S", "a", "b", 1],
    ["resistor", "R", "b", "0", 1000],
  ]);
  const sw = doc.components.find((c) => c.id === "S")!.switch;
  Object.assign(sw, {
    closed: false,
    ron: 1,
    roff: 1e6,
    toggles: [0, 0.000123, doc.settings.duration],
  });
  const before = structuredClone(doc),
    net = buildNetlist(doc),
    result = solveTransient(net, doc.settings);
  for (const time of sw.toggles)
    assert.ok(
      result.samples.some((sample) => sample.time === time),
      `exact switch event ${time}`,
    );
  for (const sample of result.samples) {
    const closed =
      sw.toggles.filter((time) => time <= sample.time).length % 2 === 1;
    close(
      sample.currents.S,
      5 / (1000 + (closed ? 1 : 1e6)),
      1e-12,
      `switch current t=${sample.time}`,
    );
    kcl(net, sample);
  }
  close(
    solveDC(net).currents.S,
    5 / 1001000,
    1e-12,
    "DC ignores toggles including t=0",
  );
  assert.deepEqual(doc, before);
});

test("parallel capacitors with consistent ICs share physical current; contradictory ICs fail", (t) => {
  const doc = circuit([
    ["voltage", "V", "a", "0", 5],
    ["resistor", "R", "a", "b", 1000],
    ["capacitor", "C1", "b", "0", 1e-6],
    ["capacitor", "C2", "b", "0", 2e-6],
  ]);
  for (const c of doc.components) if (c.type === "capacitor") c.initial = 2;
  const net = buildNetlist(doc),
    result = solveTransient(net, doc.settings);
  close(
    drop(net, result.samples[0], "C1"),
    2,
    1e-12,
    "consistent capacitor voltage",
  );
  close(
    result.samples[0].currents.C1,
    0.001,
    1e-12,
    "C1 initial physical current",
  );
  close(
    result.samples[0].currents.C2,
    0.002,
    1e-12,
    "C2 initial physical current",
  );
  let maximumVoltageError = 0;
  for (const sample of result.samples) {
    const expected = 5 - 3 * Math.exp(-sample.time / 0.003);
    maximumVoltageError = Math.max(
      maximumVoltageError,
      Math.abs(drop(net, sample, "C1") - expected),
    );
    close(
      drop(net, sample, "C1"),
      expected,
      5e-5,
      "equivalent 3 uF exponential",
    );
    close(
      sample.currents.C2,
      2 * sample.currents.C1,
      1e-10,
      "parallel current division by capacitance",
    );
    kcl(net, sample);
  }
  doc.components.find((c) => c.id === "C2")!.initial = 3;
  assert.throws(
    () => solveTransient(buildNetlist(doc), doc.settings),
    /Conflicting.*capacitor initial conditions.*C2.*mismatch.*t=0/,
  );
  t.diagnostic(
    `Parallel C1=1 uF/C2=2 uF, IC=2 V: maximum voltage error=${maximumVoltageError} V, atol=5e-5 V; every-sample 1:2 current division atol=1e-10 A.`,
  );
});

test("consistent series inductors divide voltage by L; contradictory initial currents fail KCL", () => {
  const doc = circuit([
    ["voltage", "V", "a", "0", 5],
    ["inductor", "L1", "a", "b", 0.01],
    ["inductor", "L2", "b", "0", 0.02],
  ]);
  for (const c of doc.components) if (c.type === "inductor") c.initial = -0.01;
  const net = buildNetlist(doc),
    result = solveTransient(net, doc.settings);
  for (const sample of result.samples) {
    close(
      sample.currents.L1,
      -0.01 + (5 / 0.03) * sample.time,
      1e-10,
      "series L1 linear current ramp",
    );
    close(sample.currents.L2, sample.currents.L1, 1e-10, "series L2 current");
    close(drop(net, sample, "L1"), 5 / 3, 1e-9, "L1 voltage division");
    close(drop(net, sample, "L2"), 10 / 3, 1e-9, "L2 voltage division");
    kcl(net, sample);
  }
  doc.components.find((c) => c.id === "L2")!.initial = 0.01;
  assert.throws(
    () => solveTransient(buildNetlist(doc), doc.settings),
    /Conflicting inductor initial conditions\/current sources: KCL imbalance.*t=0/,
  );
});

test("ideal voltage/C and current/L constraints recover derivatives and reject incompatible initial states or jumps", (t) => {
  const failures: string[] = [];
  for (const storage of ["capacitor", "inductor"] as const) {
    const isCap = storage === "capacitor";
    const doc = circuit(
      isCap
        ? [
            ["voltage", "S", "a", "0", 0],
            ["capacitor", "E", "a", "0", 1e-6],
          ]
        : [
            ["current", "S", "0", "a", 0],
            ["inductor", "E", "a", "0", 0.01],
          ],
    );
    const source = doc.components.find((c) => c.id === "S")!;
    const element = doc.components.find((c) => c.id === "E")!;
    const amplitude = isCap ? 1 : 0.001;
    Object.assign(source.waveform, {
      type: "sine",
      offset: 0,
      amplitude,
      frequency: 100,
      phase: 0,
      delay: 0,
    });
    let net = buildNetlist(doc),
      result = solveTransient(net, doc.settings);
    for (const sample of [result.samples[0], result.samples.at(-1)!]) {
      const derivative =
        2 *
        Math.PI *
        100 *
        amplitude *
        Math.cos(2 * Math.PI * 100 * sample.time);
      close(
        isCap ? sample.currents.E : drop(net, sample, "E"),
        element.value * derivative,
        1e-10,
        `${storage} exact source derivative at boundary`,
      );
    }
    result.samples.forEach((sample) => {
      close(
        isCap ? drop(net, sample, "E") : sample.currents.E,
        amplitude * Math.sin(2 * Math.PI * 100 * sample.time),
        1e-10,
        `${storage} source constraint`,
      );
      kcl(net, sample);
    });
    element.initial = amplitude;
    const pattern = isCap
      ? /Conflicting.*capacitor initial conditions/
      : /Conflicting inductor initial conditions\/current sources.*KCL imbalance/;
    assert.throws(
      () => solveTransient(buildNetlist(doc), doc.settings),
      pattern,
      `${storage} incompatible t0`,
    );
    element.initial = 0;
    Object.assign(source.waveform, {
      type: "pulse",
      delay: 0.000123,
      rise: 0,
      fall: 0,
      width: 0.000333,
      period: 0.002,
    });
    net = buildNetlist(doc);
    assert.throws(
      () => solveTransient(net, doc.settings),
      (error) => {
        assert.ok(
          error instanceof Error &&
            pattern.test(error.message) &&
            error.message.includes("t=0.000123"),
          `${storage} must diagnose event impulse: ${error}`,
        );
        failures.push(error.message);
        return true;
      },
    );
    // Continuous ramps are compatible, but their right-limit derivatives change at each corner.
    Object.assign(source.waveform, { rise: 0.000021, fall: 0.000031 });
    net = buildNetlist(doc);
    result = solveTransient(net, doc.settings);
    const w = source.waveform;
    for (const [time, derivative] of [
      [w.delay, amplitude / w.rise],
      [w.delay + w.rise, 0],
      [w.delay + (w.rise + w.width), -amplitude / w.fall],
      [w.delay + (w.rise + w.width + w.fall), 0],
    ]) {
      const sample = result.samples.find((sample) => sample.time === time);
      assert.ok(sample, `${storage} ramp corner t=${time}`);
      close(
        isCap ? sample.currents.E : drop(net, sample, "E"),
        element.value * derivative,
        1e-9,
        `${storage} right-limit ramp derivative`,
      );
      kcl(net, sample);
    }
  }
  t.diagnostic(
    `Both ideal-source/storage duals: sine and pulse-ramp derivatives, consistent and contradictory t0, impulses rejected: ${JSON.stringify(failures)}`,
  );
});

test("Newton nonconvergence throws in DC and after transient progress, never returning success or completion", (t) => {
  const doc = circuit([
    ["voltage", "V", "a", "0", 100],
    ["diode", "D", "a", "0", 0.7],
  ]);
  const messages: string[] = [];
  const check = (error: unknown) => {
    assert.ok(
      error instanceof Error && /Newton nonconvergence.*t=/.test(error.message),
      `must diagnose nonlinear failure: ${error}`,
    );
    messages.push(error.message);
    return true;
  };
  assert.throws(() => solveDC(buildNetlist(doc)), check);
  Object.assign(doc.components.find((c) => c.id === "V")!.waveform, {
    type: "pulse",
    offset: 0,
    amplitude: 100,
    delay: 0.000123,
    rise: 0,
    fall: 0,
    width: 0.000333,
    period: 0.002,
  });
  const net = buildNetlist(doc),
    before = buildNetlist(doc);
  for (let run = 0; run < 2; run++) {
    const progress: number[] = [];
    assert.throws(
      () =>
        solveTransient(net, doc.settings, (fraction) =>
          progress.push(fraction),
        ),
      check,
    );
    assert.equal(progress[0], 0);
    assert.ok(
      progress.some((fraction) => fraction > 0),
      "failure occurs after accepted transient steps",
    );
    assert.ok(
      progress.every((fraction) => fraction < 1),
      "failed solve must never publish completion",
    );
  }
  assert.equal(
    messages[1],
    messages[2],
    "deterministic nonconvergence diagnostics",
  );
  assert.deepEqual(net, before, "failure does not mutate input");
  t.diagnostic(
    `Unrepresentable forward Shockley current under 100 V ideal drive; explicit failures: ${JSON.stringify(messages)}`,
  );
});

test("step, event, stored-scalar and MNA bounds are deterministic and reject before simulation progress", (t) => {
  assert.equal(NUMERICS.maxSteps, 100_000);
  assert.equal(NUMERICS.maxStoredScalars, 2_000_000);
  assert.equal(NUMERICS.maxUnknowns, 150);
  const failures: object[] = [];
  const reject = (
    name: string,
    net: Netlist,
    settings: Settings,
    pattern: RegExp,
  ) => {
    const messages: string[] = [];
    for (let run = 0; run < 2; run++) {
      const progress: number[] = [];
      assert.throws(
        () => solveTransient(net, settings, (value) => progress.push(value)),
        (error) => {
          assert.ok(
            error instanceof Error && pattern.test(error.message),
            `${name}: ${error}`,
          );
          messages.push(error.message);
          return true;
        },
      );
      assert.deepEqual(
        progress,
        [],
        `${name}: preflight before samples/progress`,
      );
    }
    assert.equal(messages[0], messages[1]);
    failures.push({ name, message: messages[0] });
  };
  const small = circuit([["resistor", "R", "a", "0", 1000]]);
  const smallNet = buildNetlist(small);
  const exactSteps = solveTransient(smallNet, {
    ...SETTINGS,
    duration: 1,
    timestep: 1 / 100_000,
  });
  assert.equal(exactSteps.steps, 100_000);
  assert.equal(exactSteps.samples.length, 100_001);
  assert.equal(exactSteps.samples.at(-1)!.time, 1);
  reject(
    "one nominal step over",
    smallNet,
    { ...SETTINGS, duration: 1, timestep: 1 / 100_001 },
    /exceeds 100000 steps or 2000000 stored scalar/,
  );

  const eventDoc = circuit([["switch", "S", "a", "0", 1]]);
  eventDoc.components.find((c) => c.id === "S")!.switch.toggles = [0.000005];
  reject(
    "event splits an otherwise exact-limit grid",
    buildNetlist(eventDoc),
    { ...SETTINGS, duration: 1, timestep: 0.00001 },
    /exceeds.*steps.*stored scalar/,
  );
  const pulseDoc = circuit([
    ["voltage", "V", "a", "0", 0],
    ["resistor", "R", "a", "0", 1000],
  ]);
  Object.assign(pulseDoc.components.find((c) => c.id === "V")!.waveform, {
    type: "pulse",
    delay: 0,
    rise: 0,
    fall: 0,
    width: 1e-9,
    period: 1e-8,
  });
  reject(
    "pulse cycle preflight",
    buildNetlist(pulseDoc),
    { ...SETTINGS, duration: 1, timestep: 1 },
    /Pulse V.*event-aligned steps/,
  );

  // Parallel branches keep the matrix tiny while exercising the real sample-storage boundary.
  const memoryDoc = circuit(
    Array.from({ length: 16 }, (_, i) => ["resistor", `R${i}`, "a", "0", 1000]),
  );
  const memoryNet = buildNetlist(memoryDoc);
  const scalarsPerSample =
    memoryNet.nets.length + memoryNet.branches.length + 2;
  assert.equal(scalarsPerSample, 20);
  const atMemoryLimit = solveTransient(memoryNet, {
    ...SETTINGS,
    duration: 1,
    timestep: 1 / 99_999,
  });
  assert.equal(atMemoryLimit.samples.length * scalarsPerSample, 2_000_000);
  reject(
    "one sample over stored-scalar limit",
    memoryNet,
    { ...SETTINGS, duration: 1, timestep: 1 / 100_000 },
    /exceeds.*2000000 stored scalar/,
  );

  const mnaDoc = circuit(
    Array.from({ length: 150 }, (_, i) => [
      "resistor",
      `R${i}`,
      `a${i}`,
      "0",
      1000,
    ]),
  );
  const mnaNet = buildNetlist(mnaDoc);
  const dc = solveDC(mnaNet);
  assert.equal(Object.keys(dc.voltages).length - 1, 150);
  assert.ok(Object.values(dc.voltages).every((value) => value === 0));
  assert.equal(
    solveTransient(mnaNet, { ...SETTINGS, timestep: SETTINGS.duration }).steps,
    1,
  );
  const overMna = buildNetlist(
    circuit(
      Array.from({ length: 151 }, (_, i) => [
        "resistor",
        `R${i}`,
        `a${i}`,
        "0",
        1000,
      ]),
    ),
  );
  assert.throws(
    () => solveDC(overMna),
    /MNA size 151 exceeds the 150-unknown limit/,
  );
  reject(
    "151 MNA unknowns",
    overMna,
    SETTINGS,
    /MNA size 151 exceeds the 150-unknown limit/,
  );
  const initialDoc = circuit([
    ["resistor", "R", "a", "0", 1000],
    ...Array.from(
      { length: 149 },
      (_, i): [ComponentType, string, string, string, number] => [
        "capacitor",
        `C${i}`,
        "a",
        "0",
        1e-6,
      ],
    ),
  ]);
  assert.equal(
    solveTransient(buildNetlist(initialDoc), {
      ...SETTINGS,
      timestep: SETTINGS.duration,
    }).steps,
    1,
    "150 initialization unknowns including capacitor constraints accepted",
  );
  const extra = createComponent("capacitor", "C149", 0, 0);
  initialDoc.components.push(extra);
  initialDoc.wires.push(
    { id: "EXTRA0", a: pin(extra.id, 0), b: pin("R", 0), bends: [] },
    { id: "EXTRA1", a: pin(extra.id, 1), b: pin("GND", 0), bends: [] },
  );
  reject(
    "151 initialization unknowns",
    buildNetlist(initialDoc),
    SETTINGS,
    /Initialization MNA size 151.*150-unknown limit.*capacitor IC constraints/,
  );
  t.diagnostic(
    `Accepted exact bounds: 100000 steps, 2000000 stored scalars, 150 DC/transient MNA unknowns, 150 initialization unknowns; 6 rejection cases x 2 repeat runs: ${JSON.stringify(failures)}`,
  );
});
