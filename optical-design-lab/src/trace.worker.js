import { traceProject, focusScan } from "./optics.js";

// Work is synchronous inside this isolated module worker. Cancellation is by
// terminating the worker; request ids let the UI discard stale responses.
self.onmessage = ({ data }) => {
  const { id, type, project, detectorId, range, options } = data ?? {};
  try {
    let result;
    if (type === "trace") result = traceProject(project, options ?? {});
    else if (type === "focus") result = focusScan(project, detectorId, range);
    else throw new Error(`Unknown worker request type: ${type}`);
    self.postMessage({ id, type, result });
  } catch (error) {
    self.postMessage({
      id,
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
