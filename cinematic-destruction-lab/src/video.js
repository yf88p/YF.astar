import { Vector2 } from 'three';

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;
const CODEC = 'vp09.00.10.08';
const exporting = new WeakSet();

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Video export was cancelled.', 'AbortError');
}

// webm-muxer 5.x writes the last frame's START as Segment/Info/Duration,
// ignoring VideoFrame.duration. Correct the existing float without moving any
// bytes or invalidating seek/cue offsets. Parse EBML, never scan encoded pixels.
function setWebMDuration(buffer, duration) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const readVint = (offset, isId) => {
    const first = bytes[offset];
    if (!first) throw new Error('Invalid WebM element header.');
    let length = 1, marker = 0x80;
    while (!(first & marker)) { length++; marker >>= 1; }
    if (length > (isId ? 4 : 8) || offset + length > bytes.length) throw new Error('Invalid WebM element size.');
    let value = isId ? first : first & (marker - 1);
    for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
    return { value, length };
  };
  const visit = (start, end) => {
    for (let offset = start; offset < end;) {
      const id = readVint(offset, true), size = readVint(offset + id.length, false);
      const data = offset + id.length + size.length, next = data + size.value;
      if (next > end || next <= offset) throw new Error('Invalid WebM element boundary.');
      if (id.value === 0x4489) {
        if (size.value !== 8) throw new Error('Unexpected WebM duration encoding; update the export adapter.');
        view.setFloat64(data, duration * 1000, false);
        return true;
      }
      if ((id.value === 0x18538067 || id.value === 0x1549a966) && visit(data, next)) return true;
      offset = next;
    }
    return false;
  };
  if (!visit(0, bytes.length)) throw new Error('The WebM muxer did not write seekable duration metadata. Use webm-muxer 5.x.');
}

/**
 * Offline, timestamp-driven VP9 export. Requires `npm install webm-muxer@^5`.
 * The caller must suspend its animation/simulation loop for the whole promise.
 * onProgress(fraction, details) receives [0, 1]; details and blob.metadata report
 * exact duration, fps, frame count, resolution, codec, and physical duration.
 * No wall-clock capture fallback: unsupported browsers fail rather than drift.
 */
export async function exportVideo({ viewport, recorder, speed = 0.25, cameraMode = 'path', onProgress = () => {}, signal } = {}) {
  checkAbort(signal);
  if (!viewport?.renderer || viewport.disposed) throw new Error('Create a live viewport before exporting.');
  if (!recorder?.sample || !Number.isFinite(recorder.duration) || recorder.duration <= 0) throw new Error('Record at least one physics step before exporting video.');
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Playback speed must be a positive number.');
  if (!['orbit', 'tracking', 'path'].includes(cameraMode)) throw new Error('Choose orbit, tracking, or path for the export camera.');
  const duration = recorder.duration / speed;
  if (recorder.duration > 12 || duration > 120) throw new Error('Export supports up to 12 physical seconds and 120 video seconds. Increase playback speed or shorten the take.');
  if (!globalThis.isSecureContext || !globalThis.VideoEncoder || !globalThis.VideoFrame) throw new Error('Deterministic video export requires WebCodecs. Open this app in current desktop Chrome or Edge using HTTPS or localhost. You can still export a PNG.');
  if (exporting.has(viewport)) throw new Error('An export is already using this viewport. Wait for it to finish or cancel it.');
  exporting.add(viewport);

  let encoder, saved, encodingError;
  const { renderer, camera, controls } = viewport;
  try {
    const config = { codec: CODEC, width: WIDTH, height: HEIGHT, bitrate: 7_000_000, framerate: FPS, latencyMode: 'quality', hardwareAcceleration: 'no-preference', alpha: 'discard' };
    let supported;
    try { supported = await VideoEncoder.isConfigSupported(config); }
    catch { throw new Error('This browser cannot configure a VP9 WebCodecs encoder. Use current desktop Chrome or Edge, or export a PNG.'); }
    if (!supported.supported) throw new Error('VP9 encoding at 1280 x 720 is unavailable in this browser. Use current desktop Chrome or Edge, or export a PNG.');
    let Muxer, ArrayBufferTarget;
    try { ({ Muxer, ArrayBufferTarget } = await import('webm-muxer')); }
    catch { throw new Error('The WebM muxer is missing. Install it with npm install webm-muxer@^5, then restart the development server.'); }
    checkAbort(signal);

    const frames = Math.ceil(duration * FPS - 1e-9);
    const metadata = Object.freeze({ duration, physicalDuration: recorder.duration, speed, fps: FPS, frames, width: WIDTH, height: HEIGHT, codec: 'VP9', codecString: CODEC, mimeType: 'video/webm;codecs=vp9' });
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'V_VP9', width: WIDTH, height: HEIGHT, frameRate: FPS }, firstTimestampBehavior: 'strict' });
    let encodedFrames = 0;
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); encodedFrames++; }
        catch (error) { encodingError = error; }
      },
      error: error => { encodingError = error; },
    });
    encoder.configure(supported.config);
    saved = {
      snapshot: viewport.snapshot, time: viewport.time, layers: { ...viewport.layers }, enabled: viewport.enabled,
      size: renderer.getSize(new Vector2()), pixelRatio: renderer.getPixelRatio(), outputSize: viewport._outputSize,
      position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone(), fov: camera.fov,
      controlsEnabled: controls.enabled, pointerEvents: renderer.domElement.style.pointerEvents,
    };
    viewport.setEnabled(false);
    viewport.setLayers({ presentation: true });
    controls.enabled = false;
    renderer.domElement.style.pointerEvents = 'none';
    viewport.resize(WIDTH, HEIGHT, 1);
    onProgress(0, { ...metadata, phase: 'encoding', completedFrames: 0 });

    for (let index = 0; index < frames; index++) {
      checkAbort(signal);
      if (encodingError) throw encodingError;
      const presentationTime = index / FPS;
      const physicalTime = Math.min(recorder.duration, presentationTime * speed);
      viewport.renderAt(recorder.sample(physicalTime), physicalTime, { cameraMode });
      if (renderer.getContext().isContextLost()) throw new Error('The graphics context was lost during export. Reload the project and close other GPU-heavy tabs before retrying.');
      const timestamp = Math.round(presentationTime * 1_000_000);
      const end = Math.round(Math.min(duration, (index + 1) / FPS) * 1_000_000);
      const frame = new VideoFrame(renderer.domElement, { timestamp, duration: Math.max(1, end - timestamp), alpha: 'discard' });
      try { encoder.encode(frame, { keyFrame: index % FPS === 0 }); }
      finally { frame.close(); }
      // Bounded work and queue depth keep memory predictable even on software
      // encoders. Yield via tasks, not RAF, so background-tab export still works.
      if (encoder.encodeQueueSize >= 8 || (index + 1) % 12 === 0) {
        await encoder.flush();
        if (encodingError) throw encodingError;
        checkAbort(signal);
        onProgress((index + 1) / frames * 0.98, { ...metadata, phase: 'encoding', completedFrames: index + 1 });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    await encoder.flush();
    checkAbort(signal);
    if (encodingError) throw encodingError;
    if (encodedFrames !== frames) throw new Error(`The encoder returned ${encodedFrames} of ${frames} frames. No incomplete video was saved; retry in desktop Chrome or Edge.`);
    onProgress(0.99, { ...metadata, phase: 'muxing', completedFrames: frames });
    muxer.finalize();
    setWebMDuration(target.buffer, duration);
    const blob = new Blob([target.buffer], { type: metadata.mimeType });
    Object.defineProperty(blob, 'metadata', { value: metadata, enumerable: true });
    onProgress(1, { ...metadata, phase: 'complete', completedFrames: frames });
    return blob;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Video export was cancelled.', 'AbortError');
    if (error.name === 'NotSupportedError' || error.name === 'EncodingError') throw new Error(`VP9 export failed: ${error.message}. Try current desktop Chrome or Edge with other GPU-heavy tabs closed.`, { cause: error });
    throw error;
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    try {
      if (saved && !viewport.disposed) {
        if (saved.outputSize) viewport.resize(saved.size.x, saved.size.y, saved.pixelRatio);
        else viewport.resize();
        viewport.setLayers(saved.layers);
        viewport.setEnabled(saved.enabled);
        camera.position.copy(saved.position); camera.quaternion.copy(saved.quaternion); camera.fov = saved.fov;
        camera.updateProjectionMatrix();
        controls.target.copy(saved.target); controls.enabled = saved.controlsEnabled;
        renderer.domElement.style.pointerEvents = saved.pointerEvents;
        viewport.renderAt(saved.snapshot, saved.time, { cameraMode: 'orbit' });
      }
    } finally { exporting.delete(viewport); }
  }
}

/** Capture the current framing, optionally suppressing all authoring helpers. */
export async function exportStill(viewport, { type = 'image/png', quality = 0.95, presentation = true } = {}) {
  if (!viewport?.renderer || viewport.disposed) throw new Error('Create a live viewport before exporting a still.');
  if (exporting.has(viewport)) throw new Error('Wait for the current export to finish before exporting a still.');
  exporting.add(viewport);
  const layers = { ...viewport.layers };
  try {
    viewport.setLayers({ presentation });
    viewport.renderAt(viewport.snapshot, viewport.time, { cameraMode: 'orbit' });
    return await new Promise((resolve, reject) => viewport.renderer.domElement.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not capture this frame. Reduce the viewport size and try again.'));
    }, type, quality));
  } finally {
    try {
      if (!viewport.disposed) { viewport.setLayers(layers); viewport.renderAt(viewport.snapshot, viewport.time, { cameraMode: 'orbit' }); }
    } finally { exporting.delete(viewport); }
  }
}
