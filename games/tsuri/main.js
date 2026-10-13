import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { glyphPolygons, shapeMetrics } from '../../glyph.js';
import { SPECIES, BY_CH, TYPE_LABEL, WEIGHT, AREAS, AREA_LIST } from './species.js';
import { deriveTraits, personality, strikeWindow, createFight, stepFight, botFight, BAND } from './fight.js';
import { AREA_TALK, FIRST_CATCH, DRAGON, COMPLETE } from './story.js';

// 動作確認用パラメータ：?unlock=1 全部の釣り場を開く / ?quick=1 アタリがすぐ来る / ?fish=龍 その字ばかり泳ぐ / ?area=umi 釣り場を指定
const Q = new URLSearchParams(location.search);
const TEST = { unlock: Q.has('unlock'), quick: Q.has('quick'), fish: Q.get('fish'), area: Q.get('area') };
const SAVE_KEY = 'moji_tsuri.save';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- 保存（localStorage） ----------
function loadSave() {
  const fresh = { caught: {}, areas: { ike: 1 }, story: {}, area: 'ike' };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s || typeof s !== 'object') return fresh;
    const caught = {};
    for (const ch of Object.keys(s.caught || {})) {
      const c = s.caught[ch];
      if (BY_CH[ch] && c) caught[ch] = { n: c.n | 0 || 1, best: Number(c.best) || 0, first: Number(c.first) || Date.now() };
    }
    const areas = { ike: 1 };
    for (const a of AREA_LIST) if (s.areas && s.areas[a]) areas[a] = 1;
    return { caught, areas, story: s.story && typeof s.story === 'object' ? s.story : {}, area: AREAS[s.area] && areas[s.area] ? s.area : 'ike' };
  } catch { return fresh; }
}
const save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できない環境でも遊べる */ } }

// ---------- フォント・字の絵・字の性格 ----------
let font = null;
const EM = 190, BMP = 256;
const bmpCache = new Map();
let AVAIL = SPECIES;            // フォントに字がある種類（通常は40種）
let RAW = {}, TRAITS = {};                // ch → { power, thrash, nimble }

function glyphMask(ch) {
  const polys = glyphPolygons(font, ch, EM);   // y 上向き
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const { outer } of polys) for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  if (!isFinite(x0)) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = BMP;
  const g = cv.getContext('2d');
  const trace = ring => { ring.forEach((q, i) => { const X = BMP / 2 + q.x - cx, Y = BMP / 2 - (q.y - cy); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); };
  // 外形を1つずつ塗り、穴はあとでくり抜く（輪郭が重なるフォントでも消えない）
  g.fillStyle = '#000';
  for (const { outer } of polys) { g.beginPath(); trace(outer); g.fill(); }
  g.globalCompositeOperation = 'destination-out';
  for (const { holes } of polys) for (const h of holes) { g.beginPath(); trace(h); g.fill(); }
  return cv;
}
function tinted(cv, color) {
  const t = document.createElement('canvas'); t.width = t.height = BMP;
  const g = t.getContext('2d');
  g.drawImage(cv, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, BMP, BMP);
  return t;
}
// kind: shadow=水中の影 / ink=ふちどり付きの字 / glow=光っている字。BMP四方の絵（1em = EM px）
function glyphBitmap(ch, kind) {
  const key = ch + kind;
  if (!bmpCache.has(key)) {
    const m = glyphMask(ch);
    let out = null;
    if (m) {
      out = document.createElement('canvas'); out.width = out.height = BMP;
      const g = out.getContext('2d');
      if (kind === 'shadow') g.drawImage(tinted(m, '#06222f'), 0, 0);
      else {
        const edge = tinted(m, kind === 'glow' ? '#ffd23f' : '#fffdf5');
        for (let a = 0; a < 16; a++) g.drawImage(edge, Math.cos(a * Math.PI / 8) * 5, Math.sin(a * Math.PI / 8) * 5);
        g.drawImage(tinted(m, kind === 'glow' ? '#7a4a00' : '#1d2b3a'), 0, 0);
      }
    }
    bmpCache.set(key, out);
  }
  return bmpCache.get(key);
}
// 字を指定サイズ(em px)で描く。cx,cy は字の中心
function drawGlyph(g, ch, kind, cx, cy, size, rot = 0, sx = 1, sy = 1) {
  const cv = glyphBitmap(ch, kind);
  if (!cv) return;
  const k = size / EM;
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(sx, sy);
  g.drawImage(cv, -BMP / 2 * k, -BMP / 2 * k, BMP * k, BMP * k);
  g.restore();
}
function charCanvas(ch, px, kind = 'ink') {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas'); c.width = c.height = Math.round(px * dpr);
  drawGlyph(c.getContext('2d'), ch, kind, c.width / 2, c.height / 2, c.width * 0.78);
  return c;
}

function computeTraits() {
  const raw = {};
  for (const s of AVAIL) {
    const m = shapeMetrics(glyphPolygons(font, s.ch, 1000));
    raw[s.ch] = { ink: m.area / 1e6, per: m.perim / 1000, round: m.roundness };
  }
  RAW = raw;
  TRAITS = deriveTraits(raw);
  for (const s of AVAIL) for (const [k, v] of Object.entries(s.min || {})) TRAITS[s.ch][k] = Math.max(TRAITS[s.ch][k], v);   // ぬし（龍）は形にかかわらず手ごわい
}
const hasGlyph = ch => font.charToGlyph(ch).index !== 0;

// ---------- 画面の寸法 ----------
const cv = $('stage'), ctx = cv.getContext('2d');
let L = null;       // いまのレイアウト（毎フレーム作り直す）
function layout() {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const u = clamp(Math.min(W / 400, H / 380), 0.7, 1.5);
  const waterY = Math.round(H * 0.3), waterH = H - waterY;
  const shoreX = W * 0.22, [f0, f1] = AREAS[save.area].floor;
  const floorY = x => { const t = clamp((x - shoreX) / (W - shoreX), 0, 1), s = t * t * (3 - 2 * t); return waterY + waterH * (f0 + (f1 - f0) * (0.25 * t + 0.75 * s)); };
  const manX = W * 0.1, groundY = waterY - 4 * u;
  L = { W, H, u, waterY, waterH, shoreX, floorY, manX, groundY, tipX: manX + 62 * u, tipY: groundY - 92 * u };
  return L;
}

// ---------- ゲームの状態 ----------
// phase: idle 投げる前 / charge ため中 / cast 飛んでいる / wait 待ち / bite アタリ / fight やりとり / land 釣れた演出 / lost 逃げられた / back 糸をもどす
let phase = 'idle', phaseT = 0;
let down = false;               // ボタンを押している
let holdT = 0, power = 0;
let hook = null;                // { x, y, bx, flyT, fromX, fromY }
let fishes = [], parts = [], ripples = [];
let fight = null, fighter = null, landInfo = null;
let shake = 0, time = 0;
let overlays = 0;               // 開いている画面の数（会話・結果・ずかん・メニュー）。0でないあいだは時間を止める

function areaPool() {
  const a = AREAS[save.area];
  return a.pool.filter(([ch]) => BY_CH[ch] && AVAIL.includes(BY_CH[ch])).map(([ch, r]) => [BY_CH[ch], WEIGHT[r]]);
}
function pickSpecies() {
  const pool = areaPool();
  if (TEST.fish && BY_CH[TEST.fish] && !fishes.some(f => f.sp.ch === TEST.fish)) return BY_CH[TEST.fish];
  if (TEST.fish && BY_CH[TEST.fish]) return BY_CH[TEST.fish];
  const total = pool.reduce((s, [, w]) => s + w, 0);
  for (let tries = 0; tries < 8; tries++) {
    let r = Math.random() * total, sp = pool[0][0];
    for (const [s, w] of pool) { r -= w; if (r <= 0) { sp = s; break; } }
    if (fishes.filter(f => f.sp === sp).length < 2) return sp;     // 同じ字ばかりにならないように
  }
  return pool[0][0];
}
function spawnFish() {
  const sp = pickSpecies(), r = Math.pow(Math.random(), 1.6);
  const tr = TRAITS[sp.ch] || { power: .5, thrash: .5, nimble: .5 };
  const mid = Math.sqrt(sp.lo * sp.hi);
  fishes.push({
    sp, r, cm: Math.round((sp.lo + (sp.hi - sp.lo) * r) * 10) / 10, tr,
    base: clamp(30 + 18 * Math.log10(mid / 10), 26, 68) * (0.85 + 0.3 * r),
    nx: rnd(0.3, 0.96), dir: Math.random() < 0.5 ? -1 : 1, speed: rnd(0.035, 0.07) * (0.7 + 0.6 * tr.nimble),
    dep: clamp(sp.dep + rnd(-0.08, 0.08), 0.02, 1), ph: rnd(0, 6.28), t: 0, state: 'swim', interest: 0, cool: 0, x: 0, y: 0, tmr: 0,
  });
}
function resetPond() {
  fishes = []; parts = []; ripples = []; hook = null; fight = null; fighter = null;
  for (let i = 0; i < 8; i++) spawnFish();
  for (const f of fishes) { f.x = f.nx * (L?.W || 360); }
}

function fishPx(f) { return f.base * L.u; }
function fishPos(f) {
  const fl = L.floorY(f.nx * L.W), top = L.waterY + 26 * L.u, bot = fl - fishPx(f) * 0.5 - 4 * L.u;
  return { x: f.nx * L.W, y: top + Math.max(0, bot - top) * f.dep + Math.sin(f.t * 1.3 + f.ph) * 4 * L.u };
}

const setPhase = p => { phase = p; phaseT = 0; refreshUi(); };

// ---------- 入力 ----------
function onDown() {
  down = true;
  if (overlays || !font) return;
  if (phase === 'idle') { holdT = 0; power = 0; setPhase('charge'); }
  else if (phase === 'wait') {
    const f = fishes.find(f => f.state === 'nibble' || f.state === 'approach');
    if (f) { flee(f); lose('はやすぎた…！', '逃げられた。アタリがくるまで待とう'); }
  } else if (phase === 'bite') strike();
}
function onUp() {
  down = false;
  if (overlays) return;
  if (phase === 'charge') cast(power);
}
function strike() {
  const f = fighter;
  if (!f || f.windowT <= 0) return;
  fight = createFight(f.tr);
  f.state = 'hooked';
  f.fx0 = hook.x; f.fy0 = hook.y;
  setPhase('fight');
  say('ヒット！', 'alert');
  shake = 0.3;
  splash(hook.x, L.waterY, 8);
}
function flee(f) { f.state = 'flee'; f.tmr = 1.2; f.cool = 7; f.dir = f.x < (hook?.x ?? 0) ? -1 : 1; if (fighter === f) fighter = null; }

function cast(p) {
  const L2 = L, tx = L2.shoreX + (L2.W * 0.96 - L2.shoreX) * (0.1 + 0.9 * p);
  hook = { x: L2.tipX, y: L2.tipY, bx: tx, fromX: L2.tipX, fromY: L2.tipY, flyT: 0, sunk: 0 };
  setPhase('cast');
}
function retrieve() {
  if (overlays) return;
  if (phase === 'wait' || phase === 'bite') {
    if (fighter) { if (fighter.state !== 'hooked') flee(fighter); fighter = null; }
    setPhase('back');
  }
}
function lose(title, sub, kind = 'bad') {
  say(title, kind);
  if (sub) toast(sub);
  hook = hook ? { ...hook } : null;
  setPhase('lost');
}

// ---------- 画面上のメッセージ ----------
let bannerTimer = 0, toastTimer = 0;
function say(text, kind = '') {
  const el = $('banner');
  el.textContent = text; el.className = ''; void el.offsetWidth; el.className = 'pop ' + kind;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { el.textContent = ''; }, 1300);
}
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function refreshUi() {
  const a = $('act'), hint = $('hint');
  a.className = 'act';
  const t = {
    idle: ['長押しで 投げる', '', 'ボタンを長押しして力をため、はなして投げよう'],
    charge: ['はなして 投げる！', 'charge', '遠くへ投げるほど、深いところへ落ちる'],
    cast: ['…', 'wait', ''],
    wait: ['待つ…', 'wait', '水中の影が近づいてウキをつつくまで待とう。沈んだらタップ！'],
    bite: ['あわせる！', 'strike', ''],
    fight: ['おして 巻く', 'reel', '目もりを緑の帯に入れて巻こう。ぶるっとしたら力をぬく'],
    land: ['…', 'wait', ''], lost: ['…', 'wait', ''], back: ['…', 'wait', ''],
  }[phase];
  a.textContent = t[0]; if (t[1]) a.classList.add(t[1]);
  hint.textContent = t[2];
  $('power').hidden = phase !== 'charge';
  $('tension').hidden = phase !== 'fight';
  if (phase === 'fight') { $('t-band').style.left = BAND.lo * 100 + '%'; $('t-band').style.width = (BAND.hi - BAND.lo) * 100 + '%'; }
  $('pull').disabled = !(phase === 'wait' || phase === 'bite');
}

// ---------- エフェクト ----------
function splash(x, y, n = 14, big = 1) {
  for (let i = 0; i < n; i++) parts.push({ k: 'drop', x, y, vx: rnd(-60, 60) * big, vy: rnd(-200, -90) * big, life: rnd(0.6, 1.1), max: 1, r: rnd(1.5, 3.5) });
  ripples.push({ x, t: 0 });
}
function sparkle(x, y, n = 20, color = '#ffe27a') {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), v = rnd(40, 160); parts.push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.5, 1.1), max: 1.1, r: rnd(1.5, 3.5), color }); }
}

// ---------- 更新 ----------
function update(dt) {
  time += dt;
  L = layout();
  if (shake > 0) shake = Math.max(0, shake - dt);
  phaseT += dt;
  // 字たち
  for (const f of fishes) {
    f.t += dt; f.cool = Math.max(0, f.cool - dt);
    if (f.state === 'swim' || f.state === 'flee') {
      const sp = f.state === 'flee' ? 0.25 : f.speed * (fight ? 1.6 : 1);
      f.nx += f.dir * sp * dt;
      if (f.nx > 0.97) { f.nx = 0.97; f.dir = -1; }
      if (f.nx < L.shoreX / L.W + 0.06) { f.nx = L.shoreX / L.W + 0.06; f.dir = 1; }
      if (f.state === 'flee' && (f.tmr -= dt) <= 0) f.state = 'swim';
    }
  }
  // 泡
  if (Math.random() < dt * 3) parts.push({ k: 'bubble', x: rnd(L.shoreX, L.W), y: L.H - 4, vx: rnd(-6, 6), vy: rnd(-40, -22), life: 99, max: 99, r: rnd(1.5, 4) });
  for (const q of parts) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.k === 'drop' || q.k === 'spark') q.vy += 380 * dt * (q.k === 'spark' ? 0.2 : 1);
    if (q.k === 'bubble') { q.vx += Math.sin(time * 3 + q.y) * 0.4; if (q.y < L.waterY + 3) q.life = 0; }
    if (q.k === 'drop' && q.y > L.waterY && q.vy > 0) q.life = 0;
  }
  parts = parts.filter(q => q.life > 0);
  for (const r of ripples) r.t += dt;
  ripples = ripples.filter(r => r.t < 1.6);

  if (phase === 'charge') {
    holdT += dt;
    const c = (holdT / 1.5) % 2;
    power = c < 1 ? c : 2 - c;
    $('power-fill').style.width = power * 100 + '%';
    if (!down) onUp();
  } else if (phase === 'cast') {
    hook.flyT += dt / 0.55;
    const t = Math.min(1, hook.flyT);
    hook.x = hook.fromX + (hook.bx - hook.fromX) * t;
    hook.y = hook.fromY + (L.waterY - hook.fromY) * t - Math.sin(t * Math.PI) * 90 * L.u;
    if (t >= 1) { hook.x = hook.bx; hook.y = L.waterY; splash(hook.x, L.waterY, 10); setPhase('wait'); }
  } else if (phase === 'wait' || phase === 'bite') updateWait(dt);
  else if (phase === 'fight') updateFight(dt);
  else if (phase === 'land') {
    landInfo.t += dt;
    if (landInfo.t > 0.5 && !landInfo.splashed) { landInfo.splashed = true; splash(landInfo.x0, L.waterY, 22, 1.4); sparkle(L.W * 0.45, L.waterY - 70 * L.u, 28); }
    if (landInfo.t > 1.5) { const info = landInfo; landInfo = null; setPhase('idle'); showResult(info); }
  } else if (phase === 'lost') {
    if (phaseT > 1.1) { hook = null; setPhase('idle'); }
  } else if (phase === 'back') {
    if (hook) { hook.y -= 520 * dt; hook.x += (L.tipX - hook.x) * Math.min(1, dt * 6); if (hook.y < L.waterY - 30 * L.u || phaseT > 0.7) { hook = null; setPhase('idle'); } }
    else setPhase('idle');
  }
  // 字の補充
  while (fishes.length < 8) spawnFish();
}

function updateWait(dt) {
  const h = hook, floor = L.floorY(h.x) - 10 * L.u;
  h.y = Math.min(floor, Math.max(h.y, L.waterY) + (phase === 'wait' ? 85 * L.u * dt : 0));
  if (h.y > L.waterY + 2) { /* 沈んでいく */ }
  // 食いつく字を探す
  if (!fighter) {
    for (const f of fishes) {
      if (f.state !== 'swim' || f.cool > 0) continue;
      const p = fishPos(f), d = Math.hypot(p.x - h.x, p.y - (h.y + 6 * L.u));
      const reach = (120 + fishPx(f) * 0.5) * L.u / 1;
      if (d < reach) { f.interest += dt * (TEST.quick ? 20 : 0.7 + 0.5 * (1 - d / reach)); if (f.interest > 1) { f.state = 'approach'; f.tmr = 0; fighter = f; break; } }
      else f.interest = Math.max(0, f.interest - dt * 0.5);
    }
  }
  const f = fighter;
  if (!f) return;
  if (f.state === 'approach') {
    const p = fishPos(f), tx = h.x, ty = h.y + 6 * L.u, d = Math.hypot(tx - p.x, ty - p.y);
    f.nx += Math.sign(tx - p.x) * Math.min(Math.abs(tx - p.x), 130 * L.u * dt) / L.W;
    // 深さも針に合わせる
    const fl = L.floorY(f.nx * L.W), top = L.waterY + 26 * L.u, bot = fl - fishPx(f) * 0.5 - 4 * L.u;
    const want = clamp((ty - top) / Math.max(1, bot - top), 0, 1);
    f.dep += (want - f.dep) * Math.min(1, dt * 3);
    if (d < 16 * L.u) { f.state = 'nibble'; f.nibbles = TEST.quick ? 0 : (Math.random() < 0.5 ? 1 : 2); f.tmr = TEST.quick ? 0.1 : rnd(0.5, 1.0); f.dip = 0; }
  } else if (f.state === 'nibble') {
    f.dip = Math.max(0, (f.dip || 0) - dt * 3);
    f.tmr -= dt;
    if (f.tmr <= 0) {
      if (f.nibbles > 0) { f.nibbles--; f.dip = 1; f.tmr = rnd(0.7, 1.3); ripples.push({ x: h.x, t: 0 }); }
      else {
        f.state = 'bite'; f.windowT = strikeWindow(f.tr); f.dip = 1;
        shake = 0.4; say('アタリ！', 'alert'); setPhase('bite');
      }
    }
  } else if (f.state === 'bite') {
    f.windowT -= dt;
    if (f.windowT <= 0) { flee(f); lose('おそすぎた…！', '逃げられた。アタリの合図を見のがさないで'); }
  }
}

function updateFight(dt) {
  const f = fighter;
  stepFight(fight, dt, down);
  // 字を岸の足もとへ引きよせる
  const prog = 1 - fight.D / fight.D0;
  const tx = L.shoreX + 14 * L.u, ty = L.waterY + 30 * L.u;
  const jit = (fight.tr.thrash * 10 + 3) * L.u * (fight.tell > 0 ? 1.6 : 1);
  f.x = f.fx0 + (tx - f.fx0) * clamp(prog, 0, 1) + Math.sin(time * 14) * jit * (fight.tell > 0 || fight.burst > 0 ? 1 : 0.35);
  f.y = f.fy0 + (ty - f.fy0) * clamp(prog, 0, 1) + Math.cos(time * 11) * jit * 0.6;
  hook.x = f.x; hook.y = f.y;
  if (fight.burst > 0 || fight.tell > 0) { if (Math.random() < dt * 20) parts.push({ k: 'bubble', x: f.x + rnd(-10, 10), y: f.y, vx: rnd(-10, 10), vy: rnd(-70, -30), life: 99, max: 99, r: rnd(2, 4) }); }
  $('t-needle').style.left = fight.T * 100 + '%';
  $('d-fill').style.width = clamp(prog, 0, 1) * 100 + '%';
  $('tension').classList.toggle('tell', fight.tell > 0 && fight.burst <= 0);
  if (fight.result === 'win') {
    landInfo = { f, t: 0, x0: f.x, y0: f.y, splashed: false };
    fishes.splice(fishes.indexOf(f), 1);
    fighter = null;
    recordCatch(f);
    setPhase('land');
    say('釣れた！', 'alert');
  } else if (fight.result === 'snap') {
    flee(f); fighter = null; fight = null;
    parts.push(...Array.from({ length: 6 }, () => ({ k: 'spark', x: hook.x, y: hook.y, vx: rnd(-80, 80), vy: rnd(-80, 0), life: .6, max: .6, r: 2, color: '#fff' })));
    lose('糸が切れた！', '巻きすぎ。ぐんと引かれたら、ボタンをはなして力をぬこう');
  } else if (fight.result === 'escape') {
    flee(f); fighter = null; fight = null;
    lose('逃げられた…', 'たるませすぎ。目もりを帯の中に保って巻こう');
  }
}

// ---------- 釣れた記録 ----------
function recordCatch(f) {
  const ch = f.sp.ch, prev = save.caught[ch];
  const isNew = !prev, isBest = !!prev && f.cm > prev.best;
  save.caught[ch] = { n: (prev?.n || 0) + 1, best: Math.max(prev?.best || 0, f.cm), first: prev?.first || Date.now() };
  persist();
  f.isNew = isNew; f.isBest = isBest; f.prevBest = prev?.best || 0;
  updateTop();
}
const fmtCm = cm => (cm >= 100 ? Math.round(cm) : cm.toFixed(1)) + ' cm';
const caughtCount = () => Object.keys(save.caught).filter(ch => BY_CH[ch] && AVAIL.includes(BY_CH[ch])).length;

async function showResult(info) {
  const f = info.f, sp = f.sp, pers = personality(f.tr);
  $('res-new').textContent = f.isNew ? '★ NEW！ ずかんに載った ★' : '';
  const c = $('res-ch'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  drawGlyph(g, sp.ch, 'ink', c.width / 2, c.height / 2, c.width * 0.78);
  $('res-name').textContent = `${sp.ch}（${sp.yomi}）　${TYPE_LABEL[sp.type]}`;
  $('res-size').textContent = fmtCm(f.cm);
  $('res-best').textContent = f.isNew ? 'はじめての 1匹！' : f.isBest ? `ベスト更新！（前のベスト ${fmtCm(f.prevBest)}）` : `ベスト ${fmtCm(save.caught[sp.ch].best)}`;
  $('res-note').textContent = sp.note;
  $('res-trait').textContent = `【${pers.name}】${pers.text}`;
  await overlay('result');
  await afterCatch(sp);
}
function overlay(id) {
  return new Promise(res => {
    const el = $(id); overlays++; el.hidden = false;
    const close = () => { el.removeEventListener('click', close); el.hidden = true; overlays--; res(); };
    setTimeout(() => el.addEventListener('click', close), 350);    // 連打で閉じてしまわないように
  });
}
async function afterCatch(sp) {
  const n = caughtCount();
  if (n === 1 && !save.story.first) { save.story.first = 1; persist(); await talk(FIRST_CATCH); }
  if (sp.ch === '龍' && !save.story.dragon) { save.story.dragon = 1; persist(); await talk(DRAGON); }
  for (const a of ['kawa', 'umi']) {
    if (!save.areas[a] && n >= AREAS[a].open) { await unlockArea(a); }
  }
  if (n >= AVAIL.length && !save.story.complete) { save.story.complete = 1; persist(); await talk(COMPLETE); }
}
async function unlockArea(a) {
  save.areas[a] = 1; persist(); renderAreas();
  toast(`釣り場「${AREAS[a].name}」が開いた！`, 3500);
  if (!save.story[a]) { save.story[a] = 1; persist(); await talk(AREA_TALK[a]); }
}

// ---------- 会話 ----------
function talk(lines) {
  return new Promise(resolve => {
    const box = $('talk');
    let i = 0;
    const show = () => { $('talk-who').textContent = lines[i].who === 'n' ? '' : lines[i].who; $('talk-text').textContent = lines[i].text; };
    const next = () => {
      if (++i >= lines.length) { box.hidden = true; box.onclick = null; document.removeEventListener('keydown', onKey); overlays--; resolve(); } else show();
    };
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } };
    overlays++; box.hidden = false; box.onclick = next; document.addEventListener('keydown', onKey);
    show();
  });
}

// ---------- 釣り場 ----------
function renderAreas() {
  const nav = $('areas'); nav.innerHTML = '';
  for (const a of AREA_LIST) {
    const ok = !!save.areas[a], b = document.createElement('button');
    b.className = (a === save.area ? 'on ' : '') + (ok ? '' : 'locked');
    b.innerHTML = ok ? `${AREAS[a].name}` : `🔒 ${AREAS[a].name}<small>${AREAS[a].open}種で開く</small>`;
    b.dataset.area = a;
    b.onclick = () => setArea(a);
    nav.append(b);
  }
}
function setArea(a) {
  if (overlays) return;
  if (!save.areas[a]) { toast(`「${AREAS[a].name}」は、ずかんが${AREAS[a].open}種になると開く（いま${caughtCount()}種）`); return; }
  if (a === save.area) return;
  if (!(phase === 'idle' || phase === 'wait')) { toast('やりとりのあとで移動しよう'); return; }
  save.area = a; persist(); renderAreas();
  phase = 'idle'; resetPond(); refreshUi();
}
function updateTop() {
  const n = caughtCount();
  $('dex-count').textContent = `${n}/${AVAIL.length}`;
}

// ---------- ずかん ----------
let dexSel = null;
function openDex() {
  if (overlays) return;
  const n = caughtCount();
  $('dex-count2').textContent = `${n}/${AVAIL.length}（${Math.floor(n / AVAIL.length * 100)}%）`;
  $('dex-rate-fill').style.width = n / AVAIL.length * 100 + '%';
  const grid = $('dex-grid'); grid.innerHTML = '';
  for (const s of AVAIL) {
    const c = save.caught[s.ch], b = document.createElement('button');
    b.className = 'cell' + (c ? ' got' : ''); b.dataset.ch = s.ch;
    if (c) { b.append(charCanvas(s.ch, 40)); const t = document.createElement('span'); t.className = 'best'; t.textContent = fmtCm(c.best); b.append(t); } else b.textContent = '？';
    b.onclick = () => showDetail(s.ch);
    grid.append(b);
  }
  $('dex-detail').textContent = '字をタップすると、くわしく見られるよ。「？」はまだ釣っていない字。';
  overlays++; $('dex').hidden = false;
}
function bar(label, v) { return `<span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i>`; }
function showDetail(ch) {
  document.querySelectorAll('#dex-grid .cell').forEach(e => e.classList.toggle('sel', e.dataset.ch === ch));
  const s = BY_CH[ch], c = save.caught[ch], el = $('dex-detail');
  el.innerHTML = '';
  if (!c) { el.textContent = 'まだ釣っていない字。どこかの釣り場の水中を泳いでいる。'; return; }
  const tr = TRAITS[ch], pers = personality(tr);
  const head = document.createElement('div'); head.className = 'head';
  head.append(charCanvas(ch, 64));
  const nm = document.createElement('div');
  nm.innerHTML = `<div class="nm">${ch}（${s.yomi}）</div><div>${TYPE_LABEL[s.type]}　釣った数 ${c.n}</div>`;
  head.append(nm);
  const info = document.createElement('div');
  info.innerHTML = `ベストサイズ <b>${fmtCm(c.best)}</b>　初めて釣った日 ${new Date(c.first).toLocaleDateString('ja-JP')}<br>いる場所：${s.areas.map(a => AREAS[a].name).join('・')}`;
  const note = document.createElement('div'); note.textContent = s.note;
  const pe = document.createElement('div');
  pe.innerHTML = `<b>【${pers.name}】</b>${pers.text}<div class="bars">${bar('ひきの強さ', tr.power)}${bar('あばれ', tr.thrash)}${bar('すばやさ', tr.nimble)}</div>`;
  el.append(head, info, note, pe);
}
function closePanels() {
  for (const id of ['dex', 'menu']) if (!$(id).hidden) { $(id).hidden = true; overlays--; }
}

// ---------- 描画 ----------
function waveY(x) { return L.waterY + Math.sin(x * 0.03 + time * 1.6) * 2.2 * L.u + Math.sin(x * 0.011 - time * 0.9) * 1.6 * L.u; }
function rippleY(x) { let y = waveY(x); for (const r of ripples) { const d = Math.abs(x - r.x), w = r.t * 70 * L.u; y += Math.sin((d - w) * 0.25) * Math.exp(-d / (60 * L.u)) * Math.max(0, 1 - r.t / 1.6) * 3 * L.u * (d < w + 30 ? 1 : 0); } return y; }

function drawScene() {
  const { W, H, u, waterY } = L, A = AREAS[save.area];
  if (shake > 0) ctx.translate(rnd(-1, 1) * shake * 10, rnd(-1, 1) * shake * 10);
  // 空
  let g = ctx.createLinearGradient(0, 0, 0, waterY);
  g.addColorStop(0, A.sky[0]); g.addColorStop(1, A.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, waterY + 20);
  // 太陽・雲・遠景
  ctx.fillStyle = save.area === 'umi' ? '#ff9a4d' : '#fff3b0';
  ctx.beginPath(); ctx.arc(W * 0.78, waterY - (save.area === 'umi' ? 12 : 50) * u, 20 * u, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  for (let i = 0; i < 3; i++) { const cx = ((time * 6 + i * W * 0.4) % (W + 120)) - 60, cy = waterY * (0.2 + 0.18 * i); ctx.beginPath(); ctx.ellipse(cx, cy, 34 * u, 9 * u, 0, 0, 7); ctx.ellipse(cx + 18 * u, cy - 6 * u, 22 * u, 9 * u, 0, 0, 7); ctx.fill(); }
  if (save.area !== 'umi') { ctx.fillStyle = save.area === 'kawa' ? '#7fb07a' : '#8fbf86'; ctx.beginPath(); ctx.moveTo(W * 0.3, waterY); for (let x = W * 0.3; x <= W; x += 10) ctx.lineTo(x, waterY - (18 + 14 * Math.sin(x * 0.02 + 1)) * u); ctx.lineTo(W, waterY); ctx.fill(); }
  // 水
  g = ctx.createLinearGradient(0, waterY, 0, H);
  g.addColorStop(0, A.water[0]); g.addColorStop(0.5, A.water[1]); g.addColorStop(1, A.water[2]);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, H + 20);
  for (let x = 0; x <= W + 8; x += 8) ctx.lineTo(x, rippleY(x));
  ctx.lineTo(W + 20, H + 20); ctx.fill();
  // 光のすじ
  ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) { const x0 = W * (0.3 + i * 0.2) + Math.sin(time * 0.4 + i) * 20 * u; ctx.beginPath(); ctx.moveTo(x0, waterY); ctx.lineTo(x0 + 26 * u, waterY); ctx.lineTo(x0 - 40 * u, H); ctx.lineTo(x0 - 90 * u, H); ctx.fill(); }
  ctx.restore();
  // 水底と岸
  ctx.fillStyle = A.sand;
  ctx.beginPath(); ctx.moveTo(L.shoreX, H + 10); ctx.lineTo(L.shoreX, L.floorY(L.shoreX));
  for (let x = L.shoreX; x <= W + 8; x += 8) ctx.lineTo(x, L.floorY(x));
  ctx.lineTo(W + 20, H + 10); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  for (let i = 0; i < 7; i++) { const x = L.shoreX + (W - L.shoreX) * ((i * 0.173 + 0.08) % 1); ctx.beginPath(); ctx.ellipse(x, L.floorY(x) + 6 * u, 9 * u, 3 * u, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = A.earth;
  ctx.beginPath(); ctx.moveTo(-20, L.groundY); ctx.lineTo(L.shoreX, L.groundY); ctx.lineTo(L.shoreX + 6 * u, waterY + 8 * u);
  ctx.lineTo(L.shoreX + 4 * u, H + 10); ctx.lineTo(-20, H + 10); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-20, L.groundY + 5 * u, L.shoreX + 24, H);
  ctx.fillStyle = A.earth; ctx.fillRect(-20, L.groundY, L.shoreX + 26, 7 * u);
}

function drawFishes() {
  for (const f of fishes) {
    if (f === fighter && fight && phase === 'fight') continue;
    const p = f.state === 'hooked' ? { x: f.x, y: f.y } : fishPos(f), px = fishPx(f);
    const wig = Math.sin(f.t * 5 + f.ph) * 0.08 + (f.dir > 0 ? 0.1 : -0.1);
    const sq = 1 + Math.sin(f.t * 6 + f.ph) * 0.05;
    ctx.globalAlpha = (0.78 - 0.3 * f.dep) * (f.state === 'flee' ? 0.5 : 1);
    drawGlyph(ctx, f.sp.ch, 'shadow', p.x, p.y, px, wig, sq, 1 / sq);
    f.x = p.x; f.y = p.y;
  }
  ctx.globalAlpha = 1;
}

function drawHooked() {
  const f = fighter;
  if (!f || !fight || phase !== 'fight') return;
  const px = fishPx(f), shk = (fight.tell > 0 || fight.burst > 0) ? Math.sin(time * 50) * 0.12 : Math.sin(time * 9) * 0.06;
  const reveal = clamp((1 - fight.D / fight.D0 - 0.7) / 0.3, 0, 1);       // 岸にちかづくと影から字に見えてくる
  ctx.globalAlpha = 1 - reveal; drawGlyph(ctx, f.sp.ch, 'shadow', f.x, f.y, px, shk);
  ctx.globalAlpha = reveal; drawGlyph(ctx, f.sp.ch, 'ink', f.x, f.y, px, shk);
  ctx.globalAlpha = 1;
}

function drawSurface() {
  const { W, u, waterY } = L;
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = L.shoreX; x <= W + 8; x += 8) { const y = rippleY(x); x === L.shoreX ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.beginPath(); ctx.moveTo(L.shoreX, waterY);
  for (let x = L.shoreX; x <= W + 8; x += 8) ctx.lineTo(x, rippleY(x) + 5 * u + Math.sin(x * 0.05 + time * 2) * 2);
  ctx.lineTo(W, waterY); ctx.fill();
}

function drawParts() {
  for (const q of parts) {
    if (q.k === 'bubble') { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * L.u, 0, 7); ctx.stroke(); }
    else if (q.k === 'drop') { ctx.fillStyle = 'rgba(235,250,255,.9)'; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * L.u, 0, 7); ctx.fill(); }
    else { ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * L.u, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  }
}

// 釣り人（おじいさんの「釣」）とさお
function drawAngler(bend) {
  const { u, manX, groundY } = L;
  ctx.save(); ctx.translate(manX, groundY);
  ctx.fillStyle = '#4b5d73'; ctx.fillRect(-9 * u, -34 * u, 18 * u, 34 * u);                 // からだ
  ctx.fillStyle = '#3a4656'; ctx.fillRect(-9 * u, -8 * u, 8 * u, 8 * u); ctx.fillRect(1 * u, -8 * u, 8 * u, 8 * u);
  ctx.fillStyle = '#f2cfa8'; ctx.beginPath(); ctx.arc(0, -44 * u, 9 * u, 0, 7); ctx.fill();   // 顔
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-3 * u, -38 * u); ctx.lineTo(0, -28 * u); ctx.lineTo(3 * u, -38 * u); ctx.fill(); // ひげ
  ctx.fillStyle = '#d9b96a'; ctx.beginPath(); ctx.ellipse(0, -51 * u, 17 * u, 5 * u, 0, 0, 7); ctx.fill();     // 麦わら帽
  ctx.beginPath(); ctx.arc(0, -52 * u, 9 * u, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#1d2b3a'; ctx.fillRect(2 * u, -46 * u, 2 * u, 2 * u);
  ctx.restore();
  // さお：手もと → 先。つよく引かれるとしなる
  const hx = manX + 10 * u, hy = groundY - 34 * u, tx = L.tipX, ty = L.tipY + bend * 14 * u;
  ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3 * u; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo((hx + tx) / 2 + bend * 6 * u, (hy + ty) / 2 - 10 * u + bend * 10 * u, tx, ty); ctx.stroke();
}

function drawLine() {
  const { u } = L;
  if (!hook || phase === 'charge' || phase === 'idle') return;
  const tx = L.tipX, ty = L.tipY + (phase === 'fight' ? clamp(fight?.T || 0, 0, 1) * 14 * u : 0);
  const tense = phase === 'fight' ? fight.T : 0;
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = tense > 0.8 ? '#ff5a5a' : 'rgba(255,255,255,.9)';
  if (phase === 'fight') {
    const f = fighter;
    const sag = (1 - clamp(fight.T / BAND.lo, 0, 1)) * 40 * u;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + f.x) / 2, (ty + f.y) / 2 + sag, f.x, f.y); ctx.stroke();
    return;
  }
  if (phase === 'cast' || phase === 'back') {
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hook.x, hook.y); ctx.stroke();
    ctx.fillStyle = '#e8412c'; ctx.beginPath(); ctx.arc(hook.x, hook.y, 4.5 * u, 0, 7); ctx.fill();
    return;
  }
  // 待ち：さお先 → ウキ（水面）→ 針（水中）
  const dip = fighter && (fighter.state === 'bite' ? 1 : fighter.dip || 0);
  const bx = hook.x, by = rippleY(bx) + dip * (fighter?.state === 'bite' ? 12 : 7) * u;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) - 8 * u + 20 * u, bx, by - 5 * u); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hook.x, hook.y); ctx.stroke();
  ctx.fillStyle = '#e8412c'; ctx.beginPath(); ctx.arc(bx, by - 3 * u, 5 * u, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by - 3 * u, 5 * u, 0, Math.PI); ctx.fill();
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hook.x, hook.y + 3 * u, 3 * u, 0, Math.PI * 1.4); ctx.stroke();
}

function drawLand() {
  if (phase !== 'land' || !landInfo) return;
  const i = landInfo, t = clamp(i.t / 1.1, 0, 1), { u } = L;
  const x = i.x0 + (L.W * 0.45 - i.x0) * t, y = L.waterY - Math.sin(Math.min(1, t) * Math.PI) * 110 * u + (1 - t) * 20 * u - t * 40 * u;
  const px = fishPx(i.f) * (1 + 0.7 * t);
  // 光
  const gl = ctx.createRadialGradient(x, y, 0, x, y, px * 1.6);
  gl.addColorStop(0, 'rgba(255,240,150,.95)'); gl.addColorStop(1, 'rgba(255,240,150,0)');
  ctx.fillStyle = gl; ctx.globalAlpha = 0.4 + 0.6 * Math.sin(clamp(i.t, 0, 1.4) / 1.4 * Math.PI); ctx.beginPath(); ctx.arc(x, y, px * 1.6, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  drawGlyph(ctx, i.f.sp.ch, 'glow', x, y, px, Math.sin(i.t * 8) * 0.1);
}

function render() {
  ctx.save();
  drawScene();
  drawFishes();
  drawHooked();
  drawSurface();
  drawParts();
  const bend = phase === 'fight' ? clamp((fight?.T || 0), 0, 1) : 0;
  drawAngler(bend);
  drawLine();
  drawLand();
  if (phase === 'charge') {       // 投げる力：さおのそばに飛距離のめやす
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    const x = L.shoreX + (L.W * 0.96 - L.shoreX) * (0.1 + 0.9 * power);
    ctx.beginPath(); ctx.moveTo(x, L.waterY - 4); ctx.lineTo(x - 7 * L.u, L.waterY - 16 * L.u); ctx.lineTo(x + 7 * L.u, L.waterY - 16 * L.u); ctx.fill();
  }
  ctx.restore();
}

let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (!font) return;
  if (!overlays) update(dt); else L = layout();
  render();
}

// ---------- 起動 ----------
async function loadFont() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf.slice(0));
  try { document.fonts.add(await new FontFace('MojiUI', buf).load()); } catch { /* 無くても system のフォントで表示される */ }
}

function setup() {
  const act = $('act');
  act.addEventListener('pointerdown', e => { e.preventDefault(); try { act.setPointerCapture(e.pointerId); } catch { /* ignore */ } onDown(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) act.addEventListener(ev, onUp);
  act.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !overlays && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); onDown(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') onUp(); });
  $('pull').onclick = retrieve;
  $('open-dex').onclick = openDex;
  $('dex-close').onclick = closePanels;
  $('open-menu').onclick = () => { if (!overlays) { overlays++; $('menu').hidden = false; } };
  $('menu-close').onclick = closePanels;
  $('m-reset').onclick = () => {
    if (!confirm('釣った字・ベストサイズ・開いた釣り場を、すべて消して最初からやり直します。よろしいですか？')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    location.reload();
  };
}

async function boot() {
  setup();
  try { await loadFont(); } catch (e) {
    console.error(e);
    $('loading-text').textContent = 'フォントの読み込みに失敗しました。通信を確認して、ページを開き直してください。';
    return;
  }
  AVAIL = SPECIES.filter(s => hasGlyph(s.ch));
  computeTraits();
  if (TEST.unlock) for (const a of AREA_LIST) save.areas[a] = 1;
  if (TEST.area && save.areas[TEST.area]) save.area = TEST.area;
  L = layout();
  renderAreas(); updateTop(); resetPond(); refreshUi();
  $('loading').hidden = true;
  requestAnimationFrame(frame);
  if (!save.story.ike) { save.story.ike = 1; persist(); await talk(AREA_TALK.ike); }
}

// 動作確認用の窓口（コンソール／自動テストから使う）
window.__tsuri = {
  get phase() { return phase; }, get fight() { return fight; }, get fishes() { return fishes; }, get hook() { return hook; },
  get traits() { return TRAITS; }, get raw() { return RAW; }, get avail() { return AVAIL.length; }, get save() { return save; }, get power() { return power; },
  personality, botFight,
  skipTalk() { const b = $('talk'); if (!b.hidden) b.click(); },
};
boot();
