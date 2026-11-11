// EMBERFALL — core.js
// Math helpers, input, particles, screen shake, hit-stop.
// Classic script (no modules) so the game also runs from file:// in a pinch.

const W = 1280, H = 720;
const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function choice(arr) { return arr[(Math.random() * arr.length) | 0]; }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
function norm(x, y) {
  const d = Math.sqrt(x * x + y * y) || 1;
  return { x: x / d, y: y / d };
}

// ---------------- Input ----------------
const Input = {
  keys: new Set(),
  pressed: new Set(),   // consumed each frame end
  touchAxis: { x: 0, y: 0 },  // set by the on-screen joystick

  init() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // let the store's key field type normally
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      Input.keys.add(e.code);
      Input.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => Input.keys.delete(e.code));
    window.addEventListener('blur', () => { Input.keys.clear(); });
  },

  down(code) { return Input.keys.has(code); },
  // movement vector from WASD + arrows + touch joystick
  axis() {
    let x = 0, y = 0;
    if (Input.down('KeyA') || Input.down('ArrowLeft')) x -= 1;
    if (Input.down('KeyD') || Input.down('ArrowRight')) x += 1;
    if (Input.down('KeyW') || Input.down('ArrowUp')) y -= 1;
    if (Input.down('KeyS') || Input.down('ArrowDown')) y += 1;
    x += Input.touchAxis.x;
    y += Input.touchAxis.y;
    const m = Math.sqrt(x * x + y * y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  },
  wasPressed(code) { return Input.pressed.has(code); },
  endFrame() { Input.pressed.clear(); }
};

// ---------------- Particles ----------------
// One shared pool; drawn additively for the neon-glow look.
class Particles {
  constructor(max = 700) {
    this.max = max;
    this.list = [];
  }

  spawn(x, y, count, color, opts = {}) {
    const speed = opts.speed || 120;
    const life = opts.life || 0.5;
    const size = opts.size || 3;
    const spread = opts.spread !== undefined ? opts.spread : TAU;
    const dir = opts.dir || 0;
    for (let i = 0; i < count; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = dir + rand(-spread / 2, spread / 2);
      const s = speed * rand(0.35, 1);
      this.list.push({
        x, y,
        vx: Math.cos(a) * s + (opts.vx || 0),
        vy: Math.sin(a) * s + (opts.vy || 0),
        life: life * rand(0.6, 1.2),
        maxLife: life,
        size: size * rand(0.6, 1.4),
        color,
        drag: opts.drag !== undefined ? opts.drag : 2.2
      });
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = clamp(t, 0, 1) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * t), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------- Screen juice ----------------
const Juice = {
  shakeAmt: 0,
  hitStop: 0,

  shake(amount) {
    if (!Settings.get('shake')) return;
    this.shakeAmt = Math.min(26, this.shakeAmt + amount);
  },
  stop(seconds) { this.hitStop = Math.max(this.hitStop, seconds); },

  update(dt) {
    this.shakeAmt *= Math.exp(-9 * dt);
    if (this.shakeAmt < 0.05) this.shakeAmt = 0;
    if (this.hitStop > 0) this.hitStop -= dt;
  },

  // returns offset for canvas translate
  offset() {
    if (this.shakeAmt <= 0) return { x: 0, y: 0 };
    return {
      x: rand(-this.shakeAmt, this.shakeAmt),
      y: rand(-this.shakeAmt, this.shakeAmt)
    };
  },

  timeScale() { return this.hitStop > 0 ? 0.08 : 1; }
};

// ---------------- Local persistence ----------------
const Store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc */ }
  }
};

// ---------------- Player settings (persisted) ----------------
// stick: joystick radius multiplier (0.6 = small ... 1.5 = large)
// sound persistence lives in AudioSys (ef_muted)
const Settings = {
  DEFAULTS: { stick: 0.8, haptics: true, shake: true },
  data: null,

  load() {
    this.data = Object.assign({}, this.DEFAULTS, Store.get('ef_settings', {}) || {});
    return this.data;
  },
  get(key) {
    if (!this.data) this.load();
    return this.data[key];
  },
  set(key, value) {
    if (!this.data) this.load();
    this.data[key] = value;
    Store.set('ef_settings', this.data);
  }
};
