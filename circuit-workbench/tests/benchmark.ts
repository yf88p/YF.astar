import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createComponent, emptyDocument, validateDocument } from "../src/model";
import { buildNetlist } from "../src/netlist";
import { solveDC, solveTransient } from "../src/solver";
import { endpointKey, junction, pin } from "../src/types";
import type { ComponentType, Endpoint } from "../src/types";

const doc = emptyDocument();
doc.title = "Connected 30-stage RC ladder benchmark";
doc.components.push(createComponent("ground", "GND", 80, 400));
const ground = pin("GND", 0);
const stages = 30;
const nodes = Array.from({ length: stages + 1 }, (_, i) => {
  doc.junctions.push({ id: `N${i}`, x: 80 + i * 100, y: 120 });
  return junction(`N${i}`);
});
function part(
  type: ComponentType,
  id: string,
  value: number,
  a: Endpoint,
  b: Endpoint,
) {
  const component = createComponent(
    type,
    id,
    80 + doc.components.length * 40,
    240,
  );
  component.value = value;
  doc.components.push(component);
  doc.wires.push(
    { id: `WA${id}`, a, b: pin(id, 0), bends: [] },
    { id: `WB${id}`, a: pin(id, 1), b, bends: [] },
  );
}
part("voltage", "V1", 5, nodes[0], ground);
for (let i = 1; i <= stages; i++) {
  part("resistor", `RS${i}`, 100 + ((i * 37) % 400), nodes[i - 1], nodes[i]);
  part("resistor", `RP${i}`, 1000 + ((i * 113) % 4000), nodes[i], ground);
  if (i % 2 === 0)
    part("capacitor", `C${i}`, (1 + (i % 5)) * 1e-6, nodes[i], ground);
}
doc.settings = {
  duration: 0.005,
  timestep: 0.000005,
  tolerance: 1e-8,
  initialization: "explicit",
};
const validationStart = performance.now();
const validated = validateDocument(doc);
const validationMs = performance.now() - validationStart;
const netlistStart = performance.now();
const net = buildNetlist(validated);
const netlistMs = performance.now() - netlistStart;
assert.ok(doc.components.length >= 50);
assert.equal(net.branches.length, doc.components.length - 1);
assert.equal(
  net.nets.length,
  stages + 2,
  "all ladder endpoints must be connected to the intended circuit",
);

solveDC(net);
solveTransient(net, doc.settings);
const dcRuns = 20;
const dcTimes: number[] = [];
let outputDC = 0;
for (let run = 0; run < dcRuns; run++) {
  const start = performance.now();
  const solution = solveDC(net);
  dcTimes.push(performance.now() - start);
  outputDC = solution.voltages[net.endpointNets[endpointKey(nodes.at(-1)!)]];
  assert.ok(Number.isFinite(outputDC) && outputDC > 0 && outputDC < 5);
}
const transientStart = performance.now();
const transient = solveTransient(net, doc.settings);
const transientMs = performance.now() - transientStart;
for (const sample of transient.samples) {
  for (const value of Object.values(sample.voltages))
    assert.ok(Number.isFinite(value));
  for (const value of Object.values(sample.currents))
    assert.ok(Number.isFinite(value));
}
assert.equal(transient.samples[0].time, 0);
assert.ok(
  Math.abs(transient.samples.at(-1)!.time - doc.settings.duration) < 1e-12,
);
const sortedDC = [...dcTimes].sort((a, b) => a - b);
const round = (value: number) => Number(value.toFixed(3));
console.log(
  JSON.stringify(
    {
      benchmark: "connected-rc-ladder",
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      workload: {
        stages,
        components: doc.components.length,
        resistors: 60,
        capacitors: 15,
        voltageSources: 1,
        grounds: 1,
        wires: doc.wires.length,
        nets: net.nets.length,
        branches: net.branches.length,
        values:
          "Rseries(i)=100+(37*i mod 400) Ohm; Rshunt(i)=1000+(113*i mod 4000) Ohm; C(even i)=(1+i mod 5) uF",
        warmupDCRuns: 1,
        warmupTransientRuns: 1,
        measuredDCRuns: dcRuns,
        measuredTransientRuns: 1,
        ...doc.settings,
        nominalTimesteps: Math.round(
          doc.settings.duration / doc.settings.timestep,
        ),
        actualSteps: transient.steps,
        samples: transient.samples.length,
      },
      timingsMs: {
        validation: round(validationMs),
        netlist: round(netlistMs),
        dcTotal: round(dcTimes.reduce((a, b) => a + b, 0)),
        dcMedian: round((sortedDC[9] + sortedDC[10]) / 2),
        dcMin: round(sortedDC[0]),
        dcMax: round(sortedDC.at(-1)!),
        transientWall: round(transientMs),
        transientReported: round(transient.elapsedMs),
        transientPerStep: round(transientMs / transient.steps),
      },
      checks: {
        finiteSamples: true,
        outputDCVolts: outputDC,
        finalTimeSeconds: transient.samples.at(-1)!.time,
      },
    },
    null,
    2,
  ),
);
