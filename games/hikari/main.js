// 光と闇のともしび：鏡で光をはねかえすパズル（Canvas 2D・CDN 不要）
// 文字は FontFace で Noto Sans JP を読み込み（届かなければシステムフォント）fillText で描く
import { FONT_URL } from '../../config.js';
import { LEVELS, ENDING } from './levels.js';
import { SOLUTIONS } from './solutions.js';
import { DIRS, parseLevel, simulate, isSolved, canPlace } from './engine.js';

// ---------- 定数 ----------
const SAVE_KEY = 'moji-hikari-save-v1';
const FONT_STACK = "'NotoJPHikari','Hiragino Sans','Yu Gothic','Noto Sans CJK JP','IPAGothic','WenQuanYi Zen Hei',sans-serif";
const STAR3_SLACK = 1, STAR2_SLACK = 4;     // 最短手数 + この手数以内なら星3 / 星2
const DRAG_PX = 8;                           // これ以上動かしたらタップではなくドラッグ
const CLEAR_SEC = 2.4;                       // クリア時に闇が晴れていく演出の長さ
const HINT_SEC = 1.8;                        // ヒントを見せる長さ
const SPEAKER_COLOR = { 光: '#ffe9a8', 闇: '#b79aff', 鏡: '#8fe8ff', 水: '#8fc4ff', 灯: '#ffb870', 半: '#ffa8d8' };
const QUERY = new URLSearchParams(location.search);
const DEBUG = QUERY.has('debug');

const $ = id => document.getElementById(id);
const cv = $('view'), ctx = cv.getContext('2d');
const fog = document.createElement('canvas'), fctx = fog.getContext('2d'); // 闇のもや用（半分の解像度）
const FOG_SCALE = 0.5;

// ---------- セーブ ----------
let save = { cleared: {}, best: {}, seen: {} }; // cleared[id]=星の数、best[id]=最少手数、seen[id]=会話を見た
function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (d && typeof d === 'object') save = { cleared: d.cleared || {}, best: d.best || {}, seen: d.seen || {} };
  } catch (e) { /* 保存データがなくても続行 */ }
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続行 */ } }
const maxCleared = () => LEVELS.reduce((m, l) => save.cleared[l.id] ? Math.max(m, l.id) : m, 0);
const isUnlocked = id => id <= maxCleared() + 1;
const starsFor = (moves, par) => moves <= par + STAR3_SLACK ? 3 : moves <= par + STAR2_SLACK ? 2 : 1;

// ---------- 状態 ----------
let mode = 'title';          // title | select | dialog | play | clearing | clear | ending
let levelIdx = 0, level = null, P = null;
let mirrors = [];            // [{x,y,o,turn,da,type,fixed, sx,sy,(表示位置)}]
let dissolved = new Set();   // 晴れた闇のマス番号
let dissolveAt = new Map();  // マス番号 → 晴れ始めた時刻
let result = null;           // simulate の結果
let moves = 0;
let clearT = 0;              // 0〜1：クリア演出の進み
let hintUntil = 0, hintsUsed = 0;
let drag = null;             // { m, ox, oy, px, py, moved, pid }
let dialog = null;           // { lines, i, done }
let reveal = 0;              // 闇が晴れている度合い（なめらかに追従）
let fogBlobs = [];
let now = 0;
let DPR = 1, VW = 0, VH = 0;
let cs = 60, ox = 0, oy = 0; // マスの大きさと盤面の左上

// ---------- 面の読み込み ----------
function loadLevel(idx) {
  levelIdx = idx; level = LEVELS[idx]; P = parseLevel(level);
  mirrors = level.mirrors.map(m => ({ ...m, turn: m.o, da: -m.o * Math.PI / 4, fixed: !!m.fixed }));
  dissolved = new Set(); dissolveAt = new Map();
  moves = 0; clearT = 0; hintUntil = 0; hintsUsed = 0; drag = null;
  reveal = 0.1;
  fogBlobs = Array.from({ length: 16 }, (_, i) => ({ u: Math.random(), v: Math.random(), r: 1.4 + Math.random() * 1.8, sp: 0.15 + Math.random() * 0.25, ph: Math.random() * 6.28 + i }));
  recompute(false);
  layout();
  $('lvname').textContent = `第${level.id}面　${level.title}`;
  $('goal').textContent = level.hint;
  updateMoves();
}

function updateMoves() {
  const par = SOLUTIONS[level.id].par;
  $('moves').innerHTML = `手数 <b>${moves}</b>　<small>★3は${par + STAR3_SLACK}手まで</small>`;
}

// 光線を計算し直す。新しく晴れた闇には時刻を記録（薄れていく演出用）
function recompute(animate = true) {
  const before = new Set(dissolved);
  result = simulate(P, mirrors, dissolved);
  for (const k of dissolved) if (!before.has(k)) dissolveAt.set(k, animate ? now : -99);
  if (animate && mode === 'play' && isSolved(P, result)) onSolved();
}

// ---------- 画面の出し分け ----------
function show(id, on) { $(id).hidden = !on; }
function setMode(m) {
  mode = m;
  const playing = m === 'play' || m === 'clearing' || m === 'dialog' || m === 'clear';
  show('bar', playing); show('tools', m === 'play' || m === 'clearing' || m === 'dialog'); show('goal', m === 'play');
  show('title', m === 'title'); show('select', m === 'select'); show('clear', m === 'clear'); show('ending', m === 'ending');
  show('dialog', m === 'dialog');
  layout(); // 上のバーの高さに合わせて盤面を置き直す
}

let selectFrom = 'title';
function openSelect() {
  selectFrom = mode === 'select' ? selectFrom : (mode === 'title' ? 'title' : 'play');
  const box = $('levels');
  box.innerHTML = '';
  for (const l of LEVELS) {
    const b = document.createElement('button');
    const st = save.cleared[l.id];
    b.disabled = !isUnlocked(l.id);
    b.innerHTML = `${l.id}<span class="st">${st ? '★'.repeat(st) + '☆'.repeat(3 - st) : (b.disabled ? '🔒' : '')}</span><small>${l.title}</small>`;
    b.onclick = () => startLevel(l.id - 1);
    box.appendChild(b);
  }
  setMode('select');
}

function startLevel(idx) {
  loadLevel(idx);
  if (!save.seen[level.id]) {
    save.seen[level.id] = true; writeSave();
    say(level.pre, () => setMode('play'));
  } else setMode('play');
}

// ---------- 会話 ----------
function say(lines, done) {
  dialog = { lines, i: 0, done };
  setMode('dialog');
  showLine();
}
function showLine() {
  const [who, text] = dialog.lines[dialog.i];
  const w = $('who');
  w.textContent = who; w.style.color = SPEAKER_COLOR[who] || '#c9b6ff';
  $('text').textContent = text;
}
function nextLine() {
  if (!dialog) return;
  if (++dialog.i < dialog.lines.length) { showLine(); return; }
  const d = dialog; dialog = null;
  d.done && d.done();
}

// ---------- クリア ----------
function onSolved() {
  const par = SOLUTIONS[level.id].par;
  const st = starsFor(moves, par);
  const first = !save.cleared[level.id];
  save.cleared[level.id] = Math.max(save.cleared[level.id] || 0, st);
  save.best[level.id] = Math.min(save.best[level.id] ?? 1e9, moves);
  writeSave();
  clearT = 0; drag = null;
  mode = 'clearing';
  clearInfo = { st, first, par };
}
let clearInfo = null;

function afterClearAnim() {
  const { first } = clearInfo;
  const last = level.id === LEVELS.length;
  const toPanel = () => {
    if (last) say(ENDING, () => { setMode('ending'); });
    else showClearPanel();
  };
  if (first) say(level.post, toPanel); else toPanel();
}

function showClearPanel() {
  const { st, par } = clearInfo;
  $('clear-stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= st ? '' : 'off'}">★</span>`).join('');
  $('clear-info').textContent = `手数 ${moves}（最短 ${par} 手）${st === 3 ? '　すばらしい！' : '　星3つは' + (par + STAR3_SLACK) + '手以内'}`;
  $('btn-next').hidden = levelIdx >= LEVELS.length - 1;
  setMode('clear');
}

// ---------- 入力 ----------
function cellAt(px, py) { return { x: Math.floor((px - ox) / cs), y: Math.floor((py - oy) / cs) }; }
function mirrorAtCell(c) { return mirrors.find(m => m.x === c.x && m.y === c.y); }
function pointerPos(e) { const r = cv.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }

cv.addEventListener('pointerdown', e => {
  if (mode !== 'play' || drag) return;
  const { px, py } = pointerPos(e);
  const m = mirrorAtCell(cellAt(px, py));
  if (!m) return;
  cv.setPointerCapture(e.pointerId);
  drag = { m, sx: px, sy: py, px, py, moved: false, pid: e.pointerId };
  e.preventDefault();
});
cv.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const { px, py } = pointerPos(e);
  drag.px = px; drag.py = py;
  if (!drag.moved && Math.hypot(px - drag.sx, py - drag.sy) > DRAG_PX) drag.moved = true;
});
function endDrag(e, cancel) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  if (cancel || mode !== 'play') return;
  const m = d.m;
  if (!d.moved) { // タップ：45°回転（+1）
    m.turn++; m.o = m.turn % 4; moves++;
  } else if (!m.fixed) {
    const c = cellAt(d.px, d.py);
    if ((c.x !== m.x || c.y !== m.y) && canPlace(P, mirrors, dissolved, c.x, c.y, m)) { m.x = c.x; m.y = c.y; moves++; }
  } else return; // 動かせない鏡をドラッグしても何も起きない
  updateMoves();
  recompute();
}
cv.addEventListener('pointerup', e => endDrag(e, false));
cv.addEventListener('pointercancel', e => endDrag(e, true));

$('dialog').addEventListener('click', nextLine);
addEventListener('keydown', e => {
  if (mode === 'dialog' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); nextLine(); }
  else if (mode === 'play' && (e.key === 'r' || e.key === 'R')) resetLevel();
  else if (mode === 'play' && (e.key === 'h' || e.key === 'H')) showHint();
});

function resetLevel() { if (mode === 'play') { loadLevel(levelIdx); } }
function showHint() { if (mode !== 'play') return; hintUntil = now + HINT_SEC; hintsUsed++; }

$('btn-hint').onclick = showHint;
$('btn-reset').onclick = resetLevel;
$('btn-select').onclick = () => { if (mode === 'play') openSelect(); };
$('btn-new').onclick = () => { save = { cleared: {}, best: {}, seen: {} }; writeSave(); startLevel(0); };
$('btn-continue').onclick = () => startLevel(Math.min(maxCleared(), LEVELS.length - 1));
$('btn-title-select').onclick = openSelect;
$('btn-select-close').onclick = () => setMode(selectFrom === 'play' && mode !== 'clear' ? 'play' : (selectFrom === 'play' ? 'play' : 'title'));
$('btn-next').onclick = () => startLevel(levelIdx + 1);
$('btn-again').onclick = () => { loadLevel(levelIdx); setMode('play'); };
$('btn-clear-select').onclick = openSelect;
$('btn-end-again').onclick = () => startLevel(0);
$('btn-end-select').onclick = openSelect;

// ---------- 描画：レイアウト ----------
function layout() {
  VW = innerWidth; VH = innerHeight;
  DPR = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  fog.width = Math.ceil(VW * FOG_SCALE); fog.height = Math.ceil(VH * FOG_SCALE);
  if (!P) return;
  const bar = $('bar');
  const top = bar.hidden ? 66 : Math.max(66, Math.ceil(bar.getBoundingClientRect().bottom) + 26), bot = 80;
  const aw = VW - 24, ah = VH - top - bot;
  cs = Math.max(24, Math.floor(Math.min(aw / P.cols, ah / P.rows, 96)));
  ox = Math.floor((VW - cs * P.cols) / 2);
  oy = top + Math.floor((ah - cs * P.rows) / 2);
}
addEventListener('resize', layout);

const px_ = x => ox + (x + 0.5) * cs;   // マス座標 → 画面座標（中心）
const py_ = y => oy + (y + 0.5) * cs;

function glyph(ch, x, y, size, color, glow, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * 0.45; }
  ctx.fillStyle = color;
  ctx.fillText(ch, x, y + size * 0.04);
  ctx.restore();
}

// ---------- 描画：盤面 ----------
function drawFloor() {
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, '#0a0912'); g.addColorStop(1, '#13111f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  // 洞窟のふち
  ctx.fillStyle = '#0e0d17';
  rr(ox - cs * 0.22, oy - cs * 0.22, cs * (P.cols + 0.44), cs * (P.rows + 0.44), cs * 0.25); ctx.fill();
  ctx.strokeStyle = '#2c2745'; ctx.lineWidth = 2; ctx.stroke();
  for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
    const c = P.grid[y][x];
    const X = ox + x * cs, Y = oy + y * cs;
    if (c === '#') {
      ctx.fillStyle = '#34323f'; ctx.fillRect(X + 1, Y + 1, cs - 2, cs - 2);
      ctx.fillStyle = '#413e4e'; ctx.fillRect(X + 1, Y + 1, cs - 2, cs * 0.12);
      glyph('石', X + cs / 2, Y + cs / 2, cs * 0.62, '#4d4a5c');
    } else {
      ctx.fillStyle = (x + y) % 2 ? '#1c1a2b' : '#201e32';
      ctx.fillRect(X + 1, Y + 1, cs - 2, cs - 2);
    }
  }
}
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 闇のもや：黒い霧を全面に敷き、光線やともしびのまわりを消し抜く
function drawFog(t) {
  const wantReveal = Math.min(1, (clearT > 0 ? 1 : 0.1 + 0.4 * (result.lit.size / P.targets.length)));
  reveal += (wantReveal - reveal) * 0.04;
  const base = Math.max(0.45, 0.86 - 0.04 * levelIdx);        // 先の面ほど洞窟が少し明るい
  const fa = base * (1 - (clearT > 0 ? easeOut(clearT) : 0) * 0.95) * (1 - 0.35 * (reveal - 0.1));
  const f = fctx;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, fog.width, fog.height);
  f.setTransform(FOG_SCALE, 0, 0, FOG_SCALE, 0, 0);
  f.fillStyle = `rgba(3,3,9,${fa})`;
  f.fillRect(0, 0, VW, VH);
  // 漂う黒いもや
  for (const b of fogBlobs) {
    const bx = ox + (b.u + Math.sin(t * b.sp + b.ph) * 0.12) * cs * P.cols;
    const by = oy + (b.v + Math.cos(t * b.sp * 0.8 + b.ph) * 0.12) * cs * P.rows;
    const r = b.r * cs;
    const g = f.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0, `rgba(0,0,6,${0.55 * fa})`); g.addColorStop(1, 'rgba(0,0,6,0)');
    f.fillStyle = g; f.fillRect(bx - r, by - r, r * 2, r * 2);
  }
  // 光で晴れる部分
  f.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r, a = 1) => {
    const g = f.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.55, `rgba(0,0,0,${a * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g; f.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [x0, y0, x1, y1] of result.segs) {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / 0.5));
    for (let i = 0; i <= n; i++) hole(px_(x0 + (x1 - x0) * i / n), py_(y0 + (y1 - y0) * i / n), cs * 1.25, 0.85);
  }
  hole(px_(P.src.x), py_(P.src.y), cs * 2, 1);
  P.targets.forEach((tg, i) => { if (result.lit.has(i)) hole(px_(tg.x), py_(tg.y), cs * 2.6, 1); });
  if (clearT > 0) {
    // クリア：ともしび台から光が広がって、洞窟の闇が晴れていく
    const r = easeOut(clearT) * Math.hypot(VW, VH) * 0.8;
    P.targets.forEach(tg => hole(px_(tg.x), py_(tg.y), r, 1));
    hole(px_(P.src.x), py_(P.src.y), r * 0.6, 1);
  }
  ctx.drawImage(fog, 0, 0, VW, VH);
}
const easeOut = u => 1 - Math.pow(1 - Math.min(1, u), 3);

function drawBeams(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const pulse = 0.88 + 0.12 * Math.sin(t * 6);
  for (const [x0, y0, x1, y1] of result.segs) {
    const a = [px_(x0), py_(y0)], b = [px_(x1), py_(y1)];
    for (const [w, col] of [[0.5, `rgba(255,170,60,${0.10 * pulse})`], [0.3, `rgba(255,205,110,${0.2 * pulse})`], [0.15, `rgba(255,240,190,${0.5 * pulse})`], [0.06, 'rgba(255,255,245,0.95)']]) {
      ctx.strokeStyle = col; ctx.lineWidth = cs * w;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawDark(t) {
  for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
    if (P.grid[y][x] !== 'Y') continue;
    const k = y * P.cols + x;
    let a = 1;
    if (dissolved.has(k)) { const t0 = dissolveAt.get(k); a = t0 === -99 ? 0 : Math.max(0, 1 - (now - t0) / 1.1); }
    const cx = px_(x), cy = py_(y);
    if (clearT > 0) a *= 1 - easeOut(clearT * 1.6);
    if (a <= 0.01) continue;
    // 黒いもやのかたまり
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.75);
    g.addColorStop(0, `rgba(60,25,100,${0.85 * a})`); g.addColorStop(1, 'rgba(20,8,40,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - cs, cy - cs, cs * 2, cs * 2);
    const shake = dissolved.has(k) ? 0 : Math.sin(t * 17 + x * 3 + y) * cs * 0.012; // 光をこわがってふるえる
    glyph('闇', cx + shake, cy - Math.abs(shake) * 2, cs * 0.78, '#8a63d0', '#5a2fa0', a);
  }
}

function drawTargets(t) {
  P.targets.forEach((tg, i) => {
    const cx = px_(tg.x), cy = py_(tg.y), on = result.lit.has(i);
    ctx.fillStyle = on ? '#4a3a1e' : '#2a2638';
    rr(cx - cs * 0.36, cy + cs * 0.12, cs * 0.72, cs * 0.28, cs * 0.06); ctx.fill(); // 台
    if (on) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * (1.1 + 0.08 * Math.sin(t * 5)));
      g.addColorStop(0, 'rgba(255,200,90,.75)'); g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cs * 1.3, cy - cs * 1.3, cs * 2.6, cs * 2.6);
      ctx.restore();
    }
    glyph('灯', cx, cy - cs * 0.04, cs * 0.68, on ? '#fff0b8' : '#6a6480', on ? '#ffb040' : null);
  });
}

function drawPrisms(t) {
  for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) {
    if (P.grid[y][x] !== 'W') continue;
    const cx = px_(x), cy = py_(y);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.6);
    g.addColorStop(0, 'rgba(110,190,255,.5)'); g.addColorStop(1, 'rgba(60,120,220,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - cs, cy - cs, cs * 2, cs * 2);
    glyph('水', cx, cy, cs * 0.74, '#9bd6ff', '#4a9aff');
  }
}

function drawSource(t) {
  const cx = px_(P.src.x), cy = py_(P.src.y);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * (0.9 + 0.06 * Math.sin(t * 4)));
  g.addColorStop(0, 'rgba(255,220,120,.7)'); g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - cs, cy - cs, cs * 2, cs * 2);
  ctx.restore();
  glyph('光', cx, cy, cs * 0.7, '#fff6cc', '#ffbe3a');
  // 光を出す向きの矢じるし
  const [dx, dy] = DIRS[P.src.dir];
  ctx.fillStyle = '#ffe9a8';
  ctx.save(); ctx.translate(cx + dx * cs * 0.44, cy + dy * cs * 0.44); ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath(); ctx.moveTo(cs * 0.08, 0); ctx.lineTo(-cs * 0.06, -cs * 0.09); ctx.lineTo(-cs * 0.06, cs * 0.09); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// 鏡：「鏡」の字をうすく敷き、反射面を向きに合わせた棒で描く
function drawMirror(m, cx, cy, ang, opts = {}) {
  const half = m.type === 'h';
  const a = opts.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha = a;
  if (m.fixed) { // 岩にはまった鏡
    ctx.fillStyle = '#4a4658'; rr(cx - cs * 0.42, cy - cs * 0.42, cs * 0.84, cs * 0.84, cs * 0.14); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(40,70,90,.35)'; rr(cx - cs * 0.42, cy - cs * 0.42, cs * 0.84, cs * 0.84, cs * 0.14); ctx.fill();
  }
  ctx.restore();
  glyph(half ? '半' : '鏡', cx, cy, cs * 0.66, half ? 'rgba(255,170,220,.28)' : 'rgba(150,230,255,.28)', null, a);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, cy); ctx.rotate(ang);
  const L = cs * 0.46;
  ctx.lineCap = 'round';
  if (half) ctx.setLineDash([cs * 0.13, cs * 0.07]);
  ctx.strokeStyle = half ? 'rgba(255,150,210,.35)' : 'rgba(120,220,255,.35)'; ctx.lineWidth = cs * 0.2;
  ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
  ctx.strokeStyle = half ? '#ffd0ec' : '#e6fbff'; ctx.lineWidth = cs * 0.075;
  ctx.shadowColor = half ? '#ff8ac8' : '#5fd6ff'; ctx.shadowBlur = cs * 0.2;
  ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
  ctx.restore();
  if (m.fixed) { // 岩のびょう
    ctx.fillStyle = '#9a96ac';
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(cx + dx * cs * 0.34, cy + dy * cs * 0.34, cs * 0.035, 0, 6.3); ctx.fill(); }
  }
}

function drawMirrors() {
  for (const m of mirrors) {
    m.da += (-m.turn * Math.PI / 4 - m.da) * 0.35; // 回転をなめらかに
    if (drag && drag.m === m && drag.moved) continue;
    drawMirror(m, px_(m.x), py_(m.y), m.da);
  }
  if (drag && drag.moved) {
    const m = drag.m;
    const c = cellAt(drag.px, drag.py);
    if (!m.fixed) {
      const ok = canPlace(P, mirrors, dissolved, c.x, c.y, m);
      if (c.x >= 0 && c.y >= 0 && c.x < P.cols && c.y < P.rows) {
        ctx.strokeStyle = ok ? 'rgba(130,255,170,.8)' : 'rgba(255,110,110,.7)'; ctx.lineWidth = 3;
        rr(ox + c.x * cs + 3, oy + c.y * cs + 3, cs - 6, cs - 6, cs * 0.12); ctx.stroke();
      }
    }
    drawMirror(m, m.fixed ? px_(m.x) : drag.px, m.fixed ? py_(m.y) : drag.py, m.da, { alpha: 0.9 });
  }
}

// ヒント：正解の鏡の位置を一瞬だけ見せる
function drawHint(t) {
  if (now >= hintUntil) return;
  const a = Math.min(1, (hintUntil - now) / 0.4) * (0.65 + 0.25 * Math.sin(t * 10));
  const sol = SOLUTIONS[level.id].sol;
  for (const s of sol) {
    const m = mirrors[s.i];
    const cx = px_(s.x), cy = py_(s.y);
    ctx.save();
    ctx.strokeStyle = `rgba(140,255,170,${a})`; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    rr(ox + s.x * cs + 4, oy + s.y * cs + 4, cs - 8, cs - 8, cs * 0.14); ctx.stroke();
    ctx.restore();
    drawMirror({ ...m, fixed: false }, cx, cy, -s.o * Math.PI / 4, { alpha: a });
  }
}

// ---------- メインループ ----------
let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
  now = ts / 1000;
  if (mode === 'clearing') {
    clearT = Math.min(1, clearT + dt / CLEAR_SEC);
    if (clearT >= 1) { mode = 'clearing-done'; afterClearAnim(); }
  }
  if (P && level && mode !== 'title') render(now);
  requestAnimationFrame(frame);
}
function render(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  drawFloor();
  drawFog(t);
  drawDark(t);
  drawBeams(t);
  drawPrisms(t);
  drawTargets(t);
  drawSource(t);
  drawMirrors();
  drawHint(t);
}

// ---------- 起動 ----------
async function loadFont() {
  try {
    const f = new FontFace('NotoJPHikari', `url(${FONT_URL})`, { weight: '700' });
    await Promise.race([f.load(), new Promise((_, rej) => setTimeout(rej, 4000))]);
    document.fonts.add(f);
  } catch (e) { console.info('Noto Sans JP を読み込めなかったので、システムフォントで表示します'); }
}

function boot() {
  loadSave();
  const hasSave = maxCleared() > 0 || Object.keys(save.seen).length > 0;
  $('btn-continue').disabled = !hasSave;
  loadLevel(0); // 描画用に最初の面を読んでおく（タイトル中は描かない）
  setMode('title');
  requestAnimationFrame(frame);
  loadFont();
  const lv = QUERY.get('level');
  if (DEBUG && lv) { for (const l of LEVELS) if (l.id < +lv) save.cleared[l.id] = save.cleared[l.id] || 1; startLevel(+lv - 1); }
}

if (DEBUG) {
  // 自動テスト用：画面上のマス位置と状態を返す（操作は実際のポインタイベントで行う）
  window.__hikari = {
    mode: () => mode,
    cell: (x, y) => ({ x: px_(x), y: py_(y) }),
    cs: () => cs,
    state: () => ({ moves, solved: result && isSolved(P, result), lit: result ? [...result.lit] : [], mirrors: mirrors.map(m => ({ x: m.x, y: m.y, o: m.o, fixed: m.fixed })), dissolved: [...dissolved], levelId: level.id }),
    save: () => save,
    levels: () => LEVELS,
  };
}
boot();
