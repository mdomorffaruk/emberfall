// EMBERFALL — audio.js
// Zero-asset procedural audio: every sound is synthesized with WebAudio.
// No files to load, no network, works offline. AudioContext unlocks on first gesture.

const AudioSys = {
  ctx: null,
  master: null,
  ambientGain: null,
  ambientNodes: [],
  muted: Store.get('ef_muted', false),
  _lastShot: 0,

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this._startAmbient();
  },

  setMuted(m) {
    this.muted = m;
    Store.set('ef_muted', m);
    if (this.master) this.master.gain.linearRampToValueAtTime(m ? 0 : 0.5, this.ctx.currentTime + 0.15);
  },

  toggleMuted() { this.setMuted(!this.muted); return this.muted; },

  // --- building blocks ---
  tone(freq, dur, type, vol, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (opts.delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t0 + dur);
    const peak = vol !== undefined ? vol : 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  },

  noise(dur, vol, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (opts.delay || 0);
    const len = Math.max(1, (this.ctx.sampleRate * dur) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filterType || 'lowpass';
    filter.frequency.setValueAtTime(opts.freq || 1200, t0);
    if (opts.slide) filter.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t0);
  },

  // --- SFX ---
  shoot() {
    // rate-limit: shots can overlap heavily
    const now = performance.now();
    if (now - this._lastShot < 40) return;
    this._lastShot = now;
    this.tone(rand(820, 960), 0.07, 'square', 0.045, { slide: 240 });
  },
  hit() { this.noise(0.06, 0.10, { freq: 2400, slide: 500 }); },
  kill() {
    this.tone(rand(300, 420), 0.12, 'triangle', 0.10, { slide: 70 });
    this.noise(0.1, 0.07, { freq: 900, slide: 200 });
  },
  pickup() { this.tone(rand(1100, 1300), 0.06, 'sine', 0.05, { slide: 1800 }); },
  hurt() {
    this.tone(160, 0.22, 'sawtooth', 0.16, { slide: 50 });
    this.noise(0.16, 0.12, { freq: 500, slide: 120 });
  },
  dash() { this.noise(0.14, 0.09, { freq: 3000, slide: 400, filterType: 'bandpass' }); },
  levelup() {
    const seq = [523, 659, 784, 1046];
    seq.forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, { delay: i * 0.07 }));
  },
  boss() {
    this.tone(80, 0.9, 'sawtooth', 0.2, { slide: 40 });
    this.noise(0.7, 0.15, { freq: 300, slide: 60 });
  },
  bossDie() {
    this.tone(120, 1.1, 'sawtooth', 0.2, { slide: 30 });
    this.noise(1.0, 0.18, { freq: 800, slide: 80 });
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.1, { delay: 0.25 + i * 0.09 }));
  },
  death() {
    this.tone(220, 1.2, 'sawtooth', 0.18, { slide: 40 });
    this.noise(0.9, 0.12, { freq: 600, slide: 60 });
  },
  ui() { this.tone(660, 0.05, 'sine', 0.06); },
  uibig() {
    this.tone(440, 0.1, 'triangle', 0.1);
    this.tone(880, 0.16, 'triangle', 0.08, { delay: 0.06 });
  },
  coin() {
    this.tone(987, 0.08, 'square', 0.08);
    this.tone(1318, 0.2, 'square', 0.07, { delay: 0.07 });
  },
  denied() { this.tone(180, 0.18, 'square', 0.1, { slide: 90 }); },

  // --- ambient pad: cold wind, two detuned lows + slow noise ---
  _startAmbient() {
    if (!this.ctx) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    g.connect(this.master);
    this.ambientGain = g;

    const mk = (freq, type) => {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      const og = this.ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start();
      this.ambientNodes.push(o);
      // slow drift
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = rand(0.03, 0.07);
      const lg = this.ctx.createGain(); lg.gain.value = freq * 0.004;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start();
      this.ambientNodes.push(lfo);
    };
    mk(58, 'sine');
    mk(58.7, 'sine');
    mk(116.3, 'triangle');

    // filtered noise = wind
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    const ng = this.ctx.createGain(); ng.gain.value = 0.25;
    src.connect(f); f.connect(ng); ng.connect(g);
    src.start();
    this.ambientNodes.push(src);
  }
};
