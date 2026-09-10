import { Vector3 } from "three";
import { mapPoint } from "./core.js";

export class SpatialAudio {
  constructor() {
    this.volume = 0.35;
    this.muted = false;
    this.context = null;
  }
  async unlock() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    this.master.gain.value = this.muted ? 0 : this.volume;
    await this.context.resume();
  }
  setVolume(value) {
    this.volume = value;
    if (this.master) this.master.gain.value = this.muted ? 0 : value;
  }
  setMuted(value) {
    this.muted = value;
    if (this.master) this.master.gain.value = value ? 0 : this.volume;
  }
  update(frame) {
    if (!this.context) return;
    const l = this.context.listener,
      p = frame.position,
      f = new Vector3(0, 0, -1).applyQuaternion(frame.quaternion),
      u = new Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
    if (l.positionX) {
      [l.positionX.value, l.positionY.value, l.positionZ.value] = p.toArray();
      [l.forwardX.value, l.forwardY.value, l.forwardZ.value] = f.toArray();
      [l.upX.value, l.upY.value, l.upZ.value] = u.toArray();
    }
  }
  event(event, world) {
    if (!this.context || this.context.state !== "running" || this.muted) return;
    const pitches = {
      pickup: 440,
      drop: 180,
      throw: 270,
      crossing: 115,
      plate: event.active ? 660 : 220,
      door: event.active ? 330 : 140,
      complete: 880,
    };
    if (!pitches[event.type]) return;
    const ctx = this.context,
      now = ctx.currentTime,
      osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      pan = ctx.createPanner();
    let entity =
      world.cubes.get(event.id) ||
      world.doc.plates.find((p) => p.id === event.id) ||
      world.doc.doors.find((p) => p.id === event.id) ||
      world.player;
    let point = entity.position?.isVector3
      ? entity.position.clone()
      : new Vector3().fromArray(entity.position);
    if (entity.room !== world.player.room) {
      const exit = world.doc.portals.find(
        (p) =>
          p.room === entity.room &&
          world.portals.get(p.linkedTo)?.room === world.player.room,
      );
      if (!exit) return;
      point = mapPoint(point, exit, world.portals.get(exit.linkedTo));
    }
    pan.panningModel = "HRTF";
    pan.distanceModel = "inverse";
    pan.refDistance = 2;
    pan.maxDistance = 30;
    pan.rolloffFactor = 0.7;
    pan.positionX.value = point.x;
    pan.positionY.value = point.y;
    pan.positionZ.value = point.z;
    const duration =
      event.type === "crossing" ? 0.5 : event.type === "complete" ? 0.9 : 0.24;
    osc.type = event.type === "crossing" ? "sine" : "triangle";
    osc.frequency.setValueAtTime(pitches[event.type], now);
    osc.frequency.exponentialRampToValueAtTime(
      pitches[event.type] * (event.type === "crossing" ? 2.4 : 1.2),
      now + duration,
    );
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
  }
}
