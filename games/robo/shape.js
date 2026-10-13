// 文字の形を測る（games/status/stats.js の measureGlyph を、ロボ用に写して使う）
import * as THREE from 'three';
import { glyphPolygons, shapeMetrics } from '../../glyph.js';

// 1文字 → 形の指標。フォントに無い文字は null
export function measureGlyph(font, ch) {
  if (font.charToGlyph(ch).index === 0) return null;
  const polys = glyphPolygons(font, ch, 1);   // 1em = 1 の大きさで測る
  if (!polys.length) return null;
  const m = shapeMetrics(polys);
  if (m.area < 1e-4) return null;
  const box = new THREE.Box2();
  for (const { outer } of polys) for (const q of outer) box.expandByPoint(q);
  const size = box.getSize(new THREE.Vector2());
  const hull = convexHull(polys.flatMap(p => p.outer));
  const hullArea = Math.abs(THREE.ShapeUtils.area(hull));
  return {
    polys, box,
    area: m.area,                                   // 黒い部分の面積（em²）
    roundness: m.roundness,                         // 凸包の丸さ（円で1）
    holes: polys.reduce((n, p) => n + p.holes.length, 0),
    parts: polys.length,                            // つながっていない輪郭の数
    aspect: size.x / Math.max(size.y, 1e-6),        // 横 ÷ 縦
    fill: hullArea > 0 ? m.area / hullArea : 0,     // 凸包のうち黒い割合（ずっしり度）
    spiky: m.perim / Math.sqrt(m.area),             // 面積のわりに周長が長い＝角ばっている
  };
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
