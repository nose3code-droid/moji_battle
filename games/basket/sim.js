// 文字バスケット：1球を投げて、リングに入るかまでを物理（Rapier 2D）で計算する
// 球ごとに専用の物理ワールドを作る（毎回まっさらな状態から始めるので、同じ入力なら必ず同じ結果になる）
import { glyphPolygons, shapeMetrics, centerPolygons, buildPrisms } from '../../glyph.js';
import { STAGES, LAUNCH, WORLD_L, WORLD_R, ringPos } from './stages.js';

export const DT = 1 / 60;          // 固定の時間刻み
export const EM = 0.5;             // 1em の大きさ（m）
export const MAX_EXTENT = 0.62;    // 字の縦横の大きい方の上限（2文字のときは縮める）
export const POWER_MAX = 100;      // パワーは 1〜100 の整数
export const ANGLE_MIN = 10, ANGLE_MAX = 85; // 角度は整数（度）
export const SPEED_MAX = 15.5;     // 基準の重さの字をパワー100で撃ったときの初速（m/s）
export const GRAVITY = 9.81;
const MASS_REF = 0.06;             // 基準の重さ（面積）
const RIM_R = 0.045;               // リングのふち（小さな玉）の半径
const BOARD = { dx: 0.22, w: 0.1, h: 1.15, below: 0.12 }; // ボード：輪の右端からの距離・厚み・高さ・輪より下に出る長さ
const SHOT_LIMIT = 7;              // 秒。これ以上かかったら打ち切り
const STILL_SEC = 0.7;             // ほぼ止まってこの秒数たったら終わり
const AFTER_SCORE = 1.1;           // 入ってから球が消えるまでの秒数

// 三角関数は環境で末尾の桁が違いうるので、物理に渡す向きは四則演算だけで作る
function sinDeg(deg) {
  const x = deg * 3.141592653589793 / 180;
  let term = x, sum = x;
  for (let n = 1; n < 12; n++) { term *= -x * x / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
export const dirOf = deg => ({ c: sinDeg(90 - deg), s: sinDeg(deg) });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r3 = v => Math.round(v * 1000) / 1000; // 環境差を丸めで消す

// 字の形の下ごしらえ。形から「重さ・弾み・摩擦・回転」を決める（決定的）
export function makeBall(font, ch) {
  let polys = glyphPolygons(font, ch, EM);
  if (!polys.length) return null;
  let box = centerPolygons(polys);
  const ext = Math.max(box.x, box.y);
  if (ext > MAX_EXTENT) { // 2文字などで大きすぎるときは縮める
    polys = glyphPolygons(font, ch, EM * MAX_EXTENT / ext);
    box = centerPolygons(polys);
  }
  const tris = [];
  for (const p of buildPrisms(polys, 0.1)) {
    const t = [p[0], p[1], p[3], p[4], p[6], p[7]].map(v => Math.round(v * 1e5) / 1e5);
    if (Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) > 1e-6) tris.push(new Float32Array(t));
  }
  if (!tris.length) return null;
  const m = shapeMetrics(polys);
  const holes = polys.reduce((s, q) => s + q.holes.length, 0);
  const elong = 1 - Math.min(box.x, box.y) / Math.max(box.x, box.y);              // 細長さ 0〜1
  const rough = clamp((m.perim * m.perim / m.area - 12.6) / 90, 0, 1);            // 輪郭の複雑さ 0〜1
  const mass = m.area;
  return {
    ch, polys, tris, size: box,
    props: {
      mass: r3(mass), holes, elong: r3(elong), roundness: r3(m.roundness),
      bounce: r3(clamp(0.2 + (m.roundness - 0.785) * 2.8, 0.04, 0.82)), // 丸いほど弾む。四角で 0.2
      boost: r3(clamp(Math.sqrt(MASS_REF / mass), 0.8, 1.15)),           // 重いほど初速が出ない
      friction: r3(0.25 + 0.5 * rough),                                  // ギザギザほど引っかかる
      rimFriction: r3(clamp(0.95 - 4 * (mass - 0.04), 0.2, 0.95)),       // 重い字はふちで引っかかりにくい
      spin: r3(elong * 14),                                              // 細長いほど回りながら飛ぶ（rad/s）
      damp: r3(0.25 + 0.9 * (1 - Math.min(1, m.roundness * 1.05)) ** 2), // 丸いほど回転が落ちにくい（転がる）
    },
  };
}

// 性格の説明（画面に出す）。当てはまるものをすべて返す
export function describeBall(ball) {
  const p = ball.props, tags = [];
  if (p.roundness > 0.92) tags.push('まる：よく弾む。ふちで跳ねて入ることも');
  else if (p.bounce < 0.2) tags.push('角ばり：弾みにくい。ふちに引っかかって止まる');
  if (p.elong > 0.55) tags.push('細長：回りながら飛ぶ');
  if (p.holes > 0) tags.push('穴あき：リングが穴を通ることも');
  if (p.mass > 0.09) tags.push('重い：飛びにくいが、ふちで止まりにくい');
  else if (p.mass < 0.035) tags.push('軽い：よく飛ぶ');
  if (!tags.length) tags.push('ふつう：くせのない字');
  return tags;
}

// 発射：新しいワールドを作り、字に初速を与える。phase0 は動くリングの時計（ステップ数）
export function createShot(RAPIER, ball, stageIdx, power, angle, phase0 = 0) {
  const stage = STAGES[stageIdx];
  const R = RAPIER;
  const world = new R.World({ x: 0, y: -GRAVITY });
  const events = new R.EventQueue(true);
  const tag = new Map(); // collider.handle → 'rim' | 'board'
  // 固定物は弾まない（弾みは字の側だけで決まる：Max で合成）
  const stat = desc => desc.setFriction(0.3).setRestitution(0).setRestitutionCombineRule(R.CoefficientCombineRule.Max);
  const pr = ball.props;

  const g = world.createRigidBody(R.RigidBodyDesc.fixed());
  world.createCollider(stat(R.ColliderDesc.cuboid(30, 1).setTranslation(0, -1)), g);
  world.createCollider(stat(R.ColliderDesc.cuboid(0.5, 30).setTranslation(WORLD_L - 0.5, 15)), g);
  world.createCollider(stat(R.ColliderDesc.cuboid(0.5, 30).setTranslation(WORLD_R + 0.5, 15)), g);
  for (const w of stage.walls) world.createCollider(stat(R.ColliderDesc.cuboid(w.w / 2, w.h / 2).setTranslation(w.x, w.y + w.h / 2)), g);

  // リング：動かせるように kinematic。左右のふち（小さな玉）とバックボード
  const rings = stage.rings.map(ring => {
    const p0 = ringPos(ring, phase0);
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p0.x, p0.y));
    const ev = R.ActiveEvents.COLLISION_EVENTS;
    const rim = dx => stat(R.ColliderDesc.ball(RIM_R).setTranslation(dx, 0)).setFriction(pr.rimFriction).setActiveEvents(ev);
    const rimL = world.createCollider(rim(-ring.r - RIM_R), body);
    const rimR = world.createCollider(rim(ring.r + RIM_R), body);
    const board = world.createCollider(stat(R.ColliderDesc.cuboid(BOARD.w / 2, BOARD.h / 2)
      .setTranslation(ring.r + 2 * RIM_R + BOARD.dx, BOARD.h / 2 - BOARD.below)).setActiveEvents(ev), body);
    tag.set(rimL.handle, 'rim'); tag.set(rimR.handle, 'rim'); tag.set(board.handle, 'board');
    return { ring, body, pos: p0, prevY: null, touched: { rim: false, board: false } };
  });

  const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
    .setTranslation(LAUNCH.x, LAUNCH.y)
    .setLinearDamping(0.01).setAngularDamping(pr.damp).setCcdEnabled(true));
  for (const t of ball.tris) {
    world.createCollider(R.ColliderDesc.triangle({ x: t[0], y: t[1] }, { x: t[2], y: t[3] }, { x: t[4], y: t[5] }).setDensity(1).setFriction(pr.friction).setRestitution(pr.bounce)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
      .setFrictionCombineRule(R.CoefficientCombineRule.Max), body); // 摩擦もリムの方が大きければリム側（rimFriction）が効く
  }
  const { c, s } = dirOf(angle);
  const v = SPEED_MAX * pr.boost * power / POWER_MAX;
  body.setLinvel({ x: v * c, y: v * s }, true);
  body.setAngvel(-(pr.spin * (0.4 + 0.6 * power / POWER_MAX) + 1.2), true); // 前回り。細長い字ほど速く回る

  return { ball, stageIdx, power, angle, phase0, world, events, tag, rings, body,
    steps: 0, still: 0, done: false, scored: null, scoredAt: 0, maxY: LAUNCH.y, rimHits: 0, boardHits: 0 };
}

// 1ステップ進める。入ったら shot.scored = { kind:'swish'|'rim'|'board', ring, points } をセット
export function stepShot(shot) {
  if (shot.done) return;
  const n = shot.phase0 + shot.steps + 1;   // これから進める先のリングの時計
  for (const r of shot.rings) {
    r.pos = ringPos(r.ring, n);
    r.body.setNextKinematicTranslation(r.pos);
  }
  shot.world.step(shot.events);
  shot.steps++;
  shot.events.drainCollisionEvents((h1, h2, started) => {
    const k = shot.tag.get(h1) || shot.tag.get(h2);
    if (!started || !k) return;
    const owner = shot.world.getCollider(shot.tag.has(h1) ? h1 : h2).parent();
    const r = shot.rings.find(q => q.body.handle === owner.handle);
    r.touched[k] = true;
    if (k === 'rim') shot.rimHits++; else shot.boardHits++;
  });

  const t = shot.body.translation(), vel = shot.body.linvel();
  if (t.y > shot.maxY) shot.maxY = t.y;
  const time = shot.steps * DT;
  if (!shot.scored) {
    shot.rings.forEach((r, i) => {
      const p = r.pos;
      // 字の中心が、輪の面を上から下へ通り抜けたら「入った」（輪の中を、輪より高いところから来たとき）
      if (r.prevY !== null && r.prevY > p.y && t.y <= p.y && vel.y < 0 && Math.abs(t.x - p.x) < r.ring.r && shot.maxY > p.y + 0.15) {
        const kind = r.touched.board ? 'board' : r.touched.rim ? 'rim' : 'swish';
        shot.scored = { kind, ring: i, points: (kind === 'swish' ? 3 : 2) + (r.ring.bonus || 0) };
        shot.scoredAt = time;
      }
      r.prevY = t.y;
    });
  }
  const slow = vel.x * vel.x + vel.y * vel.y < 0.04 && Math.abs(shot.body.angvel()) < 0.3;
  shot.still = slow ? shot.still + DT : 0;
  if (shot.still >= STILL_SEC || time >= SHOT_LIMIT || t.y < -2 || (shot.scored && time - shot.scoredAt >= AFTER_SCORE)) shot.done = true;
}

export function disposeShot(shot) {
  shot.events?.free();
  shot.world?.free();
  shot.world = null;
}

// 描画せずに最後まで計算する（検証・自動探索用）。track=true で軌跡も返す
export function simulateShot(RAPIER, ball, stageIdx, power, angle, phase0 = 0, track = false) {
  const shot = createShot(RAPIER, ball, stageIdx, power, angle, phase0);
  const path = [];
  while (!shot.done) {
    stepShot(shot);
    if (track && shot.steps % 6 === 0) { const t = shot.body.translation(); path.push([+t.x.toFixed(2), +t.y.toFixed(2)]); }
  }
  const t = shot.body.translation();
  const out = { scored: shot.scored, steps: shot.steps, rimHits: shot.rimHits, boardHits: shot.boardHits, maxY: +shot.maxY.toFixed(2), end: [+t.x.toFixed(2), +t.y.toFixed(2)], path };
  disposeShot(shot);
  return out;
}
