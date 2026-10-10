// 火消し大作戦：ゲームの中身（画面には触らない。DOM なしで動くのでテストしやすい）
import { COLS, ROWS } from './stages.js';

export const WATER_MAX = 16;
export const SAND_MAX = 6;
const STEP_CD = 0.12;     // 1マス動くまでの間隔（秒）
const SHOT_CD = 0.16;     // 放水の間隔
const RANGE = { water: 3, sand: 2 };
const FLAM = { '.': 0.1, K: 1, T: 1, O: 1.3 };            // 燃えやすさ（その他は燃えない）
const FUEL = { '.': 3, K: 14, T: 9, O: 16 };              // 燃え尽きるまでの秒数
const WIND = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const WALKABLE = new Set(['.', 'W', 'O']);                // 歩ける地形（燃え尽きた所は何でも歩ける）

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(stage, seed = 1) {
  const g = {
    stage, rng: mulberry32(seed), t: 0, timeLeft: stage.time,
    tiles: [], residents: [], boss: null, events: [],
    player: { x: 0, y: 0, fx: 0, fy: -1, water: WATER_MAX, sand: SAND_MAX, ammo: 'water', stepCd: 0, shotCd: 0 },
    burnt: 0, lost: 0, saved: 0, state: 'play', reason: '', rain: false,
    windIdx: 0, windT: 0, wind: null, bossT: 1.5, noOilHint: false,
  };
  setWind(g);
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      const c = stage.map[y][x];
      const up = c.toUpperCase();
      const fire = c !== up && c !== '.';
      let t = up;
      if (up === 'H') { t = 'K'; g.residents.push({ x, y, hp: 1, prog: 0, state: 'wait' }); }
      if (up === 'P') { t = '.'; g.player.x = x; g.player.y = y; }
      if (up === 'B') { t = '.'; g.boss = { x, y, hp: stage.boss, max: stage.boss, hitT: 0 }; }
      row.push({ t, fire, heat: 1, burn: 0, wet: 0, sand: false, burnt: false });
    }
    g.tiles.push(row);
  }
  return g;
}

function setWind(g) {
  const w = g.stage.wind;
  const d = Array.isArray(w) ? w[g.windIdx % w.length] : w;
  g.windDir = d || null;
  g.wind = d ? WIND[d] : null;
}

export const inb = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
export const tileAt = (g, x, y) => (inb(x, y) ? g.tiles[y][x] : null);
export const burning = g => g.tiles.flat().filter(t => t.fire).length;
export const residentAt = (g, x, y) => g.residents.find(r => r.x === x && r.y === y);
export const loss = g => g.burnt + g.lost;

export function stars(g) {
  const l = loss(g), lim = g.stage.limit;
  if (l <= Math.floor(lim / 4)) return 3;
  if (l <= Math.floor(lim * 0.6)) return 2;
  return 1;
}

function ignitable(tl) {
  return FLAM[tl.t] && !tl.fire && !tl.burnt && tl.wet <= 0 && !tl.sand;
}
function ignite(g, x, y) {
  const tl = g.tiles[y][x];
  tl.fire = true; tl.heat = 1;
  g.events.push({ type: 'ignite', x, y });
}

function walkable(g, x, y) {
  const tl = tileAt(g, x, y);
  if (!tl || tl.t === 'S' || tl.fire) return false;
  if (g.boss && g.boss.hp > 0 && g.boss.x === x && g.boss.y === y) return false;
  return tl.burnt ? true : WALKABLE.has(tl.t);
}

export const canWalk = walkable;

export function switchAmmo(g) {
  g.player.ammo = g.player.ammo === 'water' ? 'sand' : 'water';
}

// 放水（砂まき）。狙った方向の直線上に range マス
function shoot(g) {
  const p = g.player;
  const kind = p.ammo;
  if (p[kind] < 1) { g.events.push({ type: 'empty', ammo: kind }); p.shotCd = 0.3; return; }
  p[kind] -= 1;
  p.shotCd = SHOT_CD;
  let len = 0;
  for (let i = 1; i <= RANGE[kind]; i++) {
    const x = p.x + p.fx * i, y = p.y + p.fy * i;
    const tl = tileAt(g, x, y);
    if (!tl || tl.t === 'S') break;
    len = i;
    if (g.boss && g.boss.hp > 0 && g.boss.x === x && g.boss.y === y) {
      if (kind === 'water') { g.boss.hp -= 1; g.boss.hitT = 0.25; g.events.push({ type: 'hit', x, y, ammo: kind, boss: true }); }
      break; // 本体で水は止まる
    }
    if (kind === 'water') {
      if (tl.fire) {
        if (tl.t === 'O') { g.events.push({ type: 'noeffect', x, y }); g.noOilHint = true; }
        else {
          tl.heat -= 0.34;
          if (tl.heat <= 0) { tl.fire = false; tl.heat = 1; tl.wet = 7; g.events.push({ type: 'out', x, y }); }
        }
      } else if (FLAM[tl.t] && !tl.burnt) tl.wet = Math.max(tl.wet, 6);
    } else if (tl.fire) {
      tl.fire = false; tl.heat = 1; tl.sand = true; g.events.push({ type: 'out', x, y });
    } else if (FLAM[tl.t] && !tl.burnt) tl.sand = true;
    g.events.push({ type: 'hit', x, y, ammo: kind });
  }
  g.events.push({ type: 'shot', x: p.x, y: p.y, dx: p.fx, dy: p.fy, len: Math.max(len, 1), ammo: kind });
}

function windMul(g, dx, dy) {
  if (!g.wind) return 1;
  const cos = (dx * g.wind[0] + dy * g.wind[1]) / Math.hypot(dx, dy);
  return cos > 0.5 ? 2.5 : cos < -0.5 ? 0.35 : 1;
}

function spreadFire(g, dt) {
  const fires = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g.tiles[y][x].fire) fires.push([x, y]);
  const next = [];
  for (const [x, y] of fires) {
    const src = g.tiles[y][x];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let w = 0;
      if (ax + ay === 1) w = 1; else if (ax === 1 && ay === 1) w = 0.5; else if (ax + ay === 2 && (ax === 0 || ay === 0)) w = 0.35;
      if (!w) continue;
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = g.tiles[ny][nx];
      if (!ignitable(n)) continue;
      const p = g.stage.rate * FLAM[n.t] * w * windMul(g, dx, dy) * (src.t === 'O' ? 1.3 : 1) * dt;
      if (g.rng() < p) next.push([nx, ny]);
    }
  }
  for (const [x, y] of next) if (ignitable(g.tiles[y][x])) ignite(g, x, y);
}

function burnDown(g, dt) {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const tl = g.tiles[y][x];
    if (tl.wet > 0) tl.wet -= dt;
    if (!tl.fire) continue;
    tl.burn += dt;
    if (tl.burn >= FUEL[tl.t]) {
      tl.fire = false; tl.burnt = true; tl.heat = 1;
      g.events.push({ type: 'burnt', x, y });
      if (tl.t === 'K') {
        g.burnt++;
        const r = residentAt(g, x, y);
        if (r && r.state === 'wait') { r.state = 'lost'; g.lost++; g.events.push({ type: 'lost', x, y }); }
      }
    }
  }
}

function updateResidents(g, dt) {
  const p = g.player;
  for (const r of g.residents) {
    if (r.state !== 'wait') continue;
    const house = g.tiles[r.y][r.x];
    if (house.fire) {
      r.hp -= dt / 9;
      r.prog = 0;
      if (r.hp <= 0) { r.state = 'lost'; g.lost++; g.events.push({ type: 'lost', x: r.x, y: r.y }); }
    } else if (Math.abs(p.x - r.x) + Math.abs(p.y - r.y) === 1) {
      r.prog += dt;
      if (r.prog >= 0.6) { r.state = 'saved'; g.saved++; g.events.push({ type: 'rescue', x: r.x, y: r.y }); }
    } else r.prog = Math.max(0, r.prog - dt);
  }
}

// 「火」の本体：一定間隔で周りの町に火の粉をばらまく。弱るほど速い
function updateBoss(g, dt) {
  const b = g.boss;
  if (!b || b.hp <= 0) return;
  b.hitT = Math.max(0, b.hitT - dt);
  g.bossT -= dt;
  if (g.bossT > 0) return;
  g.bossT = g.stage.bossSpawn - (1 - b.hp / b.max) * 1.0;
  const cand = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (Math.hypot(x - b.x, y - b.y) <= 3.6 && ignitable(g.tiles[y][x]) && !(x === g.player.x && y === g.player.y)) cand.push([x, y]);
  }
  if (cand.length) {
    const [x, y] = cand[Math.floor(g.rng() * cand.length)];
    ignite(g, x, y);
    g.events.push({ type: 'spark', x: b.x, y: b.y, tx: x, ty: y });
  }
}

export function update(g, dt, inp) {
  if (g.state !== 'play') return;
  dt = Math.min(dt, 0.1);
  g.t += dt; g.timeLeft -= dt;
  const p = g.player;
  p.stepCd -= dt; p.shotCd -= dt;

  // 向きと移動
  if (inp.dx || inp.dy) {
    const dx = inp.dx, dy = inp.dy;
    p.fx = dx; p.fy = dy;
    // 放水ボタンを押している間は、動かずに向きだけ変える（ねらいをつける）
    if (!inp.fire && p.stepCd <= 0 && walkable(g, p.x + dx, p.y + dy)) { p.x += dx; p.y += dy; p.stepCd = STEP_CD; }
  }
  if (inp.fire && p.shotCd <= 0) shoot(g);

  // 補給：井戸（水）と砂山（砂）のとなり、池の上
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tl = tileAt(g, p.x + dx, p.y + dy);
    if (!tl) continue;
    if (tl.t === 'I') p.water = Math.min(WATER_MAX, p.water + 9 * dt);
    if (tl.t === 'W' && !dx && !dy) p.water = Math.min(WATER_MAX, p.water + 3 * dt);
    if (tl.t === 'D') p.sand = Math.min(SAND_MAX, p.sand + 4 * dt);
  }

  // 風向きの切り替え（配列のとき15秒ごと）
  if (Array.isArray(g.stage.wind)) {
    g.windT += dt;
    if (g.windT >= 15) { g.windT = 0; g.windIdx++; setWind(g); g.events.push({ type: 'wind' }); }
  }

  spreadFire(g, dt);
  burnDown(g, dt);
  updateResidents(g, dt);
  updateBoss(g, dt);

  // 勝ち負けの判定
  if (g.boss) {
    if (g.boss.hp <= 0) { // 雨が降って、火は全部消える
      g.rain = true;
      for (const tl of g.tiles.flat()) if (tl.fire) { tl.fire = false; tl.wet = 20; }
      for (const r of g.residents) if (r.state === 'wait') { r.state = 'saved'; g.saved++; }
      g.state = 'win';
      return;
    }
  } else if (!burning(g) && g.residents.every(r => r.state !== 'wait')) { g.state = 'win'; return; }
  if (loss(g) > g.stage.limit) { g.state = 'lose'; g.reason = '燃え尽きた建物が多すぎた…'; }
  else if (g.timeLeft <= 0) { g.state = 'lose'; g.reason = '時間切れ…'; }
}
