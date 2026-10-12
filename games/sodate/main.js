import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { glyphPolygons } from '../../glyph.js';
import { FEEDS, FEED_KEYS, FORMS, FORM_LIST, EVO, START, isFinal, needOf, nextForm } from './forms.js';
import { PROLOGUE, evolveTalk, endingTalk } from './story.js';

// 動作確認用：?fast=1 で時間が30倍（?fast=数字 でその倍率）。ふだんの遊びでは使えない
const Q = new URLSearchParams(location.search);
const SPEED = Q.has('fast') ? (Number(Q.get('fast')) > 1 ? Number(Q.get('fast')) : 30) : 1;
const SAVE_KEY = 'moji_sodate.save';
const MAX_AWAY_H = 12;          // 閉じている間に育つのは最大12時間ぶん
const AWAY_GROW_PER_H = 2;      // 閉じていた1時間あたりの成長ポイント（最大でも24）
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

// ---------- 保存（localStorage） ----------
function newPet() {
  return { form: START, hunger: 60, mood: 70, energy: 90, growth: 0, feeds: {}, asleep: false, ready: false, path: [START], born: Date.now(), fed: 0 };
}
function loadSave() {
  const fresh = { pet: newPet(), dex: { [START]: Date.now() }, grads: {}, lastSeen: Date.now(), storyDone: false };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s || typeof s !== 'object') return fresh;
    const p = s.pet && FORMS[s.pet.form] ? { ...newPet(), ...s.pet } : newPet();
    p.path = Array.isArray(p.path) ? p.path.filter(c => FORMS[c]) : [p.form];
    if (!p.path.length) p.path = [p.form];
    p.feeds = p.feeds && typeof p.feeds === 'object' ? p.feeds : {};
    const dex = {};
    for (const c of Object.keys(s.dex || {})) if (FORMS[c]) dex[c] = s.dex[c];
    dex[p.form] = dex[p.form] || Date.now();
    const grads = {};
    for (const c of Object.keys(s.grads || {})) if (FORMS[c]) grads[c] = s.grads[c] | 0;
    return { pet: p, dex, grads, lastSeen: Number(s.lastSeen) || Date.now(), storyDone: !!s.storyDone };
  } catch { return fresh; }
}
const save = loadSave();
let pet = save.pet;
function persist() {
  save.pet = pet; save.lastSeen = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できない環境でも遊べる */ }
}

// ---------- フォント・字の絵（glyph.js の輪郭を使う） ----------
let font = null;
const EM = 400, BMP = 560;       // 字の絵のキャッシュ：1emが400px、キャンバスは560px四方
const bmpCache = new Map();
const INK = '#2b2a33', ACCENT = '#ff7a2f';

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
  return { cv, w: x1 - x0, h: y1 - y0 };
}
function tinted(cv, color) {
  const t = document.createElement('canvas'); t.width = t.height = BMP;
  const g = t.getContext('2d');
  g.drawImage(cv, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, BMP, BMP);
  return t;
}
// 白いふちどり付きの字（どんな背景でも読める）。{ cv, w, h } は em=EM のときの絵と字の大きさ
function glyphBitmap(ch, color = INK) {
  if (!font) return null;
  const key = ch + color;
  if (!bmpCache.has(key)) {
    const m = glyphMask(ch);
    if (!m) { bmpCache.set(key, null); return null; }
    const out = document.createElement('canvas'); out.width = out.height = BMP;
    const g = out.getContext('2d');
    const white = tinted(m.cv, '#fffaf0');
    for (let a = 0; a < 16; a++) g.drawImage(white, Math.cos(a * Math.PI / 8) * 7, Math.sin(a * Math.PI / 8) * 7);
    g.drawImage(tinted(m.cv, color), 0, 0);
    bmpCache.set(key, { cv: out, w: m.w, h: m.h });
  }
  return bmpCache.get(key);
}

// ---------- 状態の操作 ----------
const isNight = () => { const h = new Date().getHours(); return h >= 21 || h < 6; };
let busy = false;               // 会話・進化中は操作できない

function grow(x) {
  if (x <= 0) return;
  const need = needOf(pet.form);
  pet.growth = Math.min(pet.growth + x, isFinal(pet.form) ? need : need * 1.5);
  if (isFinal(pet.form) && pet.growth >= need) pet.ready = true;
}

function sim(dt) {
  const p = pet, night = isNight();
  p.hunger = clamp(p.hunger - 0.04 * dt);
  p.mood = clamp(p.mood - (0.03 + (p.hunger < 25 ? 0.05 : 0) + (p.energy < 15 ? 0.03 : 0)) * dt);
  if (p.asleep) {
    p.energy = clamp(p.energy + 0.25 * dt);
    if (p.energy >= 100 && !night) { p.asleep = false; toast('ふぁ…おはよう！'); }
  } else {
    p.energy = clamp(p.energy - (night ? 0.08 : 0.04) * dt);
    if (night && p.energy < 50) { p.asleep = true; toast('夜なので、うとうと…ねてしまった'); }
  }
  if (p.hunger > 30 && p.mood > 30) grow(0.015 * dt * (p.asleep ? 1.5 : 1));
}

// ブラウザを閉じていた間：控えめに育つ（最大12時間ぶん・成長ポイントは最大24）
function away(realSec) {
  const eff = Math.min(realSec * SPEED, MAX_AWAY_H * 3600);
  if (eff < 60) return;
  const h = eff / 3600, p = pet;
  const gain = h * AWAY_GROW_PER_H * (p.hunger > 20 ? 1 : 0.5);
  p.hunger = Math.max(10, p.hunger - h * 4);
  p.mood = Math.max(20, p.mood - h * 3);
  if (h >= 2) p.energy = Math.max(p.energy, 70);
  if (p.asleep && !isNight()) p.asleep = false;
  grow(gain);
  const label = h < 1 ? `${Math.round(h * 60)}分` : `${h.toFixed(1)}時間`;
  toast(`${label}ぶん、るすばんしていたよ。ちょっとだけ育った（+${gain.toFixed(1)}）`, 5000);
}

let last = Date.now();
function step() {
  const now = Date.now();
  const realSec = (now - last) / 1000;
  last = now;
  if (realSec <= 0) return;
  if (realSec > 45) away(realSec);           // タブが長く止まっていた＝閉じていたのと同じ扱い
  else {
    let dt = realSec * SPEED;
    while (dt > 0) { const d = Math.min(dt, 2); sim(d); dt -= d; }
  }
  checkEvolve();
  render();
}

// ---------- 会話 ----------
const WHO = { n: '', granny: 'となりのおばあさん' };
function talk(lines) {
  return new Promise(resolve => {
    const box = $('talk');
    let i = 0;
    const show = () => {
      const l = lines[i];
      $('talk-who').textContent = l.who === 'kid' ? `「${pet.form}」` : (l.who in WHO ? WHO[l.who] : l.who);
      $('talk-text').textContent = l.text;
    };
    const next = () => {
      if (++i >= lines.length) { box.hidden = true; box.onclick = null; document.removeEventListener('keydown', onKey); resolve(); } else show();
    };
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } };
    box.hidden = false; box.onclick = next; document.addEventListener('keydown', onKey);
    show();
  });
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- 進化・卒業 ----------
const EVO_MS = 1700;
let evoAnim = null;             // { from, to, t0 }

async function checkEvolve() {
  if (busy) return;
  const need = needOf(pet.form);
  if (pet.growth < need) return;
  if (isFinal(pet.form)) { pet.ready = true; pet.growth = need; return; }
  busy = true;
  try { await evolve(nextForm(pet.form, pet.feeds)); } finally { busy = false; render(); }
}

async function evolve(to) {
  const from = pet.form;
  pet.asleep = false;
  evoAnim = { from, to, t0: performance.now() };
  spawnSparks(0.5, 0.45, 26, ACCENT);
  await new Promise(r => setTimeout(r, EVO_MS));
  const firstEver = !save.dex[to];
  pet.form = to; pet.path.push(to); pet.growth = 0; pet.feeds = {}; pet.ready = false;
  pet.mood = clamp(pet.mood + 12);
  save.dex[to] = save.dex[to] || Date.now();
  evoAnim = null;
  persist(); render();
  await talk(evolveTalk(from, to, FORMS[to], firstEver));
  persist();
}

async function graduate() {
  if (busy) return;
  busy = true;
  const ch = pet.form;
  await talk(endingTalk(ch, FORMS[ch]));
  save.grads[ch] = (save.grads[ch] || 0) + 1;
  save.dex[ch] = save.dex[ch] || Date.now();
  const days = Math.max(1, Math.ceil((Date.now() - pet.born) / 86400000));
  const n = pet.path.length;
  pet = newPet();
  save.dex[START] = save.dex[START] || Date.now();
  persist(); busy = false; render();
  toast(`「${ch}」は旅立った（${n}回進化・${days}日目）。また一から育てよう。ずかんに残ったよ`, 6000);
}

async function restart() {
  closePanels();
  if (busy) return;
  if (pet.ready) return graduate();
  if (!confirm('まだ育ちきっていません。いまの字をあきらめて「一」から育て直しますか？\n（ずかんは残ります）')) return;
  pet = newPet(); persist(); render();
  toast('新しい「一」が庭に落ちていた。');
}

// ---------- お世話 ----------
function feed(key) {
  if (busy) return;
  const f = FEEDS[key], p = pet;
  if (p.asleep) return toast('ぐっすり ねている。そっとしておこう（おこすなら「おこす」）');
  if (p.hunger >= 95) return toast('おなかいっぱい！ もう食べられないって。');
  p.hunger = clamp(p.hunger + f.satiety);
  p.mood = clamp(p.mood + f.mood);
  p.energy = clamp(p.energy + f.energy);
  p.feeds[key] = (p.feeds[key] || 0) + 1;
  p.fed++;
  grow(f.grow * (0.8 + p.mood / 250));
  flyFood(f.ch);
  anim.munch = 1;
  toast(f.msg, 1600);
  persist(); render(); checkEvolve();
}

function play() {
  if (busy) return;
  const p = pet;
  if (p.asleep) return toast('すやすや…。いまは あそべないよ。');
  if (p.energy < 10) return toast('つかれちゃった…。ねかせてあげよう。');
  p.mood = clamp(p.mood + 12); p.energy = clamp(p.energy - 8); p.hunger = clamp(p.hunger - 2);
  grow(2);
  anim.hops = 3; anim.hopT = 0;
  spawnHearts(5);
  toast('ぴょんぴょん！ たのしそう！', 1600);
  persist(); render(); checkEvolve();
}

let tapCool = 0;
function tapPet() {
  if (busy) return;
  if (pet.asleep) { toast('すやすや…', 1200); return; }
  const now = performance.now();
  if (now - tapCool < 250) return;
  tapCool = now;
  pet.mood = clamp(pet.mood + 3); pet.energy = clamp(pet.energy - 1);
  grow(0.4);
  anim.squash = 1;
  spawnHearts(1);
  render();
}

function sleepToggle() {
  if (busy) return;
  const p = pet;
  if (p.asleep) {
    p.asleep = false;
    if (p.energy < 60) { p.mood = clamp(p.mood - 5); toast('まだ ねむいのに…。ふぁ。', 2000); } else toast('ふぁ…おはよう！');
  } else {
    if (p.energy >= 95 && !isNight()) return toast('まだ げんきいっぱい。ねむくないって！');
    p.asleep = true; toast('おやすみ…', 1600);
  }
  persist(); render();
}

// ---------- 画面の更新 ----------
function render() {
  const p = pet, need = needOf(p.form), f = FORMS[p.form];
  $('b-hunger').style.width = p.hunger + '%';
  $('b-mood').style.width = p.mood + '%';
  $('b-energy').style.width = p.energy + '%';
  const pct = Math.min(1, p.growth / need);
  $('b-grow').style.width = pct * 100 + '%';
  $('grow-lab').textContent = isFinal(p.form) ? '旅立ち' : '成長';
  $('grow-num').textContent = `${Math.floor(Math.min(p.growth, need))}/${need}`;
  $('form-ch').textContent = p.form;
  $('form-meta').textContent = `${f.n}画${isFinal(p.form) ? '・りっぱな字' : ''}`;
  $('graduate').hidden = !p.ready;
  const sl = $('sleep');
  sl.textContent = p.asleep ? 'おこす' : 'ねる';
  document.querySelectorAll('.feed').forEach(b => {
    const n = p.feeds[b.dataset.key] || 0;
    b.querySelector('.n').textContent = n ? '×' + n : '';
  });
  const h = $('history');
  h.innerHTML = p.path.slice(-9).map((c, i, a) => `<span class="h${i === a.length - 1 ? ' cur' : ''}">${c}</span>`).join('<span class="arrow">›</span>');
  const k = Object.keys(save.dex).length;
  $('dex-count').textContent = `${k}/${FORM_LIST.length}`;
  $('hint').textContent =
    p.ready ? '旅立ちの日が来た！ 「旅立たせる」をタップ' :
    p.asleep ? 'すやすや…' :
    p.hunger < 25 ? 'おなかが すいているみたい' :
    p.mood < 30 ? 'きげんが わるそう…あそんであげよう' :
    'タップでじゃれる ・ エサのかたよりで進化がかわる';
}

// ---------- 描画（Canvas 2D） ----------
const canvas = $('stage'), ctx = canvas.getContext('2d');
let W = 320, H = 240;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  W = r.width || 320; H = r.height || 240;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);

const anim = { hops: 0, hopT: 0, squash: 0, munch: 0, idle: 3, blink: 2, bornT: 0 };
const parts = [];
let mouth = { x: 160, y: 150 };
const rnd = (a, b) => a + Math.random() * (b - a);

function spawnHearts(n) {
  for (let i = 0; i < n; i++) parts.push({ type: 'heart', x: W * rnd(0.38, 0.62), y: H * rnd(0.3, 0.5), vx: rnd(-20, 20), vy: rnd(-60, -35), life: 1.2, max: 1.2, s: rnd(9, 15), color: '#ff5d8f' });
}
function spawnSparks(fx, fy, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(60, 190);
    parts.push({ type: 'spark', x: W * fx, y: H * fy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, max: 1, s: rnd(3, 6), color });
  }
}
function flyFood(ch) {
  parts.push({ type: 'food', ch, x0: W * rnd(0.3, 0.7), y0: -10, life: 0.65, max: 0.65 });
}

function updateAnim(dt) {
  anim.squash = Math.max(0, anim.squash - dt * 3.2);
  anim.munch = Math.max(0, anim.munch - dt * 2.2);
  if (anim.hops > 0) { anim.hopT += dt; if (anim.hopT >= 0.45) { anim.hopT = 0; anim.hops--; } }
  anim.idle -= dt;
  if (anim.idle <= 0) { anim.idle = rnd(3, 6); if (pet.mood > 75 && !pet.asleep && anim.hops <= 0) { anim.hops = 1; anim.hopT = 0; } }
  anim.blink -= dt;
  if (anim.blink < -0.14) anim.blink = rnd(2.5, 5);
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    if (q.type === 'food') {
      if (q.life <= 0) { spawnSparks(mouth.x / W, mouth.y / H, 6, '#ffd24a'); parts.splice(i, 1); continue; }
      const u = 1 - q.life / q.max;
      q.x = q.x0 + (mouth.x - q.x0) * u; q.y = q.y0 + (mouth.y - q.y0) * u * u;
    } else {
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.type === 'spark') q.vy += 120 * dt;
    }
  }
}

function heartPath(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.5, y - s, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.5, y - s, x + s, y - s * 0.3, x, y + s * 0.35);
  ctx.closePath();
}

function drawBackground(t) {
  const night = isNight();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (night) { g.addColorStop(0, '#46538f'); g.addColorStop(1, '#8d91c7'); } else { g.addColorStop(0, '#9fd3f2'); g.addColorStop(1, '#e6f4fb'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (night) {
    ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(W * 0.82, H * 0.2, 16, 0, 7); ctx.fill();
    ctx.fillStyle = '#505c99'; ctx.beginPath(); ctx.arc(W * 0.82 + 7, H * 0.2 - 3, 14, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 14; i++) { const x = (i * 97 % 100) / 100 * W, y = (i * 53 % 50) / 100 * H; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + i); ctx.fillRect(x, y, 2, 2); }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#ffd966'; ctx.beginPath(); ctx.arc(W * 0.85, H * 0.2, 18, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    const cx = (t * 6) % (W + 120) - 60;
    ctx.beginPath(); ctx.ellipse(cx, H * 0.2, 36, 11, 0, 0, 7); ctx.ellipse(cx + 22, H * 0.2 - 8, 22, 10, 0, 0, 7); ctx.fill();
  }
  const gy = H * 0.76;
  ctx.fillStyle = night ? '#4b7a5c' : '#8bcf7a'; ctx.fillRect(0, gy, W, H - gy);
  ctx.fillStyle = night ? '#3c6650' : '#76bd66'; ctx.fillRect(0, gy, W, 4);
  return gy;
}

function eye(x, y, r, mode, look) {
  ctx.lineCap = 'round';
  if (mode === 'closed' || mode === 'happy') {
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (mode === 'happy') ctx.arc(x, y + r * 0.3, r * 0.75, Math.PI * 1.1, Math.PI * 1.9); else { ctx.moveTo(x - r * 0.8, y); ctx.lineTo(x + r * 0.8, y); }
    ctx.stroke();
    return;
  }
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 7); ctx.fill();   // 黒い線の上でも見えるように白いふち
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x + look, y + 1, r * 0.55, 0, 7); ctx.fill();
}

function drawPet(t, gy) {
  const p = pet;
  const S = Math.min(W * 0.58, H * 0.7);       // 1em の大きさ（css px）
  const k = S / EM;
  const asleep = p.asleep;
  const show = (ch, color, alpha, extraScale) => {
    const bm = glyphBitmap(ch, color);
    const w = bm ? bm.w * k : S * 0.7, h = bm ? bm.h * k : S * 0.7;
    const breath = Math.sin(t * (asleep ? 1.2 : 2.4));
    let sx = 1 - 0.014 * breath + 0.12 * anim.squash, sy = 1 + 0.03 * breath - 0.18 * anim.squash;
    const mun = anim.munch * Math.sin(anim.munch * 18) * 0.06;
    sx -= mun; sy += mun;
    let hop = 0;
    if (anim.hops > 0) hop = -Math.abs(Math.sin(anim.hopT / 0.45 * Math.PI)) * S * 0.2;
    const x = W / 2, yb = gy + 8 + hop;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, yb);
    if (asleep) ctx.rotate(Math.sin(t * 0.8) * 0.03);
    ctx.scale(sx * extraScale, sy * extraScale);
    if (bm) ctx.drawImage(bm.cv, -BMP * k / 2, -h / 2 - BMP * k / 2, BMP * k, BMP * k);
    else { ctx.font = `900 ${S * 0.8}px MojiUI, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(ch, 0, -S * 0.1); }
    ctx.restore();
    return { w, h, yb, hop, sx, sy };
  };
  // 影
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.beginPath(); ctx.ellipse(W / 2, gy + 10, S * 0.36 * (anim.hops > 0 ? 0.8 : 1), 8, 0, 0, 7); ctx.fill();

  let info;
  if (evoAnim) {
    const u = Math.min(1, (performance.now() - evoAnim.t0) / EVO_MS);
    const mix = Math.max(0, Math.min(1, (u - 0.35) / 0.3));
    const shake = u < 0.45 ? Math.sin(u * 90) * 3 * (u / 0.45) : 0;
    ctx.save(); ctx.translate(shake, 0);
    const glow = Math.sin(Math.min(1, u / 0.6) * Math.PI) * 0.9;
    const rg = ctx.createRadialGradient(W / 2, gy - S * 0.3, 5, W / 2, gy - S * 0.3, S * 0.75);
    rg.addColorStop(0, `rgba(255,255,255,${glow})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    if (mix < 1) show(evoAnim.from, INK, 1 - mix, 1 + u * 0.1);
    info = show(evoAnim.to, u < 0.8 ? ACCENT : INK, mix, 0.9 + 0.1 * mix + (u > 0.55 ? Math.sin((u - 0.55) * 14) * 0.03 * (1 - u) : 0));
    ctx.restore();
    if (Math.random() < 0.5) spawnSparks(0.5, 0.4, 1, ACCENT);
  } else {
    info = show(p.form, INK, 1, 1);
  }
  // 顔（白い目＋口）
  const cy = info.yb - info.h * info.sy / 2;
  const ex = Math.max(S * 0.07, Math.min(info.w * 0.22, S * 0.16));
  const r = Math.max(6, S * 0.042);
  const ey = cy - info.h * info.sy * 0.1;
  const blink = anim.blink < 0;
  const mode = asleep ? 'closed' : blink ? 'closed' : (p.mood > 85 ? 'happy' : 'open');
  const look = Math.sin(t * 0.7) * r * 0.3;
  if (!evoAnim || (performance.now() - evoAnim.t0) / EVO_MS > 0.6) {
    eye(W / 2 - ex, ey, r, mode, look); eye(W / 2 + ex, ey, r, mode, look);
    const my = ey + r * 2.3;
    mouth = { x: W / 2, y: my };
    ctx.lineCap = 'round';
    for (const [col, lw] of [['#fffaf0', 6], [INK, 2.6]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      if (anim.munch > 0.05) ctx.ellipse(W / 2, my, r * 0.8, r * (0.4 + anim.munch * 0.5), 0, 0, 7);
      else if (asleep) { ctx.moveTo(W / 2 - r * 0.5, my); ctx.lineTo(W / 2 + r * 0.5, my); }
      else if (p.mood > 50) ctx.arc(W / 2, my - r * 0.5, r * 0.9, 0.2 * Math.PI, 0.8 * Math.PI);
      else if (p.mood > 25) { ctx.moveTo(W / 2 - r * 0.7, my); ctx.lineTo(W / 2 + r * 0.7, my); }
      else ctx.arc(W / 2, my + r * 0.9, r * 0.8, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
    }
  }
  // ねむりの z
  if (asleep) {
    ctx.font = `900 ${Math.round(S * 0.1)}px MojiUI, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      const u = ((t * 0.5 + i / 3) % 1);
      ctx.globalAlpha = 1 - u;
      ctx.fillText('z', W / 2 + S * 0.25 + u * 24, cy - S * 0.2 - u * 50);
    }
    ctx.globalAlpha = 1;
  }
}

function drawParts() {
  for (const q of parts) {
    if (q.type === 'heart') { ctx.globalAlpha = Math.min(1, q.life / q.max * 1.5); ctx.fillStyle = q.color; heartPath(q.x, q.y, q.s); ctx.fill(); }
    else if (q.type === 'spark') { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 7); ctx.fill(); }
    else if (q.type === 'food') {
      ctx.globalAlpha = 1; ctx.font = '900 34px MojiUI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = '#fffaf0'; ctx.strokeText(q.ch, q.x, q.y);
      ctx.fillStyle = INK; ctx.fillText(q.ch, q.x, q.y);
    }
  }
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
}

let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  updateAnim(dt);
  const t = ts / 1000;
  const gy = drawBackground(t);
  drawPet(t, gy);
  drawParts();
}

// ---------- ずかん（進化図） ----------
function treeHtml() {
  const seen = new Set();
  const chip = (ch, cls = '') => {
    const known = !!save.dex[ch];
    const c = [known ? '' : 'unk', cls, save.grads[ch] ? 'grad' : '', ch === pet.form ? 'cur' : ''].filter(Boolean).join(' ');
    return `<button class="chip ${c}" data-ch="${ch}" aria-label="${known ? ch : '未発見'}">${known ? ch : '？'}</button>`;
  };
  const walk = (ch, by, parentKnown) => {
    const first = !seen.has(ch);
    seen.add(ch);
    const hint = by && parentKnown ? `<span class="by"><b>${FEEDS[by].ch}</b>→</span>` : '';
    let html = `<li><span class="node">${hint}${chip(ch, first ? '' : 'ref')}</span>`;
    if (first && EVO[ch] && save.dex[ch]) html += '<ul>' + EVO[ch].map(e => walk(e.to, e.by, !!save.dex[ch])).join('') + '</ul>';
    return html + '</li>';
  };
  return '<ul>' + walk(START, null, true) + '</ul>';
}
function openDex() {
  $('tree').innerHTML = treeHtml();
  $('dex-count2').textContent = `${Object.keys(save.dex).length}/${FORM_LIST.length}`;
  $('dex-detail').textContent = '字をタップすると くわしく見られるよ。金のふちは、卒業させた字。';
  $('dex').hidden = false;
}
function showDetail(ch) {
  const f = FORMS[ch], el = $('dex-detail');
  if (!save.dex[ch]) { el.textContent = 'まだ見つけていない字。エサのかたよりをかえて育ててみよう。'; return; }
  const kids = (EVO[ch] || []).map(e => `${FEEDS[e.by].ch}→${save.dex[e.to] ? e.to : '？'}`).join('　');
  const g = save.grads[ch] ? `　卒業 ${save.grads[ch]}回` : '';
  el.innerHTML = '';
  const b = document.createElement('b'); b.textContent = ch;
  el.append(b, ` ${f.n}画${g}`, document.createElement('br'), f.note);
  if (kids) { el.append(document.createElement('br'), `進化先：${kids}`); } else { el.append(document.createElement('br'), 'ここが終点。立派に育った字。'); }
}
function closePanels() { $('dex').hidden = true; $('menu').hidden = true; }

// ---------- 起動 ----------
async function loadFont() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf.slice(0));
  try { document.fonts.add(await new FontFace('MojiUI', buf).load()); } catch { /* 無くても system のフォントで表示される */ }
}

function setup() {
  const fe = $('feeds');
  for (const key of FEED_KEYS) {
    const f = FEEDS[key];
    const b = document.createElement('button');
    b.className = 'feed'; b.dataset.key = key;
    b.innerHTML = `<span class="n"></span><span class="c">${f.ch}</span><span class="l">${f.label}</span>`;
    b.onclick = () => feed(key);
    fe.append(b);
  }
  $('play').onclick = play;
  $('sleep').onclick = sleepToggle;
  $('graduate').onclick = graduate;
  $('stage').addEventListener('pointerdown', tapPet);
  $('open-dex').onclick = openDex;
  $('dex-close').onclick = closePanels;
  $('open-menu').onclick = () => { $('menu').hidden = false; };
  $('menu-close').onclick = closePanels;
  $('m-restart').onclick = restart;
  $('m-wipe').onclick = () => {
    if (!confirm('育てた字もずかんも、すべて消えます。よろしいですか？')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    save.lastSeen = Date.now(); location.reload();
  };
  $('tree').onclick = e => { const c = e.target.closest('.chip'); if (c) showDetail(c.dataset.ch); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else step(); });
  addEventListener('pagehide', persist);
  if (SPEED > 1) $('fast-badge').hidden = false;
  // テスト用の窓口は ?fast のときだけ
  if (SPEED > 1) window.__sodate = { get pet() { return pet; }, save, step, sim, get busy() { return busy; }, grow, away, persist, render, anim };
  resize();
  requestAnimationFrame(frame);
}

async function start() {
  try { await loadFont(); } catch (e) {
    console.warn('font load failed', e);
    toastLater = 'フォントを読みこめなかったので、かんたん表示で動いています（ネットワークを確認してね）';
  }
  setup();
  $('loading').hidden = true;
  // 前回から閉じていた時間ぶんを反映
  const gone = (Date.now() - save.lastSeen) / 1000;
  last = Date.now();
  if (save.storyDone && gone > 60) { away(gone); persist(); }
  render();
  if (toastLater) toast(toastLater, 6000);
  setInterval(step, 500);
  setInterval(persist, 5000);
  if (!save.storyDone) {
    busy = true;
    await talk(PROLOGUE);
    save.storyDone = true; busy = false; persist(); render();
  }
}
let toastLater = '';
start();
