// 文字とばし：1文字を飛ばして、止まるまでを物理で計算する
// 文字ごとに専用の物理ワールドを作る（毎回まっさらな状態から始めるので、同じ入力なら必ず同じ結果になる）
import { glyphPolygons, shapeMetrics, centerPolygons, buildPrisms } from '../../glyph.js';

export const GLYPH_SIZE = 1.6;   // 1em の大きさ（m）
export const DEPTH = 0.4;        // 文字の厚み（m）。当たり判定は z を固定するので見た目と質量にだけ効く
export const DT = 1 / 60;        // 固定の時間刻み
export const GROUND_LEN = 3000;  // 地面の長さ（m）。これより先へは飛ばない
export const POWER_MAX = 100;    // パワーは 0〜100（%）の整数
export const ANGLE_MIN = 5, ANGLE_MAX = 80; // 角度は整数（度）

const DENSITY = 1.0;
const SPEED_MAX = 24;      // 基準の重さの字をパワー100で撃ったときの初速（m/s）
const MASS_REF = 0.35;     // 基準の重さ（kg）。初速 ∝ 基準/重さ … 同じ勢い（運動量）で撃ち出すので重い字は飛ばない
const BOOST_MAX = 1.25, BOOST_MIN = 0.45; // 軽すぎ・重すぎの字の初速の上限と下限（倍率）
const FRICTION = 0.55;
const RESTITUTION = 0.35;  // よく跳ねる
const LIN_DAMP = 0.02;     // 空気抵抗（ごく弱い）
const ANG_DAMP = 0.12;     // 転がり抵抗のかわり。0 だと真円は永遠に転がる
const DRAG = 0.004;         // 形による空気抵抗：進む向きに見た幅 ÷ 重さ に比例（平たく軽い字ほど効く）
const STOP_SPEED = 0.03;   // これより遅い（m/s）
const STOP_SPIN = 0.05;    // これより回転が遅い（rad/s）状態が
const STOP_SEC = 0.6;      // この秒数続いたら止まったとみなす
const TIME_LIMIT = 45;     // これ以上かかったらその場の位置で打ち切る（揺れ続ける字の保険）

// 三角関数はブラウザごとに末尾の桁が違いうるので、物理に渡す向きは四則演算だけで作る（0〜90°で十分な精度）
function sinDeg(deg) {
  const x = deg * 3.141592653589793 / 180;
  let term = x, sum = x;
  for (let n = 1; n < 12; n++) { term *= -x * x / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
function dirOf(deg) {
  return { c: sinDeg(90 - deg), s: sinDeg(deg) };
}

// 三角形の集まりから面積・重心・慣性半径を計算（2D）
function inertia2D(prisms) {
  let A = 0, cx = 0, cy = 0, J0 = 0;
  for (const p of prisms) {
    const ax = p[0], ay = p[1], bx = p[3], by = p[4], qx = p[6], qy = p[7];
    const a = Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2;
    A += a;
    cx += a * (ax + bx + qx) / 3;
    cy += a * (ay + by + qy) / 3;
    J0 += a / 6 * (ax * ax + ay * ay + bx * bx + by * by + qx * qx + qy * qy + ax * bx + ay * by + bx * qx + by * qy + qx * ax + qy * ay);
  }
  cx /= A; cy /= A;
  return { k: Math.sqrt((J0 - A * (cx * cx + cy * cy)) / A) };
}

// 形の下ごしらえ（物理ワールドは作らない）。文字ごとに1回でよい
export function makeShape(font, ch) {
  const polys = glyphPolygons(font, ch, GLYPH_SIZE);
  if (!polys.length) return null;
  const size = centerPolygons(polys);
  const prisms = buildPrisms(polys, DEPTH);
  if (!prisms.length) return null;
  const m = shapeMetrics(polys);
  const area = prisms.reduce((s, p) => s + Math.abs((p[3] - p[0]) * (p[7] - p[1]) - (p[6] - p[0]) * (p[4] - p[1])) / 2, 0);
  const mass = area * DEPTH * DENSITY;
  const r = Math.max(size.x, size.y) / 2;
  let boost = Math.min(BOOST_MAX, Math.max(BOOST_MIN, MASS_REF / mass));
  boost = Math.round(boost * 1000) / 1000; // 環境差を丸めで消す
  return {
    ch, polys, prisms, size, mass, boost,
    stats: { mass, roundness: m.roundness, spin: inertia2D(prisms).k / r, boost },
  };
}

// 発射：新しいワールドを作り、地面に置いた文字に初速を与える
export function createShot(RAPIER, shape, power, angle) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // 地面：x = -20 から GROUND_LEN まで。上面が y = 0
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(GROUND_LEN / 2 - 10, -1, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(GROUND_LEN / 2 + 10, 1, 2).setFriction(FRICTION).setRestitution(RESTITUTION), g);

  const y0 = shape.size.y / 2 + 0.02;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, y0, 0)
    // 画面に垂直な軸まわりだけ回る。奥行き方向の移動も止めたいが、移動と回転を両方ロックすると
    // Rapier（0.21）では摩擦が効かなくなるので回転だけロックする（力はすべて xy 平面内なので z は 0 のまま）
    .enabledRotations(false, false, true)
    .setLinearDamping(LIN_DAMP)
    .setAngularDamping(ANG_DAMP)
    .setCcdEnabled(true));
  for (const pts of shape.prisms) {
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) continue;
    world.createCollider(desc.setDensity(DENSITY).setFriction(FRICTION).setRestitution(RESTITUTION), body);
  }
  const { c, s } = dirOf(angle);
  const v = SPEED_MAX * shape.boost * power / POWER_MAX;
  body.setLinvel({ x: v * c, y: v * s, z: 0 }, true);
  // 少しだけ後ろ回転をかける（蹴り上げた感じ）。字の大きさによらず同じ角速度
  body.setAngvel({ x: 0, y: 0, z: v * 0.15 }, true);

  return {
    shape, power, angle, world, body, startX: 0,
    elapsed: 0, still: 0, steps: 0, done: false, landed: false,
    distance: 0, landX: 0, maxHeight: 0, bounces: 0, airborne: true,
  };
}

// 形による空気抵抗：進む向きに直角な幅を、回転した輪郭の点から求める（四則演算だけ）
function dragWidth(shot, vx, vy, sp) {
  const q = shot.body.rotation();
  const cz = q.w * q.w - q.z * q.z, sz = 2 * q.w * q.z; // 回転角の cos, sin
  const nx = -vy / sp, ny = vx / sp;                   // 進む向きに直角な単位ベクトル
  let lo = Infinity, hi = -Infinity;
  for (const p of shot.shape.prisms) {
    for (let i = 0; i < 9; i += 3) {
      const x = p[i] * cz - p[i + 1] * sz, y = p[i] * sz + p[i + 1] * cz;
      const d = x * nx + y * ny;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  return hi - lo;
}

// 1ステップ進め、止まったかを判定する
export function stepShot(shot) {
  if (shot.done) return;
  const b = shot.body;
  const v0 = b.linvel();
  const sp2 = v0.x * v0.x + v0.y * v0.y;
  if (shot.airborne && sp2 > 1) {
    // 空気抵抗 F = DRAG * 幅 * v²（向きは速度と逆）。重い字ほど効きにくい
    const sp = Math.sqrt(sp2);
    const k = DRAG * dragWidth(shot, v0.x, v0.y, sp) * sp * DT;
    b.applyImpulse({ x: -k * v0.x, y: -k * v0.y, z: 0 }, true);
  }
  shot.world.step();
  shot.elapsed += DT;
  shot.steps++;

  const t = b.translation(), v = b.linvel(), w = b.angvel();
  shot.distance = t.x - shot.startX;
  const bottom = t.y - shot.shape.size.y / 2;
  if (bottom > shot.maxHeight) shot.maxHeight = bottom;
  // 地面に触れているか（文字の一番下が地面近く）。最初の接地で landed
  const touching = lowestPoint(shot) < 0.03;
  if (touching && shot.steps > 3) {   // 発射直後はまだ地面に触れているので数えない
    if (!shot.landed) { shot.landed = true; shot.landX = shot.distance; }
    if (shot.airborne) shot.bounces++;
  }
  shot.airborne = !touching;

  const slow = v.x * v.x + v.y * v.y < STOP_SPEED * STOP_SPEED && w.z * w.z < STOP_SPIN * STOP_SPIN;
  shot.still = slow && shot.landed ? shot.still + DT : 0;
  if (shot.still >= STOP_SEC || shot.elapsed >= TIME_LIMIT || t.x > GROUND_LEN - 20 || t.y < -5) shot.done = true;
}

// 文字の一番低い点の高さ（回転込み）
function lowestPoint(shot) {
  const t = shot.body.translation(), q = shot.body.rotation();
  const cz = q.w * q.w - q.z * q.z, sz = 2 * q.w * q.z;
  let lo = Infinity;
  for (const p of shot.shape.prisms) {
    for (let i = 0; i < 9; i += 3) {
      const y = p[i] * sz + p[i + 1] * cz;
      if (y < lo) lo = y;
    }
  }
  return t.y + lo;
}

// 記録用の距離（cm 単位で丸める）
export function shotDistance(shot) {
  return Math.round(shot.distance * 100) / 100;
}

export function disposeShot(shot) {
  shot.world?.free();
  shot.world = null;
}

// 描画せずに最後まで計算する
export function simulateShot(RAPIER, shape, power, angle) {
  const shot = createShot(RAPIER, shape, power, angle);
  while (!shot.done) stepShot(shot);
  const out = { distance: shotDistance(shot), landX: +shot.landX.toFixed(2), time: +shot.elapsed.toFixed(2), maxHeight: +shot.maxHeight.toFixed(2), bounces: shot.bounces };
  disposeShot(shot);
  return out;
}
