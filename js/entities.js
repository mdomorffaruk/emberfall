// EMBERFALL — entities.js
// Characters, player (move/dash/all weapons), enemies + AI, boss, projectiles, pickups.

// ---------------- Characters ----------------
// Four "flames". Ember is free; the other three are the paid roster
// (cheap to build — stat + weapon variants — high perceived value).
const CHARACTERS = [
  {
    id: 'ember', name: 'EMBER', unlocked: true,
    hp: 100, speed: 240, armor: 0, magnet: 90,
    weapon: 'spark', orb: '#ff8c2b', core: '#ffe9b0',
    desc: 'Steady starter flame.',
    statsTxt: 'HP 100 · SPARK'
  },
  {
    id: 'wisp', name: 'WISP', unlocked: false, price: 1.99,
    hp: 70, speed: 305, armor: 0, magnet: 140,
    weapon: 'spark', sparkCd: 0.42, sparkDmg: 9,
    orb: '#7ec8ff', core: '#eaf6ff',
    desc: 'Fast. Fragile. Deadly.',
    statsTxt: 'HP 70 · RAPID SPARKS'
  },
  {
    id: 'cinder', name: 'CINDER', unlocked: false, price: 1.99,
    hp: 165, speed: 195, armor: 3, magnet: 85,
    weapon: 'nova',
    orb: '#ff5a3c', core: '#ffd0a0',
    desc: 'Slow coal. Heavy hits.',
    statsTxt: 'HP 165 · NOVA · ARMOR 3'
  },
  {
    id: 'moth', name: 'MOTH', unlocked: false, price: 1.99,
    hp: 80, speed: 265, armor: 0, magnet: 210,
    weapon: 'trail',
    orb: '#d7b6ff', core: '#ffffff',
    desc: 'Walks. Everything burns.',
    statsTxt: 'HP 80 · TRAIL · BIG MAGNET'
  }
];

// ---------------- Weapon definitions ----------------
// Cards are icon-first (review v1.1): lvlDesc is the short stat line shown under the icon.
const WEAPONS = {
  spark: {
    name: 'SPARK', icon: '✦',
    maxLvl: 5,
    lvlDesc: ['HITS NEAREST', '+DMG', 'FASTER', 'TWIN SPARK', 'PIERCE'],
    cd: (p) => (p.char.sparkCd || 0.55) / p.fireRateMul,
    dmg: (p, l) => (p.char.sparkDmg || 12) * (1 + (l - 1) * 0.28) * p.dmgMul
  },
  orbit: {
    name: 'ORBIT', icon: '◎',
    maxLvl: 5,
    lvlDesc: ['2 ORBS', '3 ORBS', '+DMG', '4 ORBS', 'BLAZING']
  },
  nova: {
    name: 'NOVA', icon: '❂',
    maxLvl: 5,
    lvlDesc: ['HEAT BURST', 'BIGGER', '+DMG', 'FASTER', 'DOUBLE']
  },
  trail: {
    name: 'TRAIL', icon: '♨',
    maxLvl: 5,
    lvlDesc: ['FIRE POOLS', 'LONGER', '+DMG', 'WIDER', 'INFERNO']
  }
};

// ---------------- Player ----------------
class Player {
  constructor(char, x, y) {
    this.char = char;
    this.x = x; this.y = y;
    this.r = 13;
    this.hp = char.hp; this.maxHp = char.hp;
    this.speed = char.speed;
    this.armor = char.armor;
    this.magnet = char.magnet;
    this.dmgMul = 1;
    this.fireRateMul = 1;
    this.dashCharges = 1;
    this.dashMax = 1;
    this.dashCd = 0;
    this.dashTime = 0;
    this.dashDir = { x: 1, y: 0 };
    this.invuln = 0;
    this.alive = true;
    this.trailTimer = 0;

    this.weapons = {};
    this.addWeapon(char.weapon);

    this.t = { spark: 0.3, nova: 0.5, trail: 0 };
    this.orbitAngle = 0;
    this.orbitHits = new Map(); // enemy -> cooldown
    this.moving = false;
  }

  addWeapon(id) {
    if (this.weapons[id]) this.weapons[id].level++;
    else this.weapons[id] = { level: 1 };
  }

  weaponSlots() { return Object.keys(this.weapons).length; }

  update(dt, game) {
    if (!this.alive) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);

    // dash
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      const s = this.speed * 3.6;
      this.x += this.dashDir.x * s * dt;
      this.y += this.dashDir.y * s * dt;
      this.moving = true;
      // dash afterimage
      game.particles.spawn(this.x, this.y, 2, this.char.orb, { speed: 20, life: 0.3, size: 4, drag: 4 });
    } else {
      const ax = Input.axis();
      if (ax.x || ax.y) {
        const n = norm(ax.x, ax.y);
        this.x += n.x * this.speed * dt;
        this.y += n.y * this.speed * dt;
        this.dashDir = n;
        this.moving = true;
        // soft ember trail while walking
        if (Math.random() < 0.5) {
          game.particles.spawn(this.x, this.y, 1, this.char.orb, { speed: 30, life: 0.4, size: 2.5, drag: 3 });
        }
      } else {
        this.moving = false;
      }

      if (Input.wasPressed('Space') && this.dashCharges > 0 && this.dashCd <= 0) {
        this.dashTime = 0.16;
        this.dashCharges--;
        this.invuln = Math.max(this.invuln, 0.28);
        // Second Gust passive: more charges also recharge faster
        this.dashCd = 1.0 - (this.dashMax - 1) * 0.15;
        AudioSys.dash();
        game.particles.spawn(this.x, this.y, 10, this.char.core, { speed: 160, life: 0.35, size: 3 });
      }
    }
    // recharge dash charge
    if (this.dashCharges < this.dashMax && this.dashCd <= 0) {
      this.dashCharges++;
      if (this.dashCharges < this.dashMax) this.dashCd = 0.85;
    }

    // keep in arena
    this.x = clamp(this.x, this.r, W - this.r);
    this.y = clamp(this.y, this.r, H - this.r);

    this.updateWeapons(dt, game);
  }

  updateWeapons(dt, game) {
    const enemies = game.enemies;
    // --- SPARK ---
    if (this.weapons.spark) {
      const l = this.weapons.spark.level;
      const w = WEAPONS.spark;
      this.t.spark -= dt;
      if (this.t.spark <= 0 && enemies.length) {
        this.t.spark = w.cd(this) / (1 + (l - 1) * 0.06);
        const target = this.nearestEnemy(enemies);
        if (target) {
          const shots = l >= 4 ? 2 : 1;
          for (let i = 0; i < shots; i++) {
            const a = Math.atan2(target.y - this.y, target.x - this.x) + (i - (shots - 1) / 2) * 0.16;
            game.bullets.push(new PlayerBullet(
              this.x, this.y, a, 560,
              w.dmg(this, l), l >= 5 ? 2 : 1, '#ffd27a'
            ));
          }
          AudioSys.shoot();
        }
      }
    }

    // --- ORBIT ---
    if (this.weapons.orbit) {
      const l = this.weapons.orbit.level;
      const count = l >= 5 ? 4 : (l >= 3 ? 3 : 2);
      const dmg = (10 + l * 4) * this.dmgMul;
      const speed = 3.0 + (l >= 5 ? 1.6 : 0);
      this.orbitAngle += speed * dt;
      const or = 66 + l * 3;
      for (let i = 0; i < count; i++) {
        const a = this.orbitAngle + (i / count) * TAU;
        const ox = this.x + Math.cos(a) * or;
        const oy = this.y + Math.sin(a) * or;
        for (const e of enemies) {
          const cool = this.orbitHits.get(e) || 0;
          if (cool <= game.time && dist2(ox, oy, e.x, e.y) < (e.r + 8) * (e.r + 8)) {
            e.hurt(dmg, game, ox, oy);
            this.orbitHits.set(e, game.time + 0.45);
          }
        }
        game.orbDraw.push({ x: ox, y: oy, r: 7, color: this.char.core });
      }
    }

    // --- NOVA ---
    if (this.weapons.nova) {
      const l = this.weapons.nova.level;
      this.t.nova -= dt;
      if (this.t.nova <= 0) {
        const cd = (1.7 - l * 0.12) / this.fireRateMul;
        this.t.nova = cd;
        const pulses = l >= 4 ? 2 : 1;
        for (let i = 0; i < pulses; i++) {
          game.novas.push(new NovaRing(this.x, this.y, (110 + l * 12), (18 + l * 7) * this.dmgMul, i * 0.18));
        }
        Juice.shake(2);
        AudioSys.tone(200, 0.25, 'sine', 0.12, { slide: 60 });
      }
    }

    // --- TRAIL ---
    if (this.weapons.trail) {
      const l = this.weapons.trail.level;
      if (this.moving) {
        this.t.trail -= dt;
        if (this.t.trail <= 0) {
          this.t.trail = 0.11;
          game.pools.push(new FirePool(
            this.x, this.y,
            13 + l * 3.5,
            (12 + l * 6) * this.dmgMul,
            1.3 + l * 0.2
          ));
        }
      }
    }
  }

  nearestEnemy(enemies) {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      const d = dist2(this.x, this.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  hurt(dmg, game) {
    if (this.invuln > 0 || !this.alive) return;
    const real = Math.max(1, dmg - this.armor);
    this.hp -= real;
    this.invuln = 0.9;
    game.mult = 1;
    Juice.shake(9);
    AudioSys.hurt();
    game.particles.spawn(this.x, this.y, 18, '#ff6a4a', { speed: 200, life: 0.5, size: 3.5 });
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      Juice.shake(18);
      Juice.stop(0.14);
      AudioSys.death();
      game.particles.spawn(this.x, this.y, 60, this.char.orb, { speed: 280, life: 1.1, size: 4 });
      game.particles.spawn(this.x, this.y, 30, this.char.core, { speed: 160, life: 0.8, size: 3 });
      game.onPlayerDeath();
    }
  }

  draw(ctx, game) {
    const flick = 0.9 + Math.sin(game.time * 9) * 0.1 + Math.random() * 0.04;
    const blink = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.35;

    // outer glow (radial gradient, cheap bloom)
    const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, 34 * flick);
    g.addColorStop(0, this.char.core);
    g.addColorStop(0.35, this.char.orb);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 34 * flick, 0, TAU);
    ctx.fill();

    // core
    ctx.fillStyle = this.char.core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 0.55, 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}

class PlayerBullet {
  constructor(x, y, angle, speed, dmg, pierce, color) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.dmg = dmg;
    this.pierce = pierce;
    this.r = 5;
    this.life = 1.6;
    this.color = color;
    this.dead = false;
    this.hitSet = new Set();
  }
  update(dt, game) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || this.x < -20 || this.x > W + 20 || this.y < -20 || this.y > H + 20) this.dead = true;
    for (const e of game.enemies) {
      if (this.hitSet.has(e)) continue;
      if (dist2(this.x, this.y, e.x, e.y) < (this.r + e.r) * (this.r + e.r)) {
        e.hurt(this.dmg, game, this.x, this.y);
        this.hitSet.add(e);
        this.pierce--;
        if (this.pierce <= 0) { this.dead = true; break; }
      }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 10);
    g.addColorStop(0, '#fff8e8');
    g.addColorStop(0.4, this.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 10, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class NovaRing {
  constructor(x, y, maxR, dmg, delay) {
    this.x = x; this.y = y;
    this.r = 18;
    this.maxR = maxR;
    this.dmg = dmg;
    this.life = 0.4 + delay;
    this.delay = delay;
    this.hit = new Set();
    this.dead = false;
  }
  update(dt, game) {
    this.life -= dt;
    if (this.delay > 0) { this.delay -= dt; return; }
    this.r += (this.maxR - this.r) * Math.min(1, dt * 9);
    for (const e of game.enemies) {
      if (this.hit.has(e)) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d < this.r + e.r && d > this.r - 42) {
        e.hurt(this.dmg, game, this.x, this.y);
        this.hit.add(e);
      }
    }
    if (this.life <= 0 || this.r >= this.maxR - 2) this.dead = true;
  }
  draw(ctx) {
    if (this.delay > 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,160,70,0.8)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,180,0.35)';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.restore();
  }
}

class FirePool {
  constructor(x, y, r, dmg, life) {
    this.x = x; this.y = y;
    this.r = r; this.dmg = dmg;
    this.life = life; this.maxLife = life;
    this.tick = 0;
    this.dead = false;
  }
  update(dt, game) {
    this.life -= dt;
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.32;
      for (const e of game.enemies) {
        if (dist2(this.x, this.y, e.x, e.y) < (this.r + e.r) * (this.r + e.r)) {
          e.hurt(this.dmg, game, this.x, this.y);
        }
      }
    }
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx) {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * t + 0.1;
    const g = ctx.createRadialGradient(this.x, this.y, 1, this.x, this.y, this.r);
    g.addColorStop(0, '#ffb050');
    g.addColorStop(0.6, '#e04a1a');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------- Enemies ----------------
const ENEMY_DEFS = {
  wisp:     { hp: 12,  speed: 108, r: 11, dmg: 9,  xp: 1, score: 10, color: '#9fd4ff', shape: 'circle', flashCol: '#ffffff' },
  husk:     { hp: 58,  speed: 54,  r: 20, dmg: 16, xp: 3, score: 30, color: '#5a86b8', shape: 'square' },
  shooter:  { hp: 30,  speed: 72,  r: 13, dmg: 8,  xp: 3, score: 35, color: '#b0e0ff', shape: 'diamond' },
  splitter: { hp: 28,  speed: 88,  r: 15, dmg: 10, xp: 3, score: 35, color: '#7fffe0', shape: 'hex' },
  mini:     { hp: 8,   speed: 135, r: 7,  dmg: 6,  xp: 1, score: 5,  color: '#aef5e8', shape: 'circle' }
};

class Enemy {
  constructor(game, type, x, y, hpMul, spdMul) {
    const d = ENEMY_DEFS[type];
    this.type = type;
    this.def = d;
    this.x = x; this.y = y;
    this.hp = d.hp * hpMul;
    this.maxHp = this.hp;
    this.speed = d.speed * spdMul;
    this.r = d.r;
    this.dmg = d.dmg;
    this.color = d.color;
    this.flash = 0;
    this.hitCd = 0;      // contact damage cooldown vs player
    this.shootT = rand(1, 2.2);
    this.wob = rand(0, TAU);
    this.kx = 0; this.ky = 0; // knockback velocity
    this.dead = false;
    this.isBoss = false;
  }

  hurt(dmg, game, sx, sy) {
    this.hp -= dmg;
    this.flash = 0.08;
    const n = norm(this.x - sx, this.y - sy);
    const kb = this.type === 'husk' || this.isBoss ? 40 : 130;
    this.kx += n.x * kb;
    this.ky += n.y * kb;
    game.particles.spawn(this.x, this.y, 3, '#ffffff', { speed: 90, life: 0.22, size: 2.2 });
    AudioSys.hit();
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    game.kills++;
    game.mult = Math.min(8, game.mult + 0.08);
    game.score += Math.round(this.def.score * game.mult);
    AudioSys.kill();
    game.particles.spawn(this.x, this.y, 10 + (this.r | 0), this.color, { speed: 150, life: 0.5, size: 3 });
    // ember drops
    const v = this.def.xp;
    game.pickups.push(new Pickup(this.x + rand(-8, 8), this.y + rand(-8, 8), 'xp', v));
    if (this.type === 'husk' && Math.random() < 0.1) {
      game.pickups.push(new Pickup(this.x + rand(-14, 14), this.y, 'heart', 25));
    }
    if (this.type === 'splitter') {
      for (let i = 0; i < 2; i++) {
        const m = new Enemy(game, 'mini', this.x + rand(-12, 12), this.y + rand(-12, 12), game.hpMul(), 1);
        game.enemies.push(m);
      }
    }
  }

  update(dt, game) {
    this.flash = Math.max(0, this.flash - dt);
    this.hitCd = Math.max(0, this.hitCd - dt);
    // knockback decay
    this.x += this.kx * dt; this.y += this.ky * dt;
    this.kx *= Math.exp(-8 * dt); this.ky *= Math.exp(-8 * dt);

    const p = game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const n = norm(p.x - this.x, p.y - this.y);
    this.wob += dt * 3;

    if (this.type === 'shooter') {
      // maintain range
      let mv = 0;
      if (d > 300) mv = 1;
      else if (d < 200) mv = -1;
      const strafe = Math.sin(this.wob) * 0.55;
      this.x += (n.x * mv + -n.y * strafe) * this.speed * dt;
      this.y += (n.y * mv + n.x * strafe) * this.speed * dt;
      this.shootT -= dt;
      if (this.shootT <= 0 && d < 520) {
        this.shootT = 2.3;
        const a = Math.atan2(p.y - this.y, p.x - this.x);
        game.enemyBolts.push(new EnemyBolt(this.x, this.y, a, 230, this.dmg));
      }
    } else {
      // chaser — slight wobble so groups feel alive
      const w = Math.sin(this.wob) * 0.25;
      this.x += (n.x - n.y * w) * this.speed * dt;
      this.y += (n.y + n.x * w) * this.speed * dt;
    }

    // contact with player
    if (d < this.r + p.r && this.hitCd <= 0) {
      this.hitCd = 0.7;
      p.hurt(this.dmg, game);
      const k = norm(this.x - p.x, this.y - p.y);
      this.kx += k.x * 180; this.ky += k.y * 180;
    }

    this.x = clamp(this.x, this.r, W - this.r);
    this.y = clamp(this.y, this.r, H - this.r);
  }

  draw(ctx) {
    const { shape } = this.def;
    ctx.save();
    ctx.translate(this.x, this.y);
    const col = this.flash > 0 ? '#ffffff' : this.color;

    // soft under-glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.7, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
    } else if (shape === 'square') {
      ctx.rotate(this.wob * 0.3);
      ctx.rect(-this.r * 0.8, -this.r * 0.8, this.r * 1.6, this.r * 1.6);
      ctx.fill();
      ctx.fillStyle = 'rgba(10,20,35,0.55)';
      ctx.fillRect(-this.r * 0.35, -this.r * 0.35, this.r * 0.7, this.r * 0.7);
    } else if (shape === 'diamond') {
      ctx.moveTo(0, -this.r); ctx.lineTo(this.r, 0); ctx.lineTo(0, this.r); ctx.lineTo(-this.r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0a1424';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.3, 0, TAU);
      ctx.fill();
    } else if (shape === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + this.wob * 0.2;
        const px = Math.cos(a) * this.r, py = Math.sin(a) * this.r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.stroke();
    }
    ctx.restore();
  }
}

class EnemyBolt {
  constructor(x, y, angle, speed, dmg) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.dmg = dmg;
    this.r = 6;
    this.life = 3;
    this.dead = false;
  }
  update(dt, game) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || this.x < -10 || this.x > W + 10 || this.y < -10 || this.y > H + 10) this.dead = true;
    const p = game.player;
    if (!this.dead && dist2(this.x, this.y, p.x, p.y) < (this.r + p.r) * (this.r + p.r)) {
      p.hurt(this.dmg, game);
      this.dead = true;
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 9);
    g.addColorStop(0, '#eaf6ff');
    g.addColorStop(0.5, '#6fb7ff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 9, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------- Boss: the Frostbound ----------------
class Boss {
  constructor(game, tier, x, y) {
    this.tier = tier; // 1..N
    this.x = x; this.y = y;
    this.r = 34 + tier * 4;
    this.maxHp = 700 * Math.pow(1.55, tier - 1);
    this.hp = this.maxHp;
    this.speed = 60 + tier * 6;
    this.dmg = 16 + tier * 3;
    this.color = '#8fc4ff';
    this.isBoss = true;
    this.dead = false;
    this.flash = 0;
    this.hitCd = 0;
    this.state = 'intro';
    this.stateT = 2.2;
    this.attackT = 3;
    this.angle = rand(0, TAU);
    this.kx = 0; this.ky = 0;
    this.name = ['FROSTBOUND', 'FROSTBOUND PRIME', 'THE WHITE HUNGER', 'FROSTBOUND ETERNAL', 'THE LAST WINTER'][Math.min(4, tier - 1)];
    this.chargeVx = 0; this.chargeVy = 0;
    this.slamR = 0;
  }

  hurt(dmg, game, sx, sy) {
    if (this.state === 'intro') return;
    this.hp -= dmg;
    this.flash = 0.07;
    const n = norm(this.x - sx, this.y - sy);
    this.kx += n.x * 30; this.ky += n.y * 30;
    game.particles.spawn(this.x, this.y, 4, '#dff0ff', { speed: 110, life: 0.25, size: 2.5 });
    AudioSys.hit();
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    game.kills++;
    game.score += Math.round(500 * this.tier * game.mult);
    game.mult = Math.min(8, game.mult + 1);
    Juice.shake(16);
    Juice.stop(0.12);
    AudioSys.bossDie();
    for (let i = 0; i < 5; i++) {
      game.particles.spawn(this.x + rand(-30, 30), this.y + rand(-30, 30), 22, i % 2 ? '#bfe4ff' : '#ffffff', { speed: 260, life: 1, size: 4 });
    }
    for (let i = 0; i < 8; i++) {
      game.pickups.push(new Pickup(this.x + rand(-40, 40), this.y + rand(-40, 40), 'xp', 3));
    }
    game.pickups.push(new Pickup(this.x, this.y, 'heart', 40));
    game.onBossDead(this);
  }

  update(dt, game) {
    this.flash = Math.max(0, this.flash - dt);
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.x += this.kx * dt; this.y += this.ky * dt;
    this.kx *= Math.exp(-6 * dt); this.ky *= Math.exp(-6 * dt);
    this.angle += dt * 0.6;

    const p = game.player;
    const n = norm(p.x - this.x, p.y - this.y);
    this.stateT -= dt;

    switch (this.state) {
      case 'intro':
        if (this.stateT <= 0) { this.state = 'stalk'; this.stateT = 0.5; }
        break;
      case 'stalk': {
        this.x += n.x * this.speed * dt;
        this.y += n.y * this.speed * dt;
        this.attackT -= dt;
        if (this.attackT <= 0) {
          this.attackT = rand(2.2, 3.4);
          const pick = this.tier >= 2
            ? choice(['charge', 'slam', 'summon', 'ring'])
            : choice(['charge', 'slam', 'summon']);
          this.state = pick === 'charge' ? 'telegraph' : pick;
          this.stateT = pick === 'charge' ? 0.65 : (pick === 'slam' ? 0.8 : 0.4);
          if (pick === 'charge') this.chargeDir = n;
          if (pick === 'ring') { this.stateT = 0.5; }
          if (pick === 'charge') AudioSys.tone(300, 0.5, 'sawtooth', 0.1, { slide: 900 });
        }
        break;
      }
      case 'telegraph': // charge windup
        if (this.stateT <= 0) {
          this.state = 'charging';
          this.stateT = 0.85;
          this.chargeVx = this.chargeDir.x * (520 + this.tier * 40);
          this.chargeVy = this.chargeDir.y * (520 + this.tier * 40);
          AudioSys.noise(0.3, 0.14, { freq: 2000, slide: 200 });
        }
        break;
      case 'charging': {
        this.x += this.chargeVx * dt;
        this.y += this.chargeVy * dt;
        game.particles.spawn(this.x, this.y, 3, '#bfe4ff', { speed: 40, life: 0.3, size: 4 });
        if (this.x < this.r || this.x > W - this.r) this.chargeVx *= -1;
        if (this.y < this.r || this.y > H - this.r) this.chargeVy *= -1;
        this.x = clamp(this.x, this.r, W - this.r);
        this.y = clamp(this.y, this.r, H - this.r);
        if (this.stateT <= 0) { this.state = 'stalk'; this.stateT = 0.6; }
        if (this.hitCd <= 0 && dist(this.x, this.y, p.x, p.y) < this.r + p.r + 4) {
          this.hitCd = 0.8;
          p.hurt(this.dmg + 6, game);
        }
        break;
      }
      case 'slam': {
        if (this.stateT <= 0) {
          this.state = 'stalk';
          this.stateT = 0.7;
          Juice.shake(12);
          AudioSys.noise(0.4, 0.2, { freq: 400, slide: 60 });
          // shockwave ring damages
          const R = 170 + this.tier * 15;
          if (dist(this.x, this.y, p.x, p.y) < R) p.hurt(this.dmg, game);
          for (let i = 0; i < 26; i++) {
            const a = (i / 26) * TAU;
            game.particles.spawn(this.x + Math.cos(a) * 30, this.y + Math.sin(a) * 30, 2, '#9fd4ff', { dir: a, speed: 260, life: 0.5, size: 3 });
          }
          game.slamFx.push({ x: this.x, y: this.y, r: 20, maxR: R, t: 0.35 });
        }
        break;
      }
      case 'summon': {
        if (this.stateT <= 0) {
          this.state = 'stalk';
          this.stateT = 0.8;
          const count = 4 + this.tier;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * TAU;
            const e = new Enemy(game, 'wisp', this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 70, game.hpMul() * 0.8, 1.1);
            game.enemies.push(e);
          }
          AudioSys.tone(140, 0.3, 'triangle', 0.12, { slide: 300 });
        }
        break;
      }
      case 'ring': {
        if (this.stateT <= 0) {
          this.state = 'stalk';
          this.stateT = 0.9;
          const nBolts = 14 + this.tier * 2;
          for (let i = 0; i < nBolts; i++) {
            const a = (i / nBolts) * TAU + this.angle;
            game.enemyBolts.push(new EnemyBolt(this.x, this.y, a, 210, this.dmg - 6));
          }
          AudioSys.tone(500, 0.2, 'square', 0.08, { slide: 150 });
        }
        break;
      }
    }

    this.x = clamp(this.x, this.r, W - this.r);
    this.y = clamp(this.y, this.r, H - this.r);

    // contact damage
    if (this.state !== 'intro' && this.hitCd <= 0 && dist(this.x, this.y, p.x, p.y) < this.r + p.r) {
      this.hitCd = 0.8;
      p.hurt(this.dmg, game);
    }
  }

  draw(ctx) {
    const telegraph = this.state === 'telegraph' || this.state === 'slam';
    ctx.save();
    ctx.translate(this.x, this.y);

    // aura
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22 + (telegraph ? 0.25 : 0);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, this.r * 2.2);
    g.addColorStop(0, '#bfe4ff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, this.r * 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // rotating shard rings
    ctx.strokeStyle = this.flash > 0 ? '#ffffff' : '#8fc4ff';
    ctx.lineWidth = 3;
    for (let ring = 0; ring < 2; ring++) {
      const rr = this.r * (1.25 + ring * 0.35);
      const off = this.angle * (ring ? -1.2 : 1) * 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = off + (i / 6) * TAU;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // body: jagged hexagon
    const col = this.flash > 0 ? '#ffffff' : '#6fa8e0';
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = this.angle + (i / 8) * TAU;
      const rr = this.r * (i % 2 === 0 ? 1 : 0.78);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // frozen core
    ctx.fillStyle = '#0a1626';
    ctx.beginPath(); ctx.arc(0, 0, this.r * 0.45, 0, TAU); ctx.fill();
    ctx.fillStyle = telegraph ? '#ffffff' : '#d7ecff';
    ctx.beginPath(); ctx.arc(0, 0, this.r * 0.22 * (1 + Math.sin(this.angle * 8) * 0.15), 0, TAU); ctx.fill();

    ctx.restore();
  }
}

// ---------------- Pickups ----------------
class Pickup {
  constructor(x, y, type, value) {
    this.x = x; this.y = y;
    this.vx = rand(-60, 60);
    this.vy = rand(-60, 60);
    this.type = type;   // 'xp' | 'heart'
    this.value = value;
    this.r = type === 'heart' ? 10 : 6;
    this.bob = rand(0, TAU);
    this.dead = false;
  }
  update(dt, game) {
    this.bob += dt * 5;
    const p = game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    // magnet pull
    if (d < p.magnet) {
      const n = norm(p.x - this.x, p.y - this.y);
      const pull = lerp(560, 160, clamp(d / p.magnet, 0, 1));
      this.vx += n.x * pull * dt * 6;
      this.vy += n.y * pull * dt * 6;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.exp(-3.5 * dt);
    this.vy *= Math.exp(-3.5 * dt);

    if (d < p.r + this.r) {
      this.dead = true;
      if (this.type === 'xp') {
        game.addXp(this.value);
        game.particles.spawn(this.x, this.y, 4, '#6fb7ff', { speed: 70, life: 0.3, size: 2 });
        AudioSys.pickup();
      } else {
        p.hp = Math.min(p.maxHp, p.hp + this.value);
        game.particles.spawn(this.x, this.y, 12, '#8effa8', { speed: 110, life: 0.5, size: 3 });
        AudioSys.tone(700, 0.2, 'sine', 0.12, { slide: 1200 });
      }
    }
  }
  draw(ctx) {
    const y = this.y + Math.sin(this.bob) * 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (this.type === 'xp') {
      const g = ctx.createRadialGradient(this.x, y, 0, this.x, y, 9);
      g.addColorStop(0, '#eaf6ff');
      g.addColorStop(0.45, '#4a90e0');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, y, 9, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = '#5fe07a';
      ctx.beginPath(); ctx.arc(this.x, y, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#eaffef';
      ctx.fillRect(this.x - 1.6, y - 5, 3.2, 10);
      ctx.fillRect(this.x - 5, y - 1.6, 10, 3.2);
    }
    ctx.restore();
  }
}
