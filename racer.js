// 1文字ぶんの走者。走者ごとに専用の物理ワールドを持つ（互いにぶつからず、毎回同じ結果になる）
import { glyphPolygons, shapeMetrics, centerPolygons, buildPrisms } from './glyph.js';
export { glyphPolygons, centerPolygons };
import { buildCourse, surfaceY, START_X, GOAL_X, START_DROP } from './course.js';

export const GLYPH_SIZE = 2.0;    // 1em の大きさ（m）
export const DEPTH = 0.5;         // 文字の厚み（m）
const DENSITY = 1.0;
const START_SPEED = 2.0;   // スタート時に全員へ同じだけ与える初速（m/s）
const STALL_SEC = 2.5;     // この秒数ほぼ止まっていたらリタイア
const TIME_LIMIT = 30;     // ゴールできる字は16秒以内に着く。長いとサーバー検証が重くなる
const REC_EVERY = 2;        // 走りを記録する間隔（ステップ数）。ゴースト再生ではこの間を補間する
export const DT = 1 / 60;

// 三角形の集まりから面積・重心・極慣性モーメントを計算（2D）
function inertia2D(prisms) {
  let A = 0, cx = 0, cy = 0, J0 = 0;
  for (const p of prisms) {
    const ax = p[0], ay = p[1], bx = p[3], by = p[4], cxp = p[6], cyp = p[7];
    const a = Math.abs((bx - ax) * (cyp - ay) - (cxp - ax) * (by - ay)) / 2;
    A += a;
    cx += a * (ax + bx + cxp) / 3;
    cy += a * (ay + by + cyp) / 3;
    J0 += a / 6 * (ax * ax + ay * ay + bx * bx + by * by + cxp * cxp + cyp * cyp + ax * bx + ay * by + bx * cxp + by * cyp + cxp * ax + cyp * ay);
  }
  cx /= A; cy /= A;
  const J = J0 - A * (cx * cx + cy * cy);
  return { A, com: Math.hypot(cx, cy), k: Math.sqrt(J / A) };
}

export function createRacer(RAPIER, font, ch) {
  const polys = glyphPolygons(font, ch, GLYPH_SIZE);
  if (!polys.length) return null;
  const size = centerPolygons(polys);
  const prisms = buildPrisms(polys, DEPTH);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  buildCourse(RAPIER, world, null);
  const x = START_X + size.x / 2;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, surfaceY(x) + size.y / 2 + START_DROP, 0)
    .enabledTranslations(true, true, false)  // 奥行き方向には動かない
    .enabledRotations(false, false, true)    // 画面に垂直な軸まわりだけ回る
    .setCcdEnabled(true));
  let colliders = 0;
  for (const pts of prisms) {
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (!desc) continue;
    world.createCollider(desc.setDensity(DENSITY).setFriction(0.6).setRestitution(0.05), body);
    colliders++;
  }

  const m = shapeMetrics(polys);
  const iz = inertia2D(prisms);
  const r = Math.max(size.x, size.y) / 2;
  return {
    ch, polys, world, body, startX: x,
    stats: { mass: body.mass(), roundness: m.roundness, spin: iz.k / r, offset: iz.com / r, colliders },
    elapsed: 0, stillTime: 0, done: false, goal: false, reason: '', left: 0,
    steps: 0, traj: null,
  };
}

// 走りの記録を始める（[x, y, 角度] を REC_EVERY ステップごとに並べた配列）
export function startRecording(r) {
  r.traj = [];
  recordPose(r);
}
function recordPose(r) {
  const t = r.body.translation(), q = r.body.rotation();
  r.traj.push(+t.x.toFixed(3), +t.y.toFixed(3), +(2 * Math.atan2(q.z, q.w)).toFixed(3));
}

// ゴースト：記録した走りを再生するだけの走者（物理ワールドを持たない）
export function createGhost(font, ch, ghost) {
  const polys = glyphPolygons(font, ch, GLYPH_SIZE);
  if (!polys.length) return null;
  centerPolygons(polys);
  const d = ghost.d, pose = { x: d[0], y: d[1], a: d[2] };
  const r = {
    ch, polys, isGhost: true, recTime: ghost.t, ghostData: d, pose,
    startX: d[0], elapsed: 0, done: false, goal: false, reason: '', left: GOAL_X - d[0], steps: 0,
    body: {
      translation: () => ({ x: pose.x, y: pose.y, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: Math.sin(pose.a / 2), w: Math.cos(pose.a / 2) }),
    },
  };
  return r;
}

function stepGhost(r) {
  r.steps++;
  r.elapsed += DT;
  const data = r.ghostData;
  const n = data.length / 3 - 1;            // 区間の数
  const f = Math.min(r.steps / REC_EVERY, n);
  const i = Math.min(Math.floor(f), n - 1), u = f - i;
  const lerp = k => data[i * 3 + k] + (data[(i + 1) * 3 + k] - data[i * 3 + k]) * u;
  r.pose.x = lerp(0); r.pose.y = lerp(1); r.pose.a = lerp(2);
  r.left = Math.max(0, GOAL_X - r.pose.x);
  // 終了はタイムで判定（最後の区間はゴールの瞬間で切れていて等間隔でないため）
  if (r.elapsed >= r.recTime - 1e-9) { r.done = true; r.goal = true; r.reason = 'goal'; r.elapsed = r.recTime; r.left = 0; }
}

export function launch(r) {
  if (r.isGhost) return;
  r.body.setLinvel({ x: START_SPEED, y: 0, z: 0 }, true);
}

export function progress(r) {
  return Math.max(0, Math.min(1, (r.body.translation().x - r.startX) / (GOAL_X - r.startX)));
}

// 1ステップ進め、ゴール・リタイアを判定する
export function stepRacer(r) {
  if (r.done) return;
  if (r.isGhost) return stepGhost(r);
  r.world.step();
  r.elapsed += DT;
  r.steps++;
  if (r.traj && r.steps % REC_EVERY === 0) recordPose(r);
  const t = r.body.translation(), v = r.body.linvel();
  r.left = Math.max(0, GOAL_X - t.x);
  const end = reason => { r.done = true; r.reason = reason; r.goal = reason === 'goal'; };
  if (t.x >= GOAL_X) {
    if (r.traj && r.steps % REC_EVERY !== 0) recordPose(r); // ゴールの瞬間も残す
    return end('goal');
  }
  if (t.y < surfaceY(t.x) - 10) return end('out');
  if (r.elapsed >= TIME_LIMIT) return end('timeout');
  r.stillTime = v.x * v.x + v.y * v.y < 0.05 * 0.05 ? r.stillTime + DT : 0; // hypot は環境差が出うるので使わない
  if (r.stillTime > STALL_SEC) end('stall');
}

export function resultText(r) {
  if (!r.done) return `走行中（あと ${r.left.toFixed(1)} m）`;
  if (r.goal) return `${r.elapsed.toFixed(2)} 秒`;
  const why = { out: 'コースアウト', timeout: '時間切れ', stall: '止まった' }[r.reason];
  return `${why}（あと ${r.left.toFixed(1)} m）`;
}

// 順位：ゴールした順（タイム）→ 未ゴールは残り距離の短い順
export function compareRacers(a, b) {
  if (a.goal !== b.goal) return a.goal ? -1 : 1;
  if (a.goal) return a.elapsed - b.elapsed;
  return a.left - b.left;
}

export function disposeRacer(r) {
  r.world?.free();
}
