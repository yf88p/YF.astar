import type { PhysicsImpact } from './physics';

/** Tiny synthesized glass resonances. Audio is only unlocked by a user gesture. */
export class ImpactAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastImpact = 0;
  enabled = false;

  async setEnabled(enabled: boolean): Promise<boolean> {
    this.enabled = enabled;
    if (!enabled) {
      if (this.master && this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
      return false;
    }
    try {
      this.context ??= new AudioContext();
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      await this.context.resume();
      this.master.gain.setTargetAtTime(this.enabled ? 0.35 : 0, this.context.currentTime, 0.02);
      return this.enabled;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  impact = ({ speed, x, kind }: PhysicsImpact): void => {
    const ctx = this.context;
    if (!this.enabled || !ctx || !this.master || ctx.state !== 'running' || speed < 0.8) return;
    const now = ctx.currentTime;
    if (now - this.lastImpact < 0.047) return;
    this.lastImpact = now;
    const frequency = (kind === 'shell' ? 720 : 1350) + Math.random() * 520;
    const volume = Math.min(0.15, speed * 0.013);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.7, Math.min(0.7, x / 5));
    pan.connect(this.master);
    for (const [ratio, gain] of [[1, 1], [2.76, 0.3], [4.9, 0.08]]) {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency * ratio, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * 0.92, now + 0.16);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * gain), now + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      oscillator.connect(envelope);
      envelope.connect(pan);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        if (ratio === 4.9) pan.disconnect();
      };
    }
  };

  dispose(): void {
    this.enabled = false;
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
