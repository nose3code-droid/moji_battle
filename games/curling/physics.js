// 文字カーリングの物理（自作の2D剛体）。DOM にも three にも依存しない純粋な計算。
// 固定の時間刻み DT で進めるので、同じ配置・同じ投げ方・同じスイープ入力なら必ず同じ結果になる。
// 座標：ハウスの中心が原点、x は右、y は下（投げる側が +y）。角度は時計回りが正。

export const DT = 1 / 180;
export const R = 13;                       // 丸い字の基準半径
export const SHEET = {
  halfW: 82,       // サイドライン（中心がこれを越えたら場外）
  backY: -72,      // バックライン（ストーンが完全に越えたら場外）
  hogY: 215,       // ホッグライン（越えない投は無効）
  hackY: 330,      // 投げる位置
  houseR: 60,      // ハウスの半径
  viewTop: -98, viewBottom: 352,
};
export const G = 300;                      // 摩擦の基準加速度（摩擦係数 mu をかけて使う）
export const VMAX = 145;                   // 引っぱり最大のときの初速
export const W0 = 2.4;                     // 投げたときの回転の速さ（rad/s）
export const CURL_K = 1.0;                 // 曲がりの基準加速度
export const MAX_STEPS = 180 * 22;         // 1投の最長（22秒）
export const ANGLE_STEP = Math.PI / 720;   // 向きは 0.25 度刻み
export const POWER_STEP = 0.01;            // 強さは 1% 刻み
export const ANGLE_MAX = 0.6;
const ITER = 3;                            // 衝突の反復回数
const FRICTION_C = 0.12;                   // ストーン同士の接線摩擦

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function quantizeShot(shot) {
  const angle = clamp(Math.round(shot.angle / ANGLE_STEP) * ANGLE_STEP, -ANGLE_MAX, ANGLE_MAX);
  const power = clamp(Math.round(shot.power / POWER_STEP) * POWER_STEP, POWER_STEP, 1);
  return { angle, power, spin: shot.spin >= 0 ? 1 : -1 };
}

// 位置・向きから、各凸ピースのワールド座標を作り直す
function updateWorldPieces(s) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), pcs = s.def.pieces;
  if (!s.wp) { s.wp = pcs.map(p => new Float64Array(p.length)); s.wb = pcs.map(() => new Float64Array(4)); }
  for (let k = 0; k < pcs.length; k++) {
    const p = pcs[k], w = s.wp[k], b = s.wb[k];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < p.length; i += 2) {
      const x = s.x + c * p[i] - sn * p[i + 1], y = s.y + sn * p[i] + c * p[i + 1];
      w[i] = x; w[i + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    b[0] = x0; b[1] = y0; b[2] = x1; b[3] = y1;
  }
  s.dirty = false;
}

// 凸多角形どうしの SAT。重なっていれば out に法線(A→B)・深さ・接触点を入れて true
function sat(pa, pb, out) {
  const na = pa.length >> 1, nb = pb.length >> 1;
  let ax = 0, ay = 0, bx = 0, by = 0;
  for (let i = 0; i < pa.length; i += 2) { ax += pa[i]; ay += pa[i + 1]; }
  for (let i = 0; i < pb.length; i += 2) { bx += pb[i]; by += pb[i + 1]; }
  const dcx = bx / nb - ax / na, dcy = by / nb - ay / na;
  let best = 1e18, bnx = 0, bny = 0, bpass = 0;
  for (let pass = 0; pass < 2; pass++) {
    const P = pass ? pb : pa, n = pass ? nb : na;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let nx = P[2 * j + 1] - P[2 * i + 1], ny = -(P[2 * j] - P[2 * i]);
      const l = Math.hypot(nx, ny);
      if (l < 1e-12) continue;
      nx /= l; ny /= l;
      let minA = 1e18, maxA = -1e18, minB = 1e18, maxB = -1e18;
      for (let k = 0; k < na; k++) { const d = pa[2 * k] * nx + pa[2 * k + 1] * ny; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (let k = 0; k < nb; k++) { const d = pb[2 * k] * nx + pb[2 * k + 1] * ny; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      const ov = Math.min(maxA - minB, maxB - minA);
      if (ov <= 0) return false;
      if (ov < best) {
        best = ov; bpass = pass;
        if (dcx * nx + dcy * ny < 0) { nx = -nx; ny = -ny; }
        bnx = nx; bny = ny;
      }
    }
  }
  // 接触点：基準の面を持たないほうの、いちばん深く入った頂点
  let px = 0, py = 0;
  if (bpass === 0) { // 基準は A の面 → B の頂点で n 方向にいちばん手前のもの
    let m = 1e18;
    for (let k = 0; k < nb; k++) { const d = pb[2 * k] * bnx + pb[2 * k + 1] * bny; if (d < m) { m = d; px = pb[2 * k]; py = pb[2 * k + 1]; } }
  } else {
    let m = -1e18;
    for (let k = 0; k < na; k++) { const d = pa[2 * k] * bnx + pa[2 * k + 1] * bny; if (d > m) { m = d; px = pa[2 * k]; py = pa[2 * k + 1]; } }
  }
  out.nx = bnx; out.ny = bny; out.depth = best; out.px = px; out.py = py;
  return true;
}

export class World {
  constructor() { this.stones = []; this.tick = 0; this.events = []; this.activeId = 0; this.nextId = 1; }

  clone() {
    const w = new World();
    w.tick = this.tick; w.activeId = this.activeId; w.nextId = this.nextId;
    w.stones = this.stones.map(s => ({ ...s, wp: null, wb: null, dirty: true }));
    return w;
  }

  // ストーンを置く（盤面の初期化・テスト用）
  addStone(def, team, x, y, extra = {}) {
    const s = {
      id: this.nextId++, def, team, x, y, a: 0, vx: 0, vy: 0, w: 0, spin: 1, curling: false,
      out: null, wp: null, wb: null, dirty: true, ...extra,
    };
    this.stones.push(s);
    return s;
  }

  // 手前から投げる。投げたストーンを返す
  launch(def, team, shot) {
    const q = quantizeShot(shot);
    const s = this.addStone(def, team, 0, SHEET.hackY);
    const v = VMAX * q.power * def.traits.power;
    s.vx = Math.sin(q.angle) * v; s.vy = -Math.cos(q.angle) * v;
    s.w = q.spin * W0; s.spin = q.spin; s.curling = true;
    this.activeId = s.id;
    return s;
  }

  settled() {
    for (const s of this.stones) if (!s.out && (s.vx !== 0 || s.vy !== 0 || s.w !== 0)) return false;
    return true;
  }

  // 1刻み進める。sweeping: 今投げているストーンをスイープしているか
  step(sweeping) {
    const st = this.stones;
    this.tick++;
    for (const s of st) {
      if (s.out) continue;
      const t = s.def.traits;
      let sp = Math.hypot(s.vx, s.vy);
      if (sp > 0) {
        const sw = sweeping && s.id === this.activeId;
        // カール：進行方向に垂直（スイープすると減る）
        if (s.curling && sp > t.vStop) {
          const k = CURL_K * t.curl * (sw ? 0.4 : 1) * s.spin * DT / sp;
          const vx = s.vx, vy = s.vy;
          s.vx += -vy * k; s.vy += vx * k;
          sp = Math.hypot(s.vx, s.vy);
        }
        // 摩擦：スイープで減り、遅くなると引っかかって止まりやすい
        let a = t.mu * G * (sw ? t.sweepMul : 1);
        if (sp < t.vStop) a *= 3;
        if (sp <= a * DT) { s.vx = 0; s.vy = 0; } else { const k = (sp - a * DT) / sp; s.vx *= k; s.vy *= k; }
      }
      if (s.w !== 0) {
        s.w *= (s.vx !== 0 || s.vy !== 0) ? 1 - 0.1 * DT : 1 - 1.5 * DT;
        if (Math.abs(s.w) < 0.03 && s.vx === 0 && s.vy === 0) s.w = 0;
      }
      if (s.vx !== 0 || s.vy !== 0 || s.w !== 0) {
        s.x += s.vx * DT; s.y += s.vy * DT; s.a += s.w * DT; s.dirty = true;
      }
    }
    // 衝突
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < st.length; i++) {
        const A = st[i];
        if (A.out) continue;
        for (let j = i + 1; j < st.length; j++) {
          const B = st[j];
          if (B.out) continue;
          if (A.vx === 0 && A.vy === 0 && A.w === 0 && B.vx === 0 && B.vy === 0 && B.w === 0) continue;
          const rr = A.def.radius + B.def.radius;
          const dx = B.x - A.x, dy = B.y - A.y;
          if (dx * dx + dy * dy > rr * rr) continue;
          this._collide(A, B);
        }
      }
    }
    // 場外
    for (const s of st) {
      if (s.out) continue;
      if (Math.abs(s.x) > SHEET.halfW) this._kill(s, 'side');
      else if (s.y < SHEET.backY - R) this._kill(s, 'back');
    }
  }

  _kill(s, why) {
    s.out = why; s.vx = s.vy = s.w = 0;
    this.events.push({ x: s.x, y: s.y, v: 0, out: true });
  }

  _collide(A, B) {
    if (A.dirty || !A.wp) updateWorldPieces(A);
    if (B.dirty || !B.wp) updateWorldPieces(B);
    const c = this._c || (this._c = {});
    for (let ka = 0; ka < A.wp.length; ka++) {
      const ba = A.wb[ka];
      for (let kb = 0; kb < B.wp.length; kb++) {
        const bb = B.wb[kb];
        if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) continue;
        if (!sat(A.wp[ka], B.wp[kb], c)) continue;
        this._resolve(A, B, c);
        if (A.dirty) updateWorldPieces(A);
        if (B.dirty) updateWorldPieces(B);
      }
    }
  }

  _resolve(A, B, c) {
    const nx = c.nx, ny = c.ny;
    const imA = 1 / A.def.mass, imB = 1 / B.def.mass, iiA = 1 / A.def.inertia, iiB = 1 / B.def.inertia;
    const rax = c.px - A.x, ray = c.py - A.y, rbx = c.px - B.x, rby = c.py - B.y;
    const vrx = (B.vx - B.w * rby) - (A.vx - A.w * ray), vry = (B.vy + B.w * rbx) - (A.vy + A.w * rax);
    const vn = vrx * nx + vry * ny;
    if (vn < 0) {
      const e = -vn < 10 ? 0 : (A.def.traits.bounce + B.def.traits.bounce) / 2;
      const raxn = rax * ny - ray * nx, rbxn = rbx * ny - rby * nx;
      const den = imA + imB + raxn * raxn * iiA + rbxn * rbxn * iiB;
      const j = -(1 + e) * vn / den;
      A.vx -= j * imA * nx; A.vy -= j * imA * ny; A.w -= iiA * j * raxn;
      B.vx += j * imB * nx; B.vy += j * imB * ny; B.w += iiB * j * rbxn;
      // 接線方向の摩擦（氷なので小さい）
      const tx = -ny, ty = nx;
      const wrx = (B.vx - B.w * rby) - (A.vx - A.w * ray), wry = (B.vy + B.w * rbx) - (A.vy + A.w * rax);
      const vt = wrx * tx + wry * ty;
      const ratn = rax * ty - ray * tx, rbtn = rbx * ty - rby * tx;
      const dt = imA + imB + ratn * ratn * iiA + rbtn * rbtn * iiB;
      const jt = clamp(-vt / dt, -FRICTION_C * j, FRICTION_C * j);
      A.vx -= jt * imA * tx; A.vy -= jt * imA * ty; A.w -= iiA * jt * ratn;
      B.vx += jt * imB * tx; B.vy += jt * imB * ty; B.w += iiB * jt * rbtn;
      A.curling = false; B.curling = false;
      if (-vn > 14) this.events.push({ x: c.px, y: c.py, v: -vn, nx, ny });
    }
    // めり込みを押し戻す
    const corr = Math.max(c.depth - 0.02, 0) * 0.7 / (imA + imB);
    A.x -= nx * corr * imA; A.y -= ny * corr * imA;
    B.x += nx * corr * imB; B.y += ny * corr * imB;
    A.dirty = true; B.dirty = true;
  }

  // 止まるまで進める。sweep は true/false か (tick)=>bool
  run(sweep = false, maxSteps = MAX_STEPS) {
    const fn = typeof sweep === 'function' ? sweep : () => sweep;
    const t0 = this.tick;
    while (this.tick - t0 < maxSteps) {
      this.step(fn(this.tick - t0));
      if (this.settled()) break;
    }
    return this.tick - t0;
  }
}

// ---------- ルール ----------
export const distToTee = s => Math.hypot(s.x, s.y);
export const inHouse = s => !s.out && distToTee(s) < SHEET.houseR + 8;

// 投げたストーンが止まったあとの判定。無効なら理由を返し、盤面から外す
export function judgeThrown(s) {
  if (!s.out && s.y > SHEET.hogY - 2) s.out = 'hog';
  return s.out;
}

// エンドの得点：{ team(得点したチーム or -1), points, ranked }
export function scoreEnd(world) {
  const list = world.stones.filter(inHouse).map(s => ({ team: s.team, d: distToTee(s) })).sort((a, b) => a.d - b.d);
  if (!list.length) return { team: -1, points: 0, ranked: list };
  const team = list[0].team;
  let pts = 0;
  for (const e of list) { if (e.team === team) pts++; else break; }
  return { team, points: pts, ranked: list };
}

// 盤面の評価（team から見て大きいほどよい）：今の得点差＋ハウス内の近さ＋ガード
export function evalBoard(world, team, early) {
  const sc = scoreEnd(world);
  let v = sc.team < 0 ? 0 : (sc.team === team ? 1 : -1) * sc.points * 10;
  for (const s of world.stones) {
    if (s.out) continue;
    const sign = s.team === team ? 1 : -1;
    const d = distToTee(s);
    if (d < SHEET.houseR + 8) v += sign * (1 - d / (SHEET.houseR + 8)) * 3;
    else if (early && s.y > 70 && s.y < SHEET.hogY && Math.abs(s.x) < 40) v += sign * 1.2; // ガード
  }
  return v;
}
