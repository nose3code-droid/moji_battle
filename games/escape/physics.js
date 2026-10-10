// 「あ、脱出する」の物理まわり：文字の形・世界・つまんで動かす操作・板（スイッチ）の判定
// 物理は Rapier の 2D 版（games/tower と同じ作り）。座標は m、y 上向き
import { glyphPolygons, centerPolygons, buildPrisms } from '../../glyph.js';
import { CHARS } from './rooms.js';

export const DT = 1 / 60;
const G = 9.81;
const EM = 2;               // 輪郭を取るときの em（m）。あとで枠に合わせて拡縮する
const PULL_K = 70, PULL_C = 16;  // つまんだ点を指へ引くバネの強さと減衰
const HOLD_TIME = 0.6;      // 板に乗せ続ける時間（秒）
const THROW_MAX = 15;       // なげる速さの上限（m/s）。持ち上げられない字はもっと遅い

// 1文字ぶんの形（外形・穴・当たり判定用の三角形）。w,h を渡すとその枠に合わせて拡縮する
export function makeShape(font, ch, w, h) {
  const polys = glyphPolygons(font, ch, EM);
  if (!polys.length) return null;
  const box = centerPolygons(polys);
  const sx = h ? w / box.x : w / Math.max(box.x, box.y), sy = h ? h / box.y : sx;
  for (const { outer, holes } of polys) for (const q of [...outer, ...holes.flat()]) { q.x *= sx; q.y *= sy; }
  // 細すぎる三角形は rapier2d が当たり判定を作れないので除く
  const tris = buildPrisms(polys, 1).map(p => [p[0], p[1], p[3], p[4], p[6], p[7]]).filter(t => {
    const area2 = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]));
    const edge = Math.max(Math.hypot(t[2] - t[0], t[3] - t[1]), Math.hypot(t[4] - t[2], t[5] - t[3]), Math.hypot(t[0] - t[4], t[1] - t[5]));
    return area2 / edge > 0.004;
  });
  return { ch, polys, tris, w: box.x * sx, h: box.y * sy };
}

// 点が輪郭の中か（穴は除く）
function inPolys(polys, x, y) {
  const inside = pts => {
    let r = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
  };
  return polys.some(p => inside(p.outer) && !p.holes.some(inside));
}

const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

export class Sim {
  constructor(RAPIER, room, shapes) {
    this.R = RAPIER; this.room = room;
    const world = this.world = new RAPIER.World({ x: 0, y: -G });
    world.timestep = DT;
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const poly of room.solids) {
      const d = RAPIER.ColliderDesc.convexHull(new Float32Array(poly.flat()));
      if (d) world.createCollider(d.setFriction(0.8), fixed);
    }
    this.pieces = room.pieces.map((def, i) => this._spawn(def, i, shapes.get(def.ch)));
    this.plates = room.plates.map(p => ({ ...p, t: 0 }));
    this.held = null;
    this.pointer = { x: 0, y: 0 };
    this.ptrV = { x: 0, y: 0 };   // 指の速さ（なげるときに使う）
    this.lastPtr = null;
    this.time = 0;
    this.solved = false;
    this.solvedFor = 0;
  }

  _spawn(def, id, shape) {
    const R = this.R, c = CHARS[def.ch];
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(def.x, def.y)
      .setAngularDamping(c.angDamp ?? 0.3).setLinearDamping(c.linearDamping ?? 0).setGravityScale(c.gravityScale ?? 1)
      .setCcdEnabled(true));
    const tune = d => d.setDensity(c.density).setFriction(c.friction).setRestitution(c.restitution ?? 0);
    if (c.ball) this.world.createCollider(tune(R.ColliderDesc.ball(c.ball)), body);
    else for (const t of shape.tris) {
      const d = R.ColliderDesc.convexHull(new Float32Array(t));
      if (!d) continue;
      try { this.world.createCollider(tune(d), body); } catch { /* 作れない三角形は無視 */ }
    }
    return { id, ch: def.ch, shape, body, spawn: def, grip: c.grip, flash: 0, baseAngDamp: c.angDamp ?? 0.3 };
  }

  respawn(p) {
    p.body.setTranslation({ x: p.spawn.x, y: p.spawn.y }, true);
    p.body.setRotation(0, true);
    p.body.setLinvel({ x: 0, y: 0 }, true);
    p.body.setAngvel(0, true);
    p.flash = 0.6;
    if (this.held?.piece === p) this.release();
  }

  pos(p) { return p.body.translation(); }
  inNoGrab(x, y) { return (this.room.nograb ?? []).some(r => inRect(r, x, y)); }

  // 指の位置にある文字（輪郭の中、なければいちばん近い字）
  pick(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.pieces) {
      const t = p.body.translation();
      if (this.inNoGrab(t.x, t.y)) continue;
      const a = p.body.rotation(), c = Math.cos(a), s = Math.sin(a);
      const dx = x - t.x, dy = y - t.y;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const d = Math.hypot(dx, dy);
      const ball = CHARS[p.ch].ball;
      if (ball ? d < ball + 0.12 : inPolys(p.shape.polys, lx, ly)) return p;
      const reach = Math.max(p.shape.w, p.shape.h) / 2 + 0.3;
      if (d < reach && d < bd) { best = p; bd = d; }
    }
    return best;
  }

  grab(x, y) {
    if (this.held || this.solved) return false;
    const p = this.pick(x, y);
    if (!p) return false;
    const t = p.body.translation(), a = p.body.rotation(), c = Math.cos(a), s = Math.sin(a);
    const dx = x - t.x, dy = y - t.y;
    this.held = { piece: p, lx: dx * c + dy * s, ly: -dx * s + dy * c };
    p.body.setAngularDamping(2);
    this.pointer = { x, y };
    this.lastPtr = { x, y }; this.ptrV = { x: 0, y: 0 };
    return true;
  }

  moveTo(x, y) { this.pointer = { x, y }; }

  release() {
    const h = this.held;
    if (!h) return;
    this.held = null;
    const b = h.piece.body, v = b.linvel();
    b.setAngularDamping(h.piece.baseAngDamp);
    // 体の速さと指の速さを混ぜて、はなした瞬間の速さにする（フリックで なげられる）
    let vx = (v.x + this.ptrV.x) / 2, vy = (v.y + this.ptrV.y) / 2;
    const cap = Math.min(THROW_MAX, h.piece.grip * 0.5), sp = Math.hypot(vx, vy);
    if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
    b.setLinvel({ x: vx, y: vy }, true);
  }

  _pull() {
    const h = this.held;
    if (!h) return;
    if (this.lastPtr) {
      const k = 0.5;
      this.ptrV = { x: this.ptrV.x * (1 - k) + (this.pointer.x - this.lastPtr.x) / DT * k, y: this.ptrV.y * (1 - k) + (this.pointer.y - this.lastPtr.y) / DT * k };
    }
    this.lastPtr = { ...this.pointer };
    const p = h.piece, b = p.body, t = b.translation(), a = b.rotation(), c = Math.cos(a), s = Math.sin(a);
    const rx = h.lx * c - h.ly * s, ry = h.lx * s + h.ly * c;
    const ax = t.x + rx, ay = t.y + ry;
    const lv = b.linvel(), w = b.angvel();
    const vx = lv.x - w * ry, vy = lv.y + w * rx;
    let fx = PULL_K * (this.pointer.x - ax) - PULL_C * vx, fy = PULL_K * (this.pointer.y - ay) - PULL_C * vy;
    const m = Math.hypot(fx, fy);
    if (m > p.grip) { fx *= p.grip / m; fy *= p.grip / m; }   // つまむ力には限りがある（おもい字は持ち上がらない）
    const mass = b.mass();
    b.applyImpulseAtPoint({ x: fx * mass * DT, y: fy * mass * DT }, { x: ax, y: ay }, true);
  }

  step() {
    this._pull();
    this.world.step();
    this.time += DT;
    const room = this.room;
    for (const p of this.pieces) {
      const t = p.body.translation();
      p.flash = Math.max(0, p.flash - DT);
      if (this.held?.piece === p && this.inNoGrab(t.x, t.y)) this.release();  // ビリビリ地帯では つかめない
      if ((room.voids ?? []).some(r => inRect(r, t.x, t.y)) || t.y < -4 || t.x < -1 || t.x > room.W + 1 || t.y > room.H + 1) this.respawn(p);
    }
    // 板：手で持っていない、合う字が、止まって乗っている間だけ たまる
    for (const pl of this.plates) {
      const on = this.pieces.some(p => {
        if (p.ch !== pl.accept || this.held?.piece === p) return false;
        const t = p.body.translation(), v = p.body.linvel();
        return t.x >= pl.x0 && t.x <= pl.x1 + (pl.reach ?? 0) && t.y >= pl.y0 && t.y <= pl.y1 && Math.hypot(v.x, v.y) < 3;
      });
      pl.t = on ? Math.min(HOLD_TIME + 0.2, pl.t + DT) : Math.max(0, pl.t - DT * 0.5);   // ちょっと離れても すぐには戻らない（はずむ字用）
    }
    if (!this.solved && this.plates.every(pl => pl.t >= HOLD_TIME)) { this.solved = true; this.release(); }
    if (this.solved) this.solvedFor += DT;
  }

  free() { this.world.free(); }
}
