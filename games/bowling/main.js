import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import {
  makeBall, makePin, createThrow, stepThrow, knockedPins, freeThrow, shotPose, throwSpeed,
  LANE_BOXES, PIN_SPOTS, LANE_W, LANE_LEN, BALL_DEPTH, PIN_DEPTH, DT,
  POS_MAX, POS_STEP, AIM_MAX, POWER_MIN, POWER_MAX,
} from './lane.js';
import { nextRoll, frameTotals, frameMarks, totalScore } from './score.js';

const BEST_KEY = 'moji_bowling.best';    // 文字ごとのハイスコア { ボールの字: { ピンの字: 点 } }
const STAGE_KEY = 'moji_bowling.stage';
// ピンの字（ステージ）。どれも高さを揃えてある。kick は当たったときのはじけ飛びやすさ（字ごとに倒れやすさが違うのを揃える）
const STAGES = [
  { ch: 'I', name: 'ふつう', kick: 1 },
  { ch: '｜', name: 'ほそい', kick: 1.4 },
  { ch: '人', name: 'どっしり', kick: 1 },
  { ch: '凸', name: 'かたい', kick: 0.2 },
];
const SHOW_SEC = 1.8;                    // 投球のあと結果を見せる時間

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20242e);
scene.fog = new THREE.Fog(0x20242e, 26, 48);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 6, bottom: -6, near: 0.5, far: 30 });
scene.add(sun, sun.target);
const front = new THREE.DirectionalLight(0xfff4e0, 0.9); // 手前からの光（ピンの正面を明るく見せる）
scene.add(front, front.target);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 68 : 50; // 縦長画面は広く映す
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 板目の木の模様（レーンの長さ方向に板が並ぶ）
function woodTexture(base) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const col = new THREE.Color(base);
  for (let i = 0; i < 32; i++) {
    const k = 0.92 + 0.12 * ((i * 37) % 11) / 10;
    g.fillStyle = `rgb(${col.r * 255 * k | 0},${col.g * 255 * k | 0},${col.b * 255 * k | 0})`;
    g.fillRect(i * 8, 0, 8, 64);
    g.fillStyle = 'rgba(0,0,0,.08)';
    g.fillRect(i * 8, 0, 1, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// レーン（物理は lane.js の箱と同じ）。見た目だけ作る
function buildLane() {
  const COLORS = { lane: 0xe8c89a, apron: 0xc9ccd4, gutter: 0x8d939e, wall: 0x3a4152, kick: 0x4a5468, pit: 0x1b1e26, back: 0x262a35 };
  for (const b of LANE_BOXES) {
    const mat = new THREE.MeshStandardMaterial({ color: COLORS[b.kind], roughness: b.kind === 'lane' ? 0.25 : 0.7 });
    if (b.kind === 'lane') {
      mat.map = woodTexture(0xffffff);
      mat.map.repeat.set(1, 1); // u が x（板が x 方向に並ぶ）
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), mat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const flat = (geo, color, x, z) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.003, z);
    scene.add(m);
    return m;
  };
  flat(new THREE.PlaneGeometry(LANE_W + 0.84, 0.04), 0xc0392b, 0, 0); // ファウルライン
  // スパット（目印の三角）とドット
  const tri = new THREE.Shape([new THREE.Vector2(-0.05, -0.12), new THREE.Vector2(0.05, -0.12), new THREE.Vector2(0, 0.12)]);
  for (let i = -3; i <= 3; i++) {
    flat(new THREE.ShapeGeometry(tri), 0x5b3a1e, i * 0.22, -4.6 - Math.abs(i) * 0.25);
    flat(new THREE.CircleGeometry(0.025, 12), 0x5b3a1e, i * 0.22, -2);
  }
  // ピンの立つ位置の印
  for (const s of PIN_SPOTS) flat(new THREE.CircleGeometry(0.06, 16), 0xb08a5c, s.x, s.z);
}
buildLane();

// 狙いの点線（ボールから進む向きへ）
const GUIDE_N = 28;
const guideMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.9 });
const guide = Array.from({ length: GUIDE_N }, () => {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), guideMat);
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
});
function showGuide(on) { for (const g of guide) g.visible = on; }

await RAPIER.init();

// ---------- ハイスコア（この端末のブラウザだけに保存） ----------
function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
}
function bestOf(ch, pinCh) { return loadBest()[ch]?.[pinCh]; }
function saveBest(ch, pinCh, score) {
  const b = loadBest();
  const prev = b[ch]?.[pinCh];
  if (prev != null && prev >= score) return false;
  (b[ch] ||= {})[pinCh] = score;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* 保存できなくても遊べる */ }
  return true;
}

// ---------- 状態 ----------
let font = null;
let stage = 0;
try { const s = +localStorage.getItem(STAGE_KEY); if (STAGES[s]) stage = s; } catch { /* 既定のまま */ }
let ball = null, pin = null;       // 形（makeBall / makePin）
let ballMesh = null;
let pinGeo = null, pinMeshes = [];
let mode = 'select';               // select | aim | rolling | show | over
let rolls = [];                    // 倒した本数
let standing = Array(10).fill(true);
let rack = null;                   // 今の投球が何フレーム目の何投目か（nextRoll）
let shot = { pos: 0, aim: 0, power: 70 };
let step = 0;                      // 0 立ち位置、1 向き、2 強さ
let sim = null;
let fast = false;
let showLeft = 0;
let lastKnocked = [];

function hashColor(ch) {
  let h = 0;
  for (const c of ch) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.75, 0.5);
}

function currentChar() {
  return Array.from($('char').value.trim())[0] || '';
}

function setBall(ch) {
  const b = makeBall(font, ch);
  if (!b) return false;
  ball = b;
  if (ballMesh) { scene.remove(ballMesh); ballMesh.geometry.dispose(); ballMesh.material.dispose(); }
  ballMesh = buildMesh(ball.polys, BALL_DEPTH, hashColor(ch));
  ballMesh.material.roughness = 0.25;
  scene.add(ballMesh);
  return true;
}

function setPins() {
  pin = makePin(RAPIER, font, STAGES[stage].ch, STAGES[stage].kick);
  for (const m of pinMeshes) scene.remove(m);
  if (pinGeo) { pinGeo.geometry.dispose(); pinGeo.material.dispose(); }
  pinGeo = buildMesh(pin.polys, PIN_DEPTH, 0xf6f4ee);
  pinGeo.material.roughness = 0.3;
  pinMeshes = PIN_SPOTS.map(() => {
    const m = new THREE.Mesh(pinGeo.geometry, pinGeo.material);
    m.castShadow = true;
    scene.add(m);
    return m;
  });
}

// 立っているピンを定位置に並べる（倒れたピンは片付ける）
function placePins() {
  PIN_SPOTS.forEach((s, i) => {
    const m = pinMeshes[i];
    m.visible = standing[i];
    const q = pin.rest.q;
    m.position.set(s.x, pin.rest.y, s.z);
    m.quaternion.set(q.x, q.y, q.z, q.w);
  });
}

// 構え：投げる前のボールを、投げる瞬間と同じ位置・向きに置く
function placeBall() {
  const p = shotPose(ball, shot);
  ballMesh.position.set(p.x, p.y, p.z);
  ballMesh.quaternion.set(p.q.x, p.q.y, p.q.z, p.q.w);
  // 点線：長さは強さに応じて
  const len = mode === 'aim' ? 3 + 11 * (step === 2 ? shot.power / 100 : 0.8) : 0;
  const dx = p.v.x / Math.hypot(p.v.x, p.v.z), dz = p.v.z / Math.hypot(p.v.x, p.v.z);
  guide.forEach((g, i) => {
    const d = 0.5 + i * 0.5;
    g.visible = mode === 'aim' && d < len;
    g.position.set(p.x + dx * d, 0.004, p.z + dz * d);
  });
  guideMat.color.set(step === 2 ? new THREE.Color().setHSL(0.33 - 0.33 * shot.power / 100, 0.9, 0.55) : 0xffd54f);
}

// ---------- 文字選び ----------
function renderStages() {
  const box = document.querySelector('.stages');
  box.innerHTML = '<span>ピン</span>' + STAGES.map((s, i) =>
    `<button data-i="${i}" class="${i === stage ? 'on' : ''}"><b>${s.ch}</b>${s.name}</button>`).join('');
  for (const b of box.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      stage = +b.dataset.i;
      try { localStorage.setItem(STAGE_KEY, String(stage)); } catch { /* 保存できなくてもよい */ }
      renderStages();
      if (font) { setPins(); standing = Array(10).fill(true); placePins(); renderStats(); }
    });
  }
}

function bar(label, value, text) {
  const w = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="stat"><span>${label}</span><i><b style="width:${w}%"></b></i><em>${text}</em></div>`;
}
function renderStats() {
  if (!ball) { $('stats').innerHTML = ''; return; }
  const best = bestOf(ball.ch, STAGES[stage].ch);
  $('stats').innerHTML =
    `<div class="stat-head"><b>「${ball.ch}」の性能</b><span>ハイスコア ${best != null ? best + ' 点' : '―'}</span></div>` +
    bar('丸さ', (ball.roundness - 0.75) / 0.25, `${(ball.roundness * 100).toFixed(0)}%`) +
    bar('重さ', ball.mass / 8, `${ball.mass.toFixed(1)} kg`) +
    bar('平たさ', 1 - ball.flat, `${((1 - ball.flat) * 100).toFixed(0)}%`) +
    bar('ガタガタ', ball.angular, ball.angular < 0.05 ? 'まっすぐ' : `${(ball.angular * 100).toFixed(0)}%`);
}

function preview() {
  const ch = currentChar();
  if (!ch || !font) return;
  if (!setBall(ch)) { msg(`「${ch}」は形が取れませんでした`); $('go').disabled = true; return; }
  msg('');
  $('go').disabled = false;
  shot = { pos: 0, aim: 0, power: 70 };
  standing = Array(10).fill(true);
  placePins();
  placeBall();
  renderStats();
}

function enterSelect() {
  mode = 'select';
  freeThrow(sim); sim = null;
  $('panel').hidden = false;
  for (const id of ['aim', 'rolling', 'result', 'card', 'pinmap']) $(id).hidden = true;
  $('callout').textContent = '';
  $('now').textContent = '';
  rolls = [];
  preview();
}

// ---------- ゲーム進行 ----------
function startGame() {
  if (!ball) return;
  rolls = [];
  standing = Array(10).fill(true);
  shot = { pos: 0, aim: 0, power: 70 };
  $('panel').hidden = true;
  $('result').hidden = true;
  $('card').hidden = false;
  $('pinmap').hidden = false;
  lastKnocked = [];
  nextThrow();
}

function nextThrow() {
  rack = nextRoll(rolls);
  if (!rack) return gameOver();
  if (rack.full) standing = Array(10).fill(true);
  lastKnocked = [];
  freeThrow(sim); sim = null;
  placePins();
  mode = 'aim';
  step = 0;
  $('aim').hidden = false;
  $('rolling').hidden = true;
  $('callout').textContent = '';
  renderCard();
  renderPinmap();
  renderAim();
  $('now').textContent = `「${ball.ch}」× ピン「${pin.ch}」　第${rack.frame + 1}フレーム ${rack.roll + 1}投目`;
}

const STEP_RANGE = [[-POS_MAX, POS_MAX], [-AIM_MAX, AIM_MAX], [POWER_MIN, POWER_MAX]];
const STEP_KEY = ['pos', 'aim', 'power'];
function valueText() {
  if (step === 0) {
    const m = shot.pos * POS_STEP;
    return shot.pos === 0 ? '中央' : `${m < 0 ? '左' : '右'} ${Math.abs(m).toFixed(2)} m`;
  }
  if (step === 1) return shot.aim === 0 ? 'まっすぐ' : `${shot.aim < 0 ? '左' : '右'}へ ${(Math.abs(shot.aim) / 10).toFixed(1)}°`;
  return `${shot.power}%（${(throwSpeed(shot.power) * 3.6).toFixed(0)} km/h）`;
}
function renderAim() {
  for (const b of document.querySelectorAll('.steps button')) {
    const i = +b.dataset.step;
    b.classList.toggle('on', i === step);
    b.classList.toggle('set', i < step);
  }
  const [lo, hi] = STEP_RANGE[step];
  const sl = $('slider');
  sl.min = lo; sl.max = hi; sl.step = 1; sl.value = shot[STEP_KEY[step]];
  $('val').textContent = valueText();
  $('ok').textContent = step === 2 ? '投げる！' : '決定';
  $('ok').classList.toggle('throw', step === 2);
  placeBall();
}
function setValue(v) {
  const [lo, hi] = STEP_RANGE[step];
  shot[STEP_KEY[step]] = Math.max(lo, Math.min(hi, Math.round(v)));
  renderAim();
}
function confirmStep() {
  if (mode !== 'aim') return;
  if (step < 2) { step++; renderAim(); return; }
  throwBall();
}

function throwBall() {
  sim = createThrow(RAPIER, ball, pin, standing, shot);
  mode = 'rolling';
  $('aim').hidden = true;
  $('rolling').hidden = false;
  showGuide(false);
}

function onThrowDone() {
  const knocked = knockedPins(sim);
  lastKnocked = knocked;
  const before = standing.filter(Boolean).length;
  const n = knocked.length;
  rolls.push(n);
  for (const i of knocked) standing[i] = false;
  let text = `${n} 本`;
  if (n === 10 && before === 10) text = 'ストライク！';
  else if (n === before && n > 0) text = 'スペア！';
  else if (n === 0) text = sim.gutter ? 'ガター…' : '0 本…';
  $('callout').textContent = text;
  $('rolling').hidden = true;
  mode = 'show';
  showLeft = SHOW_SEC;
  renderCard();
  renderPinmap();
}

function gameOver() {
  mode = 'over';
  freeThrow(sim); sim = null;
  const total = totalScore(rolls);
  const prev = bestOf(ball.ch, pin.ch);
  const isBest = saveBest(ball.ch, pin.ch, total);
  const strikes = frameMarks(rolls).flat().filter(m => m === 'X').length;
  const spares = frameMarks(rolls).flat().filter(m => m === '/').length;
  $('result-title').textContent = `${total} 点`;
  $('result-sub').innerHTML =
    `「${ball.ch}」× ピン「${pin.ch}」　ストライク ${strikes}・スペア ${spares}<br>` +
    (isBest ? (prev != null ? `ハイスコア更新！（前回 ${prev} 点）` : 'はじめての記録！') : `ハイスコア ${prev} 点`);
  $('result').hidden = false;
  $('aim').hidden = true;
  $('callout').textContent = '';
  $('now').textContent = `「${ball.ch}」× ピン「${pin.ch}」　ゲーム終了`;
  renderCard();
}

// ---------- スコア表・残りピン ----------
function renderCard() {
  const marks = frameMarks(rolls), totals = frameTotals(rolls);
  const cur = rack && mode !== 'over' ? rack.frame : -1;
  $('card').innerHTML = marks.map((m, f) =>
    `<div class="fr${f === 9 ? ' last' : ''}${f === cur ? ' cur' : ''}"><div class="no">${f + 1}</div>` +
    `<div class="marks">${m.map(t => `<span>${t}</span>`).join('')}</div><div class="sum">${totals[f] ?? ''}</div></div>`).join('') +
    `<div class="fr total"><div class="no">計</div><div class="sum">${totalScore(rolls)}</div></div>`;
}
function renderPinmap() {
  const rows = [[6, 7, 8, 9], [3, 4, 5], [1, 2], [0]]; // 奥の列が上
  const cls = i => (standing[i] ? '' : lastKnocked.includes(i) ? 'down' : 'gone');
  $('pinmap').innerHTML = rows.map(r => `<div>${r.map(i => `<i class="${cls(i)}"></i>`).join('')}</div>`).join('');
}

// ---------- 操作 ----------
$('go').addEventListener('click', startGame);
$('retry').addEventListener('click', startGame);
$('change').addEventListener('click', () => { enterSelect(); $('char').select(); });
$('quit').addEventListener('click', enterSelect);
$('char').addEventListener('input', () => { if (currentChar()) preview(); });
for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => { $('char').value = b.dataset.c; preview(); });
}
for (const b of document.querySelectorAll('.steps button')) {
  b.addEventListener('click', () => { if (mode === 'aim') { step = +b.dataset.step; renderAim(); } });
}
$('slider').addEventListener('input', () => setValue(+$('slider').value));
$('minus').addEventListener('click', () => setValue(shot[STEP_KEY[step]] - 1));
$('plus').addEventListener('click', () => setValue(shot[STEP_KEY[step]] + 1));
$('ok').addEventListener('click', confirmStep);
$('fast').addEventListener('click', () => { fast = !fast; $('fast').classList.toggle('on', fast); });

// 画面を左右にドラッグして値を変え、動かさずに離したら決定
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'aim') return;
  drag = { id: e.pointerId, x: e.clientX, v: shot[STEP_KEY[step]], moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id || mode !== 'aim') return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 6) drag.moved = true;
  if (!drag.moved) return;
  const [lo, hi] = STEP_RANGE[step];
  const span = Math.min(innerWidth, 700) * 0.9;   // 画面幅ほど動かすと端から端まで
  setValue(drag.v + dx / span * (hi - lo));
});
const endDrag = e => {
  if (!drag || e.pointerId !== drag.id) return;
  const tap = !drag.moved && e.type === 'pointerup';
  drag = null;
  if (tap) confirmStep();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
addEventListener('keydown', e => {
  if (mode !== 'aim' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; // スライダーやボタンは自分で反応する
  if (e.key === 'ArrowLeft') { setValue(shot[STEP_KEY[step]] - 1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { setValue(shot[STEP_KEY[step]] + 1); e.preventDefault(); }
  if (e.key === 'Enter' || e.key === ' ') { confirmStep(); e.preventDefault(); }
});

// ---------- ループ ----------
const camPos = new THREE.Vector3(1.6, 1.5, 3.2), camLook = new THREE.Vector3(0, 0.2, -10);
let last = performance.now(), acc = 0;

function syncSim() {
  const t = sim.ball.translation(), q = sim.ball.rotation();
  ballMesh.position.set(t.x, t.y, t.z);
  ballMesh.quaternion.set(q.x, q.y, q.z, q.w);
  sim.pins.forEach((b, i) => {
    if (!b) return;
    const p = b.translation(), r = b.rotation();
    pinMeshes[i].position.set(p.x, p.y, p.z);
    pinMeshes[i].quaternion.set(r.x, r.y, r.z, r.w);
  });
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (mode === 'rolling' && sim) {
    acc += dt * (fast ? 4 : 1);
    while (acc >= DT && !sim.done) { stepThrow(sim); acc -= DT; }
    syncSim();
    if (sim.done) { acc = 0; onThrowDone(); }
  }
  if (mode === 'show') {
    showLeft -= dt;
    if (showLeft <= 0) nextThrow();
  }

  // カメラ：構えでは斜め後ろから、転がり出したらボールを追い、ピンの手前で止まる
  // 縦長画面は下に操作パネルがあるので、高い位置から見下ろしてボールを画面の中ほどに映す
  const portrait = camera.aspect < 1;
  let bx = 0, bz = 0;
  const overview = mode === 'select' || mode === 'over';   // 文字選びと結果では、レーン全体を見せる
  if (ballMesh && !overview) { bx = ballMesh.position.x; bz = ballMesh.position.z; }
  const cz = Math.max(bz, -LANE_LEN + 4.5) + (portrait ? 4.2 : 2.6);
  const wantPos = new THREE.Vector3(bx * 0.6 + (portrait ? 0.5 : 1.4), portrait ? 2.0 : 1.3, cz);
  const wantLook = portrait
    ? new THREE.Vector3(bx * 0.3, 0, Math.min(cz - 9, -LANE_LEN))
    : new THREE.Vector3(bx * 0.3, 0.15, Math.min(cz - 12, -LANE_LEN));
  if (overview) {
    if (portrait) { wantPos.set(0.5, 1.0, 2.3); wantLook.set(0, 0.2, -6); }
    else { wantPos.set(1.5, 1.4, 2.8); wantLook.set(0, 0.25, -8); }
  }
  const k = 1 - Math.pow(1 - (mode === 'rolling' ? 0.12 : 0.08), dt * 60); // 画面の更新頻度によらず同じ速さで寄せる
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  sun.target.position.set(0, 0, camLook.z * 0.4 + camPos.z * 0.6 - 3);
  sun.position.set(sun.target.position.x + 3, 10, sun.target.position.z + 4);
  front.position.set(camPos.x, camPos.y + 2, camPos.z + 2);
  front.target.position.copy(camLook);
  if (mode === 'select' && ballMesh) ballMesh.rotation.y += dt * 0.6; // 文字を見せるためにくるくる回す
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 調整用：描画せずに1投だけ投げて結果を返す（コンソールで simulateThrow('〇', 'I', 0, 0, 70) ）。記録には残さない
window.simulateThrow = (ch, pinCh, pos, aim, power, stand = Array(10).fill(true)) => {
  const b = makeBall(font, ch), p = makePin(RAPIER, font, pinCh, STAGES.find(s => s.ch === pinCh)?.kick ?? 1);
  if (!b || !p) return null;
  const s = createThrow(RAPIER, b, p, stand, { pos, aim, power });
  let maxDx = 0;
  while (!s.done) {
    stepThrow(s);
    const t = s.ball.translation();
    if (!s.reachedPins) maxDx = Math.max(maxDx, Math.abs(t.x - pos * POS_STEP));
  }
  const t = s.ball.translation();
  const out = { knocked: knockedPins(s), time: +s.t.toFixed(2), gutter: s.gutter, end: [+t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3)], drift: +maxDx.toFixed(3) };
  freeThrow(s);
  return out;
};
// 確認用：いまの進行状況（コンソールで __bowling() ）
window.__bowling = () => ({ mode, step, rolls: rolls.slice(), standing: standing.slice(), shot: { ...shot }, total: totalScore(rolls) });

// ---------- フォント読み込み ----------
renderStages();
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  setPins();
  enterSelect();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
