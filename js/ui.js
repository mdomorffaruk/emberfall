// EMBERFALL — ui.js
// DOM screens, character select, level-up cards, end screen, store + license keys.

// ---- License key format: EF-XXXX-XXXX-XXXX with a real checksum ----
// (production build would receive keys from the payment provider; this
//  validates locally so wrong keys are genuinely rejected.)
const KEY_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function keyChecksum(payload) {
  let h = 7;
  for (let i = 0; i < payload.length; i++) h = ((h * 31) + payload.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

function makeLicenseKey() {
  let payload = '';
  for (let i = 0; i < 8; i++) payload += KEY_ABC[(Math.random() * KEY_ABC.length) | 0];
  const ck = keyChecksum(payload);
  return 'EF-' + payload.slice(0, 4) + '-' + payload.slice(4, 8) + '-' + ck;
}

function isValidKey(k) {
  const m = /^EF-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/.exec(String(k || '').trim().toUpperCase());
  if (!m) return false;
  return keyChecksum(m[1] + m[2]) === m[3];
}

const UI = {
  hud: {},
  screens: {},
  currentScreen: 'title',
  selectedChar: 'ember',
  offers: [],
  returnTo: 'title',
  pendingKey: null,

  $(id) { return document.getElementById(id); },

  init() {
    const ids = [
      'screen-title', 'screen-how', 'screen-chars', 'screen-levelup',
      'screen-pause', 'screen-death', 'screen-store'
    ];
    for (const id of ids) this.screens[id] = this.$(id);

    this.hud = {
      root: this.$('hud'),
      hpfill: this.$('hpfill'), hptext: this.$('hptext'),
      xpfill: this.$('xpfill'), leveltext: this.$('leveltext'),
      timer: this.$('timer'), score: this.$('score'), mult: this.$('mult'),
      sectorname: this.$('sectorname'), dashdot: this.$('dashdot'),
      bosswrap: this.$('bosswrap'), bossname: this.$('bossname'), bossfill: this.$('bossfill')
    };

    // --- title ---
    this.$('btn-play').onclick = () => { AudioSys.ensure(); AudioSys.ui(); UI.showChars(); };
    this.$('btn-how').onclick = () => { AudioSys.ensure(); AudioSys.ui(); UI.showScreen('screen-how'); };
    this.$('btn-how-back').onclick = () => { AudioSys.ui(); UI.showScreen('screen-title'); };
    this.$('btn-store-title').onclick = () => { AudioSys.ensure(); AudioSys.uibig(); UI.openStore('screen-title'); };

    // --- character select ---
    this.$('btn-chars-back').onclick = () => { AudioSys.ui(); UI.showScreen('screen-title'); };
    this.$('btn-chars-go').onclick = () => {
      AudioSys.ensure(); AudioSys.uibig();
      App.startRun(UI.selectedChar);
    };
    this.$('btn-store-chars').onclick = () => { AudioSys.uibig(); UI.openStore('screen-chars'); };

    // --- level up cards (event delegation) ---
    this.$('upgrade-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.upgrade-card');
      if (!card) return;
      const idx = parseInt(card.dataset.idx, 10);
      UI.pickUpgrade(idx);
    });

    // --- pause ---
    this.$('btn-resume').onclick = () => { AudioSys.ui(); App.setPaused(false); };
    this.$('btn-quit').onclick = () => { AudioSys.ui(); App.abandonRun(); };
    this.$('btn-sound2').onclick = () => UI.toggleSound();

    // --- death / victory ---
    this.$('btn-retry').onclick = () => { AudioSys.uibig(); App.startRun(UI.selectedChar); };
    this.$('btn-menu').onclick = () => { AudioSys.ui(); App.abandonRun(); };
    this.$('btn-store-death').onclick = () => { AudioSys.uibig(); UI.openStore(UI.currentScreen); };

    // --- store ---
    this.$('btn-store-back').onclick = () => {
      AudioSys.ui();
      UI.showScreen(UI.returnTo);
      if (UI.returnTo === 'screen-death') { /* stats stay filled */ }
    };
    this.$('btn-buy').onclick = () => {
      AudioSys.coin();
      UI.$('store-buy').classList.add('hidden');
      UI.$('checkout').classList.remove('hidden');
      UI.$('order-id').textContent = 'EF-ORD-' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    };
    this.$('btn-issue').onclick = () => {
      AudioSys.coin();
      UI.pendingKey = makeLicenseKey();
      UI.$('issued-key').textContent = UI.pendingKey;
      UI.$('checkout').classList.add('hidden');
      UI.$('key-issued').classList.remove('hidden');
    };
    this.$('btn-activate-issued').onclick = () => {
      if (UI.activateKey(UI.pendingKey)) {
        UI.$('key-issued').classList.add('hidden');
        UI.$('store-buy').classList.add('hidden');
        UI.refreshEntitlements();
        UI.showScreen(UI.returnTo);
      } else {
        AudioSys.denied();
      }
    };
    this.$('btn-activate').onclick = () => {
      const k = UI.$('key-input').value;
      if (UI.activateKey(k)) {
        UI.$('activate-msg').textContent = 'Full Flame activated. The fire is yours.';
        UI.$('activate-msg').className = 'small ok';
        UI.$('key-input').value = '';
        UI.refreshEntitlements();
      } else {
        AudioSys.denied();
        UI.$('activate-msg').textContent = 'That key is not valid. Keys look like EF-XXXX-XXXX-XXXX.';
        UI.$('activate-msg').className = 'small err';
      }
    };
    this.$('key-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') UI.$('btn-activate').click();
    });

    // --- sound ---
    this.$('btn-sound').onclick = () => UI.toggleSound();

    this.renderChars();
    this.refreshEntitlements();
    this.showScreen('screen-title');
  },

  toggleSound() {
    AudioSys.ensure();
    const muted = AudioSys.toggleMuted();
    this.$('btn-sound').textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
    this.$('btn-sound2').textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
    if (!muted) AudioSys.ui();
  },

  showScreen(id) {
    for (const k of Object.keys(this.screens)) {
      this.screens[k].classList.toggle('hidden', k !== id);
    }
    this.currentScreen = id;
    if (id) this.hud.root.classList.add('hidden');
  },

  showGameScreen() {
    // in-run overlays (levelup / pause) sit on top of the frozen canvas; no menu screen
    for (const k of Object.keys(this.screens)) this.screens[k].classList.add('hidden');
    this.currentScreen = null;
    this.hud.root.classList.remove('hidden');
  },

  hideHud() { this.hud.root.classList.add('hidden'); },

  // ---------- character select ----------
  charUnlocked(c) {
    return c.unlocked || UI.isFull();
  },

  renderChars() {
    const grid = this.$('char-grid');
    grid.innerHTML = '';
    for (const c of CHARACTERS) {
      const unlocked = UI.charUnlocked(c);
      const card = document.createElement('div');
      card.className = 'char-card' + (c.id === UI.selectedChar ? ' selected' : '') + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="char-orb" style="background: radial-gradient(circle at 35% 32%, ${c.core}, ${c.orb} 55%, #000);">
          ${unlocked ? '✦' : '🔒'}
        </div>
        <div class="char-name">${c.name}</div>
        <div class="char-desc">${unlocked ? c.desc : 'Locked in the First Spark edition.'}</div>
        <div class="char-stats">${c.statsTxt}</div>
        ${unlocked ? '' : '<div class="char-lock">FULL FLAME</div>'}
      `;
      card.onclick = () => {
        AudioSys.ensure();
        if (!unlocked) { AudioSys.uibig(); UI.openStore('screen-chars'); return; }
        AudioSys.ui();
        UI.selectedChar = c.id;
        UI.renderChars();
      };
      grid.appendChild(card);
    }
  },

  showChars() {
    this.renderChars();
    this.showScreen('screen-chars');
  },

  // ---------- level up ----------
  showLevelUp(offers) {
    this.offers = offers;
    const grid = this.$('upgrade-grid');
    grid.innerHTML = '';
    offers.forEach((o, i) => {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.dataset.idx = i;
      card.innerHTML = `
        <div class="upgrade-icon">${o.icon}</div>
        <div class="upgrade-stat">${o.stat || ''}</div>
        <div class="upgrade-name">${o.name}</div>
        <div class="upgrade-lvl">${o.lvlText || ''}</div>
      `;
      grid.appendChild(card);
    });
    this.showGameScreen();
    this.screens['screen-levelup'].classList.remove('hidden');
    this.currentScreen = 'screen-levelup';
  },

  hideLevelUp() {
    this.screens['screen-levelup'].classList.add('hidden');
    this.currentScreen = null;
  },

  pickUpgrade(idx) {
    const o = this.offers[idx];
    if (!o || !App.game) return;
    this.hideLevelUp();
    App.game.chooseUpgrade(o);
  },

  // ---------- end of run ----------
  showEnd(game, won) {
    this.hideHud();
    const isFull = UI.isFull();
    const hsKey = game.highScoreKey;
    const prevBest = Store.get(hsKey, 0);
    const score = Math.round(game.score);
    const best = score > prevBest;
    if (best) Store.set(hsKey, score);

    this.$('death-title').textContent = won ? 'THE FIRST SPARK ENDURES' : 'THE COLD TOOK YOU';
    this.$('death-title').className = won ? 'glow' : '';
    this.$('death-sub').textContent = won
      ? 'Sector 2 is ash. The Iron Dark waits.'
      : 'The cold wins this round.';

    this.$('run-stats').innerHTML = `
      <div><span>Survived</span><span>${fmtTime(game.time)}</span></div>
      <div><span>Slain</span><span>${game.kills}</span></div>
      <div><span>Level</span><span>${game.level}</span></div>
      <div><span>Sector</span><span>${game.endless ? 'ENDLESS' : game.sector}</span></div>
      <div><span>Score</span><span>${score.toLocaleString('en-US')}</span></div>
      <div><span>Best</span><span class="${best ? 'newbest' : ''}">${best ? score.toLocaleString('en-US') + ' NEW BEST!' : prevBest.toLocaleString('en-US')}</span></div>
    `;

    const cta = this.$('death-cta');
    if (!isFull) {
      cta.classList.remove('hidden');
      this.$('death-cta-line').innerHTML =
        '<b>Full Flame</b> · Sectors 3 + 4 · ENDLESS · 3 new flames';
    } else {
      cta.classList.add('hidden');
    }

    this.showScreen('screen-death');
  },

  // ---------- store / license ----------
  isFull() {
    const k = Store.get('ef_license', null);
    return !!(k && isValidKey(k));
  },

  activateKey(k) {
    if (!isValidKey(k)) return false;
    Store.set('ef_license', String(k).trim().toUpperCase());
    AudioSys.uibig();
    this.refreshEntitlements();
    return true;
  },

  refreshEntitlements() {
    const full = this.isFull();
    this.$('btn-store-title').classList.toggle('hidden', full);
    this.$('btn-store-chars').classList.toggle('hidden', full);
    this.$('btn-store-death').classList.toggle('hidden', full);
    this.$('title-edition').textContent = full ? 'FULL FLAME · LICENSED' : 'FIRST SPARK · FREE EDITION';
    this.$('store-buy').classList.toggle('hidden', full);
    this.$('checkout').classList.add('hidden');
    this.$('key-issued').classList.add('hidden');
    if (full) {
      this.$('activate-msg').textContent = 'Full Flame is active on this machine.';
      this.$('activate-msg').className = 'small ok';
    }
    // unlock cards if character screen is live
    if (this.currentScreen === 'screen-chars') this.renderChars();
  },

  openStore(from) {
    this.returnTo = from || 'screen-title';
    const full = this.isFull();
    this.$('store-buy').classList.toggle('hidden', full);
    this.$('checkout').classList.add('hidden');
    this.$('key-issued').classList.add('hidden');
    if (!full) this.$('activate-msg').textContent = '';
    this.showScreen('screen-store');
  }
};
