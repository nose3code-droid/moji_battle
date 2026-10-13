// 文字ブロックくずし：画面・操作・演出・進行。物理は sim.js、字の形は shapes.js、面は stages.js。
import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { buildGlyph } from './shapes.js';
import { STAGES, buildStage } from './stages.js';
import { Sim, DT, W, H, BALL_R, PADDLE_Y, PADDLE_H, ITEMS, mulberry32 } from './sim.js';
import { makeAutopilot } from './auto.js';

const SAVE_KEY = 'moji_kuzushi.save';   // { hi, reached, run: { stage, lives, score } | null }
const DEBUG = location.search.includes('debug');
const AUTO = location.search.includes('auto');
const FONT_STACK = 'system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } },
};
const loadSave = () => ({ hi: 0, reached: 1, run: null, ...store.get(SAVE_KEY, {}) });
let save = loadSave();
const persist = () => store.set(SAVE_KEY, save);

// ---------- 状態 ----------
let font = null;
let sim = null, stage = null;
let scene = 'menu';              // menu | play | pause | banner
let stageStartScore = 0;
let autopilot = AUTO ? makeAutopilot(5) : null;
let launchReq = false;
let pointerTx = null;            // パドルの目標 x（盤面座標）
let touchBase = null;            // 指のドラッグ：{ fx0, tx0, x0, y0, moved }
const keys = { left: false, right: false };
let acc = 0, lastT = 0, frameT = 0;
let introT = 0;                  // 面のはじめの案内表示
let toastTimer = 0;

// ---------- 演出（見た目だけ。シミュレーションには影響しない） ----------
const fxRng = mulberry32(12345);
let particles = [], debris = [], ripples = [], floaters = [], flash = 0, shake = 0, redFlash = 0, stars = [];
const trails = new Map();        // ボール id → 軌跡
const pathCache = new WeakMap();
const crackCache = new WeakMap();
const itemPaths = {};
for (let i = 0; i < 60; i++) stars.push({ x: fxRng() * W, y: fxRng() * H, s: 0.4 + fxRng() * 1.2, p: fxRng() * 6.28 });

function compPath(c) {
  let p = pathCache.get(c);
  if (!p) {
    p = new Path2D();
    for (const l of c.loops) {
      p.moveTo(l[0], l[1]);
      for (let i = 2; i < l.length; i += 2) p.lineTo(l[i], l[i + 1]);
      p.closePath();
    }
    pathCache.set(c, p);
  }
  return p;
}

function itemPath(kind) {
  if (!itemPaths[kind]) {
    const p = new Path2D();
    for (const c of buildGlyph(font, ITEMS[kind].ch, 19).comps) p.addPath(compPath(c));
    itemPaths[kind] = p;
  }
  return itemPaths[kind];
}

// ひび割れ：字の中心付近を通る折れ線を、ブロックごとに固定の乱数で作る
function cracksOf(b) {
  let cr = crackCache.get(b);
  if (!cr) {
    const rng = mulberry32(b.id * 977);
    const bb = b.c.bbox, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const rx = (bb[2] - bb[0]) / 2 + 4, ry = (bb[3] - bb[1]) / 2 + 4;
    cr = [];
    for (let k = 0; k < 7; k++) {
      let a = rng() * 6.283, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      const pts = [x, y];
      for (let j = 0; j < 5; j++) {
        a += Math.PI + (rng() - 0.5) * 1.2;
        x += Math.cos(a) * (rx * 0.35) * (0.6 + rng() * 0.8); y += Math.sin(a) * (ry * 0.35) * (0.6 + rng() * 0.8);
        pts.push(x, y);
      }
      cr.push(pts);
    }
    crackCache.set(b, cr);
  }
  return cr;
}

const hueOf = g => (stage.hue + sim.glyphs.indexOf(g) * 26) % 360;
const blockColor = (b, light = 0) => {
  const ratio = b.hp / b.maxHp;
  return `hsl(${hueOf(b.g)} ${Math.round(85 - (1 - ratio) * 30)}% ${Math.round(46 + (1 - ratio) * 12 + light)}%)`;
};

function spark(x, y, n, color, sp = 120, life = 0.45) {
  for (let i = 0; i < n; i++) {
    const a = fxRng() * 6.283, v = sp * (0.3 + fxRng());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: 1 + fxRng() * 1.8 });
  }
}

// 砕ける：字の三角形分割の破片が飛び散る
function shatterFx(b, g) {
  const tris = b.c.tris, step = Math.max(1, Math.floor(tris.length / 30));
  const color = blockColor(b, 6);
  const bb = b.c.bbox, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  for (let i = 0; i < tris.length; i += step) {
    const t = tris[i];
    const mx = (t[0] + t[2] + t[4]) / 3, my = (t[1] + t[3] + t[5]) / 3;
    let dx = mx - cx, dy = my - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const v = 60 + fxRng() * 170;
    debris.push({
      pts: [t[0] - mx, t[1] - my, t[2] - mx, t[3] - my, t[4] - mx, t[5] - my],
      x: g.x + mx, y: g.y + my, vx: dx * v + g.vx * 0.3, vy: dy * v - 70 - fxRng() * 90,
      rot: 0, vr: (fxRng() - 0.5) * 14, life: 1.1 + fxRng() * 0.5, max: 1.5, color,
    });
  }
  spark(g.x + cx, g.y + cy, 26, '#fff', 260, 0.6);
}

function handleEvents() {
  for (const e of sim.events) {
    if (e.t === 'hit') { spark(e.x, e.y, 9, '#fff', 150); shake = Math.max(shake, 1.2); }
    else if (e.t === 'break') { shatterFx(e.b, e.g); shake = Math.max(shake, e.g.spec.forms.length > 1 || stage.boss ? 8 : 5); flash = Math.max(flash, 0.18); }
    else if (e.t === 'paddle') { ripples.push({ x: e.x, y: PADDLE_Y, age: 0 }); spark(e.x, PADDLE_Y, 8, '#9fe7ff', 130, 0.35); }
    else if (e.t === 'wall') spark(e.x, e.y, 4, '#8fa0ff', 70, 0.25);
    else if (e.t === 'item') {
      const it = ITEMS[e.kind];
      spark(e.x, PADDLE_Y, 22, it.color, 200, 0.7);
      floaters.push({ x: e.x, y: PADDLE_Y - 24, text: it.name, color: it.color, age: 0 });
      ripples.push({ x: e.x, y: PADDLE_Y, age: 0, color: it.color });
    } else if (e.t === 'lost') { redFlash = 0.5; shake = 10; if (sim.state === 'ready') say(`残機 ${sim.lives}`); save.run = { stage: stage.index, lives: sim.lives, score: sim.score }; persist(); }
    else if (e.t === 'form') say('変身！'), flash = 0.35;
    else if (e.t === 'shatter' && e.last && stage.boss) { flash = 0.5; shake = 14; }
  }
  sim.events.length = 0;
}

// ---------- 画面 ----------
const canvas = $('view'), ctx = canvas.getContext('2d');
let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const scale = Math.min(r.width / W, r.height / H);
  view = { scale, dpr, ox: (r.width - W * scale) / 2, oy: (r.height - H * scale) / 2, w: r.width, h: r.height };
}
window.addEventListener('resize', resize);

function say(text, ms = 1500) {
  const t = $('toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function drawBlock(b) {
  const g = b.g, p = compPath(b.c), ratio = b.hp / b.maxHp;
  ctx.save();
  ctx.translate(g.x, g.y);
  if (b.invuln > 0) ctx.globalAlpha = 0.35 + 0.3 * Math.sin(frameT * 20);
  const col = blockColor(b);
  ctx.shadowColor = col; ctx.shadowBlur = 6 + b.flash * 22;
  ctx.fillStyle = col;
  ctx.fill(p, 'evenodd');
  ctx.shadowBlur = 0;
  if (ratio < 1) {            // ひび割れ（字の中だけ）
    ctx.save();
    ctx.clip(p, 'evenodd');
    ctx.strokeStyle = 'rgba(10,12,30,.75)'; ctx.lineWidth = 1.2;
    const n = Math.ceil((1 - ratio) * 7);
    const cr = cracksOf(b);
    for (let k = 0; k < n; k++) {
      ctx.beginPath(); ctx.moveTo(cr[k][0], cr[k][1]);
      for (let i = 2; i < cr[k].length; i += 2) ctx.lineTo(cr[k][i], cr[k][i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.lineWidth = 1.4; ctx.strokeStyle = `rgba(255,255,255,${0.55 + b.flash * 0.4})`;
  ctx.stroke(p);
  if (b.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${b.flash * 0.75})`; ctx.fill(p, 'evenodd'); }
  if (b.maxHp > 1) {          // 残りの当て数
    const bb = b.c.bbox, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    ctx.fillStyle = 'rgba(8,10,28,.78)'; ctx.beginPath(); ctx.arc(cx, cy, 8.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold 12px ${FONT_STACK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.hp, cx, cy + 0.5);
  }
  ctx.restore();
}

function drawBall(ball) {
  const fire = sim.eff.fire > 0;
  let tr = trails.get(ball.id);
  if (!tr) trails.set(ball.id, tr = []);
  if (!ball.attached) { tr.push({ x: ball.x, y: ball.y }); if (tr.length > 16) tr.shift(); } else tr.length = 0;
  for (let i = 0; i < tr.length; i++) {
    const f = (i + 1) / tr.length;
    ctx.fillStyle = fire ? `rgba(255,${Math.round(120 + 100 * f)},40,${f * 0.5})` : `rgba(140,200,255,${f * 0.45})`;
    ctx.beginPath(); ctx.arc(tr[i].x, tr[i].y, BALL_R * (0.35 + 0.65 * f), 0, 6.283); ctx.fill();
  }
  const g = ctx.createRadialGradient(ball.x - 1.5, ball.y - 1.5, 0.5, ball.x, ball.y, BALL_R + 1);
  if (fire) { g.addColorStop(0, '#fff7c2'); g.addColorStop(0.5, '#ffb02e'); g.addColorStop(1, '#ff4d1a'); }
  else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#8fd3ff'); }
  ctx.shadowColor = fire ? '#ff7a1a' : '#7fd0ff'; ctx.shadowBlur = fire ? 18 : 12;
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, 6.283); ctx.fill();
  ctx.shadowBlur = 0;
  if (fire && !ball.attached && fxRng() < 0.8) particles.push({ x: ball.x + (fxRng() - 0.5) * 4, y: ball.y, vx: (fxRng() - 0.5) * 30, vy: -20 - fxRng() * 30, life: 0.4, max: 0.4, color: fxRng() < 0.5 ? '#ff9f1a' : '#ffd43b', size: 2 + fxRng() * 2 });
}

function drawPaddle() {
  const x = sim.px, w = sim.pw, y = PADDLE_Y;
  const col = sim.eff.paddle === 'big' ? '#4cc9f0' : sim.eff.paddle === 'small' ? '#f7b731' : '#9aa8ff';
  const g = ctx.createLinearGradient(0, y, 0, y + PADDLE_H);
  g.addColorStop(0, '#fff'); g.addColorStop(0.35, col); g.addColorStop(1, '#2a3175');
  ctx.shadowColor = col; ctx.shadowBlur = 14;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y, w, PADDLE_H, 5); ctx.fill();
  ctx.shadowBlur = 0;
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${stage.hue} 45% 13%)`); g.addColorStop(1, '#070b18');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(140,160,255,.06)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x += 30) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 30) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  for (const s of stars) { ctx.fillStyle = `rgba(200,215,255,${0.25 + 0.25 * Math.sin(frameT * 1.5 + s.p)})`; ctx.fillRect(s.x, s.y, s.s, s.s); }
}

function drawItem(it) {
  const def = ITEMS[it.kind];
  ctx.save(); ctx.translate(it.x, it.y);
  ctx.shadowColor = def.color; ctx.shadowBlur = 12;
  ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(0, 0, 12.5, 0, 6.283); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(8,10,28,.9)'; ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, 6.283); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fill(itemPath(it.kind), 'evenodd');
  ctx.restore();
}

function drawEffects() {
  const list = [];
  if (sim.eff.paddle) list.push([sim.eff.paddle, sim.eff.paddleT / (sim.eff.paddle === 'big' ? 1440 : 1800)]);
  if (sim.eff.fast > 0) list.push(['fast', sim.eff.fast / 1200]);
  if (sim.eff.fire > 0) list.push(['fire', sim.eff.fire / 720]);
  list.forEach(([k, f], i) => {
    const x = 16 + i * 40, y = H - 18;
    ctx.fillStyle = ITEMS[k].color; ctx.beginPath(); ctx.arc(x, y, 10, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(8,10,28,.9)'; ctx.beginPath(); ctx.arc(x, y, 8.4, 0, 6.283); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.scale(0.8, 0.8); ctx.fillStyle = '#fff'; ctx.fill(itemPath(k), 'evenodd'); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x - 10, y + 12, 20, 3);
    ctx.fillStyle = ITEMS[k].color; ctx.fillRect(x - 10, y + 12, 20 * Math.max(0, Math.min(1, f)), 3);
  });
}

function draw(dt) {
  const { scale, dpr, ox, oy } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#04060f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!sim) return;
  const sx = shake > 0.2 ? (fxRng() - 0.5) * shake : 0, sy = shake > 0.2 ? (fxRng() - 0.5) * shake : 0;
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (ox + sx) * dpr, (oy + sy) * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  drawBackground();
  for (const b of sim.blocks) if (b.alive) drawBlock(b);
  // 待機中のボスの「ふきだし」
  for (const g of sim.glyphs) if (g.state === 'wait') { ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.4 * Math.sin(frameT * 14)})`; ctx.font = `bold 20px ${FONT_STACK}`; ctx.textAlign = 'center'; ctx.fillText('…変身中…', g.x, g.y); }
  for (const it of sim.items) drawItem(it);
  for (const d of debris) {
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.globalAlpha = Math.max(0, Math.min(1, d.life / 0.6));
    ctx.fillStyle = d.color; ctx.beginPath(); ctx.moveTo(d.pts[0], d.pts[1]); ctx.lineTo(d.pts[2], d.pts[3]); ctx.lineTo(d.pts[4], d.pts[5]); ctx.fill();
    ctx.restore();
  }
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
  for (const b of sim.balls) drawBall(b);
  for (const id of trails.keys()) if (!sim.balls.some(b => b.id === id)) trails.delete(id);
  drawPaddle();
  for (const r of ripples) {   // パドルで反射した波紋
    const f = r.age / 0.4;
    ctx.strokeStyle = r.color || '#9fe7ff'; ctx.globalAlpha = 1 - f; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(r.x, r.y, 8 + f * 34, 3 + f * 10, 0, Math.PI, 0); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const f of floaters) {
    ctx.globalAlpha = Math.max(0, 1 - f.age / 1.1); ctx.fillStyle = f.color; ctx.font = `bold 15px ${FONT_STACK}`; ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y - f.age * 38);
  }
  ctx.globalAlpha = 1;
  drawEffects();
  // 面のはじめの案内
  if (introT > 0 && scene === 'play') {
    const a = Math.min(1, introT / 0.5);
    ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.shadowColor = '#5b6cff'; ctx.shadowBlur = 16;
    ctx.font = `bold 34px ${FONT_STACK}`; ctx.fillText(`STAGE ${stage.index + 1}`, W / 2, 360);
    ctx.font = `bold 20px ${FONT_STACK}`; ctx.fillStyle = stage.boss ? '#ff8fa8' : '#ffd54f';
    ctx.fillText((stage.boss ? 'BOSS　' : '') + stage.name, W / 2, 392);
    ctx.font = `14px ${FONT_STACK}`; ctx.fillStyle = '#cdd4ff'; ctx.fillText(stage.note, W / 2, 418);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H); }
  if (redFlash > 0) { ctx.fillStyle = `rgba(255,40,70,${redFlash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
  // 盤面のふち
  ctx.strokeStyle = 'rgba(120,140,255,.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(0, 0, W, H);
}

function updateFx(dt) {
  frameT += dt;
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  if (particles.length > 600) particles.splice(0, particles.length - 600);
  for (const d of debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 520 * dt; d.rot += d.vr * dt; d.life -= dt; }
  debris = debris.filter(d => d.life > 0);
  for (const r of ripples) r.age += dt;
  ripples = ripples.filter(r => r.age < 0.4);
  for (const f of floaters) f.age += dt;
  floaters = floaters.filter(f => f.age < 1.1);
  flash = Math.max(0, flash - dt * 1.6); redFlash = Math.max(0, redFlash - dt * 1.4);
  shake = Math.max(0, shake - dt * 30);
  if (introT > 0) introT -= dt;
}

// ---------- HUD ----------
let hudKey = '';
function updateHud() {
  if (!sim) return;
  const key = [stage.index, sim.score, sim.lives, save.hi].join();
  if (key === hudKey) return;
  hudKey = key;
  $('stg').textContent = `面 ${stage.index + 1}/${STAGES.length}`;
  $('score').textContent = sim.score;
  $('hi').textContent = Math.max(save.hi, sim.score);
  $('lives').textContent = '♥'.repeat(Math.max(0, sim.lives));
  $('hint').textContent = '';
}

// ---------- 進行 ----------
function startStage(index, lives, score) {
  stage = buildStage(font, index);
  sim = new Sim({ stage, lives, score, seed: 1 + index });
  stageStartScore = score;
  particles = []; debris = []; ripples = []; floaters = []; trails.clear();
  introT = 2.2; launchReq = false; hudKey = ''; acc = 0;
  $('menu').hidden = true; $('banner').hidden = true;
  $('hud').hidden = false; $('pause').hidden = false;
  scene = 'play';
  save.run = { stage: index, lives, score }; persist();
  updateHud();
}

function showMenu() {
  scene = 'menu';
  $('banner').hidden = true; $('hud').hidden = true; $('pause').hidden = true;
  $('menu').hidden = false;
  save = loadSave();
  $('cont').hidden = !(save.run && save.run.lives > 0);
  if (!$('cont').hidden) $('cont').textContent = `つづきから（面${save.run.stage + 1}・残機${save.run.lives}）`;
  $('stages').innerHTML = STAGES.map((s, i) =>
    `<button data-i="${i}" class="${s.boss ? 'boss' : ''}" ${i + 1 > save.reached ? 'disabled' : ''}>${i + 1}<small>${i + 1 > save.reached ? '？' : s.name}</small></button>`).join('');
  $('record').textContent = `ハイスコア ${save.hi}　到達面 ${save.reached}/${STAGES.length}`;
}

function banner(title, sub, mainLabel, mainFn, subLabel, subFn) {
  scene = 'banner';
  $('banner-title').innerHTML = title; $('banner-sub').innerHTML = sub;
  $('b-main').textContent = mainLabel; $('b-main').onclick = mainFn;
  $('b-sub').textContent = subLabel; $('b-sub').onclick = subFn;
  $('banner').hidden = false;
}

function recordScore() {
  save.hi = Math.max(save.hi, sim.score);
}

function onClear() {
  const i = stage.index, last = i === STAGES.length - 1;
  recordScore();
  save.reached = Math.max(save.reached, Math.min(STAGES.length, i + 2));
  save.run = last ? null : { stage: i + 1, lives: sim.lives, score: sim.score };
  persist();
  const sub = `スコア <b>${sim.score}</b>（残機ボーナス +${sim.bonus}）<br>ハイスコア ${save.hi}`;
  if (last) banner('全面クリア！', sub + '<br>すべての字をくずしました。', 'タイトルへ', showMenu, 'もう一度（面12）', () => startStage(i, 3, stageStartScore));
  else banner(`面${i + 1} クリア！`, sub, `次の面へ（面${i + 2}）`, () => startStage(i + 1, sim.lives, sim.score), '面セレクト', showMenu);
}

function onOver() {
  const i = stage.index;
  recordScore();
  save.run = null; persist();
  banner('GAME OVER', `スコア <b>${sim.score}</b><br>ハイスコア ${save.hi}　（面${i + 1}で終了）`, `もう一度（面${i + 1}）`, () => startStage(i, 3, stageStartScore), '面セレクト', showMenu);
}

function pause(on) {
  if (!sim || (scene !== 'play' && scene !== 'pause')) return;
  if (on && scene === 'play') {
    scene = 'pause';
    banner('一時停止', `面${stage.index + 1}　スコア ${sim.score}`, 'つづける', () => pause(false), '面セレクトへ', showMenu);
    scene = 'pause';
  } else if (!on && scene === 'pause') {
    scene = 'play'; $('banner').hidden = true; lastT = 0;
  }
}

// ---------- 入力 ----------
function fieldX(e) {
  const r = canvas.getBoundingClientRect();
  return (e.clientX - r.left - view.ox) / view.scale;
}
canvas.addEventListener('pointerdown', e => {
  if (scene !== 'play') return;
  canvas.setPointerCapture?.(e.pointerId);
  const fx = fieldX(e);
  if (e.pointerType === 'mouse') pointerTx = fx;
  else touchBase = { fx0: fx, tx0: sim ? sim.px : W / 2, x0: e.clientX, y0: e.clientY, moved: false };
});
canvas.addEventListener('pointermove', e => {
  if (scene !== 'play') return;
  const fx = fieldX(e);
  if (e.pointerType === 'mouse') pointerTx = fx;
  else if (touchBase) {
    if (Math.hypot(e.clientX - touchBase.x0, e.clientY - touchBase.y0) > 10) touchBase.moved = true;
    pointerTx = touchBase.tx0 + (fx - touchBase.fx0);
  }
});
const endPointer = e => {
  if (scene !== 'play') return;
  if (e.pointerType === 'mouse') { if (e.type === 'pointerup') launchReq = true; }
  else if (touchBase) { if (!touchBase.moved && e.type === 'pointerup') launchReq = true; touchBase = null; }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = true; pointerTx = null; e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = true; pointerTx = null; e.preventDefault(); }
  else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { if (scene === 'play') { launchReq = true; e.preventDefault(); } }
  else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') pause(scene === 'play');
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
$('pause').onclick = () => pause(scene === 'play');
$('new').onclick = () => startStage(0, 3, 0);
$('cont').onclick = () => startStage(save.run.stage, save.run.lives, save.run.score);
$('stages').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) startStage(+b.dataset.i, 3, 0); };

function makeInput() {
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const inp = { tx: dir ? null : pointerTx, dir, launch: launchReq };
  launchReq = false;
  return inp;
}

// ---------- ループ ----------
function frame(t) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  if (scene === 'play' && sim) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 12) {
      sim.step(autopilot ? autopilot(sim) : makeInput());
      acc -= DT;
      if (sim.state === 'clear' || sim.state === 'over') break;
    }
    handleEvents();
    if (sim.state === 'clear') onClear();
    else if (sim.state === 'over') onOver();
    $('hint').textContent = sim.state === 'ready' && introT <= 0 ? 'タップ・クリック・スペースで発射' : '';
    updateHud();
  }
  updateFx(dt);
  draw(dt);
}

// ---------- 起動 ----------
async function boot() {
  resize();
  showMenu();
  $('new').disabled = true; $('new').textContent = 'フォント読み込み中…';
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    font = opentype.parse(await res.arrayBuffer());
  } catch (err) {
    $('record').textContent = 'フォントを読み込めませんでした：' + err.message;
    return;
  }
  $('new').disabled = false; $('new').textContent = 'はじめから';
  showMenu();
  if (AUTO) startStage(+(new URLSearchParams(location.search).get('stage') || 1) - 1, 3, 0);
}

if (DEBUG) {
  window.__kuzushi = {
    get sim() { return sim; }, get stage() { return stage; }, get scene() { return scene; }, get font() { return font; }, get save() { return save; },
    STAGES, buildStage, Sim, makeAutopilot, mulberry32, DT, W, H, BALL_R, PADDLE_Y,
    start: (i, lives = 3, score = 0) => startStage(i, lives, score),
    setAuto: on => { autopilot = on ? makeAutopilot(5) : null; },
    // 描画を待たずにシミュレーションを進める（テスト用）
    advance(n, inp) { for (let k = 0; k < n; k++) sim.step(inp || (autopilot ? autopilot(sim) : makeInput())); handleEvents(); },
    pxOf: (x, y) => { const r = canvas.getBoundingClientRect(); return [r.left + view.ox + x * view.scale, r.top + view.oy + y * view.scale]; },
  };
}
requestAnimationFrame(frame);
boot();
