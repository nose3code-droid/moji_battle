// 文字そろえ：3マッチパズル。盤面のルールは logic.js、レシピは recipes.js、面は stages.js
// 描画は Canvas 2D。文字はフォントの輪郭（glyph.js）から作った Path2D で塗る
// （three / opentype / フォントを CDN から読めないときは、ふつうの文字描画で遊べる）
import { FONT_URL } from '../../config.js';
import { CHARS, RECIPES, SPECIALS, recipeOf } from './recipes.js';
import { STAGES, goalText, starsFor } from './stages.js';
import {
  SIZE, stageInfo, makeRng, newBoard, listMoves, previewMove, playMove, adjacent,
  newProgress, applyWavesToProgress, goalDone,
} from './logic.js';

const SAVE_KEY = 'moji_soroe.save';
const SPEED = new URLSearchParams(location.search).has('fast') ? 0.12 : 1; // ?fast は自動テスト用
const $ = id => document.getElementById(id);

// ---------- 保存 ----------
let save = { stars: {}, cards: {}, best: {} };
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (d && typeof d === 'object') save = { stars: d.stars || {}, cards: d.cards || {}, best: d.best || {} };
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
function drawGlyph(ctx, ch, x, y, size, fill) {
  ctx.fillStyle = fill;
  const gp = glyphPath(ch);
  if (gp) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(size, size); ctx.translate(-gp.cx, -gp.cy);
    ctx.fill(gp.path, 'evenodd');
    ctx.restore();
  } else {
    ctx.font = `bold ${size}px "Noto Sans JP","Hiragino Sans","Yu Gothic","WenQuanYi Zen Hei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + size * 0.04);
  }
}

async function loadFont() {
  try {
    const [g, ot] = await Promise.all([import('../../glyph.js'), import('opentype')]);
    const buf = await (await fetch(FONT_URL)).arrayBuffer();
    glyphPolygons = g.glyphPolygons;
    font = ot.parse(buf);
    try {
      const face = new FontFace('MojiSoroe', buf.slice(0));
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
let stageIdx = 0, stage = STAGES[0], info = stageInfo(stage), rng = makeRng(1);
let grid = [], prog = newProgress(stage), left = 0, busy = true, playing = false;
let selected = null, hint = null, newCards = [], animating = false;
const sprites = new Map(); // タイルid → { tile, x, y, sc, al, glow }
const dbg = { waves: 0, maxChain: 0, made: [], created: [], exploded: 0, fell: 0, shuffles: 0 }; // 自動テストが見る記録
const tweens = [], fxs = []; // アニメ・演出

// ---------- アニメーション ----------
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const wait = ms => new Promise(r => setTimeout(r, ms * SPEED));
function tween(ms, fn, ease = easeOut) {
  return new Promise(res => tweens.push({ t0: performance.now(), ms: ms * SPEED, fn, ease, res }));
}
function stepTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i], t = w.ms <= 0 ? 1 : Math.min(1, (now - w.t0) / w.ms);
    w.fn(w.ease(t));
    if (t >= 1) { tweens.splice(i, 1); w.res(); }
  }
}

function spawnSprite(tile, x, y) {
  const s = { tile, x, y, sc: 1, al: 1, glow: 0 };
  sprites.set(tile.id, s);
  return s;
}
function rebuildSprites(drop) {
  sprites.clear();
  const ps = [];
  grid.forEach((row, r) => row.forEach((t, c) => {
    const s = spawnSprite(t, c, drop ? r - SIZE - Math.random() * 2 : r);
    if (drop) ps.push([s, r]);
  }));
  if (!drop) return Promise.resolve();
  const from = ps.map(([s]) => s.y);
  return tween(650, k => ps.forEach(([s, r], i) => { s.y = from[i] + (r - from[i]) * k; }));
}

// ---------- 描画 ----------
const canvas = $('view'), ctx = canvas.getContext('2d');
let side = 300, cell = 37, dpr = 1;
function resize() {
  const wrap = $('wrap');
  side = Math.max(160, Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight)));
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.style.width = canvas.style.height = side + 'px';
  canvas.width = canvas.height = Math.round(side * dpr);
  cell = side / SIZE;
}
addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe($('wrap')); // 上のゴール表示の行数が変わっても盤を合わせ直す

const hsl = (c, l, a = 1) => { const d = CHARS[c] || { hue: 0, sat: 0 }; return `hsla(${d.hue},${d.sat}%,${l}%,${a})`; };
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawTile(s, now) {
  const { tile } = s;
  const px = (s.x + 0.5) * cell, py = (s.y + 0.5) * cell, size = (cell - 5) * s.sc;
  if (size <= 0 || s.al <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, s.al));
  const x = px - size / 2, y = py - size / 2, rad = size * 0.2;
  if (tile.sp) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 240 + tile.id);
    ctx.shadowColor = tile.sp === 'bomb' ? '#ff6a00' : '#ffd43b';
    ctx.shadowBlur = 8 + pulse * 10;
  }
  if (s.glow > 0) { ctx.shadowColor = '#ffd43b'; ctx.shadowBlur = 22 * s.glow; }
  rr(x, y, size, size, rad);
  ctx.fillStyle = tile.sp === 'bomb' ? '#ffe0c2' : hsl(tile.c, 90);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (tile.sp === 'rainbow') {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    ['#f03e3e', '#f59f00', '#fcc419', '#40c057', '#228be6', '#7950f2'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(3, size * 0.09);
  } else {
    ctx.strokeStyle = tile.sp === 'bomb' ? '#e8590c' : hsl(tile.c, 62);
    ctx.lineWidth = tile.sp ? Math.max(3, size * 0.09) : 2;
  }
  rr(x, y, size, size, rad); ctx.stroke();
  drawGlyph(ctx, tile.c, px, py + size * 0.01, size * 0.72, hsl(tile.c, 24));
  if (tile.sp) { // 右上に「爆」「虹」の印
    const bx = x + size * 0.8, by = y + size * 0.2, br = size * 0.21;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = tile.sp === 'bomb' ? '#d9480f' : '#7048e8'; ctx.fill();
    drawGlyph(ctx, SPECIALS[tile.sp].ch, bx, by, br * 1.5, '#fff');
  }
  ctx.restore();
}

function render(now) {
  stepTweens(now);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, side, side);
  rr(0, 0, side, side, 14); ctx.fillStyle = '#e8d6ae'; ctx.fill();
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    rr(c * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3, 7);
    ctx.fillStyle = (r + c) % 2 ? '#f4e8cb' : '#f9f0da'; ctx.fill();
  }
  if (playing) {
    ctx.save(); rr(0, 0, side, side, 14); ctx.clip();
    for (const s of sprites.values()) drawTile(s, now);
    if (selected) {
      ctx.strokeStyle = '#2b7de9'; ctx.lineWidth = 4;
      rr(selected[1] * cell + 2, selected[0] * cell + 2, cell - 4, cell - 4, 9); ctx.stroke();
    }
    if (hint) {
      const p = 0.5 + 0.5 * Math.sin((now - hint.t0) / 180);
      ctx.strokeStyle = `rgba(232,89,12,${0.5 + p * 0.5})`; ctx.lineWidth = 3 + p * 3;
      for (const [r, c] of hint.cells) { rr(c * cell + 2, r * cell + 2, cell - 4, cell - 4, 9); ctx.stroke(); }
    }
    drawFx(now);
    ctx.restore();
  }
  requestAnimationFrame(render);
}

// 演出：粒・衝撃波・浮かぶ文字・漢字完成
function drawFx(now) {
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], t = (now - f.t0) / (f.dur * SPEED);
    if (t >= 1) { fxs.splice(i, 1); continue; }
    if (t < 0) continue;
    ctx.save();
    if (f.type === 'p') { // 粒
      const x = (f.x + 0.5) * cell + f.vx * t * cell, y = (f.y + 0.5) * cell + (f.vy * t + 2.2 * t * t) * cell;
      ctx.globalAlpha = 1 - t; ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(x, y, cell * 0.07 * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
    } else if (f.type === 'ring') {
      ctx.globalAlpha = 1 - t; ctx.strokeStyle = f.color; ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc((f.x + 0.5) * cell, (f.y + 0.5) * cell, cell * f.r * easeOut(t), 0, Math.PI * 2); ctx.stroke();
    } else if (f.type === 'text') {
      ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
      ctx.font = `bold ${cell * f.size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.fillStyle = f.color;
      const x = (f.x + 0.5) * cell, y = (f.y + 0.5) * cell - t * cell * 0.9;
      ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y);
    } else if (f.type === 'kanji') { // 完成した漢字：大きく光る
      const grow = t < 0.2 ? easeOut(t / 0.2) * 1.25 : 1.25 - 0.25 * Math.min(1, (t - 0.2) / 0.15);
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const x = side / 2, y = side / 2 - cell * 0.4, sz = cell * 4.2 * grow;
      const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 0.9);
      g.addColorStop(0, 'rgba(255,240,150,.85)'); g.addColorStop(1, 'rgba(255,240,150,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, side, side);
      ctx.shadowColor = '#f59f00'; ctx.shadowBlur = 28;
      drawGlyph(ctx, f.ch, x, y, sz, '#c2410c');
      ctx.shadowBlur = 0;
      ctx.font = `bold ${cell * 0.55}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.fillStyle = '#7c2d12';
      ctx.strokeText(`「${f.ch}」かんせい！`, x, y + sz * 0.62); ctx.fillText(`「${f.ch}」かんせい！`, x, y + sz * 0.62);
    }
    ctx.restore();
  }
}
const addFx = o => fxs.push({ t0: performance.now(), ...o });
function burst(r, c, color, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 0.8;
    addFx({ type: 'p', x: c, y: r, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, color, dur: 600 });
  }
}

// ---------- 画面（HUD・メニュー） ----------
let toastTimer = 0;
function toast(t, ms = 1800) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function updateHud() {
  $('stage-name').innerHTML = `面${stageIdx + 1}　${stage.name}<br><small>スコア ${prog.score}</small>`;
  $('moves').textContent = left;
  $('goals').innerHTML = stage.goals.map((g, i) => {
    const v = Math.min(prog.goals[i], g.n);
    return `<span class="goal${v >= g.n ? ' done' : ''}">${goalText(g)} <b>${v}/${g.n}</b></span>`;
  }).join('');
}

function openOverlay(id) { for (const o of document.querySelectorAll('.overlay')) o.hidden = o.id !== id; }
function closeOverlays() { for (const o of document.querySelectorAll('.overlay')) o.hidden = true; }

const unlocked = i => i === 0 || (save.stars[i - 1] || 0) > 0;
function buildStageGrid() {
  $('stage-grid').innerHTML = STAGES.map((s, i) => {
    const st = save.stars[i] || 0;
    return `<button class="stage-btn${unlocked(i) ? '' : ' locked'}" data-i="${i}" ${unlocked(i) ? '' : 'disabled'} title="${s.name}">` +
      `<b>${i + 1}</b><small>${unlocked(i) ? '★'.repeat(st) + '☆'.repeat(3 - st) : '🔒'}</small></button>`;
  }).join('');
}
function showSelect() { buildStageGrid(); $('title-close').hidden = !playing; openOverlay('title'); }

function buildBook() {
  const got = RECIPES.filter(r => save.cards[r.ch]).length;
  $('book-count').textContent = `${got} / ${RECIPES.length}`;
  $('book-list').innerHTML = RECIPES.map(r => {
    const n = save.cards[r.ch];
    const how = r.shape === 'line' ? `「${r.parts[0]}」を3つ そろえる` : `「${r.parts[0]}」と「${r.parts[1]}」を となりあわせに`;
    if (!n) return `<div class="kcard lock"><div class="k glyph">？</div><div class="parts">${r.parts.join('＋')}</div><div>${how}</div></div>`;
    return `<div class="kcard"><div class="k glyph">${r.ch}</div><div class="parts">${r.parts.join('＋')}　<b>${r.yomi}</b></div><div>${r.desc}</div><div>つくった回数：<b>${n}</b></div></div>`;
  }).join('');
  $('book-special').innerHTML = Object.values(SPECIALS).map(s => `<div><b class="glyph">${s.ch}</b>　${s.desc}</div>`).join('');
}
function showBook() { buildBook(); openOverlay('book'); }

// ---------- 面のはじまり ----------
async function startStage(i) {
  if (animating) return;
  animating = true;
  stageIdx = i; stage = STAGES[i]; info = stageInfo(stage);
  rng = makeRng((Date.now() ^ (i * 2654435761)) >>> 0);
  grid = newBoard(info, rng);
  prog = newProgress(stage); left = stage.moves; newCards = [];
  selected = null; hint = null; fxs.length = 0;
  closeOverlays(); playing = true; busy = true;
  updateHud();
  await rebuildSprites(true);
  animating = false; busy = false;
}

// ---------- 1手の演出 ----------
async function doMove(a, b) {
  if (busy || animating) return;
  busy = animating = true; selected = null; hint = null;
  const res = playMove(grid, a, b, info, rng);
  const sa = sprites.get(grid[a[0]][a[1]].id), sb = sprites.get(grid[b[0]][b[1]].id);
  const swap = async (from) => {
    const ax = sa.x, ay = sa.y, bx = sb.x, by = sb.y;
    await tween(from ? 160 : 150, k => { sa.x = ax + (bx - ax) * k; sa.y = ay + (by - ay) * k; sb.x = bx + (ax - bx) * k; sb.y = by + (ay - by) * k; }, easeIO);
  };
  await swap();
  if (!res.valid) { // 何も消えない手は元に戻す
    await swap(true);
    toast('そろわない手は、元にもどるよ', 1200);
    busy = animating = false;
    return;
  }
  left--;
  for (const w of res.waves) await playWave(w);
  grid = res.grid;
  if (res.shuffle) await playShuffle(res.shuffle);
  updateHud();
  if (goalDone(stage, prog)) { await wait(500); finish(true); return; }
  if (left <= 0) { await wait(400); finish(false); return; }
  busy = animating = false;
}

async function playWave(w) {
  dbg.waves++; dbg.maxChain = Math.max(dbg.maxChain, w.chain); dbg.made.push(...w.made.map(m => m.ch));
  dbg.created.push(...w.create.map(c => c.kind)); dbg.exploded += w.explosions.length; dbg.fell += w.fall.length + w.spawn.length;
  // 漢字の完成：材料が光ってから、大きく表示
  for (const m of w.made) {
    const sp = w.clear.filter(c => m.cells.some(([r, cc]) => r === c.r && cc === c.c)).map(c => sprites.get(c.tile.id));
    sp.forEach(s => { s.glow = 1; });
    const [cr, cc] = [m.cells.reduce((s, x) => s + x[0], 0) / m.cells.length, m.cells.reduce((s, x) => s + x[1], 0) / m.cells.length];
    addFx({ type: 'kanji', ch: m.ch, dur: 1500 });
    addFx({ type: 'text', text: `+${m.score * w.chain}`, x: cc, y: cr, size: 0.6, color: '#c2410c', dur: 1000 });
    if (!save.cards[m.ch]) { newCards.push(m.ch); toast(`漢字カード「${m.ch}」を手に入れた！`, 2400); }
    save.cards[m.ch] = (save.cards[m.ch] || 0) + 1;
  }
  if (w.made.length) { writeSave(); await wait(520); }
  for (const e of w.explosions) addFx({ type: 'ring', x: e.c, y: e.r, r: e.kind === 'bomb' ? 1.8 : 4, color: e.kind === 'bomb' ? '#ff6a00' : '#7048e8', dur: 600 });
  if (w.chain > 1) addFx({ type: 'text', text: `${w.chain}れんさ！`, x: SIZE / 2 - 0.5, y: 1.5, size: 0.8 + Math.min(w.chain, 5) * 0.08, color: '#d9480f', dur: 1100 });

  // 消える
  const clearing = w.clear.map(c => { const s = sprites.get(c.tile.id); burst(c.r, c.c, hsl(c.tile.c, 55), 5); return s; });
  for (const cr of w.create) { // 特殊ブロックができる
    const s = sprites.get(cr.id);
    s.tile = { ...s.tile, sp: cr.kind };
    addFx({ type: 'ring', x: cr.c, y: cr.r, r: 1, color: '#f59f00', dur: 500 });
    tween(380, k => { s.sc = 1 + (1 - k) * 0.6; });
  }
  await tween(260, k => clearing.forEach(s => { s.sc = 1 - 0.7 * k; s.al = 1 - k; }));
  for (const c of w.clear) sprites.delete(c.tile.id);

  // 得点・ゴールの進み
  applyWavesToProgress(stage, prog, [w]);
  updateHud();
  if (w.gain && !w.made.length) {
    const c = w.clear[Math.floor(w.clear.length / 2)];
    if (c) addFx({ type: 'text', text: `+${w.gain}`, x: c.c, y: c.r, size: 0.5, color: '#c2410c', dur: 800 });
  }

  // 落ちる・補充
  const moves = [];
  for (const f of w.fall) { const s = sprites.get(f.id); if (s) moves.push([s, s.y, f.to]); }
  for (const sp of w.spawn) { const s = spawnSprite(sp.tile, sp.c, sp.from); moves.push([s, sp.from, sp.to]); }
  if (moves.length) await tween(320, k => moves.forEach(([s, y0, y1]) => { s.y = y0 + (y1 - y0) * k; }));
  for (const [s, , y1] of moves) s.y = y1;
  for (const s of sprites.values()) s.glow = 0;
}

async function playShuffle(sh) {
  dbg.shuffles++;
  toast('動かせる手がないので、字を混ぜ直したよ', 2200);
  await wait(500);
  if (sh.regenerated) {
    sprites.clear();
    await rebuildSprites(true);
    return;
  }
  const to = [];
  sh.grid.forEach((row, r) => row.forEach((t, c) => { const s = sprites.get(t.id); if (s) to.push([s, s.x, s.y, c, r]); }));
  await tween(600, k => to.forEach(([s, x0, y0, c, r]) => { s.x = x0 + (c - x0) * k; s.y = y0 + (r - y0) * k; }), easeIO);
}

// ---------- クリア・失敗 ----------
function finish(win) {
  busy = true; animating = false;
  const stars = win ? starsFor(left, stage.moves) : 0;
  if (win) {
    save.stars[stageIdx] = Math.max(save.stars[stageIdx] || 0, stars);
    save.best[stageIdx] = Math.max(save.best[stageIdx] || 0, prog.score);
    writeSave();
  }
  $('result-title').textContent = win ? `面${stageIdx + 1} クリア！` : 'ざんねん…手数ぎれ';
  $('result-stars').innerHTML = win ? [1, 2, 3].map(n => `<span class="${n <= stars ? '' : 'off'}">★</span>`).join('') : '';
  $('result-sub').innerHTML = `スコア ${prog.score}${win ? `　のこり ${left} 手` : ''}` +
    (newCards.length ? `<br>新しい漢字カード：${newCards.map(c => `<span class="newcard glyph">${c}</span>`).join('')}` : '') +
    (win ? '' : '<br>ゴールに届かなかったよ。もう一度ちょうせんしよう');
  $('result-next').hidden = !(win && stageIdx + 1 < STAGES.length);
  openOverlay('result');
}

function showHint() {
  if (busy || !playing) return;
  const moves = listMoves(grid, info.recipes);
  if (!moves.length) return;
  let best = moves[0], bv = -1;
  for (const [a, b] of moves) {
    const w = previewMove(grid, a, b, info);
    const v = w.made.length * 50 + w.create.length * 20 + w.clear.length + Math.random();
    if (v > bv) { bv = v; best = [a, b]; }
  }
  hint = { cells: best, t0: performance.now() };
  selected = null;
}

// ---------- 入力（スワイプ／タップ→タップ） ----------
let drag = null;
const cellAt = e => {
  const rc = canvas.getBoundingClientRect();
  const c = Math.floor((e.clientX - rc.left) / rc.width * SIZE), r = Math.floor((e.clientY - rc.top) / rc.height * SIZE);
  return r >= 0 && c >= 0 && r < SIZE && c < SIZE ? [r, c] : null;
};
canvas.addEventListener('pointerdown', e => {
  if (busy || !playing) return;
  const p = cellAt(e);
  if (!p) return;
  hint = null;
  if (selected && adjacent(selected, p)) { const from = selected; selected = null; doMove(from, p); return; }
  const same = selected && selected[0] === p[0] && selected[1] === p[1];
  selected = p;
  drag = { from: p, x: e.clientX, y: e.clientY, same };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 無くても動く */ }
});
canvas.addEventListener('pointermove', e => {
  if (!drag || busy) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) < cell * 0.4) return;
  const [r, c] = drag.from;
  const to = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
  drag = null; selected = null;
  if (to[0] >= 0 && to[1] >= 0 && to[0] < SIZE && to[1] < SIZE) doMove([r, c], to);
});
const endDrag = () => { if (drag && drag.same) selected = null; drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; });

// ---------- ボタン ----------
$('stage-grid').addEventListener('click', e => {
  const b = e.target.closest('.stage-btn');
  if (b && !b.disabled) startStage(+b.dataset.i);
});
$('btn-hint').onclick = showHint;
$('btn-reset').onclick = () => { if (playing) startStage(stageIdx); };
$('title-close').onclick = () => { if (playing) closeOverlays(); };
$('btn-select').onclick = showSelect;
$('btn-book').onclick = () => { showBook(); };
$('title-book').onclick = showBook;
$('book-close').onclick = () => { if (playing) closeOverlays(); else showSelect(); };
$('result-next').onclick = () => startStage(stageIdx + 1);
$('result-retry').onclick = () => startStage(stageIdx);
$('result-select').onclick = showSelect;

// ---------- 起動 ----------
resize();
buildStageGrid();
openOverlay('title');
requestAnimationFrame(render);
loadFont();
busy = false;

// 自動テスト用の窓口
let dbgId = 1e9;
window.__soroe = {
  get state() { return { stageIdx, left, prog, grid, busy, playing, saved: save }; },
  listMoves: () => listMoves(grid, info.recipes),
  move: (a, b) => doMove(a, b),
  start: i => startStage(i),
  // 盤を文字列8行で置きかえる（'木' など。ほかの字は '日' で埋める）
  setBoard(rows) {
    grid = rows.map(row => [...row].map(c => ({ id: dbgId++, c })));
    sprites.clear(); grid.forEach((row, r) => row.forEach((t, c) => spawnSprite(t, c, r)));
  },
  setStageChars(chars) { stage = { ...stage, chars }; info = stageInfo(stage); },
  fontLoaded: () => !!font,
  dbg,
};
