// ダンジョンの中身（DOM に触らない）。1 回の操作 act() が「出来事（イベント）の列」を返し、見せ方は main.js が担当する
import { SPECIALS } from '../status/stats.js';
import { mulberry32, hashSeed, randInt } from './rng.js';
import { generateFloor, FLOOR, WALL } from './dungeon.js';
import { HERO, FIRST_ALLY, BOSSES, LEGEND, MAX_FLOOR, strokesOf, pickEnemyChar, WILD_POOL } from './chars.js';

export const HAND_MAX = 5;      // 手持ちカードの上限
export const SPECIAL_CD = 4;    // 特技を使ってから、また使えるまでのターン数
const SIGHT = 7;                // 見える範囲
const PLAYER_K = 3.6;           // こちらの攻撃の基準（大きいほど痛い）
const ENEMY_K = 2.0;            // 敵の攻撃の基準
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- カードと敵 ----------
function makeCard(ctx, ch) {
  const n = strokesOf(ch);
  return { ch, char: ctx.charOf(ch), hp: n, maxHp: n, lv: 1, xp: 0, cd: 0, shell: 0, atkBonus: 0 };
}
export const cardAtk = c => c.char.stats.atk + c.atkBonus;
export const cardDef = c => c.char.stats.def * (c.shell > 0 ? 1.5 : 1);
export const cardSpd = c => c.char.stats.spd;
export const specialOf = c => SPECIALS[c.char.special];
export const specialReady = c => c.cd === 0;

// ---------- 開始 ----------
// opts: { seed, startFloor, god, cards（テスト用：最初から持っている字） }
export function createRun(ctx, opts = {}) {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const hand = [makeCard(ctx, HERO), makeCard(ctx, FIRST_ALLY)];
  for (const ch of Array.from(opts.cards || '')) {
    if (ctx.charOf(ch) && !hand.some(c => c.ch === ch) && hand.length < HAND_MAX) hand.push(makeCard(ctx, ch));
  }
  const run = {
    ctx, seed, rng: mulberry32(hashSeed(seed, 9999)), god: !!opts.god,
    floor: 0, turn: 0, kills: 0, hand, cur: hand[0], facing: [0, 1],
    fl: null, pending: null, over: false, won: false, found: [],   // found：この冒険で新しく仲間にした字
  };
  enterFloor(run, Math.max(1, Math.min(MAX_FLOOR, opts.startFloor || 1)));
  return run;
}

function enterFloor(run, n) {
  run.floor = n;
  const g = generateFloor(run.seed, n);
  const rng = mulberry32(hashSeed(run.seed, n, 77));
  const { W } = g;
  const isBoss = !!BOSSES[n];
  const fl = {
    ...g, px: g.start.x, py: g.start.y, boss: isBoss,
    seen: new Uint8Array(g.W * g.H), vis: new Uint8Array(g.W * g.H),
    enemies: [], items: [], exitOpen: !isBoss, exit: null, nextId: 1,
  };
  const exitRoom = g.rooms[g.exitRoom];
  // 出口：ボスの階はボスの部屋の隅、それ以外は部屋の中央
  fl.exit = isBoss ? { x: exitRoom.x + exitRoom.w - 1, y: exitRoom.y } : { x: exitRoom.cx, y: exitRoom.cy };
  if (n === MAX_FLOOR) fl.exit = null;   // 最深部に階段はない（台座があるだけ）

  const occupied = (x, y) => (fl.px === x && fl.py === y) || (fl.exit && fl.exit.x === x && fl.exit.y === y) ||
    fl.enemies.some(e => e.x === x && e.y === y) || fl.items.some(i => i.x === x && i.y === y);
  const spot = (room, minStart = 0) => {
    for (let t = 0; t < 60; t++) {
      const x = randInt(rng, room.x, room.x + room.w - 1), y = randInt(rng, room.y, room.y + room.h - 1);
      if (!occupied(x, y) && Math.abs(x - g.start.x) + Math.abs(y - g.start.y) >= minStart) return { x, y };
    }
    return null;
  };
  const roomsFar = g.rooms.filter((_, i) => i !== g.startRoom && !(isBoss && i === g.exitRoom));
  const mkEnemy = (ch, x, y, boss = false) => {
    const char = run.ctx.charOf(ch);
    const hp = strokesOf(ch);
    fl.enemies.push({ id: fl.nextId++, ch, char, x, y, hp, maxHp: hp, boss, awake: false, announced: false, energy: rng() * 0.5, cd: 2 });
  };

  if (isBoss) {
    fl.bossCh = run.ctx.bossOf ? run.ctx.bossOf(n) : BOSSES[n];
    mkEnemy(fl.bossCh, exitRoom.cx, exitRoom.cy + (exitRoom.h > 5 ? 1 : 0), true);
    for (let i = 0; i < 2; i++) {
      const s = spot(exitRoom, 0);
      if (s) mkEnemy(pickEnemyChar(rng, n - 2), s.x, s.y);
    }
  }
  const count = Math.min(12, 2 + Math.floor(n * 0.6) + randInt(rng, 0, 2));
  for (let i = 0; i < count; i++) {
    const s = spot(roomsFar[Math.floor(rng() * roomsFar.length)], 5);
    if (s) mkEnemy(pickEnemyChar(rng, n, run.ctx.pool || WILD_POOL), s.x, s.y);
  }
  const inks = 3 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < inks; i++) {
    const s = spot(g.rooms[Math.floor(rng() * g.rooms.length)], 2);
    if (s) fl.items.push({ type: 'ink', x: s.x, y: s.y });
  }
  if (n % 3 === 0 || n === 1) {
    const s = spot(g.rooms[Math.floor(rng() * g.rooms.length)], 2);
    if (s) fl.items.push({ type: 'brush', x: s.x, y: s.y });
  }
  run.fl = fl;
  updateFov(fl);
}

// ---------- 見える範囲 ----------
function lineClear(fl, x0, y0, x1, y1) {
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  let err = dx - dy;
  while (x !== x1 || y !== y1) {
    if ((x !== x0 || y !== y0) && fl.tiles[y * fl.W + x] === WALL) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}
export function updateFov(fl) {
  fl.vis.fill(0);
  for (let y = Math.max(0, fl.py - SIGHT); y <= Math.min(fl.H - 1, fl.py + SIGHT); y++) {
    for (let x = Math.max(0, fl.px - SIGHT); x <= Math.min(fl.W - 1, fl.px + SIGHT); x++) {
      if ((x - fl.px) ** 2 + (y - fl.py) ** 2 > SIGHT * SIGHT + 1) continue;
      if (lineClear(fl, fl.px, fl.py, x, y)) { fl.vis[y * fl.W + x] = 1; fl.seen[y * fl.W + x] = 1; }
    }
  }
}

export const isFloor = (fl, x, y) => x >= 0 && y >= 0 && x < fl.W && y < fl.H && fl.tiles[y * fl.W + x] === FLOOR;
export const enemyAt = (fl, x, y) => fl.enemies.find(e => e.hp > 0 && e.x === x && e.y === y);
const aliveEnemies = fl => fl.enemies.filter(e => e.hp > 0);

// ---------- ダメージ ----------
function calcDamage(run, A, D, power, { ignoreDef = false, critRate = 0.06, scale = 1, k = PLAYER_K } = {}) {
  const d = ignoreDef ? D * 0.2 : D;
  const crit = run.rng() < critRate;
  let v = A * power * k / (60 + d) * scale * (0.85 + run.rng() * 0.3);
  if (crit) v *= 1.5;
  return { dmg: Math.max(1, Math.round(v)), crit };
}
const enemyScale = e => (e.boss ? 1.25 : 1);   // ボスは攻撃が強い

// 敵に 1 回当てる。倒したら後始末まで行う
function strike(run, e, ev, power, opts = {}) {
  const c = run.cur;
  const dodge = Math.min(0.2, e.char.stats.spd / 500);
  if (!opts.noDodge && run.rng() < dodge) {
    ev.push({ type: 'dodge', side: 'e', id: e.id, x: e.x, y: e.y, text: `「${e.ch}」は ひらりと かわした` });
    return 0;
  }
  const { dmg, crit } = calcDamage(run, cardAtk(c), e.char.stats.def, power, opts);
  const real = Math.min(dmg, e.hp);
  e.hp -= real;
  ev.push({ type: 'hit', side: 'e', id: e.id, x: e.x, y: e.y, dmg: real, crit, text: `「${c.ch}」→「${e.ch}」 ${real}画${crit ? '（会心！）' : ''}` });
  if (e.hp <= 0) killEnemy(run, e, ev);
  return real;
}

function killEnemy(run, e, ev) {
  run.kills++;
  ev.push({ type: 'kill', id: e.id, x: e.x, y: e.y, ch: e.ch, text: `「${e.ch}」を たおした！` });
  gainXp(run, e, ev);
  const fl = run.fl;
  // カードを落とす（ボスは必ず）。すでに持っている字なら落とさない
  const owned = run.hand.some(c => c.ch === e.ch) || fl.items.some(i => i.type === 'card' && i.ch === e.ch);
  if (!owned && (e.boss || run.rng() < 0.3)) fl.items.push({ type: 'card', ch: e.ch, x: e.x, y: e.y });
  else if (e.boss) fl.items.push({ type: 'ink', x: e.x, y: e.y });
  if (e.boss) {
    ev.push({ type: 'bossDown', floor: run.floor });
    if (run.floor === MAX_FLOOR) {
      fl.items.push({ type: 'altar', ch: LEGEND, x: fl.rooms[fl.exitRoom].x + fl.rooms[fl.exitRoom].w - 1, y: fl.rooms[fl.exitRoom].y });
    } else {
      fl.exitOpen = true;
      ev.push({ type: 'text', text: '出口の封印が とけた！' });
    }
  }
}

function gainXp(run, e, ev) {
  const c = run.cur;
  c.xp += Math.max(1, strokesOf(e.ch));
  while (c.xp >= 3 + c.lv * 2) {
    c.xp -= 3 + c.lv * 2;
    c.lv++;
    const up = Math.max(1, Math.round(strokesOf(c.ch) * 0.06));
    c.maxHp += up; c.hp = Math.min(c.maxHp, c.hp + up); c.atkBonus += 2;
    ev.push({ type: 'levelup', ch: c.ch, text: `「${c.ch}」は Lv${c.lv} に！ 画が ${up} ふえた` });
  }
}

// 手持ちの字がダメージを受ける
function hurtPlayer(run, e, ev, power = 1) {
  const c = run.cur;
  const dodge = Math.min(0.4, cardSpd(c) / 250);
  if (run.rng() < dodge) {
    ev.push({ type: 'dodge', side: 'p', x: run.fl.px, y: run.fl.py, text: `「${c.ch}」は ひらりと かわした！` });
    return;
  }
  const scale = enemyScale(e) * (0.35 + 0.07 * run.floor);   // 浅い階の敵は弱く、深いほど強く
  const { dmg, crit } = calcDamage(run, e.char.stats.atk, cardDef(c), power, { scale, k: ENEMY_K });
  const real = run.god ? 0 : Math.min(dmg, c.hp);
  c.hp -= real;
  ev.push({ type: 'hit', side: 'p', id: 'p', x: run.fl.px, y: run.fl.py, dmg: real, crit, text: `「${e.ch}」→「${c.ch}」 ${real}画${crit ? '（会心！）' : ''}` });
  if (c.hp <= 0) fallCard(run, ev);
}

function fallCard(run, ev) {
  const c = run.cur;
  run.hand = run.hand.filter(x => x !== c);
  ev.push({ type: 'fall', ch: c.ch, text: `「${c.ch}」は くずれおちた…` });
  if (!run.hand.length) { run.over = true; ev.push({ type: 'lose' }); return; }
  // 一番元気な字が次に出る
  run.cur = run.hand.slice().sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp)[0];
  ev.push({ type: 'text', text: `「${run.cur.ch}」が 前に出た！` });
  run.fell = true;
}

// ---------- 敵のターン ----------
function pathDist(fl, sx, sy, limit) {
  const dist = new Int16Array(fl.W * fl.H).fill(-1);
  const q = [sy * fl.W + sx];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (dist[c] >= limit) continue;
    const x = c % fl.W, y = (c / fl.W) | 0;
    for (const [dx, dy] of DIRS) {
      const n = (y + dy) * fl.W + x + dx;
      if (isFloor(fl, x + dx, y + dy) && dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
    }
  }
  return dist;
}

function enemiesAct(run, ev) {
  const fl = run.fl;
  const dist = pathDist(fl, fl.px, fl.py, 20);
  for (const e of aliveEnemies(fl)) {
    const d = dist[e.y * fl.W + e.x];
    if (!e.awake && d >= 0 && d <= (e.boss ? 9 : 7)) {
      e.awake = true;
      if (e.boss && !e.announced) { e.announced = true; ev.push({ type: 'bossSight', floor: run.floor }); }
    }
    if (!e.awake) continue;
    e.energy += 0.4 + e.char.stats.spd / 100 * 0.7;
    while (e.energy >= 1 && !run.over && !run.fell && e.hp > 0) {
      e.energy -= 1;
      const m = Math.abs(e.x - fl.px) + Math.abs(e.y - fl.py);
      if (m === 1) hurtPlayer(run, e, ev);
      else {
        // 近づく：プレイヤーまでの道のりが短くなる、空いているマスへ
        let best = null, bd = dist[e.y * fl.W + e.x];
        for (const [dx, dy] of DIRS) {
          const nx = e.x + dx, ny = e.y + dy;
          if (!isFloor(fl, nx, ny) || (nx === fl.px && ny === fl.py) || enemyAt(fl, nx, ny)) continue;
          const nd = dist[ny * fl.W + nx];
          if (nd >= 0 && nd < bd) { bd = nd; best = [nx, ny]; }
        }
        if (best) [e.x, e.y] = best;
      }
    }
  }
  run.fell = false;
}

// ---------- プレイヤーの操作 ----------
const nearestEnemy = (fl, range) => aliveEnemies(fl)
  .map(e => ({ e, d: Math.abs(e.x - fl.px) + Math.abs(e.y - fl.py) }))
  .filter(o => o.d <= range).sort((a, b) => a.d - b.d)[0]?.e;

function useSpecial(run, ev) {
  const c = run.cur, fl = run.fl, sp = specialOf(c);
  if (!specialReady(c)) { ev.push({ type: 'text', text: `とくぎは あと ${c.cd} ターンで 使える` }); return false; }
  const A = 1 + c.char.stats.sp / 100;   // とくしゅ の値が大きいほど技が強い
  const adj = aliveEnemies(fl).filter(e => Math.max(Math.abs(e.x - fl.px), Math.abs(e.y - fl.py)) <= 1);
  let target = nearestEnemy(fl, 2);
  if (sp.kind === 'pierce') {
    // 向いている方向に 3 マスまで届く
    for (let i = 1; i <= 3; i++) {
      const e = enemyAt(fl, fl.px + run.facing[0] * i, fl.py + run.facing[1] * i);
      if (e) { target = e; break; }
    }
  }
  if (sp.kind !== 'heal' && !(sp.kind === 'all' ? adj.length : target)) {
    ev.push({ type: 'text', text: '届く敵が いない' });
    return false;
  }
  c.cd = SPECIAL_CD + 1;   // 次のターン開始で 1 減るので +1
  ev.push({ type: 'special', ch: c.ch, text: `「${c.ch}」の ${sp.name}！` });
  switch (sp.kind) {
    case 'all': for (const e of adj) strike(run, e, ev, sp.power * A, { noDodge: true }); break;
    case 'pierce': strike(run, target, ev, sp.power * A, { ignoreDef: true, noDodge: true }); break;
    case 'multi': {
      const n = Math.min(4, Math.max(2, c.char.shape.parts));
      for (let i = 0; i < n && target.hp > 0; i++) strike(run, target, ev, sp.power * A, { noDodge: true });
      break;
    }
    case 'drain': {
      const got = strike(run, target, ev, sp.power * A * (1 + 0.1 * c.char.shape.holes), { noDodge: true });
      healCard(run, c, Math.max(1, Math.round(got * 0.5)), ev);
      break;
    }
    case 'heal': {
      healCard(run, c, Math.max(1, Math.round(c.maxHp * (sp.power + c.char.stats.sp / 400))), ev);
      c.shell = 4;
      ev.push({ type: 'text', text: 'ぼうぎょが あがった！' });
      break;
    }
    case 'crit': strike(run, target, ev, sp.power * A, { critRate: 0.5, noDodge: true }); break;
  }
  return true;
}

function healCard(run, c, amount, ev) {
  const real = Math.min(amount, c.maxHp - c.hp);
  if (real <= 0) return;
  c.hp += real;
  ev.push({ type: 'heal', amount: real, x: run.fl.px, y: run.fl.py, text: `「${c.ch}」の画が ${real} もどった` });
}

// 歩いた先にあるもの（アイテム・出口）
function stepOn(run, ev) {
  const fl = run.fl, c = run.cur;
  const idx = fl.items.findIndex(i => i.x === fl.px && i.y === fl.py);
  if (idx >= 0) {
    const it = fl.items[idx];
    if (it.type === 'ink') {
      fl.items.splice(idx, 1);
      healCard(run, c, Math.max(2, Math.ceil(c.maxHp * 0.5)), ev);
      ev.push({ type: 'pickup', item: 'ink', text: '墨つぼを ひろった' });
    } else if (it.type === 'brush') {
      fl.items.splice(idx, 1);
      c.maxHp++; c.hp++;
      ev.push({ type: 'pickup', item: 'brush', text: `筆を ひろった！ 「${c.ch}」の画が 1 ふえた` });
    } else if (it.type === 'card') {
      const dup = run.hand.find(h => h.ch === it.ch);
      if (dup) {
        fl.items.splice(idx, 1);
        healCard(run, dup, 2, ev);
        ev.push({ type: 'text', text: `「${it.ch}」はもう 持っている` });
      } else if (run.hand.length < HAND_MAX) {
        fl.items.splice(idx, 1);
        addCard(run, it.ch, ev);
      } else {
        run.pending = { type: 'handFull', item: it };
        ev.push({ type: 'handFull', ch: it.ch, text: `「${it.ch}」を ひろったが 手持ちがいっぱい` });
      }
    } else if (it.type === 'altar') {
      fl.items.splice(idx, 1);
      run.won = true; run.over = true;
      ev.push({ type: 'legend', text: '伝説の1文字「言」を 手に入れた！' });
    }
  }
  if (fl.exit && fl.px === fl.exit.x && fl.py === fl.exit.y) {
    if (fl.exitOpen) return descend(run, ev);
    ev.push({ type: 'text', text: '出口は封印されている。ぬしを たおせ！' });
  }
  return false;
}

function addCard(run, ch, ev) {
  run.hand.push(makeCard(run.ctx, ch));
  if (!run.found.includes(ch)) run.found.push(ch);
  ev.push({ type: 'pickup', item: 'card', ch, text: `「${ch}」が なかまに くわわった！` });
}

// 手持ちがいっぱいのとき：discard のカードを捨てて拾う（null なら拾わない）
export function resolveHandFull(run, discard) {
  const ev = [], p = run.pending;
  run.pending = null;
  if (!p || !discard) return ev;
  const fl = run.fl;
  run.hand = run.hand.filter(c => c !== discard);
  fl.items = fl.items.filter(i => i !== p.item);
  addCard(run, p.item.ch, ev);
  if (run.cur === discard) run.cur = run.hand[run.hand.length - 1];
  return ev;
}

function descend(run, ev) {
  for (const c of run.hand) healCard(run, c, Math.ceil(c.maxHp * 0.25), []);
  enterFloor(run, run.floor + 1);
  ev.push({ type: 'floor', floor: run.floor, boss: !!BOSSES[run.floor], text: `地下 ${run.floor} 階` });
  return true;
}

// 1 回の操作。a: { type:'move', dx, dy } | { type:'wait' } | { type:'special' } | { type:'swap', card }
// 戻り値はイベントの列。ターンを使わない操作（壁に向かう等）は空の列
export function act(run, a) {
  const ev = [];
  if (run.over || run.pending) return ev;
  const fl = run.fl;
  let used = false;
  if (a.type === 'move') {
    run.facing = [a.dx, a.dy];
    const nx = fl.px + a.dx, ny = fl.py + a.dy;
    const e = enemyAt(fl, nx, ny);
    if (e) { strike(run, e, ev, 1); used = true; }
    else if (isFloor(fl, nx, ny)) {
      fl.px = nx; fl.py = ny; used = true;
      if (stepOn(run, ev)) { updateFov(fl); return ev; }   // 階段を下りた：敵は動かない
    }
  } else if (a.type === 'wait') {
    used = true;
    const e = nearestEnemy(fl, 1);
    if (e) strike(run, e, ev, 1);   // となりに敵がいれば自動で攻撃
  } else if (a.type === 'special') {
    used = useSpecial(run, ev);
  } else if (a.type === 'swap') {
    if (a.card !== run.cur && run.hand.includes(a.card)) {
      run.cur = a.card; used = true;
      ev.push({ type: 'swap', ch: a.card.ch, text: `「${a.card.ch}」に 入れ替えた` });
    }
  }
  if (!used) return ev;
  run.turn++;
  if (!run.over) enemiesAct(run, ev);
  for (const c of run.hand) { if (c.cd > 0) c.cd--; if (c.shell > 0) c.shell--; }
  updateFov(fl);
  return ev;
}
