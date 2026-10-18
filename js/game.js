// EMBERFALL — game.js
// The run itself: director, sectors, XP/levels, render, win/lose.

const SECTORS = [
  { name: 'SECTOR 1 · THE COOLING',    bg0: '#07101e', bg1: '#0d1b30', accent: '#6fb7ff', ash: 'rgba(80,120,170,0.35)' },
  { name: 'SECTOR 2 · ASHFALL HOLLOW', bg0: '#120a20', bg1: '#221238', accent: '#b47aff', ash: 'rgba(120,90,180,0.35)' },
  { name: 'SECTOR 3 · THE IRON DARK',  bg0: '#041410', bg1: '#0a2822', accent: '#4affc3', ash: 'rgba(60,160,130,0.35)' },
  { name: 'SECTOR 4 · THE WHITEOUT',   bg0: '#0d1522', bg1: '#223348', accent: '#e8f4ff', ash: 'rgba(180,210,240,0.4)' }
];

// Upgrade cards are icon-first: the stat line is the message, the name is a tag.
const UPGRADE_POOL = [
  { id: 'hp',     icon: '♥', name: 'VITALITY',    stat: '+25 MAX HP',    weight: 2,   apply: (g, p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
  { id: 'speed',  icon: '➤', name: 'QUICKSTEP',   stat: '+8% SPEED',     weight: 1.6, apply: (g, p) => { p.speed *= 1.08; } },
  { id: 'dmg',    icon: '⚔', name: 'HEAT',        stat: '+12% DMG',      weight: 2.4, apply: (g, p) => { p.dmgMul *= 1.12; } },
  { id: 'rate',   icon: '↯', name: 'STOKER',      stat: '+10% RATE',     weight: 2,   apply: (g, p) => { p.fireRateMul *= 1.1; } },
  { id: 'magnet', icon: '✚', name: 'MAGNET',      stat: '+35 PICKUP',    weight: 1.2, apply: (g, p) => { p.magnet += 35; } },
  { id: 'dash',   icon: '◈', name: 'SECOND GUST', stat: '+1 DASH CHARGE', weight: 1.4, apply: (g, p) => { p.dashMax = Math.min(3, p.dashMax + 1); p.dashCharges = p.dashMax; } }
];

class Game {
  constructor(charId, mode) {
    this.mode = mode; // 'free' | 'full'
    this.char = CHARACTERS.find(c => c.id === charId) || CHARACTERS[0];
    this.player = new Player(this.char, W / 2, H / 2);

    this.enemies = [];
    this.bullets = [];
    this.enemyBolts = [];
    this.pickups = [];
    this.pools = [];
    this.novas = [];
    this.orbDraw = [];
    this.slamFx = [];
    this.particles = new Particles(700);

    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.mult = 1;
    this.level = 1;
    this.xp = 0;
    this.xpNeed = 11;
    this.pendingLevels = 0;

    this.sector = 1;
    this.endless = false;
    this.boss = null;
    this.nextBossAt = 70;
    this.spawnT = 1.2;
    this.banner = { text: SECTORS[0].name, t: 3 };
    this.hurtFlash = 0;

    this.state = 'playing'; // playing | levelup | dead | won
    this.won = false;
    this.highScoreKey = mode === 'full' ? 'ef_hs_full' : 'ef_hs_free';
    this.newBest = false;

    this.ashMotes = [];
    for (let i = 0; i < 46; i++) {
      this.ashMotes.push({
        x: rand(0, W), y: rand(0, H),
        s: rand(0.4, 1.4), ph: rand(0, TAU), r: rand(0.6, 2.2)
      });
    }
  }

  sectorDef() {
    if (!this.endless) return SECTORS[Math.min(this.sector, 4) - 1];
    return SECTORS[Math.floor(this.time / 90) % 4];
  }

  hpMul() { return 1 + this.time * 0.0085 + (this.sector - 1) * 0.15; }
  spdMul() { return 1 + Math.min(0.45, this.time * 0.0011); }

  // ---------------- XP / levels ----------------
  addXp(v) {
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = Math.round(8 + this.level * 4.2 + this.level * this.level * 0.28);
      this.pendingLevels++;
    }
    if (this.pendingLevels > 0 && this.state === 'playing') {
      this.state = 'levelup';
      AudioSys.levelup();
      UI.showLevelUp(this.generateOffers());
    }
  }

  generateOffers() {
    const p = this.player;
    const offers = [];
    const weaponIds = Object.keys(WEAPONS);

    for (const id of weaponIds) {
      const owned = p.weapons[id];
      if (owned) {
        if (owned.level < WEAPONS[id].maxLvl) {
          offers.push({
            id: 'up_' + id,
            icon: WEAPONS[id].icon,
            name: WEAPONS[id].name,
            stat: WEAPONS[id].lvlDesc[owned.level],
            lvlText: 'LV ' + owned.level + ' → ' + (owned.level + 1),
            weight: 3.2,
            apply: (g, pl) => pl.addWeapon(id)
          });
        }
      } else if (p.weaponSlots() < 3) {
        offers.push({
          id: 'new_' + id,
          icon: WEAPONS[id].icon,
          name: WEAPONS[id].name,
          stat: 'NEW WEAPON',
          lvlText: WEAPONS[id].lvlDesc[0],
          weight: 2.6,
          apply: (g, pl) => pl.addWeapon(id)
        });
      }
    }
    for (const u of UPGRADE_POOL) {
      if (u.id === 'dash' && p.dashMax >= 3) continue;
      offers.push({
        id: u.id, icon: u.icon, name: u.name, stat: u.stat, lvlText: '',
        weight: u.weight,
        apply: u.apply
      });
    }

    // weighted pick of 3 distinct
    const picks = [];
    const pool = offers.slice();
    for (let i = 0; i < 3 && pool.length; i++) {
      let total = pool.reduce((s, o) => s + o.weight, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (let j = 0; j < pool.length; j++) {
        r -= pool[j].weight;
        if (r <= 0) { idx = j; break; }
      }
      picks.push(pool.splice(idx, 1)[0]);
    }
    return picks;
  }

  chooseUpgrade(offer) {
    offer.apply(this, this.player);
    this.pendingLevels--;
    AudioSys.uibig();
    this.particles.spawn(this.player.x, this.player.y, 24, '#ffd27a', { speed: 170, life: 0.6, size: 3 });
    if (this.pendingLevels > 0) {
      UI.showLevelUp(this.generateOffers());
    } else {
      UI.hideLevelUp();
      this.state = 'playing';
    }
  }

  // ---------------- Spawning ----------------
  spawnEnemy() {
    const p = this.player;
    let x, y, tries = 0;
    do {
      x = rand(50, W - 50);
      y = rand(50, H - 50);
      tries++;
    } while (dist(x, y, p.x, p.y) < 280 && tries < 24);
    if (tries >= 24) return;

    const t = this.time;
    const s = this.sector;
    let type = 'wisp';
    const roll = Math.random();
    if (s === 1) {
      // v1.1: earlier pressure without more bodies (review note: "too easy early")
      if (t > 20 && roll < 0.25) type = 'husk';
      else if (t > 50 && roll < 0.40) type = 'shooter';
      else type = 'wisp';
    } else if (s === 2) {
      if (roll < 0.12) type = 'splitter';
      else if (roll < 0.32) type = 'husk';
      else if (roll < 0.46) type = 'shooter';
      else type = 'wisp';
    } else {
      if (roll < 0.16) type = 'splitter';
      else if (roll < 0.34) type = 'husk';
      else if (roll < 0.56) type = 'shooter';
      else type = 'wisp';
    }
    this.enemies.push(new Enemy(this, type, x, y, this.hpMul(), this.spdMul()));
  }

  spawnBoss() {
    const x = rand(W * 0.3, W * 0.7);
    const y = 120;
    this.boss = new Boss(this, this.sector, x, y);
    this.enemies.push(this.boss);
    AudioSys.boss();
    this.banner = { text: this.boss.name, t: 2.6 };
    Juice.shake(8);
  }

  onBossDead(boss) {
    this.boss = null;
    if (!this.endless && this.mode === 'free' && this.sector >= 2) {
      // FREE DEMO CEILING — the strongest sell moment in the game
      this.won = true;
      this.state = 'won';
      setTimeout(() => { if (this.state === 'won') UI.showEnd(this, true); }, 900);
      return;
    }
    if (!this.endless && this.sector >= 4) {
      this.endless = true;
      this.sector = 5;
      this.banner = { text: 'ENDLESS · THE FLAME REFUSES', t: 3.5 };
      this.nextBossAt = this.time + 90;
      return;
    }
    // next sector
    this.sector++;
    this.nextBossAt = this.time + 45;
    this.banner = { text: SECTORS[Math.min(this.sector, 4) - 1].name, t: 3 };
    // breather rewards
    this.pickups.push(new Pickup(W / 2 + rand(-40, 40), H / 2, 'heart', 30));
  }

  onPlayerDeath() {
    this.state = 'dead';
    setTimeout(() => { if (this.state === 'dead') UI.showEnd(this, false); }, 1100);
  }

  // ---------------- Update ----------------
  update(rawDt) {
    Juice.update(rawDt);
    const dt = rawDt * Juice.timeScale();

    // background/particles keep breathing even when paused-ish
    this.particles.update(rawDt);
    this.hurtFlash = Math.max(0, this.hurtFlash - rawDt * 2);
    if (this.banner.t > 0) this.banner.t -= rawDt;

    if (this.state !== 'playing') return;

    this.time += dt;

    // boss schedule
    if (!this.boss && this.time >= this.nextBossAt) {
      this.spawnBoss();
    }

    // spawn director (quiet while boss is up)
    if (!this.boss) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const interval = Math.max(0.22, 0.85 - this.time * 0.0022);
        this.spawnT = interval;
        const count = 1 + Math.floor(this.time / 75) + (this.endless ? 1 : 0);
        const cap = 55 + (this.endless ? 80 : this.sector * 22);
        for (let i = 0; i < count && this.enemies.length < cap; i++) this.spawnEnemy();
      }
    }

    this.player.update(dt, this);

    for (const e of this.enemies) e.update(dt, this);
    for (const b of this.bullets) b.update(dt, this);
    for (const b of this.enemyBolts) b.update(dt, this);
    for (const k of this.pickups) k.update(dt, this);
    for (const f of this.pools) f.update(dt, this);
    for (const n of this.novas) n.update(dt, this);
    for (const s of this.slamFx) { s.t -= dt; s.r += (s.maxR - s.r) * Math.min(1, dt * 10); }

    this.enemies = this.enemies.filter(e => !e.dead);
    this.bullets = this.bullets.filter(b => !b.dead);
    this.enemyBolts = this.enemyBolts.filter(b => !b.dead);
    this.pickups = this.pickups.filter(k => !k.dead);
    this.pools = this.pools.filter(f => !f.dead);
    this.novas = this.novas.filter(n => !n.dead);
    this.slamFx = this.slamFx.filter(s => s.t > 0);

    // multiplier decays slowly toward 1 when idle? keep simple: only resets on hit.
  }

  // ---------------- Draw ----------------
  draw(ctx) {
    const sec = this.sectorDef();
    const t = this.time;

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, sec.bg0);
    bg.addColorStop(1, sec.bg1);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // drifting ash motes
    ctx.save();
    ctx.fillStyle = sec.ash;
    for (const m of this.ashMotes) {
      const x = (m.x + Math.sin(t * 0.2 * m.s + m.ph) * 30 + t * 8 * m.s) % W;
      const y = (m.y + Math.cos(t * 0.15 * m.s + m.ph) * 20 + t * 4 * m.s) % H;
      ctx.beginPath();
      ctx.arc(x < 0 ? x + W : x, y < 0 ? y + H : y, m.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // arena frame
    ctx.strokeStyle = sec.accent + '44';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const off = Juice.offset();
    ctx.save();
    ctx.translate(off.x, off.y);

    for (const f of this.pools) f.draw(ctx);
    for (const k of this.pickups) k.draw(ctx);
    for (const n of this.novas) n.draw(ctx);

    // slam shockwaves
    for (const s of this.slamFx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(s.t / 0.35, 0, 1) * 0.7;
      ctx.strokeStyle = '#9fd4ff';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    for (const e of this.enemies) e.draw(ctx);
    for (const b of this.bullets) b.draw(ctx);
    for (const b of this.enemyBolts) b.draw(ctx);

    // orbiting embers
    if (this.orbDraw.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const o of this.orbDraw) {
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 2);
        g.addColorStop(0, '#fff8e8');
        g.addColorStop(0.4, this.player.char.orb);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    this.orbDraw = [];

    this.player.draw(ctx, this);
    this.particles.draw(ctx);

    ctx.restore(); // shake

    // hurt vignette
    if (this.hurtFlash > 0 || this.player.invuln > 0.75) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, 'rgba(255,40,20,0)');
      vg.addColorStop(1, 'rgba(255,40,20,0.35)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    // sector banner
    if (this.banner.t > 0) {
      const a = clamp(Math.min(this.banner.t, 3 - this.banner.t) * 1.4, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = sec.accent;
      ctx.font = '800 34px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = sec.accent;
      ctx.shadowBlur = 24;
      ctx.fillText(this.banner.text, W / 2, H * 0.3);
      ctx.restore();
    }
  }

  // HUD refresh (DOM)
  syncHud() {
    const p = this.player;
    UI.hud.hpfill.style.width = (p.hp / p.maxHp * 100) + '%';
    UI.hud.hptext.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    UI.hud.xpfill.style.width = clamp(this.xp / this.xpNeed * 100, 0, 100) + '%';
    UI.hud.leveltext.textContent = 'LV ' + this.level;
    UI.hud.timer.textContent = fmtTime(this.time);
    UI.hud.score.textContent = Math.round(this.score).toLocaleString('en-US');
    UI.hud.mult.textContent = 'x' + this.mult.toFixed(1);
    UI.hud.sectorname.textContent = this.endless ? 'ENDLESS · ' + this.sectorDef().name.split('·')[1].trim() : this.sectorDef().name;
    UI.hud.dashdot.classList.toggle('cooling', p.dashCharges === 0);
    if (this.boss && !this.boss.dead) {
      UI.hud.bosswrap.classList.remove('hidden');
      UI.hud.bossname.textContent = this.boss.name;
      UI.hud.bossfill.style.width = clamp(this.boss.hp / this.boss.maxHp * 100, 0, 100) + '%';
    } else {
      UI.hud.bosswrap.classList.add('hidden');
    }
  }
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}
