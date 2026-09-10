import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createProject, type Project, type ProjectHistory, validateProject, transact, undoRedo, uid } from "../timeline";

export const DATA = path.resolve(process.env.DATA_DIR || ".data");
export function safeId(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid resource ID");
  return value;
}
export const projectDir = (id: string) => path.join(DATA, "projects", safeId(id));
export const mediaDir = (id: string) => path.join(projectDir(id), "media");
export const mediaPath = (projectId: string, assetId: string, variant: "source" | "preview" | "thumb" = "source") => path.join(mediaDir(projectId), `${safeId(assetId)}.${variant === "source" ? "source" : variant === "preview" ? "mp4" : "jpg"}`);
const locks = new Map<string, Promise<unknown>>();
export async function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(id, next);
  try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
}
export async function atomicJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${uid()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(data), { mode: 0o600 }); await rename(tmp, file); }
  finally { await rm(tmp, { force: true }); }
}
export async function loadHistory(id: string): Promise<ProjectHistory> {
  try {
    const h = JSON.parse(await readFile(path.join(projectDir(id), "project.json"), "utf8")) as ProjectHistory;
    return { ...h, project: validateProject(h.project) };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Project not found"); throw e; }
}
export async function loadProject(id: string) { return (await loadHistory(id)).project; }
export async function saveHistory(h: ProjectHistory) { await atomicJson(path.join(projectDir(h.project.id), "project.json"), h); return h; }
export async function newProject(name?: string) {
  const project = createProject(name);
  await mkdir(mediaDir(project.id), { recursive: true });
  await saveHistory({ project, undo: [], redo: [] });
  return project;
}
export async function listProjects() {
  await mkdir(path.join(DATA, "projects"), { recursive: true });
  const ids = await readdir(path.join(DATA, "projects"));
  const projects = await Promise.all(ids.filter(x => /^[a-zA-Z0-9_-]+$/.test(x)).map(async id => {
    try { const p = await loadProject(id); return { id: p.id, name: p.name, updatedAt: p.updatedAt, fixture: p.fixture, assetCount: p.assets.length }; } catch { return null; }
  }));
  return projects.filter(p => p !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function mutateProject(id: string, fn: (p: Project) => Project | Promise<Project>) {
  return locked(id, async () => {
    const h = await loadHistory(id), next = await fn(structuredClone(h.project));
    next.revision = h.project.revision + 1; next.updatedAt = new Date().toISOString();
    h.project = validateProject(next); await saveHistory(h); return next;
  });
}
export async function execute(id: string, command: unknown) {
  return locked(id, async () => {
    const h = transact(await loadHistory(id), command); await saveHistory(h); return h;
  });
}
export async function historyAction(id: string, action: "undo" | "redo", revision: number) {
  return locked(id, async () => { const h = undoRedo(await loadHistory(id), action, revision); await saveHistory(h); return h; });
}
export async function deleteProject(id: string) { await locked(id, () => rm(projectDir(id), { recursive: true, force: true })); }
export async function storageUsage() {
  async function size(dir: string): Promise<number> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const sizes = await Promise.all(entries.map(async e => e.isDirectory() ? size(path.join(dir, e.name)) : (await stat(path.join(dir, e.name))).size));
    return sizes.reduce((a, b) => a + b, 0);
  }
  return size(DATA);
}
