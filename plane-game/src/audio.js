const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const smooth = (param, value, now, duration = 0.2) => {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, duration);
};

export class FlightAudio {
  constructor() {
    this.muted = true;
    this.volume = 0.45;
    this.active = false;
    this.context = null;
    this.sources = [];
    this.masterTarget = null;
  }

  async init() {
    try {
      if (!this.context) {
        const AudioContext =
          globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return false;
        const context = new AudioContext();
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = 0;
        this.masterTarget = null;
        this.master.connect(context.destination);

        this.engineFilter = context.createBiquadFilter();
        this.engineFilter.type = "lowpass";
        this.engineFilter.frequency.value = 1100;
        this.engineFilter.Q.value = 0.55;
        this.engineFilter.connect(this.master);
        this.engineGain = context.createGain();
        this.engineGain.gain.value = 0;
        this.engineGain.connect(this.engineFilter);
        this.engine = context.createOscillator();
        this.sources.push(this.engine);
        // A rounded four-cylinder firing waveform, not a bright sawtooth drone.
        const harmonics = new Float32Array([
          0, 1, 0.42, 0.24, 0.13, 0.07, 0.035, 0.015,
        ]);
        this.engine.setPeriodicWave(
          context.createPeriodicWave(
            new Float32Array(harmonics.length),
            harmonics,
          ),
        );
        this.engine.frequency.value = 70;
        this.engine.connect(this.engineGain);

        this.propGain = context.createGain();
        this.propGain.gain.value = 0;
        this.propGain.connect(this.engineFilter);
        this.prop = context.createOscillator();
        this.sources.push(this.prop);
        this.prop.type = "sine";
        this.prop.frequency.value = 35;
        this.prop.connect(this.propGain);

        const buffer = context.createBuffer(
          1,
          context.sampleRate * 2,
          context.sampleRate,
        );
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = Math.random() * 2 - 1;
        const noise = context.createBufferSource();
        this.sources.push(noise);
        noise.buffer = buffer;
        noise.loop = true;
        const highpass = context.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 180;
        highpass.Q.value = 0.5;
        this.airFilter = context.createBiquadFilter();
        this.airFilter.type = "lowpass";
        this.airFilter.frequency.value = 1200;
        this.airFilter.Q.value = 0.5;
        this.airGain = context.createGain();
        this.airGain.gain.value = 0;
        noise.connect(highpass);
        highpass.connect(this.airFilter);
        this.airFilter.connect(this.airGain);
        this.airGain.connect(this.master);

        const warning = context.createOscillator();
        this.sources.push(warning);
        warning.type = "sine";
        warning.frequency.value = 680;
        const pulse = context.createGain();
        pulse.gain.value = 0.5;
        const pulseOscillator = context.createOscillator();
        this.sources.push(pulseOscillator);
        pulseOscillator.frequency.value = 2.7;
        const pulseDepth = context.createGain();
        pulseDepth.gain.value = 0.5;
        pulseOscillator.connect(pulseDepth);
        pulseDepth.connect(pulse.gain);
        this.warningGain = context.createGain();
        this.warningGain.gain.value = 0;
        warning.connect(pulse);
        pulse.connect(this.warningGain);
        this.warningGain.connect(this.master);
        for (const source of this.sources) source.start();
      }
      const context = this.context;
      if (context.state === "suspended") await context.resume();
      if (this.context !== context) return false;
      this._syncMaster();
      return context.state === "running";
    } catch {
      await this.dispose();
      return false;
    }
  }

  _syncMaster() {
    if (!this.context || this.context.state === "closed") return;
    const target = this.active && !this.muted ? this.volume * 0.5 : 0;
    if (target === this.masterTarget) return;
    this.masterTarget = target;
    smooth(this.master.gain, target, this.context.currentTime, 0.12);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._syncMaster();
  }

  setVolume(volume) {
    this.volume = clamp(volume, 0, 1);
    this._syncMaster();
  }

  update(telemetry, throttle, active, cockpit = false) {
    this.active = Boolean(active);
    if (!this.context || this.context.state === "closed") return;
    this._syncMaster();
    const now = this.context.currentTime;
    const power = clamp(throttle, 0, 1);
    const rpm = clamp(telemetry.engineRPM, 0, 3500);
    const speed = clamp(telemetry.airspeed, 0, 160) / 100;
    const running = Math.min(1, rpm / 650);
    const engineLevel =
      (0.085 + power * 0.075) * running * (cockpit ? 0.85 : 1);
    smooth(this.engine.frequency, Math.max(18, rpm / 30), now, 0.3);
    smooth(this.prop.frequency, Math.max(9, rpm / 60), now, 0.3);
    smooth(this.engineGain.gain, engineLevel, now);
    smooth(this.propGain.gain, engineLevel * 0.2, now);
    smooth(
      this.engineFilter.frequency,
      (cockpit ? 550 : 900) + power * 450,
      now,
    );
    smooth(
      this.airGain.gain,
      Math.min(0.11, speed * speed * 0.065) * (cockpit ? 0.5 : 1),
      now,
      0.35,
    );
    smooth(
      this.airFilter.frequency,
      (cockpit ? 650 : 1100) + speed * 650,
      now,
      0.35,
    );
    const warn = this.active && telemetry.stallWarning && !telemetry.onGround;
    smooth(this.warningGain.gain, warn ? 0.022 : 0, now, 0.045);
  }

  async dispose() {
    const context = this.context;
    this.context = null;
    this.masterTarget = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* A partially initialized source may not have started. */
      }
      source.disconnect();
    }
    this.sources = [];
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        /* Audio support may have disappeared. */
      }
    }
  }
}
