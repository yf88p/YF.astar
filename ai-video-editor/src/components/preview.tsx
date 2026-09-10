"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { Film, Loader2 } from "lucide-react";
import { clipEnd, duration, projectDuration, TIMEBASE, toSource, toTimeline, type Asset, type Clip, type Project } from "@/lib/timeline";

type PreviewProps = {
  project: Project;
  time: number;
  playing: boolean;
  onTime: (ms: number) => void;
  onPlaying: (playing: boolean) => void;
  onError: (text: string) => void;
};

type PreviewNode = HTMLMediaElement | HTMLImageElement;
type MediaEntry = {
  node: PreviewNode;
  active: boolean;
  waiting: boolean;
  starting: boolean;
  target?: number;
  timing?: string;
  failure?: string;
};
type Register = (id: string, node: PreviewNode) => () => void;

const PREBUFFER = 2000;
const FRAME_INTERVAL = TIMEBASE / 30;

function fade(clip: Clip, time: number) {
  const length = duration(clip);
  const fallback = clip.transition === "fade" ? Math.min(250, length / 2) : 0;
  const fadeIn = clip.fadeIn || fallback;
  const fadeOut = clip.fadeOut || fallback;
  return (fadeIn ? Math.min(1, Math.max(0, (time - clip.start) / fadeIn)) : 1)
    * (fadeOut ? Math.min(1, Math.max(0, (clipEnd(clip) - time) / fadeOut)) : 1);
}

function playMedia(entry: MediaEntry) {
  const node = entry.node;
  if (!(node instanceof HTMLMediaElement) || !node.paused || entry.starting) return;
  entry.starting = true;
  void node.play().catch((error: unknown) => {
    // Pausing, seeking, and unmounting can legitimately interrupt play().
    const name = error instanceof DOMException ? error.name : "PlaybackError";
    if (name !== "AbortError") entry.failure = name;
  }).finally(() => { entry.starting = false; });
}

// Keep callback refs stable across playhead renders, including overlapping uses of one asset.
function PreviewAsset({ id, asset, url, audioOnly, style, register }: {
  id: string;
  asset: Asset;
  url: string;
  audioOnly: boolean;
  style: CSSProperties;
  register: Register;
}) {
  const attach = useCallback((node: PreviewNode | null) => {
    if (node) return register(id, node);
  }, [id, register]);

  if (audioOnly) return <audio ref={attach} src={url} preload="auto" style={{ display: "none" }} />;
  if (asset.kind === "image") {
    // Source images must use the editor's authenticated URL, without Next image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    return <img ref={attach} src={url} alt="" draggable={false} className="preview-media" style={style} />;
  }
  return <video ref={attach} src={url} preload="auto" playsInline disablePictureInPicture
    controls={false} className="preview-media" style={style} aria-label={asset.name} />;
}

export default function Preview({ project, time, playing, onTime, onPlaying, onError }: PreviewProps) {
  const stage = useRef<HTMLDivElement>(null);
  const media = useRef(new Map<string, MediaEntry>());
  const reported = useRef(new Set<string>());
  const [width, setWidth] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const total = projectDuration(project);
  const position = Math.max(0, Math.min(total, Number.isFinite(time) ? time : 0));
  const solo = project.tracks.some(track => track.solo);
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const layers = project.tracks.slice().reverse()
    .filter(track => !track.muted && (!solo || track.solo))
    .flatMap(track => project.clips.filter(clip => clip.trackId === track.id)
      .sort((a, b) => a.start - b.start)
      .map(clip => ({ clip, track, asset: assets.get(clip.assetId ?? "") })));
  const clock = useRef({
    projectId: project.id, revision: project.revision, position, propTime: position,
    emitted: [] as number[], wasPlaying: false, running: false, stopped: false,
    stamp: 0, buffering: false,
  });

  const register = useCallback<Register>((id, node) => {
    const entry: MediaEntry = { node, active: false, waiting: false, starting: false };
    media.current.set(id, entry);
    const waiting = () => {
      entry.waiting = true;
      if (!entry.active) return;
      clock.current.running = false;
      for (const item of media.current.values()) {
        if (item.node instanceof HTMLMediaElement) item.node.pause();
      }
    };
    const ready = () => { entry.waiting = false; };
    node.addEventListener("waiting", waiting);
    node.addEventListener("canplay", ready);
    node.addEventListener("seeked", ready);
    return () => {
      node.removeEventListener("waiting", waiting);
      node.removeEventListener("canplay", ready);
      node.removeEventListener("seeked", ready);
      if (node instanceof HTMLMediaElement) node.pause();
      if (media.current.get(id) === entry) media.current.delete(id);
    };
  }, []);

  const tick = useEffectEvent((now: number) => {
    const state = clock.current;
    const warn = (key: string, message: string) => {
      if (reported.current.has(key)) return;
      reported.current.add(key);
      onError(message);
    };
    const stop = () => {
      if (!state.stopped) onPlaying(false);
      state.stopped = true;
      state.running = false;
    };
    let seek = false;
    if (state.projectId !== project.id) {
      state.projectId = project.id;
      state.propTime = position;
      state.position = position;
      state.emitted = [];
      state.stopped = false;
      reported.current.clear();
      seek = true;
    }
    if (state.propTime !== position) {
      // An onTime echo is not a scrub. Retain a few in-flight echoes for concurrent renders.
      const echo = state.emitted.indexOf(position);
      if (echo >= 0) state.emitted.splice(0, echo + 1);
      else {
        state.position = position;
        state.emitted = [];
        state.stopped = false;
        seek = true;
      }
      state.propTime = position;
    }
    if (state.revision !== project.revision) {
      state.revision = project.revision;
      seek = true;
    }
    if (state.wasPlaying !== playing) {
      state.wasPlaying = playing;
      state.stopped = false;
      seek = true;
    }
    if (seek) state.running = false;
    state.position = Math.min(state.position, total);

    const sync = (at: number, force: boolean, checkOnly = false) => {
      let ready = true;
      const activeIds = new Set<string>();
      for (const { clip, track, asset } of layers) {
        if (!asset) continue;
        const active = at >= clip.start && at < clipEnd(clip);
        const needed = track.kind !== "audio" || (asset.hasAudio && clip.volume > 0);
        if (active && needed) activeIds.add(clip.id);
        const entry = media.current.get(clip.id);
        if (!entry) {
          if (active && needed) ready = false;
          continue;
        }
        const wasActive = entry.active;
        entry.active = active && needed;
        const node = entry.node;
        if (node instanceof HTMLImageElement) {
          if (active && node.complete && !node.naturalWidth) {
            warn(`media:${asset.id}`, `Could not load "${asset.name}". Check the source media and reload the preview.`);
            stop();
          } else if (active && !node.complete) ready = false;
          continue;
        }
        if (!entry.active) node.pause();
        if (node.error || (playing && entry.failure)) {
          if (entry.active) {
            warn(entry.failure === "NotAllowedError" ? "autoplay" : `media:${asset.id}`,
              entry.failure === "NotAllowedError"
                ? "The browser blocked preview playback. Click Play again to allow audio; on Safari you may need to allow autoplay for this site."
                : `Could not play "${asset.name}". Check the source media and your browser's media support.`);
            stop();
          }
          continue;
        }
        if (!needed || (!active && (clip.start > at + PREBUFFER || clipEnd(clip) <= at))) continue;

        const source = Math.max(clip.sourceIn, Math.min(clip.sourceOut, toSource(clip, active ? at : clip.start))) / TIMEBASE;
        const timing = `${clip.start}:${clip.sourceIn}:${clip.sourceOut}:${clip.speed}`;
        const changed = entry.timing !== timing || (active && !wasActive);
        try {
          if (node.playbackRate !== clip.speed) node.playbackRate = clip.speed;
          node.preservesPitch = true;
          const volume = entry.active && asset.hasAudio ? clip.volume * fade(clip, at) : 0;
          node.muted = volume === 0;
          node.volume = Math.min(1, volume);
          if (playing && entry.active && asset.hasAudio) {
            if (clip.volume > 1) warn("gain", "Browser preview volume is capped at 100%. Lower the clip volume for a matching preview; export preserves gain above 100%.");
            const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
              || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
            if (ios && (clip.volume !== 1 || clip.fadeIn || clip.fadeOut || clip.transition === "fade")) {
              warn("volume", "This Safari device may ignore preview volume and audio fades. Use a desktop browser to check the mix; export still applies these settings.");
            }
          }
          if (node.readyState >= HTMLMediaElement.HAVE_METADATA) {
            const drift = Math.abs(toTimeline(clip, node.currentTime * TIMEBASE) - (active ? at : clip.start));
            const precise = force || changed || !playing || !active;
            // Never repeatedly replace an outstanding seek: it can starve the decoder.
            if ((precise && (force || entry.target !== source || changed) && Math.abs(node.currentTime - source) > 0.001)
              || (!checkOnly && !node.seeking && !precise && drift > 80)) {
              node.currentTime = source;
              entry.target = source;
            }
            entry.timing = timing;
          }
        } catch {
          if (entry.active) {
            warn(`settings:${asset.id}`, `This browser cannot preview the speed or volume settings for "${asset.name}". Try a desktop browser or reset these settings.`);
            stop();
          }
        }
        if (entry.active && (node.seeking || entry.waiting
          || node.readyState < (playing ? HTMLMediaElement.HAVE_FUTURE_DATA : HTMLMediaElement.HAVE_CURRENT_DATA))) ready = false;
      }
      for (const [id, entry] of media.current) {
        if (!activeIds.has(id)) {
          entry.active = false;
          if (entry.node instanceof HTMLMediaElement) entry.node.pause();
        }
      }
      return ready;
    };

    let ready = sync(state.position, seek, state.running);
    if (playing && !state.stopped && ready && state.running && state.stamp) {
      state.position = Math.min(total, state.position + now - state.stamp);
      ready = sync(state.position, false);
    }
    if (playing && state.position >= total) stop();
    const run = playing && !state.stopped && ready && !document.hidden;
    let started = true;
    for (const entry of media.current.values()) {
      const node = entry.node;
      if (!(node instanceof HTMLMediaElement)) continue;
      if (!run || !entry.active) {
        node.pause();
        continue;
      }
      // play() on an ended element restarts its source, just before the timeline cut.
      if (!node.ended) playMedia(entry);
      if (node.paused && !node.ended) started = false;
    }
    state.running = run && started;
    state.stamp = now;
    const blocked = !ready && !state.stopped;
    if (state.buffering !== blocked) {
      state.buffering = blocked;
      setBuffering(blocked);
    }
    if (state.position !== time && state.emitted.at(-1) !== state.position) {
      state.emitted.push(state.position);
      if (state.emitted.length > 12) state.emitted.shift();
      onTime(state.position);
    }
  });

  const playFromGesture = useEffectEvent(() => {
    if (!playing || document.hidden || clock.current.buffering) return;
    for (const entry of media.current.values()) {
      if (entry.failure === "NotAllowedError") entry.failure = undefined;
      if (entry.active && entry.node instanceof HTMLMediaElement
        && !entry.node.ended && !entry.node.seeking
        && entry.node.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) playMedia(entry);
    }
  });

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const entries = media.current;
    let request = 0;
    let last = 0;
    const frame = (now: number) => {
      if (now - last >= FRAME_INTERVAL) {
        last = now - ((now - last) % FRAME_INTERVAL);
        tick(now);
      }
      request = requestAnimationFrame(frame);
    };
    const visibility = () => {
      clock.current.running = false;
      clock.current.stamp = 0;
      if (document.hidden) {
        for (const { node } of entries.values()) if (node instanceof HTMLMediaElement) node.pause();
      }
    };
    // Let React commit the parent's Play action, but stay in the user-activation task.
    const gesture = () => {
      queueMicrotask(() => playFromGesture());
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", gesture);
    document.addEventListener("keydown", gesture);
    request = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(request);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("click", gesture);
      document.removeEventListener("keydown", gesture);
      for (const { node } of entries.values()) if (node instanceof HTMLMediaElement) node.pause();
    };
  }, []);

  useEffect(() => {
    if (!playing) {
      clock.current.running = false;
      for (const { node } of media.current.values()) if (node instanceof HTMLMediaElement) node.pause();
    }
  }, [playing]);

  return (
    <div ref={stage} className="preview-stage" role="region" aria-label="Video preview" aria-busy={buffering}
      style={{ position: "relative", isolation: "isolate", width: "100%", height: "100%", aspectRatio: "16 / 9", overflow: "hidden", background: "#000" }}>
      {layers.map(({ clip, track, asset }, index) => {
        const active = position >= clip.start && position < clipEnd(clip);
        if (asset ? clipEnd(clip) <= position || clip.start > position + PREBUFFER : !active) return null;
        const effects = clip.effects;
        const region = 1 - 2 * effects.crop;
        const ratio = (asset?.width && asset.height) ? asset.width / asset.height : 16 / 9;
        const visual: CSSProperties = {
          position: "absolute", left: `${(0.5 + effects.x) * 100}%`, top: `${(0.5 + effects.y) * 100}%`,
          width: `${asset ? Math.min(1, ratio / (16 / 9)) * 100 : region * 100}%`,
          height: `${asset ? Math.min(1, (16 / 9) / ratio) * 100 : region * 100}%`,
          transform: `translate(-50%, -50%) rotate(${effects.rotation}deg) scale(${effects.scale})`,
          transformOrigin: "center", overflow: "hidden", zIndex: index + 1,
          visibility: active ? "visible" : "hidden", opacity: fade(clip, position), pointerEvents: "none",
          filter: `brightness(${1 + effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation})`,
        };
        const sourceStyle: CSSProperties = {
          position: "absolute", display: "block", maxWidth: "none", objectFit: "fill",
          // Enlarge the retained source region to fit, rather than merely masking its edges.
          width: `${100 / region}%`, height: `${100 / region}%`,
          left: `${-effects.crop / region * 100}%`, top: `${-effects.crop / region * 100}%`,
        };
        return <div key={`${project.id}:${clip.id}`} data-clip-id={clip.id}
          style={track.kind === "audio" ? { display: "none" } : visual}>
          {asset ? <PreviewAsset key={`${asset.id}:${track.kind}`} id={clip.id} asset={asset}
            url={`/api/editor/media/${project.id}/${asset.id}/${asset.kind === "image" ? "source" : "preview"}`}
            audioOnly={track.kind === "audio" || asset.kind === "audio"} style={sourceStyle} register={register} />
            : <div className="preview-text" style={{
              position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
              width: "max-content", maxWidth: `${80 / region / Math.max(1, effects.scale)}%`,
              color: clip.textColor, fontSize: clip.fontSize * width / 1280,
              fontFamily: "Arial, sans-serif", lineHeight: 1.2, textAlign: "center",
              whiteSpace: "pre-wrap", overflowWrap: "anywhere",
            }}>{clip.text}</div>}
        </div>;
      })}
      {!project.clips.length && <div className="preview-empty" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#a1a1aa" }}>
        <Film size={32} aria-hidden="true" /><span>Add media to start your story</span>
      </div>}
      {buffering && <div className="preview-buffering" role="status" style={{ position: "absolute", inset: 0, zIndex: layers.length + 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#fff", background: "#0006", pointerEvents: "none" }}>
        <Loader2 size={20} aria-hidden="true" /><span>Buffering preview...</span>
      </div>}
    </div>
  );
}
