import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Viewer, { VIEWER_CSS } from "./Viewer.jsx";
import { validateProject } from "./core.js";

const MAX_BYTES = 50 * 1024 * 1024;

function Message({ error, retry }) {
  return (
    <main className="folia-viewer fv-loading">
      <style>{VIEWER_CSS}</style>
      <section
        className="fv-load-card"
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        <span className="fv-brand">folia</span>
        <h1>
          {error ? "This story could not open." : "A world is unfolding."}
        </h1>
        <p>
          {error ||
            "Opening the story and its embedded artwork. Just a moment."}
        </p>
        {error && (
          <>
            <p>
              Keep project.json beside this viewer and serve the folder over
              HTTP or HTTPS. Check that the file is a valid Folia project, no
              larger than 50 MB.
            </p>
            <button className="fv-primary" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </section>
    </main>
  );
}

class ViewerBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The story could not be displayed.",
    };
  }
  render() {
    return this.state.error ? (
      <Message
        error={`Unable to display this project: ${this.state.error}`}
        retry={this.props.retry}
      />
    ) : (
      this.props.children
    );
  }
}

function Portable() {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ project: null, error: null });
  const retry = () => {
    setResult({ project: null, error: null });
    setAttempt((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45000);
    async function load() {
      try {
        if (location.protocol === "file:")
          throw new Error(
            "Browsers cannot fetch project.json from a file:// page. Open this folder through a local web server or publish it to a static host.",
          );
        const response = await fetch("./project.json", {
          signal: controller.signal,
          cache: "no-cache",
        });
        if (!response.ok)
          throw new Error(
            `Could not fetch project.json (HTTP ${response.status} ${response.statusText}).`,
          );
        if (Number(response.headers.get("content-length")) > MAX_BYTES) {
          controller.abort();
          throw new Error("project.json exceeds the 50 MB download limit.");
        }
        // Count actual streamed bytes as well: Content-Length may be absent or describe compressed data.
        let text;
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          const parts = [];
          let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_BYTES) {
                controller.abort();
                throw new Error(
                  "project.json exceeds the 50 MB download limit.",
                );
              }
              parts.push(decoder.decode(value, { stream: true }));
            }
            parts.push(decoder.decode());
            text = parts.join("");
          } finally {
            reader.releaseLock();
          }
        } else {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > MAX_BYTES)
            throw new Error("project.json exceeds the 50 MB download limit.");
          text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        }
        let input;
        try {
          input = JSON.parse(text);
        } catch {
          throw new Error(
            "project.json is not valid JSON. It may be incomplete, or the server may have returned an HTML page instead.",
          );
        }
        const project = validateProject(input);
        if (!disposed) {
          document.title = `${project.name || "Untitled story"} | Folia`;
          setResult({ project, error: null });
        }
      } catch (error) {
        controller.abort();
        if (!disposed)
          setResult({
            project: null,
            error: timedOut
              ? "Loading project.json timed out after 45 seconds. Check your connection and try again."
              : error instanceof Error
                ? error.message
                : "An unexpected error occurred while opening project.json.",
          });
      } finally {
        clearTimeout(timeout);
      }
    }
    load();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return result.project ? (
    <ViewerBoundary key={attempt} retry={retry}>
      <Viewer project={result.project} />
    </ViewerBoundary>
  ) : (
    <Message error={result.error} retry={retry} />
  );
}

let container = document.getElementById("root");
if (!container) {
  container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
}
createRoot(container).render(<Portable />);
