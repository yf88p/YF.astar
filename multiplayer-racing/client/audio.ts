export class RaceAudio {
  private context: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private volume = 0;
  unlock() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    this.context = new AudioContext();
    this.engine = this.context.createOscillator();
    this.gain = this.context.createGain();
    this.filter = this.context.createBiquadFilter();
    this.engine.type = "sawtooth";
    this.filter.type = "lowpass";
    this.filter.frequency.value = 350;
    this.gain.gain.value = 0;
    this.engine
      .connect(this.filter)
      .connect(this.gain)
      .connect(this.context.destination);
    this.engine.start();
  }
  update(speed: number, throttle: number, drift: boolean, volume: number) {
    this.volume = volume;
    if (!this.context || !this.engine || !this.gain || !this.filter) return;
    const time = this.context.currentTime;
    const rpm = (Math.abs(speed) % 14) / 14;
    this.engine.frequency.setTargetAtTime(
      36 + rpm * 65 + Math.abs(throttle) * 12,
      time,
      0.06,
    );
    this.filter.frequency.setTargetAtTime(
      drift ? 950 : 230 + rpm * 350,
      time,
      0.1,
    );
    this.gain.gain.setTargetAtTime(
      volume * (0.035 + Math.abs(throttle) * 0.035),
      time,
      0.05,
    );
  }
  tone(kind: "checkpoint" | "impact" | "finish" | "countdown") {
    if (!this.context || !this.volume) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = kind === "impact" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(
      kind === "impact"
        ? 75
        : kind === "finish"
          ? 880
          : kind === "countdown"
            ? 440
            : 660,
      now,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "impact" ? 30 : 1100,
      now + 0.2,
    );
    gain.gain.setValueAtTime(this.volume * 0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  }
  close() {
    void this.context?.close();
    this.context = null;
  }
}
