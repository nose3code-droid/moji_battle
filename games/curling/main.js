// 文字カーリング：画面・操作・進行。物理は physics.js、ストーンの性格は stone.js、CPU は cpu.js。
import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import {
  World, SHEET, DT, R, VMAX, quantizeShot, judgeThrown, scoreEnd, distToTee, ANGLE_MAX,
} from './physics.js';
import { makeStoneDef, traitView, describe } from './stone.js';
import { planShot, predictStop, mulberry32, LEVELS } from './cpu.js';

const ENDS = 4;               // エンド数
const PER_TEAM = 3;           // 1エンドの1チームの投数
const PULL_MAX = 110;         // 引っぱりの最大長さ（コース座標）
const STATS_KEY = 'moji_curling.stats';  // { w, l, d, chars: { 字: { w, l, d } } }
const LAST_KEY = 'moji_curling.last';    // { ch, level }
const COLORS = ['#e0453f', '#3b6fe0'];   // 0: 自分（赤）, 1: CPU（青）
const TEAM_NAME = ['あなた', 'CPU'];
const CPU_POOL = ['〇', '鬱', '口'];
const PRESETS = ['〇', 'O', '口', 'あ', '鬱', '一', '人', '米'];
const DEBUG = location.search.includes('debug');

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } },
};

// ---------- 状態 ----------
let font = null;
let myDef = null;                 // あなたの字
let cpuDefs = [];                 // CPU が使う字
let level = 'normal';
let mode = 'select';              // select | aim | cpu | slide | banner | result
let game = null;                  // { ends:[[赤,青]..], end, no, first, thrown:[n,n], seed }
let world = null;
let active = null;                // いま滑っているストーン
let activeSweepAuto = false;      // CPU のスイープ
let sweepHeld = false;
let spin = 1;                     // 1: 右回り（時計）, -1: 左回り
let speed = 2;
let drag = null;                  // { x0, y0, x, y }
let preview = null;               // 引っぱり中の予想停止位置
let trail = [];                   // 滑った軌跡 [x, y, sweeping]
let sparks = [];
let floaters = [];                // 「場外」などの浮かぶ文字
let accum = 0;
let lastT = 0;
let cpuTimer = 0;

// ---------- 文字えらび ----------
const statRows = [['滑りやすさ', 'slide'], ['曲がりやすさ', 'curl'], ['重さ', 'heavy'], ['スイープの効き', 'sweep']];
const statHtml = (t, rows = statRows) => {
  const v = traitView(t);
  return rows.map(([n, k]) => `<div class="stat"><span>${n}</span><i><b style="width:${Math.round(v[k] * 100)}%"></b></i><em>${Math.round(v[k] * 100)}</em></div>`).join('');
};
const getStats = () => store.get(STATS_KEY, { w: 0, l: 0, d: 0, chars: {} });
const rate = r => (r.w + r.l + r.d) ? `${Math.round(100 * (r.w + 0.5 * r.d) / (r.w + r.l + r.d))}%（${r.w}勝${r.l}敗${r.d}分）` : 'まだ対戦なし';

let preview0 = null;
function refreshSelect() {
  const text = $('char').value.trim();
  preview0 = font && text ? makeStoneDef(font, text) : null;
  $('go').disabled = !preview0;
  $('go').textContent = preview0 ? 'ゲーム開始' : font ? '文字を入れてね' : '読み込み中…';
  $('stats').innerHTML = preview0
    ? `<div><b>「${preview0.ch}」の性格</b></div>${statHtml(preview0.traits)}<div class="desc">${describe(preview0.traits)}</div>` : '';
  const st = getStats();
  const cr = preview0 && st.chars[preview0.ch];
  $('record').innerHTML = `通算：${rate(st)}` + (preview0 ? `<br>「${preview0.ch}」の勝率：${cr ? rate(cr) : 'まだ対戦なし'}` : '');
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('sel', b.dataset.c === text));
  document.querySelectorAll('#levels button').forEach(b => b.classList.toggle('sel', b.dataset.l === level));
}

function buildSelect() {
  const last = store.get(LAST_KEY, {});
  if (last.ch) $('char').value = last.ch;
  if (LEVELS[last.level]) level = last.level;
  $('presets').innerHTML = PRESETS.map(c => `<button data-c="${c}">${c}</button>`).join('');
  $('levels').innerHTML = Object.entries(LEVELS).map(([k, v]) => `<button data-l="${k}">${v.name}</button>`).join('');
  $('presets').onclick = e => { const b = e.target.closest('button'); if (b) { $('char').value = b.dataset.c; refreshSelect(); } };
  $('levels').onclick = e => { const b = e.target.closest('button'); if (b) { level = b.dataset.l; refreshSelect(); } };
  $('char').addEventListener('input', refreshSelect);
  $('go').onclick = () => { if (preview0) startGame(preview0); };
}

// ---------- 試合の進行 ----------
function startGame(def) {
  myDef = def;
  cpuDefs = CPU_POOL.map(c => makeStoneDef(font, c)).filter(Boolean);
  store.set(LAST_KEY, { ch: def.ch, level });
  game = { ends: [], end: 0, no: 0, first: 0, thrown: [0, 0], seed: (Date.now() ^ 0x5bd1e995) >>> 0, done: false };
  $('select').hidden = true; $('banner').hidden = true;
  $('hud').hidden = false; $('controls').hidden = false;
  resize();
  newEnd();
}

function newEnd() {
  world = new World();
  game.no = 0; game.thrown = [0, 0];
  active = null; trail = []; sparks = []; floaters = [];
  game.ends[game.end] = game.ends[game.end] || null;
  updateHud();
  toast(`第${game.end + 1}エンド　${TEAM_NAME[game.first]}の先攻`, 1400);
  nextTurn();
}

const turnTeam = () => (game.first + game.no) % 2;

function nextTurn() {
  updateHud();
  if (game.no >= PER_TEAM * 2) { finishEnd(); return; }
  if (turnTeam() === 0) {
    mode = 'aim';
    $('hint').textContent = '下へ引っぱって離すと、上へ投げます';
  } else {
    mode = 'cpu';
    $('hint').textContent = 'CPU が考えています…';
    clearTimeout(cpuTimer);
    cpuTimer = setTimeout(cpuThrow, DEBUG ? 20 : 650);
  }
  updateButtons();
}

function cpuThrow() {
  if (mode !== 'cpu') return;
  const myNo = game.thrown[1];
  const rng = mulberry32(game.seed + game.end * 131 + game.no * 7);
  const plan = planShot(world, { team: 1, myNo, pool: cpuDefs, level, rng });
  $('hint').textContent = `CPU：${plan.label}（「${plan.def.ch}」）`;
  launch(plan.def, 1, plan.shot, plan.sweep);
}

function launch(def, team, shot, sweep = false) {
  active = world.launch(def, team, shot);
  activeSweepAuto = sweep;
  if (team === 1) sweepHeld = false;
  game.thrown[team]++;
  trail = []; preview = null; drag = null;
  mode = 'slide';
  accum = 0;
  updateHud(); updateButtons();
}

const MSG = { side: '場外（無効）', back: '場外（無効）', hog: 'ホッグライン手前（無効）' };

function endThrow() {
  const s = active;
  judgeThrown(s);
  if (s.out) {
    floaters.push({ x: Math.max(-70, Math.min(70, s.x)), y: Math.max(SHEET.backY + 6, Math.min(SHEET.hogY, s.y)), text: MSG[s.out], life: 2.4 });
    toast(MSG[s.out], 1500);
  }
  world.stones = world.stones.filter(t => !t.out);
  active = null;
  game.no++;
  nextTurn();
}

function finishEnd() {
  mode = 'banner';
  const sc = scoreEnd(world);
  const pts = [0, 0];
  if (sc.team >= 0) pts[sc.team] = sc.points;
  game.ends[game.end] = pts;
  if (sc.team >= 0) game.first = sc.team;   // 得点したチームが次のエンドは先攻（後攻の有利を手放す）
  updateHud();
  const last = game.end >= ENDS - 1;
  const title = sc.team < 0 ? `第${game.end + 1}エンド：ブランク（0点）`
    : `第${game.end + 1}エンド：${TEAM_NAME[sc.team]}が ${sc.points}点`;
  const tot = totals();
  $('banner-title').innerHTML = title;
  $('banner-sub').innerHTML = `ここまで　あなた ${tot[0]} − ${tot[1]} CPU`;
  $('next').textContent = last ? '結果を見る' : '次のエンドへ';
  $('next').hidden = false; $('again').hidden = true; $('change').hidden = true;
  $('banner').classList.add('low');
  $('banner').hidden = false;
  $('hint').textContent = '';
  updateButtons();
}

const totals = () => game.ends.reduce((a, e) => e ? [a[0] + e[0], a[1] + e[1]] : a, [0, 0]);

function showResult() {
  mode = 'result';
  const [a, b] = totals();
  const outcome = a > b ? 'w' : a < b ? 'l' : 'd';
  const st = getStats();
  st[outcome]++;
  const cr = st.chars[myDef.ch] || (st.chars[myDef.ch] = { w: 0, l: 0, d: 0 });
  cr[outcome]++;
  store.set(STATS_KEY, st);
  $('banner-title').innerHTML = a > b ? '<span class="win">あなたの勝ち！</span>' : a < b ? '<span class="lose">CPU の勝ち…</span>' : '引き分け';
  $('banner-sub').innerHTML = `最終スコア　あなた ${a} − ${b} CPU<br>「${myDef.ch}」の勝率：${rate(cr)}<br>通算：${rate(st)}`;
  $('next').hidden = true; $('again').hidden = false; $('change').hidden = false;
  $('banner').classList.remove('low');
  $('banner').hidden = false;
}

$('next').onclick = () => {
  $('banner').hidden = true;
  if (game.end >= ENDS - 1) { showResult(); return; }
  game.end++;
  newEnd();
};
$('again').onclick = () => startGame(myDef);
$('change').onclick = () => {
  $('banner').hidden = true; $('hud').hidden = true; $('controls').hidden = true;
  mode = 'select'; game = null; world = null;
  $('hint').textContent = '';
  $('select').hidden = false;
  refreshSelect();
};

// ---------- 画面の部品 ----------
let toastTimer = 0;
function toast(t, ms = 1500) {
  const el = $('toast');
  el.textContent = t; el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function updateHud() {
  if (!game) return;
  const tot = totals();
  const dots = t => '●'.repeat(PER_TEAM - game.thrown[t]) + '○'.repeat(game.thrown[t]);
  const head = '<tr><th></th>' + Array.from({ length: ENDS }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th>計</th><th>残り</th></tr>';
  const row = (t, cls) => `<tr class="${cls}"><td>${t ? '● CPU' : `● あなた「${myDef.ch}」`}</td>`
    + Array.from({ length: ENDS }, (_, i) => `<td class="${i === game.end ? 'cur' : ''}">${game.ends[i] ? game.ends[i][t] : ''}</td>`).join('')
    + `<td class="tot">${tot[t]}</td><td class="left" style="color:${COLORS[t]}">${dots(t)}</td></tr>`;
  $('sb').innerHTML = head + row(0, 'red') + row(1, 'blue');
  const v = myDef.traits;
  $('mine').innerHTML = `<span class="ch">${myDef.ch}</span>`
    + [['滑り', 'slide'], ['曲がり', 'curl'], ['重さ', 'heavy'], ['スイープ', 'sweep']].map(([n, k]) => {
      const p = Math.round(traitView(v)[k] * 100);
      return `<span class="stat">${n}<i><b style="width:${p}%"></b></i></span>`;
    }).join('') + `<span class="desc">${describe(v)}</span>`;
  const e = Math.min(game.end + 1, ENDS);
  $('status').textContent = `第${e}エンド　${Math.min(game.no + 1, PER_TEAM * 2)}/${PER_TEAM * 2}投目`;
}

function updateButtons() {
  $('sweep').disabled = !(mode === 'slide' && active && active.team === 0);
  $('spin').textContent = spin > 0 ? '回転 ↻ 右' : '回転 ↺ 左';
  $('speed').textContent = `速さ ×${speed}`;
}
$('spin').onclick = () => { spin = -spin; updateButtons(); if (mode === 'aim') makePreview(); };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; updateButtons(); };

// スイープ：ボタン長押し／スペースキー
const sweepOn = v => { sweepHeld = v; $('sweep').classList.toggle('on', v); };
$('sweep').addEventListener('pointerdown', e => { e.preventDefault(); $('sweep').setPointerCapture(e.pointerId); sweepOn(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => $('sweep').addEventListener(ev, () => sweepOn(false)));
addEventListener('keydown', e => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); sweepOn(true); }
});
addEventListener('keyup', e => { if (e.code === 'Space') sweepOn(false); });
addEventListener('blur', () => sweepOn(false));

// ---------- 描画 ----------
const canvas = $('view');
const ctx = canvas.getContext('2d');
let view = { w: 0, h: 0, dpr: 1, S: 1, ox: 0, oy: 0 };
let iceTex = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
  const w = r.width, h = r.height;
  const vh = SHEET.viewBottom - SHEET.viewTop;
  const S = Math.min(w / (2 * SHEET.halfW + 14), h / vh);
  view = { w, h, dpr, S, ox: w / 2, oy: (h - vh * S) / 2 - SHEET.viewTop * S };
  iceTex = null;
}
addEventListener('resize', resize);

const sx = x => view.ox + x * view.S, sy = y => view.oy + y * view.S;

// 氷の質感：薄い青白のグラデーション＋細かい傷＋ぶつぶつ
function buildIce() {
  const { S, dpr } = view;
  const w = Math.ceil(2 * SHEET.halfW * S * dpr), h = Math.ceil((SHEET.viewBottom - SHEET.viewTop) * S * dpr);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#f5fbff'); grad.addColorStop(0.5, '#e8f3fc'); grad.addColorStop(1, '#f1f8fd');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const rng = mulberry32(20240607);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {     // 細かい傷
    const x = rng() * w, y = rng() * h, a = rng() * Math.PI, l = (6 + rng() * 34) * dpr * S / 1.5;
    g.strokeStyle = rng() < 0.55 ? `rgba(150,185,215,${0.06 + rng() * 0.14})` : `rgba(255,255,255,${0.3 + rng() * 0.4})`;
    g.lineWidth = (0.4 + rng() * 0.8) * dpr;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.35); g.stroke();
  }
  for (let i = 0; i < 700; i++) {     // ぶつぶつ（ペブル）
    g.fillStyle = `rgba(190,215,235,${0.1 + rng() * 0.18})`;
    g.beginPath(); g.arc(rng() * w, rng() * h, (0.4 + rng() * 0.9) * dpr, 0, 6.3); g.fill();
  }
  const glare = g.createLinearGradient(0, 0, w, 0);   // 照明の映り込み
  glare.addColorStop(0, 'rgba(255,255,255,0)'); glare.addColorStop(0.3, 'rgba(255,255,255,.35)'); glare.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = glare; g.fillRect(0, 0, w, h);
  iceTex = c;
}

function drawRink() {
  const { S, dpr, w, h } = view;
  ctx.fillStyle = '#b7c8d9'; ctx.fillRect(0, 0, w, h);
  if (!iceTex) buildIce();
  const x0 = sx(-SHEET.halfW), y0 = sy(SHEET.viewTop);
  ctx.drawImage(iceTex, x0, y0, 2 * SHEET.halfW * S, (SHEET.viewBottom - SHEET.viewTop) * S);
  // サイドの壁
  ctx.fillStyle = '#8fa6bd';
  ctx.fillRect(0, 0, x0, h); ctx.fillRect(sx(SHEET.halfW), 0, w - sx(SHEET.halfW), h);
  // ハウス
  const ring = (r, col) => { ctx.beginPath(); ctx.arc(sx(0), sy(0), r * S, 0, 6.3); ctx.fillStyle = col; ctx.fill(); };
  ring(60, 'rgba(70,120,215,.62)'); ring(40, 'rgba(250,253,255,.95)'); ring(20, 'rgba(222,70,70,.62)'); ring(6, 'rgba(250,253,255,.95)');
  ctx.strokeStyle = 'rgba(40,70,120,.45)'; ctx.lineWidth = 1;
  for (const r of [60, 40, 20, 6]) { ctx.beginPath(); ctx.arc(sx(0), sy(0), r * S, 0, 6.3); ctx.stroke(); }
  // 線
  const line = (x1, y1, x2, y2, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2)); ctx.stroke(); };
  line(0, SHEET.viewTop, 0, SHEET.viewBottom, 'rgba(40,70,120,.35)', 1);
  line(-SHEET.halfW, 0, SHEET.halfW, 0, 'rgba(40,70,120,.35)', 1);
  line(-SHEET.halfW, SHEET.backY, SHEET.halfW, SHEET.backY, 'rgba(40,70,120,.55)', 2);
  line(-SHEET.halfW, SHEET.hogY, SHEET.halfW, SHEET.hogY, 'rgba(210,60,60,.8)', Math.max(2, 3 * S));
  ctx.fillStyle = 'rgba(190,50,50,.85)'; ctx.font = `${Math.max(9, 8 * S)}px system-ui`; ctx.textAlign = 'left';
  ctx.fillText('ホッグライン', sx(-SHEET.halfW) + 4, sy(SHEET.hogY) - 4);
  ctx.fillStyle = 'rgba(40,70,120,.7)';
  ctx.fillText('バックライン', sx(-SHEET.halfW) + 4, sy(SHEET.backY) - 3);
  // 投げる位置（ハック）
  line(-14, SHEET.hackY + 14, 14, SHEET.hackY + 14, 'rgba(40,70,120,.5)', 3);
}

function drawStone(s, def, team, alpha = 1, glow = false) {
  const { S } = view;
  ctx.save();
  ctx.translate(sx(s.x), sy(s.y)); ctx.rotate(s.a); ctx.scale(S, S);
  ctx.globalAlpha = alpha;
  ctx.save(); ctx.translate(1.1, 1.6); ctx.fillStyle = 'rgba(30,60,100,.28)'; ctx.fill(def.path, 'evenodd'); ctx.restore();
  ctx.fillStyle = COLORS[team];
  ctx.fill(def.path, 'evenodd');
  ctx.lineJoin = 'round'; ctx.lineWidth = 1; ctx.strokeStyle = glow ? '#ffd54f' : '#fff';
  ctx.stroke(def.path);
  ctx.restore();
}

function drawTrail() {
  if (trail.length < 2) return;
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    ctx.strokeStyle = b[2] ? 'rgba(40,190,170,.55)' : 'rgba(90,140,200,.32)';
    ctx.lineWidth = Math.max(1.5, (b[2] ? 4 : 2.6) * view.S * 0.5);
    ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke();
  }
}

function drawAim(now) {
  const { S } = view;
  const s = { x: 0, y: SHEET.hackY, a: Math.sin(now / 900) * 0.04 };
  if (mode === 'aim') {
    // 待機中のストーン（ゆらゆら）
    ctx.beginPath(); ctx.arc(sx(0), sy(SHEET.hackY), (R + 6 + Math.sin(now / 250) * 1.5) * S, 0, 6.3);
    ctx.strokeStyle = 'rgba(255,200,40,.85)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    drawStone(s, myDef, 0);
  }
  if (mode === 'aim' && drag) {
    const q = dragShot();
    if (!q) return;
    const len = 30 + 130 * q.power;
    const ex = sx(Math.sin(q.angle) * len), ey = sy(SHEET.hackY - Math.cos(q.angle) * len);
    ctx.strokeStyle = 'rgba(30,60,110,.7)'; ctx.lineWidth = 2.5; ctx.setLineDash([2, 7]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx(0), sy(SHEET.hackY)); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(30,60,110,.8)'; ctx.beginPath(); ctx.arc(ex, ey, 4, 0, 6.3); ctx.fill();
    // ゴムひも（引っぱった指）
    ctx.strokeStyle = 'rgba(200,60,60,.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx(0), sy(SHEET.hackY)); ctx.lineTo(sx(0) + (drag.x - drag.x0) * 0.6, sy(SHEET.hackY) + (drag.y - drag.y0) * 0.6); ctx.stroke();
    // 強さメーター
    const bx = sx(SHEET.halfW) - 14, bh = 120 * S * 0.8, by = sy(SHEET.hackY - 20);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(bx - 5, by - bh, 10, bh);
    ctx.fillStyle = q.power > 0.85 ? '#d33' : '#2b6cc4'; ctx.fillRect(bx - 5, by - bh * q.power, 10, bh * q.power);
    ctx.strokeStyle = '#1d3a5c'; ctx.lineWidth = 1; ctx.strokeRect(bx - 5, by - bh, 10, bh);
    if (preview) {   // 予想停止位置（スイープなし）
      const px = sx(preview.x), py = sy(Math.max(preview.y, SHEET.backY - 30));
      ctx.strokeStyle = 'rgba(30,60,110,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6); ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6); ctx.stroke();
      ctx.fillStyle = 'rgba(30,60,110,.85)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('止まる目安（スイープなし）', px, py - 10);
    }
  }
}

function drawFx(dt) {
  ctx.lineCap = 'round';
  for (const p of sparks) {
    const a = Math.max(0, p.life / p.max);
    ctx.strokeStyle = `rgba(${p.c},${a})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx(p.x), sy(p.y)); ctx.lineTo(sx(p.x - p.vx * 0.04), sy(p.y - p.vy * 0.04)); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.font = `bold ${Math.max(12, 10 * view.S)}px system-ui`;
  for (const f of floaters) {
    ctx.fillStyle = `rgba(200,50,50,${Math.min(1, f.life)})`;
    ctx.fillText(f.text, sx(f.x), sy(f.y - (2.4 - f.life) * 8));
  }
  // スイープのブラシ
  if (active && mode === 'slide' && sweepActive()) {
    const ph = performance.now() / 70;
    ctx.strokeStyle = 'rgba(20,150,130,.9)'; ctx.lineWidth = 3;
    for (const k of [-1, 1]) {
      const o = Math.sin(ph + k) * 7;
      ctx.beginPath(); ctx.moveTo(sx(active.x + k * 22 - 4), sy(active.y - 22 + o * 0.3)); ctx.lineTo(sx(active.x + k * 22 + 4 * k), sy(active.y - 22 - 6 + o * 0.3)); ctx.stroke();
    }
  }
}

function updateFx(dt) {
  for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93; p.life -= dt; }
  sparks = sparks.filter(p => p.life > 0);
  for (const f of floaters) f.life -= dt;
  floaters = floaters.filter(f => f.life > 0);
}

function addSparks(ev) {
  const n = Math.min(18, 6 + Math.round(ev.v / 10));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 20 + Math.random() * Math.min(160, ev.v * 1.2);
    sparks.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, max: 0.65, c: Math.random() < 0.5 ? '255,214,90' : '255,255,255' });
  }
}

function render(now) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  drawRink();
  if (!game || !world) return;
  drawTrail();
  for (const s of world.stones) if (!s.out) drawStone(s, s.def, s.team, 1, s === active);
  drawAim(now);
  drawFx();
}

// ---------- 入力：引っぱって投げる ----------
function dragShot() {
  if (!drag) return null;
  const dx = drag.x0 - drag.x, dy = drag.y0 - drag.y;   // 引いた向きの反対へ飛ぶ
  const len = Math.hypot(dx, dy) / view.S;
  if (dy >= 0 || len < 4) return null;
  return quantizeShot({ angle: Math.atan2(dx, -dy), power: Math.min(1, len / PULL_MAX), spin });
}
function makePreview() {
  const q = drag && dragShot();
  preview = q ? predictStop(myDef, q) : null;
}

canvas.addEventListener('pointerdown', e => {
  if (mode !== 'aim') return;
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  drag = { x0: e.clientX - r.left, y0: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top };
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = canvas.getBoundingClientRect();
  drag.x = e.clientX - r.left; drag.y = e.clientY - r.top;
  makePreview();
});
const release = e => {
  if (!drag) return;
  const q = dragShot();
  if (e.type !== 'pointercancel' && q && q.power >= 0.12 && mode === 'aim') launch(myDef, 0, q);
  else if (q) toast('もう少し強く引っぱってね', 1000);
  drag = null; preview = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ---------- ループ ----------
const sweepActive = () => active && (sweepHeld || activeSweepAuto);

function advance(dtReal) {
  if (mode !== 'slide' || !active) return;
  accum += Math.min(dtReal, 0.1) * speed;
  let n = 0;
  while (accum >= DT && n < 800) {
    accum -= DT; n++;
    const sw = sweepActive();
    world.step(sw);
    if ((world.tick & 3) === 0) trail.push([active.x, active.y, sw && !active.out]);
    for (const ev of world.events) addSparks(ev);
    world.events.length = 0;
    if (world.settled()) { endThrow(); break; }
    if (world.tick > 180 * 60) { endThrow(); break; }
  }
}

function frame(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016);
  lastT = t;
  advance(dt);
  updateFx(dt);
  render(t);
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
async function init() {
  buildSelect();
  refreshSelect();
  resize();
  requestAnimationFrame(frame);
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(res.status);
    font = opentype.parse(await res.arrayBuffer());
    refreshSelect();
  } catch (e) {
    $('go').textContent = 'フォントを読み込めませんでした';
    console.error(e);
  }
}
init();

if (DEBUG) {
  // テスト用：ブラウザから直接操作する
  window.__curling = {
    get state() { return { mode, game, level, speed, active }; },
    get world() { return world; },
    setSpeed(v) { speed = v; },
    makeStoneDef: t => makeStoneDef(font, t),
    World, planShot, mulberry32,
    throwPlayer(shot, sweep = false) { sweepHeld = sweep; launch(myDef, 0, shot); },
    setLevel(l) { level = l; },
    // 自分の番を CPU と同じ考え方で投げる（テスト用）
    autoPlayer() {
      const rng = mulberry32(game.seed + 99 + game.no);
      const plan = planShot(world, { team: 0, myNo: game.thrown[0], pool: [myDef], level: 'hard', rng });
      launch(myDef, 0, plan.shot, plan.sweep); activeSweepAuto = plan.sweep;
      return plan;
    },
  };
}
