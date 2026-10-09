// 取組（1番の勝負）の物理。土俵の板と2人の力士（文字）を1つの物理ワールドに置く
// 画面の横方向が x、上が y。奥行き z には動かさない（2D の紙相撲）
import { glyphPolygons, centerPolygons, buildPrisms } from '../../glyph.js';

export const GLYPH_SIZE = 1.0;   // 1em の大きさ（m）
export const DEPTH = 0.3;        // 文字の厚み（m）
export const RING_R = 2.0;       // 土俵の半径（m）。物理では直径の板として扱う
export const RING_H = 0.5;       // 土俵の高さ（板の上面 y=0、まわりの地面 y=-RING_H）
export const DT = 1 / 240;       // 叩いた振動は速いので細かく刻む
const TIME_LIMIT = 45;           // これを過ぎたら引き分け（水入り）
const FOOT_FRAC = 0.3;           // 文字の下から3割までが「足」。それより上が土俵につくと負け
const TOUCH = 0.015;             // これより土俵に近づいたら「ついた」とみなす（m）
const AREA_REF = 0.3;            // 重さの基準になる面積（m²）。だいたい「山」くらい

// 土俵の板の揺れ（ばね）と、1回叩いたときの力。調整用に外から書き換えられるようにしておく
export const TUNE = {
  freq: 9,          // 上下の揺れの固有振動数（Hz）
  freqA: 7,         // 傾きの固有振動数（Hz）
  zeta: 0.25,       // 減衰比
  tapVy: 1.6,       // 叩いたときに板が跳ね上がる速さ（m/s）
  tapVa: 1.4,       // 叩いた側が持ち上がる回転（rad/s）
  lunge: 0.25,      // 叩いた側の力士が足をついていれば、相手へ向かって踏み込む速さ（m/s）
  lungeH: 0.5,      // 踏み込む力をかける高さ（重心から上へ、背丈に対する割合）。高いほど前のめりになる
  friction: 0.8,
  balance: 12,      // 踏ん張り：傾きを戻そうとする力（重さ×重力×背丈×角度 に対する倍率）
  balanceMax: 0.45, // 踏ん張りの上限（重さ×重力×この長さ m）。「ノ」のような一本足の字もこれで立てる
  balanceFade: [8, 25], // この角度（度）を越えると踏ん張りが弱まり、2つ目の角度で効かなくなる（あとは形しだい）
  balanceD: 0.08,   // 踏ん張りの減衰（秒）
};

// 三角形の集まりから面積と重心を求める（2D）
function areaCentroid(prisms) {
  let A = 0, cx = 0, cy = 0;
  for (const p of prisms) {
    const ax = p[0], ay = p[1], bx = p[3], by = p[4], qx = p[6], qy = p[7];
    const a = Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2;
    A += a; cx += a * (ax + bx + qx) / 3; cy += a * (ay + by + qy) / 3;
  }
  return { A, cx: cx / A, cy: cy / A };
}

// 文字の形から「倒れにくさ」を見積もる：重心が足の端を越えるまでに傾けられる角度（小さい方）
function stability(polys, com, minY) {
  const feet = polys.flatMap(p => p.outer).filter(q => q.y < minY + 0.04 * GLYPH_SIZE);
  const xl = Math.min(...feet.map(q => q.x)), xr = Math.max(...feet.map(q => q.x));
  const hgt = Math.max(com.cy - minY, 1e-3);
  const left = Math.atan2(com.cx - xl, hgt), right = Math.atan2(xr - com.cx, hgt);
  return Math.max(0, Math.min(left, right)) * 180 / Math.PI;
}

function createWrestler(RAPIER, world, font, ch, side) {
  const polys = glyphPolygons(font, ch, GLYPH_SIZE);
  if (!polys.length) return null;
  const size = centerPolygons(polys);
  const prisms = buildPrisms(polys, DEPTH);
  if (!prisms.length) return null;
  const outline = polys.flatMap(p => p.outer);
  const minY = Math.min(...outline.map(q => q.y));
  const footTop = minY + FOOT_FRAC * size.y;
  // 判定に使う点：足より上の輪郭の点だけ（体の座標系）
  const upper = outline.filter(q => q.y > footTop).map(q => [q.x, q.y]);
  const all = outline.map(q => [q.x, q.y]);

  const dir = side === 0 ? -1 : 1;
  const x = dir * (size.x / 2 + 0.08); // 仕切り：顔を突き合わせて立つ
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, size.y / 2 + 0.01, 0)
    .enabledTranslations(true, true, false)
    .enabledRotations(false, false, true)
    .setCcdEnabled(true));
  // 重さは面積そのままだと画数の多い字が強すぎるので、面積の平方根に比例させる
  const com = areaCentroid(prisms);
  const density = Math.sqrt(AREA_REF / com.A);
  for (const pts of prisms) {
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (desc) world.createCollider(desc.setDensity(density).setFriction(TUNE.friction).setRestitution(0), body);
  }
  return {
    ch, side, polys, body, upper, all,
    stats: { mass: body.mass(), stability: stability(polys, com, minY), height: size.y, width: size.x },
    lost: '',
  };
}

export function createBout(RAPIER, font, chs) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  // 土俵の板：位置を直接動かす（kinematic）。上面が y=0
  const board = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  world.createCollider(RAPIER.ColliderDesc.cuboid(RING_R, 0.1, 1).setTranslation(0, -0.1, 0)
    .setFriction(TUNE.friction).setRestitution(0), board);
  // まわりの地面
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -RING_H - 0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 2).setFriction(0.8), floor);

  const wrestlers = chs.map((ch, i) => createWrestler(RAPIER, world, font, ch, i));
  if (wrestlers.some(w => !w)) { world.free(); return null; }
  return {
    world, board, wrestlers,
    pose: { y: 0, a: 0, vy: 0, va: 0 },
    elapsed: 0, done: false, winner: -1, kimarite: '', taps: [0, 0],
  };
}

// side の側から土俵を叩く（0=左、1=右）。板が跳ね上がり（叩いた側ほど大きく）、
// 紙相撲の力士が前のめりに歩くのと同じく、足がついていれば自分の力士が相手へ踏み込む
export function tap(b, side) {
  if (b.done) return;
  const s = side === 0 ? 1 : -1;
  b.pose.vy += TUNE.tapVy;
  b.pose.va -= s * TUNE.tapVa;  // 左を叩くと左が上がる（時計回り）
  b.taps[side]++;
  const w = b.wrestlers[side];
  if (grounded(b, w)) {
    const m = w.body.mass(), c = w.body.worldCom();
    w.body.applyImpulseAtPoint({ x: s * TUNE.lunge * m, y: 0, z: 0 },
      { x: c.x, y: c.y + TUNE.lungeH * w.stats.height, z: 0 }, true);
  }
}

// 点を土俵の板の座標系に直す
function toBoard(p, x, y) {
  const c = Math.cos(p.a), s = Math.sin(p.a), dx = x, dy = y - p.y;
  return [c * dx + s * dy, -s * dx + c * dy];
}

// 体の座標系の点を世界座標へ
function toWorld(w, [lx, ly]) {
  const t = w.body.translation(), q = w.body.rotation();
  const a = 2 * Math.atan2(q.z, q.w), c = Math.cos(a), s = Math.sin(a);
  return [t.x + c * lx - s * ly, t.y + s * lx + c * ly];
}

// 負けの判定：'out'（土俵の外に出た）/ 'fall'（手や頭が土俵についた）/ ''
function judge(b, w) {
  for (const v of w.all) {
    const [wx, wy] = toWorld(w, v);
    if (wy < -RING_H + 0.03) return 'out';                        // 外の地面についた
    const [bx, by] = toBoard(b.pose, wx, wy);
    if (Math.abs(bx) > RING_R && by < -0.03) return 'out';          // 俵を越えて下に落ちかけた
  }
  for (const v of w.upper) {
    const [bx, by] = toBoard(b.pose, ...toWorld(w, v));
    if (Math.abs(bx) <= RING_R && by < TOUCH) return 'fall';
  }
  return '';
}

// 足（どこか）が土俵の板についているか
function grounded(b, w) {
  return w.all.some(v => toBoard(b.pose, ...toWorld(w, v))[1] < 0.03);
}

// 傾き（板に対する角度、rad）
export function tilt(b, w) {
  const q = w.body.rotation();
  let a = 2 * Math.atan2(q.z, q.w) - b.pose.a;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// 踏ん張り：どの文字にも同じ強さで、まっすぐ立とうとするトルクをかける。
// 形が不安定な字（重心が足から外れている字）は、この力を使い切って倒れやすい
function balance(w) {
  const q = w.body.rotation();
  const a = 2 * Math.atan2(q.z, q.w), av = w.body.angvel().z;
  const mg = w.stats.mass * 9.81;
  let t = -(TUNE.balance * w.stats.height * a + TUNE.balanceD * av * w.stats.height) * mg;
  const [f0, f1] = TUNE.balanceFade, deg = Math.abs(a) * 180 / Math.PI;
  const max = TUNE.balanceMax * mg * Math.max(0, Math.min(1, (f1 - deg) / (f1 - f0)));
  t = Math.max(-max, Math.min(max, t));
  w.body.applyTorqueImpulse({ x: 0, y: 0, z: t * DT }, true);
}

const KIMARITE = { out: ['押し出し', '寄り切り', '突き出し'], fall: ['突き倒し', '押し倒し', '叩き込み'] };

// 1ステップ進める。勝負がついたあとも、倒れる様子を見せるために物理だけは進める
export function stepBout(b) {
  // 板のばね（半陰的オイラー）
  const p = b.pose;
  const wy = 2 * Math.PI * TUNE.freq, wa = 2 * Math.PI * TUNE.freqA;
  p.vy += (-wy * wy * p.y - 2 * TUNE.zeta * wy * p.vy) * DT;
  p.va += (-wa * wa * p.a - 2 * TUNE.zeta * wa * p.va) * DT;
  p.y += p.vy * DT; p.a += p.va * DT;
  b.board.setNextKinematicTranslation({ x: 0, y: p.y, z: 0 });
  b.board.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(p.a / 2), w: Math.cos(p.a / 2) });
  if (!b.done) for (const w of b.wrestlers) balance(w);
  b.world.step();
  if (b.done) return;
  b.elapsed += DT;

  const res = b.wrestlers.map(w => judge(b, w));
  if (res[0] || res[1]) {
    b.done = true;
    if (res[0] && res[1]) { b.winner = -1; b.kimarite = '同体'; return; }
    const loser = res[0] ? 0 : 1;
    b.winner = 1 - loser;
    b.wrestlers[loser].lost = res[loser];
    b.wrestlers[b.winner].body.setLinearDamping(4); // 勝った方は勢いを止めて土俵に残る
    const list = KIMARITE[res[loser]];
    b.kimarite = list[Math.floor(Math.random() * list.length)];
    return;
  }
  if (b.elapsed >= TIME_LIMIT) { b.done = true; b.winner = -1; b.kimarite = '水入り'; }
}

// CPU：強さごとの連打の速さ（回/秒）と、自分の力士が傾いているときに叩くのを待つ賢さ（0〜1）
export const CPU_LEVELS = {
  weak: { label: 'よわい', rate: 4, smart: 0 },
  normal: { label: 'ふつう', rate: 6, smart: 0.3 },
  strong: { label: 'つよい', rate: 9, smart: 0.6 },
};

export function createCpu(level) {
  return { ...CPU_LEVELS[level], next: 0.15 + Math.random() * 0.2 };
}

// 毎ステップ呼ぶ。叩くタイミングが来たら叩く
export function cpuStep(cpu, b, side) {
  if (b.done || b.elapsed < cpu.next) return;
  const w = b.wrestlers[side];
  if (Math.abs(tilt(b, w)) > 0.2 && Math.random() < cpu.smart) { cpu.next = b.elapsed + 0.06; return; } // 立て直すのを待つ
  tap(b, side);
  cpu.next = b.elapsed + (0.7 + 0.6 * Math.random()) / cpu.rate;
}

export function disposeBout(b) {
  b?.world.free();
}
