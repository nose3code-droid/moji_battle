// 文字がったい：箱の上から文字を落とし、同じ字・決まった組み合わせの字がぶつかると合体して大きな漢字になる
// 物理は Rapier の 2D 版。当たり判定は glyph.js の輪郭を三角形に分けたもの（文字の形そのまま）
import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { glyphPolygons, centerPolygons, buildPrisms, buildMesh } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import { BASE, RECIPES, POINTS } from './recipes.js';

const BEST_KEY = 'moji_gattai.best';
const DT = 1 / 60;
const BOX_W = 5.4;          // 箱の内側の幅（m）。床の上面が y=0
const BOX_H = 7.2;          // 箱の高さ。ここより上に字がはみ出し続けたらおしまい
const WALL = 0.35;          // 壁の厚み
const DEPTH = 0.6;          // 文字の厚み（見た目だけ）
const EM = 1.15;            // 1段の字の大きさ（1em, m）。段が上がるごとに GROW 倍
const GROW = 1.24;
const FRICTION = 0.5;
const DROP_COOLDOWN = 0.55; // 落としてから次を落とせるまで（秒）
const GRACE = 1.2;          // 落とした・合体した直後はあふれ判定をしない（秒）
const OVER_TIME = 2.0;      // 線より上にこれだけ居続けたらおしまい（秒）

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6ecd9);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb09070, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-4, 8, 10);
scene.add(sun);

// 箱（見た目）：床・左右の壁・奥の板
const wood = new THREE.MeshStandardMaterial({ color: 0xa47148, roughness: 0.8 });
const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(BOX_W + WALL * 2, WALL, 1.4), wood);
floorMesh.position.y = -WALL / 2;
scene.add(floorMesh);
for (const s of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.BoxGeometry(WALL, BOX_H + WALL, 1.4), wood);
  w.position.set(s * (BOX_W + WALL) / 2, BOX_H / 2 - WALL / 2, 0);
  scene.add(w);
}
const back = new THREE.Mesh(new THREE.PlaneGeometry(BOX_W, BOX_H), new THREE.MeshBasicMaterial({ color: 0xfffaf0 }));
back.position.set(0, BOX_H / 2, -0.7);
scene.add(back);
// あふれの線
const lineMat = new THREE.MeshBasicMaterial({ color: 0xe03131, transparent: true, opacity: 0.35 });
const lineMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOX_W, 0.05), lineMat);
lineMesh.position.set(0, BOX_H, 0.72);
scene.add(lineMesh);
// 落とす位置のガイド線
const guide = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 1), new THREE.MeshBasicMaterial({ color: 0x8a6a40, transparent: true, opacity: 0.35 }));
scene.add(guide);

let viewW = 10, viewH = 10, camY = BOX_H / 2;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  // 箱と、その上で待つ字が収まるようにする。
  // 箱の横に上の表示（スコア・ヒント）を置く余白が無い画面では、上の表示のぶん箱を下げる
  const botPx = 20, yMin = -WALL - 0.3, yMax = BOX_H + 2.2, boxW = BOX_W + WALL * 2 + 0.6;
  const fit = topPx => Math.min(w / boxW, (h - topPx - botPx) / (yMax - yMin));
  const narrow = (w - boxW * fit(16)) / 2 < 300;
  document.body.classList.toggle('narrow', narrow);
  const topPx = narrow ? $('hud').offsetHeight + 16 : 16;
  const ppm = fit(topPx);
  viewW = w / ppm; viewH = h / ppm;
  camY = yMin - botPx / ppm + viewH / 2; // 縦長の画面では箱を下に寄せる（指が届きやすい）
  camera.left = -viewW / 2; camera.right = viewW / 2;
  camera.top = viewH / 2; camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  camera.position.set(0, camY + 2.5, 30); // 少し上から見下ろして厚みを見せる
  camera.lookAt(0, camY, 0);
}
addEventListener('resize', resize);
resize();

await RAPIER.init();

// ---------- 合体表 ----------
let font = null;
const combine = new Map();  // 「字|字」→ できる字
const tierOf = new Map();   // 字 → 段（1〜）
const partners = new Map(); // 字 → [{ with: 相手の字, to: できる字 }]（ヒント用）
const hueOf = new Map();    // 字 → 色合い
let pool = [];              // 落ちてくる字（出やすさのぶん並べる）
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// フォントにある字だけで合体表を組み立てる（無い字は代わりの字に置きかえるか、その合体をやめる）
function buildTable() {
  const ok = new Map();
  const has = ch => {
    if (!ok.has(ch)) ok.set(ch, font.charToGlyph(ch).index > 0 && !!shapeOf(ch, 1));
    return ok.get(ch);
  };
  const rename = new Map();
  for (const [, , to, alt] of RECIPES) if (!has(to) && alt && has(alt)) rename.set(to, alt);
  const nm = ch => rename.get(ch) ?? ch;
  for (const [ch, , hue] of BASE) if (has(ch)) { tierOf.set(ch, 1); hueOf.set(ch, hue / 360); }
  pool = BASE.flatMap(([ch, w]) => (tierOf.has(ch) ? Array(w).fill(ch) : []));
  const list = RECIPES.map(([a, b, to]) => [nm(a), nm(b), nm(to)]).filter(r => r.every(has));
  // 材料の段が決まったものから順に段を決める
  for (let changed = true; changed;) {
    changed = false;
    for (const [a, b, to] of list) {
      if (!tierOf.has(a) || !tierOf.has(b) || combine.has(pairKey(a, b))) continue;
      combine.set(pairKey(a, b), to);
      if (!tierOf.has(to)) {
        tierOf.set(to, Math.max(tierOf.get(a), tierOf.get(b)) + 1);
        hueOf.set(to, hueOf.get(tierOf.get(a) >= tierOf.get(b) ? a : b));
      }
      changed = true;
    }
  }
  for (const [k, to] of combine) {
    const [a, b] = k.split('|');
    for (const [me, other] of [[a, b], [b, a]]) {
      if (!partners.has(me)) partners.set(me, []);
      if (me !== other || !partners.get(me).some(q => q.with === other)) partners.get(me).push({ with: other, to });
    }
  }
  $('book').innerHTML = $('book2').innerHTML = bookHTML();
}

// 合体ずかん：できる字の段ごとに「字＋字→字」を並べる
function bookHTML() {
  const byTier = new Map();
  for (const [k, to] of combine) {
    const t = tierOf.get(to);
    if (!byTier.has(t)) byTier.set(t, []);
    const [a, b] = k.split('|');
    // 小さい段の字を先に書く（林＋木 より 木＋林 のほうが読みやすい）
    const [x, y] = tierOf.get(a) <= tierOf.get(b) ? [a, b] : [b, a];
    byTier.get(t).push(`<span class="glyph">${x}＋${y}→<b>${to}</b></span>`);
  }
  const base = BASE.map(([ch]) => ch).filter(ch => tierOf.get(ch) === 1).join(' ');
  return `<h3>落ちてくる字</h3><div class="row"><span class="glyph">${base}</span></div>` +
    [...byTier].sort((p, q) => p[0] - q[0]).map(([t, items]) =>
      `<h3>${t}段の字ができる<small>+${POINTS[Math.min(t, POINTS.length - 1)]}点・字が大きくなる</small></h3><div class="row">${items.join('')}</div>`).join('') +
    '<p class="note">ここに無い同じ字どうし（森＋森 など）がぶつかると、2つとも消えてボーナス点。</p>';
}

// ---------- 字の形 ----------
const shapes = new Map(); // 「字|段」→ 形
function shapeOf(ch, tier) {
  const key = `${ch}|${tier}`;
  if (shapes.has(key)) return shapes.get(key);
  const size = EM * GROW ** (tier - 1);
  const polys = glyphPolygons(font, ch, size);
  let shape = null;
  if (polys.length) {
    const box = centerPolygons(polys);
    // 細すぎる三角形は rapier2d が当たり判定を作れないので除く（tower と同じ）
    const tris = buildPrisms(polys, DEPTH).map(p => [p[0], p[1], p[3], p[4], p[6], p[7]]).filter(t => {
      const area2 = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]));
      const edge = Math.max(Math.hypot(t[2] - t[0], t[3] - t[1]), Math.hypot(t[4] - t[2], t[5] - t[3]), Math.hypot(t[0] - t[4], t[1] - t[5]));
      return area2 / edge > 0.003;
    });
    if (tris.length) shape = { ch, tier, polys, tris, pts: polys.flatMap(p => p.outer), w: box.x, h: box.y };
  }
  shapes.set(key, shape);
  return shape;
}

function colorOf(ch) {
  const t = tierOf.get(ch) || 1;
  return new THREE.Color().setHSL(hueOf.get(ch) ?? 0, 0.6 + 0.08 * t, 0.62 - 0.07 * t);
}

// 回転した輪郭の y の最大
function topY(p) {
  const t = p.body.translation(), a = p.body.rotation(), c = Math.cos(a), s = Math.sin(a);
  let hi = -Infinity;
  for (const q of p.shape.pts) { const y = q.x * s + q.y * c; if (y > hi) hi = y; }
  return t.y + hi;
}

// ---------- 状態 ----------
let world = null, events = null;
let pieces = [];            // { ch, shape, body, mesh, age, born, dead }
const byBody = new Map();   // 剛体の handle → 駒
let state = 'title';        // title | play | over
let score = 0, merges = 0;
let current = null, next = null;
let aimX = 0, dispX = 0, cooldown = 0, dangerT = 0, overTime = 0;
let paused = false;         // ずかんを見ている間は止める

function loadBest() { try { return +localStorage.getItem(BEST_KEY) || 0; } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* 保存できなくても遊べる */ } }

const randomCh = () => pool[Math.floor(Math.random() * pool.length)];

function createWorld() {
  const w = new RAPIER.World({ x: 0, y: -9.81 });
  w.timestep = DT;
  const box = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (hx, hy, x, y) => w.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(x, y).setFriction(FRICTION), box);
  add(BOX_W / 2 + WALL, WALL / 2, 0, -WALL / 2);
  // 壁は上に高めに伸ばしておく（合体で大きくなった字が外へ飛び出さないように）
  for (const s of [-1, 1]) add(WALL / 2, BOX_H + 4, s * (BOX_W + WALL) / 2, BOX_H / 2);
  return w;
}

function addPiece(ch, x, y, a = 0) {
  const shape = shapeOf(ch, tierOf.get(ch));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y).setRotation(a)
    .setAngularDamping(0.4).setLinearDamping(0.1)
    .setCcdEnabled(true));
  for (const t of shape.tris) {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(t));
    if (!desc) continue;
    try {
      world.createCollider(desc.setDensity(1).setFriction(FRICTION).setRestitution(0.1)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    } catch { /* 作れない形は無視 */ }
  }
  const mesh = buildMesh(shape.polys, DEPTH, colorOf(ch));
  scene.add(mesh);
  const p = { ch, shape, body, mesh, age: 0, born: 0, dead: false };
  pieces.push(p);
  byBody.set(body.handle, p);
  return p;
}

function removePiece(p) {
  p.dead = true;
  byBody.delete(p.body.handle);
  world.removeRigidBody(p.body);
  scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
}

function clearAll() {
  for (const p of pieces) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
  pieces = [];
  byBody.clear();
  world?.free();
  events?.free();
}

function newGame() {
  clearAll();
  world = createWorld();
  events = new RAPIER.EventQueue(true);
  score = 0; merges = 0; dangerT = 0; cooldown = 0; aimX = 0; dispX = 0;
  current = randomCh(); next = randomCh();
  setHover(current);
  state = 'play';
  paused = false;
  $('title').hidden = true; $('result').hidden = true; $('book-card').hidden = true;
  renderUI();
}

// ---------- 待っている字 ----------
const hover = new THREE.Group();
scene.add(hover);
let hoverShape = null;
function setHover(ch) {
  for (const m of hover.children) { m.geometry.dispose(); m.material.dispose(); }
  hover.clear();
  hoverShape = ch ? shapeOf(ch, tierOf.get(ch)) : null;
  if (hoverShape) hover.add(buildMesh(hoverShape.polys, DEPTH, colorOf(ch)));
}
const hoverY = () => BOX_H + 0.35 + hoverShape.h / 2;
const clampX = (x, shape) => {
  const m = BOX_W / 2 - shape.w / 2 - 0.02;
  return Math.max(-m, Math.min(m, x));
};

function drop() {
  if (state !== 'play' || paused || cooldown > 0 || !hoverShape) return;
  aimX = clampX(aimX, hoverShape);
  addPiece(current, aimX, hoverY());
  current = next; next = randomCh();
  setHover(null);
  cooldown = DROP_COOLDOWN;
  renderUI();
}

// ---------- 合体 ----------
function merge(p, q) {
  const key = pairKey(p.ch, q.ch);
  const to = combine.get(key) ?? (p.ch === q.ch ? '' : null); // 表に無い同じ字どうしは消える
  if (to === null) return;
  const mp = p.body.mass(), mq = q.body.mass();
  const tp = p.body.translation(), tq = q.body.translation(), vp = p.body.linvel(), vq = q.body.linvel();
  const x = (tp.x * mp + tq.x * mq) / (mp + mq), y = (tp.y * mp + tq.y * mq) / (mp + mq);
  const vx = (vp.x * mp + vq.x * mq) / (mp + mq), vy = (vp.y * mp + vq.y * mq) / (mp + mq);
  removePiece(p); removePiece(q);
  merges++;
  let gain, label;
  if (to) {
    const tier = tierOf.get(to);
    gain = POINTS[Math.min(tier, POINTS.length - 1)];
    const shape = shapeOf(to, tier);
    // 大きくなった字が床や壁にめり込まないように置く
    const n = addPiece(to, clampX(x, shape), Math.max(y, shape.h / 2 + 0.02));
    n.body.setLinvel({ x: vx * 0.5, y: Math.max(vy, 0) * 0.5 }, true);
    n.born = 0.0001;
    label = `${to} +${gain}`;
  } else {
    const tier = tierOf.get(p.ch);
    gain = POINTS[Math.min(tier + 1, POINTS.length - 1)] * 2;
    label = `${p.ch}${p.ch} 消えた！ +${gain}`;
  }
  score += gain;
  popText(x, y, label);
  renderUI();
}

function popText(x, y, text) {
  const v = new THREE.Vector3(x, y, 0).project(camera);
  const el = document.createElement('div');
  el.className = 'pop glyph';
  el.textContent = text;
  el.style.left = `${(v.x + 1) / 2 * innerWidth}px`;
  el.style.top = `${(1 - v.y) / 2 * innerHeight}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1000);
}

// ---------- 物理 ----------
function physicsStep() {
  world.step(events);
  const hits = [];
  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const p = byBody.get(world.getCollider(h1)?.parent()?.handle);
    const q = byBody.get(world.getCollider(h2)?.parent()?.handle);
    if (p && q && p !== q) hits.push([p, q]);
  });
  for (const [p, q] of hits) if (!p.dead && !q.dead && state === 'play') merge(p, q);
  // 万一箱の外へ抜けた字は片付ける
  for (const p of pieces) if (!p.dead && p.body.translation().y < -5) removePiece(p);
  pieces = pieces.filter(p => !p.dead);
}

function checkOver(dt) {
  let over = false;
  for (const p of pieces) {
    p.age += dt;
    if (p.age > GRACE && topY(p) > BOX_H) over = true;
  }
  dangerT = over ? dangerT + dt : Math.max(0, dangerT - dt * 2);
  if (dangerT > OVER_TIME) gameOver();
}

function gameOver() {
  state = 'over';
  overTime = 0;
  setHover(null);
  renderUI();
}

function showResult() {
  const best = loadBest();
  const isBest = score > best;
  if (isBest) saveBest(score);
  const big = pieces.reduce((m, p) => (!m || tierOf.get(p.ch) > tierOf.get(m.ch) ? p : m), null);
  $('result-sub').innerHTML = `スコア <b>${score}</b>（合体 ${merges} 回）` +
    (big ? `<br>いちばん大きい字：<span class="glyph">「${big.ch}」</span>` : '') +
    (isBest ? '<br><b>ハイスコア更新！</b>' : `<br>ハイスコア ${best}`);
  $('result').hidden = false;
  renderUI();
}

// ---------- 画面表示 ----------
function renderUI() {
  $('score').textContent = score;
  $('best').textContent = Math.max(loadBest(), score);
  $('next').textContent = state === 'play' ? next : '';
  $('book-btn').hidden = state !== 'play';
  renderHint();
}

// いま落とす字が、何とくっつくかを出す。箱の中にある相手は目立たせる
function renderHint() {
  const el = $('hint');
  el.classList.toggle('off', state !== 'play' || !current);
  if (state !== 'play' || !current) return;
  const inBox = new Set(pieces.map(p => p.ch));
  const list = partners.get(current) ?? [];
  el.innerHTML = `<span class="me glyph">${current}</span> とくっつく字：` + (list.length
    ? list.map(q => `<span class="chip glyph${inBox.has(q.with) ? ' here' : ''}">＋${q.with}→<b>${q.to}</b></span>`).join('')
    : `<span class="chip glyph">＋${current}→<b>消える</b></span>`);
}

function openBook(open) {
  if (state !== 'play') open = false;
  paused = open;
  pressing = false;
  held.clear();
  $('book-card').hidden = !open;
}

// ---------- 操作 ----------
// 画面のどこを触っても、その横位置に字が来る。指をはなすと落ちる
const toWorldX = clientX => (clientX / innerWidth - 0.5) * viewW;
let pressing = false;
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || paused) return;
  pressing = true;
  aimX = toWorldX(e.clientX);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (state !== 'play' || (!pressing && e.pointerType !== 'mouse')) return;
  aimX = toWorldX(e.clientX);
});
canvas.addEventListener('pointerup', () => {
  if (pressing) drop();
  pressing = false;
});
canvas.addEventListener('pointercancel', () => { pressing = false; });

const held = new Set();
addEventListener('keydown', e => {
  if (paused) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(false); }
    return;
  }
  if (state !== 'play') {
    if ((e.key === 'Enter' || e.key === ' ') && !$('start').disabled && (state === 'title' || !$('result').hidden)) { e.preventDefault(); newGame(); }
    return;
  }
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'ArrowRight' || k === 'd') held.add(k);
  else if ((k === ' ' || k === 'ArrowDown' || k === 'Enter') && !e.repeat) drop();
  else return;
  e.preventDefault();
});
addEventListener('keyup', e => held.delete(e.key));

$('start').addEventListener('click', newGame);
$('retry').addEventListener('click', newGame);
$('book-btn').addEventListener('click', () => openBook(true));
$('book-close').addEventListener('click', () => openBook(false));

// ---------- ループ ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (world && state !== 'title' && !paused) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n++ < 4) { physicsStep(); acc -= DT; }
    if (n >= 4) acc = 0;  // 重くて追いつかないときは時間を捨てる
  }
  if (state === 'play' && !paused) {
    checkOver(dt);
    const dir = (held.has('ArrowRight') || held.has('d') ? 1 : 0) - (held.has('ArrowLeft') || held.has('a') ? 1 : 0);
    aimX += dir * 4 * dt;
    if (cooldown > 0) {
      cooldown -= dt;
      if (cooldown <= 0) setHover(current);
    }
  }
  if (state === 'over' && $('result').hidden) {
    overTime += dt;
    if (overTime > 1.2) showResult();
  }

  // 待っている字とガイド線
  if (hoverShape) {
    aimX = clampX(aimX, hoverShape);
    dispX += (aimX - dispX) * (1 - Math.exp(-dt * 20));
    hover.position.set(dispX, hoverY(), 0);
    guide.visible = true;
    const gTop = hoverY() - hoverShape.h / 2;
    guide.scale.y = gTop;
    guide.position.set(dispX, gTop / 2, -0.6);
  } else {
    guide.visible = false;
  }
  // あふれそうなときは線を点滅させる
  lineMat.opacity = dangerT > 0 ? 0.5 + 0.5 * Math.sin(now / 80) : 0.35;

  for (const p of pieces) {
    const t = p.body.translation();
    p.mesh.position.set(t.x, t.y, 0);
    p.mesh.rotation.z = p.body.rotation();
    if (p.born > 0) { // 合体してできた字はぽんと膨らむ
      p.born += dt;
      const s = p.born > 0.25 ? 1 : 0.6 + 0.4 * Math.sin(p.born / 0.25 * Math.PI / 2) + 0.12 * Math.sin(p.born / 0.25 * Math.PI);
      p.mesh.scale.setScalar(s);
      if (p.born > 0.25) p.born = 0;
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 動作確認用：今の状態を返す
window.gattaiState = () => ({ state, score, merges, current, next, pieces: pieces.map(p => p.ch).join('') });

// ---------- フォント読み込み ----------
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf);
  try { // 「つぎ」の表示も同じフォントにする
    const face = new FontFace('MojiGattai', buf.slice(0));
    document.fonts.add(await face.load());
  } catch { /* 表示用なので失敗してもよい */ }
  buildTable();
  msg('');
  $('start').disabled = false;
  $('start').textContent = 'スタート';
  renderUI();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
