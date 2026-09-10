import JSZip from "jszip";
import { uid, validateProject } from "./core.js";

const MAX_PROJECT_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

async function projectRequest(mode, operation) {
  let database;
  try {
    database = await new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        throw new Error(
          "IndexedDB is unavailable. Enable browser storage to use saved projects.",
        );
      }
      const request = globalThis.indexedDB.open("atlas-projects", 1);
      let abandoned = false;
      let upgradeError;
      request.onblocked = () => {
        abandoned = true;
        reject(
          new Error(
            "Project storage is blocked by another tab. Close other Atlas tabs and try again.",
          ),
        );
      };
      request.onupgradeneeded = () => {
        if (abandoned) {
          request.transaction.abort();
          return;
        }
        try {
          if (!request.result.objectStoreNames.contains("projects")) {
            request.result.createObjectStore("projects", { keyPath: "id" });
          }
        } catch (error) {
          upgradeError = error;
          request.transaction.abort();
        }
      };
      request.onerror = () =>
        reject(
          upgradeError ??
            request.error ??
            new Error("Could not open the project database."),
        );
      request.onsuccess = () => {
        const connection = request.result;
        if (abandoned) {
          connection.close();
          return;
        }
        connection.onversionchange = () => connection.close();
        resolve(connection);
      };
    });

    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("projects", mode);
      let result;
      let succeeded = false;
      let failure;
      // A successful request is not a committed write: wait for the transaction too.
      transaction.oncomplete = () => {
        if (failure) reject(failure);
        else if (!succeeded)
          reject(new Error("The project storage request did not finish."));
        else resolve(result);
      };
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            new Error("The project storage transaction was aborted."),
        );
      transaction.onerror = (event) => {
        failure ??= event.target.error ?? transaction.error;
      };
      try {
        const request = operation(transaction.objectStore("projects"));
        request.onsuccess = () => {
          result = request.result;
          succeeded = true;
        };
        request.onerror = () => {
          failure =
            request.error ?? new Error("The project storage request failed.");
        };
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  } catch (error) {
    let message =
      error?.message || "The browser could not access the project database.";
    if (error?.name === "QuotaExceededError") {
      message =
        "Browser storage is full (quota exceeded). Export a backup, then free space and try saving again.";
    } else if (
      ["SecurityError", "NotAllowedError", "InvalidStateError"].includes(
        error?.name,
      )
    ) {
      message =
        "Browser project storage is unavailable or disabled. Check browser permissions and try again.";
    }
    throw new Error(`Project storage: ${message}`, { cause: error });
  } finally {
    database?.close();
  }
}

export async function listProjects() {
  const projects = await projectRequest("readonly", (store) => store.getAll());
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      nodeCount: project.nodes.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project) {
  const document = validateProject(project);
  await projectRequest("readwrite", (store) =>
    store.put({ ...document, updatedAt: Date.now() }),
  );
}

export async function loadProject(id) {
  const project = await projectRequest("readonly", (store) => store.get(id));
  if (project === undefined)
    throw new Error("Project not found. It may have been removed.");
  return validateProject(project);
}

export async function removeProject(id) {
  await projectRequest("readwrite", (store) => store.delete(id));
}

function projectFile(project) {
  const document = validateProject(project);
  const json = JSON.stringify(document, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  if (blob.size > MAX_PROJECT_BYTES)
    throw new Error(
      "Project JSON exceeds the 50MB limit. Remove some content or assets and try again.",
    );
  return { document, json, blob };
}

function filename(name) {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
      .trim()
      .slice(0, 100)
      .replace(/[. ]+$/g, "") || "project"
  );
}

export function downloadBlob(blob, name) {
  if (
    !globalThis.document?.body ||
    typeof globalThis.URL?.createObjectURL !== "function"
  ) {
    throw new Error(
      "Downloads are unavailable in this environment. Use a browser to download this file.",
    );
  }
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the URL alive long enough for the browser to begin large downloads.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function exportProject(project) {
  const { document, blob } = projectFile(project);
  downloadBlob(blob, `${filename(document.name)}.atlas`);
}

export async function importProject(file) {
  if (
    !file ||
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    typeof file.text !== "function"
  ) {
    throw new Error("Choose an .atlas project JSON file to import.");
  }
  if (file.size > MAX_PROJECT_BYTES)
    throw new Error("Project files must be no larger than 50MB.");
  let json;
  try {
    json = await file.text();
  } catch (error) {
    throw new Error(
      "Could not read the project file. Select it again and retry.",
      { cause: error },
    );
  }
  if (new Blob([json]).size > MAX_PROJECT_BYTES)
    throw new Error("Project JSON exceeds the 50MB limit.");
  let project;
  try {
    project = JSON.parse(json);
  } catch (error) {
    throw new Error("The project file does not contain valid JSON.", {
      cause: error,
    });
  }
  return validateProject(project);
}

export async function importImage(file) {
  if (!file || !IMAGE_TYPES.has(file.type)) {
    throw new Error(
      "Only PNG, JPEG, and WebP image imports are allowed. SVG imports are not supported.",
    );
  }
  if (!Number.isFinite(file.size) || file.size <= 0)
    throw new Error("The image file is empty or invalid.");
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("Images must be no larger than 12MB.");
  const mime = file.type;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(
        new Error("Could not read the image file.", { cause: reader.error }),
      );
    reader.onabort = () =>
      reject(new Error("Reading the image file was cancelled."));
    reader.readAsDataURL(file);
  });
  const prefix = `data:${mime};base64,`;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix))
    throw new Error("The image file has an invalid data URL.");
  // Check signatures before decoding so a renamed SVG or other format cannot slip through.
  const header = atob(dataUrl.slice(prefix.length, prefix.length + 16));
  const matchesMime =
    mime === "image/png"
      ? header.startsWith("\x89PNG\r\n\x1a\n")
      : mime === "image/jpeg"
        ? header.startsWith("\xff\xd8\xff")
        : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  if (!matchesMime)
    throw new Error(
      "The image contents do not match its PNG, JPEG, or WebP MIME type.",
    );

  const image = new Image();
  let width, height;
  try {
    image.src = dataUrl;
    await image.decode();
    width = image.naturalWidth;
    height = image.naturalHeight;
  } catch (error) {
    throw new Error(
      "The image could not be decoded. Choose a valid PNG, JPEG, or WebP file.",
      { cause: error },
    );
  } finally {
    image.removeAttribute("src");
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 16000 ||
    height > 16000 ||
    width * height > 16_000_000
  ) {
    throw new Error(
      "Image dimensions must be 1 to 16000 pixels per side, with at most 16 million pixels total.",
    );
  }
  return {
    id: uid("asset"),
    name: (file.name || "Imported image").slice(0, 1000),
    mime,
    dataUrl,
    width,
    height,
  };
}

export async function publishProject(project) {
  const { default: viewerRuntime } = await import("../generated/viewer.js?raw");
  const { document, json } = projectFile(project);
  if (typeof viewerRuntime !== "string" || !viewerRuntime.trim()) {
    throw new Error(
      "The viewer runtime is missing. Build the viewer before publishing.",
    );
  }
  const title = document.name.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
  const zip = new JSZip();
  zip.file(
    "index.html",
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>html,body,#root{width:100%;height:100%;margin:0}body{overflow:hidden}</style>
  <script type="module" src="./viewer.js"></script>
</head>
<body>
  <div id="root"></div>
  <noscript>Enable JavaScript to view this Atlas project.</noscript>
</body>
</html>
`,
  );
  zip.file("viewer.js", viewerRuntime);
  zip.file("project.json", json);
  zip.file(
    "README.txt",
    `Atlas Published Project

Extract this ZIP into a folder and keep all four files together.
Open a terminal in that folder and start a static server:

    python3 -m http.server 8080

Visit http://localhost:8080 in your browser.
Do not open index.html directly with a file:// URL: a static server is required
because viewer.js starts automatically on #root and fetches project.json.

project.json contains the selected, versioned project and all of its assets
as inline data URLs. No external service, credentials, or upload is needed.
To host elsewhere, serve all four files together on a static HTTP(S) server.
`,
  );
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  downloadBlob(blob, `${filename(document.name)}.zip`);
}
