// 文字タワーバトル：プレイヤーと CPU が交互に文字を落として積む。自分の番で台から落としたら負け
import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import {
  makeShape, createWorld, addBody, pieceTop, hoverY, topProfile, bottomProfile, landing, cpuPlan,
  DEPTH, DT, STAGE_W, STAGE_H, FALL_Y, ROT_STEP, COL,
} from './tower.js';

const BEST_KEY = 'moji_tower.best';
const LEVEL_KEY = 'moji_tower.level';
// 配られる文字。平らで積みやすいもの〜丸くて転がるもの・とげとげしたものまで混ぜる
const POOL = Array.from('口日田目皿工王土山凸凹回四一二三人大木米水永火あのゑろぬめS@?〇鬱乙');
const HAND_SIZE = 3;
const LEVELS = {
  easy: { jitter: 0.2, verify: 2 },    // jitter：狙いのずれ（m）、verify：物理で確かめる候補の数
  normal: { jitter: 0.08, verify: 5 },
  hard: { jitter: 0.02, verify: 10 },
};
const AIM_RANGE = STAGE_W / 2 + 2;     // 左右に動かせる範囲（台の外にも落とせる）
const PLAYER_COLORS = [0xff7043, 0xffa726, 0xef5350, 0xffca28, 0xec407a];
const CPU_COLORS = [0x42a5f5, 0x26c6da, 0x5c6bc0, 0x66bb6a, 0x7e57c2];
const NAMES = ['あなた', 'CPU'];

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe8f7);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa88, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-4, 8, 10);
scene.add(sun);

// 台と、その下の柱（見た目だけ。当たり判定は tower.js の台だけ）
const stageMesh = new THREE.Mesh(new THREE.BoxGeometry(STAGE_W, STAGE_H, 2.2), new THREE.MeshStandardMaterial({ color: 0xa47148, roughness: 0.8 }));
stageMesh.position.y = -STAGE_H / 2;
scene.add(stageMesh);
const pillar = new THREE.Mesh(new THREE.BoxGeometry(STAGE_W * 0.4, 60, 1.6), new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.9 }));
pillar.position.y = -STAGE_H - 30;
scene.add(pillar);

let baseW = 10, baseH = 10, zoom = 1, viewW = 10, viewH = 10, camY = 3;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  baseW = Math.max(7.5, 8 * w / h);   // 縦長の画面でも台と左右の余白が収まる幅
  baseH = baseW * h / w;
  applyView();
}
function applyView() {
  viewW = baseW * zoom; viewH = baseH * zoom;
  camera.left = -viewW / 2; camera.right = viewW / 2;
  camera.top = viewH / 2; camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 台は下の操作パネルのすぐ上、落とす駒は上の表示の下に来るようにする。
// 塔が伸びたらまず引いて（ズームアウト）全体を見せ、引ききったらカメラを上げる
const HEAD_ROOM = 2.6; // 塔の上に空けておく高さ（落とす駒のぶん）
const ZOOM_MAX = 2.2;
const screenFrac = () => ({ bottom: ($('controls').offsetHeight + 70) / innerHeight, top: 130 / innerHeight });
function zoomTarget() {
  const f = screenFrac();
  return Math.min(ZOOM_MAX, Math.max(1, (towerTop + HEAD_ROOM) / (baseH * (1 - f.bottom - f.top))));
}
function cameraTarget() {
  const f = screenFrac();
  const stageY = viewH * (0.5 - f.bottom);  // 台の上面を画面中心からどれだけ下に置くか
  const topRoom = viewH * (0.5 - f.top);    // 画面中心から HUD の下までの高さ
  return Math.max(stageY, towerTop + HEAD_ROOM - topRoom);
}

await RAPIER.init();

// ---------- 状態 ----------
let font = null;
const shapes = new Map(); // 文字 → 形
let world = null;
let pieces = [];          // { shape, body, mesh, owner, fallen }
let state = 'title';      // title | aim | drop | over
let level = 'normal';
try { if (localStorage.getItem(LEVEL_KEY) in LEVELS) level = localStorage.getItem(LEVEL_KEY); } catch { /* 既定のまま */ }
let turn = 0;             // 0: プレイヤー、1: CPU
let firstPlayer = 1;      // 先攻は1試合ごとに入れ替える
let turnCount = 0;
let hands = [[], []];
let sel = 0;              // 手番の人が選んでいる手札
let aimX = 0, aimR = 0;   // 落とす位置（COL 刻み）と回転（45° 刻みの段数）
let dispX = 0, dispY = 0, dispA = 0;
let towerTop = 0, maxHeight = 0;
let lastDropper = 0;
let dropTime = 0, calmTime = 0, overTime = 0;
let loser = -1, fallenCh = '';
let cpu = null;           // CPU の思考 { iter, plan, t, rotT }
let topCache = null;      // 塔の上面（着地予想用）
let colorIndex = [0, 0];

function loadBest() { try { return +localStorage.getItem(BEST_KEY) || 0; } catch { return 0; } }
function saveBest(h) { try { localStorage.setItem(BEST_KEY, String(h)); } catch { /* 保存できなくても遊べる */ } }

function shapeOf(ch) {
  if (!shapes.has(ch)) shapes.set(ch, makeShape(font, ch));
  return shapes.get(ch);
}
function deal() {
  for (;;) {
    const s = shapeOf(POOL[Math.floor(Math.random() * POOL.length)]);
    if (s) return s;
  }
}

// ---------- 落とす前の駒（操作中の表示）と着地予想 ----------
const hover = new THREE.Group();
const preview = new THREE.Group();
scene.add(hover, preview);
let hoverShape = null;

function clearGroup(g) {
  for (const m of g.children) { if (g === hover) m.geometry.dispose(); m.material.dispose(); }
  g.clear();
}
function setHover(shape) {
  if (shape === hoverShape) return;
  clearGroup(preview); clearGroup(hover);
  hoverShape = shape;
  if (!shape) return;
  const color = (turn === 0 ? PLAYER_COLORS : CPU_COLORS)[colorIndex[turn] % 5];
  const mesh = buildMesh(shape.polys, DEPTH, color);
  hover.add(mesh);
  const ghost = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
  preview.add(ghost);
  dispY = hoverY(shape, aimR * ROT_STEP, towerTop);
}

function updatePreview() {
  preview.visible = false;
  if (state !== 'aim' || turn !== 0 || !hoverShape) return;
  topCache ??= topProfile(pieces);
  const y = landing(topCache, bottomProfile(hoverShape, aimR), Math.round(aimX / COL));
  if (y === -Infinity) return;  // 下に何も無い（台の外）
  preview.visible = true;
  preview.position.set(aimX, y, 0.01);
  preview.rotation.z = aimR * ROT_STEP;
}

// ---------- 試合の流れ ----------
function clearPieces() {
  for (const p of pieces) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
  pieces = [];
  world?.free();
}

function newGame() {
  clearPieces();
  world = createWorld(RAPIER);
  hands = [Array.from({ length: HAND_SIZE }, deal), Array.from({ length: HAND_SIZE }, deal)];
  turnCount = 0; towerTop = 0; maxHeight = 0; loser = -1; colorIndex = [0, 0];
  firstPlayer = 1 - firstPlayer;
  $('title').hidden = true; $('result').hidden = true;
  beginTurn(firstPlayer);
}

function measureTower() {
  towerTop = 0;
  for (const p of pieces) if (!p.fallen) towerTop = Math.max(towerTop, pieceTop(p));
  maxHeight = Math.max(maxHeight, towerTop);
}

function beginTurn(who) {
  state = 'aim';
  turn = who;
  turnCount++;
  measureTower();
  topCache = null;
  aimX = 0; aimR = 0; dispX = 0; dispA = 0;
  if (sel >= HAND_SIZE) sel = 0;
  if (who === 0) {
    setHover(hands[0][sel]);
    cpu = null;
  } else {
    setHover(null);   // 考え終わるまで駒は出さない
    cpu = { iter: cpuPlan(RAPIER, pieces, hands[1], towerTop, LEVELS[level].verify), plan: null, t: 0, rotT: 0 };
  }
  renderUI();
}

function drop(byCpu = false) {
  if (state !== 'aim' || !hoverShape || byCpu !== (turn === 1)) return; // 相手の番には落とせない
  const shape = hoverShape, a = aimR * ROT_STEP;
  let x = aimX;
  if (turn === 1) x += (Math.random() * 2 - 1) * LEVELS[level].jitter; // CPU の手元のぶれ
  const body = addBody(RAPIER, world, shape, x, hoverY(shape, a, towerTop), a);
  const color = (turn === 0 ? PLAYER_COLORS : CPU_COLORS)[colorIndex[turn]++ % 5];
  const mesh = buildMesh(shape.polys, DEPTH, color);
  scene.add(mesh);
  pieces.push({ shape, body, mesh, owner: turn, fallen: false });
  hands[turn][turn === 0 ? sel : cpu.plan.h] = deal();
  lastDropper = turn;
  setHover(null);
  state = 'drop';
  dropTime = 0; calmTime = 0;
  renderUI();
}

function gameOver(who, p) {
  state = 'over';
  loser = who;
  fallenCh = p.shape.ch;
  overTime = 0;
  setHover(null);
  cpu = null;
  renderUI();
}

function showResult() {
  const win = loser === 1;
  const best = loadBest();
  const isBest = maxHeight > best + 1e-6;
  if (isBest) saveBest(maxHeight);
  $('result-title').textContent = win ? 'あなたの勝ち！' : 'あなたの負け…';
  $('result-sub').innerHTML =
    `${NAMES[loser]}の番で「<span class="glyph">${fallenCh}</span>」が台から落ちた<br>` +
    `高さ ${maxHeight.toFixed(1)} m ・ ${turnCount} ターン` + (isBest ? '<br><b>最高記録！</b>' : '');
  $('result').hidden = false;
  renderUI();
}

// ---------- 物理 ----------
function physicsStep() {
  world.step();
  for (const p of pieces) {
    if (p.fallen) continue;
    if (p.body.translation().y < FALL_Y) {
      p.fallen = true;
      // 落ち着く前に崩れても、次の人が狙っている間に崩れても、最後に落とした人の責任
      if (state === 'aim' || state === 'drop') gameOver(lastDropper, p);
    }
  }
  // ずっと下まで落ちた駒は片付ける
  pieces = pieces.filter(p => {
    if (p.body.translation().y > -40) return true;
    world.removeRigidBody(p.body);
    scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
    return false;
  });
  if (state === 'drop') {
    dropTime += DT;
    const calm = pieces.every(p => {
      if (p.fallen) return true;
      const v = p.body.linvel();
      return v.x * v.x + v.y * v.y < 0.03 * 0.03 && Math.abs(p.body.angvel()) < 0.05;
    });
    calmTime = calm ? calmTime + DT : 0;
    if ((dropTime > 0.6 && calmTime > 0.4) || dropTime > 8) beginTurn(1 - turn);
  }
}

// ---------- CPU ----------
function cpuThink(dt) {
  cpu.t += dt;
  if (!cpu.plan) {
    const t0 = performance.now();
    let r;
    do { r = cpu.iter.next(); } while (!r.done && performance.now() - t0 < 8);
    if (r.done) {
      cpu.plan = r.value;
      cpu.t = 0;
      setHover(hands[1][cpu.plan.h]);
      renderUI();
    }
    return;
  }
  if (cpu.t < 0.35) return; // 手札を選んだところを見せる
  // 回して、動かして、少し待ってから落とす
  const goalR = cpu.plan.r;
  if (aimR !== goalR) {
    cpu.rotT += dt;
    if (cpu.rotT > 0.18) { cpu.rotT = 0; aimR = (aimR + ((goalR - aimR + 8) % 8 <= 4 ? 1 : 7)) % 8; }
    return;
  }
  if (Math.abs(aimX - cpu.plan.x) > 1e-6) {
    const step = 3.5 * dt;
    aimX = Math.abs(cpu.plan.x - aimX) <= step ? cpu.plan.x : aimX + Math.sign(cpu.plan.x - aimX) * step;
    cpu.t = 0.35;
    return;
  }
  if (cpu.t > 0.75) drop(true);
}

// ---------- 画面表示 ----------
function renderUI() {
  $('turns').textContent = turnCount;
  $('height').textContent = towerTop.toFixed(1);
  const best = Math.max(loadBest(), state === 'over' ? 0 : maxHeight);
  $('best').textContent = best > 0 ? `${best.toFixed(1)} m` : '―';

  const myTurn = state === 'aim' && turn === 0;
  $('hand').innerHTML = '';
  hands[0].forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'glyph' + (myTurn && i === sel ? ' on' : '');
    b.textContent = s.ch;
    b.disabled = !myTurn;
    b.addEventListener('click', () => selectCard(i));
    $('hand').append(b);
  });
  for (const id of ['left', 'right', 'rot-l', 'rot-r', 'drop']) $(id).disabled = !myTurn;

  $('cpu-hand').innerHTML = hands[1].map((s, i) =>
    `<span class="glyph${turn === 1 && cpu?.plan?.h === i && state === 'aim' ? ' on' : ''}">${s.ch}</span>`).join('');

  const banner = $('banner');
  banner.className = turn === 1 ? 'cpu' : '';
  if (state === 'title' || state === 'over') banner.textContent = '';
  else if (state === 'drop') banner.textContent = '……';
  else banner.textContent = turn === 0 ? 'あなたの番' : (cpu?.plan ? 'CPU の番' : 'CPU 考え中…');
}

function selectCard(i) {
  if (state !== 'aim' || turn !== 0) return;
  sel = i;
  setHover(hands[0][i]);
  renderUI();
}
function move(dx) {
  if (state !== 'aim' || turn !== 0) return;
  aimX = Math.max(-AIM_RANGE, Math.min(AIM_RANGE, Math.round((aimX + dx) / COL) * COL));
}
function rotate(d) {
  if (state !== 'aim' || turn !== 0) return;
  aimR = (aimR + d + 8) % 8;
}

// ---------- 操作 ----------
addEventListener('keydown', e => {
  if (state === 'title' || state === 'over') {
    if ((e.key === 'Enter' || e.key === ' ') && !$('start').disabled) { e.preventDefault(); newGame(); }
    return;
  }
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a') move(-0.1);
  else if (k === 'ArrowRight' || k === 'd') move(0.1);
  else if (k === 'ArrowUp' || k === 'w' || k === 'x') rotate(-1);
  else if (k === 'z' || k === 'q') rotate(1);
  else if (k === 'e') rotate(-1);
  else if ((k === ' ' || k === 'ArrowDown' || k === 'Enter') && !e.repeat) drop();
  else if (k >= '1' && k <= String(HAND_SIZE)) selectCard(+k - 1);
  else return;
  e.preventDefault();
});

// ◀ ▶ は押しっぱなしで動き続ける
for (const [id, dir] of [['left', -1], ['right', 1]]) {
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  $(id).addEventListener('pointerdown', e => {
    e.preventDefault();
    move(dir * 0.1);
    stop();
    timer = setInterval(() => move(dir * 0.05), 30);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $(id).addEventListener(ev, stop);
}
$('rot-l').addEventListener('click', () => rotate(1));
$('rot-r').addEventListener('click', () => rotate(-1));
$('drop').addEventListener('click', () => drop());

// 画面をドラッグすると左右に動く（指が駒に重ならないよう、相対的に動かす）
let dragX = null, dragAim = 0;
canvas.addEventListener('pointerdown', e => {
  dragX = e.clientX; dragAim = aimX;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (dragX === null || state !== 'aim' || turn !== 0) return;
  aimX = dragAim;
  move((e.clientX - dragX) * viewW / innerWidth);
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { dragX = null; });

for (const b of document.querySelectorAll('#levels button')) {
  b.addEventListener('click', () => {
    level = b.dataset.level;
    try { localStorage.setItem(LEVEL_KEY, level); } catch { /* 保存できなくてもよい */ }
    renderLevels();
  });
}
function renderLevels() {
  for (const b of document.querySelectorAll('#levels button')) b.classList.toggle('on', b.dataset.level === level);
}
renderLevels();
$('start').addEventListener('click', newGame);
$('retry').addEventListener('click', newGame);
$('to-title').addEventListener('click', () => { state = 'title'; $('result').hidden = true; $('title').hidden = false; renderUI(); });

// ---------- ループ ----------
let last = performance.now(), acc = 0, previewTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (world) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 4) { physicsStep(); acc -= DT; }
    if (n >= 4) acc = 0;  // 重くて追いつかないときは時間を捨てる
  }
  if (state === 'aim' && turn === 1 && cpu) cpuThink(dt);
  if (state === 'over' && $('result').hidden) {
    overTime += dt;
    if (overTime > 1.5) showResult();
  }

  // 操作中の駒：目標の位置・角度へなめらかに寄せる
  if (hoverShape) {
    const k = 1 - Math.exp(-dt * 18);
    dispX += (aimX - dispX) * k;
    let da = aimR * ROT_STEP - dispA;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    dispA += da * k;
    dispY += (hoverY(hoverShape, aimR * ROT_STEP, towerTop) - dispY) * k;
    hover.position.set(dispX, dispY, 0);
    hover.rotation.z = dispA;
  }
  previewTimer -= dt;
  if (previewTimer <= 0) { topCache = null; previewTimer = 0.25; } // 塔がわずかに動いても予想を合わせる
  updatePreview();

  for (const p of pieces) {
    const t = p.body.translation();
    p.mesh.position.set(t.x, t.y, 0);
    p.mesh.rotation.z = p.body.rotation();
  }
  const ease = 1 - Math.exp(-dt * 3);
  zoom += (zoomTarget() - zoom) * ease;
  applyView();
  camY += (cameraTarget() - camY) * ease;
  camera.position.set(0, camY + 2.5, 30); // 少し上から見下ろして厚みを見せる
  camera.lookAt(0, camY, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
camY = cameraTarget();
requestAnimationFrame(frame);

// 動作確認用：今の状態を返す
window.towerState = () => ({ state, turn, turnCount, towerTop, maxHeight, loser, pieces: pieces.length, hands: hands.map(h => h.map(s => s.ch).join('')) });

// ---------- フォント読み込み ----------
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf);
  try { // 手札の表示も同じフォントにする（形が同じに見えるように）
    const face = new FontFace('MojiTower', buf.slice(0));
    document.fonts.add(await face.load());
  } catch { /* 表示用なので失敗してもよい */ }
  msg('');
  $('start').disabled = false;
  $('start').textContent = 'スタート';
  renderUI();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
