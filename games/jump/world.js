// 文字ジャンプ：物理・足場の生成・自動操縦（DOM に触れないので Node でもテストできる）
// 単位は m。y は上向き。画面は幅 WORLD_W × 高さ VIEW_H。

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const WORLD_W = 9;            // 画面の幅（m）。左右の端はつながっている
export const VIEW_H = 16;            // 画面に映る高さ（m）
export const GRAVITY = 24;
export const DT = 1 / 120;           // 固定の時間刻み
export const EM = 2.6;               // 足場の字の大きさ（1em = 2.6m）
export const HERO_EM = 1.3;          // 主人公の字の大きさ
export const JUMP_MIN = 4.0;         // どの字でも最低これだけは跳べる（m）
export const JUMP_MAX = 5.2;         // いちばん軽い字の跳躍高
export const GAP_MAX = JUMP_MIN * 0.68;   // 足場の間隔の上限（余裕をもって跳躍高より低い）
export const SPRING_MUL = 1.8;       // バネ字の初速倍率
export const ROCKET_V = 17, ROCKET_T = 2.2;
export const BALLOON_V = 5.5, BALLOON_T = 5;
export const CHAIN_DX = 2.9;         // 本線の足場どうしの横のずれの上限（m）

// 足場に使う字（形がそのまま性格になる）
export const POOLS = {
  normal: [['一', 1.2], ['口', 1.2], ['日', 1.2], ['〇', 1], ['山', 1], ['十', 0.9], ['ハ', 0.9], ['田', 0.7], ['凹', 0.8], ['工', 0.8], ['王', 0.5]],
  fade: [['消', 1], ['崩', 1], ['壊', 1]],
  spring: [['弾', 1], ['跳', 1]],
  spike: [['棘', 1], ['刺', 1], ['針', 1]],
};
export const ITEM_CHARS = { rocket: '飛', balloon: '風', spring: '跳' };
export const ENEMY_CHARS = { bird: '鳥', cloud: '雲', thunder: '雷' };
export const NARROW = { '一': 0.55 };               // 一は踏める幅が狭い細い橋
export const SLIPPERY = { '〇': 1.9, 'ハ': 1.5 };   // 滑りやすい字
export const KIND_NAMES = { normal: 'ふつう', move: '動く', fade: '消える', spring: 'バネ', spike: 'トゲ' };

export const platformChars = () => [...new Set(Object.values(POOLS).flat().map(([c]) => c))];
export const allGameChars = () => [...new Set([...platformChars(), ...Object.values(ITEM_CHARS), ...Object.values(ENEMY_CHARS)])];

// ---------- 乱数 ----------
export function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashSeed(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- 主人公の性格（形の指標から決定的に決める） ----------
// metrics は shapeMetrics(glyphPolygons(font, ch, 1)) の結果（面積は em² 単位）
export function heroTraits(metrics) {
  const t = clamp((metrics.area - 0.06) / 0.32, 0, 1);       // 0=軽い … 1=重い
  const round = clamp(metrics.roundness, 0, 1);
  return {
    weight: t,
    jumpH: lerp(JUMP_MAX, JUMP_MIN, t),                      // 軽いほど高く跳ぶ
    vmax: lerp(7.6, 6.2, t),                                 // 軽いほど横に速いが
    accel: lerp(64, 38, t),                                  // 敏感
    slip: lerp(1.45, 0.5, t) * (0.85 + 0.3 * round),         // 重いほど滑りにくく安定
    foot: lerp(0.28, 0.4, t),                                // 重い字は足場の判定が広い
    roundness: round,
  };
}

// ---------- 足場の表面（字の輪郭から、横位置ごとの「立てる高さ」を求める） ----------
function intervalsAt(polys, x) {
  const ys = [];
  for (const { outer, holes } of polys) {
    for (const ring of [outer, ...holes]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a.x <= x) !== (b.x <= x)) ys.push(a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x));
      }
    }
  }
  ys.sort((p, q) => p - q);
  const out = [];
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]]);
  return out;
}

const COLS = 48;
export function makeSurface(polys, ch) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const { outer } of polys) for (const p of outer) {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }
  const cols = [], tops = [];
  for (let k = 0; k < COLS; k++) {
    const iv = intervalsAt(polys, minx + (k + 0.5) / COLS * (maxx - minx));
    cols.push(iv);
    tops.push(iv.length ? iv[iv.length - 1][1] : -Infinity);
  }
  // 基準線 coreY：中央の半分の幅で、立てる高さのいちばん低いところ（これより高い出っ張りは「おまけ」）
  const cx0 = (minx + maxx) / 2, half = (maxx - minx) * 0.25;
  let coreY = Infinity;
  for (let k = 0; k < COLS; k++) {
    const xc = minx + (k + 0.5) / COLS * (maxx - minx);
    if (Math.abs(xc - cx0) <= half && isFinite(tops[k])) coreY = Math.min(coreY, tops[k]);
  }
  if (!isFinite(coreY)) coreY = Math.max(...tops.filter(isFinite));
  // 狙い目 aimEm：基準線以上にある最も広い連なりの中心
  let bestRun = [0, -1], run = null;
  for (let k = 0; k <= COLS; k++) {
    const ok = k < COLS && tops[k] >= coreY - 0.02;
    if (ok && !run) run = [k, k];
    else if (ok) run[1] = k;
    else if (run) { if (run[1] - run[0] > bestRun[1] - bestRun[0]) bestRun = run; run = null; }
  }
  const aimEm = minx + ((bestRun[0] + bestRun[1] + 1) / 2) / COLS * (maxx - minx);
  const rawTop = Math.max(...tops.filter(isFinite));
  return { ch, minx, maxx, miny, maxy, cx0, cols, tops, coreY, aimEm, rawTop, peak: rawTop - coreY, widthEm: maxx - minx };
}

const sxsOf = ch => NARROW[ch] ?? 1;

// 足場 P の上で、足（x 座標のリスト）が yPrev→yNew に落ちる間に踏める最も高い面の高さ。無ければ null
function landTop(P, hx, fw, yPrev, yNew) {
  const S = P.surf;
  let best = null;
  for (const sx of [hx - fw, hx, hx + fw]) {
    const xe = S.cx0 + (sx - P.x) / (EM * P.sxs);
    const k = Math.floor((xe - S.minx) / (S.maxx - S.minx) * COLS);
    if (k < 0 || k >= COLS) continue;
    for (const iv of S.cols[k]) {
      const top = P.y + (iv[1] - S.coreY) * EM;
      if (top <= yPrev + 0.05 && top >= yNew - 1e-6 && (best === null || top > best)) best = top;
    }
  }
  return best;
}

// 着地点の斜面の傾き（dy/dx、右上がりが正）
function slopeAt(P, hx) {
  const S = P.surf;
  const xe = S.cx0 + (hx - P.x) / (EM * P.sxs);
  const k = Math.floor((xe - S.minx) / (S.maxx - S.minx) * COLS);
  const a = Math.max(0, k - 2), b = Math.min(COLS - 1, k + 2);
  if (!isFinite(S.tops[a]) || !isFinite(S.tops[b]) || a === b) return 0;
  return clamp((S.tops[b] - S.tops[a]) / ((b - a) / COLS * (S.maxx - S.minx)) / P.sxs, -1.6, 1.6);
}

// ---------- ゲーム状態 ----------
function pick(rnd, list, available) {
  const items = list.filter(([c]) => !available || available.has(c));
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [c, w] of items) { if ((r -= w) <= 0) return c; }
  return items[items.length - 1][0];
}

// env: { ch, traits, surfaces: {字: makeSurface の結果}, god?, noEnemy? }
export function createGame(env) {
  const traits = env.traits;
  const g = {
    env, traits, v0: Math.sqrt(2 * GRAVITY * traits.jumpH),
    t: 0, status: 'play', events: [], score: 0, maxY: 0,
    hero: { x: WORLD_W / 2, y: 0, vx: 0, vy: 0, ghost: 0, stun: 0, invuln: 0, rocket: 0, balloon: 0, squash: 0 },
    camY: -VIEW_H * 0.25,
    plats: [], items: [], enemies: [], nextId: 1,
    kinds: {}, chars: {}, cloudCd: 0, stomps: 0,
    avail: new Set(Object.keys(env.surfaces)),
    layout: { y: 0, x: WORLD_W / 2, index: 0, rnd: mulberry32(hashSeed('moji-jump-v1:' + env.ch)) },
  };
  g.hero.vy = g.v0;
  addPlatform(g, '日', 'normal', WORLD_W / 2, 0);
  genRows(g, VIEW_H * 1.6);
  return g;
}

function addPlatform(g, ch, kind, x, y, extra = {}) {
  const surf = g.env.surfaces[ch];
  const P = { id: g.nextId++, ch, kind, surf, sxs: sxsOf(ch), baseX: x, x, y, amp: 0, omega: 0, phase: 0, broken: false, crumble: -1, fallY: 0, fallV: 0, peak: surf.peak, ...extra };
  g.plats.push(P);
  return P;
}

export function genRows(g, upTo) {
  while (g.layout.y < upTo) genRow(g);
}

function genRow(g) {
  const L = g.layout, r = L.rnd, h = L.y;
  const diff = clamp(h / 700, 0, 1);                       // 高さが上がるほど 1 に近づく
  const gap = Math.min(GAP_MAX, lerp(1.55, 2.7, diff) * (0.82 + 0.18 * r()));
  const y = h + gap;

  // 本線の足場（これだけで必ず登れる。踏めば1回は跳べるので、消える字・動く字も本線に入れてよい）
  let kind = 'normal';
  const k = r();
  if (L.index > 2) {
    const pSpring = 0.05, pFade = 0.04 + 0.3 * diff, pMove = 0.06 + 0.3 * diff;
    if (k < pSpring) kind = 'spring';
    else if (k < pSpring + pFade) kind = 'fade';
    else if (k < pSpring + pFade + pMove) kind = 'move';
  }
  const ch = pick(r, kind === 'fade' ? POOLS.fade : kind === 'spring' ? POOLS.spring : POOLS.normal, g.avail);
  const mv = kind === 'move';
  const dx = (r() * 2 - 1) * CHAIN_DX * (mv ? 0.9 : 1);
  const x = clamp(L.x + dx, mv ? 2.4 : 1.4, mv ? 6.6 : 7.6);
  const extra = mv ? { amp: 1 + 0.5 * r(), omega: 1.2 + 1.2 * r(), phase: r() * Math.PI * 2 } : (r(), r(), r(), {});
  const P = addPlatform(g, ch, kind, x, y, extra);
  let chainX = x;
  if (kind === 'fade') {
    // 消える字は踏んだら無くなるので、外したときに詰まないよう、同じ高さに壊れない双子の足場を添える（こちらが本線）
    const side = r() < 0.5 ? -1 : 1;
    let tx = null;
    for (const sd of [side, -side]) {
      const c = x + sd * (2.5 + r() * 0.6);
      if (c >= 1.4 && c <= 7.6 && Math.abs(c - L.x) <= CHAIN_DX) { tx = c; break; }
    }
    if (tx === null) { P.kind = 'normal'; P.ch = pick(r, POOLS.normal, g.avail); P.surf = g.env.surfaces[P.ch]; P.sxs = sxsOf(P.ch); P.peak = P.surf.peak; }
    else { addPlatform(g, pick(r, POOLS.normal, g.avail), 'normal', tx, y); chainX = tx; }
  }

  // おまけの足場（踏み外したときの受け皿にも、罠にもなる）
  const re = r(), ex = 1.3 + r() * 6.4, ey = h + gap * (0.25 + 0.5 * r()), rk = r();
  if (L.index > 1 && re < 0.35 + 0.15 * diff && Math.abs(ex - L.x) > 2.6 && Math.abs(ex - x) > 2.6) {
    let ek = 'normal';
    const pSpike = h < 60 ? 0 : 0.08 + 0.3 * diff;
    if (rk < 0.14) ek = 'spring';
    else if (rk < 0.14 + pSpike) ek = 'spike';
    else if (rk < 0.14 + pSpike + 0.15 + 0.2 * diff) ek = 'fade';
    const eCh = pick(r, ek === 'fade' ? POOLS.fade : ek === 'spring' ? POOLS.spring : ek === 'spike' ? POOLS.spike : POOLS.normal, g.avail);
    addPlatform(g, eCh, ek, ex, ey);
  } else { r(); }

  // アイテム（本線の足場の上）
  const ri = r();
  if (L.index > 3 && kind !== 'spike') {
    const it = ri < 0.014 ? 'rocket' : ri < 0.04 ? 'balloon' : ri < 0.075 ? 'spring' : null;
    if (it) g.items.push({ id: g.nextId++, type: it, plat: P, ox: 0, x: P.x, y: y + P.peak * EM + 1.0, got: false });
  }

  // 敵（足場と足場のあいだ）
  const re2 = r(), ey2 = h + gap * 0.5, ex2 = 0.8 + r() * (WORLD_W - 1.6), rd = r(), rs = r();
  if (!g.env.noEnemy) {
    if (h > 50 && re2 < 0.05 + 0.2 * diff) {
      g.enemies.push({ id: g.nextId++, type: 'bird', x0: ex2, y0: ey2, dir: rd < 0.5 ? -1 : 1, speed: 2 + 2.5 * rs, phase: rs * 6, x: ex2, y: ey2, dead: false, fall: 0 });
    } else if (h > 110 && re2 < 0.05 + 0.2 * diff + 0.04 + 0.1 * diff) {
      g.enemies.push({ id: g.nextId++, type: 'cloud', x0: ex2, y0: ey2 + 0.6, speed: 0.5 + rs * 0.6, phase: rs * 6, x: ex2, y: ey2 + 0.6 });
    } else if (h > 220 && re2 < 0.05 + 0.2 * diff + 0.04 + 0.1 * diff + 0.03 + 0.07 * diff) {
      g.enemies.push({ id: g.nextId++, type: 'thunder', x: ex2, y: ey2 + 2.8, state: 'idle', timer: 0 });
    }
  }

  L.y = y; L.x = chainX; L.index++;
}

function hurt(g, dirx) {
  const h = g.hero;
  h.vy = -6; h.ghost = 0.35; h.stun = 0.6; h.invuln = 1.4;
  h.vx = dirx * 3;
  g.events.push({ type: 'hurt', x: h.x, y: h.y + 0.5 });
}

function wrapDiff(a, b) {    // a - b を -W/2〜W/2 に
  let d = (a - b) % WORLD_W;
  if (d > WORLD_W / 2) d -= WORLD_W; else if (d < -WORLD_W / 2) d += WORLD_W;
  return d;
}

function enemyPos(e, t) {
  if (e.type === 'bird') {
    const span = WORLD_W + 4;
    e.x = ((((e.x0 + e.dir * e.speed * t) % span) + span) % span) - 2;
    e.y = e.y0 + 0.4 * Math.sin(2 * t + e.phase);
  } else if (e.type === 'cloud') {
    e.x = e.x0 + 2 * Math.sin(0.45 * e.speed * t + e.phase);
    e.y = e.y0 + 0.3 * Math.sin(0.7 * t + e.phase);
  }
}

export function step(g, axis, dt = DT) {
  const h = g.hero, tr = g.traits;
  g.t += dt;
  if (g.status !== 'play') {                     // ゲームオーバー後は落ちていくだけ
    h.vy -= GRAVITY * dt; h.y += h.vy * dt;
    return;
  }

  // 動く足場・崩れる足場
  for (const P of g.plats) {
    if (P.kind === 'move' && !P.broken) P.x = P.baseX + P.amp * Math.sin(P.omega * g.t + P.phase);
    if (P.broken) { P.crumble += dt; if (P.crumble > 0.25) { P.fallV += 30 * dt; P.fallY -= P.fallV * dt; } }
  }
  for (const e of g.enemies) {
    if (e.type === 'bird') { if (e.dead) { e.fall += dt; } else enemyPos(e, g.t); }
    else if (e.type === 'cloud') enemyPos(e, g.t);
  }

  // 主人公の横の動き
  h.stun = Math.max(0, h.stun - dt); h.ghost = Math.max(0, h.ghost - dt); h.invuln = Math.max(0, h.invuln - dt);
  h.squash = Math.max(0, h.squash - dt * 5); g.cloudCd = Math.max(0, g.cloudCd - dt);
  const target = axis * tr.vmax * (h.stun > 0 ? 0.3 : 1);
  const a = tr.accel * dt;
  h.vx += clamp(target - h.vx, -a, a);

  // 縦の動き
  if (h.rocket > 0) { h.rocket -= dt; h.vy = ROCKET_V; h.invuln = Math.max(h.invuln, 0.2); }
  else if (h.balloon > 0) { h.balloon -= dt; h.vy += clamp(BALLOON_V - h.vy, -30 * dt, 30 * dt); }
  else h.vy -= GRAVITY * dt;

  const yPrev = h.y;
  h.y += h.vy * dt;
  h.x += h.vx * dt;
  h.x = ((h.x % WORLD_W) + WORLD_W) % WORLD_W;

  // 着地（落ちているときだけ。下から上へは通り抜ける）
  if (h.vy < 0 && h.ghost <= 0 && h.rocket <= 0 && h.balloon <= 0) {
    let best = null, bestTop = -Infinity;
    for (const P of g.plats) {
      if (P.broken || P.y - 3.2 > yPrev || P.y + 3.2 < h.y) continue;
      const top = landTop(P, h.x, tr.foot, yPrev, h.y);
      if (top !== null && top > bestTop) { best = P; bestTop = top; }
    }
    if (best) land(g, best, bestTop);
  }

  // アイテム
  const cy = h.y + 0.55;
  for (const it of g.items) {
    if (it.got) continue;
    it.x = it.plat.x + it.ox;
    if (Math.abs(wrapDiff(it.x, h.x)) < 0.9 && Math.abs(it.y + it.plat.fallY - cy) < 0.9 && !it.plat.broken) {
      it.got = true;
      if (it.type === 'rocket') h.rocket = ROCKET_T;
      else if (it.type === 'balloon') h.balloon = BALLOON_T;
      else h.vy = g.v0 * 2;
      g.events.push({ type: 'item', item: it.type, x: it.x, y: it.y });
    }
  }

  // 敵
  for (const e of g.enemies) {
    if (e.type === 'bird' && !e.dead) {
      const dx = wrapDiff(e.x, h.x), dy = e.y - cy;
      if (dx * dx + dy * dy < 0.8 * 0.8) {
        if (h.vy < -1 && h.y > e.y - 0.15) { e.dead = true; h.vy = g.v0 * 0.95; g.stomps++; g.events.push({ type: 'stomp', x: e.x, y: e.y }); }
        else if (h.invuln <= 0) hurt(g, dx > 0 ? -1 : 1);
      }
    } else if (e.type === 'cloud') {
      const dx = wrapDiff(e.x, h.x), dy = e.y - cy;
      if (dx * dx + dy * dy < 1.15 * 1.15 && g.cloudCd <= 0 && h.rocket <= 0) {
        g.cloudCd = 0.7;
        if (h.vy > 0) h.vy *= 0.55;
        g.events.push({ type: 'cloud', x: e.x, y: e.y });
      }
    } else if (e.type === 'thunder') {
      if (e.state === 'idle' && e.y - h.y < 7 && e.y - h.y > -2) { e.state = 'warn'; e.timer = 0; }
      else if (e.state === 'warn') { e.timer += dt; if (e.timer > 1.1) { e.state = 'strike'; e.timer = 0; g.events.push({ type: 'thunder', x: e.x, y: e.y }); } }
      else if (e.state === 'strike') {
        e.timer += dt;
        if (Math.abs(wrapDiff(e.x, h.x)) < 0.6 && cy < e.y && cy > e.y - 11 && h.invuln <= 0 && h.rocket <= 0) hurt(g, 0);
        if (e.timer > 0.28) { e.state = 'done'; e.timer = 0; }
      } else if (e.state === 'done') e.timer += dt;
    }
  }

  // カメラは上にしか動かない
  g.camY = Math.max(g.camY, h.y - VIEW_H * 0.5);
  genRows(g, g.camY + VIEW_H * 1.6);
  const cut = g.camY - 6;
  if (g.plats.length > 40) {
    g.plats = g.plats.filter(P => P.y + P.fallY > cut);
    g.items = g.items.filter(i => i.y > cut);
    g.enemies = g.enemies.filter(e => (e.type === 'cloud' || e.type === 'bird' ? e.y : e.y - 11) > cut);
  }

  g.maxY = Math.max(g.maxY, h.y);
  g.score = Math.floor(g.maxY);
  if (h.y < g.camY - 0.8) { g.status = 'over'; g.events.push({ type: 'over' }); }
}

function land(g, P, top) {
  const h = g.hero;
  h.y = top;
  g.kinds[P.kind] = 1; g.chars[P.ch] = 1;
  if (P.kind === 'spike') {
    P.hit = true;
    if (h.invuln <= 0) hurt(g, 0); else h.vy = g.v0;
    return;
  }
  h.vy = g.v0 * (P.kind === 'spring' ? SPRING_MUL : 1);
  h.squash = 1;
  h.vx += -slopeAt(P, h.x) * 5.5 * g.traits.slip * (SLIPPERY[P.ch] ?? 1);   // 斜面は滑り落ちる
  if (P.kind === 'fade') { P.broken = true; P.crumble = 0; }
  g.events.push({ type: 'land', x: h.x, y: top, kind: P.kind, ch: P.ch });
}

// ---------- 自動操縦（テスト用。?auto で遊べる） ----------
export function botAxis(g) {
  const h = g.hero, tr = g.traits;
  let best = null, bestScore = -Infinity;
  for (const P of g.plats) {
    if (P.broken || P.kind === 'spike') continue;
    const dy = P.y - h.y;
    const disc = h.vy * h.vy - 2 * GRAVITY * dy;
    if (disc < 0) continue;                                  // 頂点でも届かない
    const T = (h.vy + Math.sqrt(disc)) / GRAVITY;           // 落ちながらその高さを通る時刻
    if (T < 0.03) continue;
    const px = (P.kind === 'move' ? P.baseX + P.amp * Math.sin(P.omega * (g.t + T) + P.phase) : P.baseX)
      + (P.surf.aimEm - P.surf.cx0) * EM * P.sxs;
    const dx = wrapDiff(px, h.x);
    if (Math.abs(dx) > tr.vmax * T * 0.85 + 0.3) continue;
    const score = P.y - Math.abs(dx) * 0.15;
    if (score > bestScore) { bestScore = score; best = { dx, px }; }
  }
  if (!best) return 0;
  return clamp(best.dx * 2.2 - h.vx * 0.22, -1, 1);
}
