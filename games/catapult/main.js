// 文字カタパルト：文字をパチンコで撃って、文字で組んだ城を崩し「王」を落とす
import * as THREE from 'three';
import RAPIER from 'rapier2d';
import * as opentype from 'opentype';
import { glyphPolygons, centerPolygons, buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import { STAGES } from './stages.js';

const DEFAULT_SHOTS = 5;      // 1ステージで撃てる弾の数（ステージごとに変えられる）
const EM = 1.0;               // 文字 1em の大きさ（m）
const DEPTH = 0.6;            // 見た目の厚み（物理は 2D なので関係ない）
const SHOT_DENSITY = 4.0;     // 弾の質量 = 文字の面積 × 密度（弾は石、城は木のつもりで重さを変える）
const BLOCK_DENSITY = 1.0;
const HEAVY_DENSITY = 3.0;    // 石のブロック
const BOSS_DENSITY = 3.0;
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
const VIEW = { x0: -1.6, x1: 20.6, y0: -1.3, y1: 7.0 };    // 必ず画面に入れる範囲
const OUT = { x0: -12, x1: 46, y0: -3 };                   // 王がここから出たら場外（谷や崖の下に落ちた）
const REMOVE = { x0: -16, x1: 52, y0: -14 };               // ほかの物はここまで出たら片づける
const FOLLOW = { x0: -12, x1: 48, y0: -8, y1: 24 };        // カメラが追いかける範囲
const VALLEY_Y = -6;                                       // 谷底の高さ
const MAX_ZOOM_OUT = 2.0;     // 追いかけるときに引いて映す最大の倍率
const SPECIAL_SEC = 5;        // 撃ってからこの秒数のあいだ必殺技を出せる
const BOSS_HIT_MIN = 3;       // ボスがこれより弱い衝撃（N·s）を受けてもダメージにならない
const BOSS_HIT_DAMAGE = 1.5;  // 衝撃 1 N·s あたりのダメージ
const BOSS_HIT_MAX = 30;      // 1回の当たりで減る体力の上限（重い一撃でも4発ほどは要るように）
const BOSS_HIT_GAP = 0.2;     // 当たってからこの秒数は次のダメージを数えない（1回の衝突を何度も数えない）
const CLEAR_KEY = 'moji_battle.catapult.cleared';        // ステージごとの最高の星の数

// 撃ち出すエネルギーを同じにする → 軽い弾ほど速く、重い弾は遅いが勢い（運動量）が大きい
const speedFactor = m => Math.min(1.9, Math.max(0.6, Math.sqrt(M_REF / m)));

// 必殺技は弾の重さで決まる。飛んでいる間に画面をタップすると1回だけ出せる
const SPECIALS = {
  heavy: { name: '重力落とし', desc: '真下に急降下して重さ3倍' },
  mid: { name: '加速突撃', desc: '飛んでいる向きに2倍の速さ' },
  light: { name: '分身', desc: '3つに分かれる' },
};
const specialOf = m => m >= 1.8 ? 'heavy' : m <= 1.0 ? 'light' : 'mid';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };
const HINT_START = $('hint').innerHTML;

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

// カメラ：ふだんは VIEW を映し、王や飛んでいる弾が外へ出たら引いて追いかける
const cam = { x: 0, y: 0, halfH: 1, ready: false };
let usable = 1; // 画面の高さのうち、上の操作バーに隠れない割合

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  usable = Math.max(0.3, (innerHeight - $('bar').offsetHeight - 16) / innerHeight);
  document.body.style.setProperty('--bar-h', `${$('bar').offsetHeight}px`);
  cam.ready = false; // 次のフレームで一気に合わせ直す
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe($('bar')); // 文字や性能の表示で操作バーの高さが変わったときも合わせ直す

// 範囲 r が操作バーを除いた画面にまるごと入るカメラ（地面は画面の下端近く）
function fitRegion(r) {
  const w = innerWidth, h = innerHeight;
  const vw = r.x1 - r.x0, vh = r.y1 - r.y0;
  const halfH = Math.max(vw / 2 * h / w, vh / 2 / usable);
  // 縦長の画面で余る高さは、地面の下にも半分ほど回す（城が画面の下端に張りつかないように）
  const extra = w < h ? halfH * 2 * usable - vh : 0;
  return { x: (r.x0 + r.x1) / 2, y: r.y0 + halfH - extra * 0.45, halfH };
}

function updateCamera(dt) {
  const base = fitRegion(VIEW);
  const r = { ...VIEW };
  let focus = null, far = 0;
  for (const p of followPoints()) {
    const x = clamp(p.x, FOLLOW.x0, FOLLOW.x1), y = clamp(p.y, FOLLOW.y0, FOLLOW.y1);
    r.x0 = Math.min(r.x0, x - 1.5); r.x1 = Math.max(r.x1, x + 1.5);
    r.y0 = Math.min(r.y0, y - 1.5); r.y1 = Math.max(r.y1, y + 1.5);
    const d = Math.max(VIEW.x0 - x, x - VIEW.x1, VIEW.y0 - y, y - VIEW.y1);
    if (d > far) { far = d; focus = { x, y }; }
  }
  let t = fitRegion(r);
  const maxH = base.halfH * MAX_ZOOM_OUT;
  if (t.halfH > maxH && focus) {
    // 引ききれないときは、いちばん遠くへ行った物が画面に入るようにずらす
    const halfW = maxH * innerWidth / innerHeight, m = 1.5;
    t = {
      halfH: maxH,
      x: clamp(t.x, focus.x - halfW + m, focus.x + halfW - m),
      y: clamp(r.y0 + maxH, focus.y - maxH + m, focus.y + maxH * (2 * usable - 1) - m),
    };
  }
  if (!cam.ready) { Object.assign(cam, t); cam.ready = true; }
  const k = 1 - Math.exp(-dt * 3);
  cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k; cam.halfH += (t.halfH - cam.halfH) * k;
  const halfW = cam.halfH * innerWidth / innerHeight;
  camera.left = -halfW; camera.right = halfW; camera.top = cam.halfH; camera.bottom = -cam.halfH;
  camera.updateProjectionMatrix();
  camera.position.set(cam.x, cam.y + 7, 50); // 少し上から見て文字の厚みを見せる
  camera.lookAt(cam.x, cam.y, 0);
}

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
const WOOD = [0xb08968, 0x9c8f80, 0xc4a77d, 0x8d99ae, 0xa3b18a, 0xbc8a5f];
const ROCK = [0x6b7078, 0x5d6168, 0x777c84];
function blockColor(ch, i, heavy) {
  const list = heavy ? ROCK : WOOD;
  return new THREE.Color(list[(ch.codePointAt(0) + i) % list.length]);
}

// ---------- 物理ワールドとステージ ----------
let world = null;
let things = [];        // 動く物 { body, mesh, cols, shape, kind: 'block' | 'king' | 'boss' | 'shot' }
let decor = [];         // 動かない見た目（地面・高台・パチンコ・雲）
let terrain = new Set(); // 地形のコライダーの handle
let targets = [];       // 倒す相手 { o, down, reason }（王とボス）
let boss = null;        // { o, hp, maxHp, prevV, flash }
let stageIndex = 0;
let shotLimit = DEFAULT_SHOTS;

function disposeMesh(m) {
  scene.remove(m);
  m.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
}

function addThing(shape, x, y, { kind, color, density, sleeping = false }) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y);
  if (sleeping) desc.setSleeping(true); // 城は触られるまで眠らせておく（組んだ直後に崩れないように）
  if (kind === 'shot') desc.setCcdEnabled(true); // 速い弾が薄いブロックをすり抜けないように
  const body = world.createRigidBody(desc);
  const cols = [];
  for (const t of shape.tris) {
    const d = RAPIER.ColliderDesc.convexHull(t);
    if (!d) continue;
    try {
      cols.push(world.createCollider(d.setDensity(density).setFriction(kind === 'shot' ? 0.6 : 0.55).setRestitution(0.05), body));
    } catch { /* 凸包が作れなかった三角形は飛ばす */ }
  }
  const mesh = buildMesh(shape.polys, DEPTH, color);
  mesh.castShadow = false;
  if (kind === 'king') { mesh.material.emissive = new THREE.Color(0x553300); mesh.material.metalness = 0.4; }
  if (kind === 'boss') mesh.material.emissive = new THREE.Color(0x220033);
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

// 遠景の雲（これも文字）。カメラが引いたときのために広めに置く
function buildClouds() {
  const shape = glyphShape('雲', 1.8, 1.2);
  for (const [x, y] of [[3, 6.2], [10.5, 7.0], [18, 5.8], [-1, 8.4], [14, 9.4], [25, 7.5], [31, 10.5], [38, 6.8], [-8, 7.2], [22, 13]]) {
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
  clearEffects();
  things = []; decor = []; terrain = new Set(); targets = []; boss = null; active = null;
  world?.free();
  world = null;
}

// ---------- 進行 ----------
let phase = 'loading';  // aim（弾を込めて待つ）| flying（撃った後）| over（勝敗が決まった）
let loaded = null;      // つがえている弾 { shape, mesh }
let active = null;      // いま飛んでいる弾 { o, special, used }
let shots = [];         // 撃った文字
let simTime = 0, lastShotAt = 0, settledFor = 0;
let outcome = null;     // { win, reason, at }
const pull = new THREE.Vector2(); // 弾の位置 - ANCHOR
let dragging = false;

function buildStage(i) {
  clearWorld();
  stageIndex = i;
  const st = STAGES[i];
  shotLimit = st.shots ?? DEFAULT_SHOTS;
  world = new RAPIER.World({ x: 0, y: GRAVITY });
  world.timestep = DT;
  world.numSolverIterations = 8; // 積み木が沈んだり滑ったりしにくいように

  // 谷底：谷や崖から落ちた物がここで止まり、画面の中に見えるようにする（触れたら場外の扱い）
  addTerrain(-40, 60, -40, VALLEY_Y, 0x6d5636, 3.9);
  const tops = []; // 積み上げの高さ [左端, 右端, 上面]
  const grounds = Array.isArray(st.ground[0]) ? st.ground : [st.ground];
  for (const [x0, x1] of grounds) {
    addTerrain(x0, x1, -40, 0, 0x8d6e4a); // 縦長の画面でも下が空かないよう深くしておく
    tops.push([x0, x1, 0]);
  }
  for (const [x0, x1, h] of st.hills) {
    addTerrain(x0, x1, -0.5, h, 0x9a7b55, 4.1); // 奥行きを少し大きくして、地面の草より手前に出す
    tops.push([x0, x1, h]);
  }

  st.blocks.forEach(([ch, x, opt = {}], i) => {
    const shape = glyphShape(ch, opt.sx, opt.sy);
    const hw = shape.size.x / 2;
    let base = -Infinity;
    for (const [a, b, t] of tops) if (a < x + hw - 0.02 && b > x - hw + 0.02) base = Math.max(base, t);
    if (base === -Infinity) base = 0;
    const kind = opt.boss ? 'boss' : opt.king ? 'king' : 'block';
    const color = opt.boss ? new THREE.Color(0x7b2d9c) : opt.king ? new THREE.Color(0xffc21a) : blockColor(ch, i, opt.heavy);
    const density = opt.boss ? BOSS_DENSITY : opt.heavy ? HEAVY_DENSITY : BLOCK_DENSITY;
    const o = addThing(shape, x, base + shape.size.y / 2 + 0.002, { kind, color, density, sleeping: true });
    tops.push([x - hw, x + hw, base + shape.size.y]);
    if (opt.king || opt.boss) targets.push({ o, down: false, reason: '' });
    if (opt.boss) boss = { o, hp: opt.boss.hp, maxHp: opt.boss.hp, prevV: { x: 0, y: 0 }, flash: 0, hitAt: -1 };
  });

  buildSlingshot();
  buildClouds();
  shots = [];
  simTime = 0; lastShotAt = 0; settledFor = 0;
  outcome = null;
  dragging = false;
  cam.ready = false;
  $('result').hidden = true;
  $('stage').value = String(i);
  renderBoss();
  loadShot();
  renderAmmo();
  const kings = targets.filter(g => g.o.kind === 'king').length;
  $('hint').innerHTML = boss ? `ボス戦！ 魔王「${boss.o.shape.ch}」の体力を0にするか、地面に落とせば勝ち`
    : kings > 1 ? `「王」が ${kings} 人いる！ 全員を地面か画面の外に落とせば勝ち` : HINT_START;
  $('hint').classList.remove('hide');
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
  if (shots.length >= shotLimit || outcome) { phase = outcome ? 'over' : 'flying'; return; }
  phase = 'aim';
  active = null;
  if (shots.length) $('hint').classList.add('hide');
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

function addShot(shape, x, y, vx, vy) {
  const o = addThing(shape, x, y, { kind: 'shot', color: hashColor(shape.ch), density: SHOT_DENSITY });
  o.body.setLinvel({ x: vx, y: vy }, true);
  o.body.setAngvel(-vx * 0.15, true); // ほんの少し回して飛ばす
  return o;
}

function fire() {
  const p = shotPos(), v = launchVelocity();
  const shape = loaded.shape;
  const o = addShot(shape, p.x, p.y, v.x, v.y);
  active = { o, special: specialOf(shape.area * SHOT_DENSITY), used: false };
  shots.push(shape.ch);
  disposeMesh(loaded.mesh);
  loaded = null;
  pull.set(0, 0);
  phase = 'flying';
  lastShotAt = simTime;
  settledFor = 0;
  $('hint').textContent = '飛んでいる間に画面をタップすると必殺技！';
  $('hint').classList.remove('hide');
  renderAmmo();
}

// ---------- 必殺技 ----------
function canSpecial() {
  if (phase !== 'flying' || !active || active.used || !things.includes(active.o)) return false;
  const v = active.o.body.linvel();
  return simTime - lastShotAt < SPECIAL_SEC && v.x * v.x + v.y * v.y > 1;
}

function useSpecial() {
  if (!canSpecial()) return false;
  active.used = true;
  const { o, special } = active;
  const b = o.body, t = b.translation(), v = b.linvel();
  if (special === 'heavy') {
    // 重力落とし：真下へ急降下し、重さを3倍にする
    for (const c of o.cols) c.setDensity(SHOT_DENSITY * 3);
    b.setLinvel({ x: v.x * 0.25, y: -24 }, true);
    b.setAngvel(0, true);
  } else if (special === 'mid') {
    // 加速突撃：いま飛んでいる向きに2倍の速さ
    const s = Math.min(2, 40 / Math.hypot(v.x, v.y));
    b.setLinvel({ x: v.x * s, y: v.y * s }, true);
  } else {
    // 分身：上下に少し開いた2つの分身を出す
    const len = Math.hypot(v.x, v.y), nx = -v.y / len, ny = v.x / len; // 進む向きに垂直な向き
    const gap = Math.max(o.shape.size.x, o.shape.size.y) * 1.1;
    for (const sgn of [1, -1]) {
      const a = 0.18 * sgn, c = Math.cos(a), s = Math.sin(a);
      addShot(o.shape, t.x + nx * gap * sgn, t.y + ny * gap * sgn, v.x * c - v.y * s, v.x * s + v.y * c);
    }
  }
  burst(t.x, t.y, special === 'heavy' ? 0xff7043 : special === 'mid' ? 0xffd54f : 0x80deea);
  popText(`必殺！${SPECIALS[special].name}`, t.x, t.y + 1);
  $('hint').classList.add('hide');
  return true;
}

// 演出：広がって消える輪と、浮かんで消える文字
let effects = [];
function burst(x, y, color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 40), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.set(x, y, 1.2);
  scene.add(m);
  effects.push({ mesh: m, t: 0 });
}
function updateEffects(dt) {
  for (const e of effects) {
    e.t += dt;
    e.mesh.scale.setScalar(1 + e.t * 9);
    e.mesh.material.opacity = Math.max(0, 1 - e.t / 0.5);
  }
  for (const e of effects.filter(e => e.t >= 0.5)) disposeMesh(e.mesh);
  effects = effects.filter(e => e.t < 0.5);
}
function clearEffects() {
  for (const e of effects) disposeMesh(e.mesh);
  effects = [];
  for (const el of document.querySelectorAll('.pop')) el.remove();
}
function popText(text, x, y, cls = '') {
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.textContent = text;
  const p = toScreen(x, y);
  el.style.left = `${clamp(p.x, 60, innerWidth - 60)}px`;
  el.style.top = `${clamp(p.y, 80, innerHeight - 40)}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

// ---------- 勝敗 ----------
// 地形（地面・高台）に触れているか
function onGround(o) {
  const others = [];
  for (const c of o.cols) world.contactPairsWith(c, other => { if (terrain.has(other.handle)) others.push([c, other]); });
  let hit = false;
  for (const [c, other] of others) world.contactPair(c, other, m => { if (m.numContacts() > 0) hit = true; });
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

// ボスは受けた衝撃（速度の急な変化 × 質量）でダメージを受ける
function hurtBoss() {
  if (!boss || boss.hp <= 0) return;
  const b = boss.o.body, v = b.linvel();
  const dvx = v.x - boss.prevV.x, dvy = v.y - boss.prevV.y - GRAVITY * DT; // 重力で増えた分は除く
  boss.prevV = { x: v.x, y: v.y };
  const impulse = b.mass() * Math.hypot(dvx, dvy);
  if (!shots.length || impulse < BOSS_HIT_MIN) return; // 撃つ前に城が落ち着くときの揺れは数えない
  if (simTime - boss.hitAt < BOSS_HIT_GAP) return;
  const dmg = Math.min(BOSS_HIT_MAX, Math.round((impulse - BOSS_HIT_MIN) * BOSS_HIT_DAMAGE));
  if (dmg < 1) return;
  boss.hitAt = simTime;
  boss.hp = Math.max(0, boss.hp - dmg);
  boss.flash = 0.25;
  const t = b.translation();
  popText(`-${dmg}`, t.x, t.y + 1.4, 'dmg');
  renderBoss();
}

// 1ステップ進めて勝敗を判定する
function step() {
  world.step();
  simTime += DT;
  hurtBoss();

  for (const o of things.slice()) {
    const t = o.body.translation();
    if (o.kind === 'king' || o.kind === 'boss') continue;
    if (t.y < REMOVE.y0 || t.x < REMOVE.x0 || t.x > REMOVE.x1) removeThing(o); // 遠くへ行った弾やブロックは片づける
  }
  for (const g of targets) {
    if (g.down) continue;
    const t = g.o.body.translation();
    if (t.y < OUT.y0 || t.x < OUT.x0 || t.x > OUT.x1) g.reason = 'out';
    else if (g.o === boss?.o && boss.hp <= 0) g.reason = 'hp';
    else if (onGround(g.o)) g.reason = 'ground';
    if (g.reason) { g.down = true; downEffect(g); }
  }
  if (!outcome && targets.every(g => g.down)) outcome = { win: true, reason: targets[targets.length - 1].reason, at: simTime };

  settledFor = moving() ? 0 : settledFor + DT;
  const settled = settledFor >= SETTLE_SEC;
  if (phase === 'flying' && !outcome) {
    const since = simTime - lastShotAt;
    if (shots.length < shotLimit) {
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

// 倒した相手は色を落とす（複数いるステージで残りが分かるように）
function downEffect(g) {
  g.o.mesh.material.color.lerp(new THREE.Color(0x888888), 0.6);
  g.o.mesh.material.emissive = new THREE.Color(0x000000);
  const t = g.o.body.translation();
  const left = targets.filter(x => !x.down).length;
  if (left > 0) popText(`撃破！ のこり ${left}`, clamp(t.x, VIEW.x0, VIEW.x1), clamp(t.y, 0, VIEW.y1) + 1);
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
  for (let i = 0; i < shotLimit; i++) {
    if (i < shots.length) html.push(`<span class="shot used">${shots[i]}</span>`);
    else html.push(`<span class="shot left">${i === shots.length && loaded ? loaded.shape.ch : ''}</span>`);
  }
  $('ammo').innerHTML = `<span>弾</span>${html.join('')}`;
}

function renderStats() {
  const s = shotShape();
  for (const b of document.querySelectorAll('.presets button')) b.classList.toggle('on', b.dataset.c === currentChar());
  if (!s) { $('stats').innerHTML = ''; return; }
  const m = s.area * SHOT_DENSITY, f = speedFactor(m), sp = SPECIALS[specialOf(m)];
  $('stats').innerHTML =
    `<span class="stat weight">重さ <i><b style="width:${Math.min(100, m / 2.4 * 100).toFixed(0)}%"></b></i> ${m.toFixed(2)}kg</span>` +
    `<span class="stat">速さ <i><b style="width:${(f / 1.9 * 100).toFixed(0)}%"></b></i> ×${f.toFixed(2)}</span>` +
    `<span class="stat special" title="${sp.desc}">必殺：<b>${sp.name}</b></span>`;
}

function renderBoss() {
  $('boss').hidden = !boss;
  if (!boss) return;
  $('boss-name').textContent = `魔王「${boss.o.shape.ch}」`;
  $('boss-hp').style.width = `${(boss.hp / boss.maxHp * 100).toFixed(1)}%`;
  $('boss-num').textContent = `${boss.hp} / ${boss.maxHp}`;
}

function showResult() {
  const r = $('result');
  r.hidden = false;
  r.className = outcome.win ? 'win' : 'lose';
  const last = stageIndex === STAGES.length - 1;
  const kings = targets.filter(g => g.o.kind === 'king').length;
  if (outcome.win) {
    const left = shotLimit - shots.length, stars = starsFor(left);
    const cleared = loadCleared();
    if (!(cleared[stageIndex] >= stars)) {
      cleared[stageIndex] = stars;
      try { localStorage.setItem(CLEAR_KEY, JSON.stringify(cleared)); } catch { /* 保存できなくても遊べる */ }
    }
    renderStageSelect();
    const what = boss ? `魔王「${boss.o.shape.ch}」を倒した！`
      : kings > 1 ? `${kings}人の「王」をすべて倒した！`
      : outcome.reason === 'out' ? '「王」を場外に落とした！' : '「王」を地面に落とした！';
    $('result-title').textContent = `${boss ? 'ボス撃破！' : 'ステージクリア！'} ${starText(stars)}`;
    $('result-sub').textContent = `${what} ${shots.length} 発でクリア（残り ${left} 発）` + (last ? ' 全ステージ制覇！' : '');
    $('next').hidden = last;
  } else {
    const left = targets.filter(g => !g.down).length;
    $('result-title').textContent = '失敗…';
    $('result-sub').textContent = boss ? `魔王はまだ HP ${boss.hp} 残っています。重い字の「重力落とし」が効くかも`
      : left < kings ? `「王」があと ${left} 人残っています` : '「王」はまだ無事です。重い字・軽い字や必殺技を使い分けてみよう';
    $('next').hidden = true;
  }
}

function toScreen(x, y) { // 世界の座標 → 画面の座標（px）
  const v = new THREE.Vector3(x, y, 0).project(camera), r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}

// カメラが追いかける物：まだ倒していない相手と、飛んでいる最中の弾
function followPoints() {
  const pts = targets.map(g => g.o.body.translation());
  if (phase === 'flying' && active && things.includes(active.o)) {
    const v = active.o.body.linvel();
    if (v.x * v.x + v.y * v.y > 1) pts.push(active.o.body.translation());
  }
  return pts;
}

function syncMeshes(dt) {
  for (const o of things) {
    const t = o.body.translation();
    o.mesh.position.set(t.x, t.y, 0);
    o.mesh.rotation.z = o.body.rotation();
  }
  if (boss && boss.flash > 0) {
    boss.flash -= dt;
    boss.o.mesh.material.emissive.setHex(boss.flash > 0 ? 0xcc0000 : boss.hp > 0 ? 0x220033 : 0x000000);
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
  if (useSpecial()) return; // 飛んでいる間のタップは必殺技
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
addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); useSpecial(); }
});

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
    syncMeshes(dt);
  }
  updateEffects(dt);
  updatePreview();
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// 調整・テスト用（コンソールから）：catapult.fire('鬱', 引く向きx, 引く向きy, 引く長さ0〜1) で撃ち、
// catapult.run(秒) で描画せずに時間を進める。catapult.special() で必殺技
window.catapult = {
  fire(ch, dx, dy, power = 1) {
    if (ch) { $('char').value = ch; loadShot(); }
    if (phase !== 'aim' || !loaded) return false;
    pull.set(dx, dy).setLength(MAX_PULL * power);
    fire();
    return true;
  },
  special: () => useSpecial(),
  kick(vx, vy) { const g = targets.find(g => !g.down); g?.o.body.setLinvel({ x: vx, y: vy }, true); }, // まだ立っている相手を飛ばす
  run(sec) { for (let i = 0; i < sec / DT; i++) step(); syncMeshes(0); },
  stage: i => buildStage(i),
  stages: () => STAGES.length,
  speed: ch => V_MAX * speedFactor(glyphShape(ch).area * SHOT_DENSITY), // 目いっぱい引いたときの速さ
  anchor: () => ({ x: ANCHOR.x, y: ANCHOR.y, maxPull: MAX_PULL }),
  toScreen,
  info: () => ({
    phase, shots: shots.slice(), shotLimit, outcome, bodies: things.length,
    targets: targets.map(g => ({ ...g.o.body.translation(), kind: g.o.kind, down: g.down, reason: g.reason })),
    king: targets.find(g => !g.down) && { ...targets.find(g => !g.down).o.body.translation() },
    boss: boss && boss.hp,
    active: active && things.includes(active.o) && { ...active.o.body.translation(), special: active.special, used: active.used },
    camera: { x: cam.x, y: cam.y, halfH: cam.halfH },
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
