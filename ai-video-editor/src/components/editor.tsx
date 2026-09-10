"use client";
/* Media thumbnails are authenticated editor resources, not public image-optimizer inputs. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight, AudioLines, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clapperboard, CloudCheck, Copy, FileText, Film, FolderOpen, Fullscreen, ImageIcon, Keyboard, Layers, Link2, LoaderCircle, Magnet, Maximize2, MousePointer2, Music2, Pause, Play, Plus, Redo2, RotateCcw, Scissors, Search, Settings2, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Square, Subtitles, Trash2, Type, Undo2, Upload, Volume2, VolumeX, WandSparkles, X, ZoomIn, ZoomOut } from "lucide-react";
import { type Asset, type Clip, type Operation, type Project, type Proposal, type SourceRange, buildProposal, clipEnd, duration, effectsSchema, frameTime, makeClip, projectDuration, timecode, tokenOccurrences, uid } from "@/lib/timeline";
import { fillerRanges, silenceRanges } from "@/lib/transcript";
import Preview from "./preview";

type Summary = { id: string; name: string; updatedAt: string; fixture: boolean; assetCount: number };
type Saved = { project: Project; canUndo: boolean; canRedo: boolean };
type Job = { id: string; projectId: string; status: string; progress: number; error?: string; duration: number; revision: number };
type Chat = { id: string; role: "user" | "assistant"; text: string };
const API = "/api/editor";
async function request<T = Saved>(url: string, data?: unknown, method?: string): Promise<T> {
  const response = await fetch(`${API}/${url}`, { method: method || (data === undefined ? "GET" : "POST"), headers: data === undefined ? undefined : { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json as T;
}
function IconButton({ label, children, active, className = "", ...props }: { label: string; children: ReactNode; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`icon-button ${active ? "active" : ""} ${className}`} title={label} aria-label={label}>{children}</button>;
}
function Waveform({ peaks, color = "currentColor", className = "" }: { peaks: number[]; color?: string; className?: string }) {
  return <svg className={`waveform ${className}`} viewBox="0 0 300 40" preserveAspectRatio="none" aria-label="Waveform generated from source audio" role="img">{peaks.filter((_, i) => i % Math.max(1, Math.floor(peaks.length / 110)) === 0).slice(0, 110).map((v, i, array) => <line key={i} x1={i * 300 / array.length + 1} x2={i * 300 / array.length + 1} y1={20 - Math.max(1, v * 19)} y2={20 + Math.max(1, v * 19)} stroke={color} strokeWidth="1.5" />)}</svg>;
}
function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? "small" : ""}`}><svg width="28" height="29" viewBox="0 0 28 29" fill="none" aria-hidden="true"><path d="M3 3h10v10H3zM15 3h10v10H15zM3 15h10v10H3z" fill="currentColor"/><path d="M15 15h10v10H15z" fill="currentColor" opacity=".38"/></svg>{!small && <span>frame<span className="brand-period">.</span></span>}</span>;
}

export default function Editor() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string>();
  const [section, setSection] = useState("media");
  const [rightTab, setRightTab] = useState("assistant");
  const [mediaSearch, setMediaSearch] = useState("");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [wordSelection, setWordSelection] = useState<number[]>([]);
  const [transcriptVisible, setTranscriptVisible] = useState(true);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(23);
  const [tool, setTool] = useState("select");
  const [modal, setModal] = useState<"projects" | "export" | "shortcuts" | "settings" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Chat[]>([]);
  const [assistantRunning, setAssistantRunning] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState("");
  const [proposal, setProposal] = useState<(Proposal & { remote?: boolean }) | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [sonioxConfigured, setSonioxConfigured] = useState(false);
  const [fixtureEnabled, setFixtureEnabled] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const assistantAbort = useRef<AbortController | null>(null);
  const commandLock = useRef(false);
  const project = saved?.project;
  const total = project ? projectDuration(project) : 38000;
  const activeClip = project?.clips.find(c => selected.includes(c.id));
  const transcript = project ? tokenOccurrences(project) : [];
  const firstSelectedWord = wordSelection.length ? transcript[wordSelection[0]] : undefined;
  const transcribing = project?.assets.some(a => ["queued", "uploading", "processing"].includes(a.transcription));

  function accept(next: Saved, reset = false) {
    setSaved(next);
    localStorage.setItem("frame-project", next.project.id);
    if (reset) { setTime(0); setSelected([]); setSelectedAsset(undefined); setMessages([]); setProposal(null); setJob(null); setWordSelection([]); setPlaying(false); }
  }
  const receiveSaved = useEffectEvent(accept);
  useEffect(() => {
    let cancelled = false;
    void request<Saved & { projects: Summary[]; sonioxConfigured: boolean; fixtureEnabled: boolean }>("bootstrap").then(async data => {
      if (cancelled) return;
      setProjects(data.projects); setSonioxConfigured(data.sonioxConfigured); setFixtureEnabled(data.fixtureEnabled);
      const previous = localStorage.getItem("frame-project");
      const next = previous && data.projects.some(p => p.id === previous) ? await request<Saved>(`projects/${previous}`) : data;
      if (!cancelled) { receiveSaved(next); setSelected(next.project.clips.filter(c => c.trackId === "video").slice(0, 1).map(c => c.id)); }
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; assistantAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!project?.id || !transcribing) return;
    const id = project.id;
    const timer = setInterval(() => { void request(`projects/${id}`).then(receiveSaved).catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [project?.id, transcribing]);
  useEffect(() => {
    if (!job || !["queued", "rendering"].includes(job.status)) return;
    const timer = setInterval(() => { void request<{ job: Job }>(`renders/${job.projectId}/${job.id}`).then(r => setJob(r.job)).catch(e => setError(e.message)); }, 1000);
    return () => clearInterval(timer);
  }, [job]);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "instant" }); }, [messages, assistantStatus, proposal]);
  useEffect(() => {
    if (playing && !transcriptSearch) transcriptRef.current?.querySelector(".word.current")?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [time, playing, transcriptSearch]);
  const notifyError = (text: string) => setError(text);
  const seek = (value: number) => setTime(Math.max(0, Math.min(total, value)));

  async function commit(operations: Operation[], label: string) {
    if (!project || commandLock.current) return;
    commandLock.current = true; setBusy("Saving"); setError("");
    try {
      const next = await request(`projects/${project.id}/commands`, { revision: project.revision, label, operations });
      setSaved(next); setWordSelection([]);
      setTime(t => Math.min(t, projectDuration(next.project)));
    } catch (e) {
      setError((e as Error).message);
      if (/stale/i.test((e as Error).message)) setSaved(await request(`projects/${project.id}`));
    } finally { commandLock.current = false; setBusy(""); }
  }
  async function history(action: "undo" | "redo") {
    if (!project || commandLock.current || !(action === "undo" ? saved?.canUndo : saved?.canRedo)) return;
    commandLock.current = true; setBusy("Saving");
    try { const next = await request(`projects/${project.id}/${action}`, { revision: project.revision }); setSaved(next); setTime(t => Math.min(t, projectDuration(next.project))); setToast(action === "undo" ? "Edit undone" : "Edit restored"); }
    catch (e) { setError((e as Error).message); } finally { commandLock.current = false; setBusy(""); }
  }
  function split(clipId = activeClip?.id, at = time) {
    if (!clipId) { setToast("Select a clip to split"); return; }
    void commit([{ type: "split", clipId, at: frameTime(at, project!.fps), newId: uid() }], "Split clip");
  }
  function remove(ripple = false, ids = selected) {
    if (ids.length) { void commit([{ type: "delete", ids, ripple }], ripple ? "Ripple delete" : "Lift delete"); setSelected([]); }
  }
  function duplicate(ids = selected) {
    if (!project) return;
    const clips = project.clips.filter(c => ids.includes(c.id));
    void commit([{ type: "add", clips: clips.map(c => ({ ...c, id: uid(), start: clipEnd(c) })) }], "Duplicate clips");
  }
  async function addAsset(asset: Asset, start?: number, trackId?: string) {
    if (!project) return;
    if (asset.kind === "subtitle") {
      const clips = asset.tokens.map(t => ({ ...makeClip(undefined, "titles", t.start + (start ?? 0)), name: "Caption imported", text: t.text, sourceOut: Math.max(80, t.end - t.start), fontSize: 42, effects: effectsSchema.parse({ y: 0.36 }) }));
      await commit([{ type: "add", clips }], "Import subtitle captions"); return;
    }
    const track = trackId || (asset.kind === "audio" ? "audio" : "video");
    const end = Math.max(0, ...project.clips.filter(c => c.trackId === track).map(clipEnd));
    const c = makeClip(asset, track, start ?? end);
    await commit([{ type: "add", clips: [c] }], `Add ${asset.name}`); setSelected([c.id]);
  }
  async function upload(files: FileList | File[]) {
    if (!project || busy) return;
    setError("");
    for (const file of Array.from(files)) {
      setBusy(`Importing ${file.name}`);
      try {
        const response = await fetch(`${API}/projects/${project.id}/upload`, { method: "POST", headers: { "Content-Type": file.type || (file.name.endsWith(".srt") ? "application/x-subrip" : "application/octet-stream"), "X-File-Name": encodeURIComponent(file.name) }, body: file });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setSaved(data); setSelectedAsset(data.asset.id); setToast(`${file.name} is ready. Add it to your timeline.`);
      } catch (e) { setError((e as Error).message); }
    }
    setBusy(""); if (uploadRef.current) uploadRef.current.value = "";
  }
  async function openProject(id: string) {
    try { if (project) await request(`projects/${project.id}/dispose-assistant`, {}); assistantAbort.current?.abort(); accept(await request(`projects/${id}`), true); setModal(null); }
    catch (e) { setError((e as Error).message); }
  }
  async function projectAction(action: "new" | "duplicate" | "delete", id?: string) {
    setBusy("Saving project");
    try {
      if (action === "new") { const next = await request("projects", { name: projectName || "Untitled project" }); accept(next, true); setProjectName(""); setModal(null); }
      if (action === "duplicate") { accept(await request(`projects/${id}/duplicate`, {}), true); setModal(null); }
      if (action === "delete") {
        if (!confirm("Delete this project and all its media and exports? This cannot be undone.")) return;
        await request(`projects/${id}`, undefined, "DELETE");
        const list = await request<{ projects: Summary[] }>("projects");
        if (project?.id === id) accept(list.projects.length ? await request(`projects/${list.projects[0].id}`) : await request("projects", { name: "Untitled project" }), true);
      }
      setProjects((await request<{ projects: Summary[] }>("projects")).projects);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  function review(operations: Operation[], title: string, rationale: string, ranges: SourceRange[] = []) {
    if (!project) return;
    try { setProposal(buildProposal(project, title, rationale, operations, ranges)); setRightTab("assistant"); }
    catch (e) { setError((e as Error).message); }
  }
  function cleanSpeech(silence = false) {
    if (!project) return;
    const ranges = project.assets.flatMap(a => silence ? silenceRanges(a, 2000) : fillerRanges(a));
    if (!ranges.length) { setToast(silence ? "No measured pauses longer than 2 seconds found." : "No filler words found in the current transcript."); return; }
    review([{ type: "removeRanges", ranges }], silence ? "Make room for the story" : "A cleaner conversation", silence ? "Remove measured silences longer than two seconds. All tracks ripple together to preserve synchronization." : "Review filler words before removing their original source ranges. The original transcript remains preserved.", ranges);
  }
  function removeWords() {
    const ranges = wordSelection.map(i => transcript[i]).filter(Boolean).map(w => ({ assetId: w.assetId, start: Math.max(w.token.start, project!.clips.find(c => c.id === w.clipId)!.sourceIn), end: Math.min(w.token.end, project!.clips.find(c => c.id === w.clipId)!.sourceOut), tokenIds: [w.token.id] }));
    if (ranges.length) review([{ type: "removeRanges", ranges }], "Edit the words. Shape the story.", "Ripple-remove the selected spoken source ranges and keep every track in sync. Source words and timestamps are retained in the edit history.", ranges);
  }
  function roughCutWords() {
    if (!project || !wordSelection.length) return;
    const chosen = wordSelection.map(i => transcript[i]).filter(Boolean);
    const ranges: SourceRange[] = [];
    for (const w of chosen) {
      const last = ranges.at(-1);
      if (last && last.assetId === w.assetId && w.token.start - last.end < 1000) last.end = w.token.end;
      else ranges.push({ assetId: w.assetId, start: w.token.start, end: w.token.end });
    }
    let cursor = 0;
    const clips = ranges.map(r => { const a = project.assets.find(a => a.id === r.assetId)!; const c = { ...makeClip(a, a.kind === "audio" ? "audio" : "video", cursor), sourceIn: r.start, sourceOut: r.end }; cursor += duration(c); return c; });
    review([...(project.clips.length ? [{ type: "delete" as const, ids: project.clips.map(c => c.id), ripple: false }] : []), { type: "add", clips }], "A transcript-first rough cut", "Replace the current timeline with the selected spoken passages, in transcript order. You can undo the entire cut in one step.", ranges);
  }
  async function applyReview() {
    if (!project || !proposal) return;
    if (proposal.revision !== project.revision) { setError("This proposal is based on an older revision. Ask for a fresh proposal."); return; }
    try {
      if (proposal.remote) { setBusy("Applying edit"); setSaved(await request(`projects/${project.id}/apply-proposal`, { proposalId: proposal.id })); }
      else await commit(proposal.operations, proposal.title);
      setProposal(null); setToast("Proposal applied as one undoable edit"); setWordSelection([]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function rejectReview() { if (proposal?.remote && project) await request(`projects/${project.id}/reject-proposal`, { proposalId: proposal.id }).catch(() => {}); setProposal(null); }
  async function ask(message = prompt) {
    if (!project || !message.trim()) return;
    if (assistantRunning) { try { await request(`projects/${project.id}/steer-assistant`, { message }); setMessages(m => [...m, { id: uid(), role: "user", text: message }]); setPrompt(""); setAssistantStatus("Steering queued for the next turn"); } catch (e) { setError((e as Error).message); } return; }
    const answerId = uid(); setPrompt(""); setRightTab("assistant"); setAssistantRunning(true); setAssistantStatus("Reading your project"); setError("");
    setMessages(m => [...m, { id: uid(), role: "user", text: message }, { id: answerId, role: "assistant", text: "" }]);
    const controller = new AbortController(); assistantAbort.current = controller;
    try {
      const response = await fetch(`${API}/projects/${project.id}/assistant`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal: controller.signal });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop()!;
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === "text") setMessages(m => m.map(v => v.id === answerId ? { ...v, text: v.text + event.text } : v));
          if (event.type.startsWith("tool_")) setAssistantStatus(`${event.tool.replaceAll("_", " ")} ${event.type === "tool_end" ? "complete" : "..."}`);
          if (event.type === "proposal") setProposal({ ...event.proposal, remote: true });
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "state" && event.state === "aborted") setAssistantStatus("Stopped. Your timeline is unchanged.");
        }
      }
    } catch (e) { if ((e as Error).name !== "AbortError") setError((e as Error).message); }
    finally { setAssistantRunning(false); setAssistantStatus(""); assistantAbort.current = null; }
  }
  async function stopAssistant() { if (project) await request(`projects/${project.id}/abort-assistant`, {}).catch(() => {}); assistantAbort.current?.abort(); setAssistantRunning(false); }
  async function transcribe(assetId?: string, fixture = false) {
    if (!project) return;
    const asset = project.assets.find(a => a.id === assetId) || project.assets.find(a => a.hasAudio && !a.tokens.length) || project.assets.find(a => a.hasAudio);
    if (!asset) { setError("Import a video or audio file first."); return; }
    setBusy(fixture ? "Loading fixture words" : "Queueing transcription");
    try { await request(`projects/${project.id}/${fixture ? "fixture-transcript" : "transcribe"}`, { assetId: asset.id }); setSaved(await request(`projects/${project.id}`)); setToast(fixture ? "Labeled fixture words added. These are not Soniox results." : "Transcription queued. You can keep editing."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function exportVideo() {
    if (!project) return;
    setPlaying(false); setBusy("Starting render"); setError("");
    try { setJob((await request<{ job: Job }>(`projects/${project.id}/render`, {})).job); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  function patchClip(patch: Partial<Clip>, label = "Update clip") { if (activeClip) void commit([{ type: "update", ids: selected, patch }], label); }
  const shortcuts = useEffectEvent((e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]") || modal) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); void history(e.shiftKey ? "redo" : "undo"); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); setToast("All changes are automatically saved"); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
    else if (e.code === "Space") { e.preventDefault(); if (time >= total) seek(0); setPlaying(p => !p); }
    else if (e.key.toLowerCase() === "s" || e.key.toLowerCase() === "b") { e.preventDefault(); split(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(e.shiftKey); }
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); seek(time + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1000 : 1000 / (project?.fps || 30))); }
    else if (e.key === "Escape") { setSelected([]); setWordSelection([]); setMenu(null); }
    else if (e.key === "?" ) setModal("shortcuts");
  });
  useEffect(() => { const fn = (e: KeyboardEvent) => shortcuts(e); window.addEventListener("keydown", fn); return () => window.removeEventListener("keydown", fn); }, []);

  function moveClip(e: React.PointerEvent<HTMLElement>, c: Clip, edge?: "in" | "out") {
    if (e.button !== 0 || !project) return;
    e.stopPropagation(); setPlaying(false);
    if (tool === "blade" && !edge) { split(c.id, c.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 1000); return; }
    const group = c.groupId ? project.clips.filter(v => v.groupId === c.groupId).map(v => v.id) : [c.id];
    const ids = e.shiftKey ? [...new Set([...selected, ...group])] : selected.includes(c.id) ? selected : group;
    setSelected(ids); setSelectedAsset(c.assetId);
    const origin = e.clientX, targetElement = e.currentTarget; let offset = 0;
    const elements = ids.map(id => document.getElementById(`clip-${id}`)).filter(Boolean) as HTMLElement[];
    const targets = [0, time, ...project.clips.filter(x => !ids.includes(x.id)).flatMap(x => [x.start, clipEnd(x)])];
    const move = (ev: PointerEvent) => {
      offset = (ev.clientX - origin) / zoom * 1000;
      if (!edge) {
        const earliest = Math.min(...project.clips.filter(v => ids.includes(v.id)).map(v => v.start));
        offset = Math.max(-earliest, offset);
        if (snap) for (const target of targets) { const diff = target - (c.start + offset); if (Math.abs(diff) < 7000 / zoom) { offset += diff; break; } }
        elements.forEach(el => { el.style.transform = `translateX(${offset / 1000 * zoom}px)`; });
      } else targetElement.style.setProperty("opacity", ".7");
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); targetElement.style.opacity = ""; elements.forEach(el => { el.style.transform = ""; el.style.opacity = ""; });
      if (Math.abs(offset) < 20) return;
      if (edge) {
        const a = project.assets.find(a => a.id === c.assetId);
        const sourceIn = edge === "in" ? Math.max(0, Math.min(c.sourceOut - 80, c.sourceIn + offset * c.speed)) : c.sourceIn;
        const sourceOut = edge === "out" ? Math.min(a?.duration ?? 600000, Math.max(c.sourceIn + 80, c.sourceOut + offset * c.speed)) : c.sourceOut;
        const start = edge === "in" ? Math.max(0, c.start + (sourceIn - c.sourceIn) / c.speed) : c.start;
        void commit([{ type: "update", ids: [c.id], patch: { start, sourceIn, sourceOut, fadeIn: 0, fadeOut: 0 } }], "Trim clip");
      } else void commit(project.clips.filter(v => ids.includes(v.id)).map(v => ({ type: "update", ids: [v.id], patch: { start: Math.max(0, frameTime(v.start + offset, project.fps)) } })), "Move clips");
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
  }

  const mediaAssets = project?.assets.filter(a => a.name.toLowerCase().includes(mediaSearch.toLowerCase()) && (section !== "audio" || a.kind === "audio")) || [];
  const timelineWidth = Math.max(900, (total / 1000 + 8) * zoom);
  const step = zoom >= 40 ? 2 : zoom >= 18 ? 5 : 10;

  return <div className="editor-app" onClick={() => menu && setMenu(null)}>
    <input ref={uploadRef} type="file" multiple accept="video/*,audio/*,image/png,image/jpeg,image/webp,.srt,.vtt,.mkv,.mov" className="sr-only" onChange={e => e.target.files && void upload(e.target.files)} aria-label="Import media files" />
    <header className="app-header">
      <Link className="brand-link" href="/" aria-label="Frame home"><Logo /></Link>
      <span className="header-divider" />
      <button className="breadcrumb" onClick={() => { setModal("projects"); void request<{ projects: Summary[] }>("projects").then(r => setProjects(r.projects)); }}><FolderOpen size={15} /><span>All projects</span></button>
      <ChevronRight size={14} className="breadcrumb-chevron" />
      <button className="project-title" onClick={() => { const name = window.prompt("Project name", project?.name); if (name) void commit([{ type: "rename", name }], "Rename project"); }}>{project?.name || "Your next story"}<ChevronDown size={14}/></button>
      <div className="save-status">{busy ? <LoaderCircle className="spin" size={15}/> : <CloudCheck size={16}/>}<span>{busy || "All changes saved"}</span></div>
      <div className="header-actions"><IconButton label="Keyboard shortcuts" onClick={() => setModal("shortcuts")}><Keyboard size={18}/></IconButton><span className="avatar" title="Local workspace">Y</span><button className="button primary export-button" onClick={() => setModal("export")} disabled={!project}><ArrowUpRight size={16}/><span>Export video</span></button></div>
    </header>
    <div className="workspace-bar"><div className="workspace-label"><Clapperboard size={16}/><span>Editor</span><ChevronDown size={13}/></div><div className="workspace-tabs"><button className="selected" onClick={() => setRightTab("assistant")}>Edit</button><button onClick={() => { setRightTab("inspector"); setSection("color"); }}>Color</button><button onClick={() => { setRightTab("inspector"); setSection("audio"); }}>Audio</button></div><div className="workspace-meta">{project?.fixture && <span className="fixture-badge"><span/>Sample project · fixture data</span>}<span className="project-format">16:9 <span>·</span> 720p <span>·</span> 30 fps</span><IconButton label="Project settings" onClick={() => setModal("settings")}><SlidersHorizontal size={15}/></IconButton></div></div>

    <div className="work-area">
      <nav className="tool-rail" aria-label="Workspace panels">{[{ id: "media", icon: FolderOpen, label: "Media" }, { id: "audio", icon: Music2, label: "Audio" }, { id: "text", icon: Type, label: "Text" }, { id: "captions", icon: Subtitles, label: "Captions" }, { id: "effects", icon: WandSparkles, label: "Effects" }].map(({ id, icon: Icon, label }) => <button key={id} className={`rail-button ${section === id ? "selected" : ""}`} onClick={() => setSection(id)}><Icon size={20}/><span>{label}</span></button>)}<div className="rail-bottom"><IconButton label="Settings" onClick={() => setModal("settings")}><Settings2 size={19}/></IconButton><IconButton label="Help and shortcuts" onClick={() => setModal("shortcuts")}><CircleHelp size={19}/></IconButton></div></nav>

      <aside className="media-panel" onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
        <div className="panel-heading"><h2>{section === "text" ? "Text & titles" : section === "captions" ? "Captions" : section === "effects" || section === "color" ? "Make it yours" : section === "audio" ? "Audio library" : "Your media"}</h2><IconButton label="Import files" onClick={() => uploadRef.current?.click()}><Plus size={18}/></IconButton></div>
        {["media", "audio"].includes(section) ? <>
          <div className="media-search"><Search size={14}/><input value={mediaSearch} onChange={e => setMediaSearch(e.target.value)} placeholder="Search your media" aria-label="Search media"/><kbd>⌘ K</kbd></div>
          <div className="media-filter"><span>Project files <span className="count">{mediaAssets.length}</span></span><span className="view-grid"><Layers size={14}/></span></div>
          <div className="asset-grid">{loading ? [1, 2, 3, 4].map(i => <div className="asset-skeleton" key={i}/>) : mediaAssets.map((a, i) => <div className={`asset-card ${selectedAsset === a.id || (!selectedAsset && i === 0) ? "selected" : ""}`} key={a.id} draggable onDragStart={e => e.dataTransfer.setData("application/frame-asset", a.id)}>
            <button className={`asset-preview ${a.kind}`} onClick={() => { setSelectedAsset(a.id); const clip = project?.clips.find(c => c.assetId === a.id); if (clip) { setSelected([clip.id]); seek(clip.start); } }} onDoubleClick={() => void addAsset(a)} aria-label={`Select ${a.name}`}>
              {a.thumbnail ? <img src={`${API}/media/${project?.id}/${a.id}/thumb`} alt={a.name} /> : a.kind === "audio" ? <><Music2 size={22}/><Waveform peaks={a.waveform}/></> : <FileText size={25}/>}<span className="asset-duration">{timecode(a.duration)}</span><span className="asset-kind">{a.kind === "video" ? <Film size={11}/> : a.kind === "image" ? <ImageIcon size={11}/> : a.kind === "audio" ? <AudioLines size={11}/> : <Subtitles size={11}/>}</span>
            </button><button className="asset-add" aria-label={`Add ${a.name} to timeline`} title="Add to timeline" onClick={() => void addAsset(a)}><Plus size={13}/></button><div className="asset-name" title={a.name}>{a.name}</div><div className="asset-detail">{a.kind === "audio" ? "WAV audio" : a.kind === "subtitle" ? "Timed subtitles" : `${a.width || 1280} × ${a.height || 720}`}<span>{(a.bytes / 1024 ** 2).toFixed(1)} MB</span></div>
          </div>)}</div>
          {!loading && !mediaAssets.length && <div className="empty-bin"><FolderOpen size={30}/><h3>Your story starts here</h3><p>Bring your footage, favorite sounds, and big ideas.</p></div>}
          <button className={`upload-zone ${busy.startsWith("Importing") ? "uploading" : ""}`} onClick={() => uploadRef.current?.click()} disabled={!!busy}><span className="upload-icon">{busy.startsWith("Importing") ? <LoaderCircle className="spin" size={20}/> : <Upload size={20}/>}</span><strong>{busy.startsWith("Importing") ? "Preparing your media..." : "Drop something good"}</strong><span>Drag files here or <b>browse files</b></span><small>Video, audio, images & subtitles</small></button>
          <div className="media-bottom"><span className="status-dot"/>Stored locally. Always yours.<IconButton label="Privacy and storage" onClick={() => setModal("settings")}><CircleHelp size={13}/></IconButton></div>
        </> : section === "text" ? <div className="library-content"><p className="muted">A few words can change everything.</p>{[{ name: "Simple title", text: "Your story starts here", size: 70, y: 0 }, { name: "Lower third", text: "A new perspective", size: 40, y: 0.32 }, { name: "Chapter card", text: "CHAPTER 01\nThe beginning", size: 64, y: 0 }].map(t => <button key={t.name} className="text-preset" onClick={() => { if (project) void commit([{ type: "add", clips: [{ ...makeClip(undefined, "titles", time), name: t.name, text: t.text, fontSize: t.size, effects: effectsSchema.parse({ y: t.y }) }] }], `Add ${t.name}`); }}><span>{t.text}</span><small>{t.name}<Plus size={13}/></small></button>)}</div> : section === "captions" ? <div className="library-content"><div className="feature-icon"><Subtitles size={27}/></div><h3>Every word, included.</h3><p className="muted">Generate readable captions from source-timed transcripts, inside safe title margins.</p><button className="button primary full" onClick={() => void commit([{ type: "captions" }], "Generate captions")}><Sparkles size={15}/>Generate captions</button><button className="button full" onClick={() => void transcribe(selectedAsset)}><AudioLines size={15}/>Transcribe media</button><button className="button full" onClick={() => uploadRef.current?.click()}><Upload size={15}/>Import SRT or VTT</button><div className="info-note">{sonioxConfigured ? "Live transcription by Soniox · stt-async-v5" : "Live transcription needs SONIOX_API_KEY on the server."}</div>{fixtureEnabled && <button className="text-link" onClick={() => void transcribe(selectedAsset, true)}>Use labeled fixture words for testing</button>}</div> : <div className="library-content"><p className="muted">Small changes. A different feeling.</p>{[{ name: "Soft fade", sub: "A gentle way in and out", patch: { transition: "fade" as const } }, { name: "Warm & cinematic", sub: "A little warmth, a little contrast", patch: { effects: { ...effectsSchema.parse({}), contrast: 1.12, saturation: 0.85, brightness: 0.04 } } }, { name: "Black & white", sub: "Let the story do the talking", patch: { effects: { ...effectsSchema.parse({}), saturation: 0 } } }, { name: "Reset effects", sub: "Back to the original", patch: { effects: effectsSchema.parse({}), transition: "none" as const } }].map(t => <button key={t.name} className="effect-preset" disabled={!activeClip} onClick={() => patchClip(t.patch, t.name)}><span className={`effect-swatch ${t.name.startsWith("Black") ? "mono" : ""}`}/><span><strong>{t.name}</strong><small>{t.sub}</small></span><Plus size={14}/></button>)}<p className="info-note">Select a clip to apply a look. Fine-tune every detail in the inspector.</p><button className="button full" onClick={() => setRightTab("inspector")}><SlidersHorizontal size={15}/>Open inspector</button></div>}
      </aside>

      <main className="center-panel">
        <div className="preview-panel" ref={previewRef}>
          <div className="preview-heading"><span>Preview <span className="live-dot"/></span><div><span className="preview-quality">Fit <ChevronDown size={12}/></span><IconButton label="Fullscreen preview" onClick={() => { void previewRef.current?.requestFullscreen().catch(() => setToast("Fullscreen isn't available in this browser.")); }}><Maximize2 size={15}/></IconButton></div></div>
          <div className="monitor-wrap">{project ? <Preview project={project} time={time} playing={playing} onTime={setTime} onPlaying={setPlaying} onError={notifyError}/> : <div className="preview-loading"><img src="/sample/mountain.jpg" alt="Mountain landscape sample"/><div><LoaderCircle className="spin" size={24}/><span>{loading ? "Preparing your creative space" : "Your story is waiting"}</span></div></div>}</div>
          <div className="transport"><span className="time-display"><b>{timecode(time, true)}</b><span>/ {timecode(total, true)}</span></span><div className="transport-buttons"><IconButton label="Previous cut" onClick={() => { setPlaying(false); seek(Math.max(0, ...(project?.clips.filter(c => c.start < time - 50).map(c => c.start) || []))); }}><SkipBack size={16}/></IconButton><button className="play-button" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => { if (time >= total) seek(0); setPlaying(p => !p); }} disabled={!project || !total}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button><IconButton label="Next cut" onClick={() => { setPlaying(false); seek(Math.min(total, ...(project?.clips.filter(c => c.start > time + 50).map(c => c.start) || []))); }}><SkipForward size={16}/></IconButton></div><div className="transport-right"><IconButton label="Show clip inspector" active={rightTab === "inspector"} onClick={() => setRightTab(rightTab === "inspector" ? "assistant" : "inspector")}><SlidersHorizontal size={16}/></IconButton><IconButton label="Toggle transcript" active={transcriptVisible} onClick={() => setTranscriptVisible(v => !v)}><Subtitles size={17}/></IconButton></div></div>
        </div>
        {transcriptVisible && <section className="transcript-panel"><div className="transcript-heading"><h2><FileText size={14}/>Transcript</h2><span className="transcript-sync"><span/>Synced to timeline</span><div className="transcript-search"><Search size={13}/><input value={transcriptSearch} onChange={e => { setTranscriptSearch(e.target.value); const i = transcript.findIndex(w => w.token.text.toLowerCase().includes(e.target.value.toLowerCase())); if (e.target.value && i >= 0) seek(transcript[i].start); }} placeholder="Find a word..." aria-label="Search transcript"/><span>{transcriptSearch ? `${transcript.filter(w => w.token.text.toLowerCase().includes(transcriptSearch.toLowerCase())).length}` : ""}</span></div><IconButton label="Review filler words" onClick={() => cleanSpeech(false)}><WandSparkles size={15}/></IconButton></div>
          <div className="transcript-content" ref={transcriptRef}>{transcript.length ? <><div className="speaker-line"><span className="speaker-avatar">S1</span><b>{project?.fixture ? "Sample narrator" : transcript[0]?.token.speaker ? `Speaker ${transcript[0].token.speaker}` : "Speaker 1"}</b><span>{project?.fixture ? "FIXTURE · APPROXIMATE TIMING" : "SOURCE-TIMED TRANSCRIPT"}</span></div><div className="transcript-words">{transcript.map((w, i) => <span key={`${w.clipId}-${w.token.id}`}>{(i === 0 || transcript[i - 1].clipId !== w.clipId) && <span className="word-time">{timecode(w.start)}</span>}<button className={`word ${time >= w.start && time < w.end ? "current" : ""} ${wordSelection.includes(i) ? "word-selected" : ""} ${transcriptSearch && w.token.text.toLowerCase().includes(transcriptSearch.toLowerCase()) ? "found" : ""} ${w.token.corrected ? "corrected" : ""}`} title={`${w.token.speaker || "Speaker"} · source ${timecode(w.token.start, true)}${w.token.confidence === undefined ? "" : ` · ${Math.round(w.token.confidence * 100)}% confidence`}${w.token.corrected ? ` · Corrected from: ${w.token.original}` : ""}. Shift-click to select a range. Double-click to correct.`} onClick={e => { setPlaying(false); seek(w.start); if (e.shiftKey && wordSelection.length) { const start = Math.min(wordSelection[0], i), end = Math.max(wordSelection[0], i); setWordSelection(Array.from({ length: end - start + 1 }, (_, k) => start + k)); } else setWordSelection([i]); }} onDoubleClick={() => { const text = window.prompt("Correct transcript text (source timing stays unchanged)", w.token.text); if (text) void commit([{ type: "correctToken", assetId: w.assetId, tokenId: w.token.id, text }], "Correct transcript text"); }}>{w.token.text.trim()}</button>{" "}</span>)}</div></> : <div className="transcript-empty"><AudioLines size={21}/><span>{transcribing ? "Soniox is transcribing your audio. Keep creating while it works." : "Turn your spoken words into an editable story."}</span><button className="text-link" onClick={() => void transcribe(selectedAsset)}>{transcribing ? "Check status" : "Transcribe media"}<ArrowRight size={13}/></button></div>}</div>
          {!!wordSelection.length && <div className="word-actions"><span>{wordSelection.length} {wordSelection.length === 1 ? "word" : "words"} selected</span><button onClick={roughCutWords}><Scissors size={12}/>Create rough cut</button><button onClick={removeWords}><Trash2 size={12}/>Ripple remove</button><IconButton label="Clear word selection" onClick={() => setWordSelection([])}><X size={12}/></IconButton></div>}
        </section>}
      </main>

      <aside className="assistant-panel"><div className="right-tabs"><button className={rightTab === "assistant" ? "selected" : ""} onClick={() => setRightTab("assistant")}><Sparkles size={15}/>AI assistant</button><button className={rightTab === "inspector" ? "selected" : ""} onClick={() => setRightTab("inspector")}><SlidersHorizontal size={14}/>Inspector</button></div>
        {rightTab === "assistant" ? <><div className="assistant-body" ref={chatRef}>{!messages.length && <><div className="assistant-intro"><div className="assistant-orb"><Sparkles size={24}/><span/></div><div className="eyebrow">YOUR CREATIVE COPILOT</div><h1>Less busywork.<br/>More <span>story.</span></h1><p>A second pair of eyes, from your<br className="wide-only"/> first rough cut to the final frame.</p></div><div className="suggestion-label">A little inspiration</div><div className="suggestions">{[{ icon: Scissors, title: "Find the good stuff", sub: "Create a 45-second highlight", prompt: "Create a 45-second highlight while preserving the key argument." }, { icon: AudioLines, title: "Clean up the conversation", sub: "Remove fillers & long pauses", prompt: "Remove filler words and pauses longer than two seconds." }, { icon: Subtitles, title: "Let every word land", sub: "Add readable, styled captions", prompt: "Add readable captions and keep each caption within safe title margins." }].map(s => <button key={s.title} className="suggestion-card" onClick={() => void ask(s.prompt)} disabled={!project || assistantRunning}><span className="suggestion-icon"><s.icon size={17}/></span><span><strong>{s.title}</strong><small>{s.sub}</small></span><ArrowUpRight size={14}/></button>)}</div><div className="assistant-reassurance"><span className="small-sparkle">✧</span>You&apos;re always in the director&apos;s chair.<br/>Review every edit before it happens.</div></>}
          {messages.map(m => <div className={`chat-message ${m.role}`} key={m.id}>{m.role === "assistant" && <span className="chat-avatar"><Sparkles size={13}/></span>}<div>{m.text || (assistantRunning ? <span className="thinking-dots">Thinking<span>...</span></span> : "No changes were applied.")}</div></div>)}
          {assistantRunning && <div className="tool-progress"><LoaderCircle size={13} className="spin"/><span>{assistantStatus || "Shaping a thoughtful edit"}</span></div>}
          {proposal && <div className="proposal-card"><div className="proposal-label"><Sparkles size={13}/>EDIT PROPOSAL<span>r{proposal.revision}</span></div><h3>{proposal.title}</h3><p>{proposal.rationale}</p><div className="proposal-stats"><span>{proposal.operations.length} edit{proposal.operations.length !== 1 ? "s" : ""}</span><span>{timecode(proposal.durationBefore)}<ArrowRight size={12}/>{timecode(proposal.durationAfter)}</span></div><details><summary>Inspect changes<ChevronDown size={12}/></summary>{proposal.operations.map((op, i) => <div className="proposal-operation" key={i}><Check size={11}/><span>{op.type === "removeRanges" ? `Ripple-remove ${op.ranges.length} source ranges` : op.type === "add" ? `Add ${op.clips.length} clips` : op.type === "captions" ? "Generate source-linked captions" : op.type === "delete" ? `Remove ${op.ids.length} clips` : op.type === "update" ? `Update ${op.ids.length} clips: ${Object.keys(op.patch).join(", ")}` : op.type}</span></div>)}{proposal.ranges.slice(0, 30).map((r, i) => <div className="proposal-range" key={i}>{project?.assets.find(a => a.id === r.assetId)?.name} · {timecode(r.start, true)}–{timecode(r.end, true)}</div>)}</details>{proposal.warnings.map((w, i) => <p className="proposal-warning" key={i}>{w}</p>)}{proposal.revision !== project?.revision && <p className="proposal-warning">The timeline has changed. Request a fresh proposal.</p>}<div className="proposal-buttons"><button className="button" onClick={() => void rejectReview()}>Reject</button><button className="button primary" onClick={() => void applyReview()} disabled={!!busy || proposal.revision !== project?.revision}><Check size={14}/>Apply edits</button></div></div>}
        </div><div className="assistant-input-area"><form className={`assistant-composer ${assistantRunning ? "running" : ""}`} onSubmit={e => { e.preventDefault(); void ask(); }}><textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={assistantRunning ? "Steer the edit while I work..." : "What would you like to create?"} aria-label="Message AI assistant" rows={2} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}/><div className="composer-bottom"><span><span className="context-icon"><Clapperboard size={11}/></span>Project context<Check size={11}/></span><div>{assistantRunning && <IconButton label="Stop assistant" onClick={() => void stopAssistant()} type="button"><Square size={13} fill="currentColor"/></IconButton>}<button className="send-button" type="submit" disabled={!prompt.trim() || !project} aria-label={assistantRunning ? "Steer assistant" : "Send message"}><ArrowUp size={17}/></button></div></div></form><div className="powered-by"><span className="pi-logo">π</span>Powered by Pi<span>·</span>{project?.fixture ? "Fixture runtime" : "Your connected models"}<span className="status-dot"/></div></div></> : <div className="inspector-content">{activeClip ? <><div className="inspector-selection"><span className="selection-icon">{activeClip.assetId ? <Film size={19}/> : <Type size={19}/>}</span><div><b>{activeClip.name}</b><small>{selected.length > 1 ? `${selected.length} selected clips` : `${timecode(duration(activeClip), true)} duration`}</small></div></div><InspectorSection title="Clip timing"><NumberField label="Timeline start" value={activeClip.start / 1000} unit="s" min={0} step={0.1} onChange={v => patchClip({ start: v * 1000 }, "Move clip")}/><div className="field-pair"><NumberField label="Source in" value={activeClip.sourceIn / 1000} unit="s" min={0} step={0.1} onChange={v => patchClip({ sourceIn: v * 1000, fadeIn: 0, fadeOut: 0 }, "Trim source in")}/><NumberField label="Source out" value={activeClip.sourceOut / 1000} unit="s" min={0.08} step={0.1} onChange={v => patchClip({ sourceOut: v * 1000, fadeIn: 0, fadeOut: 0 }, "Trim source out")}/></div><label className="inspector-field"><span>Playback speed</span><select value={activeClip.speed} onChange={e => patchClip({ speed: Number(e.target.value), fadeIn: 0, fadeOut: 0 }, "Change playback speed")}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map(s => <option value={s} key={s}>{s}x {s === 1 ? "(normal)" : ""}</option>)}</select></label></InspectorSection>
          {!activeClip.assetId && <InspectorSection title="Text & style"><textarea className="text-edit" key={`${activeClip.id}-${activeClip.text}`} defaultValue={activeClip.text} aria-label="Overlay text" onBlur={e => { if (e.target.value && e.target.value !== activeClip.text) patchClip({ text: e.target.value }, "Edit overlay text"); }}/><div className="field-pair"><NumberField label="Font size" value={activeClip.fontSize} unit="px" min={16} max={160} onChange={v => patchClip({ fontSize: v })}/><label className="inspector-field"><span>Color</span><input type="color" value={activeClip.textColor} onChange={e => patchClip({ textColor: e.target.value })}/></label></div></InspectorSection>}
          <InspectorSection title="Transform"><div className="field-pair"><NumberField label="Scale" value={activeClip.effects.scale * 100} unit="%" min={10} max={400} onChange={v => patchClip({ effects: { ...activeClip.effects, scale: v / 100 } })}/><NumberField label="Rotation" value={activeClip.effects.rotation} unit="deg" min={-180} max={180} onChange={v => patchClip({ effects: { ...activeClip.effects, rotation: v } })}/><NumberField label="Position X" value={activeClip.effects.x * 100} unit="%" min={-100} max={100} onChange={v => patchClip({ effects: { ...activeClip.effects, x: v / 100 } })}/><NumberField label="Position Y" value={activeClip.effects.y * 100} unit="%" min={-100} max={100} onChange={v => patchClip({ effects: { ...activeClip.effects, y: v / 100 } })}/></div><NumberField label="Crop edges" value={activeClip.effects.crop * 100} unit="%" min={0} max={45} onChange={v => patchClip({ effects: { ...activeClip.effects, crop: v / 100 } })}/></InspectorSection>
          <InspectorSection title="Audio & transitions"><NumberField label="Volume" value={activeClip.volume * 100} unit="%" min={0} max={200} onChange={v => patchClip({ volume: v / 100 }, "Change volume")}/><div className="field-pair"><NumberField label="Fade in" value={activeClip.fadeIn / 1000} unit="s" min={0} step={0.1} onChange={v => patchClip({ fadeIn: v * 1000 })}/><NumberField label="Fade out" value={activeClip.fadeOut / 1000} unit="s" min={0} step={0.1} onChange={v => patchClip({ fadeOut: v * 1000 })}/></div><label className="inspector-field"><span>Transition</span><select value={activeClip.transition} onChange={e => patchClip({ transition: e.target.value as "none" | "fade" }, "Change transition")}><option value="none">Cut (none)</option><option value="fade">Fade through black · 0.25s</option></select></label></InspectorSection>
          <InspectorSection title="Color"><NumberField label="Brightness" value={Math.round(activeClip.effects.brightness * 100)} unit="%" min={-100} max={100} onChange={v => patchClip({ effects: { ...activeClip.effects, brightness: v / 100 } })}/><NumberField label="Contrast" value={Math.round(activeClip.effects.contrast * 100)} unit="%" min={0} max={300} onChange={v => patchClip({ effects: { ...activeClip.effects, contrast: v / 100 } })}/><NumberField label="Saturation" value={Math.round(activeClip.effects.saturation * 100)} unit="%" min={0} max={300} onChange={v => patchClip({ effects: { ...activeClip.effects, saturation: v / 100 } })}/></InspectorSection><button className="button full" onClick={() => patchClip({ effects: effectsSchema.parse({}), volume: 1, fadeIn: 0, fadeOut: 0, speed: 1, transition: "none" }, "Reset clip effects")}><RotateCcw size={13}/>Reset clip effects</button></> : <div className="inspector-empty"><MousePointer2 size={28}/><h3>It&apos;s in the details.</h3><p>Select a timeline clip to fine-tune its timing, sound, and style.</p></div>}</div>}
      </aside>
    </div>

    <section className="timeline-panel" aria-label="Multitrack timeline"><div className="timeline-toolbar"><div className="timeline-title"><Layers size={15}/><strong>Your timeline</strong><span className="sequence-name">Sequence 01</span></div><div className="edit-tools"><IconButton label="Undo (Ctrl Z)" onClick={() => void history("undo")} disabled={!saved?.canUndo || !!busy}><Undo2 size={16}/></IconButton><IconButton label="Redo (Ctrl Shift Z)" onClick={() => void history("redo")} disabled={!saved?.canRedo || !!busy}><Redo2 size={16}/></IconButton><span className="tool-separator"/><IconButton label="Selection tool" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={16}/></IconButton><IconButton label="Blade tool (click a clip to split)" active={tool === "blade"} onClick={() => setTool(tool === "blade" ? "select" : "blade")}><Scissors size={16}/></IconButton><IconButton label="Split at playhead (S)" disabled={!activeClip || !!busy} onClick={() => split()}><span className="split-icon">][</span></IconButton><IconButton label="Delete selected clips" disabled={!selected.length || !!busy} onClick={() => remove()}><Trash2 size={15}/></IconButton><span className="tool-separator"/><IconButton label="Group selected clips" active={!!activeClip?.groupId} disabled={!selected.length} onClick={() => void commit([{ type: "group", ids: selected, groupId: activeClip?.groupId ? undefined : uid() }], activeClip?.groupId ? "Ungroup clips" : "Group clips")}><Link2 size={16}/></IconButton><IconButton label="Toggle snapping" active={snap} onClick={() => setSnap(v => !v)}><Magnet size={16}/></IconButton></div><div className="timeline-zoom"><IconButton label="Zoom out timeline" onClick={() => setZoom(z => Math.max(8, z - 5))}><ZoomOut size={15}/></IconButton><input type="range" aria-label="Timeline zoom" min={8} max={100} value={zoom} onChange={e => setZoom(Number(e.target.value))}/><IconButton label="Zoom in timeline" onClick={() => setZoom(z => Math.min(100, z + 5))}><ZoomIn size={15}/></IconButton><IconButton label="Fit timeline" onClick={() => setZoom(Math.max(8, Math.min(100, ((timelineRef.current?.clientWidth || 900) - 70) / Math.max(1, total / 1000))))}><Fullscreen size={15}/></IconButton></div></div>
      <div className="timeline-body"><div className="track-labels"><div className="track-ruler-label"><span>TRACKS</span><button aria-label="Add video track" onClick={() => void commit([{ type: "addTrack", track: { id: uid(), name: `Video ${(project?.tracks.filter(t => t.kind === "video").length || 0) + 1}`, kind: "video", muted: false, solo: false } }], "Add video track")}><Plus size={13}/></button></div>{(project?.tracks || [{ id: "titles", name: "Titles & captions", kind: "caption", muted: false, solo: false }, { id: "video", name: "Video", kind: "video", muted: false, solo: false }, { id: "audio", name: "Music & audio", kind: "audio", muted: false, solo: false }]).map((track, i) => <div key={track.id} className={`track-label track-${track.kind}`}><span className={`track-number ${track.kind}`}>{track.kind === "audio" ? "A1" : track.kind === "video" ? `V${i}` : "T1"}</span><div className="track-name"><span>{track.name}</span><small>{project?.clips.filter(c => c.trackId === track.id).length || 0} clips</small></div><div className="track-controls"><IconButton label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} active={track.muted} onClick={() => void commit([{ type: "track", trackId: track.id, patch: { muted: !track.muted } }], "Toggle track mute")}>{track.muted ? <VolumeX size={12}/> : <Volume2 size={12}/>}</IconButton><button className={`solo-button ${track.solo ? "active" : ""}`} title={`Solo ${track.name}`} aria-label={`Solo ${track.name}`} onClick={() => void commit([{ type: "track", trackId: track.id, patch: { solo: !track.solo } }], "Toggle track solo")}>S</button></div></div>)}</div>
        <div className="timeline-scroll" ref={timelineRef}><div className="timeline-canvas" style={{ width: timelineWidth }}><div className="timeline-ruler" onPointerDown={e => { e.preventDefault(); setPlaying(false); const rect = e.currentTarget.getBoundingClientRect(); seek((e.clientX - rect.left) / zoom * 1000); const move = (event: PointerEvent) => seek((event.clientX - rect.left) / zoom * 1000); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true }); }}>{Array.from({ length: Math.ceil(timelineWidth / (step * zoom)) }, (_, i) => <span key={i} style={{ left: i * step * zoom }}>{timecode(i * step * 1000)}</span>)}</div>
          {project?.tracks.map(track => <div className={`timeline-track track-${track.kind} ${track.muted ? "muted-track" : ""}`} key={track.id} style={{ backgroundSize: `${step * zoom}px 100%` }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const a = project.assets.find(a => a.id === e.dataTransfer.getData("application/frame-asset")); if (a) void addAsset(a, Math.max(0, frameTime((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 1000, project.fps)), track.id); }} onDoubleClick={e => { if (e.target === e.currentTarget) { seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 1000); setSelected([]); } }}>
            {project.clips.filter(c => c.trackId === track.id).map(c => { const a = project.assets.find(a => a.id === c.assetId); return <button id={`clip-${c.id}`} key={c.id} data-testid="timeline-clip" data-clip-name={c.name} className={`timeline-clip ${track.kind} ${selected.includes(c.id) ? "selected" : ""} ${c.groupId ? "grouped" : ""}`} style={{ left: c.start / 1000 * zoom, width: Math.max(5, duration(c) / 1000 * zoom) }} onPointerDown={e => moveClip(e, c)} onDoubleClick={() => setRightTab("inspector")} onContextMenu={e => { e.preventDefault(); setSelected([c.id]); setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 245), id: c.id }); }} title={`${c.name} · ${timecode(duration(c), true)} · source ${timecode(c.sourceIn, true)}–${timecode(c.sourceOut, true)}`} aria-label={`Timeline clip ${c.name}`}>
              <span className="clip-trim left" onPointerDown={e => moveClip(e, c, "in")}/><span className="clip-label">{track.kind === "video" ? <Film size={11}/> : track.kind === "audio" ? <Music2 size={11}/> : <Type size={11}/>}<span>{c.name}</span>{c.speed !== 1 && <b>{c.speed}x</b>}{c.groupId && <Link2 size={10}/>}</span>
              {track.kind === "video" && a?.thumbnail && <span className="clip-thumbnails" style={{ backgroundImage: `url(${API}/media/${project.id}/${a.id}/thumb)`, backgroundSize: "auto 100%" }}/>} {a?.waveform.length ? <Waveform peaks={a.waveform.slice(Math.floor(c.sourceIn / a.duration * a.waveform.length), Math.ceil(c.sourceOut / a.duration * a.waveform.length))}/> : !a && <span className="clip-text-preview">{c.text}</span>}
              {c.transition === "fade" && <><span className="fade-mark in"/><span className="fade-mark out"/></>}<span className="clip-trim right" onPointerDown={e => moveClip(e, c, "out")}/>
            </button>; })}
            {!project.clips.some(c => c.trackId === track.id) && <span className="track-drop-hint">{track.kind === "caption" ? "Your words belong here" : "Drag media here to start your story"}</span>}
          </div>)}
          <div className="playhead" style={{ left: time / 1000 * zoom }}><span/><div/></div>
        </div></div>
      </div>
      <div className="timeline-footer"><div><span className="status-dot"/>{project?.clips.length || 0} clips<span className="footer-dot">·</span>{timecode(total)} total<span className="footer-dot">·</span>{selected.length ? `${selected.length} selected` : "No selection"}</div><span>Make something worth watching.</span><div><Keyboard size={12}/><button onClick={() => setModal("shortcuts")}>Shortcuts</button><span className="footer-dot">·</span><span>v1.0</span></div></div>
    </section>

    {error && <div className="error-toast" role="alert"><span><b>Let&apos;s fix that.</b>{error}</span><IconButton label="Dismiss error" onClick={() => setError("")}><X size={16}/></IconButton></div>}
    {toast && <div className="success-toast" role="status"><CheckCheck size={16}/>{toast}</div>}
    {loading && <div className="boot-status" role="status"><LoaderCircle className="spin" size={14}/>Preparing real sample media. First launch takes a moment.</div>}
    {menu && <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>{[{ icon: Scissors, text: "Split at playhead", shortcut: "S", fn: () => split(menu.id) }, { icon: Copy, text: "Duplicate", shortcut: "⌘ D", fn: () => duplicate([menu.id]) }, { icon: SlidersHorizontal, text: "Inspect clip", shortcut: "", fn: () => setRightTab("inspector") }, { icon: Trash2, text: "Lift delete", shortcut: "⌫", fn: () => remove(false, [menu.id]) }, { icon: Trash2, text: "Ripple delete", shortcut: "⇧ ⌫", fn: () => remove(true, [menu.id]) }].map(item => <button role="menuitem" key={item.text} onClick={() => { item.fn(); setMenu(null); }}><item.icon size={14}/>{item.text}<kbd>{item.shortcut}</kbd></button>)}</div>}
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><section className={`modal ${modal === "projects" ? "project-modal" : ""}`} role="dialog" aria-modal="true" aria-label={modal === "export" ? "Export video" : modal === "projects" ? "Your projects" : modal === "settings" ? "Project settings" : "Keyboard shortcuts"}><div className="modal-header"><div>{modal === "export" ? <ArrowUpRight size={19}/> : modal === "projects" ? <FolderOpen size={19}/> : modal === "settings" ? <Settings2 size={19}/> : <Keyboard size={19}/>}<h2>{modal === "export" ? "Your story, ready for the world." : modal === "projects" ? "Room for your next big idea." : modal === "settings" ? "Your workspace, your way." : "Stay in your creative flow."}</h2></div><IconButton label="Close dialog" onClick={() => setModal(null)}><X size={19}/></IconButton></div>
      {modal === "projects" ? <><p className="muted">Your projects are saved on this computer, ready when you are.</p><form className="new-project-form" onSubmit={e => { e.preventDefault(); void projectAction("new"); }}><input placeholder="Give your next story a name" aria-label="New project name" value={projectName} onChange={e => setProjectName(e.target.value)} maxLength={100}/><button className="button primary" type="submit" disabled={!!busy}><Plus size={16}/>New project</button></form><div className="projects-list">{projects.map(p => <div key={p.id} className={`project-row ${project?.id === p.id ? "current" : ""}`}><button onClick={() => void openProject(p.id)}><span className="project-folder"><Clapperboard size={22}/></span><span><b>{p.name}</b><small>{p.fixture ? "Sample project · " : ""}{p.assetCount} assets · {new Date(p.updatedAt).toLocaleDateString()}</small></span>{project?.id === p.id && <span className="current-label">Current</span>}</button><IconButton label={`Duplicate project ${p.name}`} onClick={() => void projectAction("duplicate", p.id)}><Copy size={15}/></IconButton><IconButton label={`Delete project ${p.name}`} onClick={() => void projectAction("delete", p.id)}><Trash2 size={15}/></IconButton></div>)}</div></> : modal === "export" ? <><p className="muted">A real, composited render. Every cut, caption, and detail included.</p>{job?.status === "completed" ? <><video controls className="export-player" src={`${API}/renders/${job.projectId}/${job.id}/file`} aria-label="Completed export preview"/><div className="export-complete"><CheckCheck size={18}/><span>It&apos;s a wrap. Your video is ready.</span></div><a className="button primary full" href={`${API}/renders/${job.projectId}/${job.id}/file?download`}><ArrowDownToLine size={16}/>Download MP4</a><button className="text-link centered" onClick={() => setJob(null)}>Create another export</button></> : job && ["queued", "rendering"].includes(job.status) ? <div className="render-progress"><div className="render-orb"><Film size={29}/></div><h3>{job.status === "queued" ? "Your render is in the queue" : "Bringing it all together"}</h3><p>Rendering revision {job.revision}. You can keep editing.</p><div className="progress-track"><span style={{ width: `${job.progress}%` }}/></div><div className="progress-info"><span>{job.status === "queued" ? "Waiting for a render slot" : "Compositing video & mixing audio"}</span><b>{job.progress}%</b></div><button className="button" onClick={() => { void request(`renders/${job.projectId}/${job.id}`, {}).then(() => setJob({ ...job, status: "cancelled" })).catch(e => setError(e.message)); }}><X size={14}/>Cancel render</button></div> : <>{job && <div className="info-note warning">{job.status === "cancelled" ? "Render cancelled. Your project is safe. Start again whenever you're ready." : job.error}</div>}<div className="export-preview-card"><img src={project?.assets.find(a => a.thumbnail) ? `${API}/media/${project.id}/${project.assets.find(a => a.thumbnail)!.id}/thumb` : "/sample/mountain.jpg"} alt="Project thumbnail"/><span><b>{project?.name}</b><small>{timecode(total)} · {project?.clips.length} clips · revision {project?.revision}</small></span></div><div className="export-settings"><div><span>Format</span><b>MP4 <small>H.264 + AAC</small></b></div><div><span>Resolution</span><b>1280 × 720 <small>HD</small></b></div><div><span>Frame rate</span><b>30 fps <small>Constant</small></b></div><div><span>Quality</span><b>High <small>CRF 20</small></b></div></div><div className="info-note"><Layers size={15}/>Export includes all visible layers, mixed audio, transforms, fades, text, and captions. Muted tracks are excluded.</div><button className="button primary full large" onClick={() => void exportVideo()} disabled={!!busy || !total}><ArrowUpRight size={17}/>Export video</button></>}</> : modal === "settings" ? <><p className="muted">A local-first editing space. Your source files never leave this machine unless you request live transcription.</p><div className="settings-list"><div><b>Project</b><span>{project?.name} · 1280 × 720 · 30 fps</span></div><div><b>Autosave</b><span><CloudCheck size={14}/>Every edit is saved atomically, with 50 undo steps.</span></div><div><b>Soniox transcription</b><span className={sonioxConfigured ? "configured" : ""}>{sonioxConfigured ? "Configured · stt-async-v5" : "Not configured. Add SONIOX_API_KEY to .env.local and restart."}</span></div><div><b>Pi assistant</b><span>{project?.fixture ? "Isolated deterministic fixture provider, running through the real Pi SDK." : "Uses your existing Pi authentication. Run pi and sign in, then restart Frame."}</span></div><div><b>Privacy & lifecycle</b><span>Transcription sends audio to Soniox. The assistant sends timeline metadata and transcript text to your Pi model provider. Remote Soniox resources are cleaned up after processing. Delete a project to remove its local media and exports.</span></div><div><b>Browser preview</b><span>Use Chrome or Edge for the smoothest playback. Preview color is approximate; FFmpeg export is authoritative. Preview gain above 100% is limited by browser media controls.</span></div></div></> : <><p className="muted">Less reaching for the mouse. More finding your rhythm.</p><div className="shortcut-list">{[["Play / pause", "Space"], ["Split clip at playhead", "S"], ["Previous / next frame", "← / →"], ["Jump one second", "Shift + ← / →"], ["Undo", "Ctrl / ⌘ + Z"], ["Redo", "Ctrl / ⌘ + Shift + Z"], ["Duplicate selection", "Ctrl / ⌘ + D"], ["Lift delete", "Delete"], ["Ripple delete", "Shift + Delete"], ["Select a spoken range", "Shift + click"], ["Correct transcript text", "Double-click word"], ["Clear selection", "Esc"]].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><div className="info-note">Drag clips to move. Drag their edges to trim. Shift-click clips to multi-select, then group them to keep edits together.</div></>}
    </section></div>}
    <span className="sr-only" aria-live="polite">{firstSelectedWord ? `Selected ${firstSelectedWord.token.text}` : ""}</span>
  </div>;
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) { return <details className="inspector-section" open><summary>{title}<ChevronDown size={13}/></summary>{children}</details>; }
function NumberField({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit: string; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label className="inspector-field"><span>{label}</span><div className="number-input"><input key={value} type="number" aria-label={label} defaultValue={Number(value.toFixed(3))} min={min} max={max} step={step} onBlur={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== value && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/><span>{unit}</span></div></label>;
}
