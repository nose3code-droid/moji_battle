// 文字ドミノの物理まわり：字の形 → 性格（倒れやすさ・重さ・長さ）→ 当たり判定、面の世界、鐘の判定
// 物理は Rapier の 2D 版（rapier2d-deterministic）。固定の時間刻みで、同じ配置なら必ず同じ結果になる。座標は m、y 上向き
import { glyphPolygons, centerPolygons, buildPrisms, shapeMetrics } from '../../glyph.js';

export const DT = 1 / 120;          // 物理の刻み（秒）
export const EM = 1.0;              // 1em の大きさ（m）。字の高さは 0.7〜1.0m くらい
export const IDLE_LIMIT = 5;        // 全部止まったまま、鐘が鳴らずにこれだけ経ったら失敗（秒）
export const TIME_LIMIT = 45;       // どんなときも、これを超えたら失敗（秒）
const G = 9.81;
const BELL_R = 0.42;                // 鐘の判定の半径（m）
const BALL_R = 0.3;
const BALL_DENSITY = 2;
const BALLOON_R = 0.36;

export const isTool = id => id[0] === '@';
export const TOOL_NAMES = { '@ball': 'ボール', '@plank': '板', '@spring': 'バネ', '@balloon': '風船' };

// ---------- 字の形と性格 ----------
// 1文字ぶんの形（外形・穴・当たり判定用の三角形）と、形から決まる性格。bbox の中心が原点
export function makeShape(font, ch) {
  const polys = glyphPolygons(font, ch, EM);
  if (!polys.length) return null;
  const metrics = shapeMetrics(polys);
  const box = centerPolygons(polys);
  // 細すぎる三角形は rapier2d が当たり判定を作れないので除く
  const tris = buildPrisms(polys, 1).map(p => [p[0], p[1], p[3], p[4], p[6], p[7]]).filter(t => {
    const area2 = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]));
    const edge = Math.max(Math.hypot(t[2] - t[0], t[3] - t[1]), Math.hypot(t[4] - t[2], t[5] - t[3]), Math.hypot(t[0] - t[4], t[1] - t[5]));
    return area2 / edge > 0.002;
  });
  if (!tris.length) return null;
  const shape = { ch, polys, tris, w: box.x, h: box.y, metrics };
  shape.trait = traitsOf(shape);
  return shape;
}

// 形 → 性格。すべて輪郭だけから決まる（乱数なし）
//   tipAngle：重心が足の右端の真上を越えるまでに傾ける角度。小さいほど倒れやすい（右へ倒れる向き）
//   mass    ：面積 × 密度（密度は全部 1）。重いほど次を強く押す
//   reach   ：字の高さ。倒れたとき、てっぺんが届く距離
//   roll    ：凸包の丸さ。高いと足で立てずに転がる
function traitsOf(shape) {
  const { polys, tris, w, h, metrics } = shape;
  let A = 0, cx = 0, cy = 0;
  for (const t of tris) {
    const a = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2;
    A += a; cx += a * (t[0] + t[2] + t[4]) / 3; cy += a * (t[1] + t[3] + t[5]) / 3;
  }
  cx /= A; cy /= A;
  const base = -h / 2;
  const feet = polys.flatMap(p => p.outer).filter(q => q.y < base + h * 0.06);
  const fx0 = Math.min(...feet.map(q => q.x)), fx1 = Math.max(...feet.map(q => q.x));
  const comH = Math.max(0.05, cy - base);
  const tipAngle = Math.atan(Math.max(0.001, fx1 - cx) / comH);   // 右へ倒れるときの限界角（rad）
  const roll = metrics.roundness > 0.95;
  const stance = (fx1 - fx0) / w;                                  // 足の開き（1 で全幅）
  const tip = roll ? 0 : tipAngle < 0.2 ? 5 : tipAngle < 0.33 ? 4 : tipAngle < 0.5 ? 3 : tipAngle < 0.7 ? 2 : 1;
  const heavy = metrics.area < 0.12 ? 1 : metrics.area < 0.2 ? 2 : metrics.area < 0.3 ? 3 : metrics.area < 0.4 ? 4 : 5;
  const kind = roll ? 'roll' : h / w < 0.35 ? 'flat' : tip >= 4 ? (h / w > 1.4 ? 'slender' : 'wobbly')
    : tip <= 3 && stance < 0.95 ? 'wide' : tip <= 2 && heavy >= 4 ? 'block' : 'plain';
  const label = { roll: 'ころがる', flat: 'ねている', slender: '細長い', wobbly: 'ぐらぐら', wide: '足ひらき', block: 'どっしり', plain: 'ふつう' }[kind];
  const note = {
    roll: '足で立てず、転がって次へ伝わる', flat: '横になっていて、倒れない（板がわり）', slender: '倒れやすく、長く倒れる',
    wobbly: '足が細くて、ぐらつきやすい', wide: '足が開いて安定している', block: '倒れにくいが、倒れると重い', plain: 'ほどよく倒れる',
  }[kind];
  return { tip, heavy, reach: h, roll, kind, label, note, tipAngle, mass: metrics.area, stance, w, h };
}

// 置いた字どうしが（動かせない字も含めて）横に重なっていないか。重なると押し出されて飛ぶので、置けないことにする
export function overlapping(level, placement, shapes) {
  const gl = [];
  level.slots.forEach((sl, i) => { const c = placement[i]; if (c && !isTool(c)) gl.push({ x: sl.x, w: shapes.get(c).w }); });
  for (const f of level.fixed ?? []) gl.push({ x: f.x, w: shapes.get(f.ch).w });
  for (let i = 0; i < gl.length; i++) for (let j = i + 1; j < gl.length; j++) if (Math.abs(gl[i].x - gl[j].x) < (gl[i].w + gl[j].w) / 2 + 0.04) return true;
  return false;
}

// ---------- 世界 ----------
// 面の定義（levels.js）と置いた札から、物理の世界を作る。placement[i] は i 番目の置き場に置いた札（なければ null）
export class Sim {
  constructor(R, level, shapes, placement) {
    this.R = R; this.level = level;
    const world = this.world = new R.World({ x: 0, y: -G });
    world.timestep = DT;
    
    const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const [x0, y0, x1, y1] of level.boxes) {
      world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2).setFriction(0.8), fixed);
    }
    for (const poly of level.polys ?? []) {   // 斜面など（凸の多角形）
      const d = R.ColliderDesc.convexHull(new Float32Array(poly.flat()));
      if (d) world.createCollider(d.setFriction(0.6), fixed);
    }
    this.glyphHandles = new Set();
    this.bodies = [];       // { body, kind:'glyph'|'ball'|'balloon', slot, shape?, gone, vPrev }
    this.time = 0;
    this.rungAt = -1;
    this.idle = 0;
    this.idleLimit = IDLE_LIMIT;   // 探索では短くして速くする（止まった後に鐘が鳴ることはない）
    this.result = null;     // null | 'clear' | 'fail'
    this.failWhy = '';
    this.events = [];       // 衝突の演出用 { x, y, s }。描画側が読んで空にする
    this._bell = new R.Ball(BELL_R);

    // 出発の棒（キッカー）：決まった距離だけ前に出て、最初の字を押す
    const k = level.kick;
    this.kick = null;
    if (k) {
      this.kick = world.createRigidBody(R.RigidBodyDesc.kinematicVelocityBased().setTranslation(k.x, k.y).setLinvel(k.v, 0));
      world.createCollider(R.ColliderDesc.cuboid(k.w / 2, k.h / 2).setFriction(0.2), this.kick);
      this.kickX0 = k.x;
    }
    level.slots.forEach((sl, i) => {
      const card = placement[i];
      if (card) this._place(sl, i, card, shapes);
    });
    // 最初から立っている字（動かせない障害物）。slot は -1, -2, …
    (level.fixed ?? []).forEach((f, i) => this._place({ x: f.x, y: f.y }, -1 - i, f.ch, shapes));
  }

  _addBall(x, y, r, density, v, slot) {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y).setLinvel(v.x, v.y)
      .setLinearDamping(0.02).setAngularDamping(0.05).setCcdEnabled(true));
    this.world.createCollider(R.ColliderDesc.ball(r).setDensity(density).setFriction(0.7).setRestitution(0.1), body);
    this.bodies.push({ body, kind: 'ball', slot, r, gone: false, vPrev: 0 });
  }

  _place(sl, i, card, shapes) {
    const R = this.R, world = this.world;
    if (!isTool(card)) {
      const shape = shapes.get(card);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(sl.x, sl.y + shape.h / 2 + 0.003)
        .setAngularDamping(0.1).setLinearDamping(0.02).setCcdEnabled(true));
      const t = shape.trait;
      const friction = t.roll ? 0.3 : 0.8;
      for (const tri of shape.tris) {
        const d = R.ColliderDesc.convexHull(new Float32Array(tri));
        if (!d) continue;
        try { world.createCollider(d.setDensity(1).setFriction(friction).setRestitution(0.05), body); } catch { /* 作れない三角形は無視 */ }
      }
      if (!t.roll) this.glyphHandles.add(body.handle);   // 転がる字は次へ伝えるだけ。鐘を鳴らすのは、倒れて当たる字
      this.bodies.push({ body, kind: 'glyph', slot: i, shape, gy: sl.y, gone: false, vPrev: 0 });
    } else if (card === '@ball') {
      this._addBall(sl.x, sl.cy ?? sl.y + BALL_R + 0.003, BALL_R, BALL_DENSITY, { x: sl.v ?? 0, y: 0 }, i);
    } else if (card === '@balloon') {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(sl.x, sl.y).setGravityScale(0)
        .setLinvel(sl.v ?? 2.2, 0).setLinearDamping(0.25).setCcdEnabled(true));
      world.createCollider(R.ColliderDesc.ball(BALLOON_R).setDensity(0.8).setFriction(0.3).setRestitution(0.3), body);
      this.bodies.push({ body, kind: 'balloon', slot: i, r: BALLOON_R, gone: false, vPrev: 0 });
    } else if (card === '@plank') {
      const fixed = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(sl.x, sl.y).setRotation(sl.angle ?? 0));
      world.createCollider(R.ColliderDesc.cuboid((sl.len ?? 2.2) / 2, 0.06).setFriction(0.6), fixed);
    } else if (card === '@spring') {
      const fixed = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(sl.x, sl.y).setRotation(sl.angle ?? 0));
      world.createCollider(R.ColliderDesc.cuboid(0.5, 0.1).setTranslation(0, -0.1).setFriction(0.5).setRestitution(1.15)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Max), fixed);
    }
  }

  // 1刻み進める。鐘が鳴ったら result='clear'、止まったまま／時間切れなら 'fail'
  step() {
    if (this.result) return;
    this.world.step();
    this.time += DT;
    if (this.kick && this.kick.translation().x - this.kickX0 >= this.level.kick.stroke) this.kick.setLinvel({ x: 0, y: 0 }, true);
    let moving = 0;
    for (const b of this.bodies) {
      if (b.gone) continue;
      const t = b.body.translation();
      if (t.y < -3 || t.x < -3 || t.x > this.level.W + 3) { b.body.setEnabled(false); b.gone = true; continue; }
      const v = b.body.linvel(), sp = Math.hypot(v.x, v.y) + Math.abs(b.body.angvel()) * 0.25;
      moving = Math.max(moving, sp);
      // 急に勢いが落ちたら「ぶつかった」演出
      const sp1 = Math.hypot(v.x, v.y);
      if (b.vPrev - sp1 > 0.5 && b.kind === 'glyph') this.events.push({ x: t.x, y: Math.max(t.y - b.shape.h / 2, (this.level.slots[b.slot]?.y ?? b.gy ?? t.y)), s: b.vPrev - sp1 });
      b.vPrev = sp1;
    }
    if (this._bellHit()) { this.rungAt = this.time; this.result = 'clear'; return; }
    this.idle = moving < 0.05 ? this.idle + DT : 0;
    if (this.idle >= this.idleLimit) { this.result = 'fail'; this.failWhy = 'idle'; }
    else if (this.time >= TIME_LIMIT) { this.result = 'fail'; this.failWhy = 'time'; }
  }

  // 動いている字が鐘に触れたか
  _bellHit() {
    const bell = this.level.bell;
    let hit = false;
    this.world.intersectionsWithShape({ x: bell.x, y: bell.y }, 0, this._bell, col => {
      const rb = col.parent();
      if (rb && rb.isDynamic() && this.glyphHandles.has(rb.handle)) {  // 鳴らせるのは字だけ（出発のボールが直接鳴らすのは無し）
        const v = rb.linvel();
        if (Math.hypot(v.x, v.y) > 0.25) { hit = true; return false; }
      }
      return true;
    });
    return hit;
  }

  // 描画用：各物体の姿勢
  poses() {
    return this.bodies.filter(b => !b.gone).map(b => {
      const t = b.body.translation();
      return { b, x: t.x, y: t.y, a: b.body.rotation() };
    });
  }

  free() { this.world.free(); }
}

// 配置全体を最後まで走らせる（検証・解探索用）。{ result, time } を返す
export function runToEnd(R, level, shapes, placement, maxSteps = Math.ceil(TIME_LIMIT / DT) + 10) {
  const sim = new Sim(R, level, shapes, placement);
  for (let i = 0; i < maxSteps && !sim.result; i++) sim.step();
  const out = { result: sim.result, time: sim.time, why: sim.failWhy, rungAt: sim.rungAt };
  sim.free();
  return out;
}
