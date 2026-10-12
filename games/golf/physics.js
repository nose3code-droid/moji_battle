// 文字ゴルフの物理（自作の2D）。DOM にも three にも依存しない純粋な計算。
// 固定の時間刻み DT で進めるので、同じ文字・同じ打ち方・同じ開始状態なら必ず同じ結果になる。

export const DT = 1 / 120;
export const R = 11;              // ボールの半径
export const CUP_R = 17;          // カップの半径
export const G = 900;             // 摩擦の基準加速度（摩擦係数 mu をかけて使う）
export const V_MAX = 820;         // 引っぱりが最大のときの初速
export const PULL_MAX = 150;      // 引っぱりの最大長さ（コース座標）
export const ANGLE_STEP = Math.PI / 360; // 打つ向きは 0.5度刻み
export const POWER_STEP = 0.01;          // 強さは 1% 刻み
export const MAX_TICKS = 4800;    // 1打の最長（40秒）
export const REST_TICKS = 18;     // 止まったまま何刻み続いたら「止まった」とみなすか
const CUP_V = 330;                // これより速いとカップの上を飛び越える
const SAND_DRAG = 330;            // 砂の減速（重い字ほど深く沈む）

const clamp01 = x => Math.max(0, Math.min(1, x));
const q = x => Math.round(x * 50) / 50; // フォントの細かな差で結果が変わらないよう 0.02 刻みにそろえる

// 文字の形の指標 → ボールの性格。metrics: { area(em²), roundness(凸包の丸さ), aspect(外接箱の短辺/長辺) }
export function traitsFromMetrics({ area, roundness, aspect }) {
  const roll = q(clamp01((roundness - 0.7) / 0.3));   // 丸さ：よく転がり、止まりにくい
  const heavy = q(clamp01((area - 0.05) / 0.3));      // 重さ：インクの量。壁で跳ね返りにくく、砂に沈む
  const flat = q(clamp01((0.5 - aspect) / 0.4));      // 平たさ：滑る
  return {
    roll, heavy, flat,
    mu: q(0.5 - 0.27 * roll - 0.26 * flat),                         // 転がり摩擦
    vStop: Math.round(5 + 34 * (1 - roll) * (1 - 0.8 * flat)),      // この速さを切ると止まる（角ばった字は早めに止まる）
    power: q(1 - 0.16 * heavy),                                     // 重い字は同じ引きでも初速が少し落ちる
    bounce: q(clamp01(0.84 - 0.58 * heavy + 0.06 * roll)),          // 壁の反発
    sand: q(SAND_DRAG * (0.7 + 0.6 * heavy) * (1 - 0.35 * flat)),   // 砂の減速
  };
}

// 画面に出す 0〜1 の3つ：転がり・止まりやすさ・重さ（滑りやすさは補助）
export function traitView(t) {
  return {
    roll: clamp01((0.5 - t.mu) / 0.3),
    stop: clamp01(0.7 * (t.vStop - 5) / 34 + 0.3 * (t.mu - 0.2) / 0.3),
    heavy: t.heavy,
    slide: t.flat,
  };
}

// ---------- コース ----------
// hole: { outline:[[x,y]..], walls:[[[x,y]..]..](内側の壁の多角形), zones:[{type,...}], movers:[...], warps:[...], tee, cup, par }
// 壁の線分を前もって集める（静止している分）
export function prepareHole(hole) {
  if (hole._segs) return hole;
  const segs = [];
  const loop = pts => { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push(a[0], a[1], b[0], b[1]); } };
  loop(hole.outline);
  for (const w of hole.walls || []) loop(w);
  hole._segs = new Float64Array(segs);
  return hole;
}

// 動くしかけの、刻み t での姿勢 → 線分（太さ付き）と速度
// type 'windmill': 中心 (x,y)、腕の半長 len、回転 speed(rad/s)、arms 本数、phase
// type 'slider'  : 矩形 (w×h)、中心が (x,y) を基準に dir 方向へ amp だけ往復（周期 period 刻み）
export function moverSegments(m, t, out) {
  out.length = 0;
  if (m.type === 'windmill') {
    const w = m.speed, ang = (m.phase || 0) + w * t * DT;
    const arms = m.arms || 2;
    for (let k = 0; k < arms; k++) {
      const a = ang + k * Math.PI * 2 / arms;
      const c = Math.cos(a), s = Math.sin(a);
      // 端点 (x1,y1)-(x2,y2)、太さ th。速度は回転による（点ごとに ω×r）
      out.push({ x1: m.x, y1: m.y, x2: m.x + c * m.len, y2: m.y + s * m.len, th: m.th || 4, rot: { x: m.x, y: m.y, w } });
    }
  } else if (m.type === 'slider') {
    const ph = Math.PI * 2 * t / m.period + (m.phase || 0);
    const off = Math.sin(ph) * m.amp, vel = Math.cos(ph) * m.amp * Math.PI * 2 / m.period / DT;
    const cx = m.x + m.dx * off, cy = m.y + m.dy * off;
    const vx = m.dx * vel, vy = m.dy * vel;
    const hw = m.w / 2, hh = m.h / 2;
    const P = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4];
      out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], th: 0, vx, vy });
    }
  }
  return out;
}

const inRect = (z, x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
const inZone = (z, x, y) => z.r ? (x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r : inRect(z, x, y);

// 打つ向き angle（ラジアン、0 が +x、y は下向き）と強さ power(0..1) を刻みにそろえる
export function quantizeShot(angle, power) {
  let a = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return { angle: a, power: Math.max(POWER_STEP, Math.min(1, Math.round(power / POWER_STEP) * POWER_STEP)) };
}

// 1打ぶんを最後まで計算する。
// start: {x, y, t}（t はその面の経過刻み。動くしかけの位置が決まる）。shot: {angle, power}
// 返り値: { result: 'rest'|'cup'|'water', frames: Float32Array [x,y,rot,t, ...], end:{x,y,t}, ticks }
export function simulateShot(hole, traits, start, shot, keepFrames = true) {
  prepareHole(hole);
  const segs = hole._segs;
  const sh = quantizeShot(shot.angle, shot.power);
  let x = start.x, y = start.y, t = start.t;
  const sp0 = V_MAX * sh.power * traits.power;
  let vx = Math.cos(sh.angle) * sp0, vy = Math.sin(sh.angle) * sp0;
  let rot = 0, rest = 0, result = 'rest';
  const frames = [];
  const movers = hole.movers || [];
  const tmp = [];
  const zones = hole.zones || [];
  let warpLock = false;
  const cup = hole.cup;
  let slopeAx = 0, slopeAy = 0, onSand = false;

  const hit = (x1, y1, x2, y2, th, wvx, wvy, rot_) => {
    // 円 (x,y,R) と太さ th の線分の衝突
    const ex = x2 - x1, ey = y2 - y1;
    const l2 = ex * ex + ey * ey;
    let u = l2 > 0 ? ((x - x1) * ex + (y - y1) * ey) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = x1 + ex * u, py = y1 + ey * u;
    let dx = x - px, dy = y - py;
    const d2 = dx * dx + dy * dy, rr = R + th;
    if (d2 >= rr * rr) return;
    let d = Math.sqrt(d2), nx, ny;
    if (d < 1e-6) { const l = Math.sqrt(l2) || 1; nx = -ey / l; ny = ex / l; d = 0; } else { nx = dx / d; ny = dy / d; }
    x = px + nx * rr; y = py + ny * rr; // めり込みを押し出す
    // 壁自身の速度（回転する腕はその点の速さ）
    let ux = wvx || 0, uy = wvy || 0;
    if (rot_) { ux = -rot_.w * (py - rot_.y); uy = rot_.w * (px - rot_.x); }
    const rvx = vx - ux, rvy = vy - uy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = -vn < 25 ? 0 : traits.bounce;
      vx -= (1 + e) * vn * nx; vy -= (1 + e) * vn * ny;
      // 壁をこする分の摩擦（少しだけ）
      const tx = -ny, ty = nx, vt = (vx - ux) * tx + (vy - uy) * ty;
      vx -= vt * 0.04 * tx; vy -= vt * 0.04 * ty;
    }
  };

  for (let i = 0; i < MAX_TICKS; i++) {
    // --- 地形（坂・砂） ---
    slopeAx = 0; slopeAy = 0; onSand = false;
    for (const z of zones) {
      if (!inZone(z, x, y)) continue;
      if (z.type === 'slope') { slopeAx += z.ax; slopeAy += z.ay; }
      else if (z.type === 'sand') onSand = true;
      else if (z.type === 'water') { result = 'water'; break; }
    }
    if (result === 'water') { if (keepFrames) frames.push(x, y, rot, t); break; }

    // --- 力：坂 → 摩擦 ---
    vx += slopeAx * DT; vy += slopeAy * DT;
    const sMag = Math.hypot(slopeAx, slopeAy);
    const af = G * traits.mu + (onSand ? traits.sand : 0);
    let sp = Math.hypot(vx, vy);
    if (sp * 1 <= af * DT) {
      if (sMag <= af) { vx = 0; vy = 0; } else { const k = (sMag - af) * DT / sMag; vx = slopeAx * k; vy = slopeAy * k; }
    } else if (sp < traits.vStop && sMag <= af) { vx = 0; vy = 0; }
    else { const k = (sp - af * DT) / sp; vx *= k; vy *= k; }
    sp = Math.hypot(vx, vy);

    // --- カップ：ゆっくりなら引き込まれる ---
    const cdx = cup.x - x, cdy = cup.y - y, cd = Math.hypot(cdx, cdy);
    if (cd < CUP_R * 1.5 && sp < CUP_V) {
      if (cd < CUP_R * 0.62 || (cd < CUP_R && sp < 120)) { result = 'cup'; x = cup.x; y = cup.y; if (keepFrames) frames.push(x, y, rot, t); break; }
      const pull = 520 * DT * (1 - cd / (CUP_R * 1.5));
      vx += cdx / cd * pull; vy += cdy / cd * pull;
    }

    // --- 進める ---
    x += vx * DT; y += vy * DT;
    rot += (vx >= 0 ? 1 : -1) * sp * DT / R * (0.3 + 0.7 * traits.roll); // 転がるほど回る
    t++;

    // --- 壁 ---
    for (let k = 0; k < segs.length; k += 4) hit(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], 0, 0, 0, null);
    for (const m of movers) for (const s of moverSegments(m, t, tmp)) hit(s.x1, s.y1, s.x2, s.y2, s.th, s.vx, s.vy, s.rot);
    for (let k = 0; k < segs.length; k += 4) hit(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], 0, 0, 0, null); // 動く壁で押し込まれた分を戻す

    // --- ワープ ---
    let near = false;
    for (const w of hole.warps || []) {
      const d = Math.hypot(x - w.from.x, y - w.from.y);
      if (d < w.r + R * 0.5) near = true;
      if (!warpLock && d < w.r * 0.7) { x = w.to.x; y = w.to.y; vx *= 0.8; vy *= 0.8; warpLock = true; near = true; break; }
      const d2 = Math.hypot(x - w.to.x, y - w.to.y);
      if (d2 < w.r + R * 0.5) near = true;
    }
    if (!near) warpLock = false;

    if (keepFrames) frames.push(x, y, rot, t);
    if (vx === 0 && vy === 0) { if (++rest >= REST_TICKS) break; } else rest = 0;
  }
  if (result === 'rest' && Math.hypot(vx, vy) > 0 && frames.length === 0 && keepFrames) frames.push(x, y, rot, t);
  return { result, frames: keepFrames ? new Float32Array(frames) : null, end: { x, y, t }, ticks: t - start.t };
}
