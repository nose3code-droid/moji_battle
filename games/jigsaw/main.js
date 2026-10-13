// 字のジグソー：画面・操作・描画・記録（ピースの作り方は puzzle.js）
import { FONT_URL } from '../../config.js';
import { LEVELS, buildPuzzle, renderPieceImages, glyphFromFont, glyphFromCanvas, selfCheck, makeRng } from './puzzle.js';
import { PRESETS, POOL, strokesOf, hitokoto } from './moji.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);   // テスト用の近道：?ch=龍 &lv=0〜2 &seed=数
const SAVE_KEY = 'moji_jigsaw.best';
const FAMILY = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
const SNAP = 0.3;            // 正解位置からセル幅のこの割合以内で離すと吸いつく
const TAP_PX = 6, DOUBLE_MS = 350;

// ---------- フォント（読めなければ canvas に描いた字で代用） ----------
let font = null;
async function loadFont() {
  try {
    const opentype = await import('opentype');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(FONT_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('font ' + res.status);
    font = (opentype.parse || opentype.default.parse)(await res.arrayBuffer());
  } catch (e) {
    console.warn('フォントを読み込めなかったので、代わりの表示用フォントでピースをつくります', e);
    font = null;
    try { await document.fonts.load(`700 40px ${FAMILY}`, '龍'); } catch { /* 無くても続ける */ }
  }
}
function makeGlyph(ch) {
  if (font) { try { return glyphFromFont(font, ch); } catch { /* フォントに無い字は代用 */ } }
  return glyphFromCanvas(ch, FAMILY);
}

// ---------- 記録 ----------
function loadBest() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } }
function saveBest(b) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(b)); } catch { /* 保存できなくても遊べる */ } }
const bestKey = () => `${text}|${lv}`;
const fmt = ms => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, '0')}`;
// ヒントなしの記録がヒントありより上。同じなら速い方
const better = (a, b) => !b || ((a.hints > 0) !== (b.hints > 0) ? a.hints === 0 : a.ms < b.ms);

// ---------- 状態 ----------
const view = $('view'), ctx = view.getContext('2d');
let text = params.get('ch') ? [...params.get('ch')][0] : '龍';
let lv = params.has('lv') ? Math.min(2, Math.max(0, +params.get('lv') | 0)) : 1;
let seed = params.has('seed') ? +params.get('seed') | 0 : Math.floor(Math.random() * 1e6);
let puz = null, pcs = [];            // pcs：ピースの状態 { g（puzzle.js のピース）, fx, fy, rot, placed, z }
let zCounter = 0;
let mode = 'loading';                // loading | play | done
let moves = 0, hintCount = 0, t0 = null, elapsed = 0;
let ghostOn = true, soundOn = true;
let hint = null;                     // { id, until }
let doneAt = 0;
let drag = null, lastTap = null;
let L = null;                        // 画面の配置 { W, H, dpr, board, tray, s, ox, oy }
let ghostCv = null, ghostFor = '';
let dirty = true;

// ---------- 音 ----------
let audio = null;
function tone(freq, dur, type = 'sine', gain = 0.12, delay = 0) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + delay;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* 音が出なくても遊べる */ }
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- パズルを始める ----------
function codeParts() { return [text.codePointAt(0), lv, seed]; }

function start(keepSeed = true) {
  if (!keepSeed) seed = Math.floor(Math.random() * 1e6);
  mode = 'loading';
  $('result').hidden = true;
  try {
    puz = buildPuzzle(makeGlyph(text), lv, codeParts());
  } catch (e) {
    toast(e.message || 'この字は使えません');
    puz = null; mode = 'play'; return;
  }
  // 最初のばらまき（同じ字・シードなら同じ並び）
  const rng = makeRng([...codeParts(), 77]);
  pcs = puz.pieces.map(g => ({ g, fx: 0, fy: 0, rot: 0, placed: false, z: 0 }));
  pcs.forEach(p => { p.rot = puz.rotate && rng() < 0.75 ? 1 + Math.floor(rng() * 3) : 0; });
  moves = 0; hintCount = 0; t0 = null; elapsed = 0; hint = null; drag = null; lastTap = null; doneAt = 0;
  ghostFor = '';
  mode = 'play';
  relayout(true);
  scatter(rng);
  updateHud();
  renderLevels();
  setInfo();
  dirty = true;
}

function setInfo() {
  const n = strokesOf(text);
  $('info').innerHTML = `<em>${text}</em>${n ? `（${n}画）` : ''} ピースをドラッグして、枠の中の正しい場所へ。近くで離すとパチッと吸いつくよ。`
    + (puz?.rotate ? ' <em>ダブルタップで回転</em>' : '');
}

// ---------- 配置 ----------
function relayout(first = false) {
  const stage = $('stage');
  const W = stage.clientWidth, H = stage.clientHeight, dpr = Math.min(2.5, window.devicePixelRatio || 1);
  if (!W || !H) return;
  if (view.width !== Math.round(W * dpr) || view.height !== Math.round(H * dpr)) { view.width = Math.round(W * dpr); view.height = Math.round(H * dpr); }
  if (!puz) { L = { W, H, dpr }; return; }
  const wd = puz.world, ww = wd.x1 - wd.x0, wh = wd.y1 - wd.y0, m = 8;
  let board, tray;
  if (W / H > 1.25) {
    const bw = Math.round(W * 0.58);
    board = { x: m, y: m, w: bw - m * 1.5, h: H - 2 * m };
    tray = { x: bw + m / 2, y: m, w: W - bw - m * 1.5, h: H - 2 * m };
  } else {
    const need = (W - 2 * m) / ww * wh + 2 * m;              // 幅いっぱいにしたときのボードの高さ
    const bh = Math.min(Math.round(H * 0.58), Math.max(need, H * 0.3));
    board = { x: m, y: m, w: W - 2 * m, h: bh - m * 1.5 };
    tray = { x: m, y: bh + m / 2, w: W - 2 * m, h: H - bh - m * 1.5 };
  }
  const s = Math.min(board.w / ww, board.h / wh);
  const ox = board.x + (board.w - ww * s) / 2 - wd.x0 * s;   // モデル座標 → 画面： x*s + ox
  const oy = board.y + (board.h - wh * s) / 2 - wd.y0 * s;
  L = { W, H, dpr, board, tray, s, ox, oy };
  // 絵の解像度が画面に対して足りない／多すぎるときだけ作り直す
  const want = Math.max(0.25, Math.min(2.5, s * dpr * 1.2));
  if (!puz.imgK || puz.imgK / want > 1.7 || puz.imgK / want < 0.6) renderPieceImages(puz, want);
  dirty = true;
}

const target = p => ({ x: L.ox + p.g.cx * L.s, y: L.oy + p.g.cy * L.s });
const posOf = p => (p.placed ? target(p) : { x: p.fx * L.W, y: p.fy * L.H });
function setPos(p, x, y) { p.fx = x / L.W; p.fy = y / L.H; }

function scatter(rng) {
  const t = L.tray, half = puz.cell * L.s / 2;
  for (const p of pcs) {
    const x = t.x + half + rng() * Math.max(1, t.w - 2 * half), y = t.y + half + rng() * Math.max(1, t.h - 2 * half);
    setPos(p, x, y);
    p.z = ++zCounter;
  }
}

// かど・ふち（まっすぐな辺が多い）のピースから順に、トレイに並べ直す
function tidy() {
  const list = pcs.filter(p => !p.placed).sort((a, b) => b.g.flats - a.g.flats || a.g.r - b.g.r || a.g.c - b.g.c);
  if (!list.length) return;
  const t = L.tray, cell = puz.cell * L.s;
  let step = cell * 1.18;
  const fit = st => Math.max(1, Math.floor((t.w - st * 0.2) / st)) * Math.max(1, Math.floor((t.h - st * 0.2) / st)) >= list.length;
  while (!fit(step) && step > cell * 0.35) step *= 0.94;       // 入りきらないときは少し重ねる
  const cols = Math.max(1, Math.floor((t.w - step * 0.2) / step));
  list.forEach((p, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    setPos(p, t.x + step * 0.6 + c * step, t.y + step * 0.6 + r * step);
    p.z = ++zCounter;
  });
  dirty = true;
}

// ---------- 描画 ----------
function ghostCanvas() {
  const key = `${text}|${lv}|${seed}|${L.s.toFixed(3)}|${L.dpr}`;
  if (ghostFor === key) return ghostCv;
  const w = (puz.world.x1 - puz.world.x0) * L.s, h = (puz.world.y1 - puz.world.y0) * L.s;
  ghostCv = document.createElement('canvas');
  ghostCv.width = Math.ceil(w * L.dpr); ghostCv.height = Math.ceil(h * L.dpr);
  const c = ghostCv.getContext('2d');
  c.scale(L.dpr * L.s, L.dpr * L.s); c.translate(-puz.world.x0, -puz.world.y0);
  puz.src.draw(c, 'rgba(255,255,255,0.16)');
  ghostFor = key;
  return ghostCv;
}

function drawPiece(p, x, y, { scale = 1, shadow = 6, glow = 0 } = {}) {
  const img = p.g.img;
  if (!img) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.rot * Math.PI / 2);
  const sc = L.s / puz.imgK * scale;
  ctx.scale(sc, sc);
  if (glow) { ctx.shadowColor = 'rgba(255,220,90,1)'; ctx.shadowBlur = glow * L.dpr; }
  else if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = shadow * 1.6 * L.dpr; ctx.shadowOffsetX = shadow * 0.5 * L.dpr; ctx.shadowOffsetY = shadow * L.dpr; }
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

function draw(now) {
  if (!L || !puz) return;
  const { dpr, W, H, board, tray, s } = L;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // トレイ
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  roundRect(tray.x, tray.y, tray.w, tray.h, 12); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText('ピース置き場', tray.x + 8, tray.y + 6);

  // ボード（目標の枠）
  const wd = puz.world;
  const bx = L.ox + wd.x0 * s, by = L.oy + wd.y0 * s, bw = (wd.x1 - wd.x0) * s, bh = (wd.y1 - wd.y0) * s;
  ctx.fillStyle = '#26284a'; roundRect(board.x, board.y, board.w, board.h, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
  ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
  if (ghostOn) {
    ctx.drawImage(ghostCanvas(), bx, by, bw, bh);
    ctx.save();
    ctx.translate(L.ox, L.oy); ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1.4 / s;
    for (const p of pcs) if (!p.placed) ctx.stroke(p.g.path);
    ctx.restore();
  }

  // ヒント：置き場所を点滅
  const pulse = 0.5 + 0.5 * Math.sin(now / 160);
  if (hint && now < hint.until) {
    const p = pcs[hint.id];
    if (!p.placed) {
      ctx.save();
      ctx.translate(L.ox, L.oy); ctx.scale(s, s);
      ctx.strokeStyle = `rgba(255,220,90,${0.45 + 0.5 * pulse})`; ctx.lineWidth = 3.5 / s;
      ctx.fillStyle = `rgba(255,220,90,${0.08 + 0.12 * pulse})`;
      ctx.fill(p.g.path); ctx.stroke(p.g.path);
      ctx.restore();
    }
  } else hint = null;

  // 置いたピース → ふつうのピース
  const placed = pcs.filter(p => p.placed).sort((a, b) => a.z - b.z);
  const loose = pcs.filter(p => !p.placed).sort((a, b) => a.z - b.z);
  for (const p of placed) {
    const t = target(p), pop = p.pop && now - p.pop < 260 ? 1 + 0.07 * Math.sin((now - p.pop) / 260 * Math.PI) : 1;
    drawPiece(p, t.x, t.y, { scale: pop, shadow: mode === 'done' ? 0 : 1.5 });
  }
  for (const p of loose) {
    const { x, y } = posOf(p), dragging = drag && drag.p === p;
    const glow = hint && hint.id === p.g.id ? 16 + 14 * pulse : 0;
    drawPiece(p, x, y, { scale: dragging ? 1.06 : 1, shadow: dragging ? 14 : 5, glow });
  }

  // 完成：字が光る
  if (mode === 'done') {
    const k = Math.min(1, (now - doneAt) / 500), beat = 0.5 + 0.5 * Math.sin((now - doneAt) / 220);
    ctx.save();
    ctx.translate(L.ox, L.oy); ctx.scale(s, s);
    ctx.globalAlpha = k * (0.55 + 0.4 * beat);
    ctx.shadowColor = 'rgba(255,215,90,1)'; ctx.shadowBlur = (24 + 20 * beat) * L.dpr;
    puz.src.draw(ctx, 'rgba(255,225,120,1)');
    ctx.restore();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- 操作 ----------
const hitCtx = document.createElement('canvas').getContext('2d');
function hitTest(px, py) {
  const loose = pcs.filter(p => !p.placed).sort((a, b) => b.z - a.z);
  for (const p of loose) {
    const c = posOf(p), a = -p.rot * Math.PI / 2, dx = px - c.x, dy = py - c.y;
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / L.s, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / L.s;
    if (hitCtx.isPointInPath(p.g.path, p.g.cx + lx, p.g.cy + ly)) return p;
  }
  // 指でつまみにくいので、ぎりぎり外れたときは一番近いピースを取る
  let near = null, nd = puz.cell * L.s * 0.45;
  for (const p of loose) { const c = posOf(p), d = Math.hypot(px - c.x, py - c.y); if (d < nd) { nd = d; near = p; } }
  return near;
}

function pointer(e) {
  const r = view.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

view.addEventListener('pointerdown', e => {
  if (mode !== 'play' || !puz || drag || !e.isPrimary) return;
  const pt = pointer(e), p = hitTest(pt.x, pt.y);
  if (!p) return;
  e.preventDefault();
  view.setPointerCapture(e.pointerId);
  const c = posOf(p);
  p.z = ++zCounter;
  drag = { p, id: e.pointerId, dx: c.x - pt.x, dy: c.y - pt.y, sx: pt.x, sy: pt.y, moved: false };
  if (t0 === null) t0 = performance.now();
  dirty = true;
});
view.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const pt = pointer(e);
  if (!drag.moved && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > TAP_PX) drag.moved = true;
  if (drag.moved) {
    const half = puz.cell * L.s * 0.3;
    setPos(drag.p, Math.min(L.W - half, Math.max(half, pt.x + drag.dx)), Math.min(L.H - half, Math.max(half, pt.y + drag.dy)));
  }
  dirty = true;
});
function release(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { p, moved } = drag;
  drag = null;
  const now = performance.now();
  if (!moved) {
    // タップ：回転ありの「むずかしい」だけ、ダブルタップで90°回転
    if (puz.rotate && lastTap && lastTap.p === p && now - lastTap.t < DOUBLE_MS) {
      p.rot = (p.rot + 1) % 4; moves++; lastTap = null;
      tone(520, 0.05, 'triangle', 0.08);
      trySnap(p);
    } else lastTap = { p, t: now };
  } else {
    lastTap = null;
    moves++;
    trySnap(p);
  }
  updateHud();
  dirty = true;
}
view.addEventListener('pointerup', release);
view.addEventListener('pointercancel', release);

function trySnap(p) {
  if (p.rot !== 0) return;
  const t = target(p), c = posOf(p);
  if (Math.hypot(c.x - t.x, c.y - t.y) > Math.max(12, puz.cell * L.s * SNAP)) return;
  p.placed = true; p.pop = performance.now(); p.z = ++zCounter;
  if (hint && hint.id === p.g.id) hint = null;
  tone(880, 0.07, 'square', 0.1); tone(1320, 0.09, 'triangle', 0.1, 0.05);
  if (pcs.every(q => q.placed)) finish();
}

function finish() {
  mode = 'done';
  elapsed = performance.now() - t0;
  doneAt = performance.now();
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, 0.12 * i + 0.1));
  const all = loadBest(), key = bestKey(), rec = { ms: Math.round(elapsed), moves, hints: hintCount };
  const isBest = better(rec, all[key]);
  if (isBest) { all[key] = rec; saveBest(all); }
  updateHud();
  const n = pcs.length;
  $('r-char').textContent = text;
  $('result-body').innerHTML = `${hitokoto(text)}<br>`
    + `${LEVELS[lv].name}・${n}ピース　タイム <b>${fmt(rec.ms)}</b>　<b>${moves}手</b>`
    + (hintCount ? `　<small>（ヒント${hintCount}回）</small>` : '')
    + (isBest ? '<br><em style="color:var(--accent);font-style:normal">★ ベスト更新！</em>' : '');
  setTimeout(() => { if (mode === 'done') $('result').hidden = false; }, 1600);
}

// ---------- ボタン ----------
function renderLevels() {
  const box = $('levels');
  if (!box.children.length) {
    LEVELS.forEach((l, i) => {
      const b = document.createElement('button'); b.textContent = l.name;
      b.onclick = () => { if (lv !== i) { lv = i; start(false); } };
      box.append(b);
    });
  }
  [...box.children].forEach((b, i) => b.classList.toggle('on', i === lv));
}

function updateHud() {
  $('time').textContent = fmt(t0 === null ? 0 : (mode === 'done' ? elapsed : performance.now() - t0));
  $('moves').textContent = moves;
  $('count').textContent = `${pcs.filter(p => p.placed).length}/${pcs.length}`;
  const b = loadBest()[bestKey()];
  $('best').textContent = b ? `${fmt(b.ms)} ／ ${b.moves}手${b.hints ? '（ヒント）' : ''}` : '-';
  $('btn-hint').disabled = mode !== 'play';
}

function giveHint() {
  if (mode !== 'play') return;
  const left = pcs.filter(p => !p.placed);
  if (!left.length) return;
  // かど・ふちのピースを優先（すでに置いた隣のピースがあればさらに優先）
  const score = p => p.g.flats * 2 + pcs.filter(q => q.placed && Math.abs(q.g.r - p.g.r) + Math.abs(q.g.c - p.g.c) === 1).length;
  const p = left.sort((a, b) => score(b) - score(a) || a.g.id - b.g.id)[0];
  hint = { id: p.g.id, until: performance.now() + 3500 };
  p.z = ++zCounter;
  hintCount++;
  toast('光っているピースを、点滅している場所へ（ヒントを使うと記録に印がつきます）');
  dirty = true;
}

function setChar(ch, resetSeed = true) {
  text = [...ch][0];
  $('picker').hidden = true;
  start(!resetSeed);
}
function randomChar() {
  const pool = POOL.filter(c => c !== text);
  return pool[Math.floor(Math.random() * pool.length)];
}
function nextChar() {
  const i = PRESETS.indexOf(text);
  return i < 0 ? randomChar() : PRESETS[(i + 1) % PRESETS.length];
}

function openPicker() {
  const box = $('presets'); box.innerHTML = '';
  for (const c of PRESETS) {
    const b = document.createElement('button'); b.textContent = c; b.classList.toggle('on', c === text);
    b.onclick = () => setChar(c);
    box.append(b);
  }
  $('char').value = '';
  $('picker').hidden = false;
}

$('btn-hint').onclick = giveHint;
$('btn-ghost').onclick = () => { ghostOn = !ghostOn; $('btn-ghost').setAttribute('aria-pressed', ghostOn); dirty = true; };
$('btn-sort').onclick = () => { tidy(); toast('かど・ふちのピースから順に並べたよ'); };
$('btn-again').onclick = () => start(true);
$('btn-auto').onclick = () => setChar(randomChar());
$('btn-char').onclick = openPicker;
$('btn-sound').onclick = () => { soundOn = !soundOn; $('btn-sound').setAttribute('aria-pressed', soundOn); $('btn-sound').textContent = soundOn ? '音 ON' : '音 OFF'; };
$('form').onsubmit = e => { e.preventDefault(); const v = $('char').value.trim(); if (v) setChar(v); };
$('btn-random').onclick = () => setChar(randomChar());
$('btn-close').onclick = () => { $('picker').hidden = true; };
$('r-next').onclick = () => setChar(nextChar());
$('r-again').onclick = () => start(true);
$('r-char-btn').onclick = () => { $('result').hidden = true; openPicker(); };
$('r-view').onclick = () => { $('result').hidden = true; };

new ResizeObserver(() => { relayout(); }).observe($('stage'));

// ---------- メインループ ----------
function loop(now) {
  if (mode === 'play' && t0 !== null) { $('time').textContent = fmt(performance.now() - t0); }
  const animating = hint || mode === 'done' || pcs.some(p => p.pop && now - p.pop < 300);
  if (dirty || animating) { draw(now); dirty = false; }
  requestAnimationFrame(loop);
}

// ---------- 起動 ----------
await loadFont();
start(true);
requestAnimationFrame(loop);

// テストから使う入口
window.__jigsaw = {
  get puz() { return puz; },
  get pcs() { return pcs; },
  get layout() { return L; },
  get mode() { return mode; },
  get moves() { return moves; },
  usingOutline: () => !!font,
  target, posOf,
  selfCheck: () => selfCheck(puz),
  build: (ch, l, sd) => buildPuzzle(makeGlyph(ch), l, [ch.codePointAt(0), l, sd]),
  check: (ch, l, sd) => selfCheck(buildPuzzle(makeGlyph(ch), l, [ch.codePointAt(0), l, sd])),
  signature: (ch, l, sd) => buildPuzzle(makeGlyph(ch), l, [ch.codePointAt(0), l, sd]).pieces.map(p => p.d).join('|'),
  setChar, start, tidy, giveHint,
};
