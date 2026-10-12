// 文字サーキットの物理（固定刻み・乱数なし。同じ入力なら必ず同じ結果になる）
export const DT = 1 / 60;
const TAU = Math.PI * 2;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };

// 文字の性格（0〜1）→ 物理パラメータ
export function physicsFromStats(st) {
  return {
    vmax: 175 + 40 * st.speed,       // 最高速 (u/s)
    aLat: 100 + 440 * st.grip,       // 曲がれる横Gの上限
    gripK: 5 + 9 * st.grip,          // 横滑りを止める強さ
    acc: 80 + 150 * st.accel,        // 加速
    mass: 0.7 + 1.3 * st.mass,       // 衝突の重さ
    radius: st.radius,               // 当たり判定の半径
    wallLoss: 0.2 + 0.4 * st.spiky,  // 壁に強く当たったときに失う速度の割合
  };
}

export const DIFFICULTY = {
  easy:   { name: 'やさしい', skill: 0.8,  rb: 0.07, lineGain: 0.6 },
  normal: { name: 'ふつう',   skill: 0.9,  rb: 0.05, lineGain: 0.9 },
  hard:   { name: 'むずかしい', skill: 0.98, rb: 0.03, lineGain: 1.0 },
};

const BRAKE = 190;   // ブレーキの減速 (u/s²)
const SCRUB = 0.12;  // 横滑りで失う速度
const WIN = 14;      // 最寄り点の探索範囲（点の数）

// slot: 0 が先頭。コースのスタートラインの手前に千鳥に並べる
export function makeCar(id, phys, tr, slot, human) {
  const idx = (tr.N - Math.round((26 + slot * 30) / tr.ds) + tr.N) % tr.N;
  const side = slot % 2 === 0 ? -1 : 1;
  const off = side * tr.halfW * 0.4;
  const car = {
    id, human, phys, slot,
    x: tr.x[idx] + tr.nx[idx] * off, y: tr.y[idx] + tr.ny[idx] * off,
    h: Math.atan2(tr.ty[idx], tr.tx[idx]), vx: 0, vy: 0, steer: 0, yaw: 0,
    idx, c: 0, maxC: 0, lat: 0, dist: 0, prog: 0, t: 0,
    crossTicks: [], lapTimes: [], finishTick: -1, surf: 0, hits: 0,
    ai: { off: side * 8 },
  };
  locate(car, tr);
  car.maxC = car.c;
  return car;
}

export function makeWorld(tr, cars, laps) {
  return { track: tr, laps, tick: 0, cars, events: [] };
}

// 最寄りの中心線点・周回数・道の中心からのずれを更新
function locate(car, tr, w) {
  const N = tr.N;
  let best = car.idx, bd = Infinity;
  for (let k = -WIN; k <= WIN; k++) {
    const i = (car.idx + k + N) % N;
    const dx = car.x - tr.x[i], dy = car.y - tr.y[i], d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = i; }
  }
  if (car.idx - best > N / 2) {
    car.c++;
    if (w && car.c > car.maxC) {
      car.maxC = car.c;
      car.crossTicks[car.c] = car.t;
      if (car.c >= 2) car.lapTimes.push((car.t - car.crossTicks[car.c - 1]) * DT);
      if (car.c === w.laps + 1) car.finishTick = car.t;
      w.events.push({ type: 'cross', car, c: car.c, tick: car.t });
    }
  } else if (best - car.idx > N / 2) car.c--;
  car.idx = best;
  const dx = car.x - tr.x[best], dy = car.y - tr.y[best];
  car.lat = dx * tr.nx[best] + dy * tr.ny[best];
  car.dist = Math.sqrt(bd);
  car.prog = (car.c - 1) * N + best + (dx * tr.tx[best] + dy * tr.ty[best]) / tr.ds;
}

function driveCar(car, inp, tr) {
  const p = car.phys;
  // ステアリングはなめらかに追従（キー入力でも急に切れない）
  const rate = 7 * DT;
  car.steer += clamp(clamp(inp.steer, -1, 1) - car.steer, -rate, rate);

  const a = Math.abs(car.lat);
  const surf = a > tr.halfW ? 2 : a > tr.halfW - tr.kerbW ? 1 : 0; // 0 舗装 1 縁石 2 ダート
  car.surf = surf;
  const vmax = p.vmax * [1, 0.93, 0.5][surf];
  const aLat = p.aLat * [1, 0.9, 0.55][surf];

  let fx = Math.cos(car.h), fy = Math.sin(car.h);
  let f = car.vx * fx + car.vy * fy;
  if (inp.brake) f = Math.max(-15, f - BRAKE * DT);
  else if (f < vmax) f += p.acc * (1 - Math.max(f, 0) / vmax) * DT;
  if (f > vmax) f = Math.max(vmax, f - 260 * DT);

  // 旋回：速いほど回れる角速度が下がる。ブレーキ中の旋回はドリフト（曲がりやすいが滑る）
  const drift = inp.brake && Math.abs(car.steer) > 0.2;
  const sp = Math.abs(f);
  const omegaMax = Math.min(3.4, aLat * (drift ? 1.35 : 1) / Math.max(sp, 30));
  car.yaw = car.steer * omegaMax * Math.min(1, sp / 45) * (f >= 0 ? 1 : -1);
  car.h += car.yaw * DT;
  fx = Math.cos(car.h); fy = Math.sin(car.h);
  // 速度ベクトルは慣性で保ち、新しい向きに対する横成分を求めてグリップで消す
  let l = -car.vx * fy + car.vy * fx;
  const gripK = p.gripK * (drift ? 0.4 : 1) * [1, 0.9, 0.6][surf];
  const kill = l * (1 - Math.exp(-gripK * DT));
  l -= kill;
  if (f > 0) f = Math.max(0, f - Math.abs(kill) * SCRUB * (drift ? 1.3 : 1));
  car.vx = f * fx - l * fy;
  car.vy = f * fy + l * fx;
  car.x += car.vx * DT; car.y += car.vy * DT;
}

// 文字どうしの押し合い（円で近似。重いほど動かされにくい）
function collide(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), r = a.phys.radius + b.phys.radius;
  if (d >= r || d < 1e-6) return;
  const nx = dx / d, ny = dy / d, ia = 1 / a.phys.mass, ib = 1 / b.phys.mass;
  const push = (r - d) / (ia + ib);
  a.x -= nx * push * ia; a.y -= ny * push * ia;
  b.x += nx * push * ib; b.y += ny * push * ib;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn < 0) {
    const j = -(1 + 0.35) * vn / (ia + ib);
    a.vx -= j * nx * ia; a.vy -= j * ny * ia;
    b.vx += j * nx * ib; b.vy += j * ny * ib;
  }
}

// ダートの外の壁：押し戻し、強く当たると減速（角の多い字ほど大きく）
function wall(car, tr, w) {
  const lim = tr.wallPos - car.phys.radius;
  if (car.dist <= lim) return;
  const i = car.idx;
  const dx = car.x - tr.x[i], dy = car.y - tr.y[i], d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  car.x -= nx * (d - lim); car.y -= ny * (d - lim);
  const vn = car.vx * nx + car.vy * ny;
  if (vn > 0) {
    car.vx -= 1.25 * vn * nx; car.vy -= 1.25 * vn * ny;
    const k = 1 - car.phys.wallLoss * clamp(vn / 90, 0, 1);
    car.vx *= k; car.vy *= k;
    if (vn > 25) { car.hits++; w.events.push({ type: 'hit', car, power: vn }); }
  }
  car.vx *= 1 - 2.5 * DT; car.vy *= 1 - 2.5 * DT; // 壁をこする摩擦
  // 壁を向いたまま止まらないよう、少しだけ道の向きへ戻す
  car.h += clamp(angDiff(Math.atan2(tr.ty[i], tr.tx[i]), car.h), -1, 1) * 2 * DT;
}

export function stepWorld(w, playerInput, aiConf) {
  const tr = w.track;
  w.events.length = 0;
  const player = w.cars.find(c => c.human);
  for (const car of w.cars) {
    car.t = w.tick;
    const inp = car.human && car.finishTick < 0 ? playerInput : aiInput(car, w, aiConf, player);
    driveCar(car, inp, tr);
  }
  for (let i = 0; i < w.cars.length; i++) for (let j = i + 1; j < w.cars.length; j++) collide(w.cars[i], w.cars[j]);
  w.tick++;
  for (const car of w.cars) {
    car.t = w.tick;
    locate(car, tr, w);
    wall(car, tr, w);
    locate(car, tr, w);
  }
}

// 順位：ゴール済みはゴール順、まだの車は進んだ距離の順
export function ranking(w) {
  return w.cars.slice().sort((a, b) => {
    const fa = a.finishTick >= 0, fb = b.finishTick >= 0;
    if (fa && fb) return a.finishTick - b.finishTick || a.slot - b.slot;
    if (fa) return -1;
    if (fb) return 1;
    return b.prog - a.prog || a.slot - b.slot;
  });
}

// CPU（と自動操縦）：コースの先を見てラインをなぞり、曲率から出せる速度を決める
export function aiInput(car, w, conf, player) {
  const tr = w.track, N = tr.N, ds = tr.ds, p = car.phys;
  const v = Math.hypot(car.vx, car.vy);
  const La = Math.max(4, Math.round((20 + v * 0.38) / ds));
  const ti = (car.idx + La) % N;
  const off = tr.lineOff[ti] * conf.lineGain + car.ai.off;
  const tx = tr.x[ti] + tr.nx[ti] * off, ty = tr.y[ti] + tr.ny[ti] * off;
  const steer = clamp(angDiff(Math.atan2(ty - car.y, tx - car.x), car.h) * 3, -1, 1);

  const aL = p.aLat * conf.skill * 0.9, bd = BRAKE * 0.8;
  let vt = p.vmax;
  const look = Math.min(70, Math.ceil(v * v / (2 * bd) / ds) + 8);
  for (let k = 0; k <= look; k += 2) {
    const kap = tr.kapS[(car.idx + k) % N];
    if (kap < 1e-4) continue;
    const vl = Math.sqrt(aL / kap);
    vt = Math.min(vt, Math.sqrt(vl * vl + 2 * bd * k * ds));
  }
  // 追いかけ速度の調整（プレイヤーが遠いほど少し速く、離しすぎたら少し遅く）
  let mul = 1;
  if (player && player !== car && conf.rb > 0) mul += clamp((player.prog - car.prog) * ds / 500, -1, 1) * conf.rb;
  vt *= mul;
  const f = car.vx * Math.cos(car.h) + car.vy * Math.sin(car.h);
  return { steer, brake: f > vt + 4 };
}
