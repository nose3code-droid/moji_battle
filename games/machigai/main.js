// まちがい字さがし：画面・進行・保存。盤の作り方は logic.js、ペアは pairs.js
// 描画は Canvas 2D。文字はフォントの輪郭（glyph.js）から作った Path2D で塗る
// （three / opentype / フォントを CDN から読めないときは、ふつうの文字描画で遊べる）
import { FONT_URL } from '../../config.js';
import { PAIRS } from './pairs.js';
import {
  ROUNDS, STAGE_COUNT, TA_TIME, TA_FIND, TA_MISS, HINT_COST,
  makeRng, sizeFor, stageSize, taProgress, stageProgress, pickPair, buildBoard, starsFor,
} from './logic.js';

const SAVE_KEY = 'moji_machigai.v1';
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);

// ---------- 保存：タイムアタックのハイスコア、ステージの星、ずかん ----------
let save = { best: null, stars: {}, dex: {} };
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (d && typeof d === 'object') save = { best: d.best || null, stars: d.stars || {}, dex: d.dex || {} };
} catch (e) { /* 保存データが無い・壊れていてもはじめから遊べる */ }
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続行 */ } }

// ---------- 文字の輪郭（Path2D） ----------
let font = null, glyphPolygons = null;
const pathCache = new Map();
function glyphPath(ch) {
  if (!font) return null;
  if (pathCache.has(ch)) return pathCache.get(ch);
  let res = null;
  try {
    if (font.charToGlyph(ch).index > 0) {
      const polys = glyphPolygons(font, ch, 1);
      if (polys.length) {
        const path = new Path2D();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        const add = pts => {
          pts.forEach((p, i) => (i ? path.lineTo(p.x, -p.y) : path.moveTo(p.x, -p.y)));
          path.closePath();
        };
        for (const { outer, holes } of polys) {
          add(outer);
          for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, -q.y); y1 = Math.max(y1, -q.y); }
          for (const h of holes) add(h);
        }
        res = { path, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
      }
    }
  } catch (e) { res = null; }
  pathCache.set(ch, res);
  return res;
}

// 1文字を描く。ゆれ（位置・傾き・大きさ・太さ）は cell の値を使う。太さは輪郭の外側/内側に線を引いて変える
const FALLBACK_FONT = '"MojiMachigai","Noto Sans JP","Hiragino Sans","Yu Gothic","WenQuanYi Zen Hei",sans-serif';
function drawGlyph(ctx, c, x, y, size, fill, bg) {
  const gp = glyphPath(c.ch);
  ctx.save();
  ctx.translate(x + c.dx * size, y + c.dy * size);
  ctx.rotate(c.rot);
  ctx.scale(c.sc, c.sc);
  ctx.fillStyle = fill;
  if (gp) {
    ctx.scale(size, size); ctx.translate(-gp.cx, -gp.cy);
    ctx.fill(gp.path, 'evenodd');
    if (Math.abs(c.w) > 0.0005) {
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.abs(c.w) * 2;
      ctx.strokeStyle = c.w > 0 ? fill : bg; // 太く＝同じ色で縁取り、細く＝地の色で削る
      ctx.stroke(gp.path);
    }
  } else {
    ctx.font = `bold ${size}px ${FALLBACK_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.ch, 0, size * 0.04);
    if (Math.abs(c.w) > 0.0005) {
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.abs(c.w) * 2 * size;
      ctx.strokeStyle = c.w > 0 ? fill : bg;
      ctx.strokeText(c.ch, 0, size * 0.04);
    }
  }
  ctx.restore();
}

async function loadFont() {
  try {
    const [g, ot] = await Promise.all([import('../../glyph.js'), import('opentype')]);
    const buf = await (await fetch(FONT_URL)).arrayBuffer();
    glyphPolygons = g.glyphPolygons;
    font = ot.parse(buf);
    try {
      const face = new FontFace('MojiMachigai', buf.slice(0));
      document.fonts.add(await face.load());
    } catch (e) { /* DOM の文字は代わりのフォントで出る */ }
    pathCache.clear();
    $('load-state').textContent = '';
  } catch (e) {
    font = null;
    $('load-state').textContent = '（フォントを読めなかったので、ふつうの文字で表示します）';
  }
}

// ---------- ゲーム状態 ----------
// g: { mode:'ta'|'stage', stage, k(見つけた数), round, misses, score, time, board, locked, hinted, recent, rng, over }
let g = null, paused = true;
let flash = null; // { i, kind:'ok'|'ng', until }

function newGame(mode, stage = 0, seed = (Math.random() * 2 ** 32) >>> 0) {
  g = { mode, stage, k: 0, round: 0, misses: 0, score: 0, time: TA_TIME, board: null, locked: false, hinted: false, recent: [], rng: makeRng(seed), over: false };
  flash = null;
  nextBoard();
  $('tipbar').className = 'empty'; $('tipbar').textContent = 'まぎれた字を見つけてタップ！ 見つけると、見分けるポイントがここに出ます。';
  $('mode-name').textContent = mode === 'ta' ? 'タイムアタック' : `ステージ ${stage + 1}`;
  $('btn-hint').hidden = false;
  paused = false;
  updateStat();
}
function nextBoard() {
  const n = g.mode === 'ta' ? sizeFor(g.k) : stageSize(g.stage);
  const p = g.mode === 'ta' ? taProgress(g.k) : stageProgress(g.stage);
  const pair = pickPair(PAIRS, p, g.rng, g.recent);
  g.recent.push(pair.id); if (g.recent.length > 6) g.recent.shift();
  g.board = buildBoard(pair, n, g.rng);
  g.locked = false; g.hinted = false;
  $('btn-hint').disabled = false;
}

function updateStat() {
  if (!g) return;
  if (g.mode === 'ta') {
    const t = Math.max(0, Math.ceil(g.time));
    $('stat').innerHTML = `のこり <b class="${t <= 10 ? 'low' : ''}">${t}</b>秒<br>${g.score}点 ／ ${g.k}問クリア`;
  } else {
    $('stat').innerHTML = `もんだい <b>${g.round + 1}</b>/${ROUNDS}<br>ミス ${g.misses}`;
  }
}

function showTip(pair) {
  const t = $('tipbar');
  t.className = ''; t.textContent = '';
  const pr = el('span', 'pair glyph', `${pair.a}≠${pair.b}`);
  t.append(pr, el('span', '', pair.tip || 'よく似た字。形をじっくりくらべてみよう。'));
}

function tap(i) {
  if (!g || g.over || g.locked || paused) return;
  const b = g.board;
  if (i === b.oddIndex) found(); else miss(i);
}
function found() {
  const b = g.board;
  g.locked = true;
  flash = { i: b.oddIndex, kind: 'ok', until: performance.now() + 450 };
  save.dex[b.pair.id] = (save.dex[b.pair.id] || 0) + 1;
  showTip(b.pair);
  if (g.mode === 'ta') { g.k++; g.score += 100 + 10 * b.n; g.time += TA_FIND; }
  else g.round++;
  writeSave(); updateStat();
  setTimeout(() => {
    if (!g || g.over) return;
    if (g.mode === 'ta') nextBoard();
    else if (g.round >= ROUNDS) finishStage();
    else nextBoard();
    updateStat();
  }, 450);
}
function miss(i) {
  flash = { i, kind: 'ng', until: performance.now() + 350 };
  if (g.mode === 'ta') { g.time -= TA_MISS; if (g.time <= 0) { g.time = 0; finishTA(); } }
  else g.misses++;
  updateStat();
}
function useHint() {
  if (!g || g.over || g.locked || g.hinted || paused) return;
  g.hinted = true;
  $('btn-hint').disabled = true;
  if (g.mode === 'ta') g.score = Math.max(0, g.score - HINT_COST); else g.misses++;
  updateStat();
}

// ---------- 結果 ----------
function showResult({ title, starsN, html, next }) {
  paused = true;
  $('result-title').textContent = title;
  $('result-stars').innerHTML = starsN == null ? '' : [0, 1, 2].map(k => `<span class="${k < starsN ? '' : 'off'}">★</span>`).join('');
  $('result-sub').innerHTML = html;
  $('result-next').hidden = !next;
  $('result').hidden = false;
}
function finishTA() {
  g.over = true;
  const rec = save.best;
  const isNew = !rec || g.score > rec.score;
  if (isNew) save.best = { score: g.score, found: g.k };
  writeSave();
  showResult({
    title: 'タイムアップ！', starsN: null, next: false,
    html: `<div class="big">${g.k}問</div>クリア　<b>${g.score}</b>点${isNew ? '<br><span class="new">ハイスコア！</span>' : `<br>ハイスコア ${rec.score}点（${rec.found}問）`}`,
  });
}
function finishStage() {
  g.over = true;
  const s = starsFor(g.misses);
  if (s > (save.stars[g.stage] || 0)) save.stars[g.stage] = s;
  writeSave();
  showResult({
    title: `ステージ ${g.stage + 1} クリア！`, starsN: s, next: g.stage + 1 < STAGE_COUNT,
    html: `ミス ${g.misses}回（ヒントも1回に数えます）<br>★3＝ミスなし ／ ★2＝2回まで`,
  });
}

// ---------- 画面の切りかえ ----------
function openTitle() {
  g = null; paused = true;
  $('result').hidden = $('stages').hidden = $('book').hidden = true;
  const b = save.best;
  $('best-ta').textContent = b ? `ハイスコア ${b.score}点（${b.found}問）` : '';
  const total = Object.values(save.stars).reduce((s, v) => s + v, 0);
  $('stars-total').textContent = `★ ${total} / ${STAGE_COUNT * 3}`;
  $('title').hidden = false;
  $('mode-name').textContent = ''; $('stat').textContent = '';
  $('btn-hint').hidden = true;
}
function openStages() {
  const grid = $('stage-grid'); grid.textContent = '';
  for (let i = 0; i < STAGE_COUNT; i++) {
    const open = i === 0 || save.stars[i - 1] > 0;
    const b = el('button', 'stage-btn');
    b.append(el('b', '', String(i + 1)), el('small', '', open ? stars(save.stars[i] || 0) : '🔒'));
    b.disabled = !open; b.dataset.stage = i;
    b.onclick = () => { $('stages').hidden = true; $('title').hidden = true; newGame('stage', i); };
    grid.append(b);
  }
  $('title').hidden = true; $('stages').hidden = false;
}
let bookFrom = null;
function openBook() {
  bookFrom = { paused, title: !$('title').hidden };
  paused = true;
  const list = $('book-list'); list.textContent = '';
  let n = 0;
  for (const p of PAIRS) {
    const got = save.dex[p.id];
    if (got) n++;
    const c = el('div', 'pcard' + (got ? '' : ' lock'));
    c.append(el('div', 'k glyph', got ? `${p.a}≠${p.b}` : '？≠？'));
    c.append(el('div', 'lv', '★'.repeat(p.lv)));
    c.append(el('div', '', got ? (p.tip || 'よく似た字。形をじっくりくらべてみよう。') : 'まだ見つけていない'));
    list.append(c);
  }
  $('book-count').textContent = `${n} / ${PAIRS.length}`;
  $('title').hidden = true; $('book').hidden = false;
}
function closeBook() {
  $('book').hidden = true;
  if (bookFrom.title) $('title').hidden = false; else paused = bookFrom.paused;
}

$('go-ta').onclick = () => { $('title').hidden = true; newGame('ta'); };
$('go-stage').onclick = openStages;
$('go-book').onclick = openBook;
$('btn-book').onclick = openBook;
$('book-close').onclick = closeBook;
$('stages-close').onclick = () => { $('stages').hidden = true; $('title').hidden = false; };
$('btn-hint').onclick = useHint;
$('btn-quit').onclick = openTitle;
$('result-title-btn').onclick = openTitle;
$('result-retry').onclick = () => { $('result').hidden = true; newGame(g.mode, g.stage); };
$('result-next').onclick = () => { $('result').hidden = true; newGame('stage', g.stage + 1); };

// ---------- 描画 ----------
const canvas = $('view'), ctx = canvas.getContext('2d');
let side = 300, dpr = 1;
function resize() {
  const wrap = $('wrap');
  side = Math.max(160, Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight)));
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.style.width = canvas.style.height = side + 'px';
  canvas.width = canvas.height = Math.round(side * dpr);
}
addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe($('wrap'));

function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, side, side);
  ctx.fillStyle = '#e9d6b3';
  ctx.fillRect(0, 0, side, side);
  if (!g || !g.board) return;
  const { n, cells, hue, oddIndex } = g.board;
  const cs = side / n, gap = Math.max(2, cs * 0.06);
  const bg = '#fffaf0';
  cells.forEach((c, i) => {
    const x = (i % n) * cs, y = Math.floor(i / n) * cs;
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(x + gap / 2, y + gap / 2, cs - gap, cs - gap, cs * 0.12); ctx.fill();
    const fill = `hsl(${(hue + c.dh + 360) % 360},45%,${28 + c.dl}%)`;
    drawGlyph(ctx, c, x + cs / 2, y + cs / 2, cs * 0.72, fill, bg);
  });
  // ヒント：正解のマスをやさしく光らせる
  if (g.hinted && !g.locked) {
    const x = (oddIndex % n) * cs, y = Math.floor(oddIndex / n) * cs;
    ctx.fillStyle = `rgba(255,200,0,${0.18 + 0.14 * Math.sin(now / 250)})`;
    ctx.beginPath(); ctx.roundRect(x + gap / 2, y + gap / 2, cs - gap, cs - gap, cs * 0.12); ctx.fill();
  }
  if (flash && now < flash.until) {
    const x = (flash.i % n) * cs, y = Math.floor(flash.i / n) * cs;
    ctx.fillStyle = flash.kind === 'ok' ? 'rgba(46,160,67,.45)' : 'rgba(214,0,28,.4)';
    ctx.beginPath(); ctx.roundRect(x + gap / 2, y + gap / 2, cs - gap, cs - gap, cs * 0.12); ctx.fill();
    if (flash.kind === 'ok') {
      ctx.strokeStyle = '#2b8a3e'; ctx.lineWidth = Math.max(3, cs * 0.06);
      ctx.beginPath(); ctx.roundRect(x + gap / 2, y + gap / 2, cs - gap, cs - gap, cs * 0.12); ctx.stroke();
    }
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (g && !paused && !g.over && !g.locked && g.mode === 'ta') {
    g.time -= dt;
    if (g.time <= 0) { g.time = 0; updateStat(); finishTA(); } else updateStat();
  }
  draw(now);
  requestAnimationFrame(loop);
}

canvas.addEventListener('pointerdown', e => {
  if (!g || !g.board) return;
  const r = canvas.getBoundingClientRect();
  const n = g.board.n;
  const cx = Math.floor((e.clientX - r.left) / r.width * n), cy = Math.floor((e.clientY - r.top) / r.height * n);
  if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
  e.preventDefault();
  tap(cy * n + cx);
});

// ---------- 起動 ----------
resize();
openTitle();
requestAnimationFrame(loop);
loadFont();

// 自動テスト用（?test を付けたときだけ公開）
if (new URLSearchParams(location.search).has('test')) {
  window.__machigai = {
    fontLoaded: () => !!font,
    state: () => g && ({ mode: g.mode, k: g.k, round: g.round, misses: g.misses, score: g.score, time: g.time, n: g.board.n, odd: g.board.oddIndex, pair: g.board.pair.id, oddCh: g.board.odd, base: g.board.base, over: g.over, locked: g.locked, paused }),
    cellCenter: i => { const r = canvas.getBoundingClientRect(), n = g.board.n; return { x: r.left + (i % n + 0.5) * r.width / n, y: r.top + (Math.floor(i / n) + 0.5) * r.height / n }; },
    setTime: t => { g.time = t; },
    save: () => JSON.parse(JSON.stringify(save)),
  };
}
