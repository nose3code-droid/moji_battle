// 文字ジャンプ：縦スクロールのジャンプゲーム（Canvas 2D）。物理と足場の生成は world.js
import * as opentype from 'opentype';
import { glyphPolygons, shapeMetrics } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import {
  WORLD_W, VIEW_H, DT, EM, HERO_EM, KIND_NAMES, ITEM_CHARS, ENEMY_CHARS, NARROW,
  allGameChars, platformChars, heroTraits, makeSurface, createGame, step, botAxis,
} from './world.js';

const LW = 360, LH = 640, PPM = LW / WORLD_W;   // 内部解像度と 1m あたりのピクセル
const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');                 // テスト用：自動操縦
const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d');
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- セーブ ----------
const SAVE_KEY = 'moji_jump.save';
function loadSave() {
  const base = { best: 0, bestCh: '', byChar: {}, kinds: {}, chars: {} };
  try { return { ...base, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch { return base; }
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } }
let save = loadSave();

// ---------- フォント・字の形 ----------
let font = null;
const surfaces = {};          // 足場の字 → 表面
const paths = new Map();      // 字 → { path, minx, maxx, miny, maxy, polys }
function glyphInfo(ch) {
  if (paths.has(ch)) return paths.get(ch);
  const polys = glyphPolygons(font, ch, 1);
  if (!polys.length) { paths.set(ch, null); return null; }
  const path = new Path2D();
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const { outer, holes } of polys) {
    for (const ring of [outer, ...holes]) {
      ring.forEach((p, i) => { i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y); });
      path.closePath();
    }
    for (const p of outer) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
  }
  const info = { path, minx, maxx, miny, maxy, polys };
  paths.set(ch, info);
  return info;
}

// ---------- 状態 ----------
let mode = 'loading';        // loading / menu / play / over
let g = null, heroCh = '木', heroInfo = null;
let particles = [], trail = [], trailT = 0, shake = 0, flash = 0, overT = 0, hint = 0;

function selectHero(ch) {
  const info = ch && glyphInfo(ch);
  if (!info) { $('traits').textContent = ''; return null; }
  const m = shapeMetrics(info.polys);
  const t = heroTraits(m);
  $('traits').innerHTML = `${t.weight < 0.33 ? '軽い' : t.weight < 0.66 ? 'ふつうの重さ' : '重い'}<br>ジャンプ ${t.jumpH.toFixed(1)}m<br>横の速さ ${t.vmax.toFixed(1)}　安定 ${(1 / t.slip).toFixed(1)}`;
  return { ch, info, traits: t };
}

function startGame() {
  const ch = [...$('char').value.trim()][0];
  const h = selectHero(ch);
  if (!h) { $('panel-msg').textContent = 'この字は使えません（輪郭のある字を入れてください）'; return; }
  heroCh = h.ch; heroInfo = h.info;
  g = createGame({ ch: heroCh, traits: h.traits, surfaces });
  particles = []; trail = []; shake = 0; flash = 0; overT = 0; hint = 4;
  mode = 'play';
  $('panel').hidden = true;
}

function showMenu(result) {
  mode = 'menu';
  $('panel').hidden = false;
  $('panel-result').innerHTML = result || '';
  $('start-btn').textContent = result ? 'もう一度' : 'スタート';
  $('panel-msg').textContent = '';
  renderRecords();
}

function renderRecords() {
  const kinds = Object.keys(KIND_NAMES).filter(k => save.kinds[k]).map(k => KIND_NAMES[k]).join('・') || 'まだなし';
  const chars = Object.keys(save.chars).join('') || '―';
  const cur = save.byChar[$('char').value.trim()[0] || ''] || 0;
  $('records').innerHTML = `この字のベスト <b>${cur} m</b>　全体のベスト <b>${save.best} m</b> ${save.bestCh}<br>踏んだ足場の種類：${kinds}<br>踏んだ字：<span class="chars">${chars}</span>`;
}

function finishGame() {
  const s = g.score;
  const prevBest = save.byChar[heroCh] || 0;
  save.byChar[heroCh] = Math.max(prevBest, s);
  if (s > save.best) { save.best = s; save.bestCh = heroCh; }
  Object.assign(save.kinds, g.kinds); Object.assign(save.chars, g.chars);
  writeSave();
  const rec = s > prevBest ? '自己ベスト更新！' : `この字のベスト ${prevBest} m`;
  showMenu(`${s} m<small>${rec}</small>`);
}

// ---------- 入力 ----------
const keys = { left: false, right: false };
let hold = 0, tiltOn = false, tilt = 0, dragDX = 0, ptr = null;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.code === 'Enter') startGame(); return; }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
  if (e.code === 'Enter' && mode === 'menu') startGame();
});
addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture?.(e.pointerId);
  ptr = { id: e.pointerId, x0: e.clientX, x: e.clientX, drag: false };
  const r = canvas.getBoundingClientRect();
  hold = e.clientX < r.left + r.width / 2 ? -1 : 1;
});
canvas.addEventListener('pointermove', e => {
  if (!ptr || e.pointerId !== ptr.id) return;
  const r = canvas.getBoundingClientRect();
  if (!ptr.drag && Math.abs(e.clientX - ptr.x0) > 10) { ptr.drag = true; hold = 0; }
  if (ptr.drag) dragDX += (e.clientX - ptr.x) / r.width * WORLD_W;
  ptr.x = e.clientX;
});
const endPtr = e => { if (ptr && e.pointerId === ptr.id) { ptr = null; hold = 0; } };
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);

$('tilt-btn').addEventListener('click', async () => {
  if (!tiltOn) {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
      }
      addEventListener('deviceorientation', onTilt);
      tiltOn = true;
    } catch { return; }
  } else { removeEventListener('deviceorientation', onTilt); tiltOn = false; tilt = 0; }
  $('tilt-btn').textContent = tiltOn ? '傾き:ON' : '傾き:OFF';
});
function onTilt(e) {
  const gm = e.gamma;
  if (gm == null) return;
  tilt = Math.abs(gm) < 3 ? 0 : clamp(gm / 22, -1, 1);
}

function currentAxis() {
  if (AUTO && g) return botAxis(g);
  return clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + hold + tilt, -1, 1);
}

// ---------- 見た目 ----------
const FONT_UI = '"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif';
const px = x => x * PPM;
const py = y => LH - (y - g.camY) * PPM;

// 高さに応じた空の色（空 → 夕焼け → 紫 → 宇宙）
const SKY = [
  [0, [110, 198, 255], [205, 238, 255]],
  [0.3, [255, 150, 110], [255, 220, 160]],
  [0.55, [60, 30, 110], [140, 80, 150]],
  [0.8, [8, 6, 30], [22, 16, 60]],
  [1, [2, 2, 12], [8, 8, 28]],
];
function skyAt(t) {
  for (let i = 1; i < SKY.length; i++) {
    if (t <= SKY[i][0]) {
      const a = SKY[i - 1], b = SKY[i], u = (t - a[0]) / (b[0] - a[0]);
      const mix = (c1, c2) => `rgb(${c1.map((v, k) => Math.round(lerp(v, c2[k], u))).join(',')})`;
      return [mix(a[1], b[1]), mix(a[2], b[2])];
    }
  }
  return ['#020210', '#08081c'];
}
const STARS = Array.from({ length: 90 }, (_, i) => {
  const r = n => { const s = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return s - Math.floor(s); };
  return { x: r(1) * LW, y: r(2), s: 0.6 + r(3) * 1.6, z: 0.15 + r(4) * 0.5, tw: r(5) * 6 };
});

function drawBackground() {
  const t = clamp(g.camY / 900, 0, 1);
  const [top, bot] = skyAt(t);
  const grd = ctx.createLinearGradient(0, 0, 0, LH);
  grd.addColorStop(0, top); grd.addColorStop(1, bot);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, LW, LH);
  const sa = clamp((t - 0.25) / 0.4, 0, 1);       // 高いほど星が見える
  if (sa > 0) {
    for (const s of STARS) {
      const y = (((s.y * LH + g.camY * PPM * s.z) % LH) + LH) % LH;
      ctx.globalAlpha = sa * (0.5 + 0.5 * Math.sin(g.t * 2 + s.tw));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, LH - y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }
  if (t > 0.5) {                                   // 宇宙の月
    const my = 120;
    ctx.globalAlpha = clamp((t - 0.5) / 0.3, 0, 1) * 0.85;
    ctx.fillStyle = '#e8e4d0'; ctx.beginPath(); ctx.arc(290, my, 34, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.arc(280, my - 6, 9, 0, 7); ctx.arc(300, my + 12, 6, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawGlyph(info, cx, cy, em, ax, ay, sxs = 1, fill, stroke, alpha = 1, rot = 0, sy = 1, sx = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px(cx), py(cy));
  if (rot) ctx.rotate(rot);
  ctx.scale(PPM * em * sxs * sx, -PPM * em * sy);
  ctx.translate(-ax, -ay);
  if (stroke) { ctx.lineWidth = 0.035 / Math.max(sxs, 0.5); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.stroke(info.path); }
  ctx.fillStyle = fill;
  ctx.fill(info.path, 'evenodd');
  ctx.restore();
}

const KIND_COLOR = { normal: '#f6f0dc', move: '#8fd6ff', fade: '#ffd2a0', spring: '#82ea95', spike: '#ff6f6f' };
function drawPlatform(P) {
  const info = glyphInfo(P.ch);
  const S = P.surf;
  const off = P.broken && P.crumble < 0.25 ? Math.sin(P.crumble * 90) * 0.05 : 0;
  const alpha = P.broken ? clamp(1 - Math.max(0, P.crumble - 0.25) * 2, 0, 1) : 1;
  const rot = P.broken ? Math.max(0, P.crumble - 0.25) * 1.4 : 0;
  drawGlyph(info, P.x + off, P.y + P.fallY, EM, S.cx0, S.coreY, P.sxs, KIND_COLOR[P.kind], 'rgba(10,10,40,.55)', alpha, rot);
  if (P.kind === 'spring' && !P.broken) {            // バネの印
    ctx.fillStyle = 'rgba(40,140,70,.9)';
    ctx.fillRect(px(P.x) - 14, py(P.y + P.peak * EM) - 5, 28, 3);
  }
}

function drawHero() {
  const h = g.hero, info = heroInfo;
  const stretch = clamp(Math.abs(h.vy) / g.v0, 0, 1.4);
  const sy = (1 + 0.22 * stretch) * (1 - 0.35 * h.squash), sx = (1 - 0.12 * stretch) * (1 + 0.3 * h.squash);
  const hue = (heroCh.codePointAt(0) * 47) % 360;
  const blink = h.invuln > 0 && Math.floor(g.t * 14) % 2 === 0 && h.rocket <= 0;
  const cx = (info.minx + info.maxx) / 2;
  // 小さな字（・や一）でも見えるようにうっすら光らせる
  const small = Math.max(info.maxx - info.minx, info.maxy - info.miny) < 0.6;
  for (const ox of [0, h.x < 1 ? WORLD_W : h.x > WORLD_W - 1 ? -WORLD_W : 0]) {
    if (blink) continue;
    if (small) {
      ctx.fillStyle = `hsla(${hue},100%,70%,.35)`;
      ctx.beginPath(); ctx.arc(px(h.x + ox), py(h.y + 0.5), 20, 0, 7); ctx.fill();
    }
    drawGlyph(info, h.x + ox, h.y, HERO_EM, cx, info.miny, 1, `hsl(${hue},95%,62%)`, '#fff', 1, 0, sy, sx);
    if (h.rocket > 0) {                              // ロケットの炎
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.moveTo(px(h.x + ox) - 8, py(h.y)); ctx.lineTo(px(h.x + ox) + 8, py(h.y)); ctx.lineTo(px(h.x + ox), py(h.y) + 30 + Math.random() * 14); ctx.fill();
    }
    if (h.balloon > 0) {
      ctx.fillStyle = 'rgba(255,120,160,.9)';
      ctx.beginPath(); ctx.ellipse(px(h.x + ox), py(h.y + 2.1), 15, 19, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#eee'; ctx.beginPath(); ctx.moveTo(px(h.x + ox), py(h.y + 1.5)); ctx.lineTo(px(h.x + ox), py(h.y + 1.2)); ctx.stroke();
    }
  }
}

function drawTrail() {
  const fall = g.hero.vy < -6;
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i], a = (i + 1) / trail.length;
    ctx.globalAlpha = a * (fall ? 0.5 : 0.3);
    ctx.fillStyle = fall ? '#ff7070' : '#fff';
    ctx.beginPath(); ctx.arc(px(p.x), py(p.y + 0.5), 3 + a * 8, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawItem(it) {
  if (it.got) return;
  const ch = ITEM_CHARS[it.type], info = glyphInfo(ch);
  const y = it.y + it.plat.fallY + Math.sin(g.t * 4 + it.id) * 0.12;
  const col = it.type === 'rocket' ? '#ff9a3c' : it.type === 'balloon' ? '#ff7fa8' : '#6fe58a';
  ctx.fillStyle = col + '55';
  ctx.beginPath(); ctx.arc(px(it.x), py(y), 22, 0, 7); ctx.fill();
  drawGlyph(info, it.x, y - 0.5, 1.0, (info.minx + info.maxx) / 2, info.miny, 1, col, '#fff');
}

function drawEnemy(e, over) {
  if (e.type === 'cloud') {
    if (!over) return;
    const info = glyphInfo(ENEMY_CHARS.cloud);
    drawGlyph(info, e.x, e.y - 1.2, 2.6, (info.minx + info.maxx) / 2, info.miny, 1, 'rgba(235,240,255,.82)', 'rgba(120,130,170,.8)');
    return;
  }
  if (over) return;
  if (e.type === 'bird') {
    const info = glyphInfo(ENEMY_CHARS.bird);
    const dead = e.dead;
    drawGlyph(info, e.x, e.y - 0.6 - (dead ? e.fall * e.fall * 12 : 0), 1.3, (info.minx + info.maxx) / 2, (info.miny + info.maxy) / 2, 1, '#3a3a58', '#fff', dead ? clamp(1 - e.fall, 0, 1) : 1, dead ? e.fall * 6 : 0, 1, e.dir);
  } else if (e.type === 'thunder') {
    const info = glyphInfo(ENEMY_CHARS.thunder);
    const glow = e.state === 'warn' ? 0.5 + 0.5 * Math.sin(e.timer * 30) : e.state === 'strike' ? 1 : 0.5;
    if (e.state === 'warn') {
      ctx.strokeStyle = `rgba(255,240,120,${0.25 + 0.4 * glow})`; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(px(e.x), py(e.y)); ctx.lineTo(px(e.x), py(e.y - 11)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (e.state === 'strike') {
      ctx.fillStyle = 'rgba(255,255,200,.9)'; ctx.fillRect(px(e.x) - 18, py(e.y), 36, 11 * PPM);
      ctx.fillStyle = '#fff'; ctx.fillRect(px(e.x) - 6, py(e.y), 12, 11 * PPM);
    }
    if (e.state !== 'done') drawGlyph(info, e.x, e.y - 0.8, 1.8, (info.minx + info.maxx) / 2, (info.miny + info.maxy) / 2, 1, e.state === 'idle' ? '#7a7fa8' : `rgb(255,${200 + 55 * glow | 0},60)`, '#fff', e.state === 'idle' ? 0.7 : 1);
  }
}

function spawnParticles(x, y, n, color, spd = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, v = spd * (0.4 + Math.random());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, life: 0.5 + Math.random() * 0.3, t: 0, color });
  }
}

function handleEvents() {
  for (const ev of g.events) {
    if (ev.type === 'land') spawnParticles(ev.x, ev.y, ev.kind === 'spring' ? 14 : 6, KIND_COLOR[ev.kind], ev.kind === 'spring' ? 5 : 2.5);
    else if (ev.type === 'hurt') { shake = 0.4; flash = 0.3; spawnParticles(ev.x, ev.y, 14, '#ff6060', 4); }
    else if (ev.type === 'stomp') spawnParticles(ev.x, ev.y, 12, '#ffe14d', 4);
    else if (ev.type === 'item') spawnParticles(ev.x, ev.y, 14, '#fff', 4);
    else if (ev.type === 'thunder') { shake = 0.3; flash = 0.25; }
    else if (ev.type === 'over') overT = 0;
  }
  g.events.length = 0;
}

function drawHud() {
  ctx.textBaseline = 'top';
  ctx.font = `bold 26px ${FONT_UI}`; ctx.textAlign = 'left';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.fillStyle = '#fff';
  const txt = `${g.score} m`;
  ctx.strokeText(txt, 10, 8); ctx.fillText(txt, 10, 8);
  ctx.font = `13px ${FONT_UI}`; ctx.textAlign = 'right';
  const bt = `ベスト ${Math.max(save.best, g.score)} m`;
  ctx.strokeText(bt, LW - 10, 12); ctx.fillText(bt, LW - 10, 12);
  if (hint > 0 && mode === 'play') {
    ctx.globalAlpha = clamp(hint, 0, 1); ctx.textAlign = 'center'; ctx.font = `14px ${FONT_UI}`;
    ctx.strokeText('左右タップ／ドラッグ／傾き／←→ で動く', LW / 2, LH - 30); ctx.fillText('左右タップ／ドラッグ／傾き／←→ で動く', LW / 2, LH - 30);
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.setTransform(canvas.width / LW, 0, 0, canvas.width / LW, 0, 0);
  if (!g) { ctx.fillStyle = '#161a30'; ctx.fillRect(0, 0, LW, LH); return; }
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
  drawBackground();
  for (const P of g.plats) if (py(P.y) > -150 && py(P.y) < LH + 150) drawPlatform(P);
  for (const it of g.items) if (py(it.y) > -50 && py(it.y) < LH + 50) drawItem(it);
  for (const e of g.enemies) if (py(e.y) > -300 && py(e.y) < LH + 150) drawEnemy(e, false);
  drawTrail();
  drawHero();
  for (const p of particles) {
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1); ctx.fillStyle = p.color;
    ctx.fillRect(px(p.x) - 2, py(p.y) - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  for (const e of g.enemies) if (py(e.y) > -300 && py(e.y) < LH + 150) drawEnemy(e, true);   // 雲は主人公の手前
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, LW, LH); }
  ctx.restore();
  drawHud();
}

// ---------- ループ ----------
function advance(dt) {
  if (mode !== 'play' && mode !== 'over') return;
  let acc = dt;
  while (acc > 1e-9) {
    const d = Math.min(DT, acc);
    if (dragDX) { g.hero.x = (((g.hero.x + dragDX) % WORLD_W) + WORLD_W) % WORLD_W; dragDX = 0; }
    step(g, currentAxis(), d);
    acc -= d;
  }
  handleEvents();
  const h = g.hero;
  trailT += dt;
  if (trailT > 0.025 && g.status === 'play') { trailT = 0; trail.push({ x: h.x, y: h.y }); if (trail.length > 14) trail.shift(); }
  for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 12 * dt; }
  particles = particles.filter(p => p.t < p.life);
  shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt * 1.5); hint -= dt;
  if (g.status === 'over' && mode === 'play') { mode = 'over'; overT = 0; }
  if (mode === 'over') { overT += dt; if (overT > 0.9) finishGame(); }
}

let lastTs = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  advance(dt);
  render();
  requestAnimationFrame(frame);
}

function resize() {
  const wrap = $('wrap'), w = wrap.clientWidth, h = wrap.clientHeight;
  const cw = Math.floor(Math.min(w, h * LW / LH)), ch = Math.floor(cw * LH / LW);
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  const dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
}
addEventListener('resize', resize);

// ---------- 起動 ----------
for (const c of ['木', '〇', '一', 'あ', 'S', '・', '鬱', '龍']) {
  const b = document.createElement('button');
  b.textContent = c;
  b.addEventListener('click', () => { $('char').value = c; selectHero(c); renderRecords(); });
  $('presets').append(b);
}
$('char').addEventListener('input', () => { selectHero([...$('char').value.trim()][0]); renderRecords(); });
$('start-btn').addEventListener('click', startGame);
resize();
requestAnimationFrame(frame);

// テスト用フック
window.__jump = {
  get g() { return g; },
  get mode() { return mode; },
  start: ch => { $('char').value = ch; startGame(); },
  // 描画なしで秒数ぶん進める（自動操縦 or 渡した軸）
  fast(sec, axisFn) {
    for (let t = 0; t < sec && g && g.status === 'play'; t += DT) { step(g, axisFn ? axisFn(g) : botAxis(g), DT); g.events.length = 0; }
    return { score: g.score, status: g.status, t: g.t };
  },
};

try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  for (const c of allGameChars()) {
    const info = glyphInfo(c);
    if (info && platformChars().includes(c)) surfaces[c] = makeSurface(info.polys, c);
  }
  $('panel-msg').textContent = '';
  $('start-btn').disabled = false;
  selectHero([...$('char').value.trim()][0]);
  showMenu('');
  if (AUTO) startGame();
} catch (e) {
  console.error(e);
  $('panel-msg').textContent = 'フォントの読み込みに失敗しました（ネットワークを確認してください）';
}
