// あ、脱出する：画面・会話・進行（物理は physics.js、部屋とセリフは rooms.js）
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { ROOMS, CHARS, STORY } from './rooms.js';
import { Sim, makeShape, DT } from './physics.js';

const SAVE_KEY = 'moji_escape.cleared';
const $ = id => document.getElementById(id);

// ---------- 進行状況（クリア済みの部屋） ----------
function loadCleared() {
  try { const a = JSON.parse(localStorage.getItem(SAVE_KEY)); if (Array.isArray(a)) return ROOMS.map((_, i) => !!a[i]); } catch { /* 無ければ初期状態 */ }
  return ROOMS.map(() => false);
}
let cleared = loadCleared();
function saveCleared() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(cleared)); } catch { /* 保存できなくても遊べる */ } }
const unlocked = i => i === 0 || cleared[i - 1];
const firstOpen = () => { const i = cleared.indexOf(false); return i < 0 ? ROOMS.length - 1 : i; };

// ---------- 読み込み ----------
await RAPIER.init();
const canvas = $('view');
const ctx = canvas.getContext('2d');
const shapes = new Map();
let loadError = '';
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error('font ' + res.status);
  const buf = await res.arrayBuffer();
  const font = opentype.parse(buf);
  try { document.fonts.add(await new FontFace('MojiEscape', buf).load()); } catch { /* 画面の字は代わりのフォントになる */ }
  for (const [ch, c] of Object.entries(CHARS)) shapes.set(ch, makeShape(font, ch, c.w, c.h));
} catch (e) {
  loadError = 'フォントを読み込めませんでした（ネットワークを確認してください）';
  console.error(e);
}

// ---------- 状態 ----------
let mode = 'title';          // title | talk | play | select | ending
let roomIdx = 0;
let sim = null;
let hintIdx = 0;
let afterTalk = null;
let talkQ = [], talkI = 0;
let toastTimer = 0;
let lastTime = performance.now(), acc = 0;

// ---------- 会話 ----------
function talk(lines, done) {
  talkQ = lines; talkI = 0; afterTalk = done; mode = 'talk';
  $('talk').hidden = false;
  showLine();
}
function showLine() {
  const [who, text] = talkQ[talkI];
  const av = $('talk-av');
  av.textContent = who;
  av.style.background = CHARS[who]?.color ?? '#888';
  $('talk-name').textContent = '「' + who + '」';
  $('talk-text').textContent = text;
}
function nextLine() {
  if (mode !== 'talk') return;
  if (++talkI < talkQ.length) { showLine(); return; }
  $('talk').hidden = true;
  mode = 'play';
  const f = afterTalk; afterTalk = null;
  f?.();
}
$('talk').addEventListener('click', nextLine);

function toast(text, ms = 6000) {
  const el = $('toast');
  el.textContent = text;
  clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => { el.textContent = ''; }, ms);
}

// ---------- 部屋 ----------
function loadRoom(i, withIntro) {
  sim?.free();
  roomIdx = i;
  sim = new Sim(RAPIER, ROOMS[i], shapes);
  hintIdx = 0;
  toast('');
  $('next-room').hidden = true;
  $('room-name').textContent = ROOMS[i].name;
  hideCards();
  $('bar').classList.add('playing');
  mode = 'play';
  camTarget = 0;
  layout();
  if (withIntro) talk(ROOMS[i].intro);
}
function hideCards() { for (const id of ['title', 'select', 'ending']) $(id).hidden = true; }

function onSolved() {
  const was = cleared[roomIdx];
  cleared[roomIdx] = true;
  saveCleared();
  const room = ROOMS[roomIdx];
  setTimeout(() => {
    if (sim?.room !== room || mode !== 'play') return;   // その間に部屋を移っていたら何もしない
    talk(room.clear, () => {
      if (roomIdx === ROOMS.length - 1) talk(STORY.ending, () => { mode = 'ending'; $('ending').hidden = false; });
      else { $('next-room').hidden = false; }
    });
  }, was ? 900 : 1400);
}

$('next-room').addEventListener('click', () => loadRoom(roomIdx + 1, true));
$('reset').addEventListener('click', () => { if (mode === 'play') loadRoom(roomIdx, false); });
$('hint').addEventListener('click', () => {
  if (mode !== 'play' || sim.solved) return;
  const hs = ROOMS[roomIdx].hints;
  toast('💡 ' + hs[hintIdx % hs.length]);
  hintIdx++;
});

// ---------- タイトル・部屋えらび ----------
function renderTitle() {
  $('lead').innerHTML = STORY.lead.map(l => l.replace(/</g, '&lt;')).join('<br>');
  const any = cleared.some(Boolean);
  $('start').textContent = loadError || (any ? 'さいしょから' : 'はじめる');
  $('start').disabled = !!loadError;
  $('continue').hidden = !any || !!loadError;
  $('to-select').hidden = !any || !!loadError;
}
function renderSelect() {
  const grid = $('room-grid');
  grid.textContent = '';
  ROOMS.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'glyph' + (cleared[i] ? ' done' : '');
    b.disabled = !unlocked(i);
    b.innerHTML = r.glyph + '<small>' + (cleared[i] ? 'クリア' : unlocked(i) ? '部屋' + (i + 1) : '🔒') + '</small>';
    b.addEventListener('click', () => loadRoom(i, !cleared[i]));
    grid.append(b);
  });
}
function openSelect() { renderSelect(); hideCards(); $('talk').hidden = true; mode = 'select'; $('select').hidden = false; }
$('rooms').addEventListener('click', openSelect);
$('to-select').addEventListener('click', openSelect);
$('end-select').addEventListener('click', openSelect);
$('select-close').addEventListener('click', () => {
  hideCards();
  if (sim) mode = 'play'; else { mode = 'title'; $('title').hidden = false; }
});
$('start').addEventListener('click', () => {
  cleared = ROOMS.map(() => false); saveCleared();
  loadRoom(0, true);
});
$('continue').addEventListener('click', () => { const i = firstOpen(); loadRoom(i, !cleared[i]); });
$('again').addEventListener('click', () => { cleared = ROOMS.map(() => false); saveCleared(); loadRoom(0, true); });
renderTitle();
$('start').disabled = !!loadError;
if (!loadError) $('start').textContent = cleared.some(Boolean) ? 'さいしょから' : 'はじめる';

// ---------- 画面 ----------
let view = { s: 30, ox: 0, oy: 0, x0: 0, y0: 0, x1: 12, y1: 7, dpr: 1 };
let camX = 0, camTarget = 0, panDrag = null;   // 幅の広い部屋を狭い画面で見るときは横にスクロールする
const MIN_SCALE = 36;                          // 1m あたりの最小の画面ピクセル数。これより小さくなるなら拡大してスクロール
function layout() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const room = ROOMS[roomIdx];
  const v = { x0: 0, y0: room.view?.y0 ?? 0, x1: room.W, y1: room.H };
  const top = 52, bottom = 10, pad = 0.3;
  const sFit = w / (v.x1 - v.x0 + pad * 2), sVert = (h - top - bottom) / (v.y1 - v.y0 + pad * 2);
  const s = Math.min(sVert, Math.max(sFit, MIN_SCALE));
  const oy = top + (h - top - bottom - s * (v.y1 - v.y0)) / 2 + s * v.y1;  // 世界の y=0 が来る画面の y
  view = { s, ox: 0, oy, dpr, ...v, w };
  updateCam(true);
}
function updateCam(snap = false) {
  const room = ROOMS[roomIdx], half = view.w / 2 / view.s;
  const scrolls = room.W > half * 2;
  const lo = half - 0.3, hi = room.W - half + 0.3;
  if (sim?.held) camTarget = sim.held.piece.body.translation().x;
  camTarget = scrolls ? Math.min(hi, Math.max(lo, camTarget)) : room.W / 2;
  camX = snap ? camTarget : camX + (camTarget - camX) * 0.15;
  view.ox = view.w / 2 - view.s * camX;
}
addEventListener('resize', layout);
layout();
const toWorld = (px, py) => ({ x: (px - view.ox) / view.s, y: (view.oy - py) / view.s });

// ---------- 操作（タップ／ドラッグ） ----------
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'play' || !sim) return;
  const p = toWorld(e.clientX, e.clientY);
  if (sim.grab(p.x, p.y)) canvas.setPointerCapture(e.pointerId);
  else { panDrag = { x: e.clientX, cam: camTarget }; canvas.setPointerCapture(e.pointerId); }   // 何も無い所をドラッグすると画面が動く
});
canvas.addEventListener('pointermove', e => {
  if (panDrag) { camTarget = panDrag.cam - (e.clientX - panDrag.x) / view.s; return; }
  if (!sim?.held) return;
  const p = toWorld(e.clientX, e.clientY);
  sim.moveTo(p.x, p.y);
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { panDrag = null; sim?.release(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- 描画 ----------
function polyPath(c, pts) {
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

function drawBackground(room) {
  const g = ctx.createLinearGradient(0, room.H, 0, 0);
  g.addColorStop(0, '#3b3f5c'); g.addColorStop(1, '#2a2d44');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, room.W, room.H);
  // 石かべのすじ
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let y = 0.8, r = 0; y < room.H; y += 0.8, r++) {
    ctx.moveTo(0, y); ctx.lineTo(room.W, y);
    for (let x = (r % 2) * 0.9; x < room.W; x += 1.8) { ctx.moveTo(x, y); ctx.lineTo(x, y + 0.8); }
  }
  ctx.stroke();
}

function drawSolids(room) {
  ctx.fillStyle = '#6d6f80'; ctx.strokeStyle = '#2a2c3a'; ctx.lineWidth = 0.06; ctx.lineJoin = 'round';
  for (const poly of room.solids) {
    ctx.beginPath(); polyPath(ctx, poly); ctx.fill(); ctx.stroke();
  }
  // 上面のふち
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 0.05;
  for (const poly of room.solids) {
    if (poly.length === 4 && poly[0][1] === poly[1][1] && poly[2][1] > poly[1][1]) {
      ctx.beginPath(); ctx.moveTo(poly[3][0], poly[3][1] - 0.025); ctx.lineTo(poly[2][0], poly[2][1] - 0.025); ctx.stroke();
    }
  }
}

function drawHazards(room, t) {
  for (const r of room.voids ?? []) {
    const yb = view.y0 - 0.2;
    const g = ctx.createLinearGradient(0, 0, 0, yb);
    g.addColorStop(0, '#1a0f14'); g.addColorStop(1, '#5a1414');
    ctx.fillStyle = g;
    ctx.fillRect(r.x0, yb, r.x1 - r.x0, -yb);
    ctx.fillStyle = '#c62828';   // 底のとげ
    ctx.beginPath();
    for (let x = r.x0; x < r.x1; x += 0.4) { ctx.moveTo(x, yb); ctx.lineTo(x + 0.2, yb + 0.5); ctx.lineTo(x + 0.4, yb); }
    ctx.fill();
  }
  for (const r of room.nograb ?? []) {
    ctx.fillStyle = 'rgba(171, 71, 255, .13)';
    ctx.fillRect(r.x0, Math.max(r.y0, view.y0 - 0.3), r.x1 - r.x0, r.y1 - Math.max(r.y0, view.y0 - 0.3));
    ctx.strokeStyle = 'rgba(224, 170, 255, .85)'; ctx.lineWidth = 0.05;
    for (let i = 0; i < 7; i++) {   // ビリビリ
      let x = r.x0 + 0.35 + ((i * 0.713 + Math.floor(t * 6) * 0.37) % 1) * (r.x1 - r.x0 - 0.7);
      let y = r.y1;
      ctx.beginPath(); ctx.moveTo(x, y);
      while (y > 0.2) { y -= 0.5 + ((x * 7.3 + y * 3.1 + t * 5) % 1) * 0.3; x += (((x * 3.7 + y * 5.1 + Math.floor(t * 12)) % 1) - 0.5) * 0.5; ctx.lineTo(x, y); }
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 20 + i);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function drawText(txt, x, y, size, color, align = 'center') {
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, -1);
  ctx.font = `900 ${size}px MojiEscape, "Noto Sans JP", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function drawPlates(sim, t) {
  for (const pl of sim.plates) {
    const prog = Math.min(1, pl.t / 0.6), color = CHARS[pl.accept].color;
    const w = pl.x1 - pl.x0;
    if (!pl.ceil) {
      ctx.fillStyle = prog >= 1 ? color : '#b8962e';
      ctx.fillRect(pl.x0, pl.surf, w, 0.12);
      ctx.fillStyle = 'rgba(255, 224, 130, .13)';  // 光の柱
      ctx.fillRect(pl.x0, pl.surf + 0.12, w, 1.4);
      drawText(pl.accept, pl.x0 + w / 2, pl.surf + 0.55, 0.62, `rgba(255,236,160,${0.35 + 0.65 * prog})`);
    } else {
      ctx.fillStyle = prog >= 1 ? color : '#b8962e';
      ctx.fillRect(pl.x0, pl.surf - 0.12, w, 0.12);
      ctx.fillStyle = 'rgba(255, 224, 130, .13)';
      ctx.fillRect(pl.x0, pl.surf - 1.3, w, 1.18);
      drawText(pl.accept, pl.x0 + w / 2, pl.surf - 0.55, 0.62, `rgba(255,236,160,${0.35 + 0.65 * prog})`);
    }
    if (prog > 0 && prog < 1) {   // たまり具合
      ctx.fillStyle = '#fff';
      ctx.fillRect(pl.x0, pl.ceil ? pl.surf - 0.2 : pl.surf + 0.14, w * prog, 0.06);
    }
  }
}

function drawDoor(sim) {
  const d = sim.room.door, w = 1.2, h = 2.3;
  const open = Math.min(1, Math.max(0, sim.solvedFor / 0.9));
  ctx.fillStyle = open > 0 ? '#fff6c8' : '#15161f';
  ctx.beginPath(); ctx.rect(d.x, d.y, w, h - w / 2); ctx.arc(d.x + w / 2, d.y + h - w / 2, w / 2, 0, Math.PI); ctx.fill();
  if (open > 0) {   // ひかり
    const g = ctx.createRadialGradient(d.x + w / 2, d.y + h / 2, 0.1, d.x + w / 2, d.y + h / 2, 2.4);
    g.addColorStop(0, 'rgba(255,250,200,.55)'); g.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = g; ctx.fillRect(d.x - 2, d.y - 1, w + 4, h + 2);
  }
  // とびら（左右に開く）
  const leaf = (w / 2) * (1 - open);
  ctx.fillStyle = '#8a5a2b'; ctx.strokeStyle = '#4a2f14'; ctx.lineWidth = 0.05;
  for (const side of [0, 1]) {
    const x0 = side ? d.x + w - leaf : d.x;
    ctx.save();
    ctx.beginPath(); ctx.rect(d.x - 0.01, d.y, w + 0.02, h - w / 2); ctx.arc(d.x + w / 2, d.y + h - w / 2, w / 2 + 0.01, 0, Math.PI); ctx.clip();
    ctx.fillRect(x0, d.y, leaf, h); ctx.strokeRect(x0, d.y, leaf, h);
    ctx.restore();
  }
  if (leaf > 0.05) drawText('いろは', d.x + w / 2, d.y + h * 0.5, 0.3, 'rgba(255,230,170,.85)');
}

function drawPiece(p, held) {
  const c = CHARS[p.ch], t = p.body.translation(), a = p.body.rotation();
  ctx.save();
  ctx.translate(t.x, t.y); ctx.rotate(a);
  if (p.flash > 0 && Math.floor(p.flash * 16) % 2) ctx.globalAlpha = 0.4;
  ctx.beginPath();
  for (const { outer, holes } of p.shape.polys) {
    for (const ring of [outer, ...holes]) {
      ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    }
  }
  ctx.fillStyle = c.color;
  ctx.fill('evenodd');
  ctx.lineJoin = 'round'; ctx.lineWidth = held ? 0.09 : 0.05;
  ctx.strokeStyle = held ? '#fff' : 'rgba(0,0,0,.55)';
  ctx.stroke();
  // 目
  const ey = p.shape.h > 1.6 ? 0.55 : 0.12, ex = Math.min(0.2, p.shape.w * 0.2);
  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * ex, ey, 0.1, 0, 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(sx * ex, ey - 0.01, 0.05, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function render(t) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#14161f';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!sim) return;
  const room = sim.room;
  ctx.setTransform(view.dpr * view.s, 0, 0, -view.dpr * view.s, view.dpr * view.ox, view.dpr * view.oy);
  drawBackground(room);
  drawDoor(sim);
  drawHazards(room, t);
  drawSolids(room);
  drawPlates(sim, t);
  for (const p of sim.pieces) drawPiece(p, sim.held?.piece === p);
  if (sim.held) {   // つまんでいる点
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.arc(sim.pointer.x, sim.pointer.y, 0.12, 0, 7); ctx.fill();
  }
}

// ---------- メインループ ----------
function frame(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (sim && (mode === 'play' || mode === 'talk')) {
    acc += dt;
    while (acc >= DT) {
      const was = sim.solved;
      sim.step();
      acc -= DT;
      if (!was && sim.solved) onSolved();
    }
  }
  updateCam();
  render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- 動作確認用（ブラウザの自動テストから使う） ----------
window.__escape = {
  get sim() { return sim; },
  get mode() { return mode; },
  ROOMS, CHARS, loadRoom, nextLine,
  toWorld, toScreen: (x, y) => ({ x: view.ox + x * view.s, y: view.oy - y * view.s }),
};
