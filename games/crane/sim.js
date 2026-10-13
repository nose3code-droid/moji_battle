// 文字クレーンゲームの物理とゲーム進行。DOM に触れない（固定刻み・乱数はシード固定なので、同じ操作なら同じ結果）
// 物理は Rapier 2D。景品は凸分割した輪郭で衝突し、爪はキネマティック（動かす物体）で字を押して持ち上げる
// 座標は m、y 上向き。床が y=0、左の取り出し口の下に受け皿がある
export const DT = 1 / 60;
export const X0 = -3.9, X1 = 3.6;     // ガラスの箱の左右の壁
export const CH_X = -2.2;             // 取り出し口の右端（ここより左が取り出し口）
export const BIN_Y = -1.7;            // 受け皿の底
export const LIP_H = 0.5;             // 取り出し口のふちの高さ
export const CEIL = 6.6;
export const RAIL_Y = 5.6;            // 爪を引き上げたときの本体の高さ
export const HUB_MIN = -3.05, HUB_MAX = 2.7;
export const CHANCES = 3;

const OPEN = 0.85,  CLOSED = 0.12;      // 爪の、本体の中心からの横の距離。開いた状態と、閉じきった状態
const PIVOT_DY = -0.1;                 // 爪の付け根の高さ（本体から）
export const PIN_LEN = 1.2;            // 真ん中のピンの長さ
const MOVE_SPEED = 2.6, DOWN_SPEED = 3.2, UP_SPEED = 3.6, CLOSE_SPEED = 0.9, OPEN_SPEED = 2.2;
const GRIP_SQUEEZE = 0.012;             // 爪が字に触れてから、さらに締める距離（m）。閉じる力の強さ
const GRIP_TIME = 8;                   // 締める力がゼロに抜けるまでの時間（秒）。弱い爪なので、運ぶうちに抜けていく
const GRIP_LOAD = 0.55;                 // 重さ ÷ 摩擦 が大きい字ほど、抜けるのが早い（上の式の係数）
const FLOOR_TOUCH = 0.03;

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 爪1本ぶんの形（縦の棒と、内向きに少しはね上がった爪先）。指の付け根を原点に、内向きが +x（左の指の向き）
function fingerBoxes() {
  return [
    { cx: 0, cy: -0.65, hx: 0.07, hy: 0.65, a: 0 },
    { cx: 0.07, cy: -1.28, hx: 0.08, hy: 0.05, a: 0.3 },
  ];
}
export const FINGER_BOXES = fingerBoxes();

export class CraneSim {
  // RAPIER：初期化済みの Rapier、prizes：makePrize の結果の配列（置く順）、stage：stages.js の1つ
  constructor(RAPIER, prizes, stage) {
    this.R = RAPIER;
    this.stage = stage;
    const R = RAPIER;
    this.world = new R.World({ x: 0, y: -9.81 });
    this.world.timestep = DT;
    this.t = 0;
    this.events = [];
    this.buildBox();
    this.prizes = [];
    this.byBody = new Map();
    this.buildPile(prizes);
    this.buildClaw();

    this.state = 'aim';
    this.chances = CHANCES;
    this.score = 0;
    this.caught = [];       // 取れた景品（取れた順）
    this.turnGain = [];     // 今のチャンスで取れた景品
    this.hx = 0; this.hy = RAIL_Y; this.vx = 0;
    this.theta = [OPEN, OPEN];
    this.stall = [null, null];
    this.squeeze = 0;
    this.pressed = 0;           // 字の上に乗ってから押し込んだ深さ
    this.gripSqueeze = GRIP_SQUEEZE;
    this.gripTime = GRIP_TIME;
    this.gripLoad = GRIP_LOAD;
    this.timer = 0;
    this.gripped = new Set();   // 爪がつかんでいる景品
    this.hooked = null;
    this.hookJoint = null;
    this.hookLife = 0;
    this.carryT = 0;
    this.lastResult = null;
    this.syncClaw();
  }

  buildBox() {
    const R = this.R, w = this.world;
    const fix = (cx, cy, hx, hy, fr = 0.6) => {
      const b = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(cx, cy));
      w.createCollider(R.ColliderDesc.cuboid(hx, hy).setFriction(fr), b);
    };
    fix((CH_X + X1) / 2, -0.5, (X1 - CH_X) / 2 + 0.3, 0.5, 0.8);        // 床（上面が y=0）
    fix(X1 + 0.3, 3, 0.3, 6);                                           // 右の壁
    fix(X0 - 0.3, 3, 0.3, 6);                                           // 左の壁
    fix((X0 + CH_X) / 2, BIN_Y - 0.4, (CH_X - X0) / 2 + 0.3, 0.4, 0.9);  // 受け皿の底
    fix(CH_X, (BIN_Y + LIP_H) / 2, 0.07, (LIP_H - BIN_Y) / 2);          // 取り出し口のふち
    fix(0, CEIL + 0.3, 5, 0.3);                                         // 天井
  }

  buildPile(prizes) {
    const R = this.R, w = this.world, rand = rng(this.stage.seed);
    // ピラミッド状に並べて落とす（下の段 4 個、その上 3 個、2 個）
    const slots = [];
    [[4, -1.55], [3, -0.78], [2, 0]].forEach(([n, x0], row) => { for (let k = 0; k < n; k++) slots.push({ x: x0 + 1.55 * k, y: 0.7 + row * 1.15 }); });
    prizes.forEach((def, i) => {
      const x = slots[i % slots.length].x + (rand() - 0.5) * 0.16;
      const y = slots[i % slots.length].y;
      const a = (rand() - 0.5) * (def.traits.friction < 0.4 ? 6.28 : 1.1);
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y).setRotation(a)
        .setLinearDamping(0.05).setAngularDamping(0.4).setCcdEnabled(true));
      for (const p of def.pieces) {
        const d = R.ColliderDesc.convexHull(p);
        if (!d) continue;
        try {
          w.createCollider(d.setDensity(def.traits.density).setFriction(def.traits.friction).setRestitution(0.05)
            .setFrictionCombineRule(R.CoefficientCombineRule.Min), body);
        } catch { /* 作れない細かい形は無視 */ }
      }
      const prize = { def, ch: def.ch, body, id: i, delivered: false };
      this.prizes.push(prize);
      this.byBody.set(body.handle, prize);
    });
    for (let i = 0; i < 480; i++) this.world.step(); // 山を落ち着かせる
    // 取り出し口のほうへ転がり落ちた字は、山の上に戻して、もう一度落ち着かせる
    for (let round = 0; round < 4; round++) {
      let moved = 0;
      for (const p of this.prizes) {
        const t = p.body.translation();
        if (t.x > CH_X + 0.9 && t.y > -0.2) continue;
        p.body.setTranslation({ x: 0.2 + rand() * 2.2, y: 3.4 + moved * 1.2 }, true);
        p.body.setRotation(rand() - 0.5, true); p.body.setLinvel({ x: 0, y: 0 }, true); p.body.setAngvel(0, true);
        moved++;
      }
      if (!moved) break;
      for (let i = 0; i < 360; i++) this.world.step();
    }
    for (const p of this.prizes) { p.body.setLinvel({ x: 0, y: 0 }, true); p.body.setAngvel(0, true); }
  }

  buildClaw() {
    const R = this.R, w = this.world;
    this.hub = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, RAIL_Y));
    // sgn：内向きが +x なら 1（左の指）、-x なら -1（右の指）
    this.fingers = [1, -1].map(sgn => {
      const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      const cols = FINGER_BOXES.map(b => w.createCollider(
        R.ColliderDesc.cuboid(b.hx, b.hy).setTranslation(sgn * b.cx, b.cy).setRotation(sgn * b.a).setFriction(1.4).setCollisionGroups(0x0002FFFF), body));
      return { sgn, body, cols };
    });
  }

  // 指の付け根（左の指が i=0）。theta[i] は本体の中心からの横の距離
  pivot(i) { return { x: this.hx + (i ? 1 : -1) * this.theta[i], y: this.hy + PIVOT_DY }; }
  syncClaw() {
    this.hub.setNextKinematicTranslation({ x: this.hx, y: this.hy });
    this.fingers.forEach((f, i) => f.body.setNextKinematicTranslation(this.pivot(i)));
  }
  // 指の四角形の頂点（指の付け根から見た座標）
  fingerCorners(i) {
    const sgn = i ? -1 : 1;
    return FINGER_BOXES.map(b => {
      const la = sgn * b.a, lc = Math.cos(la), ls = Math.sin(la);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({
        x: sgn * b.cx + sx * b.hx * lc - sy * b.hy * ls,
        y: b.cy + sx * b.hx * ls + sy * b.hy * lc,
      }));
    });
  }
  // 指の先（いちばん下の点）の高さ
  fingerLowY(i, hy = this.hy) {
    let lo = Infinity;
    for (const quad of this.fingerCorners(i)) for (const q of quad) lo = Math.min(lo, hy + PIVOT_DY + q.y);
    return lo;
  }
  // 世界座標の指の形（描画用）：四角形の頂点列の配列
  fingerShapes(i) {
    const p = this.pivot(i);
    return this.fingerCorners(i).map(quad => quad.map(q => ({ x: p.x + q.x, y: p.y + q.y })));
  }
  pinTip() { return { x: this.hx, y: this.hy - PIN_LEN }; }

  alive() { return this.prizes.filter(p => !p.delivered); }

  // 指が景品に触れているか
  // mode: 'top' = 真上から当たっている / 'inner' = 爪の内側にある字に触れている / 省略 = どれでも
  touching(i, mode, collect) {
    let hit = false;
    for (const col of this.fingers[i].cols) {
      this.world.contactPairsWith(col, other => {
        if (hit) return;
        const par = other.parent();
        if (!par || !this.byBody.has(par.handle)) return;
        this.world.contactPair(col, other, m => {
          if (mode === 'top' && Math.abs(m.normal().y) < 0.6) return; // 横からの接触は無視（真上から当たったときだけ数える）
          if (mode === 'inner' && (par.translation().x - this.pivot(i).x) * (i ? -1 : 1) < 0) return; // 爪の外側にある字は無視
          for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) < 0.012) { hit = true; if (collect) this.gripped.add(this.byBody.get(par.handle)); }
        });
      });
    }
    return hit;
  }

  // ピンの先が景品の穴に入っているか（ピンは字の手前の層にあるので、穴の上なら通せる）
  holeUnderPin() {
    const t = this.pinTip();
    for (const p of this.alive()) {
      if (!p.def.traits.hook) continue;
      const b = p.body.translation(), a = p.body.rotation();
      if (Math.hypot(b.x - t.x, b.y - t.y) > p.def.radius + 0.1) continue;
      const c = Math.cos(a), s = Math.sin(a);
      const lx = (t.x - b.x) * c + (t.y - b.y) * s, ly = -(t.x - b.x) * s + (t.y - b.y) * c;
      for (const h of p.def.holes) if (h.w >= 0.17 && pointInPoly(lx, ly, h.pts)) return { prize: p, local: { x: lx, y: ly } };
    }
    return null;
  }
  hook(found) {
    const R = this.R;
    const params = R.JointData.revolute({ x: 0, y: -PIN_LEN }, found.local);
    this.hookJoint = this.world.createImpulseJoint(params, this.hub, found.prize.body, true);
    this.hooked = found.prize;
    // 重い字ほど、ピンから早くはずれる
    this.hookLife = Math.round(60 * Math.max(1.5, 6.5 - 5 * found.prize.def.traits.massN / 1.0));
    this.events.push({ type: 'hook', prize: found.prize });
  }
  unhook() {
    if (this.hookJoint) this.world.removeImpulseJoint(this.hookJoint, true);
    this.hookJoint = null; this.hooked = null;
  }

  // 1フレーム進める。input: { dir: -1|0|1, drop: boolean }
  step(input = {}) {
    this.t += DT;
    const dir = input.dir | 0;
    switch (this.state) {
      case 'aim': {
        this.hx = Math.max(HUB_MIN, Math.min(HUB_MAX, this.hx + dir * MOVE_SPEED * DT));
        this.vx = 0;
        if (input.drop && this.chances > 0) {
          this.chances--; this.turnGain = []; this.state = 'descend'; this.timer = 0;
          this.theta = [OPEN, OPEN]; this.stall = [null, null]; this.squeeze = 0; this.pressed = 0;
          this.events.push({ type: 'drop' });
        }
        break;
      }
      case 'descend': {
        const next = this.hy - DOWN_SPEED * DT * (this.pressed > 0 ? 0.35 : 1); // 字に乗ったら、ゆっくり押し込む
        const low = Math.min(this.fingerLowY(0, next), this.fingerLowY(1, next));
        if (low <= FLOOR_TOUCH) { this.hy = next + (FLOOR_TOUCH - low); this.state = 'wait'; this.timer = 0; break; } // 床に着いた
        this.hy = next;
        if (!this.hooked && !this.noHook) { const f = this.holeUnderPin(); if (f) this.hook(f); }
        if (this.touching(0, 'top') || this.touching(1, 'top')) { // 字の上に乗った：少しだけ押し込んで、だめなら止まる
          this.pressed += DOWN_SPEED * DT * 0.35;
          if (this.pressed > 0.3) { this.state = 'wait'; this.timer = 0; }
        }
        break;
      }
      case 'wait': // 底で一呼吸おく
        if (++this.timer > 14) { this.state = 'grab'; this.timer = 0; this.restoreGrip(); }
        break;
      case 'grab': {
        // 触れるまで閉じる。触れたら止まり、さらに少しだけ締める
        let moving = false;
        for (let i = 0; i < 2; i++) {
          if (this.stall[i] === null) {
            if (this.touching(i, 'inner', true)) { this.stall[i] = this.theta[i]; continue; }
            if (this.theta[i] > CLOSED) { this.theta[i] = Math.max(CLOSED, this.theta[i] - CLOSE_SPEED * DT); moving = true; }
            else this.stall[i] = this.theta[i];
          }
        }
        if (!moving) {
          if (++this.timer > 8) { this.state = 'lift'; this.timer = 0; this.carryT = 0; }
        }
        // 締める力：触れている指だけ、閉じる向きに少し深く押し込む
        this.squeeze = Math.min(this.gripSqueeze, this.squeeze + this.gripSqueeze * DT * 6);
        for (let i = 0; i < 2; i++) if (this.stall[i] !== null) this.theta[i] = this.stall[i] - this.squeeze;
        break;
      }
      case 'lift': case 'carry': {
        this.carryT += DT;
        // 締める力は時間とともに抜けていく（弱いアーム）
        this.squeeze = this.gripSqueeze;
        this.fadeGrip();
        for (let i = 0; i < 2; i++) if (this.stall[i] !== null) this.theta[i] = this.stall[i] - this.squeeze;
        if (this.hooked && --this.hookLife <= 0) { this.unhook(); this.events.push({ type: 'unhook' }); }
        if (this.state === 'lift') {
          this.hy = Math.min(RAIL_Y, this.hy + UP_SPEED * DT);
          if (this.hy >= RAIL_Y) this.state = 'carry';
        } else {
          const target = HUB_MIN + 0.1;
          const want = Math.max(-2.6, Math.min(2.6, (target - this.hx) * 3));
          this.vx += Math.max(-5 * DT, Math.min(5 * DT, want - this.vx));
          this.hx += this.vx * DT;
          if (Math.abs(target - this.hx) < 0.03 && Math.abs(this.vx) < 0.15) { this.state = 'release'; this.timer = 0; }
        }
        break;
      }
      case 'release': {
        this.vx *= 0.8; this.hx += this.vx * DT;
        for (let i = 0; i < 2; i++) this.theta[i] = Math.min(OPEN, this.theta[i] + OPEN_SPEED * DT);
        if (this.timer === 0) { this.unhook(); this.restoreGrip(); }
        if (++this.timer > 50) { this.state = 'settle'; this.timer = 0; }
        break;
      }
      case 'settle': {
        // 字の動きが止まるまで待つ。そのあと次のチャンスへ
        this.timer++;
        let calm = true;
        for (const p of this.alive()) {
          const v = p.body.linvel(), w = p.body.angvel();
          if (Math.abs(v.x) + Math.abs(v.y) > 0.08 || Math.abs(w) > 0.15) { calm = false; break; }
        }
        if ((calm && this.timer > 30) || this.timer > 360) this.finishTurn();
        break;
      }
      default: break;
    }
    this.syncClaw();
    this.world.step();
    this.checkDelivery();
  }

  // 弱いアーム：爪がつかんでいられる時間は、字の性格（重さ・摩擦）で決まる
  //   つかんでいられる時間 = gripTime × (1 − gripLoad × 重さ ÷ 摩擦)。丸い字・重い字ほど、早く抜ける
  // その時間を過ぎると、まず摩擦がなくなって滑り、それでも引っかかっていれば爪との衝突を切って落とす
  slipTime(p) {
    const t = p.def.traits;
    return Math.max(1, this.gripTime * (1 - this.gripLoad * t.massN / t.friction));
  }
  fadeGrip() {
    for (const p of this.gripped) {
      const ts = this.slipTime(p), late = this.carryT - ts;
      if (late < 0) continue;
      if (!p.slipping) { p.slipping = true; this.events.push({ type: 'slip', prize: p }); }
      for (let n = 0; n < p.body.numColliders(); n++) {
        const c = p.body.collider(n);
        c.setFriction(0.02);
        if (late > 0.25) c.setCollisionGroups(0x0001FFFD); // 爪をすり抜けて落ちる
      }
    }
  }
  restoreGrip() {
    for (const p of this.gripped) {
      p.slipping = false;
      for (let n = 0; n < p.body.numColliders(); n++) {
        const c = p.body.collider(n);
        c.setFriction(p.def.traits.friction); c.setCollisionGroups(0xFFFFFFFF);
      }
    }
    this.gripped.clear();
  }

  checkDelivery() {
    for (const p of this.prizes) {
      if (p.delivered) continue;
      const t = p.body.translation();
      if (t.y < -0.3 && t.x < CH_X) {
        p.delivered = true;
        if (this.hooked === p) this.unhook();
        this.score += p.def.strokes;
        this.caught.push(p);
        this.turnGain.push(p);
        this.events.push({ type: 'get', prize: p });
      }
    }
  }

  finishTurn() {
    this.lastResult = { gained: this.turnGain.slice() };
    this.events.push({ type: 'turnEnd', gained: this.turnGain.slice() });
    this.turnGain = [];
    this.state = this.chances <= 0 || !this.alive().length ? 'over' : 'aim';
    if (this.state === 'over') this.events.push({ type: 'over' });
  }
}
