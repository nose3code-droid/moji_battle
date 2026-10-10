// ゲームの進行（描画なし）。main.js から createGame → step で動かす
import { ELS, BEATS, BOSS_PHASE, COLS, ROWS, TOWERS, ENEMY, MAPS } from './data.js';

export const WAVES = 10;

export function matchup(att, def) {
  if (BEATS[att] === def) return 2;
  if (BEATS[def] === att) return 0.5;
  return 1;
}
// 大きな影は、いまの属性に強い砲台だけがよく効く
export function damageMult(att, e) {
  if (e.boss) return BEATS[att] === bossEl(e) ? 2 : 0.3;
  return matchup(att, e.el);
}
export function bossEl(e) { return BOSS_PHASE[Math.min(4, Math.floor((1 - Math.max(0, e.hp) / e.maxHp) * 5))]; }
export const enemyEl = e => (e.boss ? bossEl(e) : e.el);

function buildPath(wps) {
  const pts = wps.map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, len: cum[cum.length - 1] };
}
function pathCells(paths) {
  const s = new Set();
  for (const wps of paths) {
    for (let i = 1; i < wps.length; i++) {
      const [c0, r0] = wps[i - 1], [c1, r1] = wps[i];
      const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
      for (let k = 0; k <= n; k++) s.add(`${c0 + Math.sign(c1 - c0) * k},${r0 + Math.sign(r1 - r0) * k}`);
    }
  }
  return s;
}
function posAt(p, d) {
  let i = 1;
  while (i < p.pts.length - 1 && p.cum[i] < d) i++;
  const a = p.pts[i - 1], b = p.pts[i], seg = p.cum[i] - p.cum[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (d - p.cum[i - 1]) / seg));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// 波の中身。5属性が各マップの1〜5波目に1つずつ主役で出る。10波目は大きな影＋5属性のおとも
export function makeWave(mi, w) {
  const list = [];
  if (w === WAVES) {
    list.push({ t: 0, boss: true, el: '闇' });
    const n = 3 + mi;
    for (let k = 0; k < n; k++) ELS.forEach((el, i) => list.push({ t: 3 + k * 5 * 1.5 + i * 1.5, el }));
    return list.sort((a, b) => a.t - b.t);
  }
  const groups = [[(w - 1 + mi * 2) % 5, 5 + w], [(w + 1 + mi) % 5, 3 + Math.floor(w * 0.8)]];
  if (w >= 4) groups.push([(w + 3 + mi * 2) % 5, 2 + Math.floor(w / 2)]);
  groups.forEach(([ei, n], gi) => {
    for (let k = 0; k < n; k++) list.push({ t: gi * 4 + k * Math.max(0.55, 1.0 - w * 0.04), el: ELS[ei] });
  });
  return list.sort((a, b) => a.t - b.t);
}
const hpMul = (mi, w) => MAPS[mi].hpMul * (1 + 0.4 * (w - 1) + 0.03 * (w - 1) ** 2);

export function createGame(mi) {
  const map = MAPS[mi];
  return {
    mi, map, paths: map.paths.map(buildPath), pathCells: pathCells(map.paths),
    t: 0, money: map.money, lives: map.lives, maxLives: map.lives,
    wave: 0, waveActive: false, queue: [], waveT0: 0, lit: 0,
    enemies: [], towers: [], shots: [], fx: [], events: [], over: null, stars: 0, nextId: 1, spawnN: 0, hitFlash: 0,
  };
}

export const towerStat = (t) => {
  const d = TOWERS[t.el], o = { el: t.el };
  for (const k of Object.keys(d)) if (Array.isArray(d[k]) && d[k].length === 4) o[k] = d[k][t.lv];
  return o;
};
export const upgradeCost = t => (t.lv < 3 ? TOWERS[t.el].up[t.lv] : null);
export const sellValue = t => Math.floor(t.spent * 0.7);
export const towerAt = (g, c, r) => g.towers.find(t => t.c === c && t.r === r);
export const canBuild = (g, c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !g.pathCells.has(`${c},${r}`) && !towerAt(g, c, r);

export function build(g, el, c, r) {
  const cost = TOWERS[el].cost;
  if (g.over || !canBuild(g, c, r) || g.money < cost) return null;
  g.money -= cost;
  const t = { id: g.nextId++, el, c, r, x: c + 0.5, y: r + 0.5, lv: 0, cd: 0.2, spent: cost, ang: 0, kick: 0 };
  g.towers.push(t);
  g.fx.push({ k: 'build', el, x: t.x, y: t.y, t0: g.t, ttl: 0.5 });
  return t;
}
export function upgrade(g, t) {
  const cost = upgradeCost(t);
  if (g.over || cost == null || g.money < cost) return false;
  g.money -= cost; t.spent += cost; t.lv++;
  g.fx.push({ k: 'build', el: t.el, x: t.x, y: t.y, t0: g.t, ttl: 0.6 });
  return true;
}
export function sell(g, t) {
  g.money += sellValue(t);
  g.towers = g.towers.filter(o => o !== t);
  return true;
}
export function startWave(g) {
  if (g.over || g.waveActive || g.wave >= WAVES) return false;
  g.wave++;
  g.queue = makeWave(g.mi, g.wave);
  g.waveT0 = g.t;
  g.waveActive = true;
  g.events.push({ type: 'wave', wave: g.wave });
  return true;
}

function spawn(g, def) {
  const base = ENEMY[def.el];
  const pi = g.spawnN++ % g.paths.length;
  const mul = hpMul(g.mi, g.wave);
  const boss = !!def.boss;
  const hp = boss ? 5500 * g.map.hpMul : base.hp * mul;
  g.enemies.push({
    id: g.nextId++, el: def.el, boss, hp, maxHp: hp, speed: boss ? 0.5 : base.speed, reward: boss ? 120 : Math.round(base.reward * (1 + (g.wave - 1) * 0.06)),
    pi, dist: 0, x: 0, y: 0, slowUntil: 0, slowF: 1, vulnUntil: 0, vulnF: 1, dotUntil: 0, dot: 0, cursedUntil: 0, bonus: 0, flash: 0,
  });
  const e = g.enemies[g.enemies.length - 1];
  Object.assign(e, posAt(g.paths[pi], 0));
}

function damage(g, e, base, att, opt = {}) {
  if (e.hp <= 0) return;
  let m = damageMult(att, e);
  if (g.t < e.vulnUntil) m *= e.vulnF;
  const d = base * m;
  e.hp -= d; e.flash = 0.12;
  if (!opt.silent) g.fx.push({ k: 'num', x: e.x, y: e.y - 0.3, v: Math.round(d), m, t0: g.t, ttl: 0.7, el: att });
  if (e.hp <= 0) kill(g, e);
}
function kill(g, e) {
  e.dead = true;
  g.money += e.reward + (g.t < e.cursedUntil ? e.bonus : 0);
  if (g.t < e.cursedUntil) g.fx.push({ k: 'coin', x: e.x, y: e.y, t0: g.t, ttl: 0.8, v: e.bonus });
  g.fx.push({ k: 'die', x: e.x, y: e.y, t0: g.t, ttl: 0.5, boss: e.boss });
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * f), p.y - (a.y + dy * f));
}

function fire(g, t, target) {
  const s = towerStat(t);
  t.ang = Math.atan2(target.y - t.y, target.x - t.x);
  t.kick = 0.15;
  const live = () => g.enemies.filter(e => !e.dead);
  if (t.el === '火') g.shots.push({ k: '火', x: t.x, y: t.y, target, tx: target.x, ty: target.y, speed: 6, s });
  else if (t.el === '水') g.shots.push({ k: '水', x: t.x, y: t.y, target, tx: target.x, ty: target.y, speed: 9, s });
  else if (t.el === '闇') g.shots.push({ k: '闇', x: t.x, y: t.y, target, tx: target.x, ty: target.y, speed: 5, s });
  else if (t.el === '光') {
    const end = { x: t.x + Math.cos(t.ang) * s.range, y: t.y + Math.sin(t.ang) * s.range };
    for (const e of live()) {
      if (segDist(e, t, end) <= 0.4) {
        damage(g, e, s.dmg, '光');
        if (e.hp > 0) { e.vulnF = g.t < e.vulnUntil ? Math.max(e.vulnF, s.vuln) : s.vuln; e.vulnUntil = g.t + 3; }
      }
    }
    g.fx.push({ k: 'beam', x: t.x, y: t.y, x2: end.x, y2: end.y, t0: g.t, ttl: 0.3 });
  } else if (t.el === '雷') {
    const hits = [target], pts = [{ x: t.x, y: t.y }, { x: target.x, y: target.y }];
    let last = target;
    for (let i = 1; i < s.chain; i++) {
      let best = null, bd = 1.7;
      for (const e of live()) {
        if (hits.includes(e)) continue;
        const d = dist(e, last);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      hits.push(best); pts.push({ x: best.x, y: best.y }); last = best;
    }
    hits.forEach((e, i) => damage(g, e, s.dmg * 0.8 ** i, '雷'));
    g.fx.push({ k: 'bolt', pts, t0: g.t, ttl: 0.35 });
  }
}

function shotHit(g, sh) {
  const e = sh.target;
  if (sh.k === '火') {
    for (const o of g.enemies) if (!o.dead && dist(o, { x: sh.tx, y: sh.ty }) <= sh.s.splash) damage(g, o, sh.s.dmg, '火');
    g.fx.push({ k: 'boom', x: sh.tx, y: sh.ty, r: sh.s.splash, t0: g.t, ttl: 0.45 });
  } else if (e && !e.dead) {
    if (sh.k === '水') {
      damage(g, e, sh.s.dmg, '水');
      e.slowUntil = g.t + 1.6; e.slowF = Math.min(g.t < e.slowUntil ? e.slowF : 1, 1 - sh.s.slow);
      g.fx.push({ k: 'ripple', x: e.x, y: e.y, t0: g.t, ttl: 0.5 });
    } else if (sh.k === '闇') {
      damage(g, e, sh.s.dmg, '闇');
      if (!e.dead) {
        e.dotUntil = g.t + 4; e.dot = Math.max(g.t < e.dotUntil ? e.dot : 0, sh.s.dot * damageMult('闇', e));
        e.cursedUntil = g.t + 5; e.bonus = Math.max(e.bonus, sh.s.bonus);
        g.fx.push({ k: 'curse', x: e.x, y: e.y, t0: g.t, ttl: 0.6 });
      }
    }
  }
}

export function step(g, dt) {
  if (g.over) return;
  g.t += dt;
  // 出現
  while (g.queue.length && g.queue[0].t <= g.t - g.waveT0) spawn(g, g.queue.shift());
  // 敵
  for (const e of g.enemies) {
    if (e.dead) continue;
    if (g.t >= e.slowUntil) e.slowF = 1;
    if (g.t >= e.vulnUntil) e.vulnF = 1;
    if (g.t >= e.cursedUntil) e.bonus = 0;
    if (g.t < e.dotUntil && e.dot > 0) {
      let m = g.t < e.vulnUntil ? e.vulnF : 1;
      e.hp -= e.dot * m * dt; e.flash = Math.max(e.flash, 0.05);
      if (e.hp <= 0) kill(g, e);
      if (e.dead) continue;
    }
    e.flash = Math.max(0, e.flash - dt);
    e.dist += e.speed * (g.t < e.slowUntil ? e.slowF : 1) * dt;
    const p = g.paths[e.pi];
    if (e.dist >= p.len) {
      e.dead = true; e.leaked = true;
      g.lives -= e.boss ? 10 : 1; g.hitFlash = 0.4;
      g.events.push({ type: 'leak', boss: e.boss });
    } else Object.assign(e, posAt(p, e.dist));
  }
  g.enemies = g.enemies.filter(e => !e.dead);
  // 砲台
  for (const t of g.towers) {
    t.cd -= dt; t.kick = Math.max(0, t.kick - dt);
    if (t.cd > 0) continue;
    const s = towerStat(t);
    let best = null;
    for (const e of g.enemies) if (dist(e, t) <= s.range && (!best || e.dist > best.dist)) best = e;
    if (best) { fire(g, t, best); t.cd = s.cd; }
  }
  g.enemies = g.enemies.filter(e => !e.dead);
  // 弾
  for (const sh of g.shots) {
    if (sh.target && !sh.target.dead && g.enemies.includes(sh.target)) { sh.tx = sh.target.x; sh.ty = sh.target.y; }
    else if (sh.k !== '火') { sh.done = true; continue; }
    const dx = sh.tx - sh.x, dy = sh.ty - sh.y, d = Math.hypot(dx, dy), mv = sh.speed * dt;
    if (d <= mv) { shotHit(g, sh); sh.done = true; } else { sh.x += dx / d * mv; sh.y += dy / d * mv; }
  }
  g.shots = g.shots.filter(s => !s.done);
  g.enemies = g.enemies.filter(e => !e.dead);
  g.fx = g.fx.filter(f => g.t - f.t0 < f.ttl);
  g.hitFlash = Math.max(0, g.hitFlash - dt);
  // 波の終わり／決着
  if (g.lives <= 0) { g.lives = 0; g.over = 'lose'; g.events.push({ type: 'lose' }); return; }
  if (g.waveActive && !g.queue.length && !g.enemies.length) {
    g.waveActive = false;
    g.money += 40 + g.wave * 6;
    if (g.wave % 2 === 0) { g.lit = g.wave / 2; g.events.push({ type: 'shrine', n: g.lit }); }
    g.events.push({ type: 'clear', wave: g.wave });
    if (g.wave >= WAVES) {
      g.over = 'win';
      const f = g.lives / g.maxLives;
      g.stars = f >= 0.8 ? 3 : f >= 0.5 ? 2 : 1;
      g.events.push({ type: 'win', stars: g.stars });
    }
  }
}
