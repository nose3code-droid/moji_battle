// 文字ボウリングの物理。レーン・ピン・ボール（文字）を1つの物理ワールドに置く
// 1投ごとに専用のワールドを作り直す（同じ文字・同じ残りピン・同じ投げ方なら必ず同じ結果になる）
// 座標：x が右、y が上、z が手前。ファウルライン z=0 から奥（-z）へ投げる
import { glyphPolygons, shapeMetrics, centerPolygons, buildPrisms } from '../../glyph.js';

export const DT = 1 / 120;          // 固定の時間刻み
export const LANE_W = 2.1;          // レーンの幅（m）。奥の列の端のピン（幅 PIN_W_MAX）がはみ出さない幅
export const GUTTER_W = 0.42;       // ガターの幅
export const GUTTER_D = 0.16;       // ガターの深さ（レーン面 y=0 からの下がり）
export const LANE_LEN = 18;         // ファウルラインから1番ピンまで（m）
export const PIN_GAP = 0.5;         // となりのピンとの間隔
export const ROW_GAP = PIN_GAP * 0.8660254037844386; // 列の間隔（正三角形に並べる）
export const OIL_END = LANE_LEN - 0.6;               // ここまでオイルが塗ってあって滑る
export const DECK_END = LANE_LEN + 3 * ROW_GAP + 0.6; // ピンデッキの奥の端
export const PIT_LEN = 2.2;         // デッキの奥のピット（落ちたピンとボールを受ける）
export const PIT_Y = -0.6;
export const APPROACH = 4;          // ファウルラインより手前の助走路
export const WALL_H = 0.25;         // ガターの外側の壁の高さ
export const KICK_H = 1.0;          // ピンのまわりの壁（キックバック）の高さ
export const BACK_H = 3.0;          // 奥の壁（跳ねたボールが飛び出さない高さ）

export const BALL_EM = 0.55;        // ボールの文字の 1em（m）。字の大きさの違いはそのまま残す
export const BALL_DEPTH = 0.3;      // ボールの厚み
export const PIN_H = 0.7;           // ピンの高さ（字ごとに揃える）
export const PIN_W_MAX = 0.4;       // ピンの幅の上限（となりと重ならないように）
export const PIN_DEPTH = 0.14;      // ピンの厚み

// 投げ方はすべて整数で持つ（同じ投げ方を確実に再現できるように）
export const POS_MAX = 18, POS_STEP = 0.05;   // 立ち位置：-18〜18（1目盛り 5cm）
export const AIM_MAX = 80;                    // 向き：-80〜80（0.1° 単位、右が +）
export const POWER_MIN = 10, POWER_MAX = 100; // 強さ（%）
const SPEED_MIN = 4, SPEED_MAX = 12;          // 強さ 0%・100% のときの初速（m/s）

const BALL_DENSITY = 150;   // 「あ」で 4kg くらい。画数の多い字ほど重い
const PIN_MASS = 1.0;       // ピンはどの字でも同じ重さ
// 摩擦（ぶつかった2つの平均が使われる）。手前はオイルで滑り、オイルが切れるとボールの摩擦を上げて転がりやすくする
const LANE_F = 0.04, BALL_OIL_F = 0.06, BALL_DRY_F = 0.3, PIN_F = 0.6;
const TILT_MAX = 6;                // 角ばった字ほど投げた瞬間に横へ傾く（度）。丸い字はまっすぐ進む
const ROLL = 0.75;                 // 投げた瞬間の回転（滑らずに転がる回転に対する割合）。残りは滑りながら転がり始める
const DOWN_COS = 0.9;       // ピンの傾きが約 26° を越えたら倒れたとみなす
const STOP_SEC = 1.0;       // ボールがこの秒数ほぼ止まっていたら終わり
const SETTLE_SEC = 0.5;     // ピンがこの秒数静かなら終わり
const SETTLE_MAX = 4;       // ボールが通り過ぎてからこれ以上は待たない（揺れ続けるピンの保険）
const TIME_LIMIT = 25;
// 当たったピンは奥へはじけ飛ぶ（ランダムに散らばって周りのピンを巻き込む）。乱数は投げ方から決めるので毎回同じ
const KICK_SPEED = 0.6;     // これより速く動き出したら「当たった」とみなす（m/s）
const KICK_FULL = 3;        // この速さ以上で当たると勢いを満額足す。かすっただけのピンは少しだけ飛ぶ
const KICK = { back: [2, 4], side: 1.8, up: [0.4, 2], spin: 10 }; // 奥へ・左右・上へ（m/s）と回転（rad/s）

// ピンの位置。1番が手前の頂点、7〜10番が奥の列（7番が左）
export const PIN_SPOTS = [
  [0, 0], [-0.5, 1], [0.5, 1], [-1, 2], [0, 2], [1, 2], [-1.5, 3], [-0.5, 3], [0.5, 3], [1.5, 3],
].map(([c, r]) => ({ x: c * PIN_GAP, z: -(LANE_LEN + r * ROW_GAP) }));

// レーンの箱。物理と見た目の両方で使う（中心 x,y,z と半分の大きさ hx,hy,hz）
function box(kind, x0, x1, y0, y1, z0, z1) {
  return { kind, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hy: Math.abs(y1 - y0) / 2, hz: Math.abs(z1 - z0) / 2 };
}
const HW = LANE_W / 2, OUT = HW + GUTTER_W;
const PIT_END = DECK_END + PIT_LEN;
// ボールが転がる面は継ぎ目のない1枚の箱にする（箱の継ぎ目でボールが跳ねるため）
export const LANE_BOXES = [
  box('lane', -HW, HW, -0.3, 0, APPROACH, -DECK_END),
  box('apron', -OUT - 0.1, -HW, -0.3, 0, APPROACH, 0),
  box('apron', HW, OUT + 0.1, -0.3, 0, APPROACH, 0),
  box('gutter', -OUT, -HW, -0.3, -GUTTER_D, 0, -DECK_END),
  box('gutter', HW, OUT, -0.3, -GUTTER_D, 0, -DECK_END),
  box('wall', -OUT - 0.1, -OUT, -0.3, WALL_H, 0, -OIL_END),
  box('wall', OUT, OUT + 0.1, -0.3, WALL_H, 0, -OIL_END),
  box('kick', -OUT - 0.1, -OUT, PIT_Y, KICK_H, -OIL_END, -PIT_END),
  box('kick', OUT, OUT + 0.1, PIT_Y, KICK_H, -OIL_END, -PIT_END),
  box('pit', -OUT, OUT, PIT_Y - 0.3, PIT_Y, -DECK_END, -PIT_END),
  box('back', -OUT - 0.1, OUT + 0.1, PIT_Y, BACK_H, -PIT_END, -PIT_END - 0.1),
];
const FRICTION = { lane: LANE_F, apron: 0.3, gutter: 0.2, wall: 0.2, kick: 0.2, pit: 0.6, back: 0.3 };
const RESTITUTION = { kick: 0.3, back: 0.05, pit: 0.05 };


// 三角関数はブラウザごとに末尾の桁が違いうるので、物理に渡す向きは四則演算だけで作る（±90° で十分な精度）
function sinDeg(deg) {
  const x = deg * 3.141592653589793 / 180;
  let term = x, sum = x;
  for (let n = 1; n < 12; n++) { term *= -x * x / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
const cosDeg = deg => sinDeg(90 - deg);

// 細すぎる三角形（幅 2mm 未満）を当たり判定から外す。こうした三角柱は Rapier が質量 0 なのに
// とても大きな慣性モーメントを出してしまい、空中で回転が勝手に速くなってボールが跳ね回る
const SLIVER = 0.002;
function solidPrisms(polys, depth) {
  return buildPrisms(polys, depth).filter(p => {
    const area2 = Math.abs((p[3] - p[0]) * (p[7] - p[1]) - (p[6] - p[0]) * (p[4] - p[1]));
    const sq = (dx, dy) => dx * dx + dy * dy;
    const e2 = Math.max(sq(p[3] - p[0], p[4] - p[1]), sq(p[6] - p[3], p[7] - p[4]), sq(p[0] - p[6], p[1] - p[7]));
    return area2 / Math.sqrt(e2) > SLIVER;   // 最も長い辺に対する高さ（hypot は環境差が出うるので使わない）
  });
}

function prismArea(prisms) {
  return prisms.reduce((s, p) => s + Math.abs((p[3] - p[0]) * (p[7] - p[1]) - (p[6] - p[0]) * (p[4] - p[1])) / 2, 0);
}

// ボールの形の下ごしらえ（物理ワールドは作らない）。文字ごとに1回でよい
export function makeBall(font, ch) {
  const polys = glyphPolygons(font, ch, BALL_EM);
  if (!polys.length) return null;
  const size = centerPolygons(polys);
  const prisms = solidPrisms(polys, BALL_DEPTH);
  if (!prisms.length) return null;
  const m = shapeMetrics(polys);
  const mass = prismArea(prisms) * BALL_DEPTH * BALL_DENSITY;
  const flat = Math.min(size.x, size.y) / Math.max(size.x, size.y);
  // 角ばり：丸さ 0.97 以上（〇など）で 0、正方形（0.785）で 1。丸い字ほど傾かずまっすぐ進む
  const angular = Math.max(0, Math.min(1, (0.97 - m.roundness) / (0.97 - 0.785)));
  // 傾く向き（左右）は字の形で決める：字の重心が左右どちらに寄っているか
  let ax = 0, ad = 0;
  for (const p of prisms) {
    const a = Math.abs((p[3] - p[0]) * (p[7] - p[1]) - (p[6] - p[0]) * (p[4] - p[1]));
    ax += a * (p[0] + p[3] + p[6]); ad += a * 3;
  }
  const lean = ax / ad >= 0 ? 1 : -1;
  return {
    ch, polys, prisms, size, mass, flat, angular,
    roundness: m.roundness, tilt: +(lean * angular * TILT_MAX).toFixed(2),
    radius: Math.max(size.x, size.y) / 2,
  };
}

// ピンの形。高さを PIN_H に揃える（幅が広い字は幅で抑える）
// 「人」のように足先がとがった字もあるので、平らな床に一度立たせて落ち着いた姿勢を「立っている姿勢」にする
// kick：当たったときのはじけ飛びやすさ（字によって倒れやすさが大きく違うので、ステージごとに揃える）
export function makePin(RAPIER, font, ch, kick = 1) {
  const probe = glyphPolygons(font, ch, 1);
  if (!probe.length) return null;
  const s = centerPolygons(probe);
  const em = Math.min(PIN_H / s.y, PIN_W_MAX / s.x);
  const polys = glyphPolygons(font, ch, em);
  const size = centerPolygons(polys);
  const prisms = solidPrisms(polys, PIN_DEPTH);
  if (!prisms.length) return null;
  const pin = { ch, polys, prisms, size, density: PIN_MASS / (prismArea(prisms) * PIN_DEPTH), rest: null, kick };

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.3, 2).setTranslation(0, -0.3, 0).setFriction(LANE_F));
  const body = addPinBody(RAPIER, world, pin, 0, 0);
  for (let i = 0; i < 240; i++) world.step();
  const t = body.translation(), q = body.rotation();
  pin.rest = { y: t.y, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  world.free();
  if (dotUp(pin.rest.q, { x: 0, y: 0, z: 0, w: 1 }) < DOWN_COS) return null; // 自分の重さで倒れる字はピンにできない
  return pin;
}

function addPinBody(RAPIER, world, pin, x, z) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true);
  if (pin.rest) desc.setTranslation(x, pin.rest.y, z).setRotation(pin.rest.q);
  else desc.setTranslation(x, pin.size.y / 2 + 0.001, z);
  const body = world.createRigidBody(desc);
  for (const pts of pin.prisms) {
    const c = RAPIER.ColliderDesc.convexHull(pts);
    if (c) world.createCollider(c.setDensity(pin.density).setFriction(PIN_F).setRestitution(0.4), body);
  }
  return body;
}

// 2つの姿勢で、ピンの上向きの軸どうしがなす角の cos
function upOf(q) {
  return { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) };
}
function dotUp(a, b) {
  const u = upOf(a), v = upOf(b);
  return u.x * v.x + u.y * v.y + u.z * v.z;
}

export function throwSpeed(power) {
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * power / 100;
}

// 1投ぶんのワールドを作る。standing は10本それぞれが立っているか、shot = { pos, aim, power }（整数）
export function createThrow(RAPIER, ball, pin, standing, shot) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const b of LANE_BOXES) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z)
      .setFriction(FRICTION[b.kind]).setRestitution(RESTITUTION[b.kind] || 0), ground);
  }

  const pins = PIN_SPOTS.map((s, i) => (standing[i] ? addPinBody(RAPIER, world, pin, s.x, s.z) : null));

  // ボール：字の面を進む向きにそろえて立て（車輪のように）、転がる回転をつけて送り出す
  const p = shotPose(ball, shot);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(p.x, p.y, p.z)
    .setRotation(p.q)
    .setLinvel(p.v.x, p.v.y, p.v.z)
    .setAngvel(p.w)
    .setLinearDamping(0.02).setAngularDamping(0.05)
    .setCcdEnabled(true));
  const ballColliders = [];
  for (const pts of ball.prisms) {
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (desc) ballColliders.push(world.createCollider(desc.setDensity(BALL_DENSITY).setFriction(BALL_OIL_F).setRestitution(0), body));
  }

  return {
    world, ball: body, ballColliders, dry: false, pins, pin, standing: standing.slice(), shot,
    t: 0, steps: 0, still: 0, quiet: 0, ballDone: false, ballDoneAt: 0, done: false,
    gutter: false, reachedPins: false,
    kicked: pins.map(() => false), rand: seeded(ball.ch, pin.ch, standing, shot),
  };
}

// 投げる瞬間のボールの位置・向き・速度（見た目の構えにも使う）
export function shotPose(ball, shot) {
  const deg = shot.aim / 10;
  const s = sinDeg(deg), c = cosDeg(deg);          // 進む向き d = (s, 0, -c)
  const v = throwSpeed(shot.power), w = v / ball.radius * ROLL;
  // y 軸まわりに (90° - deg) 回して字の x 軸を進む向きへ、さらに進む向きのまわりに tilt だけ傾ける
  const yaw = { x: 0, y: sinDeg((90 - deg) / 2), z: 0, w: cosDeg((90 - deg) / 2) };
  const ht = ball.tilt / 2, ts = sinDeg(ht), tc = cosDeg(ht);
  const roll = { x: s * ts, y: 0, z: -c * ts, w: tc };   // 回転軸 d、角度 tilt（ワールド座標）
  return {
    x: shot.pos * POS_STEP, y: ball.size.y / 2 + 0.02, z: 0,
    q: qmul(roll, yaw),
    v: { x: v * s, y: 0, z: -v * c },
    w: { x: -c * w, y: 0, z: -s * w },              // 滑らずに転がる回転（上向き × 進む向き）
  };
}

// 再現できる乱数（mulberry32）。種は文字・ピン・残りピン・投げ方から作る。整数演算だけなので環境差が出ない
function seeded(ch, pinCh, standing, shot) {
  let h = 2166136261;
  const mix = n => { h = Math.imul(h ^ n, 16777619) >>> 0; };
  for (const c of ch + pinCh) mix(c.codePointAt(0));
  standing.forEach((v, i) => mix(v ? i + 1 : 0));
  mix(shot.pos + 1000); mix(shot.aim + 1000); mix(shot.power);
  return () => {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 動き出したピンに一度だけ、奥へ向かう勢いを足す（左右・上向き・回転はランダム）
function kickPins(sim) {
  sim.pins.forEach((b, i) => {
    if (!b || sim.kicked[i]) return;
    const v = b.linvel();
    const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
    if (v2 < KICK_SPEED * KICK_SPEED) return;
    sim.kicked[i] = true;
    const f = Math.min(1, Math.sqrt(v2) / KICK_FULL) * sim.pin.kick;   // 強く当たったピンほど大きく飛ぶ
    const r = sim.rand, lerp = ([a, c], u) => (a + (c - a) * u) * f;
    const back = lerp(KICK.back, r()), side = (r() * 2 - 1) * KICK.side * f, up = lerp(KICK.up, r());
    b.setLinvel({ x: v.x + side, y: v.y + up, z: v.z - back }, true);
    const w = b.angvel();
    const sp = KICK.spin * f;
    b.setAngvel({ x: w.x - (0.5 + r()) * sp, y: w.y + (r() * 2 - 1) * sp, z: w.z + (r() * 2 - 1) * sp }, true);
  });
}

function qmul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

// ピンが倒れたか：傾いた・デッキから落ちた・ガターへ出た
export function pinDown(sim, i) {
  const b = sim.pins[i];
  if (!b) return true;
  const t = b.translation();
  if (dotUp(b.rotation(), sim.pin.rest.q) < DOWN_COS) return true;
  return Math.abs(t.x) > HW || t.z < -DECK_END || t.y < sim.pin.rest.y - 0.15;
}

// 1ステップ進め、投球が終わったかを判定する
export function stepThrow(sim) {
  if (sim.done) return;
  sim.world.step();
  sim.t += DT;
  kickPins(sim);
  sim.steps++;
  const t = sim.ball.translation(), v = sim.ball.linvel(), w = sim.ball.angvel();
  if (!sim.dry && t.z < -OIL_END) { sim.dry = true; for (const c of sim.ballColliders) c.setFriction(BALL_DRY_F); }
  if (!sim.reachedPins && t.z < -LANE_LEN + 0.5) sim.reachedPins = true;
  if (!sim.reachedPins && Math.abs(t.x) > HW + 0.05 && t.y < 0) sim.gutter = true;

  if (!sim.ballDone) {
    const slow = v.x * v.x + v.y * v.y + v.z * v.z < 0.03 * 0.03 && w.x * w.x + w.y * w.y + w.z * w.z < 0.3 * 0.3;
    sim.still = slow ? sim.still + DT : 0;
    if (t.z < -DECK_END - 0.2 || t.y < PIT_Y - 1 || t.z < -PIT_END || sim.still > STOP_SEC) { sim.ballDone = true; sim.ballDoneAt = sim.t; }
  }
  if (sim.ballDone) {
    let calm = true;
    for (const b of sim.pins) {
      if (!b || b.isSleeping()) continue;
      const pv = b.linvel(), pw = b.angvel();
      if (pv.x * pv.x + pv.y * pv.y + pv.z * pv.z > 0.03 * 0.03 || pw.x * pw.x + pw.y * pw.y + pw.z * pw.z > 0.15 * 0.15) { calm = false; break; }
    }
    sim.quiet = calm ? sim.quiet + DT : 0;
    if (sim.quiet > SETTLE_SEC || sim.t - sim.ballDoneAt > SETTLE_MAX) sim.done = true;
  }
  if (sim.t > TIME_LIMIT) sim.done = true;
}

// 結果：この投球で倒れたピンの番号（0〜9）の一覧
export function knockedPins(sim) {
  const out = [];
  for (let i = 0; i < 10; i++) if (sim.standing[i] && pinDown(sim, i)) out.push(i);
  return out;
}

export function freeThrow(sim) {
  sim?.world.free();
}
