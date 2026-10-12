import * as opentype from 'opentype';
import { glyphPolygons, shapeMetrics } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import {
  R, CUP_R, PULL_MAX, simulateShot, quantizeShot, traitsFromMetrics, traitView, moverSegments,
} from './physics.js';
import { HOLES, COURSE_ID, holeBounds } from './courses.js';
import { holeName, fmtDiff, rankOf, describe } from './score.js';

const BEST_KEY = 'moji_golf.best';       // { コースID: { 字: { total, holes: [..] } } }
const LAST_KEY = 'moji_golf.last';       // 最後に遊んだ字
const OVER = 5;                          // パー+5打で切り上げ
const DEBUG = location.search.includes('debug');

const $ = id => document.getElementById(id);
const msg = (t, ms = 1800) => { $('msg').textContent = t; clearTimeout(msg.t); if (t) msg.t = setTimeout(() => { $('msg').textContent = ''; }, ms); };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } },
};

// ---------- 状態 ----------
let font = null;
let ball = null;           // 字のボール { ch, traits, path(Path2D), scale }
let hole = 0;              // 今のホール番号
let strokes = [];          // 終えたホールの打数
let cur = 0;               // 今のホールの打数
let pos = null;            // ボールの位置 { x, y, t }
let mode = 'select';       // select | aim | roll | banner | result
let play = null;           // 再生中の1打
let drag = null;           // ドラッグ中 { sx, sy, x, y }
let fast = false;
let sink = 0;              // カップインのアニメーション（0〜1）
let ballRot = 0;           // ボールの向き（ラジアン）
let lastStart = null;      // 水に落ちたとき戻る場所

// ---------- 文字 → ボール ----------
function makeBall(text) {
  const chars = [...text].slice(0, 2);
  const polys = [];
  let off = 0;
  for (const c of chars) {
    for (const p of glyphPolygons(font, c, 100)) {
      for (const q of p.outer) q.x += off;
      for (const h of p.holes) for (const q of h) q.x += off;
      polys.push(p);
    }
    off += font.getAdvanceWidth(c, 100);
  }
  if (!polys.length) return null;
  const m = shapeMetrics(polys);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const { outer } of polys) for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  const w = x1 - x0, h = y1 - y0;
  const traits = traitsFromMetrics({ area: m.area / 1e4, roundness: m.roundness, aspect: Math.min(w, h) / Math.max(w, h) });
  // 描画用の輪郭（中心を原点にして、画面向きにy反転）
  const path = new Path2D();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const { outer, holes } of polys) for (const ring of [outer, ...holes]) {
    ring.forEach((q, i) => (i ? path.lineTo(q.x - cx, -(q.y - cy)) : path.moveTo(q.x - cx, -(q.y - cy))));
    path.closePath();
  }
  const scale = R * 2.5 * (1 + 0.3 * (chars.length - 1)) / Math.max(w, h);
  return { ch: chars.join(''), traits, path, scale, metrics: { ...m, aspect: Math.min(w, h) / Math.max(w, h) } };
}

// ---------- 文字選び画面 ----------
const STAT_ROWS = [['転がり', 'roll'], ['止まりやすさ', 'stop'], ['重さ', 'heavy'], ['滑りやすさ', 'slide']];
const STAT_SHORT = [['転がり', 'roll'], ['止まり', 'stop'], ['重さ', 'heavy']];
const statHtml = (t, rows = STAT_ROWS) => {
  const v = traitView(t);
  return rows.map(([n, k]) => `<div class="stat"><span>${n}</span><i><b style="width:${Math.round(v[k] * 100)}%"></b></i><em>${Math.round(v[k] * 100)}</em></div>`).join('');
};

let preview = null;
function refreshPreview() {
  const text = $('char').value.trim();
  preview = font && text ? makeBall(text) : null;
  $('go').disabled = !preview;
  $('go').textContent = preview ? 'ゲーム開始' : font ? '文字を入れてね' : '読み込み中…';
  $('stats').innerHTML = preview
    ? `<div class="stat-head"><b>「${preview.ch}」の性格</b></div>${statHtml(preview.traits)}<div class="note">${describe(preview.traits)}</div>` : '';
  const b = preview && bestOf(preview.ch);
  $('best').textContent = b ? `この字のベスト：${b.total}打（${fmtDiff(b.total - parTotal())}）` : '';
}
const parTotal = () => HOLES.reduce((s, h) => s + h.par, 0);
const bestOf = ch => store.get(BEST_KEY, {})[COURSE_ID]?.[ch];

$('char').addEventListener('input', refreshPreview);
document.querySelectorAll('.presets button').forEach(b => b.addEventListener('click', () => { $('char').value = b.dataset.c; refreshPreview(); }));
$('go').addEventListener('click', () => { if (preview) startGame(preview); });
$('retry').addEventListener('click', () => startGame(ball));
$('change').addEventListener('click', toSelect);
$('next').addEventListener('click', nextHole);
$('ff').addEventListener('click', () => { fast = !fast; $('ff').textContent = fast ? '通常 ▶' : '早送り ▶▶'; });

function toSelect() {
  mode = 'select';
  for (const id of ['panel']) $(id).hidden = false;
  for (const id of ['card', 'info', 'me', 'ff', 'banner', 'result']) $(id).hidden = true;
  $('hint').textContent = '';
  $('now').textContent = '';
  hole = 0; pos = { x: HOLES[0].tee.x, y: HOLES[0].tee.y, t: 0 };
  refreshPreview();
}

// ---------- ゲームの進行 ----------
function startGame(b) {
  ball = b;
  store.set(LAST_KEY, b.ch);
  strokes = [];
  $('panel').hidden = true; $('result').hidden = true; $('banner').hidden = true;
  $('card').hidden = false; $('info').hidden = false; $('me').hidden = false;
  $('me-ch').textContent = b.ch;
  $('me-stats').innerHTML = statHtml(b.traits, STAT_SHORT);
  loadHole(0);
}

function loadHole(i) {
  hole = i; cur = 0; sink = 0; play = null; ballRot = 0; fast = false; $('ff').textContent = '早送り ▶▶';
  const h = HOLES[i];
  pos = { x: h.tee.x, y: h.tee.y, t: 0 };
  lastStart = { ...pos };
  mode = 'aim';
  $('banner').hidden = true; $('ff').hidden = true;
  layout(); renderCard();
}

function renderCard() {
  const h = HOLES[hole];
  const done = strokes.length;
  let html = '';
  let sum = 0, par = 0;
  HOLES.forEach((hh, i) => {
    const s = strokes[i];
    if (s !== undefined) { sum += s; par += hh.par; }
    const cls = s === undefined ? '' : s < hh.par ? 'u' : s > hh.par ? 'o' : '';
    html += `<div class="hc${i === hole && mode !== 'result' ? ' cur' : ''}"><div class="no">${i + 1}</div><div class="par">P${hh.par}</div><div class="sc ${cls}">${s ?? (i === hole ? cur || '' : '')}</div></div>`;
  });
  html += `<div class="hc total"><div class="no">計</div><div class="par">${done ? fmtDiff(sum - par) : ''}</div><div class="sc">${done ? sum : ''}</div></div>`;
  $('card').innerHTML = html;
  $('info').textContent = `${hole + 1}番「${h.name}」 PAR ${h.par}　打数 ${cur}　残り${HOLES.length - hole - 1}ホール`;
  $('now').textContent = h.hint;
  $('hint').textContent = mode === 'aim' ? 'ドラッグで引っぱって、はなすと打つ' : '';
}

function shoot(raw) {
  if (mode !== 'aim') return false;
  const shot = quantizeShot(raw.angle, raw.power);
  const h = HOLES[hole];
  const res = simulateShot(h, ball.traits, pos, shot);
  cur++;
  lastStart = { ...pos };
  play = { res, i: 0, shot, base: ballRot };
  mode = 'roll'; sink = 0;
  $('ff').hidden = false;
  renderCard();
  return true;
}

function endShot() {
  const { res } = play;
  const h = HOLES[hole];
  const f = res.frames;
  if (f.length) ballRot = play.base + f[f.length - 2];
  $('ff').hidden = true;
  if (res.result === 'cup') return holeDone(cur);
  if (res.result === 'water') {
    cur++;
    msg('ポチャン！ 1打罰（元の位置から）');
    pos = { x: lastStart.x, y: lastStart.y, t: res.end.t };
  } else {
    pos = { ...res.end };
  }
  play = null;
  if (cur >= h.par + OVER) { msg('ここまで！ 次のホールへ'); return holeDone(h.par + OVER, true); }
  mode = 'aim';
  renderCard();
}

function holeDone(n, gaveUp = false) {
  const h = HOLES[hole];
  strokes[hole] = n;
  mode = 'banner';
  const last = hole === HOLES.length - 1;
  $('banner-title').textContent = gaveUp ? 'ギブアップ' : holeName(n, h.par);
  $('banner-sub').textContent = `${h.name}：${n}打（パー${h.par}／${fmtDiff(n - h.par)}）`;
  $('next').textContent = last ? '結果を見る' : '次のホールへ';
  $('banner').hidden = false;
  renderCard();
}

function nextHole() {
  if (mode !== 'banner') return;
  if (hole + 1 < HOLES.length) loadHole(hole + 1); else showResult();
}

function showResult() {
  mode = 'result';
  const total = strokes.reduce((s, n) => s + n, 0), par = parTotal(), diff = total - par;
  const { rank, title } = rankOf(diff);
  // ベスト更新
  const all = store.get(BEST_KEY, {});
  const course = all[COURSE_ID] ||= {};
  const old = course[ball.ch];
  const isBest = !old || total < old.total;
  const holes = (old?.holes || []).slice();
  strokes.forEach((n, i) => { holes[i] = Math.min(holes[i] ?? 99, n); });
  course[ball.ch] = { total: isBest ? total : old.total, holes };
  store.set(BEST_KEY, all);

  $('banner').hidden = true; $('ff').hidden = true; $('me').hidden = true; $('info').hidden = true;
  $('result-rank').textContent = rank;
  $('result-title').textContent = `「${ball.ch}」 ${title}`;
  $('result-sub').textContent = `合計 ${total}打（パー${par}／${fmtDiff(diff)}）`;
  $('result-table').innerHTML = HOLES.map((h, i) => `<div>${i + 1} ${h.name}</div><div><b>${strokes[i]}打</b></div><div>${holeName(strokes[i], h.par)}</div>`).join('');
  $('result-best').textContent = isBest ? (old ? '新記録！ベストを更新しました' : '初めての記録です') : `この字のベスト：${old.total}打`;
  $('result').hidden = false;
  renderCard();
}

// ---------- 描画 ----------
const canvas = $('view');
const g = canvas.getContext('2d');
let view = { s: 1, ox: 0, oy: 0 };
let dpr = 1;

function layout() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const b = holeBounds(HOLES[hole]);
  const top = mode === 'select' ? 50 : 126, bottom = 92, pad = 22;
  const aw = w - 16, ah = h - top - bottom;
  const s = Math.min(aw / (b.w + pad * 2), ah / (b.h + pad * 2));
  view = { s, ox: (w - b.w * s) / 2 - b.x0 * s, oy: top + (ah - b.h * s) / 2 - b.y0 * s };
}
addEventListener('resize', layout);

const toScreen = (x, y) => [x * view.s + view.ox, y * view.s + view.oy];
const toWorld = (px, py) => [(px - view.ox) / view.s, (py - view.oy) / view.s];

function polyPath(pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

const SIDE = 7; // 壁の高さ（斜めに見せる分のずらし）

function drawZones(h, tms) {
  for (const z of h.zones || []) {
    g.save();
    if (z.type === 'sand') {
      g.fillStyle = '#e6cf8f';
      z.r ? (g.beginPath(), g.arc(z.x, z.y, z.r, 0, 7), g.fill()) : g.fillRect(z.x, z.y, z.w, z.h);
      g.fillStyle = 'rgba(150,110,40,.35)';
      const x0 = z.r ? z.x - z.r : z.x, y0 = z.r ? z.y - z.r : z.y, ww = z.r ? z.r * 2 : z.w, hh = z.r ? z.r * 2 : z.h;
      for (let yy = y0 + 6; yy < y0 + hh; yy += 14) for (let xx = x0 + ((yy / 14 | 0) % 2) * 7 + 4; xx < x0 + ww; xx += 14) {
        if (z.r && (xx - z.x) ** 2 + (yy - z.y) ** 2 > (z.r - 4) ** 2) continue;
        g.fillRect(xx, yy, 2, 2);
      }
    } else if (z.type === 'water') {
      g.fillStyle = '#2f7fd0'; g.fillRect(z.x, z.y, z.w, z.h);
      g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.5;
      g.save(); g.beginPath(); g.rect(z.x, z.y, z.w, z.h); g.clip();
      for (let yy = z.y + 10; yy < z.y + z.h; yy += 18) {
        g.beginPath();
        for (let xx = z.x; xx <= z.x + z.w; xx += 6) g.lineTo(xx, yy + Math.sin(xx / 9 + tms / 500 + yy) * 2.5);
        g.stroke();
      }
      g.restore();
    } else if (z.type === 'slope') {
      g.fillStyle = 'rgba(20,70,30,.22)'; g.fillRect(z.x, z.y, z.w, z.h);
      const m = Math.hypot(z.ax, z.ay), ux = z.ax / m, uy = z.ay / m;
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
      const flow = (tms / 40) % 36;
      for (let yy = z.y + 18; yy < z.y + z.h; yy += 36) for (let xx = z.x + 18; xx < z.x + z.w; xx += 36) {
        const cx = xx + ux * (flow - 18) * 0.5, cy = yy + uy * (flow - 18) * 0.5;
        g.beginPath();
        g.moveTo(cx - ux * 8 - uy * 5, cy - uy * 8 + ux * 5); g.lineTo(cx + ux * 8, cy + uy * 8); g.lineTo(cx - ux * 8 + uy * 5, cy - uy * 8 - ux * 5);
        g.stroke();
      }
    }
    g.restore();
  }
}

function drawWarps(h, tms) {
  (h.warps || []).forEach((w, i) => {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([4, 6]); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(w.from.x, w.from.y); g.lineTo(w.to.x, w.to.y); g.stroke(); g.setLineDash([]);
    for (const [p, col, label] of [[w.from, '#8e44d6', '入'], [w.to, '#14b8a6', '出']]) {
      const grad = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, w.r);
      grad.addColorStop(0, '#111'); grad.addColorStop(1, col);
      g.fillStyle = grad; g.beginPath(); g.arc(p.x, p.y, w.r, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, w.r * (0.7 + 0.08 * Math.sin(tms / 250 + i)), 0, 7); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, p.x, p.y);
    }
    g.restore();
  });
}

function drawCup(h, tms) {
  const { x, y } = h.cup;
  g.fillStyle = '#0c1a10'; g.beginPath(); g.arc(x, y, CUP_R, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, CUP_R, 0, 7); g.stroke();
  // 旗
  g.strokeStyle = '#eee'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 52); g.stroke();
  const wv = Math.sin(tms / 300) * 2;
  g.fillStyle = '#e53935'; g.beginPath(); g.moveTo(x, y - 52); g.lineTo(x + 24 + wv, y - 45); g.lineTo(x, y - 37); g.fill();
}

function drawMovers(h, t) {
  const tmp = [];
  for (const m of h.movers || []) {
    const segs = moverSegments(m, t, tmp);
    if (m.type === 'windmill') {
      for (const off of [SIDE, 0]) {
        g.strokeStyle = off ? '#6d3b2a' : '#e8553d'; g.lineWidth = (m.th || 4) * 2 + 2; g.lineCap = 'round';
        for (const s of segs) { g.beginPath(); g.moveTo(s.x1, s.y1 + off); g.lineTo(s.x2, s.y2 + off); g.stroke(); }
      }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(m.x, m.y, 7, 0, 7); g.fill();
    } else {
      const xs = segs.map(s => s.x1), ys = segs.map(s => s.y1);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0;
      g.fillStyle = '#6d3b2a'; g.fillRect(x0, y0 + SIDE, w, hh);
      g.fillStyle = '#e8553d'; g.fillRect(x0, y0, w, hh);
      g.fillStyle = 'rgba(255,255,255,.7)';
      for (let xx = x0 + 6; xx < x0 + w - 6; xx += 24) g.fillRect(xx, y0 + 4, 12, hh - 8);
    }
  }
}

function drawBall(b, x, y, rot, scale = 1) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(2, R * 0.55 + 3, R * scale * 0.95, R * scale * 0.5, 0, 0, 7); g.fill();
  g.translate(0, -2 * scale);
  g.scale(scale, scale);
  g.fillStyle = 'rgba(255,255,255,.93)'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();
  g.rotate(rot);
  g.scale(b.scale, b.scale);
  g.lineJoin = 'round';
  g.fillStyle = '#16301f';
  g.fill(b.path, 'evenodd');
  g.restore();
}

function drawAim() {
  if (!drag || mode !== 'aim') return;
  const a = aimOf(drag);
  if (!a) return;
  const len = a.power * PULL_MAX;
  const dx = Math.cos(a.angle), dy = Math.sin(a.angle);
  // 引っぱったゴムひも（ボールの反対側）
  g.save();
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(pos.x, pos.y); g.lineTo(pos.x - dx * len, pos.y - dy * len); g.stroke();
  // 打つ向きの矢印（長さ＝強さ）
  const col = `hsl(${Math.round(120 - 120 * a.power)} 85% 55%)`;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 4; g.setLineDash([8, 7]);
  const L = len * 1.6 + 20;
  g.beginPath(); g.moveTo(pos.x + dx * R * 1.3, pos.y + dy * R * 1.3); g.lineTo(pos.x + dx * L, pos.y + dy * L); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(pos.x + dx * (L + 14), pos.y + dy * (L + 14));
  g.lineTo(pos.x + dx * L - dy * 8, pos.y + dy * L + dx * 8); g.lineTo(pos.x + dx * L + dy * 8, pos.y + dy * L - dx * 8); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3;
  const tx = pos.x + dx * (L + 30), ty = pos.y + dy * (L + 30);
  g.strokeText(Math.round(a.power * 100) + '%', tx, ty); g.fillText(Math.round(a.power * 100) + '%', tx, ty);
  g.restore();
}

function frame(tms) {
  // 再生を進める（120Hz の刻みを、通常は1フレームに2刻み）
  if (mode === 'roll' && play) {
    const n = play.res.frames.length / 4;
    play.i += (DEBUG ? 40 : fast ? 10 : 2);
    if (play.i >= n - 1) {
      play.i = Math.max(0, n - 1);
      if (play.res.result === 'cup') { sink += 0.06; if (sink >= 1) endShot(); } else endShot();
    }
  }
  const h = HOLES[hole];
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#16301f'; g.fillRect(0, 0, innerWidth, innerHeight);

  g.save();
  g.translate(view.ox, view.oy); g.scale(view.s, view.s);

  // 芝
  polyPath(h.outline);
  g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 18 * view.s; g.shadowOffsetY = 8 * view.s; g.fillStyle = '#2f7a40'; g.fill(); g.restore();
  g.save(); polyPath(h.outline); g.clip();
  const b = holeBounds(h);
  for (let k = 0; k * 40 < b.h + 40; k++) { g.fillStyle = k % 2 ? '#3f9a52' : '#3a9050'; g.fillRect(b.x0, b.y0 + k * 40, b.w, 40); }
  drawZones(h, tms);
  g.restore();

  // 壁（下にずらした濃い色で高さを出す）
  const wallPolys = [h.outline, ...(h.walls || [])];
  g.lineJoin = 'round';
  for (const [i, p] of wallPolys.entries()) {
    g.save();
    if (i) { polyPath(p.map(([x, y]) => [x, y + SIDE])); g.fillStyle = '#7a5a36'; g.fill(); polyPath(p); g.fillStyle = '#d3a96b'; g.fill(); }
    g.restore();
    polyPath(p.map(([x, y]) => [x, y + SIDE])); g.strokeStyle = '#7a5a36'; g.lineWidth = 9; g.stroke();
    polyPath(p); g.strokeStyle = '#d3a96b'; g.lineWidth = 9; g.stroke();
    g.strokeStyle = '#efd7a8'; g.lineWidth = 2; g.stroke();
  }

  drawCup(h, tms);
  drawWarps(h, tms);

  // 動くしかけ：打っている間はその刻み、止まっている間は止めておく
  let t = pos ? pos.t : 0;
  let bx = pos ? pos.x : h.tee.x, by = pos ? pos.y : h.tee.y, rot = ballRot;
  let scale = 1;
  if (mode === 'roll' && play) {
    const k = Math.min(play.i, play.res.frames.length / 4 - 1) * 4, f = play.res.frames;
    if (f.length) { bx = f[k]; by = f[k + 1]; rot = play.base + f[k + 2]; t = f[k + 3]; }
    if (play.res.result === 'cup') scale = 1 - Math.min(sink, 1);
  }
  drawMovers(h, t);

  const bl = mode === 'select' ? preview : ball;
  if (bl && scale > 0.02) drawBall(bl, bx, by, rot, scale);
  else if (!bl) drawBall0(bx, by);
  if (mode === 'roll' && play && play.res.result === 'water' && play.i >= play.res.frames.length / 4 - 1) { // 水しぶき
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(bx, by, 14 + (tms / 30) % 14, 0, 7); g.stroke();
  }
  drawAim();
  g.restore();
  requestAnimationFrame(frame);
}
function drawBall0(x, y) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); }

// ---------- ドラッグ操作（パチンコ式） ----------
// 画面のどこをドラッグしてもよい。引いた向きの反対へ、引いた長さに比例した強さで飛ぶ
function aimOf(d) {
  const dx = d.sx - d.x, dy = d.sy - d.y;
  const len = Math.hypot(dx, dy) / view.s;
  const power = Math.min(1, len / PULL_MAX);
  if (power < 0.05) return null;
  return { angle: Math.atan2(dy, dx), power };
}
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'aim') return;
  canvas.setPointerCapture(e.pointerId);
  drag = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; } });
const release = e => {
  if (!drag) return;
  const a = aimOf(drag);
  drag = null;
  if (a && e.type !== 'pointercancel') shoot(a);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ---------- 起動 ----------
async function boot() {
  toSelect();
  layout();
  $('char').value = store.get(LAST_KEY, '〇');
  requestAnimationFrame(frame);
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(res.status);
    font = opentype.parse(await res.arrayBuffer());
    refreshPreview();
  } catch (err) {
    $('go').textContent = 'フォントを読み込めません';
    msg('フォントの読み込みに失敗しました。ネットワークを確認してください', 6000);
  }
}
boot();

// テスト用の操作口（?debug のときだけ）
if (DEBUG) {
  window.__golf = {
    mode: () => mode,
    state: () => ({ mode, hole, cur, strokes: strokes.slice(), pos: pos && { ...pos }, ch: ball?.ch, result: play?.res.result }),
    start: text => { const b = makeBall(text); if (!b) return false; startGame(b); return true; },
    shoot: (angle, power) => shoot({ angle, power }),
    next: () => nextHole(),
    traits: text => makeBall(text)?.traits,
    metrics: text => makeBall(text)?.metrics,
    holes: HOLES,
    goto: i => loadHole(i),
    holeList: () => HOLES,
    view: () => view,
    simulate: (text, hi, st, shot) => simulateShot(HOLES[hi], makeBall(text).traits, st, shot),
    pxOf: (x, y) => toScreen(x, y),
    pullPx: () => PULL_MAX * view.s,
    solverModule: () => import('./solver.js'),
  };
}
