// コース：地面の上面を折れ線で定義する（x は右向き、y は上向き）
import * as THREE from 'three';

// 区間の並び。slope: [長さ, 下がる高さ]、stairs: [段数, 踏み面の長さ, 踏み面の傾き, 段差の高さ]
const SECTIONS = [
  { type: 'slope', len: 8, drop: 5.5, color: 0x8bc34a },                  // 急坂（約35°）
  { type: 'stairs', n: 6, tread: 1.8, tilt: 0.45, rise: 0.8, color: 0xd7a86e },
  { type: 'slope', len: 12, drop: 3.2, bumps: [3, 6.5, 10], color: 0x7cb342 }, // 段差つきの坂（約15°）
  { type: 'stairs', n: 4, tread: 1.8, tilt: 0.45, rise: 0.8, color: 0xc8955a },
  { type: 'slope', len: 16, drop: 2.2, color: 0x8bc34a },                 // ゆるい坂（約8°）→ ゴール
];

function makeCourse() {
  const pts = [[-3, 0], [0, 0]], colors = [0x9e9e9e], bumps = [];
  let x = 0, y = 0;
  const push = (nx, ny, color) => { x = nx; y = ny; pts.push([x, y]); colors.push(color); };
  for (const s of SECTIONS) {
    if (s.type === 'slope') {
      for (const b of s.bumps || []) bumps.push(x + b);
      push(x + s.len, y - s.drop, s.color);
    } else {
      for (let i = 0; i < s.n; i++) {
        push(x + s.tread, y - s.tilt, s.color);
        push(x, y - s.rise, s.color);
      }
    }
  }
  push(x + 6, y - 0.3, 0x9e9e9e); // ゴール後の余白
  return { pts, colors, bumps };
}

const { pts: POINTS, colors: COLORS, bumps: BUMPS } = makeCourse();
const last = POINTS[POINTS.length - 1];

export const START_X = 0.3;
export const GOAL_X = last[0] - 6;
export const FRICTION = 0.6;   // 地面の摩擦。急坂（35°=tan0.7）で平たい字が滑り出せる値
const COURSE_WIDTH = 3.4; // 見た目の幅（4レーン分）。当たり判定は奥行きを使わないので関係ない
export const START_DROP = 1.0; // スタート時に文字を浮かせる高さ（着地の衝撃で角ばった字も転がり出す）

export function surfaceY(x) {
  for (let i = 0; i < POINTS.length - 1; i++) {
    const [x0, y0] = POINTS[i], [x1, y1] = POINTS[i + 1];
    if (x1 === x0) continue; // 垂直な段差
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return last[1];
}

// scene を渡すと見た目も作る。null なら当たり判定だけ（走るたびに物理ワールドを作り直すため）
export function buildCourse(RAPIER, world, scene) {
  // 向きは角度ではなく (cos, sin) で受け取る。三角関数はブラウザごとに末尾の桁が違いうるので、
  // サーバー検証と結果を揃えるため、物理に渡す値は四則演算と sqrt（どこでも同じ値になる）だけで作る
  const addBox = (cx, cy, hx, hy, c, s, color) => {
    const q = { x: 0, y: 0, z: Math.sign(s) * Math.sqrt((1 - c) / 2), w: Math.sqrt((1 + c) / 2) };
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, 0).setRotation(q));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, 1.2).setFriction(FRICTION), body);
    if (!scene) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, COURSE_WIDTH),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    mesh.position.set(cx, cy, 0);
    mesh.quaternion.set(q.x, q.y, q.z, q.w);
    scene.add(mesh);
  };

  const T = 0.4; // 板の半分の厚み
  for (let i = 0; i < POINTS.length - 1; i++) {
    const [x0, y0] = POINTS[i], [x1, y1] = POINTS[i + 1];
    const dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy);
    const c = dx / L, s = dy / L;
    const nx = -s, ny = c;
    // 継ぎ目に隙間ができないよう少し重ねる
    addBox((x0 + x1) / 2 - nx * T, (y0 + y1) / 2 - ny * T, (L + 0.3) / 2, T, c, s, COLORS[i]);
  }
  for (const bx of BUMPS) addBox(bx, surfaceY(bx), 0.12, 0.12, Math.SQRT1_2, Math.SQRT1_2, 0x795548); // 45°
  addBox(last[0], last[1] + 2, 0.3, 2.5, 1, 0, 0x607d8b); // 終端の壁

  if (!scene) return;

  // スタート線・ゴール線・旗
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  for (const lx of [START_X, GOAL_X]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, COURSE_WIDTH), lineMat);
    line.position.set(lx, surfaceY(lx) + 0.01, 0);
    scene.add(line);
  }
  const gy = surfaceY(GOAL_X);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4), lineMat);
  pole.position.set(GOAL_X, gy + 2, -COURSE_WIDTH / 2);
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xe53935, side: THREE.DoubleSide }));
  flag.position.set(GOAL_X + 0.6, gy + 3.6, -COURSE_WIDTH / 2);
  scene.add(flag);
}
