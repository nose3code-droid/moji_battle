import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import {
  komaShape, shapeStats, createArena, freeArena, startPos, addTop, launchTop, stepArena, spinning, rpm,
  bowlHeight, STADIUM_R, BOWL_H, OMEGA_MAX, DT,
} from './koma.js';

const WINS_KEY = 'moji_koma.wins';     // 文字ごとの戦績 { ch: [勝, 負] }
const CPU_KEY = 'moji_koma.cpu';
const CPU_POOL = Array.from('〇米井口鬱龍田永木あ@S水火風日月花');
const DEPTH = 0.22;                    // コマの厚み（m）
const LIFT = 0.2;                      // 軸の長さ（すり鉢の面からコマの底まで）
const SLOT_COLORS = [0xe8473c, 0x3d8bfd, 0x2fbf71, 0xf5a623]; // 先頭がプレイヤー

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2233);
scene.fog = new THREE.Fog(0x1b2233, 22, 40); // 距離はカメラに合わせて毎フレーム決める
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(-4, 12, 6);
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// すり鉢スタジアム（中心へ下がる面を回転体で作る）。物理は koma.js 側、ここは見た目だけ
function buildStadium() {
  const lathe = (pts, color, opts = {}) => {
    const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 96);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, ...opts }));
    scene.add(mesh);
    return mesh;
  };
  const bowl = (r0, r1) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const r = r0 + (r1 - r0) * i / 24; pts.push([r, bowlHeight(r)]); }
    return pts;
  };
  const DANGER = STADIUM_R - 0.7;
  lathe(bowl(0.001, DANGER), 0xdfe6f0);
  lathe(bowl(DANGER, STADIUM_R), 0xf2a49a);                 // ここから外は場外の危険地帯
  const H = BOWL_H;
  lathe([[STADIUM_R, H], [STADIUM_R + 0.1, H + 0.12], [STADIUM_R + 0.6, H + 0.12], [STADIUM_R + 0.7, H - 0.1], [STADIUM_R + 0.7, -1.2]], 0x34405a, { roughness: 0.4, metalness: 0.3 });
  // 目印の輪と中心のマーク
  for (const r of [1.4, 2.8, 4.1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 96), new THREE.MeshBasicMaterial({ color: 0x9fb1cc }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = bowlHeight(r) + 0.01;
    scene.add(ring);
  }
  const center = new THREE.Mesh(new THREE.CircleGeometry(0.35, 32), new THREE.MeshBasicMaterial({ color: 0xe8473c }));
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.01;
  scene.add(center);
  // 台
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x252e44, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  scene.add(floor);
}
buildStadium();

// 火花（衝突の演出）。点を使い回す
const SPARK_N = 400;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARK_N * 3), sparkCol = new Float32Array(SPARK_N * 3);
const sparks = Array.from({ length: SPARK_N }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
const sparkPoints = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
  size: 0.13, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
sparkPoints.frustumCulled = false;
scene.add(sparkPoints);
let sparkNext = 0;

function burst(x, y, strength) {
  const n = Math.min(30, 6 + Math.round(strength * 6));
  const h = bowlHeight(Math.hypot(x, y)) + LIFT + DEPTH / 2;
  for (let k = 0; k < n; k++) {
    const i = sparkNext = (sparkNext + 1) % SPARK_N;
    const s = sparks[i], a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 4 * Math.min(2, 0.5 + strength / 2);
    s.life = 0.25 + Math.random() * 0.25;
    s.vx = Math.cos(a) * v; s.vz = Math.sin(a) * v; s.vy = 1 + Math.random() * 3;
    sparkPos.set([x, h, -y], i * 3);
  }
}

function updateSparks(dt) {
  for (let i = 0; i < SPARK_N; i++) {
    const s = sparks[i];
    if (s.life <= 0) { sparkCol.set([0, 0, 0], i * 3); continue; }
    s.life -= dt;
    s.vy -= 9.8 * dt;
    sparkPos[i * 3] += s.vx * dt; sparkPos[i * 3 + 1] += s.vy * dt; sparkPos[i * 3 + 2] += s.vz * dt;
    const b = Math.max(0, s.life * 3);
    sparkCol.set([b, b * 0.8, b * 0.3], i * 3);
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.color.needsUpdate = true;
}

// ---------- 戦績（この端末のブラウザだけに保存） ----------
function loadWins() {
  try { return JSON.parse(localStorage.getItem(WINS_KEY)) || {}; } catch { return {}; }
}
function saveWin(ch, won) {
  const w = loadWins();
  const r = w[ch] || [0, 0];
  r[won ? 0 : 1]++;
  w[ch] = r;
  try { localStorage.setItem(WINS_KEY, JSON.stringify(w)); } catch { /* 保存できなくても遊べる */ }
  return r;
}

// ---------- コマ ----------
let font = null;
let arena = null;
let views = [];           // tops と同じ並び。[0] がプレイヤー
let opponents = [];
let cpuCount = 2;
try { cpuCount = Math.min(3, Math.max(1, +localStorage.getItem(CPU_KEY) || 2)); } catch { /* 既定のまま */ }
let state = 'setup';      // setup | ready | battle | result
let spinDir = -1;         // プレイヤーの回転方向（-1 右回転・+1 左回転）
let speed = 1;            // 観戦中の早送り
let winner = null, winnerRpm = 0, endWait = 0;
const shapeCache = new Map();

function getShape(ch) {
  if (!shapeCache.has(ch)) shapeCache.set(ch, komaShape(font, ch));
  return shapeCache.get(ch);
}

// 見た目：傾き（group）→ 回転（spinner）→ 寝かせた文字
function buildView(shape, slot, label) {
  const isPlayer = slot === 0;
  const color = new THREE.Color(SLOT_COLORS[slot]);
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  group.add(spinner);
  const mesh = buildMesh(shape.polys, DEPTH, color);
  mesh.rotation.x = -Math.PI / 2;     // 文字の面を上に向ける
  mesh.position.y = LIFT + DEPTH / 2;
  spinner.add(mesh);
  // 回転の残像：回っている間だけ文字の外周までうっすら円盤が見える
  const blur = new THREE.Mesh(new THREE.CircleGeometry(shape.radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2;
  blur.position.y = LIFT + 0.01;
  spinner.add(blur);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, LIFT, 12), new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.6, roughness: 0.3 }));
  tip.rotation.x = Math.PI;
  tip.position.y = LIFT / 2;
  spinner.add(tip);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(shape.radius * 0.9, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(group, shadow);
  const tag = document.createElement('div');
  tag.className = 'tag' + (isPlayer ? ' me' : '');
  tag.textContent = label;
  $('tags').appendChild(tag);
  return { group, spinner, mesh, blur, shadow, tag, color, isPlayer, wobble: Math.random() * 6, fly: null, flyY: 0 };
}

function disposeViews() {
  for (const v of views) {
    scene.remove(v.group, v.shadow);
    v.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    v.shadow.geometry.dispose(); v.shadow.material.dispose();
    v.tag.remove();
  }
  views = [];
}

function syncViews(dt) {
  if (!arena) return;
  const up = new THREE.Vector3(0, 1, 0);
  arena.tops.forEach((top, i) => {
    const v = views[i];
    // 物理の (x, y) → three の (x, 高さ, -y)。上から見ると文字が正しく読める向き
    const x = top.x, z = -top.y, r = Math.hypot(x, z);
    const ratio = Math.abs(top.omega) / OMEGA_MAX;
    if (top.state === 'out') {
      // 場外：飛ばされた勢いのまま宙を舞って台の外へ落ちる
      if (!v.fly) v.fly = { x, z, y: bowlHeight(Math.min(r, STADIUM_R)), vx: top.vx, vz: -top.vy, vy: 3, t: 0 };
      const f = v.fly;
      f.t += dt; f.vy -= 9.8 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      v.group.position.set(f.x, f.y, f.z);
      v.group.rotateOnAxis(new THREE.Vector3(1, 0, 0.3).normalize(), 6 * dt);
      v.spinner.rotation.y = top.angle;
      v.shadow.visible = false;
      v.blur.material.opacity = 0;
      v.group.visible = f.y > -8;
      v.tag.hidden = true;
      return;
    }
    const h = bowlHeight(r);
    v.group.position.set(x, h, z);
    v.shadow.position.set(x, h + 0.005, z);
    v.shadow.visible = true;
    v.shadow.quaternion.setFromUnitVectors(up, new THREE.Vector3(-2 * BOWL_H * x / STADIUM_R ** 2, 1, -2 * BOWL_H * z / STADIUM_R ** 2).normalize());
    v.shadow.rotateX(-Math.PI / 2);
    // 傾き：すり鉢の面に沿い、回転が落ちるほど大きく首を振る。ダウンしたら倒れたまま
    const n = new THREE.Vector3(-2 * BOWL_H * x / STADIUM_R ** 2, 1, -2 * BOWL_H * z / STADIUM_R ** 2).normalize();
    let tilt = 0.03;
    if (top.state === 'spin') {
      tilt = 0.03 + 0.4 * Math.max(0, 1 - ratio / 0.35) ** 1.5;
      v.wobble += (4 + 8 * (1 - ratio)) * dt * Math.sign(top.omega || 1);
    } else if (top.state === 'down') tilt = 0.55;
    n.x += Math.cos(v.wobble) * tilt; n.z += Math.sin(v.wobble) * tilt;
    v.group.quaternion.setFromUnitVectors(up, n.normalize());
    if (top.state === 'wait') top.angle += 0.8 * dt * spinDirOf(i); // 発射前はゆっくり回して見せる
    v.spinner.rotation.y = top.angle;
    v.blur.material.opacity = top.state === 'spin' ? 0.12 + 0.3 * ratio : 0;
    v.mesh.material.emissive.setRGB(top.hitFlash * 4, top.hitFlash * 3, 0);
  });
}
const spinDirOf = i => (i === 0 ? spinDir : (i % 2 ? 1 : -1));

function updateTags() {
  const p = new THREE.Vector3();
  views.forEach((v, i) => {
    if (v.tag.hidden || !v.group.visible) return;
    p.copy(v.group.position).add(new THREE.Vector3(0, LIFT + 0.9, 0)).project(camera);
    v.tag.style.left = `${(p.x + 1) / 2 * innerWidth}px`;
    v.tag.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
    v.tag.style.opacity = arena.tops[i].state === 'down' ? 0.5 : 1;
  });
}

// ---------- 性能表示 ----------
function bar(label, value, text) {
  const w = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="stat"><span>${label}</span><i><b style="width:${w}%"></b></i><em>${text}</em></div>`;
}
function typeOf(st) {
  if (st.attack > 0.7 && st.attack >= st.stamina) return '攻撃タイプ';
  if (st.stamina > 0.6) return '持久タイプ';
  if (st.weight > 0.75) return '防御タイプ';
  return 'バランスタイプ';
}
function renderStats(shape) {
  const st = shapeStats(shape);
  const rec = loadWins()[shape.ch];
  $('stats').innerHTML =
    `<div class="stat-head"><b>「${shape.ch}」の性能</b><span>${typeOf(st)}</span></div>` +
    bar('持久力', st.stamina, `約 ${shape.spinTime.toFixed(0)} 秒`) +
    bar('攻撃力', st.attack, `${(shape.spike * 100).toFixed(0)}%`) +
    bar('重さ', st.weight, `${shape.mass.toFixed(2)} kg`) +
    `<div class="note">${rec ? `この文字の戦績 ${rec[0]}勝 ${rec[1]}敗` : '丸い字は長く回り、とがった字は当たりが強い'}</div>`;
}

function renderOpponents() {
  for (const b of document.querySelectorAll('.cpu button')) b.classList.toggle('on', +b.dataset.n === cpuCount);
  $('opponents').innerHTML = opponents.map(c => `<span class="chip">${c}</span>`).join('');
}
function shuffleOpponents() {
  const player = currentChar();
  const pool = CPU_POOL.filter(c => c !== player);
  opponents = [];
  while (opponents.length < cpuCount && pool.length) opponents.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  renderOpponents();
}

// ---------- 対戦の進行 ----------
function currentChar() {
  return Array.from($('char').value.trim())[0] || '';
}

// コマを発射位置に並べ直す（発射前の状態）
function prepare() {
  const ch = currentChar();
  if (!ch || !font) return false;
  const shape = getShape(ch);
  if (!shape) { msg(`「${ch}」は形が取れませんでした`); return false; }
  msg('');
  disposeViews();
  if (arena) freeArena(arena);
  arena = createArena(RAPIER);
  const chars = [ch, ...opponents];
  chars.forEach((c, i) => {
    const s = getShape(c);
    const p = startPos(i, chars.length);
    const top = addTop(arena, s, p.x, p.y);
    top.angle = Math.random() * Math.PI * 2;
    views.push(buildView(s, i, i === 0 ? `あなた「${c}」` : `CPU「${c}」`));
  });
  winner = null; endWait = 0; speed = 1;
  renderOpponents();
  renderStats(shape);
  syncViews(0);
  return true;
}

function showSetup() {
  state = 'setup';
  $('panel').hidden = false;
  $('launcher').hidden = true;
  $('hud').hidden = true;
  $('spectate').hidden = true;
  $('result').hidden = true;
  $('count').textContent = '';
  prepare();
}

function showReady() {
  if (!prepare()) return;
  state = 'ready';
  $('panel').hidden = true;
  $('result').hidden = true;
  $('hud').hidden = true;
  $('spectate').hidden = true;
  $('launcher').hidden = false;
  $('count').textContent = '';
  setGauge(0);
  renderDir();
}

function renderDir() {
  for (const b of document.querySelectorAll('.dir button')) b.classList.toggle('on', +b.dataset.dir === spinDir);
}

// 発射：プレイヤーの強さと向き、CPU は少しばらつかせる
function shoot(power, dir) {
  if (state !== 'ready') return;
  spinDir = dir;
  renderDir();
  arena.tops.forEach((top, i) => {
    if (i === 0) launchTop(arena, top, power, dir);
    else launchTop(arena, top, 0.65 + Math.random() * 0.35, Math.random() < 0.5 ? 1 : -1);
  });
  state = 'battle';
  $('launcher').hidden = true;
  $('hud').hidden = false;
  $('fast').classList.remove('on');
  flash(`ゴー・シュート！<br><small style="font-size:40%">パワー ${Math.round(power * 100)}%・${dir < 0 ? '右回転' : '左回転'}</small>`, 1200);
  renderHud();
}

let flashTimer = 0;
function flash(html, ms) {
  $('count').innerHTML = html;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $('count').innerHTML = ''; }, ms);
}

function renderHud() {
  $('clock').textContent = `${arena.time.toFixed(1)} 秒`;
  $('spins').innerHTML = arena.tops.map((top, i) => {
    const v = views[i];
    const dead = top.state === 'out' || top.state === 'down';
    const text = top.index === winner ? '優勝' : top.state === 'out' ? '場外' : top.state === 'down' ? 'ダウン' : `${Math.round(rpm(top))} rpm`;
    const w = dead ? 0 : Math.abs(top.omega) / OMEGA_MAX * 100;
    return `<div class="spin${v.isPlayer ? ' me' : ''}${dead ? ' dead' : ''}"><b>${top.shape.ch}</b><i><u style="width:${w.toFixed(1)}%;background:#${v.color.getHexString()}"></u></i><em>${text}</em></div>`;
  }).join('');
}

function onEvents(list) {
  for (const e of list) {
    if (e.type === 'hit') {
      const a = arena.tops[e.a], b = arena.tops[e.b];
      // 同じ組の火花は少し間を空ける（触れている間は毎ステップ来るため）
      const key = `${e.a}-${e.b}`;
      if (arena.time - (sparkAt.get(key) ?? -1) > 0.1 && (e.push > 0.05 || Math.random() < 0.05)) {
        sparkAt.set(key, arena.time);
        burst(e.x, e.y, e.push * 4);
        if (e.push > 0.15 && (a.index === 0 || b.index === 0)) shake = Math.min(0.25, shake + e.push * 0.3);
      }
    } else if (e.type === 'out' || e.type === 'down') {
      const top = arena.tops[e.top];
      const word = e.type === 'out' ? '場外！' : 'ダウン！';
      flash(`<span style="font-size:55%">「${top.shape.ch}」${word}</span>`, 900);
      if (e.top === 0) $('spectate').hidden = spinning(arena).length <= 1;
    }
  }
}
const sparkAt = new Map();
let shake = 0;

function checkEnd(dt) {
  const alive = spinning(arena);
  if (winner === null && alive.length <= 1) {
    winner = alive.length ? alive[0].index : -1;   // -1 は引き分け（最後の2つが同時に止まった）
    winnerRpm = alive.length ? rpm(alive[0]) : 0;
    if (alive.length) flash(`「${alive[0].shape.ch}」の勝ち！`, 1500);
    endWait = 1.5;
  }
  if (winner !== null) {
    endWait -= dt;
    if (endWait <= 0) showResult();
  }
}

function showResult() {
  state = 'result';
  $('spectate').hidden = true;
  $('count').innerHTML = '';
  const tops = arena.tops;
  // 順位：優勝 → 後まで残っていた順（同じステップで脱落したら同順位）
  const order = tops.slice().sort((a, b) => (b.index === winner) - (a.index === winner) || b.endOrder - a.endOrder);
  const rankOf = t => t.index === winner ? 1 : 1 + order.filter(o => o.index === winner || o.endTime > t.endTime + 1e-9).length;
  const p = tops[0];
  const won = winner === 0;
  const title = $('result-title');
  title.textContent = won ? '勝利！' : winner === -1 ? '引き分け' : `${rankOf(p)} 位…`;
  title.className = won ? 'win' : '';
  $('result-sub').textContent = winner >= 0 ? `最後まで回っていたのは「${tops[winner].shape.ch}」` : '最後の2つが同時に止まりました';
  $('standings').innerHTML = order.map(t => {
    const text = t.index === winner ? `優勝（残り ${Math.round(winnerRpm)} rpm）`
      : `${t.state === 'out' ? '場外' : 'ダウン'}（${t.endTime.toFixed(1)} 秒）`;
    return `<li class="${t.index === 0 ? 'me' : ''}"><span>${rankOf(t)}</span><b>${t.shape.ch}</b><em>${text}</em></li>`;
  }).join('');
  const rec = saveWin(p.shape.ch, won);
  $('record').textContent = `「${p.shape.ch}」の戦績 ${rec[0]}勝 ${rec[1]}敗`;
  $('result').hidden = false;
}

// ---------- 発射の操作：長押しゲージ ----------
let charging = false, chargeT = 0;
const gaugeValue = t => 1 - Math.abs((t / 0.8) % 2 - 1); // 0→1→0 を往復（1往復 1.6 秒）
function setGauge(v) { $('gauge').firstElementChild.style.width = `${(v * 100).toFixed(1)}%`; }

function startCharge(e) {
  if (state !== 'ready' || charging) return;
  e?.preventDefault();
  charging = true;
  chargeT = 0;
  $('charge').classList.add('hold');
  $('charge').textContent = '離して発射！';
}
function releaseCharge() {
  if (!charging) return;
  charging = false;
  $('charge').classList.remove('hold');
  $('charge').textContent = '長押しでパワーをためる';
  shoot(0.3 + 0.7 * gaugeValue(chargeT), spinDir);
}
$('charge').addEventListener('pointerdown', e => { $('charge').setPointerCapture(e.pointerId); startCharge(e); });
$('charge').addEventListener('pointerup', releaseCharge);
$('charge').addEventListener('pointercancel', releaseCharge);
$('charge').addEventListener('contextmenu', e => e.preventDefault()); // スマホの長押しメニューを出さない
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && state === 'ready') startCharge(e); });
addEventListener('keyup', e => { if (e.code === 'Space') releaseCharge(); });

// ---------- 発射の操作：スワイプ ----------
// 強さは離す直前（約0.15秒）の指の速さで決める。ゆっくり動かしてから弾いても効く
let swipe = null;
canvas.addEventListener('pointerdown', e => {
  if (state !== 'ready') return;
  swipe = { id: e.pointerId, x0: e.clientX, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
});
canvas.addEventListener('pointermove', e => {
  if (!swipe || swipe.id !== e.pointerId) return;
  swipe.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  if (swipe.pts.length > 30) swipe.pts.shift();
});
canvas.addEventListener('pointerup', e => {
  if (!swipe || swipe.id !== e.pointerId) return;
  const now = performance.now(), pts = swipe.pts, x0 = swipe.x0;
  swipe = null;
  let i = pts.length - 1;
  while (i > 0 && now - pts[i - 1].t <= 150) i--;
  if (i === pts.length - 1 && i > 0) i--; // 間が空いていても直前の1点とは比べる
  const from = pts[i];
  const dx = e.clientX - from.x, dy = e.clientY - from.y, dt = Math.max(16, now - from.t);
  const v = Math.hypot(dx, dy) / dt; // px/ms
  if (state !== 'ready' || Math.abs(e.clientX - x0) < 50 || Math.abs(dx) < Math.abs(dy) * 0.5 || v < 0.3) return; // 横向きのスワイプだけ
  shoot(Math.min(1, 0.3 + 0.7 * v / 2.0), dx > 0 ? -1 : 1); // 2px/ms 以上で最大パワー
});
canvas.addEventListener('pointercancel', () => { swipe = null; });

// ---------- ボタン ----------
$('go').addEventListener('click', showReady);
$('retry').addEventListener('click', showReady);
$('change').addEventListener('click', () => { showSetup(); $('char').select(); });
$('back').addEventListener('click', showSetup);
$('shuffle').addEventListener('click', () => { shuffleOpponents(); prepare(); });
$('fast').addEventListener('click', () => {
  speed = speed === 1 ? 4 : 1;
  $('fast').classList.toggle('on', speed > 1);
});
for (const b of document.querySelectorAll('.dir button')) {
  b.addEventListener('click', () => { spinDir = +b.dataset.dir; renderDir(); });
}
for (const b of document.querySelectorAll('.cpu button')) {
  b.addEventListener('click', () => {
    cpuCount = +b.dataset.n;
    try { localStorage.setItem(CPU_KEY, cpuCount); } catch { /* 保存できなくてもよい */ }
    shuffleOpponents();
    prepare();
  });
}
$('char').addEventListener('input', () => { if (currentChar() && state === 'setup') prepare(); });
$('char').addEventListener('keydown', e => { if (e.key === 'Enter') showReady(); });
for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => { $('char').value = b.dataset.c; prepare(); });
}

// ---------- ループ ----------
let acc = 0, last = performance.now();
const camTarget = new THREE.Vector3(0, 0.4, 0);

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state === 'ready' && charging) {
    chargeT += dt;
    setGauge(gaugeValue(chargeT));
  }
  if (arena && (state === 'battle' || state === 'result')) {
    // 結果表示中も勝ったコマは回り続ける
    acc += dt * (state === 'battle' ? speed : 1);
    let n = 0;
    while (acc >= DT && n++ < 200) {
      const ev = stepArena(arena);
      if (state === 'battle') onEvents(ev);
      acc -= DT;
    }
    if (state === 'battle') { renderHud(); checkEnd(dt * speed); }
  } else acc = 0;
  syncViews(dt);
  updateSparks(dt);

  // カメラ：少し斜め上から。画面の縦横どちらでもスタジアム全体が入る距離にする
  const fit = STADIUM_R + 1.2;
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const dist = Math.max(fit / Math.tan(hHalf), fit * 0.9 / Math.tan(vHalf)) * 1.05;
  const elev = THREE.MathUtils.degToRad(52);
  scene.fog.near = dist + 4; scene.fog.far = dist + 25;
  camTarget.z = camera.aspect < 1 ? 1.6 : 0.6; // 縦長画面は下の発射パネルに隠れないよう、スタジアムを上へ寄せる
  shake = Math.max(0, shake - dt);
  const sx = (Math.random() - 0.5) * shake, sz = (Math.random() - 0.5) * shake;
  camera.position.set(camTarget.x + sx, camTarget.y + Math.sin(elev) * dist, camTarget.z + Math.cos(elev) * dist + sz);
  camera.lookAt(camTarget);
  updateTags();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 調整用：描画せずに対戦だけ回して結果を返す（コンソールで simulate(['〇', '米'])）
window.simulate = (chars, powers = chars.map(() => 1), dirs = chars.map((_, i) => (i % 2 ? 1 : -1))) => {
  const a = createArena(RAPIER);
  const tops = chars.map((c, i) => { const p = startPos(i, chars.length); return addTop(a, getShape(c), p.x, p.y); });
  tops.forEach((t, i) => launchTop(a, t, powers[i], dirs[i]));
  while (a.time < 180 && spinning(a).length > 1) stepArena(a);
  const out = tops.map(t => ({ ch: t.shape.ch, state: t.state, time: +t.endTime.toFixed(1), rpm: Math.round(rpm(t)) }));
  freeArena(a);
  return out;
};

// ---------- フォント読み込み ----------
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await RAPIER.init();
  font = opentype.parse(await res.arrayBuffer());
  $('go').disabled = false;
  shuffleOpponents();
  showSetup();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
