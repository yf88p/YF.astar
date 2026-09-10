const clamp = (value, min = 0, max = 1) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;

const TOOLS = {
  loop: {
    frequency: 1450,
    q: 0.9,
    dry: 0.19,
    wet: 0.11,
    grit: 12,
    pitch: 2500,
  },
  rib: { frequency: 750, q: 0.65, dry: 0.16, wet: 0.12, grit: 6, pitch: 1700 },
  needle: {
    frequency: 3200,
    q: 1.3,
    dry: 0.105,
    wet: 0.055,
    grit: 19,
    pitch: 4300,
  },
  sponge: {
    frequency: 650,
    q: 0.5,
    dry: 0.045,
    wet: 0.23,
    grit: 2,
    pitch: 1100,
  },
};

export class PotteryAudio {
  constructor() {
    this.enabled = false;
    this.volume = 0.65;
    this._context = null;
    this._graph = null;
    this._nodes = [];
    this._sources = [];
    this._voices = new Set();
    this._requested = false;
    this._disposed = false;
    this._suspendTimer = null;
    this._nextGrit = 0;
    this._nextTexture = 0;
    this._texture = 1;
    this._state = {
      contact: false,
      tool: "loop",
      pressure: 0,
      speed: 0,
      wetness: 0.5,
      x: 0,
      wheel: false,
      resistance: 0,
    };
  }

  // Call directly from a user gesture; construction and frame updates stay silent.
  async enable() {
    if (this._disposed) return false;
    this._requested = true;
    clearTimeout(this._suspendTimer);
    try {
      if (this._context?.state === "closed") this._release();
      if (!this._context) this._initialize();
      const context = this._context;
      if (!context) {
        this._requested = false;
        return false;
      }
      if (context.state !== "running") await context.resume();
      if (this._disposed || !this._requested || context !== this._context)
        return false;
      this.enabled = context.state === "running";
      if (this.enabled) {
        this.update(this._state);
        this._smooth(this._graph.master.gain, this.volume * 0.65, 0.06);
      }
      return this.enabled;
    } catch {
      this.enabled = false;
      this._requested = false;
      this._release();
      return false;
    }
  }

  setEnabled(enabled) {
    if (enabled) return this.enable();
    if (this._disposed) return;
    this._requested = false;
    this.enabled = false;
    clearTimeout(this._suspendTimer);
    const context = this._context;
    if (!context || !this._graph) return;
    this._smooth(this._graph.master.gain, 0, 0.015);
    // Let the output decay before suspending, rather than cutting a waveform.
    this._suspendTimer = setTimeout(() => {
      if (
        !this._requested &&
        context === this._context &&
        context.state === "running"
      ) {
        context.suspend().catch(() => {});
      }
    }, 120);
  }

  setVolume(value) {
    this.volume = clamp(value);
    if (this._graph && this.enabled) {
      this._smooth(this._graph.master.gain, this.volume * 0.65, 0.045);
    }
  }

  update({
    contact = false,
    tool = "loop",
    pressure = 0,
    speed = 0,
    wetness = 0.5,
    x = 0,
    wheel = false,
    resistance = 0,
  } = {}) {
    if (this._disposed) return;
    const state = this._state;
    state.contact = Boolean(contact);
    state.tool = Object.hasOwn(TOOLS, tool) ? tool : "loop";
    state.pressure = clamp(pressure);
    state.speed = clamp(speed);
    state.wetness = clamp(wetness);
    state.x = clamp(x, -1, 1);
    state.wheel = Boolean(wheel);
    state.resistance = clamp(resistance);
    if (!this.enabled || !this._graph || this._context.state !== "running")
      return;

    const {
      motor,
      harmonic,
      motorGain,
      dryFilter,
      dryGain,
      wetFilter,
      wetGain,
      friction,
      frictionDepth,
      pan,
    } = this._graph;
    const profile = TOOLS[state.tool];
    const now = this._context.currentTime;
    const motion = Math.sqrt(
      Math.min(1, state.speed + (state.wheel ? 0.08 : 0)),
    );
    const energy = state.contact ? Math.sqrt(state.pressure) * motion : 0;
    const dry = 1 - state.wetness;
    if (now >= this._nextTexture) {
      this._texture = 0.86 + Math.random() * 0.28;
      this._nextTexture = now + 0.045 + Math.random() * 0.075;
    }

    this._smooth(
      motor.frequency,
      51 + state.speed * 9 + Math.sin(now * 1.7) * 0.7,
      0.2,
    );
    this._smooth(harmonic.frequency, 103 + state.speed * 18, 0.2);
    this._smooth(
      motorGain.gain,
      state.wheel ? 0.025 + state.speed * 0.012 : 0,
      0.18,
    );
    this._smooth(
      dryFilter.frequency,
      profile.frequency * (0.65 + state.speed * 0.65) * (0.55 + dry * 0.45),
      0.05,
    );
    this._smooth(dryFilter.Q, profile.q, 0.05);
    this._smooth(
      dryGain.gain,
      energy * profile.dry * (0.3 + dry * 0.7) * this._texture,
    );
    this._smooth(
      wetFilter.frequency,
      350 + state.speed * 1000 + state.wetness * 250,
    );
    this._smooth(
      wetGain.gain,
      energy * profile.wet * (0.12 + state.wetness * 0.88),
    );
    // Slow, deeper stick-slip on resistant dry clay; wet clay stays smoother.
    this._smooth(
      friction.frequency,
      (9 + state.speed * 58) * (1 - state.resistance * 0.5) * this._texture,
      0.065,
    );
    this._smooth(
      frictionDepth.gain,
      0.025 + state.resistance * dry * 0.28,
      0.065,
    );
    if (pan.pan) this._smooth(pan.pan, state.x, 0.035);

    if (energy > 0.01 && now >= this._nextGrit) {
      this._grain(energy * (0.3 + dry * 0.7), state.x);
      const rate = profile.grit * (0.3 + motion * 0.7) * (0.25 + dry * 0.75);
      // Random waiting times avoid a machine-gun rhythm; never catch up missed frames.
      this._nextGrit =
        now + 0.035 - Math.log(Math.max(0.001, Math.random())) / rate;
    } else if (energy <= 0.01) {
      this._nextGrit = now;
    }
  }

  chip(strength = 0.5, x = 0) {
    if (!this.enabled || !this._graph || this._context.state !== "running")
      return;
    this._grain(clamp(strength), clamp(x, -1, 1), true);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.enabled = false;
    this._requested = false;
    clearTimeout(this._suspendTimer);
    if (!this._context || !this._graph || this._context.state !== "running") {
      this._release();
      return;
    }
    this._smooth(this._graph.master.gain, 0, 0.012);
    this._suspendTimer = setTimeout(() => this._release(), 100);
  }

  _smooth(parameter, value, time = 0.035) {
    const now = this._context.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, time);
  }

  _initialize() {
    const AudioContext =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext({ latencyHint: "interactive" });
    this._context = context;
    const node = (value) => {
      this._nodes.push(value);
      return value;
    };
    const oscillator = (type, frequency) => {
      const source = node(context.createOscillator());
      source.type = type;
      source.frequency.value = frequency;
      this._sources.push(source);
      return source;
    };

    const master = node(context.createGain());
    master.gain.value = 0;
    const limiter = node(context.createDynamicsCompressor());
    limiter.threshold.value = -18;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.16;
    master.connect(limiter).connect(context.destination);

    // A quiet fundamental and softened harmonic suggest a motor, not a musical drone.
    const motor = oscillator("sine", 51);
    const harmonic = oscillator("triangle", 103);
    const harmonicGain = node(context.createGain());
    harmonicGain.gain.value = 0.16;
    const motorGain = node(context.createGain());
    motorGain.gain.value = 0;
    motor.connect(motorGain);
    harmonic.connect(harmonicGain).connect(motorGain);
    motorGain.connect(master);

    const noise = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * 3.37),
      context.sampleRate,
    );
    const samples = noise.getChannelData(0);
    const edge = Math.ceil(context.sampleRate * 0.004);
    let low = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1;
      low = low * 0.98 + white * 0.02;
      // A little correlated low-frequency noise adds body; taper the loop seam.
      samples[i] =
        (white * 0.6 + low * 2) *
        Math.min(1, i / edge, (samples.length - 1 - i) / edge);
    }
    const noiseSource = () => {
      const source = node(context.createBufferSource());
      source.buffer = noise;
      source.loop = true;
      this._sources.push(source);
      return source;
    };
    const scrape = noiseSource();
    const smear = noiseSource();
    const dryFilter = node(context.createBiquadFilter());
    dryFilter.type = "bandpass";
    dryFilter.frequency.value = 1450;
    dryFilter.Q.value = 0.9;
    const dryGain = node(context.createGain());
    dryGain.gain.value = 0;
    const frictionGain = node(context.createGain());
    frictionGain.gain.value = 0.72;
    const friction = oscillator("sine", 18);
    const frictionDepth = node(context.createGain());
    frictionDepth.gain.value = 0.025;
    friction.connect(frictionDepth).connect(frictionGain.gain);

    const wetHighpass = node(context.createBiquadFilter());
    wetHighpass.type = "highpass";
    wetHighpass.frequency.value = 130;
    wetHighpass.Q.value = 0.5;
    const wetFilter = node(context.createBiquadFilter());
    wetFilter.type = "lowpass";
    wetFilter.frequency.value = 700;
    wetFilter.Q.value = 0.5;
    const wetGain = node(context.createGain());
    wetGain.gain.value = 0;
    const pan = node(
      context.createStereoPanner
        ? context.createStereoPanner()
        : context.createGain(),
    );
    scrape
      .connect(dryFilter)
      .connect(frictionGain)
      .connect(dryGain)
      .connect(pan);
    smear.connect(wetHighpass).connect(wetFilter).connect(wetGain).connect(pan);
    pan.connect(master);

    this._graph = {
      master,
      motor,
      harmonic,
      motorGain,
      noise,
      dryFilter,
      dryGain,
      wetFilter,
      wetGain,
      friction,
      frictionDepth,
      pan,
    };
    const now = context.currentTime;
    motor.start(now);
    harmonic.start(now);
    friction.start(now);
    scrape.start(now);
    smear.start(now, noise.duration * 0.43);
    this._nextGrit = now;
    this._nextTexture = now;
  }

  _grain(strength, x, chip = false) {
    if (strength <= 0 || this._voices.size >= 12) return;
    const context = this._context;
    const now = context.currentTime;
    const { wetness, tool } = this._state;
    const duration = chip
      ? 0.028 + strength * 0.035
      : 0.012 + wetness * 0.022 + Math.random() * 0.012;
    const source = context.createBufferSource();
    source.buffer = this._graph.noise;
    source.loop = true;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = Math.min(
      context.sampleRate * 0.45,
      TOOLS[tool].pitch * (0.7 + Math.random() * 0.6) * (1 - wetness * 0.45),
    );
    filter.Q.value = chip ? 0.9 : 0.6;
    const gain = context.createGain();
    const pan = context.createStereoPanner
      ? context.createStereoPanner()
      : context.createGain();
    if (pan.pan) pan.pan.value = x;
    source
      .connect(filter)
      .connect(gain)
      .connect(pan)
      .connect(this._graph.master);
    // Rounded attacks and short filtered tails make clay flecks, not sharp clicks.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      strength * (chip ? 0.13 : 0.045) * (1 - wetness * 0.3),
      now + 0.003,
    );
    gain.gain.exponentialRampToValueAtTime(0.00001, now + duration);
    gain.gain.linearRampToValueAtTime(0, now + duration + 0.006);
    const voice = { source, nodes: [source, filter, gain, pan] };
    this._voices.add(voice);
    source.onended = () => {
      voice.nodes.forEach((node) => node.disconnect());
      this._voices.delete(voice);
    };
    source.start(now, Math.random() * this._graph.noise.duration);
    source.stop(now + duration + 0.01);
  }

  _release() {
    const context = this._context;
    this._context = null;
    this._graph = null;
    for (const voice of this._voices) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        /* Already stopped. */
      }
      voice.nodes.forEach((node) => node.disconnect());
    }
    this._voices.clear();
    for (const source of this._sources) {
      try {
        source.stop();
      } catch {
        /* Initialization may have stopped before start(). */
      }
    }
    this._sources = [];
    this._nodes.forEach((node) => node.disconnect());
    this._nodes = [];
    if (context && context.state !== "closed") context.close().catch(() => {});
  }
}
