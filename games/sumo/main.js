import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import { createBout, stepBout, tap, tilt, createCpu, cpuStep, disposeBout, CPU_LEVELS, DEPTH, RING_R, RING_H, DT } from './bout.js';

const RECORD_KEY = 'moji_sumo.records';   // 文字ごとの戦績 { ch: [勝ち, 負け, 引き分け] }
const LEVEL_KEY = 'moji_sumo.level';
const PRESETS = Array.from('山皿口木イノ鬱あ');
const CPU_POOL = Array.from('山皿口木イノ鬱あ田本円人大土犬水火のめ米〇S@');
const TAP_GAP = 0.05;             // 連打の最短間隔（秒）。これより速い入力は捨てる
const COLORS = [0xd84a3a, 0x2f6fd0]; // 東（あなた）・西（CPU）

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3b2d24);
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4636, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(-2, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 1, far: 20 });
scene.add(sun);

// 土俵：上面の中心を原点にしたグループ。叩くと物理の板と同じように上下・傾く
const ring = new THREE.Group();
{
  const clay = new THREE.MeshStandardMaterial({ color: 0xcfa772, roughness: 0.95 });
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(RING_R + 0.2, RING_R + 0.4, RING_H, 72), clay);
  mound.position.y = -RING_H / 2;
  mound.receiveShadow = true;
  ring.add(mound);
  const straw = new THREE.MeshStandardMaterial({ color: 0xe3cf8f, roughness: 0.8 });
  const tawara = new THREE.Mesh(new THREE.TorusGeometry(RING_R + 0.06, 0.06, 10, 120), straw);
  tawara.rotation.x = Math.PI / 2;
  tawara.position.y = 0.02;
  tawara.castShadow = true;
  ring.add(tawara);
  // 仕切り線
  const line = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.5), line);
    l.position.set(s * 0.45, 0.002, 0.55);
    ring.add(l);
  }
}
scene.add(ring);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6e5644, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -RING_H;
floor.receiveShadow = true;
scene.add(floor);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 土俵全体（左右 ±halfW）が画面に収まる距離。縦長の画面では引きで映す
function cameraDistance() {
  const halfW = camera.aspect < 1 ? RING_R + 0.3 : RING_R + 0.6;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  return Math.max(halfW / tanH, 6.5);
}

// ---------- 効果音（叩いた音） ----------
let audio = null;
function thump(side) {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.frequency.setValueAtTime(side === 0 ? 140 : 110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(side === 0 ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + 0.16);
  } catch { /* 音が出せなくても遊べる */ }
}

// ---------- 戦績（この端末のブラウザだけに保存） ----------
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORD_KEY)) || {}; } catch { return {}; }
}
function saveResult(ch, k) { // k: 0=勝ち 1=負け 2=引き分け
  const rec = loadRecords();
  rec[ch] ??= [0, 0, 0];
  rec[ch][k]++;
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(rec)); } catch { /* 保存できなくても遊べる */ }
}
function renderRecord() {
  const ch = playerChar();
  const r = loadRecords()[ch];
  $('record').textContent = ch && r ? `「${ch}」の戦績 ${r[0]}勝 ${r[1]}敗${r[2] ? ` ${r[2]}分` : ''}` : '';
}

// ---------- 取組 ----------
let font = null;
let bout = null;
let meshes = [];
let cpu = null;
let level = 'normal';
try { if (localStorage.getItem(LEVEL_KEY) in CPU_LEVELS) level = localStorage.getItem(LEVEL_KEY); } catch { /* 既定のまま */ }
let state = 'setup';   // setup | ready | bout | after | result
let callTime = 0;      // 呼び出し（見合って→はっけよい）の残り時間
let afterTime = 0;     // 勝負がついてから結果を出すまでの時間
let pendingTaps = 0;
let lastTap = -1;
let shake = 0;

const firstChar = s => Array.from(s.trim())[0] || '';
const playerChar = () => firstChar($('char').value);
const cpuChar = () => firstChar($('cpu-char').value);

function clearBout() {
  for (const m of meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  meshes = [];
  disposeBout(bout);
  bout = null;
}

// 2人を仕切り線に立たせる（まだ動かさない）
function prepare() {
  const chs = [playerChar(), cpuChar()];
  if (!font || !chs[0] || !chs[1]) return false;
  clearBout();
  const missing = chs.find(c => !font.charToGlyphIndex(c)); // フォントに無い字は豆腐（□）になるので断る
  bout = missing ? null : createBout(RAPIER, font, chs);
  if (!bout) {
    msg(missing ? `「${missing}」はフォントにない文字です` : `「${chs.join('」「')}」は形が取れませんでした`);
    $('go').disabled = true;
    return false;
  }
  msg('');
  $('go').disabled = false;
  meshes = bout.wrestlers.map((w, i) => {
    const m = buildMesh(w.polys, DEPTH, COLORS[i]);
    scene.add(m);
    return m;
  });
  $('name0').textContent = chs[0];
  $('name1').textContent = chs[1];
  $('clock').textContent = '';
  renderStats();
  renderRecord();
  syncMeshes();
  return true;
}

function syncMeshes() {
  if (!bout) return;
  bout.wrestlers.forEach((w, i) => {
    const t = w.body.translation(), q = w.body.rotation();
    meshes[i].position.set(t.x, t.y, 0);
    meshes[i].quaternion.set(q.x, q.y, q.z, q.w);
  });
  ring.position.y = bout.pose.y;
  ring.rotation.z = bout.pose.a;
}

// ---------- 性能表示（東西を並べて比べる） ----------
function renderStats() {
  const [a, b] = bout.wrestlers.map(w => w.stats);
  const row = (label, va, vb, max, fmt) => {
    const w = v => Math.round(Math.max(0.03, Math.min(1, v / max)) * 100);
    return `<div class="stat"><span>${label}</span>` +
      `<i class="east"><em>${fmt(va)}</em><b style="width:${w(va)}%"></b></i>` +
      `<i class="west"><b style="width:${w(vb)}%"></b><em>${fmt(vb)}</em></i></div>`;
  };
  $('stats').innerHTML =
    `<div class="stat head"><span></span><i class="east">${bout.wrestlers[0].ch}</i><i class="west">${bout.wrestlers[1].ch}</i></div>` +
    row('重さ', a.mass, b.mass, 0.14, v => (v * 10).toFixed(2)) +
    row('倒れにくさ', a.stability, b.stability, 55, v => `${v.toFixed(0)}°`);
}

// ---------- 進行 ----------
function setUi() {
  $('panel').hidden = state !== 'setup';
  $('tap').hidden = !(state === 'ready' || state === 'bout');
  $('result').hidden = state !== 'result';
  document.body.classList.toggle('fighting', state === 'ready' || state === 'bout' || state === 'after');
}

function start() {
  if (!prepare()) return;
  cpu = createCpu(level);
  pendingTaps = 0;
  lastTap = -1;
  state = 'ready';
  callTime = 1.6;
  call('見合って…');
  setUi();
}

function call(text, cls = '') {
  const el = $('call');
  el.textContent = text;
  el.className = cls;
  void el.offsetWidth; // アニメーションをやり直す
  el.classList.add('show');
}

function playerTap() {
  if (state !== 'bout') return;
  const now = performance.now() / 1000;
  if (now - lastTap < TAP_GAP) return;
  lastTap = now;
  pendingTaps++;
}

// 叩いた側に「トン」を出す
function popTon(side) {
  const p = new THREE.Vector3((side === 0 ? -1 : 1) * (RING_R - 0.3), -RING_H * 0.6, RING_R * 0.6).project(camera);
  const el = document.createElement('div');
  el.className = `ton ${side === 0 ? 'east' : 'west'}`;
  el.textContent = 'トン';
  el.style.left = `${(p.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${(1 - p.y) / 2 * innerHeight + (Math.random() - 0.5) * 20}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

function onTap(side) {
  thump(side);
  popTon(side);
  shake = Math.min(shake + 0.02, 0.05);
}

function finish() {
  const b = bout, me = b.wrestlers[0], op = b.wrestlers[1];
  const why = { out: c => `「${c}」が土俵の外に出た`, fall: c => `「${c}」の手や頭が土俵についた` };
  let title, sub, k;
  if (b.winner === 0) {
    title = '勝ち！'; k = 0;
    sub = `決まり手：${b.kimarite}\n${why[op.lost](op.ch)}`;
  } else if (b.winner === 1) {
    title = '負け…'; k = 1;
    sub = `決まり手：${b.kimarite}\n${why[me.lost](me.ch)}`;
  } else {
    title = '引き分け'; k = 2;
    sub = b.kimarite === '同体' ? '同体（同時に勝負がつきました）' : '水入り（時間内に決着がつきませんでした）';
  }
  saveResult(me.ch, k);
  $('result-title').textContent = title;
  $('result-title').className = ['win', 'lose', 'draw'][k];
  $('result-sub').textContent = sub + `\n叩いた回数 あなた ${b.taps[0]} ／ CPU ${b.taps[1]}`;
  renderRecord();
  state = 'result';
  setUi();
}

// ---------- 入力 ----------
$('go').addEventListener('click', start);
$('retry').addEventListener('click', start);
$('change').addEventListener('click', () => { state = 'setup'; prepare(); setUi(); });
$('tap').addEventListener('pointerdown', e => { e.preventDefault(); playerTap(); });
canvas.addEventListener('pointerdown', () => playerTap());
addEventListener('keydown', e => {
  if (e.repeat || e.target.tagName === 'INPUT') return;
  if (state === 'bout' && [' ', 'Enter', 'f', 'j'].includes(e.key)) { e.preventDefault(); playerTap(); }
});
for (const id of ['char', 'cpu-char']) {
  $(id).addEventListener('input', () => { if (playerChar() && cpuChar()) prepare(); });
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && !$('go').disabled) start(); });
}

function renderPresets() {
  $('presets0').innerHTML = PRESETS.map(c => `<button data-c="${c}">${c}</button>`).join('');
  $('presets1').innerHTML = PRESETS.map(c => `<button data-c="${c}">${c}</button>`).join('') +
    '<button data-c="?" class="dice" title="おまかせ">🎲</button>';
  for (const [i, id] of [[0, 'char'], [1, 'cpu-char']]) {
    for (const b of $(`presets${i}`).querySelectorAll('button')) {
      b.addEventListener('click', () => {
        let c = b.dataset.c;
        if (c === '?') {
          const pool = CPU_POOL.filter(x => x !== cpuChar());
          c = pool[Math.floor(Math.random() * pool.length)];
        }
        $(id).value = c;
        prepare();
      });
    }
  }
}
function renderLevels() {
  $('levels').innerHTML = Object.entries(CPU_LEVELS).map(([k, v]) =>
    `<button data-level="${k}" class="${k === level ? 'on' : ''}">${v.label}</button>`).join('');
  for (const b of $('levels').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      level = b.dataset.level;
      try { localStorage.setItem(LEVEL_KEY, level); } catch { /* 保存できなくてもよい */ }
      renderLevels();
    });
  }
}
renderPresets();
renderLevels();
setUi();

// ---------- ループ ----------
await RAPIER.init();
let acc = 0, last = performance.now();
const camPos = new THREE.Vector3();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (state === 'ready') {
    const before = callTime;
    callTime -= dt;
    if (before > 0.6 && callTime <= 0.6) call('はっけよい！', 'big');
    if (callTime <= 0) { state = 'bout'; call('のこった！', 'big'); }
  }
  if (bout && (state === 'bout' || state === 'after' || state === 'result')) {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      if (state === 'bout') {
        const before = bout.taps[1];
        cpuStep(cpu, bout, 1);
        if (bout.taps[1] !== before) onTap(1);
        if (pendingTaps > 0) { pendingTaps--; tap(bout, 0); onTap(0); }
      }
      stepBout(bout);
      if (state === 'bout' && bout.done) {
        state = 'after';
        afterTime = 1.4;
        call(bout.winner >= 0 ? '勝負あり！' : bout.kimarite, 'big');
        if (bout.winner >= 0) meshes[1 - bout.winner].material.color.lerp(new THREE.Color(0x888888), 0.6); // 負けた方を灰色に
        setUi();
      }
    }
    if (state === 'bout') $('clock').textContent = bout.elapsed.toFixed(1);
    if (state === 'after') { afterTime -= dt; if (afterTime <= 0) finish(); }
  } else acc = 0;
  syncMeshes();

  // カメラ：土俵の正面やや上から。叩いたら少し揺らす
  shake *= Math.pow(0.02, dt);
  const d = cameraDistance();
  const tall = camera.aspect < 1; // 縦長の画面は上から見下ろして、空いた縦の空間に土俵を大きく映す
  camPos.set((Math.random() - 0.5) * shake, d * (tall ? 0.55 : 0.32) + (Math.random() - 0.5) * shake, d);
  camera.position.copy(camPos);
  camera.lookAt(0, tall ? 0.2 : 0.35, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 調整・テスト用：今の取組の様子を返す
window.sumoState = () => bout && {
  state, elapsed: bout.elapsed, done: bout.done, winner: bout.winner, kimarite: bout.kimarite, taps: bout.taps,
  tilt: bout.wrestlers.map(w => +(tilt(bout, w) * 180 / Math.PI).toFixed(1)),
  x: bout.wrestlers.map(w => +w.body.translation().x.toFixed(2)),
};

// ---------- フォント読み込み ----------
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  prepare();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
