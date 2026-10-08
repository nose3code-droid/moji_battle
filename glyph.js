// フォントの1文字 → 輪郭ポリゴン（外形＋穴）に変換する
import * as THREE from 'three';

const CURVE_DIV = 5; // 曲線1本あたりの分割数（多いほど滑らか・当たり判定が重い）

// 文字の輪郭を [{ outer: Vector2[], holes: Vector2[][] }] で返す。座標は em 単位 × size、y 上向き
export function glyphPolygons(font, ch, size) {
  const path = font.getPath(ch, 0, 0, size);
  const contours = [];
  let p = null;
  for (const c of path.commands) {
    if (c.type === 'M') { if (p) contours.push(cleanPoints(p.getPoints(CURVE_DIV))); p = new THREE.Path(); p.moveTo(c.x, -c.y); } // Z 無しで次の M が来るフォントもある
    else if (c.type === 'L') p.lineTo(c.x, -c.y);
    else if (c.type === 'Q') p.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === 'C') p.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    else if (c.type === 'Z' && p) { contours.push(cleanPoints(p.getPoints(CURVE_DIV))); p = null; }
  }
  if (p) contours.push(cleanPoints(p.getPoints(CURVE_DIV)));

  const list = contours.filter(pts => pts.length >= 3)
    .map(pts => ({ pts, area: Math.abs(THREE.ShapeUtils.area(pts)) }))
    .filter(c => c.area > 1e-6);

  // 包含関係で外形/穴を判定（巻き方向に依存しない）。何個に囲まれているかが偶数→外形、奇数→穴
  for (const c of list) {
    const containers = list.filter(o => o !== c && o.area > c.area && pointInPolygon(c.pts[0], o.pts));
    c.depth = containers.length;
    c.parent = containers.sort((a, b) => a.area - b.area)[0] || null;
  }
  const outers = list.filter(c => c.depth % 2 === 0).map(c => ({ src: c, outer: c.pts, holes: [] }));
  for (const c of list) {
    if (c.depth % 2 === 1) {
      const o = outers.find(o => o.src === c.parent);
      if (o) o.holes.push(c.pts);
    }
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}

function cleanPoints(pts) {
  const out = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (!last || last.distanceToSquared(q) > 1e-10) out.push(q);
  }
  if (out.length > 1 && out[0].distanceToSquared(out[out.length - 1]) < 1e-10) out.pop();
  return out;
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 形の指標：面積・周長・丸さ（4πA/P²、円で1）
export function shapeMetrics(polys) {
  let area = 0, perim = 0;
  const len = pts => pts.reduce((s, q, i) => s + q.distanceTo(pts[(i + 1) % pts.length]), 0);
  for (const { outer, holes } of polys) {
    area += Math.abs(THREE.ShapeUtils.area(outer));
    perim += len(outer);
    for (const h of holes) { area -= Math.abs(THREE.ShapeUtils.area(h)); perim += len(h); }
  }
  // 丸さは凸包で見る（転がるときに地面に触れるのは外周の出っ張りだけなので）
  const hull = convexHull(polys.flatMap(p => p.outer));
  const ha = Math.abs(THREE.ShapeUtils.area(hull)), hp = len(hull);
  return { area, perim, roundness: hp > 0 ? 4 * Math.PI * ha / (hp * hp) : 0 };
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 中心をずらす（バウンディングボックス中心を原点に）
export function centerPolygons(polys) {
  const box = new THREE.Box2();
  for (const { outer } of polys) for (const q of outer) box.expandByPoint(q);
  const c = box.getCenter(new THREE.Vector2());
  for (const { outer, holes } of polys) {
    for (const q of outer) q.sub(c);
    for (const h of holes) for (const q of h) q.sub(c);
  }
  return box.getSize(new THREE.Vector2());
}

// 見た目用メッシュ（z方向に depth の厚み、中心 z=0）
export function buildMesh(polys, depth, color) {
  const shapes = polys.map(({ outer, holes }) => {
    const s = new THREE.Shape(outer);
    s.holes = holes.map(h => new THREE.Path(h));
    return s;
  });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// 当たり判定用：三角形分割した各三角形を厚み付きの凸包（三角柱）にする
export function buildPrisms(polys, depth) {
  const prisms = [];
  const hz = depth / 2;
  for (const { outer, holes } of polys) {
    const all = outer.concat(...holes);
    const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
    for (const [i, j, k] of tris) {
      const a = all[i], b = all[j], c = all[k];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) < 1e-6) continue; // 潰れた三角形
      prisms.push(new Float32Array([
        a.x, a.y, -hz, b.x, b.y, -hz, c.x, c.y, -hz,
        a.x, a.y, hz, b.x, b.y, hz, c.x, c.y, hz,
      ]));
    }
  }
  return prisms;
}
