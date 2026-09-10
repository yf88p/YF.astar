export function createAudio() {
  let context;
  let master;
  let noise;
  let muted = false;

  function init() {
    if (context) { context.resume().catch(() => {}); return; }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const data = noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.04) / 1.02;
      data[i] = brown * 3.5;
    }
    const wind = context.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    const gain = context.createGain();
    gain.gain.value = 0.22;
    wind.connect(filter).connect(gain).connect(master);
    wind.start();
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = context.createGain();
    depth.gain.value = 0.07;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
  }

  function tone(frequency, duration, gain = 0.1, delay = 0, end = frequency) {
    if (!context) return;
    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const envelope = context.createGain();
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope).connect(master);
    osc.start(start);
    osc.stop(start + duration);
  }

  function burst(duration, gain, cutoff, delay = 0) {
    if (!context) return;
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start(start, Math.random());
    source.stop(start + duration);
  }

  return {
    init,
    mute(value) { muted = value; init(); if (master) master.gain.setTargetAtTime(value ? 0 : 0.55, context.currentTime, 0.08); },
    shot() {
      burst(0.15, 5, 700);
      tone(160, 0.24, 0.8, 0, 32);
      burst(0.7, 1.1, 200, 0.18);
      burst(0.9, 0.4, 100, 0.49);
      burst(0.07, 0.65, 1800, 0.6);
      tone(720, 0.055, 0.075, 0.72, 260);
    },
    reload() { burst(0.12, 0.7, 1400); burst(0.1, 0.8, 1100, 0.8); tone(1100, 0.1, 0.1, 1.6, 300); },
    scope() { burst(0.08, 0.3, 1800); },
    hit(head) { tone(head ? 1160 : 780, 0.13, 0.13, 0, 420); },
    empty() { tone(200, 0.05, 0.17, 0, 80); },
    complete() { [330, 440, 660].forEach((freq, i) => tone(freq, 1.8, 0.12, i * 0.22)); },
    suspend() { context?.suspend().catch(() => {}); },
  };
}
