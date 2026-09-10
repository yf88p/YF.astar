import { buildNetlist } from "./netlist";
import { solveDC, solveTransient } from "./solver";
import { validateDocument } from "./model";
import type { CircuitDocument } from "./types";

self.onmessage = ({
  data,
}: MessageEvent<{
  doc: CircuitDocument;
  mode: "dc" | "transient";
  revision: number;
}>) => {
  try {
    const doc = validateDocument(data.doc);
    const netlist = buildNetlist(doc);
    const started = performance.now();
    let last = 0;
    const result =
      data.mode === "dc"
        ? solveDC(netlist)
        : solveTransient(netlist, doc.settings, (fraction) => {
            if (performance.now() - last > 70 || fraction === 1) {
              self.postMessage({
                type: "progress",
                fraction,
                revision: data.revision,
              });
              last = performance.now();
            }
          });
    self.postMessage({
      type: "result",
      mode: data.mode,
      result,
      netlist,
      elapsed: performance.now() - started,
      revision: data.revision,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      revision: data.revision,
    });
  }
};
