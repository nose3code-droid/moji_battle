// 文字ドミノ：画面・操作・進行・演出（物理は physics.js、面は levels.js、解は solutions.js）
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { LEVELS } from './levels.js';
import { SOLUTIONS } from './solutions.js';
import { Sim, makeShape, DT, isTool, IDLE_LIMIT, overlapping } from './physics.js';
import * as snd from './audio.js';

const SAVE_KEY = 'moji_domino.stars';
const $ = id => document.getElementById(id);
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const KIND_COLOR = { slender: '#e8590c', wobbly: '#ae3ec9', block: '#3b5bdb', wide: '#e67700', roll: '#099268', flat: '#868e96', plain: '#5c7080' };
const TOOL_INFO = {
  '@ball': { icon: '●', name: 'ボール', note: '置いた所から、押されると転がる重い玉（鐘は鳴らせない）' },
  '@plank': { icon: '▬', name: '板', note: '穴や谷にかけて、橋にする' },
  '@spring': { icon: '≋', name: 'バネ', note: '乗ったものを、ぽんと弾き飛ばす' },
  '@balloon': { icon: '◍', name: '風船', note: 'スタートでふわっと流れ出して、字のてっぺんをそっと押す' },
};
const Y_BOTTOM = -0.2;      // 画面の下端（m）。上端は面ごとに決まる

// ---------- 進行状況（面ごとの星） ----------
function loadStars() {
  try { const a = JSON.parse(localStorage.getItem(SAVE_KEY)); if (Array.isArray(a)) return LEVELS.map((_, i) => Math.max(0, Math.min(3, a[i] | 0))); } catch { /* 無ければ初期状態 */ }
  return LEVELS.map(() => 0);
}
let best = loadStars();
function saveStars() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(best)); } catch { /* 保存できなくても遊べる */ } }
const unlocked = i => i === 0 || best[i - 1] > 0;

// ---------- 読み込み ----------
await RAPIER.init();
let font = null, loadError = '';
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error('font ' + res.status);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf);
  try { document.fonts.add(await new FontFace('MojiDomino', buf).load()); } catch { /* 札の字は代わりのフォントになる */ }
} catch (e) {
  loadError = 'フォントを読み込めませんでした（ネットワークを確認してください）';
  console.error(e);
}
const shapes = new Map();
function shapeOf(ch) {
  if (!shapes.has(ch) && font) shapes.set(ch, makeShape(font, ch));
  return shapes.get(ch);
}

// ---------- 状態 ----------
const canvas = $('view'), ctx = canvas.getContext('2d');
let mode = 'select';        // select | edit | run | cleared | failed
let idx = 0, lv = LEVELS[0];
let hand = [], slotHand = [], selected = -1, infoCard = -1;
let sim = null, acc = 0, speed = 1, last = performance.now();
let hintUntil = 0, endTimer = 0, ringAt = -1;
let parts = [], ripples = [];
let drag = null;            // { hi, x, y, moved }
let sc = 30, ox = 0, oy = 0, dpr = 1;

const placedCard = i => (slotHand[i] >= 0 ? hand[slotHand[i]] : null);
const placement = () => lv.slots.map((_, i) => placedCard(i));
const glyphCount = () => placement().filter(c => c && !isTool(c)).length;
const accepts = (sl, card) => (sl.kind ?? 'glyph') === 'glyph' ? !isTool(card) : card === '@' + sl.kind;
const slotCenter = sl => {
  const k = sl.kind;
  return k ? { x: sl.x, y: sl.cy ?? sl.y + (k === 'balloon' || k === 'ball' ? 0.2 : 0.1) } : { x: sl.x, y: sl.y + 0.5 };
};

function toast(t, ms = 1600) {
  const m = $('msg'); m.textContent = t;
  clearTimeout(toast.t); toast.t = setTimeout(() => { m.textContent = ''; }, ms);
}
const banner = (t, warn = false) => { const b = $('banner'); b.textContent = t; b.classList.toggle('warn', warn); };

// ---------- 面の読み込み ----------
function loadLevel(i) {
  if (sim) { sim.free(); sim = null; }
  idx = i; lv = LEVELS[i];
  hand = lv.hand.slice();
  slotHand = lv.slots.map(() => -1);
  selected = -1; infoCard = -1; hintUntil = 0; parts = []; ripples = []; ringAt = -1;
  clearTimeout(endTimer);
  for (const c of [...hand, ...lv.fixed.map(f => f.ch)]) if (!isTool(c) && !shapeOf(c)) console.error('字の形を作れません:', c);
  mode = 'edit';
  $('lv-name').textContent = `${i + 1}. ${lv.name}`;
  for (const id of ['select', 'result']) $(id).hidden = true;
  renderTray(); updateInfo(); updateGo(); layout();
  banner(lv.note ?? '点線の場所に札を置いて、スタート！');
}
function restart() {
  if (!lv) return;
  loadLevel(idx);
}
function stopRun() {
  if (sim) { sim.free(); sim = null; }
  clearTimeout(endTimer);
  mode = 'edit'; ripples = []; parts = []; ringAt = -1;
  banner(lv.note ?? '点線の場所に札を置いて、スタート！');
  updateGo();
}

// ---------- 札 ----------
function cardHTML(c, hi) {
  const used = slotHand.includes(hi);
  if (isTool(c)) {
    const t = TOOL_INFO[c];
    return `<button class="card-btn tool${used ? ' used' : ''}${selected === hi ? ' on' : ''}" data-hi="${hi}"><span class="g" style="font-size:30px">${t.icon}</span><span class="tag" style="background:#1971c2">${t.name}</span><span class="st">道具</span></button>`;
  }
  const s = shapeOf(c), tr = s?.trait;
  if (!tr) return `<button class="card-btn${used ? ' used' : ''}" data-hi="${hi}"><span class="g">${c}</span></button>`;
  return `<button class="card-btn${used ? ' used' : ''}${selected === hi ? ' on' : ''}" data-hi="${hi}"><span class="g">${c}</span>` +
    `<span class="tag" style="background:${KIND_COLOR[tr.kind]}">${tr.label}</span>` +
    `<span class="st">${tr.roll ? '倒 ころがる' : '倒 ' + stars(tr.tip)}<br>重 ${stars(tr.heavy)}</span></button>`;
}
function renderTray() {
  $('tray').innerHTML = hand.map(cardHTML).join('');
  layout();
}
function updateInfo() {
  const el = $('card-info'), hi = infoCard >= 0 ? infoCard : selected;
  if (hi < 0) { el.innerHTML = '札をえらんで点線の場所へ（ドラッグでもOK）。置いた札は、タップで戻せる。'; return; }
  const c = hand[hi];
  if (isTool(c)) { const t = TOOL_INFO[c]; el.innerHTML = `<b>${t.icon} ${t.name}</b>　${t.note}`; return; }
  const tr = shapeOf(c)?.trait;
  if (!tr) { el.textContent = c; return; }
  const mass = tr.mass < 0.12 ? '軽い' : tr.mass < 0.2 ? 'やや軽い' : tr.mass < 0.3 ? 'ふつう' : tr.mass < 0.4 ? '重い' : 'とても重い';
  el.innerHTML = `<b class="g">${c}</b>　<b style="color:${KIND_COLOR[tr.kind]}">${tr.label}</b>：${tr.note}<br>` +
    `高さ ${tr.reach.toFixed(2)}m　重さ ${mass}　${tr.roll ? '転がる' : '倒れやすさ ' + stars(tr.tip)}`;
}
function updateGo() {
  const go = $('go');
  go.disabled = !font;
  go.textContent = mode === 'run' || mode === 'cleared' || mode === 'failed' ? 'もどす' : 'スタート';
  go.classList.toggle('stop', mode !== 'edit');
}

// ---------- 置く・戻す ----------
function place(si, hi) {
  const sl = lv.slots[si], c = hand[hi];
  if (mode !== 'edit' || !accepts(sl, c)) return false;
  const was = slotHand.indexOf(hi);
  const next = placement(); if (was >= 0) next[was] = null; next[si] = c;
  if (!isTool(c) && overlapping(lv, next, shapes)) { toast('となりの字とぶつかって、置けない'); return false; }
  if (was >= 0) slotHand[was] = -1;
  slotHand[si] = hi;
  selected = -1; infoCard = hi;
  snd.unlock(); snd.pop();
  renderTray(); updateInfo();
  return true;
}
function unplace(si) {
  if (mode !== 'edit' || slotHand[si] < 0) return;
  slotHand[si] = -1; infoCard = -1;
  snd.unlock(); snd.pop();
  renderTray(); updateInfo();
}
// 画面の点に近い置き場。card を渡すと、その札を置ける置き場だけ見る（空きを優先）
function nearestSlot(px, py, card) {
  const wx = (px - ox) / sc, wy = (oy - py) / sc, reach = Math.max(0.85, 40 / sc);
  let bi = -1, bd = Infinity;
  lv.slots.forEach((sl, i) => {
    if (card && !accepts(sl, card)) return;
    const c = slotCenter(sl);
    const d = Math.hypot(wx - c.x, wy - c.y) + (card && slotHand[i] >= 0 ? 0.3 : 0);
    if (d < reach && d < bd) { bi = i; bd = d; }
  });
  return bi;
}

$('tray').addEventListener('pointerdown', e => {
  const b = e.target.closest('.card-btn');
  if (!b || mode !== 'edit') return;
  snd.unlock();
  const hi = +b.dataset.hi;
  drag = { hi, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
});
addEventListener('pointermove', e => {
  if (!drag) return;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.moved && Math.hypot(drag.x - drag.sx, drag.y - drag.sy) > 9) {
    drag.moved = true;
    const g = $('drag-ghost'); g.hidden = false;
    g.textContent = isTool(hand[drag.hi]) ? TOOL_INFO[hand[drag.hi]].icon : hand[drag.hi];
    g.classList.add('g');
    infoCard = drag.hi; updateInfo();
  }
  if (drag.moved) { const g = $('drag-ghost'); g.style.left = drag.x + 'px'; g.style.top = drag.y + 'px'; e.preventDefault?.(); }
});
function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag; drag = null;
  $('drag-ghost').hidden = true;
  if (cancel) return;
  if (d.moved) {
    const si = nearestSlot(d.x, d.y, hand[d.hi]);
    if (si >= 0) place(si, d.hi);
    return;
  }
  // タップ：置いてある札は戻す。そうでなければ選ぶ／選びなおす
  const used = slotHand.indexOf(d.hi);
  if (used >= 0) { unplace(used); return; }
  selected = selected === d.hi ? -1 : d.hi;
  infoCard = -1;
  renderTray(); updateInfo();
}
addEventListener('pointerup', e => endDrag(e, false));
addEventListener('pointercancel', e => endDrag(e, true));

canvas.addEventListener('pointerdown', e => {
  if (mode !== 'edit') return;
  snd.unlock();
  const si = nearestSlot(e.clientX, e.clientY, selected >= 0 ? hand[selected] : null);
  if (si < 0) { if (selected >= 0) { selected = -1; renderTray(); updateInfo(); } return; }
  if (selected >= 0 && accepts(lv.slots[si], hand[selected])) { place(si, selected); return; }
  if (slotHand[si] >= 0) unplace(si);
});

// ---------- ボタン ----------
$('go').addEventListener('click', () => {
  snd.unlock();
  if (mode === 'edit') startRun(); else stopRun();
});
$('reset').addEventListener('click', () => { snd.unlock(); restart(); });
$('hint').addEventListener('click', () => {
  snd.unlock();
  if (mode !== 'edit') stopRun();
  hintUntil = performance.now() + 2600;
  toast('ヒント：こんな置き方で鐘が鳴る', 2400);
});
$('levels').addEventListener('click', () => openSelect());
$('sound').addEventListener('click', () => { snd.unlock(); snd.setMuted(!snd.isMuted()); $('sound').classList.toggle('off', snd.isMuted()); });
$('sound').classList.toggle('off', snd.isMuted());
$('again').addEventListener('click', () => restart());
$('next').addEventListener('click', () => { if (idx + 1 < LEVELS.length) loadLevel(idx + 1); });
$('to-select').addEventListener('click', () => openSelect());

function openSelect() {
  if (sim && mode !== 'edit') stopRun();
  $('result').hidden = true;
  $('grid').innerHTML = LEVELS.map((l, i) =>
    `<button data-i="${i}" class="${best[i] ? 'done' : ''}" ${unlocked(i) ? '' : 'disabled'}><b>${i + 1}</b>${unlocked(i) ? l.name : '🔒'}<span class="s">${unlocked(i) ? '★'.repeat(best[i]) + '☆'.repeat(3 - best[i]) : ''}</span></button>`).join('');
  $('total').textContent = `星 ${best.reduce((a, b) => a + b, 0)} / ${LEVELS.length * 3}`;
  $('select').hidden = false;
}
$('grid').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && !b.disabled) { snd.unlock(); loadLevel(+b.dataset.i); }
});

// ---------- スタート ----------
function startRun() {
  if (!font) return;
  if (!glyphCount()) { toast('字を1つ以上、置いてね'); return; }
  if (sim) sim.free();
  sim = new Sim(RAPIER, lv, shapes, placement());
  acc = 0; mode = 'run'; selected = -1; hintUntil = 0; parts = []; ripples = []; ringAt = -1;
  banner('');
  renderTray(); updateInfo(); updateGo();
}

function finishClear() {
  const n = glyphCount(), par = SOLUTIONS[idx]?.par ?? n;
  const s = n <= par ? 3 : n <= par + 1 ? 2 : 1;
  const newBest = s > best[idx];
  if (newBest) { best[idx] = s; saveStars(); }
  $('stars').innerHTML = [1, 2, 3].map(k => `<span class="${k <= s ? '' : 'off'}">★</span>`).join('');
  $('result-title').textContent = '鐘が鳴った！';
  $('result-sub').innerHTML = `使った字：${n} 字（星3は ${par} 字）${newBest && s > 0 ? '<br>ベスト更新！' : ''}`;
  $('next').hidden = idx + 1 >= LEVELS.length;
  $('result').hidden = false;
}

// ---------- 描画 ----------
// 面の使う範囲だけを画面いっぱいに映す
function viewBox() {
  const xs = lv.slots.map(sl => sl.x);
  const x0 = Math.max(0, (lv.kick ? lv.kick.x - 0.9 : Math.min(...xs) - 1.2)), x1 = Math.min(lv.W, Math.max(lv.bell.x + 1.5, ...xs.map(x => x + 1.1)));
  const hs = lv.segs.map(sg => Math.max(sg[2], sg[3] ?? 0)).concat(lv.slots.map(sl => (sl.cy ?? sl.y) + 0.8));
  const yTop = Math.max(3.1, lv.bell.y + 1.3, ...hs);
  return { x0, x1, yTop };
}
function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const top = $('bar').offsetHeight + 34, bottom = $('dock').offsetHeight + 4;
  const aw = w - 12, ah = Math.max(80, h - top - bottom);
  const v = viewBox(), vw = v.x1 - v.x0, vh = v.yTop - Y_BOTTOM;
  sc = Math.min(aw / vw, ah / vh);
  ox = (w - vw * sc) / 2 - v.x0 * sc;
  const botY = top + (ah + vh * sc) / 2;
  oy = botY + Y_BOTTOM * sc;
}
addEventListener('resize', layout);

function pathPolys(c, polys) {
  c.beginPath();
  for (const { outer, holes } of polys) {
    for (const ring of [outer, ...holes]) {
      ring.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath();
    }
  }
}
function drawGlyph(c, shape, x, y, a, fill, stroke, alpha = 1) {
  c.save(); c.translate(x, y); c.rotate(a); c.globalAlpha = alpha;
  pathPolys(c, shape.polys);
  c.fillStyle = fill; c.fill('evenodd');
  if (stroke) { c.lineWidth = 1.6 / sc; c.strokeStyle = stroke; c.stroke(); }
  c.restore();
}
function drawShadow(c, shape, x, y, a, gy) {
  // 光は左上から：高いところほど右へ伸び、地面にぺたんと潰れた影
  c.save(); c.globalAlpha = 0.2; c.fillStyle = '#000'; c.beginPath();
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const { outer } of shape.polys) {
    outer.forEach((q, i) => {
      const px = x + q.x * ca - q.y * sa, py = y + q.x * sa + q.y * ca;
      const hh = Math.max(0, py - gy);
      const X = px + hh * 0.55, Y = gy + 0.02 + hh * 0.07;
      i ? c.lineTo(X, Y) : c.moveTo(X, Y);
    });
    c.closePath();
  }
  c.fill(); c.restore();
}

function drawBell(c, t) {
  const b = lv.bell, g = b.y - 0.6;   // g：鐘の下の地面
  // 柱と梁
  c.fillStyle = '#6d4c2b';
  c.fillRect(b.x + 0.55, g, 0.14, 1.75);
  c.fillRect(b.x - 0.05, g + 1.58, 0.79, 0.12);
  // 鐘は梁からぶら下がる（鳴ったあとは揺れる）
  const since = ringAt >= 0 ? (t - ringAt) / 1000 : -1;
  const sw = since >= 0 ? Math.sin(since * 14) * Math.exp(-since * 2.2) * 0.4 : 0;
  c.save(); c.translate(b.x + 0.05, g + 1.58); c.rotate(sw);
  const grad = c.createLinearGradient(-0.4, 0, 0.4, 0);
  grad.addColorStop(0, '#d9a406'); grad.addColorStop(0.5, '#ffe066'); grad.addColorStop(1, '#c58a00');
  c.fillStyle = grad; c.strokeStyle = '#8a6100'; c.lineWidth = 0.03;
  c.beginPath();
  c.moveTo(-0.06, -0.15);
  c.bezierCurveTo(-0.06, -0.55, -0.38, -0.6, -0.42, -1.05);
  c.lineTo(0.42, -1.05);
  c.bezierCurveTo(0.38, -0.6, 0.06, -0.55, 0.06, -0.15);
  c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = '#555'; c.lineWidth = 0.03; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -0.15); c.stroke();
  c.fillStyle = '#6b4b00'; c.beginPath(); c.arc(0, -1.1, 0.07, 0, 7); c.fill();
  c.restore();
}

function drawTerrain(c) {
  const W = lv.W;
  // 穴（地面のない所）はまっくらに
  const g = c.createLinearGradient(0, 0.8, 0, -0.6);
  g.addColorStop(0, '#5b4636'); g.addColorStop(1, '#1f1a17');
  c.fillStyle = '#6b5340';
  c.fillRect(-30, -30, W + 60, 30);   // 地面の下の土
  for (const sg of lv.segs) {
    const top = sg.length === 3 ? [sg[2], sg[2]] : [sg[2], sg[3]];
    const l = sg[0] <= 0 ? -30 : sg[0], r = sg[1] >= W ? W + 30 : sg[1];   // 両端は画面の外まで続ける
    c.beginPath(); c.moveTo(l, -30); c.lineTo(l, top[0]); c.lineTo(r, top[1]); c.lineTo(r, -30); c.closePath();
    c.fillStyle = '#8d6e4c'; c.fill();
    c.beginPath(); c.moveTo(l, top[0]); c.lineTo(r, top[1]);
    c.strokeStyle = '#5fa83a'; c.lineWidth = 0.14; c.lineCap = 'butt'; c.stroke();
  }
  // 穴の部分を暗く塗る
  const segs = lv.segs.slice().sort((a, b) => a[0] - b[0]);
  let prev = 0;
  for (const s of segs.concat([[W + 1, W + 2, 0]])) {
    if (s[0] > prev + 0.01) { c.fillStyle = g; c.fillRect(prev, -30, s[0] - prev, 31); }
    prev = Math.max(prev, s[1]);
  }
  // 板などの固定の装置は別（道具）
}

function pieceColor(shape, fixed) {
  if (fixed) return ['#6c757d', '#343a40'];
  const k = shape.trait.kind;
  return [KIND_COLOR[k] + 'dd', '#1b1b2b'];
}

function draw(t) {
  const w = innerWidth, h = innerHeight;
  const c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#bfe3f7'); sky.addColorStop(1, '#eaf6e6');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  // 遠くの丘
  c.fillStyle = '#cfe8cd';
  c.beginPath(); c.moveTo(0, oy - 0.6 * sc);
  for (let x = 0; x <= w; x += 20) c.lineTo(x, oy - (1.1 + 0.35 * Math.sin(x / 90) + 0.2 * Math.sin(x / 37)) * sc);
  c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();

  c.setTransform(dpr * sc, 0, 0, -dpr * sc, dpr * ox, dpr * oy);
  drawTerrain(c);
  drawBell(c, t);

  // 置き場（編集中）
  if (mode === 'edit') drawSlots(c, t);

  // 道具（固定のもの）
  lv.slots.forEach((sl, i) => {
    const card = placedCard(i);
    if (card === '@plank') drawPlank(c, sl);
    else if (card === '@spring') drawSpring(c, sl);
  });

  // 出発の棒
  drawKicker(c);

  // 字・ボール・風船
  const items = sim ? simItems() : staticItems();
  for (const it of items) if (it.kind === 'glyph') drawFallGhost(c, it);
  for (const it of items) if (it.kind === 'glyph') drawShadow(c, it.shape, it.x, it.y, it.a, it.gy);
  for (const it of items) drawItem(c, it, t);

  // ヒント
  if (t < hintUntil) drawHint(c, t);

  // ドラッグ中の見本（置き場に吸い付く）
  if (drag?.moved) drawDragPreview(c);

  // 砂ぼこりと鐘の波紋
  drawFx(c, t);
}

function drawSlots(c, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t / 220);
  const cardNow = drag?.moved ? hand[drag.hi] : selected >= 0 ? hand[selected] : null;
  lv.slots.forEach((sl, i) => {
    if (slotHand[i] >= 0 && !cardNow) return;
    const ok = cardNow && accepts(sl, cardNow);
    const empty = slotHand[i] < 0;
    if (!empty && !ok) return;
    c.save();
    c.lineWidth = 0.035; c.setLineDash([0.09, 0.07]);
    c.strokeStyle = ok ? `rgba(224,90,12,${0.7 + 0.3 * pulse})` : 'rgba(40,70,110,.55)';
    c.fillStyle = ok ? `rgba(255,170,90,${0.12 + 0.12 * pulse})` : 'rgba(255,255,255,.18)';
    const k = sl.kind;
    if (!k) {   // 置き場がこまかい面では、となりと重ならない幅にする
      const near = Math.min(...lv.slots.filter(o => o !== sl && !o.kind).map(o => Math.abs(o.x - sl.x)), 1);
      const hw = Math.min(0.42, near * 0.45);
      rr(c, sl.x - hw, sl.y, hw * 2, 1.0, Math.min(0.1, hw));
    }
    else if (k === 'plank') { c.save(); c.translate(sl.x, sl.y); c.rotate(sl.angle ?? 0); rr(c, -(sl.len ?? 2.2) / 2, -0.06, sl.len ?? 2.2, 0.12, 0.04); c.restore(); }
    else if (k === 'spring') { rr(c, sl.x - 0.5, sl.y - 0.2, 1, 0.2, 0.05); }
    else { c.beginPath(); c.arc(sl.x, sl.y + (k === 'ball' ? 0.3 : 0), k === 'ball' ? 0.3 : 0.36, 0, 7); }
    c.fill(); c.stroke();
    c.setLineDash([]);
    if (k) {   // 道具の置き場は印をつける
      c.save(); c.translate(sl.x, sl.y + 0.45); c.scale(1, -1);
      c.font = '0.3px system-ui'; c.textAlign = 'center'; c.fillStyle = 'rgba(40,70,110,.85)';
      c.fillText(TOOL_INFO['@' + k].name, 0, 0); c.restore();
    }
    c.restore();
  });
}
function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

function drawPlank(c, sl) {
  c.save(); c.translate(sl.x, sl.y); c.rotate(sl.angle ?? 0);
  const L = sl.len ?? 2.2;
  c.fillStyle = '#c28e4d'; c.strokeStyle = '#6b4a22'; c.lineWidth = 0.03;
  rr(c, -L / 2, -0.06, L, 0.12, 0.03); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(107,74,34,.5)'; c.lineWidth = 0.015;
  for (let x = -L / 2 + 0.3; x < L / 2; x += 0.3) { c.beginPath(); c.moveTo(x, -0.05); c.lineTo(x, 0.05); c.stroke(); }
  c.restore();
}
function drawSpring(c, sl) {
  c.save(); c.translate(sl.x, sl.y - 0.2);
  c.fillStyle = '#4c6ef5'; c.fillRect(-0.5, 0, 1, 0.06);
  c.strokeStyle = '#868e96'; c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.4, 0.06);
  for (let k = 0; k < 6; k++) c.lineTo(-0.4 + (k + 0.5) * 0.8 / 6 * 1, 0.06 + (k % 2 ? 0.04 : 0.16));
  c.lineTo(0.4, 0.14); c.stroke();
  c.fillStyle = '#e03131'; c.fillRect(-0.5, 0.18, 1, 0.07);
  c.restore();
}
function drawKicker(c) {
  if (!lv.kick) return;
  const k = lv.kick, p = sim ? sim.kick.translation() : { x: k.x, y: k.y };
  c.fillStyle = '#8d5524'; c.strokeStyle = '#4a2c0c'; c.lineWidth = 0.025;
  rr(c, p.x - k.w / 2, p.y - k.h / 2, k.w, k.h, 0.04); c.fill(); c.stroke();
  c.fillStyle = '#a9743a';
  c.fillRect(p.x - k.w / 2 - 2.4, p.y - 0.045, 2.4, 0.09);   // 持ち手
  c.fillStyle = '#6c757d'; c.fillRect(p.x - k.w / 2 - 2.5, p.y - 0.12, 0.1, 0.24);
}

function staticItems() {
  const items = [];
  lv.slots.forEach((sl, i) => {
    const card = placedCard(i);
    if (!card) return;
    if (!isTool(card)) {
      const shape = shapeOf(card);
      if (shape) items.push({ kind: 'glyph', shape, x: sl.x, y: sl.y + shape.h / 2, a: 0, gy: sl.y, slot: i });
    } else if (card === '@ball') items.push({ kind: 'ball', x: sl.x, y: sl.cy ?? sl.y + 0.3, a: 0, r: 0.3 });
    else if (card === '@balloon') items.push({ kind: 'balloon', x: sl.x, y: sl.y, a: 0, r: 0.36 });
  });
  lv.fixed.forEach((f, i) => {
    const shape = shapeOf(f.ch);
    if (shape) items.push({ kind: 'glyph', shape, x: f.x, y: f.y + shape.h / 2, a: 0, gy: f.y, slot: -1 - i, fixed: true });
  });
  return items;
}
function simItems() {
  return sim.poses().map(({ b, x, y, a }) => ({
    kind: b.kind, shape: b.shape, x, y, a, r: b.r, gy: b.gy ?? 1, slot: b.slot, fixed: b.slot < 0 && b.kind === 'glyph', b,
  }));
}

// 倒れた字のあとに、立っていた場所の輪郭を点線で残す
function drawFallGhost(c, it) {
  if (Math.abs(it.a) < 0.35 && Math.abs(it.x - (lv.slots[it.slot]?.x ?? it.x)) < 0.2) return;
  const sl = it.slot >= 0 ? lv.slots[it.slot] : lv.fixed[-1 - it.slot];
  if (!sl) return;
  c.save(); c.translate(sl.x, sl.y + it.shape.h / 2);
  pathPolys(c, it.shape.polys);
  c.setLineDash([0.06, 0.06]); c.lineWidth = 0.02; c.strokeStyle = 'rgba(40,40,70,.45)'; c.stroke();
  c.restore();
}

function drawItem(c, it, t) {
  if (it.kind === 'glyph') {
    const [fill, stroke] = pieceColor(it.shape, it.fixed);
    drawGlyph(c, it.shape, it.x, it.y, it.a, fill, stroke);
    // てっぺんの軌跡（倒れた跡）
    const b = it.b;
    if (b) {
      b.trail ??= [];
      const tip = { x: it.x - Math.sin(it.a) * it.shape.h / 2, y: it.y + Math.cos(it.a) * it.shape.h / 2 };
      const lastT = b.trail[b.trail.length - 1];
      if (!lastT || Math.hypot(tip.x - lastT.x, tip.y - lastT.y) > 0.04) { b.trail.push(tip); if (b.trail.length > 50) b.trail.shift(); }
      if (b.trail.length > 1 && Math.abs(it.a) > 0.15) {
        c.save(); c.lineWidth = 0.035; c.lineCap = 'round';
        for (let i = 1; i < b.trail.length; i++) {
          c.strokeStyle = `rgba(80,60,40,${0.38 * i / b.trail.length})`;
          c.beginPath(); c.moveTo(b.trail[i - 1].x, b.trail[i - 1].y); c.lineTo(b.trail[i].x, b.trail[i].y); c.stroke();
        }
        c.restore();
      }
    }
  } else if (it.kind === 'ball') {
    const g = c.createRadialGradient(it.x - 0.08, it.y + 0.08, 0.02, it.x, it.y, it.r);
    g.addColorStop(0, '#ffa8a8'); g.addColorStop(1, '#c92a2a');
    c.fillStyle = g; c.strokeStyle = '#5c0f0f'; c.lineWidth = 0.025;
    c.beginPath(); c.arc(it.x, it.y, it.r, 0, 7); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 0.03; c.beginPath(); c.arc(it.x, it.y, it.r * 0.6, it.a, it.a + 1.2); c.stroke();
  } else if (it.kind === 'balloon') {
    c.strokeStyle = '#555'; c.lineWidth = 0.015; c.beginPath(); c.moveTo(it.x, it.y - it.r); c.quadraticCurveTo(it.x - 0.1, it.y - it.r - 0.25, it.x - 0.02, it.y - it.r - 0.5); c.stroke();
    const g = c.createRadialGradient(it.x - 0.1, it.y + 0.12, 0.03, it.x, it.y, it.r);
    g.addColorStop(0, '#ffc9c9'); g.addColorStop(1, '#f03e3e');
    c.fillStyle = g; c.strokeStyle = '#8c1d1d'; c.lineWidth = 0.02;
    c.beginPath(); c.ellipse(it.x, it.y, it.r * 0.9, it.r, 0, 0, 7); c.fill(); c.stroke();
  }
}

function drawHint(c, t) {
  const sol = SOLUTIONS[idx]?.placement;
  if (!sol) return;
  const a = 0.35 + 0.25 * Math.sin(t / 120);
  sol.forEach((card, i) => {
    if (!card) return;
    const sl = lv.slots[i];
    if (!isTool(card)) {
      const s = shapeOf(card);
      if (s) drawGlyph(c, s, sl.x, sl.y + s.h / 2, 0, '#fab005', '#e67700', a + 0.2);
    } else {
      c.save(); c.globalAlpha = a + 0.2; c.fillStyle = '#1c7ed6';
      c.beginPath(); c.arc(sl.x, sl.y + 0.25, 0.25, 0, 7); c.fill(); c.restore();
      c.save(); c.translate(sl.x, sl.y + 0.55); c.scale(1, -1); c.font = '0.3px system-ui'; c.textAlign = 'center';
      c.fillStyle = '#1864ab'; c.fillText(TOOL_INFO[card].name, 0, 0); c.restore();
    }
  });
}

function drawDragPreview(c) {
  const card = hand[drag.hi], si = nearestSlot(drag.x, drag.y, card);
  if (si < 0 || isTool(card)) return;
  const sl = lv.slots[si], s = shapeOf(card);
  if (s) drawGlyph(c, s, sl.x, sl.y + s.h / 2, 0, '#ff922b', '#d9480f', 0.55);
}

function drawFx(c, t) {
  for (const p of parts) {
    c.globalAlpha = Math.max(0, p.life / p.max) * 0.6;
    c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r * (1.4 - p.life / p.max * 0.6), 0, 7); c.fill();
  }
  c.globalAlpha = 1;
  const b = lv.bell;
  for (const r of ripples) {
    const age = (t - r.t0) / 1000;
    if (age < 0 || age > 1.8) continue;
    c.strokeStyle = `rgba(245,176,2,${0.7 * (1 - age / 1.8)})`;
    c.lineWidth = 0.06 * (1 - age / 2);
    c.beginPath(); c.arc(b.x + 0.05, b.y + 0.2, 0.4 + age * 2.2, 0, 7); c.stroke();
  }
}

// ---------- 時間の進行 ----------
function dust(x, y, s) {
  const n = Math.min(7, 2 + Math.floor(s));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI;
    parts.push({ x: x + (Math.random() - 0.5) * 0.4, y: y + 0.03, vx: Math.cos(a) * (0.3 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), vy: 0.3 + Math.random() * 0.9,
      life: 0.55 + Math.random() * 0.3, max: 0.85, r: 0.05 + Math.random() * 0.07, col: '#b8a58c' });
  }
}
let lastTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (sim && mode === 'run') {
    acc += dt * speed;
    let n = 0;
    while (acc >= DT && !sim.result && n < 60) { sim.step(); acc -= DT; n++; }
    for (const e of sim.events) {
      dust(e.x, e.y, e.s);
      if (now - lastTick > 45) { snd.tick(e.s, 0.8 + (e.x * 0.37 % 0.5)); lastTick = now; }
    }
    sim.events.length = 0;
    if (sim.result === 'clear') {
      mode = 'cleared'; ringAt = now; snd.bell(); updateGo();
      for (let k = 0; k < 3; k++) ripples.push({ t0: now + k * 280 });
      banner('鐘が鳴った！');
      endTimer = setTimeout(finishClear, 1500 / Math.min(speed, 2));
    } else if (sim.result === 'fail') {
      mode = 'failed'; snd.buzz(); updateGo();
      banner(sim.failWhy === 'time' ? '時間切れ…' : '止まってしまった…', true);
      endTimer = setTimeout(() => { if (mode === 'failed') stopRun(); }, 1100);
    } else if (sim.idle > 1.2) {
      banner(`止まっている…あと ${Math.ceil(IDLE_LIMIT - sim.idle)} 秒`, true);
    } else banner('');
  }
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 0.8 * dt; p.vx *= 0.98; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  draw(now);
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
if (loadError) { toast(loadError, 60000); $('go').textContent = '読込失敗'; }
else $('go').textContent = 'スタート';
const firstOpen = Math.max(0, best.findIndex(s => s === 0));
loadLevel(best.every(s => s > 0) ? 0 : firstOpen);
if (!best.some(s => s > 0)) { /* はじめての人は、そのまま1面を遊べる */ } else openSelect();
updateGo();
requestAnimationFrame(frame);

// 検証用の口（?debug を付けたときだけ）。画面と同じ置き方・同じスタートを使う
if (location.search.includes('debug')) {
  window.__domino = {
    levels: LEVELS, solutions: SOLUTIONS, shapes, DT,
    mode: () => mode, index: () => idx, stars: () => best.slice(), glyphCount,
    load: loadLevel, place, unplace, startRun, stopRun, setSpeed: s => { speed = s; },
    hand: () => hand.slice(), slotHand: () => slotHand.slice(), slotsPx: () => lv.slots.map(sl => { const c0 = slotCenter(sl); return [ox + c0.x * sc, oy - c0.y * sc]; }),
    trayPx: hi => { const r = document.querySelector(`.card-btn[data-hi="${hi}"]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; },
    // 解どおりに札を置く（手札のうち、同じ札で未使用のものを順に使う）
    placeSolution: i => {
      const sol = SOLUTIONS[i].placement, usedH = new Set();
      sol.forEach((card, si) => {
        if (!card) return;
        const hi = hand.findIndex((c, k) => c === card && !usedH.has(k));
        usedH.add(hi); place(si, hi);
      });
    },
    // 物理だけを最後まで走らせる（画面なし）。{ result, time, fell: 各字が倒れたか }
    simulate: (placementList, steps = 6000) => {
      const s = new Sim(RAPIER, lv, shapes, placementList);
      for (let k = 0; k < steps && !s.result; k++) s.step();
      const fell = s.bodies.filter(b => b.kind === 'glyph' && b.slot >= 0).map(b => ({ ch: b.shape.ch, a: +b.body.rotation().toFixed(3), x: +b.body.translation().x.toFixed(3) }));
      const out = { result: s.result, time: +s.time.toFixed(3), fell };
      s.free(); return out;
    },
    traits: ch => shapeOf(ch)?.trait,
    simState: () => sim && { result: sim.result, time: sim.time, idle: sim.idle },
  };
}
