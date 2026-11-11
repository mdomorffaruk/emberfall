// EMBERFALL — main.js
// Boot, canvas fit, main loop, pause, autotest harness.

window.__errors = [];
window.addEventListener('error', (e) => {
  window.__errors.push(String(e.message || e));
  document.body.dataset.error = String(e.message || e);
});

const App = {
  game: null,
  canvas: null,
  ctx: null,
  stage: null,
  menuT: 0,

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.stage = document.getElementById('stage');

    Input.init();
    UI.init();
    this.installTouchInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 60));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());

    // long-press menu / text selection breaks touch play; kill it in touch mode only
    document.addEventListener('contextmenu', (e) => {
      if (App.touchMode) e.preventDefault();
    });

    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) this.initTouchUI();

    requestAnimationFrame((t) => this.loop(t));
    document.body.dataset.boot = 'ok';
  },

  // ---------------- responsive mode ----------------
  // Phones/tablets (coarse pointer, small side): the UI overlay is un-scaled
  // and laid out by CSS to fill the viewport; desktop keeps the 1280x720
  // design space scaled onto the letterboxed stage.
  computeMode() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const touchish = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const forced = new URLSearchParams(location.search).get('mobile') === '1'; // desktop preview of the phone UI
    const small = Math.min(window.innerWidth, window.innerHeight) <= 900;
    this.touchMode = forced || ((coarse || touchish) && small);
    document.body.classList.toggle('ui-free', this.touchMode);
    document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth);
  },

  // ---------------- touch controls (phones/tablets) ----------------
  // Floating joystick (left half), DASH button (bottom right), pause (top right).
  // Every pointer is tracked by pointerId, so move + dash + menu taps at the
  // same time never steal or kill each other (the v1.1 multitouch bug).
  installTouchInput() {
    const stick = document.createElement('div');
    stick.id = 'stick';
    const knob = document.createElement('div');
    knob.id = 'stickknob';
    stick.appendChild(knob);
    document.body.appendChild(stick);
    this.stick = stick;

    const DEAD = 0.14;          // below this the axis reads zero (no jitter)
    const R = Math.max(48, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.11)); // joystick radius, screen px
    stick.style.width = stick.style.height = (R * 2 + 12) + 'px';
    let pid = null;             // pointerId that owns the joystick
    let ox = 0, oy = 0;         // joystick origin, screen px

    const setKnob = (dx, dy) => { knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; };

    const start = (e) => {
      pid = e.pointerId;
      ox = e.clientX; oy = e.clientY;
      stick.style.left = (ox - R - 6) + 'px';
      stick.style.top = (oy - R - 6) + 'px';
      stick.classList.add('active');
      move(e);
    };

    const move = (e) => {
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) {
        // drag-along: the origin follows the finger so sharp turns never
        // require lifting the finger (classic mobile joystick feel)
        ox = e.clientX - dx / d * R;
        oy = e.clientY - dy / d * R;
        stick.style.left = (ox - R - 6) + 'px';
        stick.style.top = (oy - R - 6) + 'px';
        dx = dx / d * R; dy = dy / d * R;
      }
      Input.touchAxis.x = dx / R;
      Input.touchAxis.y = dy / R;
      const m = Math.sqrt(Input.touchAxis.x * Input.touchAxis.x + Input.touchAxis.y * Input.touchAxis.y);
      if (m < DEAD) { Input.touchAxis.x = 0; Input.touchAxis.y = 0; }
      setKnob(dx, dy);
    };

    const end = () => {
      pid = null;
      Input.touchAxis.x = 0; Input.touchAxis.y = 0;
      setKnob(0, 0);
      stick.classList.remove('active');
    };

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (pid !== null) return;                       // joystick already owned by another finger
      if (!App.game || App.game.state !== 'playing') return; // menus / levelup / pause need taps, not a stick
      if (e.clientX > window.innerWidth * 0.55) return; // right half: dash territory
      if (e.target.closest && e.target.closest('.btn, .char-card, .upgrade-card, #key-input, #stick, #touchdash, #touchpause')) return;
      e.preventDefault();
      start(e);
    }, { passive: false });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;                // only the owning finger drives the stick
      e.preventDefault();
      move(e);
    }, { passive: false });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pid) return;                // another finger lifting must NOT kill the stick
      end();
    });
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerId !== pid) return;
      end();
    });
    // safety: if the owning finger is lost for any reason, stop drifting
    window.addEventListener('blur', end);
  },

  // visual buttons (created only on real touch devices)
  initTouchUI() {
    document.body.classList.add('is-touch');

    const wrap = document.createElement('div');
    wrap.id = 'touchui';
    document.body.appendChild(wrap);
    this.touchUI = wrap;

    const dash = document.createElement('button');
    dash.id = 'touchdash'; dash.className = 'touch-el';
    dash.textContent = 'DASH';
    dash.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      AudioSys.ensure();
      Input.pressed.add('Space');
      if (navigator.vibrate) navigator.vibrate(12);
    });
    wrap.appendChild(dash);
    this.touchDash = dash;

    const pause = document.createElement('button');
    pause.id = 'touchpause'; pause.className = 'touch-el';
    pause.textContent = '❚❚';
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      AudioSys.ui();
      if (App.game && App.game.state === 'playing') App.setPaused(true);
    });
    wrap.appendChild(pause);
  },

  resize() {
    this.computeMode();
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    this.stage.style.width = Math.floor(W * s) + 'px';
    this.stage.style.height = Math.floor(H * s) + 'px';
    const ui = document.getElementById('ui');
    if (this.touchMode) {
      // responsive mode: CSS (body.ui-free) makes #ui fill the viewport
      ui.style.left = ''; ui.style.top = ''; ui.style.transform = '';
    } else {
      // desktop: overlay the scaled 1280x720 design space exactly on the stage
      ui.style.left = Math.floor((window.innerWidth - W * s) / 2) + 'px';
      ui.style.top = Math.floor((window.innerHeight - H * s) / 2) + 'px';
      ui.style.transform = 'scale(' + s + ')';
    }
  },

  startRun(charId) {
    const mode = UI.isFull() ? 'full' : 'free';
    this.game = new Game(charId, mode);
    UI.showGameScreen();
    AudioSys.ensure();
  },

  setPaused(p) {
    const g = this.game;
    if (!g) return;
    if (p && g.state === 'playing') {
      g.state = 'paused';
      UI.showScreen('screen-pause');
      UI.hud.root.classList.remove('hidden');
    } else if (!p && g.state === 'paused') {
      g.state = 'playing';
      UI.showGameScreen();
    }
  },

  abandonRun() {
    this.game = null;
    UI.showScreen('screen-title');
  },

  // ambient ember field behind the menus — the game "breathes" even in the title
  drawMenuBackdrop(ctx, dt) {
    this.menuT += dt;
    const t = this.menuT;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#060c16');
    bg.addColorStop(1, '#0b1424');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 42; i++) {
      const seed = i * 97.3;
      const x = (seed * 13.7 + Math.sin(t * 0.25 + i) * 40 + t * (6 + (i % 5) * 2)) % W;
      const y = (seed * 7.1 + Math.cos(t * 0.18 + i * 1.7) * 30 + t * (3 + (i % 3))) % H;
      const r = 1.2 + (i % 4) * 0.7;
      const a = 0.12 + 0.1 * Math.sin(t * 1.4 + i);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, `rgba(255,170,80,${a})`);
      g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, TAU);
      ctx.fill();
    }
    // cold breath in the middle
    const c = ctx.createRadialGradient(W / 2, H * 0.42, 50, W / 2, H * 0.42, 520);
    c.addColorStop(0, 'rgba(40,70,120,0.16)');
    c.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  },

  loop(now) {
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    const ctx = this.ctx;
    const g = this.game;

    try {
      if (g) {
        if (g.state === 'playing') {
          // pause toggle
          if (Input.wasPressed('Escape')) { this.setPaused(true); }
          g.update(dt);
        } else if (g.state === 'paused') {
          if (Input.wasPressed('Escape')) this.setPaused(false);
          Juice.update(dt);
        } else if (g.state === 'levelup') {
          if (Input.wasPressed('Digit1')) UI.pickUpgrade(0);
          if (Input.wasPressed('Digit2')) UI.pickUpgrade(1);
          if (Input.wasPressed('Digit3')) UI.pickUpgrade(2);
          Juice.update(dt);
        } else {
          // dead / won — let the final particle burst play out
          Juice.update(dt);
          g.particles.update(dt);
        }

        g.draw(ctx);
        if (g.state === 'playing' || g.state === 'levelup' || g.state === 'paused') g.syncHud();
      } else {
        this.drawMenuBackdrop(ctx, dt);
      }
    } catch (err) {
      window.__errors.push(String(err && err.stack || err));
      document.body.dataset.error = String(err && err.message || err);
    }

    this.syncTouch(g);
    Input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  },

  // touch buttons: visible only during live play; DASH greys out while recharging
  syncTouch(g) {
    if (!this.touchUI) return;
    const playing = g && g.state === 'playing';
    this.touchUI.classList.toggle('hidden', !playing);
    if (playing && this.touchDash && g.player) {
      this.touchDash.classList.toggle('cooling', g.player.dashCharges === 0);
    }
  }
};

// ---------------- autotest (?autotest=1&shot=N) ----------------
// Headless browsers don't always drive requestAnimationFrame, so the harness
// pumps update/draw itself. ?shot=N pumps N frames then freezes the canvas
// (used to capture verification screenshots).
function runAutotest(shotFrames) {
  const log = (v) => { document.body.dataset.autotest = v; };
  try {
    App.startRun('ember');
    const g = App.game;
    if (!g) return log('fail-nogame');
    Input.keys.add('KeyD');
    let frames = 0;
    const total = shotFrames || 140;
    const iv = setInterval(() => {
      frames++;
      try {
        if (frames === 40) { Input.keys.delete('KeyD'); Input.keys.add('KeyW'); }
        if (frames === 50) Input.pressed.add('Space');
        if (frames === 60) { Input.keys.delete('KeyW'); Input.keys.add('KeyA'); }
        if (frames === 90) { Input.keys.delete('KeyA'); Input.keys.add('KeyS'); }
        if (g.state === 'playing') g.update(1 / 60);
        g.draw(App.ctx);
        if (g.state === 'playing') g.syncHud();
        Input.endFrame();
      } catch (err) {
        window.__errors.push(String(err && err.stack || err));
        document.body.dataset.error = String(err && err.message || err);
        clearInterval(iv);
        log('fail-exception');
        return;
      }
      if (frames >= total) {
        clearInterval(iv);
        const ok = g.time > 2 && Number.isFinite(g.score) && Array.isArray(g.enemies);
        log(ok ? 'pass' : 'fail-' + JSON.stringify({ t: +g.time.toFixed(2), e: g.enemies.length, s: g.state }));
      }
    }, 16);
  } catch (err) {
    window.__errors.push(String(err && err.stack || err));
    document.body.dataset.error = String(err && err.message || err);
    log('fail-exception');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  App.init();
  const q = new URLSearchParams(location.search);
  if (q.get('autotest')) {
    const shot = parseInt(q.get('shot') || '0', 10);
    setTimeout(() => runAutotest(shot || 0), 300);
  }
  // debug/verification hooks: ?ui=store|chars|how  ?demo=levelup|death
  if (q.get('ui')) setTimeout(() => UI.showScreen('screen-' + q.get('ui')), 100);
  if (q.get('demo')) setTimeout(() => {
    App.startRun('ember');
    const g = App.game;
    g.time = 40; g.score = 1234; g.kills = 56; g.level = 6;
    for (let i = 0; i < 14; i++) g.spawnEnemy();
    g.draw(App.ctx); g.syncHud();
    if (q.get('demo') === 'levelup') { g.addXp(999); g.draw(App.ctx); }
    if (q.get('demo') === 'death') { g.player.hurt(9999, g); g.draw(App.ctx); setTimeout(() => UI.showEnd(g, false), 100); }
    if (q.get('demo') === 'win') { g.sector = 2; UI.showEnd(g, true); }
  }, 150);

  if (q.get('selftest')) setTimeout(selfTest, 400);
});

// ---------------- selftest (?selftest=1) ----------------
// Full functional sweep inside the real page.
function selfTest() {
  const fail = (msg) => { document.body.dataset.selftest = 'FAIL:' + msg; App.abandonRun(); };
  try {
    // 0 — copy rule: no em-dashes in any UI text (review v1.1)
    if (document.body.textContent.indexOf('—') !== -1) return fail('emdash-in-ui');
    if (document.title.indexOf('—') !== -1) return fail('emdash-in-title');

    // 0b — touch joystick feeds the same axis as the keyboard
    Input.touchAxis.x = 1; Input.touchAxis.y = 0;
    const ta = Input.axis();
    if (Math.abs(ta.x - 1) > 0.01 || Math.abs(ta.y) > 0.01) return fail('touch-axis');
    Input.touchAxis.x = 1; Input.touchAxis.y = 1; // full-tilt diagonal must normalize to length 1
    const tb = Input.axis();
    if (Math.abs(Math.sqrt(tb.x * tb.x + tb.y * tb.y) - 1) > 0.01) return fail('touch-normalize');
    Input.touchAxis.x = 0; Input.touchAxis.y = 0;

    // 0c — multitouch: a second finger (dash area) must not steal or kill the joystick
    App.startRun('ember');
    const simPtr = (type, id, x, y) => {
      App.stage.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y
      }));
    };
    const vw = window.innerWidth, vh = window.innerHeight;
    simPtr('pointerdown', 101, Math.round(vw * 0.15), Math.round(vh * 0.6));   // finger 1: left half
    simPtr('pointermove', 101, Math.round(vw * 0.15) + 40, Math.round(vh * 0.6));
    const m1 = Input.axis();
    if (!(m1.x > 0.2)) return fail('stick-no-move');
    simPtr('pointerdown', 102, vw - 60, vh - 80);                              // finger 2: dash corner
    simPtr('pointermove', 102, vw - 20, vh - 40);
    simPtr('pointerup', 102);                                                  // dash finger lifts
    const m2 = Input.axis();
    if (Math.abs(m2.x - m1.x) > 0.01 || Math.abs(m2.y - m1.y) > 0.01) return fail('multitouch-steal');
    simPtr('pointermove', 101, Math.round(vw * 0.15), Math.round(vh * 0.6) + 60); // finger 1 still in control
    const m3 = Input.axis();
    if (!(m3.y > 0.2)) return fail('stick-lost-after-second-finger');
    simPtr('pointerup', 101);
    const m4 = Input.axis();
    if (m4.x !== 0 || m4.y !== 0) return fail('stick-not-released');
    App.abandonRun();

    // 1 — license validation
    const good = makeLicenseKey();
    if (!isValidKey(good)) return fail('keygen-invalid');
    if (isValidKey('nonsense')) return fail('accepted-garbage');
    if (isValidKey('EF-AA-BB-CC')) return fail('accepted-short');
    if (isValidKey('EF-ZZZZ-ZZZZ-ZZZZ')) return fail('accepted-badsum');

    // 2 — entitlement gating
    Store.set('ef_license', null); localStorage.removeItem('ef_license');
    if (UI.isFull()) return fail('full-without-key');
    if (UI.charUnlocked(CHARACTERS[1])) return fail('wisp-unlocked-free');
    if (!UI.activateKey(good)) return fail('reject-valid-key');
    if (!UI.isFull()) return fail('full-after-key');
    if (!UI.charUnlocked(CHARACTERS[1])) return fail('wisp-locked-full');
    localStorage.removeItem('ef_license');
    UI.refreshEntitlements();
    if (UI.isFull()) return fail('cleared-license');

    // 3 — combat sim: spawn, fight, score
    App.startRun('ember');
    let g = App.game;
    g.player.maxHp = 1000; g.player.hp = 1000; // tank up: this step tests combat, not balance
    g.spawnEnemy(); g.spawnEnemy(); g.spawnEnemy();
    if (!g.enemies.length) return fail('spawn-empty');
    const e0 = g.enemies[0];
    const hp0 = e0.hp;
    e0.hurt(5, g, g.player.x, g.player.y);
    if (e0.hp >= hp0 && !e0.dead) return fail('hurt-no-damage');
    for (let i = 0; i < 240; i++) {
      if (i % 25 === 0) g.spawnEnemy();
      if (g.state === 'levelup') { g.pendingLevels = 0; g.chooseUpgrade(g.generateOffers()[0]); }
      if (g.state === 'playing') g.update(1 / 60);
      g.draw(App.ctx);
    }
    if (!(g.time > 3)) return fail('time-not-advancing');
    if (g.enemies.length === 0) return fail('no-enemies');
    if (!(g.score > 0)) return fail('score-zero'); // auto-fire must have killed something

    // 4 — canvas actually painted
    const d = App.ctx.getImageData(0, 0, W, H).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 997) {
      if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
    }
    if (lit < 100) return fail('canvas-dark:' + lit);

    // 5 — level-up flow
    g.addXp(999);
    if (g.state !== 'levelup') return fail('no-levelup');
    if (g.pendingLevels < 1) return fail('no-pending');
    const offers = g.generateOffers();
    if (offers.length !== 3) return fail('offers-' + offers.length);
    const snap = () => JSON.stringify({
      hp: g.player.maxHp,
      w: Object.entries(g.player.weapons).map(([k, v]) => k + v.level).sort().join(','),
      dm: g.player.dmgMul, fr: g.player.fireRateMul, sp: g.player.speed, mg: g.player.magnet, dc: g.player.dashMax
    });
    const before = snap();
    g.pendingLevels = 1; // consume the queue so state returns to playing
    g.chooseUpgrade(offers[0]);
    const after = snap();
    if (before === after) return fail('upgrade-no-effect:' + offers[0].id);
    if (g.state !== 'playing') return fail('not-resumed');

    // 6 — boss cycle + sector advance (free mode)
    g.time = 75; g.nextBossAt = 75;
    g.update(1 / 60);
    if (!g.boss) return fail('no-boss');
    if (g.boss.state !== 'intro') return fail('boss-no-intro');
    g.boss.stateT = 0.05; // skip the cinematic intro for the test
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    if (g.boss.state === 'intro') return fail('boss-stuck-intro');
    const tier = g.boss.tier;
    g.boss.hurt(999999, g, 0, 0);
    if (g.sector !== 2) return fail('sector-not-advanced:' + g.sector);
    if (g.boss !== null) return fail('boss-not-cleared');

    // 7 — free-version ceiling: killing sector-2 boss must end the run as a win
    g.time = 200; g.nextBossAt = 200;
    g.update(1 / 60);
    if (!g.boss) return fail('no-boss-2');
    g.boss.stateT = 0.01;
    for (let i = 0; i < 30; i++) g.update(1 / 60); // 30 frames: also drains the death hit-stop
    if (g.boss.state === 'intro') return fail('boss2-stuck-intro');
    g.boss.hurt(999999, g, 0, 0);
    if (!g.won || g.state !== 'won') return fail('free-ceiling-missed:' + g.state + '|won=' + g.won + '|sec=' + g.sector + '|mode=' + g.mode + '|boss=' + (g.boss ? g.boss.state + ':' + g.boss.hp : 'gone'));
    g.state = 'aborted'; g.won = false; // disarm the deferred end-screen timers

    // 8 — death flow (fresh run)
    App.startRun('ember');
    g = App.game;
    g.player.invuln = 0;
    g.player.hurt(99999, g);
    if (g.player.alive || g.state !== 'dead') return fail('death-broken');
    g.state = 'aborted'; // disarm the deferred end-screen timer

    App.abandonRun();
    document.body.dataset.selftest = 'PASS';
  } catch (err) {
    document.body.dataset.selftest = 'FAIL:exception:' + (err && err.message);
    window.__errors.push(String(err && err.stack || err));
  }
}
