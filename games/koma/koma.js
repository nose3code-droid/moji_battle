// 文字ゴマ：1文字の形 → コマの性能、すり鉢スタジアムの物理（上から見た2D、Rapier 2D）
// 重力の代わりに「中心へ引く力」、軸先の摩擦の代わりに「回転の減衰」を自分で与える
import * as THREE from 'three';
import { glyphPolygons, centerPolygons } from '../../glyph.js';

export const GLYPH_SIZE = 1.6;     // 1em の大きさ（m）
export const STADIUM_R = 5.5;      // スタジアムの半径。重心がここより外に出たら場外
export const BOWL_H = 1.3;         // すり鉢の深さ（見た目と中心へ引く力の両方に使う）
export const OMEGA_MAX = 32;       // 最大パワーで発射したときの回転速度（rad/s）
export const OMEGA_DOWN = 2.5;     // これより遅くなったらダウン
export const DT = 1 / 240;         // 物理の刻み。形を毎ステップ回して押し込むので細かく刻む
const DENSITY = 1.0;
const GRAVITY = 9.81;
const PULL = GRAVITY * 2 * BOWL_H / (STADIUM_R * STADIUM_R); // すり鉢 h = H(r/R)² の斜面で中心へ引かれる強さ（1/s²）
const TIP_FRICTION = 0.2;          // 軸先の摩擦トルク（質量あたり）。慣性モーメントが大きいほど減りにくい
const AIR_DRAG = 0.0004;           // 空気抵抗（ω² に比例、質量あたり）
const DRIFT = 0.012;               // 回転が斜面を転がって生む周回の力（ω に比例）
const WANDER = 0.5;                // ふらつき（軸のぶれ）の強さ
const HIT_SPIN = 0.06;             // 衝突で相手の回転を奪う強さ
const HIT_PUSH = 0.7;              // 衝突で相手を弾き飛ばす強さ
const GRIND = 2.0;                 // 触れ合っている間ずっと削り合う強さ（1秒あたりの衝撃に換算）
const START_RING = 3.3;            // 発射位置の半径
const SHAPE_SPIN_MAX = 10;         // 当たり判定の形を回す速さの上限（rad/s）。速すぎると重なりを押し戻す力で吹き飛ぶ
const HIT_CAP = 2.5;               // 1ステップで数える衝撃の上限

// ---------- 形と性能 ----------

// 文字 → コマの形（輪郭・当たり判定の三角形・性能の目安）。形が取れなければ null
export function komaShape(font, ch) {
  const polys = glyphPolygons(font, ch, GLYPH_SIZE);
  if (!polys.length) return null;
  centerPolygons(polys);
  const tris = [];
  let area = 0, filled = 0, sx = 0, sy = 0, j0 = 0;
  for (const { outer, holes } of polys) {
    filled += Math.abs(THREE.ShapeUtils.area(outer));
    const all = outer.concat(...holes);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const a = all[i], b = all[j], c = all[k];
      const s = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      if (s < 1e-6) continue; // 潰れた三角形
      // 針のように細い三角形は当たり判定を作れないので捨てる（面積・慣性には数える）
      const edge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      if (2 * s / edge >= 0.004) tris.push(new Float32Array([a.x, a.y, b.x, b.y, c.x, c.y]));
      area += s;
      sx += s * (a.x + b.x + c.x) / 3;
      sy += s * (a.y + b.y + c.y) / 3;
      j0 += s / 6 * (a.x * a.x + a.y * a.y + b.x * b.x + b.y * b.y + c.x * c.x + c.y * c.y + a.x * b.x + a.y * b.y + b.x * c.x + b.y * c.y + c.x * a.x + c.y * a.y);
    }
  }
  if (!tris.length) return null;
  const cx = sx / area, cy = sy / area;
  const k2 = j0 / area - (cx * cx + cy * cy); // 回転半径²（慣性モーメント / 質量）
  const pts = polys.flatMap(p => p.outer);
  const radius = Math.max(...pts.map(q => Math.hypot(q.x - cx, q.y - cy)));
  const hull = convexHull(pts);
  const hullArea = Math.abs(THREE.ShapeUtils.area(hull));
  // とがり：凸包（輪ゴムをかけた形）のうち、文字で埋まっていない割合。〇は0、米は大きい
  const spike = Math.max(0, 1 - filled / hullArea);
  const mass = area * DENSITY;
  return {
    ch, polys, tris, radius, mass, k2, spike,
    // 表示用の目安（衝突が無いときに最大パワーで何秒回るか）
    spinTime: spinDuration(k2, OMEGA_MAX),
  };
}

function spinDuration(k2, w0) {
  // dω/dt = -(a + bω²)/k² を解く
  const a = TIP_FRICTION, b = AIR_DRAG, s = Math.sqrt(a * b);
  return k2 / s * (Math.atan(w0 * Math.sqrt(b / a)) - Math.atan(OMEGA_DOWN * Math.sqrt(b / a)));
}

// 攻撃力：とがっているほど強い（〇の0.2 〜 とがった字の1.5 くらい）
const attackOf = shape => 0.2 + 2.2 * shape.spike;

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 性能表（0〜1 のバー用と、表示文字列）
export function shapeStats(shape) {
  return {
    stamina: Math.min(1, shape.spinTime / 60),
    attack: Math.min(1, shape.spike / 0.6),
    weight: Math.min(1, shape.mass / 1.6),
  };
}

// ---------- スタジアム ----------

// 見た目のすり鉢の高さ（three.js 側で使う）
export const bowlHeight = r => BOWL_H * (r / STADIUM_R) ** 2;

export function createArena(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = DT;
  return { RAPIER, world, events: new RAPIER.EventQueue(true), tops: [], byCollider: new Map(), time: 0, order: 0 };
}

export function freeArena(arena) {
  arena.events.free();
  arena.world.free();
}

// n 個のうち i 番目の発射位置（0番＝プレイヤーは手前）
export function startPos(i, n) {
  const a = -Math.PI / 2 + i * 2 * Math.PI / n;
  return { x: START_RING * Math.cos(a), y: START_RING * Math.sin(a) };
}

// コマを置く。回転は物理エンジンには任せず（とがった腕の速さで相手が一瞬で吹き飛ぶため）、
// 自分で角速度を持って毎ステップ形の向きを回す。ぶつかったときの強さは hit() で決める
export function addTop(arena, shape, x, y) {
  const { RAPIER, world } = arena;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y)
    .lockRotations()
    .setLinearDamping(0.3)
    .setCcdEnabled(true));
  for (const pts of shape.tris) {
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) continue;
    let c;
    try {
      c = world.createCollider(desc.setDensity(DENSITY).setFriction(0.1).setRestitution(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0), body);
    } catch { continue; } // 凸包が作れなかった三角形は飛ばす
    arena.byCollider.set(c.handle, arena.tops.length);
  }
  body.setEnabled(false); // 発射までは置いておくだけ
  const top = {
    shape, body, index: arena.tops.length,
    state: 'wait',        // wait | spin | down | out
    omega: 0, angle: 0, shapeAngle: 0, x, y, vx: 0, vy: 0,
    inertia: shape.mass * shape.k2,
    wander: Math.random() * Math.PI * 2,
    endTime: 0, endOrder: 0, hitFlash: 0,
  };
  arena.tops.push(top);
  return top;
}

// 発射：power は 0〜1、dir は +1（左回り＝反時計回り）か -1（右回り＝時計回り）
export function launchTop(arena, top, power, dir) {
  const p = Math.max(0.3, Math.min(1, power));
  const { body } = top;
  body.setEnabled(true);
  top.omega = dir * OMEGA_MAX * p;
  // 斜面に沿って回り込むように、接線方向へ少し打ち出す（周回に必要な速さより遅いので、だんだん中心へ寄る）
  const t = body.translation(), r = Math.hypot(t.x, t.y) || 1;
  const v = 1.0 + 1.2 * p;
  body.setLinvel({ x: t.y / r * dir * v - t.x / r * 0.4, y: -t.x / r * dir * v - t.y / r * 0.4 }, true);
  top.state = 'spin';
}

// 1ステップ進める。起きたこと（衝突・脱落）を配列で返す
export function stepArena(arena) {
  const { world, tops } = arena;
  const happened = [];
  arena.time += DT;

  for (const top of tops) {
    if (top.state === 'wait' || top.state === 'out') continue;
    const b = top.body;
    const m = b.mass();
    const t = b.translation(), r = Math.hypot(t.x, t.y);
    // すり鉢の斜面：中心へ引く
    const f = { x: -PULL * m * t.x, y: -PULL * m * t.y };
    if (top.state === 'spin') {
      // 回転の減衰：軸先の摩擦＋空気抵抗。回転半径²（慣性モーメント/質量）が大きいほどゆっくり減る
      const w = top.omega;
      const dw = (TIP_FRICTION + AIR_DRAG * w * w) / top.shape.k2 * DT;
      top.omega = Math.abs(w) <= dw ? 0 : w - Math.sign(w) * dw;
      // 回転が斜面を転がって生む周回の力と、軸のぶれによるふらつき（遅くなるほどふらつく）
      const ratio = Math.abs(top.omega) / OMEGA_MAX;
      if (r > 0.05) {
        const s = -Math.sign(top.omega) * DRIFT * Math.abs(top.omega) * m;
        f.x += t.y / r * s;
        f.y += -t.x / r * s;
      }
      top.wander += (Math.random() - 0.5) * 8 * DT;
      const wobble = WANDER * m * (0.4 + (1 - ratio));
      f.x += Math.cos(top.wander) * wobble;
      f.y += Math.sin(top.wander) * wobble;
    }
    top.angle += top.omega * DT;
    top.shapeAngle += Math.sign(top.omega) * Math.min(Math.abs(top.omega), SHAPE_SPIN_MAX) * DT;
    b.setRotation(top.shapeAngle, true);
    b.applyImpulse({ x: f.x * DT, y: f.y * DT }, true);
  }

  world.step(arena.events);

  // 衝突：とがり具合と回転の速さに応じて、相手の回転を奪い、弾き飛ばす
  const pairs = new Map();
  arena.events.drainContactForceEvents(e => {
    const i = arena.byCollider.get(e.collider1()), j = arena.byCollider.get(e.collider2());
    if (i === undefined || j === undefined || i === j) return;
    const key = i < j ? i * 16 + j : j * 16 + i;
    pairs.set(key, (pairs.get(key) || 0) + e.totalForceMagnitude() * DT);
  });
  for (const [key, impulse] of pairs) {
    const a = tops[key >> 4], b = tops[key & 15];
    const pa = a.body.translation(), pb = b.body.translation();
    let nx = pb.x - pa.x, ny = pb.y - pa.y;
    const d = Math.hypot(nx, ny) || 1;
    nx /= d; ny /= d;
    const j = Math.min(impulse, HIT_CAP) + GRIND * DT;
    const push = hit(a, b, j, nx, ny) + hit(b, a, j, -nx, -ny);
    happened.push({ type: 'hit', a: a.index, b: b.index, impulse: j, push, x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
  }

  for (const top of tops) {
    if (top.state === 'wait' || top.state === 'out') continue;
    const b = top.body;
    const t = b.translation(), v = b.linvel();
    top.x = t.x; top.y = t.y; top.vx = v.x; top.vy = v.y;
    top.hitFlash = Math.max(0, top.hitFlash - DT);
    if (Math.hypot(t.x, t.y) > STADIUM_R) {
      top.state = 'out';
      top.endTime = arena.time;
      top.endOrder = ++arena.order;
      b.setEnabled(false);
      happened.push({ type: 'out', top: top.index });
    } else if (top.state === 'spin' && Math.abs(top.omega) < OMEGA_DOWN) {
      top.state = 'down';
      top.endTime = arena.time;
      top.endOrder = ++arena.order;
      b.setLinearDamping(3);
      happened.push({ type: 'down', top: top.index });
    } else if (top.state === 'down') {
      top.omega *= 1 - 3 * DT; // 倒れたあとは惰性で少し回って止まる
    }
  }
  return happened;
}

// atk が def に当たった：def の回転を奪い、def を弾く（n は atk → def の向き）。弾いた強さを返す
function hit(atk, def, impulse, nx, ny) {
  if (atk.state !== 'spin' || def.state === 'out') return 0;
  const power = attackOf(atk.shape) * Math.abs(atk.omega) / OMEGA_MAX;
  // 同じ向きどうしは接点でこすれ合って弾き合い、逆向きどうしは歯車のようにかみ合って回転を奪い合う
  const same = Math.sign(atk.omega) === Math.sign(def.omega);
  if (def.state === 'spin') {
    const dw = HIT_SPIN * (same ? 0.8 : 1.3) * impulse * power * atk.shape.radius / def.inertia;
    def.omega = Math.abs(def.omega) <= dw ? 0 : def.omega - Math.sign(def.omega) * dw;
  }
  // 弾く向きは、まっすぐ押す向きを atk の回転方向へ少しひねる
  const push = HIT_PUSH * (same ? 1.3 : 0.8) * impulse * power;
  const tw = 0.5 * Math.sign(atk.omega), c = Math.cos(tw), s = Math.sin(tw);
  def.body.applyImpulse({ x: (nx * c - ny * s) * push, y: (nx * s + ny * c) * push }, true);
  def.hitFlash = 0.15;
  return push;
}

// まだ回っているコマ
export const spinning = arena => arena.tops.filter(t => t.state === 'spin');

// 回転数（rpm）
export const rpm = top => Math.abs(top.omega) * 60 / (2 * Math.PI);
