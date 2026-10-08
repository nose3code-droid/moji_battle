// 文字カタパルト：文字をパチンコで撃って、文字で組んだ城を崩し「王」を落とす
import * as THREE from 'three';
import RAPIER from 'rapier2d';
import * as opentype from 'opentype';
import { glyphPolygons, centerPolygons, buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import { STAGES } from './stages.js';

const SHOTS = 5;              // 1ステージで撃てる弾の数
const EM = 1.0;               // 文字 1em の大きさ（m）
const DEPTH = 0.6;            // 見た目の厚み（物理は 2D なので関係ない）
const SHOT_DENSITY = 4.0;     // 弾の質量 = 文字の面積 × 密度（弾は石、城は木のつもりで重さを変える）
const BLOCK_DENSITY = 1.0;
const ANCHOR = new THREE.Vector2(1.6, 2.5); // 弾をつがえる位置
const GRAB_R = 2.2;           // ここまで近くを触れば弾をつかめる
const MAX_PULL = 1.8;         // 引っぱれる長さ（m）
const MIN_PULL = 0.35;        // これより短ければ撃たずに戻す
const V_MAX = 19;             // 基準の重さの弾を目いっぱい引いたときの速さ（m/s）
const M_REF = 1.4;            // 基準の重さ（「王」の形の弾くらい）
const MIN_AREA = 0.03;        // これより小さい字は弾にできない
const GRAVITY = -9.81;
const DT = 1 / 60;
const SETTLE_SPEED = 0.08;    // これより遅ければ止まっているとみなす（m/s, rad/s）
const SETTLE_SEC = 0.6;       // 止まった状態がこれだけ続いたら「落ち着いた」
const NEXT_SHOT_SEC = 6;      // 撃ってからこの秒数たてば、まだ動いていても次の弾を込める
const END_WAIT_SEC = 10;      // 最後の弾のあと、止まらなくてもこの秒数で判定する
const RESULT_DELAY = 1.2;     // 勝敗が決まってから結果を出すまで（崩れるところを見せる）
const PREVIEW_DOTS = 14;      // 軌道の予告（最初の約1秒だけ見せる）
const PREVIEW_STEP = 0.07;
const VIEW = { x0: -1.6, x1: 20.6, y0: -1.3, y1: 7.0 }; // 必ず画面に入れる範囲
const CLEAR_KEY = 'moji_battle.catapult.cleared';        // ステージごとの最高の星の数

// 撃ち出すエネルギーを同じにする → 軽い弾ほど速く、重い弾は遅いが勢い（運動量）が大きい
const speedFactor = m => Math.min(1.9, Math.max(0.6, Math.sqrt(M_REF / m)));

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f7);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-4, 8, 10);
scene.add(sun);
const camCenter = new THREE.Vector2();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  // 上の操作バーに隠れる分を除いた高さに、VIEW の範囲がまるごと入るようにする
  const usable = Math.max(0.3, (h - $('bar').offsetHeight - 16) / h);
  const vw = VIEW.x1 - VIEW.x0, vh = VIEW.y1 - VIEW.y0;
  let halfW = vw / 2, halfH = halfW * h / w;
  if (halfH * 2 * usable < vh) { halfH = vh / 2 / usable; halfW = halfH * w / h; }
  camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  // 縦長の画面で余る高さは、地面の下にも半分ほど回す（城が画面の下端に張りつかないように）
  const extra = w < h ? halfH * 2 * usable - vh : 0;
  camCenter.set((VIEW.x0 + VIEW.x1) / 2, VIEW.y0 + halfH - extra * 0.45);
  camera.position.set(camCenter.x, camCenter.y + 7, 50);  // 少し上から見て文字の厚みを見せる
  camera.lookAt(camCenter.x, camCenter.y, 0);
}
addEventListener('resize', resize);

await RAPIER.init();

// ---------- 文字の形 ----------
let font = null;
const shapeCache = new Map();

// 文字 → { polys: 見た目用の輪郭, tris: 当たり判定用の三角形, size, area }。sx, sy で縦横に伸ばせる
function glyphShape(ch, sx = 1, sy = 1) {
  const key = `${ch}|${sx}|${sy}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let shape = null;
  const polys = glyphPolygons(font, ch, EM);
  if (polys.length) {
    for (const { outer, holes } of polys) for (const q of outer.concat(...holes)) { q.x *= sx; q.y *= sy; }
    const size = centerPolygons(polys);
    const tris = triangles(polys);
    const area = tris.reduce((s, t) => s + Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2, 0);
    if (tris.length) shape = { ch, polys, size, tris, area };
  }
  shapeCache.set(key, shape);
  return shape;
}

// 穴あきの輪郭を三角形に分ける（2D の凸包コライダーにする）
function triangles(polys) {
  const out = [];
  for (const { outer, holes } of polys) {
    const all = outer.concat(...holes);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const a = all[i], b = all[j], c = all[k];
      // 潰れた・細すぎる三角形は凸包が作れないので捨てる（高さ 1mm 未満）
      const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      if (cross < 1e-6 || cross / Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) < 1e-3) continue;
      out.push(new Float32Array([a.x, a.y, b.x, b.y, c.x, c.y]));
    }
  }
  return out;
}

function hashColor(ch) {
  let h = 0;
  for (const c of ch) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.7, 0.55);
}
const STONE = [0xb08968, 0x9c8f80, 0xc4a77d, 0x8d99ae, 0xa3b18a, 0xbc8a5f];
function stoneColor(ch, i) {
  return new THREE.Color(STONE[(ch.codePointAt(0) + i) % STONE.length]);
}

// ---------- 物理ワールドとステージ ----------
let world = null;
let things = [];        // 動く物 { body, mesh, cols, shape, kind: 'block' | 'king' | 'shot' }
let decor = [];         // 動かない見た目（地面・高台・パチンコ）
let terrain = new Set(); // 地形のコライダーの handle
let king = null;
let stageIndex = 0;

function disposeMesh(m) {
  scene.remove(m);
  m.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
}

function addThing(shape, x, y, kind, color, sleeping) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y);
  if (sleeping) desc.setSleeping(true); // 城は触られるまで眠らせておく（組んだ直後に崩れないように）
  if (kind === 'shot') desc.setCcdEnabled(true); // 速い弾が薄いブロックをすり抜けないように
  const body = world.createRigidBody(desc);
  const cols = [];
  for (const t of shape.tris) {
    const d = RAPIER.ColliderDesc.convexHull(t);
    if (!d) continue;
    try {
      const shot = kind === 'shot';
      cols.push(world.createCollider(d.setDensity(shot ? SHOT_DENSITY : BLOCK_DENSITY).setFriction(shot ? 0.6 : 0.55).setRestitution(0.05), body));
    } catch { /* 凸包が作れなかった三角形は飛ばす */ }
  }
  const mesh = buildMesh(shape.polys, DEPTH, color);
  mesh.castShadow = false;
  if (kind === 'king') { mesh.material.emissive = new THREE.Color(0x553300); mesh.material.metalness = 0.4; }
  scene.add(mesh);
  const o = { body, mesh, cols, shape, kind };
  things.push(o);
  return o;
}

function removeThing(o) {
  world.removeRigidBody(o.body);
  disposeMesh(o.mesh);
  things.splice(things.indexOf(o), 1);
}

function addBox(x0, x1, y0, y1, color, z = 0, depth = 4) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  scene.add(m);
  decor.push(m);
}

function addTerrain(x0, x1, y0, y1, color, depth = 4) {
  const c = world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2)
    .setTranslation((x0 + x1) / 2, (y0 + y1) / 2).setFriction(0.9));
  terrain.add(c.handle);
  addBox(x0, x1, y0, y1, color, 0, depth);
  addBox(x0, x1, y1 - 0.1, y1 + 0.01, 0x7cb342, 0, depth + 0.02); // 上面の草
}

// パチンコ本体は「Y」の字。ゴムは2本の細い板で描く
let sling = null;
function buildSlingshot() {
  const shape = glyphShape('Y', 3, 3);
  const mesh = buildMesh(shape.polys, DEPTH * 0.8, new THREE.Color(0x7a4a2a));
  mesh.position.set(ANCHOR.x, shape.size.y / 2, -0.45);
  scene.add(mesh);
  decor.push(mesh);
  const top = shape.size.y, hw = shape.size.x / 2 - 0.22;
  const band = z => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.09, 0.09), new THREE.MeshStandardMaterial({ color: 0x3b2314 }));
    m.position.z = z;
    scene.add(m);
    decor.push(m);
    return m;
  };
  sling = {
    left: new THREE.Vector2(ANCHOR.x - hw, top - 0.12), right: new THREE.Vector2(ANCHOR.x + hw, top - 0.12),
    back: band(-0.4), front: band(0.45),
  };
}
function setBand(m, a, b) {
  m.position.x = (a.x + b.x) / 2;
  m.position.y = (a.y + b.y) / 2;
  m.scale.x = Math.max(0.01, a.distanceTo(b));
  m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
}

// 遠景の雲（これも文字）
function buildClouds() {
  const shape = glyphShape('雲', 1.8, 1.2);
  for (const [x, y] of [[3, 6.2], [10.5, 7.0], [18, 5.8], [-1, 8.4], [14, 9.4]]) {
    const m = buildMesh(shape.polys, 0.2, new THREE.Color(0xffffff));
    m.material.transparent = true;
    m.material.opacity = 0.8;
    m.material.emissive = new THREE.Color(0xbbbbbb);
    m.position.set(x, y, -8);
    scene.add(m);
    decor.push(m);
  }
}

function clearWorld() {
  for (const o of things) disposeMesh(o.mesh);
  for (const m of decor) disposeMesh(m);
  things = []; decor = []; terrain = new Set(); king = null;
  world?.free();
  world = null;
}

// ---------- 進行 ----------
let phase = 'loading';  // aim（弾を込めて待つ）| flying（撃った後）| over（勝敗が決まった）
let loaded = null;      // つがえている弾 { shape, mesh }
let shots = [];         // 撃った文字
let simTime = 0, lastShotAt = 0, settledFor = 0;
let outcome = null;     // { win, reason, at }
const pull = new THREE.Vector2(); // 弾の位置 - ANCHOR
let dragging = false;

function buildStage(i) {
  clearWorld();
  stageIndex = i;
  const st = STAGES[i];
  world = new RAPIER.World({ x: 0, y: GRAVITY });
  world.timestep = DT;
  world.numSolverIterations = 8; // 積み木が沈んだり滑ったりしにくいように

  addTerrain(st.ground[0], st.ground[1], -40, 0, 0x8d6e4a); // 縦長の画面でも下が空かないよう深くしておく
  const tops = [[st.ground[0], st.ground[1], 0]]; // 積み上げの高さ [左端, 右端, 上面]
  for (const [x0, x1, h] of st.hills) {
    addTerrain(x0, x1, -0.5, h, 0x9a7b55, 4.1); // 奥行きを少し大きくして、地面の草より手前に出す
    tops.push([x0, x1, h]);
  }

  st.blocks.forEach(([ch, x, opt = {}], i) => {
    const shape = glyphShape(ch, opt.sx, opt.sy);
    const hw = shape.size.x / 2;
    let base = 0;
    for (const [a, b, t] of tops) if (a < x + hw - 0.02 && b > x - hw + 0.02) base = Math.max(base, t);
    const kind = opt.king ? 'king' : 'block';
    const color = opt.king ? new THREE.Color(0xffc21a) : stoneColor(ch, i);
    const o = addThing(shape, x, base + shape.size.y / 2 + 0.002, kind, color, true);
    tops.push([x - hw, x + hw, base + shape.size.y]);
    if (opt.king) king = o;
  });

  buildSlingshot();
  buildClouds();
  shots = [];
  simTime = 0; lastShotAt = 0; settledFor = 0;
  outcome = null;
  dragging = false;
  $('result').hidden = true;
  $('stage').value = String(i);
  loadShot();
  renderAmmo();
}

// 選んでいる文字を弾としてパチンコにつがえる
function currentChar() {
  return Array.from($('char').value.trim())[0] || '';
}
function shotShape() {
  const ch = currentChar();
  if (!ch || !font) return null;
  const s = glyphShape(ch);
  return s && s.area >= MIN_AREA ? s : null;
}

function loadShot() {
  if (loaded) { disposeMesh(loaded.mesh); loaded = null; }
  pull.set(0, 0);
  renderStats();
  if (shots.length >= SHOTS || outcome) { phase = outcome ? 'over' : 'flying'; return; }
  phase = 'aim';
  const shape = shotShape();
  if (!shape) { msg(currentChar() ? `「${currentChar()}」は弾にできません` : ''); return; }
  msg('');
  const mesh = buildMesh(shape.polys, DEPTH, hashColor(shape.ch));
  mesh.position.z = 0.02;
  scene.add(mesh);
  loaded = { shape, mesh };
  renderAmmo();
}

function shotPos() {
  return ANCHOR.clone().add(pull);
}
function launchVelocity() {
  const k = V_MAX * speedFactor(loaded.shape.area * SHOT_DENSITY) / MAX_PULL;
  return new THREE.Vector2(-pull.x * k, -pull.y * k);
}

function fire() {
  const p = shotPos(), v = launchVelocity();
  const o = addThing(loaded.shape, p.x, p.y, 'shot', hashColor(loaded.shape.ch), false);
  o.body.setLinvel({ x: v.x, y: v.y }, true);
  o.body.setAngvel(-v.x * 0.15, true); // ほんの少し回して飛ばす
  shots.push(loaded.shape.ch);
  disposeMesh(loaded.mesh);
  loaded = null;
  pull.set(0, 0);
  phase = 'flying';
  lastShotAt = simTime;
  settledFor = 0;
  $('hint').classList.add('hide');
  renderAmmo();
}

// 「王」が地形（地面・高台）に触れているか
function kingOnGround() {
  const others = [];
  for (const c of king.cols) world.contactPairsWith(c, o => { if (terrain.has(o.handle)) others.push([c, o]); });
  let hit = false;
  for (const [c, o] of others) world.contactPair(c, o, m => { if (m.numContacts() > 0) hit = true; });
  return hit;
}

function moving() {
  const v2 = SETTLE_SPEED * SETTLE_SPEED;
  return things.some(o => {
    if (o.body.isSleeping()) return false;
    const v = o.body.linvel(), w = o.body.angvel();
    return v.x * v.x + v.y * v.y > v2 || w * w > v2;
  });
}

// 1ステップ進めて勝敗を判定する
function step() {
  world.step();
  simTime += DT;

  for (const o of things.slice()) {
    const t = o.body.translation();
    const out = t.y < VIEW.y0 - 2.5 || t.x < VIEW.x0 - 3 || t.x > VIEW.x1 + 3;
    if (o === king) {
      if (out && !outcome) outcome = { win: true, reason: 'out', at: simTime };
    } else if (out) removeThing(o); // 画面外に出た弾やブロックは片づける
  }
  if (!outcome && kingOnGround()) outcome = { win: true, reason: 'ground', at: simTime };

  settledFor = moving() ? 0 : settledFor + DT;
  const settled = settledFor >= SETTLE_SEC;
  if (phase === 'flying' && !outcome) {
    const since = simTime - lastShotAt;
    if (shots.length < SHOTS) {
      if (settled || since >= NEXT_SHOT_SEC) loadShot();
    } else if (settled || since >= END_WAIT_SEC) {
      outcome = { win: false, reason: 'safe', at: simTime };
    }
  }
  if (outcome && phase !== 'over') {
    phase = 'over';
    dragging = false;
    if (loaded) { disposeMesh(loaded.mesh); loaded = null; }
    pull.set(0, 0);
  }
  if (outcome && !outcome.shown && simTime - outcome.at >= (outcome.win ? RESULT_DELAY : 0.3)) {
    outcome.shown = true;
    showResult();
  }
}

// ---------- 表示 ----------
function loadCleared() {
  try { return JSON.parse(localStorage.getItem(CLEAR_KEY)) || {}; } catch { return {}; }
}
function starsFor(left) {
  return left >= 3 ? 3 : left >= 1 ? 2 : 1;
}
const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);

function renderStageSelect() {
  const cleared = loadCleared();
  $('stage').innerHTML = STAGES.map((s, i) =>
    `<option value="${i}">${i + 1}. ${s.name}${cleared[i] ? ' ' + starText(cleared[i]) : ''}</option>`).join('');
  $('stage').value = String(stageIndex);
}

function renderAmmo() {
  const html = [];
  for (let i = 0; i < SHOTS; i++) {
    if (i < shots.length) html.push(`<span class="shot used">${shots[i]}</span>`);
    else html.push(`<span class="shot left">${i === shots.length && loaded ? loaded.shape.ch : ''}</span>`);
  }
  $('ammo').innerHTML = `<span>弾</span>${html.join('')}`;
}

function renderStats() {
  const s = shotShape();
  for (const b of document.querySelectorAll('.presets button')) b.classList.toggle('on', b.dataset.c === currentChar());
  if (!s) { $('stats').innerHTML = ''; return; }
  const m = s.area * SHOT_DENSITY, f = speedFactor(m);
  $('stats').innerHTML =
    `<span class="stat weight">重さ <i><b style="width:${Math.min(100, m / 2.4 * 100).toFixed(0)}%"></b></i> ${m.toFixed(2)}kg</span>` +
    `<span class="stat">速さ <i><b style="width:${(f / 1.9 * 100).toFixed(0)}%"></b></i> ×${f.toFixed(2)}</span>`;
}

function showResult() {
  const r = $('result');
  r.hidden = false;
  r.className = outcome.win ? 'win' : 'lose';
  const last = stageIndex === STAGES.length - 1;
  if (outcome.win) {
    const left = SHOTS - shots.length, stars = starsFor(left);
    const cleared = loadCleared();
    if (!(cleared[stageIndex] >= stars)) {
      cleared[stageIndex] = stars;
      try { localStorage.setItem(CLEAR_KEY, JSON.stringify(cleared)); } catch { /* 保存できなくても遊べる */ }
    }
    renderStageSelect();
    $('result-title').textContent = `ステージクリア！ ${starText(stars)}`;
    $('result-sub').textContent = `${outcome.reason === 'out' ? '「王」を場外に落とした！' : '「王」を地面に落とした！'} ${shots.length} 発でクリア（残り ${left} 発）` +
      (last ? ' 全ステージ制覇！' : '');
    $('next').hidden = last;
  } else {
    $('result-title').textContent = '失敗…';
    $('result-sub').textContent = '「王」はまだ無事です。重い字・軽い字を使い分けてみよう';
    $('next').hidden = true;
  }
}

function syncMeshes() {
  for (const o of things) {
    const t = o.body.translation();
    o.mesh.position.set(t.x, t.y, 0);
    o.mesh.rotation.z = o.body.rotation();
  }
  if (!sling) return;
  const p = loaded ? shotPos() : ANCHOR;
  if (loaded) loaded.mesh.position.set(p.x, p.y, 0.02);
  // ゴムは弾の後ろ側（引っぱる向きの反対側）にかける
  const d = pull.lengthSq() > 1e-6 ? pull.clone().normalize().multiplyScalar(0.35) : new THREE.Vector2();
  const hold = loaded ? p.clone().add(d) : ANCHOR;
  setBand(sling.back, sling.left, hold);
  setBand(sling.front, hold, sling.right);
}

// 軌道の予告（点線）
const dots = [];
const dotGeo = new THREE.CircleGeometry(0.07, 12);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
for (let i = 0; i < PREVIEW_DOTS; i++) {
  const d = new THREE.Mesh(dotGeo, dotMat);
  d.position.z = 1;
  d.visible = false;
  scene.add(d);
  dots.push(d);
}
function updatePreview() {
  const show = dragging && loaded && pull.length() >= MIN_PULL;
  if (!show) { for (const d of dots) d.visible = false; return; }
  const p = shotPos(), v = launchVelocity();
  dots.forEach((d, i) => {
    const t = (i + 1) * PREVIEW_STEP;
    d.position.x = p.x + v.x * t;
    d.position.y = p.y + v.y * t + 0.5 * GRAVITY * t * t;
    d.visible = true;
    d.scale.setScalar(1 - i / PREVIEW_DOTS * 0.6);
  });
}

// ---------- 操作（マウス・タッチ共通） ----------
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
function worldPoint(e) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, p)) return null;
  return new THREE.Vector2(p.x, p.y);
}
function setPull(p) {
  pull.copy(p).sub(ANCHOR);
  if (pull.length() > MAX_PULL) pull.setLength(MAX_PULL);
  const minY = loaded.shape.size.y / 2 + 0.05 - ANCHOR.y; // 地面にめり込ませない
  if (pull.y < minY) pull.y = minY;
}

canvas.addEventListener('pointerdown', e => {
  if (phase !== 'aim' || !loaded) return;
  const p = worldPoint(e);
  if (!p || p.distanceTo(ANCHOR) > GRAB_R) return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  setPull(p);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const p = worldPoint(e);
  if (p) setPull(p);
});
function release() {
  if (!dragging) return;
  dragging = false;
  if (phase === 'aim' && loaded && pull.length() >= MIN_PULL) fire();
  else pull.set(0, 0);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => { dragging = false; pull.set(0, 0); });

$('char').addEventListener('input', () => {
  if (!currentChar()) return;
  if (phase === 'aim' && !dragging) loadShot(); else renderStats();
});
for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => {
    $('char').value = b.dataset.c;
    $('char').dispatchEvent(new Event('input'));
  });
}
$('stage').addEventListener('change', () => buildStage(+$('stage').value));
$('restart').addEventListener('click', () => buildStage(stageIndex));
$('retry').addEventListener('click', () => buildStage(stageIndex));
$('next').addEventListener('click', () => buildStage(Math.min(stageIndex + 1, STAGES.length - 1)));

// ---------- ループ ----------
let acc = 0, last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (world) {
    acc += dt;
    while (acc >= DT) { step(); acc -= DT; }
    syncMeshes();
  }
  updatePreview();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// 調整・テスト用（コンソールから）：catapult.fire('鬱', 引く向きx, 引く向きy, 引く長さ0〜1) で撃ち、
// catapult.run(秒) で描画せずに時間を進める
window.catapult = {
  fire(ch, dx, dy, power = 1) {
    if (ch) { $('char').value = ch; loadShot(); }
    if (phase !== 'aim' || !loaded) return false;
    pull.set(dx, dy).setLength(MAX_PULL * power);
    fire();
    return true;
  },
  run(sec) { for (let i = 0; i < sec / DT; i++) step(); syncMeshes(); },
  stage: i => buildStage(i),
  speed: ch => V_MAX * speedFactor(glyphShape(ch).area * SHOT_DENSITY), // 目いっぱい引いたときの速さ
  anchor: () => ({ x: ANCHOR.x, y: ANCHOR.y, maxPull: MAX_PULL }),
  toScreen(x, y) { // 世界の座標 → 画面の座標（px）
    const v = new THREE.Vector3(x, y, 0).project(camera), r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  },
  info: () => ({
    phase, shots: shots.slice(), outcome, bodies: things.length,
    king: king && { ...king.body.translation(), angle: king.body.rotation() },
    moved: things.filter(o => o.kind !== 'shot' && !o.body.isSleeping()).length,
  }),
};

// ---------- 起動 ----------
renderStageSelect();
resize();
requestAnimationFrame(frame);
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  msg('');
  buildStage(0);
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
