import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { STAGES, LAUNCH, WORLD_L, WORLD_R, ringPos } from './stages.js';
import { makeBall, describeBall, createShot, stepShot, disposeShot, simulateShot, dirOf, DT, GRAVITY, SPEED_MAX, POWER_MAX, ANGLE_MIN, ANGLE_MAX } from './sim.js';
import { makeNet, stepNet, netLines } from './net.js';

const BALLS = 20;                 // 1プレイの球数
const RECORD_KEY = 'moji_basket.records'; // { "字|ステージ番号": ベストスコア }
const VIEW_H = 7.4, GROUND_AT = 7.1; // 画面に映る縦の範囲（m）と、その中での地面の位置（上から）
const PREVIEW_SEC = 0.55;         // 予測線を出す長さ（最初の少しだけ）
const MIN_PULL_PX = 14;           // これより短い引っぱりは取り消し

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

await RAPIER.init();

// ---------- 状態 ----------
let font = null, ball = null, stageIdx = 0;
let mode = 'loading';             // loading | ready | aiming | flying | over
let score = 0, ballsLeft = BALLS, combo = 0, bestCombo = 0, made = 0;
let clock = 0;                    // 動くリングの時計（固定刻みのステップ数）
let shot = null, aim = null, newRecord = false;
let nets = [], trail = [], particles = [], popups = [], glow = [];
let pause = 0;                    // 球が終わってから次の球が出るまでの待ち（秒）
let records = {};
try { records = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}') || {}; } catch { records = {}; }
const recKey = () => `${ball.ch}|${stageIdx + 1}`;
const saveRecords = () => { try { localStorage.setItem(RECORD_KEY, JSON.stringify(records)); } catch { /* 保存できなくても遊べる */ } };

// ---------- 画面 ----------
const canvas = $('view');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 30, OX = 0, GY = 0;   // S: 1m が何px か、OX: x=0 の画面位置、GY: 地面の画面y
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  const top = $('panel').getBoundingClientRect().bottom + 4;
  const availH = Math.max(120, H - top - 4);
  S = Math.min(W / (WORLD_R - WORLD_L + 0.4), availH / VIEW_H);
  OX = (W - (WORLD_R - WORLD_L) * S) / 2 - WORLD_L * S;
  GY = top + (availH - VIEW_H * S) / 2 + GROUND_AT * S;
  if (GY > H - 4) GY = H - 4;
}
addEventListener('resize', resize);
const px = (x, y) => [OX + x * S, GY - y * S];
const maxPullPx = () => Math.max(100, Math.min(170, 0.35 * Math.min(W, H)));

// ---------- UI ----------
function buildStageButtons() {
  const box = $('stages');
  box.innerHTML = '';
  STAGES.forEach((st, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${st.name}`;
    b.title = st.note;
    b.onclick = () => { stageIdx = i; reset(); };
    b.dataset.i = i;
    box.appendChild(b);
  });
}
function refreshUI() {
  for (const b of $('stages').children) b.classList.toggle('on', +b.dataset.i === stageIdx);
  for (const b of $('presets').children) b.classList.toggle('on', ball && b.dataset.c === ball.ch);
  $('score').textContent = score;
  $('balls').textContent = ballsLeft;
  const best = ball ? records[recKey()] : null;
  $('best').textContent = best == null ? '―' : best;
  $('hint').textContent = `${STAGES[stageIdx].note}　／　字をドラッグして引っぱり、離すと投げる`;
  $('hint').style.opacity = score === 0 && ballsLeft === BALLS && mode !== 'over' ? 1 : 0; // 最初の1球まで
}
function showTrait() {
  const p = ball.props;
  const bar = (name, v) => `<span class="bar">${name}<i><b style="width:${Math.round(Math.min(1, Math.max(0.04, v)) * 100)}%"></b></i></span>`;
  $('trait').innerHTML = describeBall(ball).map(t => `<span class="tag">${t}</span>`).join('') +
    `<div class="bars">${bar('重さ', p.mass / 0.14)}${bar('弾み', p.bounce / 0.82)}${bar('回転', p.spin / 14)}</div>`;
}

function setChar(text) {
  const ch = Array.from(text.trim()).slice(0, 2).join('');
  if (!ch) return false;
  const b = makeBall(font, ch);
  if (!b) { msg('この字は使えません'); setTimeout(() => msg(''), 1500); return false; }
  ball = b;
  $('char').value = ch;
  showTrait();
  reset();
  return true;
}

function reset() {
  if (shot) { disposeShot(shot); shot = null; }
  score = 0; ballsLeft = BALLS; combo = 0; bestCombo = 0; made = 0; newRecord = false;
  trail = []; particles = []; popups = []; glow = []; aim = null; pause = 0;
  clock = 0;
  nets = STAGES[stageIdx].rings.map(r => makeNet(r, ringPos(r, 0)));
  $('result').hidden = true;
  mode = 'ready';
  resize();
  refreshUI();
}

// ---------- 投げる ----------
const launchSpeed = power => SPEED_MAX * ball.props.boost * power / POWER_MAX;
function throwBall(power, angle) {
  if (mode !== 'ready' && mode !== 'aiming') return false;
  power = Math.min(POWER_MAX, Math.max(1, Math.round(power)));
  angle = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, Math.round(angle)));
  shot = createShot(RAPIER, ball, stageIdx, power, angle, clock);
  shot.counted = false;
  ballsLeft--;
  trail = [];
  mode = 'flying';
  aim = null;
  refreshUI();
  return true;
}

function onShotScored(sc) {
  combo++; made++; bestCombo = Math.max(bestCombo, combo);
  const bonus = Math.min(combo - 1, 3);
  const pts = sc.points + bonus;
  score += pts;
  const r = shot.rings[sc.ring];
  const label = sc.kind === 'swish' ? 'スウィッシュ！' : sc.kind === 'board' ? 'ボードイン' : 'ふちイン';
  popups.push({ text: `${label} +${pts}`, x: r.pos.x, y: r.pos.y + 0.9, t: 0, color: sc.kind === 'swish' ? '#7dffb2' : '#ffe27a' });
  if (combo >= 2) popups.push({ text: `${combo} COMBO!`, x: r.pos.x - 0.4, y: r.pos.y + 1.55, t: 0, color: '#ff9bd0', big: true });
  glow.push({ x: r.pos.x, y: r.pos.y, t: 0, r: r.ring.r });
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, v = 2 + (i % 5) * 0.7;
    particles.push({ x: r.pos.x, y: r.pos.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1.5, life: 0.9, color: i % 2 ? '#ffe27a' : '#ffffff' });
  }
  refreshUI();
}

function endShot() {
  if (!shot.scored) {
    if (combo > 0) popups.push({ text: 'COMBO ストップ', x: LAUNCH.x + 1.5, y: LAUNCH.y + 1.4, t: 0, color: '#ffb0b0' });
    combo = 0;
  }
  clock = shot.phase0 + shot.steps;
  disposeShot(shot); shot = null;
  pause = 0.35;
  mode = 'ready';
  if (ballsLeft <= 0) finish();
  refreshUI();
}

function finish() {
  mode = 'over';
  const k = recKey(), prev = records[k];
  newRecord = prev == null || score > prev;
  if (newRecord && score > 0) { records[k] = score; saveRecords(); }
  $('result-ch').textContent = ball.ch;
  $('result-title').textContent = `ステージ${stageIdx + 1}「${STAGES[stageIdx].name}」`;
  $('result-score').textContent = `${score}点`;
  $('result-sub').textContent = `${made}/${BALLS}球 入った・最大コンボ ${bestCombo}　` +
    (newRecord && score > 0 ? '🎉 ベスト更新！' : `ベスト ${prev ?? '―'}点`);
  $('next').hidden = stageIdx >= STAGES.length - 1;
  $('result').hidden = false;
  refreshUI();
}

// ---------- 入力（ドラッグして離す） ----------
function aimFrom(e) {
  const [bx, by] = px(LAUNCH.x, LAUNCH.y);
  const dx = e.clientX - bx, dy = e.clientY - by;
  const len = Math.hypot(dx, dy);
  const power = Math.min(1, len / maxPullPx()) * POWER_MAX;
  const angle = Math.atan2(dy, -dx) * 180 / Math.PI; // 引いた向きの反対へ飛ぶ
  return { dx, dy, len, power, angle, ok: len >= MIN_PULL_PX };
}
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'ready' || pause > 0.2) return;
  canvas.setPointerCapture(e.pointerId);
  mode = 'aiming'; aim = aimFrom(e);
});
canvas.addEventListener('pointermove', e => { if (mode === 'aiming') aim = aimFrom(e); });
const release = e => {
  if (mode !== 'aiming') return;
  const a = aimFrom(e);
  mode = 'ready'; aim = null;
  if (a.ok && e.type !== 'pointercancel') throwBall(a.power, a.angle);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

$('char').addEventListener('change', e => setChar(e.target.value));
$('char').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); } });
$('presets').addEventListener('click', e => { const c = e.target.dataset?.c; if (c) setChar(c); });
$('retry').onclick = () => reset();
$('next').onclick = () => { stageIdx = Math.min(STAGES.length - 1, stageIdx + 1); reset(); };
$('change').onclick = () => { $('result').hidden = true; $('char').focus(); $('char').select(); };

// ---------- 更新 ----------
function stepWorld() {
  for (let i = 0; i < nets.length; i++) {
    const ring = STAGES[stageIdx].rings[i];
    const pos = shot ? shot.rings[i].pos : ringPos(ring, clock);
    let b = null;
    if (shot) { const t = shot.body.translation(); b = { x: t.x, y: t.y, r: Math.max(ball.size.x, ball.size.y) * 0.5 + 0.03 }; }
    stepNet(nets[i], pos, b);
  }
  if (shot) {
    stepShot(shot);
    const t = shot.body.translation();
    trail.push([t.x, t.y]); if (trail.length > 40) trail.shift();
    if (shot.scored && !shot.counted) { shot.counted = true; onShotScored(shot.scored); }
    if (shot.done) endShot();
  } else {
    clock++;
    if (trail.length) trail.shift(); // 球が終わったら軌跡は消えていく
    if (pause > 0) pause = Math.max(0, pause - DT);
  }
  for (const p of particles) { p.x += p.vx * DT; p.y += p.vy * DT; p.vy -= 9 * DT; p.life -= DT; }
  particles = particles.filter(p => p.life > 0);
  for (const p of popups) p.t += DT;
  popups = popups.filter(p => p.t < 1.4);
  for (const g of glow) g.t += DT;
  glow = glow.filter(g => g.t < 0.7);
}

// ---------- 描画 ----------
const glyphPath = () => {
  if (ball._path) return ball._path;
  const p = new Path2D();
  for (const { outer, holes } of ball.polys) for (const ring of [outer, ...holes]) {
    ring.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.closePath();
  }
  return (ball._path = p);
};
function drawGlyph(x, y, rot, alpha = 1) {
  const [sx, sy] = px(x, y);
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(-rot); ctx.scale(S, -S);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ff8a1f'; ctx.strokeStyle = '#7a3500'; ctx.lineWidth = 2 / S;
  ctx.fill(glyphPath(), 'evenodd'); ctx.stroke(glyphPath());
  ctx.restore();
}

function ringPosNow(i) {
  return shot ? shot.rings[i].pos : ringPos(STAGES[stageIdx].rings[i], clock);
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1b2a49'); sky.addColorStop(1, '#3d5a8c');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  // 地面（体育館の床）
  ctx.fillStyle = '#b97a3b'; ctx.fillRect(0, GY, W, H - GY + 2);
  ctx.fillStyle = '#d99a56'; ctx.fillRect(0, GY, W, 4);
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); const [lx] = px(LAUNCH.x + 0.6, 0); ctx.moveTo(lx, GY); ctx.lineTo(lx + 8, GY + 20); ctx.stroke();
  // 壁
  for (const w of STAGES[stageIdx].walls) {
    const [x0, y0] = px(w.x - w.w / 2, w.y + w.h);
    ctx.fillStyle = '#7e8aa3'; ctx.fillRect(x0, y0, w.w * S, w.h * S);
    ctx.fillStyle = '#9aa7c2'; ctx.fillRect(x0, y0, 4, w.h * S);
  }
  // 発射台
  { const [x, y] = px(LAUNCH.x, 0); ctx.fillStyle = '#546e7a'; ctx.fillRect(x - 0.5 * S, y - (LAUNCH.y - 0.35) * S, S, (LAUNCH.y - 0.35) * S); }

  // リング・ボード・ネット
  STAGES[stageIdx].rings.forEach((ring, i) => {
    const p = ringPosNow(i);
    const [bx0, by0] = px(p.x + ring.r + 0.09 + 0.22, p.y - 0.12 + 1.15);
    ctx.fillStyle = '#f4f6fb'; ctx.fillRect(bx0 - 0.05 * S, by0, 0.1 * S, 1.15 * S);
    ctx.strokeStyle = '#d33'; ctx.lineWidth = 2;
    ctx.strokeRect(bx0 - 0.05 * S + 1, by0 + 0.5 * S, 0.1 * S - 2, 0.45 * S);
    // ネット（奥の糸）
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.2;
    for (const line of netLines(nets[i])) {
      ctx.beginPath(); line.forEach((n, k) => { const [x, y] = px(n.x, n.y); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    }
    // リングのふち
    const [l, ly] = px(p.x - ring.r - 0.09, p.y), [r] = px(p.x + ring.r + 0.09, p.y);
    ctx.strokeStyle = '#ff5a1f'; ctx.lineWidth = 0.09 * S; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(l, ly); ctx.lineTo(r, ly); ctx.stroke(); ctx.lineCap = 'butt';
  });
  // 入ったときの光
  for (const g of glow) {
    const [x, y] = px(g.x, g.y), k = g.t / 0.7;
    ctx.strokeStyle = `rgba(255,240,150,${1 - k})`; ctx.lineWidth = 6 * (1 - k) + 1;
    ctx.beginPath(); ctx.ellipse(x, y, (g.r + 0.3 + k * 1.2) * S, (0.25 + k * 0.5) * S, 0, 0, 7); ctx.stroke();
  }

  // 字の軌跡
  if (trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const [x0, y0] = px(...trail[i - 1]), [x1, y1] = px(...trail[i]);
      ctx.strokeStyle = `rgba(255,200,120,${i / trail.length * 0.7})`; ctx.lineWidth = 1 + 5 * i / trail.length;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }

  // 字
  if (shot) {
    const t = shot.body.translation();
    drawGlyph(t.x, t.y, shot.body.rotation());
  } else if (mode !== 'over' && ballsLeft > 0) {
    drawGlyph(LAUNCH.x, LAUNCH.y, 0, pause > 0 ? 0.5 : 1);
  }
  // ネットの手前の糸（ボールが入るとき前面にも見える）
  // 狙い：ゴムひもと予測線
  if (aim && mode === 'aiming') {
    const [bx, by] = px(LAUNCH.x, LAUNCH.y);
    const len = Math.min(aim.len, maxPullPx());
    const ux = aim.dx / (aim.len || 1), uy = aim.dy / (aim.len || 1);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + ux * len, by + uy * len); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + ux * len, by + uy * len, 7, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
    if (aim.ok) {
      const power = Math.max(1, Math.round(aim.power)), angle = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, Math.round(aim.angle)));
      const { c, s } = dirOf(angle), v = launchSpeed(power);
      for (let t = 0.05; t <= PREVIEW_SEC; t += 0.05) {
        const [x, y] = px(LAUNCH.x + v * c * t, LAUNCH.y + v * s * t - 0.5 * GRAVITY * t * t);
        ctx.fillStyle = `rgba(255,255,255,${1 - t / PREVIEW_SEC * 0.8})`;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`パワー ${power}　角度 ${angle}°`, bx + 16, by + 40);
    }
  }
  // 粒・文字演出
  for (const p of particles) {
    const [x, y] = px(p.x, p.y);
    ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life / 0.9);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  for (const p of popups) {
    const [x, y] = px(p.x, p.y), k = p.t / 1.4;
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    ctx.font = `bold ${(p.big ? 26 : 18) * (1 + (k < 0.1 ? 0.4 * (1 - k / 0.1) : 0))}px system-ui, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(p.text, x, y - k * 40);
    ctx.fillStyle = p.color; ctx.fillText(p.text, x, y - k * 40);
    ctx.globalAlpha = 1;
  }
  // コンボ表示（連続で入っている間）
  if (combo >= 2 && mode !== 'over') {
    ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.lineJoin = 'round';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.5)';
    const t = `${combo} COMBO  (+${Math.min(combo, 3)})`;
    ctx.strokeText(t, W - 12, H - 70); ctx.fillStyle = '#ff9bd0'; ctx.fillText(t, W - 12, H - 70);
  }
}

// 固定の時間刻みで進める
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= DT) { acc -= DT; if (mode !== 'loading') stepWorld(); }
  if (mode !== 'loading') draw();
  requestAnimationFrame(frame);
}

// ---------- 検証用（?debug のときだけ公開） ----------
if (new URLSearchParams(location.search).has('debug')) {
  window.__basket = {
    mode: () => mode,
    state: () => ({ mode, score, ballsLeft, combo, made, stageIdx, ch: ball?.ch, clock, best: records[recKey()] ?? null }),
    pxOf: (x, y) => px(x, y),
    pullPx: () => maxPullPx(),
    props: () => ball.props,
    setStage: i => { stageIdx = i; reset(); },
    setChar: c => setChar(c),
    clearRecords: () => { records = {}; saveRecords(); },
    records: () => records,
    launchSpeed,
    // 描画なしで1球だけ計算（探索用）。ch を指定すると、その字の球で計算する
    simulate: (ch, st, power, angle, phase = 0, track = false) => {
      const b = ch === ball.ch ? ball : makeBall(font, ch);
      return simulateShot(RAPIER, b, st, power, angle, phase, track);
    },
  };
}

// ---------- 起動 ----------
buildStageButtons();
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  msg('');
  setChar('〇');
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
requestAnimationFrame(frame);
