// audio.js — every sound is synthesised with WebAudio: no audio files, nothing to load.
// Engine hum and police sirens are continuous voices the game starts and stops; shots,
// punches, crashes and jingles are one-shot voices built from oscillators and noise.

/** The whole sound engine: one context, a master gain, and a small music sequencer. */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  /** Create the context on the first user gesture (browsers refuse sound before one). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startMusic();
    } catch {
      this.ctx = null;
    }
  }

  /** A short tone with an envelope: the building block of most effects. */
  tone(freqFrom, freqTo, seconds, type, volume, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + seconds);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  /** A burst of filtered noise: gunshots, crashes, punches. */
  noise(seconds, volume, filterFreq, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t0);
  }

  click() {
    this.tone(660, 440, 0.07, 'square', 0.12);
  }

  punch() {
    this.noise(0.09, 0.5, 500);
    this.tone(120, 50, 0.1, 'sine', 0.4);
  }

  shot() {
    this.noise(0.16, 0.7, 2600);
    this.tone(220, 40, 0.12, 'sawtooth', 0.25);
  }

  dryFire() {
    this.tone(1200, 900, 0.04, 'square', 0.1);
  }

  crash(intensity) {
    this.noise(0.3, Math.min(0.8, 0.25 + intensity * 0.08), 700);
    this.tone(90, 35, 0.3, 'triangle', 0.4);
  }

  thud() {
    this.noise(0.14, 0.5, 400);
    this.tone(80, 40, 0.16, 'sine', 0.5);
  }

  pickup() {
    this.tone(740, 740, 0.08, 'sine', 0.25);
    this.tone(1180, 1180, 0.12, 'sine', 0.25, 0.08);
  }

  cash() {
    this.tone(990, 990, 0.07, 'triangle', 0.3);
    this.tone(1320, 1320, 0.07, 'triangle', 0.3, 0.07);
    this.tone(1760, 1760, 0.14, 'triangle', 0.3, 0.14);
  }

  missionPass() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.22, 'triangle', 0.3, i * 0.11));
  }

  missionFail() {
    const notes = [392, 330, 262];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.25, 'triangle', 0.28, i * 0.13));
  }

  busted() {
    this.tone(320, 320, 0.16, 'square', 0.2);
    this.tone(320, 320, 0.16, 'square', 0.2, 0.22);
    this.tone(240, 180, 0.4, 'square', 0.2, 0.44);
  }

  /** Start (or keep) the engine voice while the player drives; pitch follows speed. */
  setEngine(on, speedNorm) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.value = 0.0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
    }
    if (this.engineOsc) {
      const target = on ? 0.05 + speedNorm * 0.05 : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
      this.engineOsc.frequency.setTargetAtTime(55 + speedNorm * 165, this.ctx.currentTime, 0.08);
      if (!on && target === 0) {
        const osc = this.engineOsc;
        window.setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 250);
        this.engineOsc = null;
        this.engineGain = null;
      }
    }
  }

  /** Start or stop the two-tone siren voice (police nearby and wanted). */
  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenLfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 880;
      this.sirenLfo.frequency.value = 0.7;
      lfoGain.gain.value = 190;
      this.sirenLfo.connect(lfoGain).connect(this.sirenOsc.frequency);
      this.sirenGain.gain.value = 0.035;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
      this.sirenLfo.start();
    } else if (!on && this.sirenOsc) {
      const osc = this.sirenOsc;
      const lfo = this.sirenLfo;
      window.setTimeout(() => { try { osc.stop(); lfo.stop(); } catch { /* already stopped */ } }, 60);
      this.sirenOsc = null;
      this.sirenGain = null;
      this.sirenLfo = null;
    }
  }

  /** A slow synthwave loop: a bass line and soft pads in A minor, scheduled step by step. */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 73.4, 0, 82.4, 0];
    const pads = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx) return;
      const step = this.musicStep;
      this.musicStep += 1;
      const bassNote = bass[step % bass.length];
      if (bassNote) this.tone(bassNote, bassNote, 0.24, 'triangle', 0.16);
      if (step % 16 === 0) {
        const chord = pads[(step / 16) % pads.length];
        chord.forEach((freq) => this.tone(freq, freq, 3.6, 'sine', 0.035));
      }
    }, 240);
  }
}
