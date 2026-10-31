// Tiny WebAudio synthesizer: no external assets, everything generated on demand.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuf = null;
    this.lastHit = 0;
    this.lastRail = 0;
    this.volume = 0.55;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.35);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone({ freq = 440, endFreq = freq, dur = 0.1, type = 'sine', vol = 0.2, attack = 0.003, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.08, vol = 0.15, freq = 1800, q = 0.8, type = 'highpass', delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  ballHit(speed, cue = false) {
    if (!this.ctx || this.muted) return;
    const now = this.now();
    if (now - this.lastHit < 0.014) return;
    this.lastHit = now;
    const intensity = Math.min(1, Math.max(0.08, speed / 1500));
    const base = 760 + Math.min(900, speed * 0.55) + Math.random() * 140;
    this.noise({ dur: 0.026, vol: 0.08 * intensity, freq: 2600, type: 'highpass' });
    this.tone({ freq: base, endFreq: base * 0.72, dur: 0.055, type: 'triangle', vol: 0.16 * intensity });
    if (cue) {
      this.tone({ freq: base * 1.5, endFreq: base, dur: 0.03, type: 'sine', vol: 0.07 * intensity });
    }
  }

  rail(speed) {
    if (!this.ctx || this.muted) return;
    const now = this.now();
    if (now - this.lastRail < 0.035) return;
    this.lastRail = now;
    const intensity = Math.min(1, Math.max(0.08, speed / 1400));
    this.tone({ freq: 150, endFreq: 68, dur: 0.1, type: 'sine', vol: 0.17 * intensity });
    this.noise({ dur: 0.055, vol: 0.075 * intensity, freq: 700, type: 'lowpass' });
  }

  pocket() {
    if (!this.ctx || this.muted) return;
    this.tone({ freq: 240, endFreq: 54, dur: 0.2, type: 'sine', vol: 0.24 });
    this.noise({ dur: 0.16, vol: 0.09, freq: 500, type: 'lowpass' });
    setTimeout(() => {
      this.tone({ freq: 170, endFreq: 90, dur: 0.05, type: 'triangle', vol: 0.09 });
      this.tone({ freq: 128, endFreq: 70, dur: 0.06, type: 'triangle', vol: 0.07, delay: 0.055 });
    }, 90);
  }

  cueStrike(power = 0.5) {
    if (!this.ctx || this.muted) return;
    const p = Math.min(1, Math.max(0.15, power));
    this.noise({ dur: 0.04, vol: 0.12 + p * 0.12, freq: 1600, type: 'highpass' });
    this.tone({ freq: 520 + p * 180, endFreq: 200, dur: 0.05, type: 'square', vol: 0.05 + p * 0.05 });
    this.tone({ freq: 130, endFreq: 62, dur: 0.08, type: 'sine', vol: 0.12 + p * 0.1 });
  }

  foul() {
    if (!this.ctx || this.muted) return;
    this.tone({ freq: 210, endFreq: 145, dur: 0.15, type: 'sawtooth', vol: 0.08 });
    this.tone({ freq: 165, endFreq: 108, dur: 0.2, type: 'sawtooth', vol: 0.07, delay: 0.13 });
  }

  turn() {
    if (!this.ctx || this.muted) return;
    this.tone({ freq: 660, endFreq: 660, dur: 0.08, type: 'sine', vol: 0.07 });
    this.tone({ freq: 990, endFreq: 990, dur: 0.11, type: 'sine', vol: 0.055, delay: 0.075 });
  }

  win() {
    if (!this.ctx || this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ freq: f, endFreq: f, dur: 0.28, type: 'triangle', vol: 0.11, delay: i * 0.09 });
      this.tone({ freq: f / 2, endFreq: f / 2, dur: 0.3, type: 'sine', vol: 0.055, delay: i * 0.09 });
    });
  }

  lose() {
    if (!this.ctx || this.muted) return;
    const notes = [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => {
      this.tone({ freq: f, endFreq: f * 0.98, dur: 0.32, type: 'triangle', vol: 0.09, delay: i * 0.13 });
    });
  }

  ui() {
    if (!this.ctx || this.muted) return;
    this.tone({ freq: 880, endFreq: 1180, dur: 0.045, type: 'sine', vol: 0.045 });
  }

  coin() {
    if (!this.ctx || this.muted) return;
    this.tone({ freq: 1180, endFreq: 1560, dur: 0.07, type: 'sine', vol: 0.06 });
    this.tone({ freq: 1560, endFreq: 1900, dur: 0.1, type: 'sine', vol: 0.05, delay: 0.055 });
  }
}
