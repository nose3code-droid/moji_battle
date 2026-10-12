// 文字めいろ：画面・操作・描画・記録（迷路の作り方は maze.js、字の形は shape.js）
import { FONT_URL } from '../../config.js';
import { LEVELS, DIRS, makeMaze, shortestPath } from './maze.js';
import { polygonShape, canvasShape } from './shape.js';
import { strokeCount, POOL } from './strokes.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search); // テスト用の近道：?ch=龍 &lv=0〜2 &seed=数
const SAVE_KEY = 'moji_meiro.best';
const FAMILY = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
const PRESETS = ['龍', '口', '一', 'ハ', '川', '三', 'あ', 'S', '森', '愛', '文字'];
const STEP_MS = 85, RUN_MS = 50, HINT_MS = 3500;

// ---------- フォント（読めなければ canvas のマスクで代用） ----------
let glyph = null, font = null;
async function loadFont() {
  try {
    const [g, opentype] = await Promise.all([import('../../glyph.js'), import('opentype')]);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(FONT_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('font ' + res.status);
    font = opentype.parse(await res.arrayBuffer());
    glyph = g;
  } catch (e) {
    console.warn('フォントを読み込めなかったので、代わりの表示用フォントで迷路をつくります', e);
    font = glyph = null;
    try { await document.fonts.load(`700 40px ${FAMILY}`, '龍'); } catch { /* 無くても続ける */ }
  }
}

function makeShape(text) {
  const em = [...text].length === 1 ? 700 : 540;
  return glyph ? polygonShape(glyph, font, text, em) : canvasShape(text, em, FAMILY);
}
// 迷路を作る（同じ字・むずかしさ・シードなら同じ結果）
function generate(text, lv, seed) {
  const chars = [...text];
  const shape = makeShape(text);
  const maze = makeMaze(shape, lv, [...chars.map(c => c.codePointAt(0)), seed], chars.length === 1 ? 1 : 1.5);
  return { shape, maze };
}

// ---------- 記録 ----------
function loadBest() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } }
function saveBest(b) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(b)); } catch { /* 保存できなくても遊べる */ } }
const bestKey = () => `${text}|${lv}`;
const fmt = ms => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, '0')}`;

// ---------- 状態 ----------
const view = $('view'), ctx = view.getContext('2d');
let text = params.get('ch') ? [...params.get('ch')].slice(0, 2).join('') : '龍';
let lv = params.has('lv') ? Math.min(2, Math.max(0, +params.get('lv') | 0)) : 1;
let seed = params.has('seed') ? +params.get('seed') | 0 : Math.floor(Math.random() * 1e6);
let shape = null, maze = null, hue = 0;
let mode = 'play';                       // play | done
let pos = 0, trail = [], steps = 0;
let t0 = null, elapsed = 0;
let hintPath = null, hintUntil = 0, hintCount = 0;
let held = [], stickDir = -1, runDir = -1, lastStep = 0;
let sc = 1, vw = 0, vh = 0, dpr = 1, statics = null;
let rx = 0, ry = 0, bump = 0, toastT = 0;

window.__meiro = { // テスト用
  generate, DIRS, shortestPath,
  get maze() { return maze; }, get state() { return { text, lv, seed, mode, pos, steps, elapsed, hintCount, trail: trail.length }; },
  step: d => step(d), reset: () => resetRun(), usingOutline: () => !!glyph,
};

// ---------- 迷路の入れ替え ----------
function setMaze() {
  ({ shape, maze } = generate(text, lv, seed));
  hue = (text.codePointAt(0) * 47) % 360;
  resetRun();
  layout();
  showInfo();
}
function resetRun() {
  pos = maze.start; trail = [pos]; steps = 0; t0 = null; elapsed = 0;
  hintPath = null; hintCount = 0; held = []; stickDir = -1; runDir = -1; mode = 'play';
  const [x, y] = cellCenter(pos); rx = x; ry = y;
  $('result').hidden = true;
  updateHud();
}
function showInfo() {
  const sc_ = strokeCount(text), best = loadBest()[bestKey()];
  $('info').innerHTML = `「${text}」 画数 <em>${sc_ ?? '？'}</em> ／ パーツ <em>${maze.parts}</em> ／ 分かれ道 <em>${maze.junctions}</em> ／ 行き止まり <em>${maze.deadEnds}</em>`
    + (maze.bridges ? ` ／ 橋 <em>${maze.bridges}</em>マス` : '') + ` ／ #${seed}`
    + `<br>${LEVELS[lv].name}のベスト：${best ? `<em>${fmt(best.t)}</em>（${best.steps}歩${best.hinted ? '・ヒントあり' : ''}）` : 'まだありません'}`;
  document.querySelectorAll('#levels button').forEach((b, i) => b.classList.toggle('on', i === lv));
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.textContent === text));
}
function toast(msg, sec = 2.2) { $('toast').textContent = msg; $('toast').classList.add('on'); toastT = sec; }
function updateHud() {
  $('time').textContent = fmt(t0 === null ? 0 : elapsed);
  $('steps').textContent = steps;
  $('compare').textContent = `最短 ${maze.shortest}歩 ／ あなた ${steps}歩`;
  $('btn-hint').textContent = hintCount ? `ヒント(${hintCount})` : 'ヒント';
  $('btn-hint').disabled = mode !== 'play';
}

// ---------- 移動 ----------
const cellCenter = i => [maze.ox + ((i % maze.cols) + 0.5) * maze.cs, maze.oy + (((i / maze.cols) | 0) + 0.5) * maze.cs];
function step(d) {
  if (mode !== 'play') return false;
  if (!(maze.open[pos] & DIRS[d].bit)) { bump = 1; return false; }
  pos += DIRS[d].dy * maze.cols + DIRS[d].dx;
  steps++; trail.push(pos);
  if (t0 === null) t0 = performance.now();
  if (pos === maze.goal) finish();
  updateHud();
  return true;
}
// スワイプ：壁か分かれ道まで進む。一本道の角は自動で曲がる
function runStep() {
  if (!step(runDir)) { runDir = -1; return; }
  const exits = [];
  for (let d = 0; d < 4; d++) if (d !== (runDir + 2) % 4 && (maze.open[pos] & DIRS[d].bit)) exits.push(d);
  runDir = pos !== maze.goal && exits.length === 1 ? exits[0] : -1;
}
function finish() {
  mode = 'done'; runDir = -1; held = [];
  elapsed = performance.now() - t0;
  const all = loadBest(), k = bestKey(), old = all[k];
  const record = !old || elapsed < old.t;
  if (record) { all[k] = { t: Math.round(elapsed), steps, hinted: hintCount > 0 }; saveBest(all); }
  const extra = steps - maze.shortest;
  $('result-body').innerHTML = `タイム <b>${fmt(elapsed)}</b> ／ 歩数 <b>${steps}</b><br>最短 ${maze.shortest}歩 ／ あなた ${steps}歩`
    + (extra === 0 ? '（最短ルート！）' : `（+${extra}歩）`)
    + (hintCount ? `<br>ヒント ${hintCount}回つかった（記録に印がつきます）` : '')
    + (record ? `<br>🏆 ${LEVELS[lv].name}の「${text}」のベスト更新！` : `<br>ベスト ${fmt(old.t)}${old.hinted ? '（ヒントあり）' : ''}`);
  showInfo();
  setTimeout(() => { if (mode === 'done') $('result').hidden = false; }, 600);
}
function hint() {
  if (mode !== 'play') return;
  hintPath = shortestPath(maze, pos, maze.goal);
  hintUntil = performance.now() + HINT_MS;
  hintCount++;
  updateHud();
}

// ---------- 入力 ----------
const KEYMAP = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const d = KEYMAP[e.code];
  if (d === undefined) return;
  e.preventDefault();
  if (e.repeat || !$('picker').hidden) return;
  held = [d, ...held.filter(x => x !== d)];
  runDir = -1;
  step(d); lastStep = performance.now();
});
addEventListener('keyup', e => { const d = KEYMAP[e.code]; if (d !== undefined) held = held.filter(x => x !== d); });
addEventListener('blur', () => { held = []; stickDir = -1; });

// バーチャルスティック
const stickEl = $('stick'), knob = $('knob');
let stickId = null;
function stickMove(e) {
  const r = stickEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2, dist = Math.hypot(dx, dy);
  if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  const prev = stickDir;
  stickDir = Math.hypot(dx, dy) < max * 0.35 ? -1 : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  if (stickDir >= 0 && stickDir !== prev) { runDir = -1; step(stickDir); lastStep = performance.now(); }
}
stickEl.addEventListener('pointerdown', e => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); });
stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; stickDir = -1; knob.style.transform = ''; };
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointercancel', stickEnd);

// スワイプ（盤面をなぞる）：一定以上動かすたびに、その向きへ走る
let swipe = null;
view.addEventListener('pointerdown', e => { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (Math.hypot(dx, dy) < 22) return;
  const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  swipe.x = e.clientX; swipe.y = e.clientY;
  runDir = d; held = [];
  runStep(); lastStep = performance.now();
});
const swipeEnd = e => { if (swipe && e.pointerId === swipe.id) swipe = null; };
view.addEventListener('pointerup', swipeEnd);
view.addEventListener('pointercancel', swipeEnd);

// ---------- 描画 ----------
function layout() {
  const r = $('stage').getBoundingClientRect();
  if (!maze || r.width < 10) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = r.width; vh = r.height;
  view.width = Math.round(vw * dpr); view.height = Math.round(vh * dpr);
  sc = Math.min((vw - 16) / shape.W, (vh - 16) / shape.H);
  statics = renderStatic();
  const [x, y] = cellCenter(pos); rx = x; ry = y;
}
const toScreen = (x, y) => [vw / 2 + x * sc, vh / 2 + y * sc];

// 動かない部分（字の形・道・かべ）をまとめて 1 枚に描いておく
function renderStatic() {
  const cv = document.createElement('canvas');
  cv.width = view.width; cv.height = view.height;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { cols, rows, cs, ox, oy, usable, bridge, open } = maze;
  const g = c.createLinearGradient(vw / 2 - shape.W * sc / 2, vh / 2 - shape.H * sc / 2, vw / 2 + shape.W * sc / 2, vh / 2 + shape.H * sc / 2);
  g.addColorStop(0, `hsl(${hue} 85% 62%)`);
  g.addColorStop(1, `hsl(${(hue + 90) % 360} 85% 58%)`);
  // 字そのものの輪郭をうっすら（マスの粗さで欠けた部分も形が分かるように）
  c.save();
  c.translate(vw / 2, vh / 2); c.scale(sc, sc);
  c.globalAlpha = 0.14; c.fillStyle = g;
  shape.draw(c);
  c.restore();
  // 道
  const px = cs * sc;
  c.fillStyle = g; c.globalAlpha = 0.9;
  for (let i = 0; i < cols * rows; i++) {
    if (!usable[i] || bridge[i]) continue;
    const [x, y] = toScreen(ox + (i % cols) * cs, oy + ((i / cols) | 0) * cs);
    c.fillRect(x - 0.4, y - 0.4, px + 0.8, px + 0.8);
  }
  c.fillStyle = 'rgba(255,225,140,.6)'; c.globalAlpha = 1;
  for (let i = 0; i < cols * rows; i++) {
    if (!bridge[i]) continue;
    const [x, y] = toScreen(ox + (i % cols) * cs, oy + ((i / cols) | 0) * cs);
    c.fillRect(x - 0.4, y - 0.4, px + 0.8, px + 0.8);
  }
  // かべ：内側は濃い線、字の外周は白い線
  const wall = (i, d, x, y) => {
    const [a, b] = d === 0 ? [[x, y], [x + px, y]] : d === 1 ? [[x + px, y], [x + px, y + px]] : d === 2 ? [[x, y + px], [x + px, y + px]] : [[x, y], [x, y + px]];
    c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
  };
  const lw = Math.max(1.4, px * 0.15);
  c.lineCap = 'square';
  for (const outer of [false, true]) {
    c.beginPath();
    for (let i = 0; i < cols * rows; i++) {
      if (!usable[i]) continue;
      const cc = i % cols, rr = (i / cols) | 0;
      const [x, y] = toScreen(ox + cc * cs, oy + rr * cs);
      for (let d = 0; d < 4; d++) {
        if (open[i] & DIRS[d].bit) continue;
        const nc = cc + DIRS[d].dx, nr = rr + DIRS[d].dy;
        const edge = nc < 0 || nr < 0 || nc >= cols || nr >= rows || !usable[nr * cols + nc];
        if (edge !== outer) continue;
        if (!edge && d >= 2) continue; // 内側のかべは隣のマスと二重に描かない（上・左側だけ描く）
        wall(i, d, x, y);
      }
    }
    c.strokeStyle = outer ? '#ffffff' : '#10102a';
    c.lineWidth = outer ? lw * 1.15 : lw;
    c.stroke();
  }
  return cv;
}

function star(c, x, y, r) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}
function drawPath(c, cells) {
  c.beginPath();
  cells.forEach((i, k) => { const [x, y] = toScreen(...cellCenter(i)); k ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.stroke();
}

function draw(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0b17';
  ctx.fillRect(0, 0, view.width, view.height);
  if (!statics) return;
  ctx.drawImage(statics, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const px = maze.cs * sc, r = Math.max(3, px * 0.34);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // 通った跡
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(2, px * 0.3);
  drawPath(ctx, trail);
  // ヒント
  if (hintPath && now < hintUntil) {
    const f = Math.min(1, (hintUntil - now) / 600);
    ctx.globalAlpha = f * (0.65 + 0.35 * Math.sin(now / 90));
    ctx.strokeStyle = '#ffee55'; ctx.shadowColor = '#ffee55'; ctx.shadowBlur = 12;
    ctx.lineWidth = Math.max(2.5, px * 0.38);
    drawPath(ctx, hintPath);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  // スタート・ゴール
  const [sx, sy] = toScreen(...cellCenter(maze.start));
  ctx.fillStyle = '#3ddc84'; ctx.strokeStyle = '#06210f'; ctx.lineWidth = Math.max(1, px * 0.1);
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill(); ctx.stroke();
  const [gx, gy] = toScreen(...cellCenter(maze.goal));
  const pulse = 1 + 0.12 * Math.sin(now / 250);
  ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#4a3200';
  star(ctx, gx, gy, r * 1.35 * pulse); ctx.fill(); ctx.stroke();
  // 現在位置（なめらかに追いかける）
  const [tx, ty] = cellCenter(pos);
  rx += (tx - rx) * 0.45; ry += (ty - ry) * 0.45;
  const [ux, uy] = toScreen(rx, ry);
  const shake = bump > 0 ? Math.sin(now / 20) * bump * px * 0.12 : 0;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d4146a'; ctx.lineWidth = Math.max(1.5, px * 0.16);
  ctx.beginPath(); ctx.arc(ux + shake, uy, r * 0.95, 0, 7); ctx.fill(); ctx.stroke();
}

// ---------- メインループ ----------
let lastT = performance.now();
function frame(now) {
  const dt = (now - lastT) / 1000; lastT = now;
  if (mode === 'play') {
    const d = stickDir >= 0 ? stickDir : held.length ? held[0] : -1;
    if (d >= 0) { if (now - lastStep >= STEP_MS) { step(d); lastStep = now; } }
    else if (runDir >= 0 && now - lastStep >= RUN_MS) { runStep(); lastStep = now; }
    if (t0 !== null && mode === 'play') { elapsed = now - t0; $('time').textContent = fmt(elapsed); }
  }
  bump = Math.max(0, bump - dt * 5);
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('on');
  draw(now);
  requestAnimationFrame(frame);
}

// ---------- ボタン ----------
function newMaze() { seed = (seed + 1 + Math.floor(Math.random() * 99999)) | 0; if (seed < 0) seed = -seed; setMaze(); }
function chooseChar(s) {
  const chars = [...s.replace(/\s/g, '')].slice(0, 2);
  if (!chars.length) { toast('字を入れてね'); return false; }
  const prev = text;
  text = chars.join('');
  try { seed = (seed + 1 + Math.floor(Math.random() * 99999)) | 0; setMaze(); }
  catch (e) { text = prev; toast(`「${chars.join('')}」は迷路にできませんでした`); setMaze(); return false; }
  $('picker').hidden = true;
  return true;
}
const openPicker = () => { $('result').hidden = true; $('picker').hidden = false; $('char').value = ''; };
$('btn-hint').onclick = hint;
$('btn-again').onclick = () => resetRun();
$('btn-new').onclick = newMaze;
$('btn-char').onclick = openPicker;
$('r-again').onclick = () => resetRun();
$('r-new').onclick = newMaze;
$('r-char').onclick = openPicker;
$('btn-close').onclick = () => { $('picker').hidden = true; if (mode === 'done') $('result').hidden = false; };
$('btn-random').onclick = () => {
  const pool = POOL.filter(c => c !== text);
  chooseChar(pool[Math.floor(Math.random() * pool.length)]);
};
$('form').onsubmit = e => { e.preventDefault(); chooseChar($('char').value); };
LEVELS.forEach((L, i) => {
  const b = document.createElement('button');
  b.textContent = L.name;
  b.onclick = () => { if (i === lv) return; lv = i; setMaze(); };
  $('levels').append(b);
});
PRESETS.forEach(s => {
  const b = document.createElement('button');
  b.textContent = s;
  b.onclick = () => chooseChar(s);
  $('presets').append(b);
});
addEventListener('resize', layout);
new ResizeObserver(layout).observe($('stage'));
document.querySelectorAll('button').forEach(b => b.addEventListener('pointerup', () => b.blur()));

// ---------- はじめる ----------
(async () => {
  await loadFont();
  try { setMaze(); } catch (e) { console.error(e); text = '龍'; setMaze(); }
  requestAnimationFrame(frame);
})();
