import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import { makeShape, createShot, stepShot, shotDistance, disposeShot, simulateShot, DEPTH, DT, GROUND_LEN, POWER_MAX, ANGLE_MIN, ANGLE_MAX } from './fly.js';

const RECORD_KEY = 'moji_tobashi.records'; // { 文字: [{ d: 距離, p: パワー, a: 角度 }, ...] } 遠い順に上位10件
const TOP_MAX = 10;
const POWER_PERIOD = 1.3;  // パワーゲージが 0→100→0 と往復する秒数
const ANGLE_PERIOD = 1.8;  // 角度ゲージの往復の秒数
const TICK = 10;           // 地面の目盛りの間隔（m）

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f8);
scene.fog = new THREE.Fog(0xbfe3f8, 60, 160);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa88, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-5, 12, 10);
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 地面（上面が y = 0）
const ground = new THREE.Mesh(new THREE.BoxGeometry(GROUND_LEN + 40, 2, 8),
  new THREE.MeshStandardMaterial({ color: 0x8bc34a, roughness: 0.95 }));
ground.position.set(GROUND_LEN / 2, -1, 0);
scene.add(ground);
const soil = new THREE.Mesh(new THREE.BoxGeometry(GROUND_LEN + 40, 6, 0.1),
  new THREE.MeshStandardMaterial({ color: 0xa1784f, roughness: 1 }));
soil.position.set(GROUND_LEN / 2, -3.2, 4.05);
scene.add(soil);

// 発射台（見た目だけ）とスタート線
const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const startLine = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0xe53935 }));
startLine.position.set(0, 0.01, 0);
scene.add(startLine);
const pad = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x607d8b }));
pad.position.set(-0.6, 0.03, 0);
scene.add(pad);

// 目盛りの文字（"10m" など）をテクスチャにする
function labelTexture(text, color, bg, w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(8, 8, w - 16, 80, 24); ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 56px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 50, w - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function labelSprite(text, color = '#123', bg = 'rgba(255,255,255,.85)', w = 256) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text, color, bg, w), depthWrite: false }));
  s.scale.set(1.6 * w / 256, 0.6, 1);
  return s;
}

// 目盛り・雲はカメラの近くだけ作る（3000m ぶんを最初に全部作ると重い）
const ticks = new Map();
const tickGeo = new THREE.BoxGeometry(0.1, 0.03, 8);
const minorGeo = new THREE.BoxGeometry(0.05, 0.025, 8);
const minorMat = new THREE.MeshStandardMaterial({ color: 0xdcedc8 });
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
const cloudGeo = new THREE.SphereGeometry(1, 12, 8);
function rand(i, k) { // 区画ごとに決まった乱数（雲の配置用）
  let h = (i * 374761393 + k * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function ensureTicks(x) {
  const from = Math.max(0, Math.floor((x - 60) / TICK)), to = Math.ceil((x + 90) / TICK);
  for (let i = from; i <= to; i++) {
    if (ticks.has(i) || i * TICK > GROUND_LEN) continue;
    const g = new THREE.Group();
    g.position.x = i * TICK;
    if (i > 0) g.add(new THREE.Mesh(tickGeo, lineMat)); // 0m はスタート線
    const label = labelSprite(`${i * TICK}m`);
    label.position.set(0, 0.4, 3.2);
    g.add(label);
    const minor = new THREE.Mesh(minorGeo, minorMat); // 5m ごとの細い線
    minor.position.x = TICK / 2;
    g.add(minor);
    for (let k = 0; k < 2; k++) {
      if (rand(i, k) < 0.45) continue;
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const puff = new THREE.Mesh(cloudGeo, cloudMat);
        const r = 1.2 + rand(i, k * 10 + j + 3) * 1.4;
        puff.scale.set(r * 1.3, r, r);
        puff.position.set(j * 1.6 - 2.4, rand(i, k * 10 + j + 7) * 0.8, 0);
        cloud.add(puff);
      }
      cloud.position.set(rand(i, k + 20) * TICK, 7 + rand(i, k + 30) * 16, -30 - rand(i, k + 40) * 15);
      g.add(cloud);
    }
    scene.add(g);
    ticks.set(i, g);
  }
}

// 狙いの矢印（発射前の角度とパワーを表示）
const arrow = new THREE.Group();
const arrowMat = new THREE.MeshStandardMaterial({ color: 0xe53935, transparent: true, opacity: 0.85 });
const shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 0.12), arrowMat);
const head = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 12), arrowMat);
head.rotation.z = -Math.PI / 2;
arrow.add(shaft, head);
scene.add(arrow);
function setArrow(power, angle, y) {
  const len = 1 + 3 * power / POWER_MAX;
  shaft.scale.x = len;
  shaft.position.x = len / 2;
  head.position.x = len + 0.2;
  arrow.position.set(0, y, 0.6);
  arrow.rotation.z = angle * Math.PI / 180;
}

// 飛んだ跡（点線）
const TRAIL_MAX = 4000;
const trailPos = new Float32Array(TRAIL_MAX * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.3, gapSize: 0.25 }));
trail.frustumCulled = false;
scene.add(trail);
let trailN = 0;
function addTrail(x, y) {
  if (trailN >= TRAIL_MAX) return;
  trailPos.set([x, y, 0.3], trailN * 3);
  trailN++;
  trailGeo.setDrawRange(0, trailN);
  trailGeo.attributes.position.needsUpdate = true;
  trail.computeLineDistances();
}
function clearTrail() { trailN = 0; trailGeo.setDrawRange(0, 0); }

// ベストの旗。この字のベスト（オレンジ）と全体のベスト（紫）を色と高さを変えて立てる
const CH_COLOR = '#ff9800', ALL_COLOR = '#8e44ad';
function makeFlag(color, text, height, z, w) {
  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, height), lineMat);
  pole.position.y = height / 2;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
  cloth.position.set(0.45, height - 0.3, 0);
  const label = labelSprite(text, '#fff', color, w);
  label.scale.multiplyScalar(0.75);
  label.position.set(0, height + 0.45, 0);
  flag.add(pole, cloth, label);
  flag.position.z = z;
  flag.visible = false;
  flag.userData = { label, color, w, text };
  scene.add(flag);
  return flag;
}
const bestFlag = makeFlag(CH_COLOR, 'この字のベスト', 2.4, -2.2, 384);
const allFlag = makeFlag(ALL_COLOR, '全体ベスト', 3.6, -3.2, 384); // 同じ位置でも重ならないよう奥に高く
function setFlag(flag, x, text) {
  flag.visible = x != null;
  if (x == null) return;
  flag.position.x = x;
  const u = flag.userData;
  if (u.text !== text) {
    u.label.material.map.dispose();
    u.label.material.map = labelTexture(text, '#fff', u.color, u.w);
    u.text = text;
  }
}

// 地面に落ちる影（高さで薄くなる）
const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

await RAPIER.init();

// ---------- 記録（この端末のブラウザだけに保存） ----------
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORD_KEY)) || {}; } catch { return {}; }
}
// 全体のベスト（すべての文字の中でいちばん遠い記録） { ch, d } または null
function overallBest(rec = loadRecords()) {
  let best = null;
  for (const [ch, l] of Object.entries(rec)) if (l.length && (!best || l[0].d > best.d)) best = { ch, d: l[0].d };
  return best;
}
// 記録を足して、上位10件に入った順位（入らなければ 0）と更新前のベスト（この字・全体）を返す
function saveRecord(ch, d, p, a) {
  const rec = loadRecords();
  const prevAll = overallBest(rec);
  const list = rec[ch] || [];
  const prev = list.length ? list[0].d : null;
  const entry = { d, p, a };
  list.push(entry);
  list.sort((x, y) => y.d - x.d);
  rec[ch] = list.slice(0, TOP_MAX);
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(rec)); } catch { /* 保存できなくても遊べる */ }
  return { rank: rec[ch].indexOf(entry) + 1, prev, prevAll };
}
const fmt = d => `${d.toFixed(2)} m`;

function renderRecords(highlight = null) {
  const ch = currentChar();
  const rec = loadRecords();
  const list = rec[ch] || [];
  const top = overallBest(rec);
  $('best').textContent = list.length ? fmt(list[0].d) : '―';
  $('best-all').textContent = top ? fmt(top.d) : '―';
  $('best-all-ch').textContent = top ? `（${top.ch}）` : '';
  $('top').innerHTML = list.length
    ? list.map((e, i) => `<li class="${i === 0 ? 'ch-best ' : ''}${highlight && e.d === highlight.d && e.p === highlight.p && e.a === highlight.a ? 'me' : ''}"><span>${i + 1}.</span><em>${fmt(e.d)}</em><i>パワー ${e.p}%・角度 ${e.a}°</i></li>`).join('')
    : '<li class="none">まだ記録がありません</li>';
  const all = Object.entries(rec).filter(([, l]) => l.length).sort((a, b) => b[1][0].d - a[1][0].d);
  $('all').innerHTML = all.length
    ? all.map(([c, l], i) => `<li class="${i === 0 ? 'all-best ' : ''}${c === ch ? 'me' : ''}"><span>${i + 1}.</span><b>${esc(c)}</b><i>${l.length} 回</i><em>${fmt(l[0].d)}</em></li>`).join('')
    : '<li class="none">まだ記録がありません</li>';
  setFlag(bestFlag, list.length ? list[0].d : null, `「${ch}」のベスト`);
  setFlag(allFlag, top ? top.d : null, `全体ベスト「${top?.ch ?? ''}」`);
}
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// ---------- 文字 ----------
let font = null;
const shapeCache = new Map();
function shapeOf(ch) {
  if (!shapeCache.has(ch)) shapeCache.set(ch, makeShape(font, ch));
  return shapeCache.get(ch);
}
function currentChar() {
  return Array.from($('char').value.trim())[0] || '';
}
function hashColor(ch) {
  let h = 0;
  for (const c of ch) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.7, 0.55);
}

function bar(label, value, text) {
  const w = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="stat"><span>${label}</span><i><b style="width:${w}%"></b></i><em>${text}</em></div>`;
}
function renderStats(shape) {
  const s = shape.stats;
  $('stats').innerHTML =
    bar('重さ', s.mass / 0.6, `${s.mass.toFixed(2)} kg`) +
    bar('初速', (s.boost - 0.4) / 0.9, `${(s.boost * 100).toFixed(0)}%`) +
    bar('丸さ', (s.roundness - 0.75) / 0.25, `${(s.roundness * 100).toFixed(0)}%`) +
    bar('回りにくさ', (s.spin - 0.5) / 0.5, `${(s.spin * 100).toFixed(0)}%`);
}

// ---------- 進行 ----------
let state = 'loading';   // loading | power | angle | flying | result
let shape = null;        // 今の文字の形
let mesh = null;
let shot = null;
let power = 0, angle = 0;
let phase0 = 0;          // ゲージが動き始めた時刻
let acc = 0;
const camTarget = new THREE.Vector3(3, 2, 0);
let camDist = 14;

function setMesh(s) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  if (!s) return;
  mesh = buildMesh(s.polys, DEPTH, hashColor(s.ch));
  scene.add(mesh);
}

// 文字を発射台に置いて、パワーのゲージを動かし始める
function ready() {
  if (!font) return;
  const ch = currentChar();
  if (!ch) return;
  if (shot) { disposeShot(shot); shot = null; }
  for (const b of document.querySelectorAll('.presets button')) b.classList.toggle('on', b.dataset.c === ch);
  shape = shapeOf(ch);
  renderRecords();
  if (!shape) {
    setMesh(null);
    $('stats').innerHTML = '';
    $('gauge').hidden = true;
    msg(`「${ch}」は形が取れませんでした`);
    state = 'loading';
    return;
  }
  msg('');
  setMesh(shape);
  mesh.position.set(0, shape.size.y / 2 + 0.02, 0);
  mesh.rotation.set(0, 0, 0);
  renderStats(shape);
  clearTrail();
  document.body.classList.remove('flying');
  $('result').hidden = true;
  $('hud').hidden = true;
  $('gauge').hidden = false;
  $('power-meter').className = 'meter';
  $('angle-meter').className = 'meter wait';
  $('angle-fill').style.width = '0%';
  $('angle-val').textContent = '―';
  $('tap').textContent = 'タップでパワーを決める';
  arrow.visible = true;
  state = 'power';
  phase0 = performance.now();
}

// 0→1→0 と往復する値（t 秒、往復 period 秒）
function pingpong(t, period) {
  const u = (t / period) % 1;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

function updateGauge(now) {
  const t = (now - phase0) / 1000;
  if (state === 'power') {
    power = Math.round(pingpong(t, POWER_PERIOD) * POWER_MAX);
    angle = Math.round((ANGLE_MIN + ANGLE_MAX) / 2);
  } else if (state === 'angle') {
    angle = ANGLE_MIN + Math.round(pingpong(t, ANGLE_PERIOD) * (ANGLE_MAX - ANGLE_MIN));
  } else return;
  $('power-fill').style.width = `${power / POWER_MAX * 100}%`;
  $('power-val').textContent = `${power}%`;
  if (state === 'angle') {
    $('angle-fill').style.width = `${(angle - ANGLE_MIN) / (ANGLE_MAX - ANGLE_MIN) * 100}%`;
    $('angle-val').textContent = `${angle}°`;
  }
  setArrow(power, angle, shape.size.y / 2 + 0.02);
}

// タップ：1回目でパワー、2回目で角度を決めて発射
function tap() {
  // 決まる値は画面に表示中の値（タップした瞬間に再計算すると、表示とずれることがある）
  if (state === 'power') {
    state = 'angle';
    phase0 = performance.now();
    $('power-meter').className = 'meter fixed';
    $('angle-meter').className = 'meter';
    $('tap').textContent = 'タップで角度を決めて発射！';
  } else if (state === 'angle') {
    $('angle-meter').className = 'meter fixed';
    fire(power, angle);
  }
}

function fire(p, a) {
  if (!shape) return;
  if (shot) disposeShot(shot);
  power = p; angle = a;
  shot = createShot(RAPIER, shape, p, a);
  state = 'flying';
  acc = 0;
  arrow.visible = false;
  clearTrail();
  addTrail(0, shape.size.y / 2);
  $('gauge').hidden = true;
  $('hud').hidden = false;
  $('hud-sub').textContent = `パワー ${p}%・角度 ${a}°`;
  document.body.classList.add('flying');
}

function finish() {
  const d = shotDistance(shot);
  const ch = shape.ch;
  const { rank, prev, prevAll } = saveRecord(ch, d, power, angle);
  const isBest = prev == null || d > prev;
  const isAllBest = prevAll == null || d > prevAll.d;
  state = 'result';
  document.body.classList.remove('flying');
  $('hud').hidden = true;
  $('result').hidden = false;
  $('result-ch').textContent = `「${ch}」は`;
  $('result-title').textContent = `${d.toFixed(2)}m！`;
  const sub = $('result-sub');
  sub.className = isBest ? 'new' : '';
  sub.textContent = isBest
    ? (prev == null ? '初記録！' : `自己ベスト更新！（前回 ${fmt(prev)}）`)
    : (rank ? `この字の ${rank} 位（自己ベスト ${fmt(prev)}）` : `自己ベスト ${fmt(prev)}`);
  const allSub = $('result-all');
  allSub.className = isAllBest ? 'new' : '';
  allSub.textContent = isAllBest
    ? (prevAll == null ? '全体ベスト！' : `全体ベスト更新！（前回 ${fmt(prevAll.d)}「${prevAll.ch}」）`)
    : `全体ベスト ${fmt(prevAll.d)}「${prevAll.ch}」まで あと ${(prevAll.d - d).toFixed(2)} m`;
  $('result-info').textContent = `パワー ${power}%・角度 ${angle}°・最高 ${shot.maxHeight.toFixed(1)}m・${shot.elapsed.toFixed(1)} 秒`;
  renderRecords({ d, p: power, a: angle });
}

// ---------- 入力 ----------
// キャンバスのどこをタップしても決められる（パネルやボタンの上は除く）
canvas.addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
$('tap').addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
$('tap').addEventListener('click', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.target === $('char')) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state === 'result') ready();
    else tap();
  }
});
$('retry').addEventListener('click', ready);
$('change').addEventListener('click', () => { ready(); $('char').focus(); $('char').select(); });
$('char').addEventListener('input', () => { if (currentChar() && state !== 'flying') ready(); });
for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => { if (state === 'flying') return; $('char').value = b.dataset.c; ready(); });
}
$('top-toggle').addEventListener('click', () => {
  const t = $('top');
  t.hidden = !t.hidden;
  $('top-toggle').textContent = t.hidden ? 'この字の上位10件 ▼' : 'この字の上位10件 ▲';
});
$('all-toggle').addEventListener('click', () => {
  const b = $('all-box');
  b.hidden = !b.hidden;
  $('all-toggle').textContent = b.hidden ? '文字ごとの自己ベスト ▼' : '文字ごとの自己ベスト ▲';
});
$('reset').addEventListener('click', () => {
  if (state === 'flying') return;
  if (!confirm('この端末の記録をすべて消します。元に戻せません。よろしいですか？')) return;
  try { localStorage.removeItem(RECORD_KEY); } catch { /* 消せなくても続行 */ }
  renderRecords();
});

// ---------- ループ ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  updateGauge(now);

  if (state === 'flying') {
    acc += dt;
    while (acc >= DT && !shot.done) {
      stepShot(shot);
      acc -= DT;
      if (shot.steps % 3 === 0) { const t = shot.body.translation(); addTrail(t.x, t.y); }
    }
    $('dist').innerHTML = `${shot.distance.toFixed(1)}<small>m</small>`;
    if (shot.done) finish();
  }

  // 文字の位置とカメラ
  let fx = 0, fy = shape ? shape.size.y / 2 : 1, h = 0;
  if (shot && mesh) {
    const t = shot.body.translation(), q = shot.body.rotation();
    mesh.position.set(t.x, t.y, 0);
    mesh.quaternion.set(q.x, q.y, q.z, q.w);
    fx = t.x; fy = t.y; h = Math.max(0, t.y);
  }
  shadow.visible = !!mesh;
  if (mesh) {
    const r = shape.size.x / 2;
    shadow.position.set(fx, 0.015, 0);
    shadow.scale.setScalar(Math.max(0.2, r * (1 - Math.min(0.8, h / 20))));
    shadow.material.opacity = 0.25 * (1 - Math.min(0.8, h / 20));
  }
  // 発射前は発射台と少し先を、飛んでいる間は文字を追う。高く上がったら引いて地面も入れる
  const aiming = state === 'power' || state === 'angle';
  const narrow = camera.aspect < 1; // 縦長画面は横が狭いので、文字を中央寄りに映す
  const tx = aiming ? (narrow ? 1.5 : 4) : fx + (narrow ? 0.5 : 2), ty = aiming ? 2.2 : Math.max(2.2, fy * 0.8 + 0.8);
  const wantDist = (narrow ? 1.8 : 1) * (aiming ? 13 : 14 + h * 1.1);
  // 追いかけの強さは秒あたりで決める（フレームレートが低い端末でも置いていかれないように）
  const follow = 1 - Math.exp(-dt * (state === 'flying' ? 9 : 5));
  camTarget.lerp(new THREE.Vector3(tx, ty, 0), follow);
  camDist += (wantDist - camDist) * (1 - Math.exp(-dt * 3));
  camera.position.set(camTarget.x - 0.5, camTarget.y + 0.5 + camDist * 0.06, camDist); // ほぼ真横から少し見下ろす
  camera.lookAt(camTarget);
  ensureTicks(camTarget.x);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 調整・確認用：描画せずに1回飛ばして距離を返す（コンソールで simulate('〇', 100, 45) ）。記録には残さない
window.simulate = (ch, p, a) => {
  const s = shapeOf(ch);
  return s ? { ch, power: p, angle: a, ...simulateShot(RAPIER, s, p, a) } : null;
};
// 確認用：ゲージを使わずに指定のパワー・角度で今の文字を飛ばす（記録には残る）
window.launchWith = (p, a) => {
  if (state !== 'power' && state !== 'angle' && state !== 'result') return false;
  if (state === 'result') ready();
  fire(Math.max(0, Math.min(POWER_MAX, Math.round(p))), Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, Math.round(a))));
  return true;
};
window.gameState = () => ({ state, ch: shape?.ch, distance: shot ? shotDistance(shot) : null, power, angle });

// ---------- フォント読み込み ----------
renderRecords();
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  msg('');
  ready();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
