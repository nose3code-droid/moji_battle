// 文字 → マシンの性能。形の指標（面積・周長・丸さ・縦横比・角の数）から決定的に決める
import * as THREE from 'three';
import { glyphPolygons, shapeMetrics, centerPolygons } from '../../glyph.js';

const SIZE = 100;          // glyphPolygons に渡す大きさ（1em = 100）
const clamp01 = v => Math.max(0, Math.min(1, v));

// 外形の頂点のうち、折れ曲がりが大きいもの（＝角）の数
function countCorners(polys) {
  let n = 0;
  for (const { outer, holes } of polys) {
    for (const pts of [outer, ...holes]) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
        const v1 = new THREE.Vector2().subVectors(b, a), v2 = new THREE.Vector2().subVectors(c, b);
        if (v1.lengthSq() < 1e-9 || v2.lengthSq() < 1e-9) continue;
        const turn = Math.abs(Math.atan2(v1.cross(v2), v1.dot(v2)));
        if (turn > 0.9) n++; // 約 50° 以上
      }
    }
  }
  return n;
}

// 1〜2文字 → { polys（機体の座標系、1em=1）, stats }
export function buildMachine(font, text) {
  const chars = [...text].slice(0, 2);
  const polys = [];
  const n = chars.length;
  chars.forEach((ch, k) => {
    const ps = glyphPolygons(font, ch, SIZE);
    const size = centerPolygons(ps);
    // 機体の前が文字の上。横長の字は長い方を進行方向に向ける（90°回す）
    const rot = n === 1 && size.x > size.y * 1.8;
    const oy = n === 1 ? 0 : ((n - 1) / 2 - k) * 90;
    const tr = q => { const x = q.x, y = q.y; return rot ? new THREE.Vector2(-y, x) : new THREE.Vector2(x, y + oy); };
    for (const { outer, holes } of ps) polys.push({ outer: outer.map(tr), holes: holes.map(h => h.map(tr)) });
  });
  // em 単位に
  for (const { outer, holes } of polys) for (const pts of [outer, ...holes]) for (const q of pts) q.multiplyScalar(1 / SIZE);

  const m = shapeMetrics(polys);
  const box = new THREE.Box2();
  for (const { outer } of polys) for (const q of outer) box.expandByPoint(q);
  const size = box.getSize(new THREE.Vector2());
  const aspect = Math.max(size.x, size.y) / Math.max(1e-6, Math.min(size.x, size.y));
  const corners = countCorners(polys);
  const area = m.area / n; // 1文字あたり

  const round = clamp01((m.roundness - 0.72) / 0.28);   // 丸さ（凸包ベース。四角い字で約0.2、円で1）
  const elong = clamp01((aspect - 1.2) / 3);           // 細長さ
  const heavy = clamp01(0.5 * (area - 0.1) / 0.3 + 0.5 * (corners / n) / 80); // 重さ：インクの量と画数（角の数）
  const spiky = clamp01((corners / n - 6) / 50);       // 角の多さ
  const grip = clamp01(0.12 + 0.88 * (0.75 * round + 0.25 * (1 - elong)));
  const speed = clamp01(0.7 * elong + 0.5 * (1 - round) - 0.1 * heavy);
  const accel = clamp01(1 - 0.85 * heavy);
  const stats = {
    grip, speed, accel, mass: heavy, spiky,
    radius: n === 1 ? 16 : 20,
    raw: { area: m.area, roundness: m.roundness, aspect, corners },
  };
  return { text: chars.join(''), polys, stats };
}

// 描画用に Path2D を作る（機体座標：上が前、1em = 1 の座標を scale 倍）
export function machinePath(polys, scale) {
  const path = new Path2D();
  for (const { outer, holes } of polys) {
    for (const pts of [outer, ...holes]) {
      pts.forEach((q, i) => { const x = q.x * scale, y = -q.y * scale; if (i === 0) path.moveTo(x, y); else path.lineTo(x, y); });
      path.closePath();
    }
  }
  return path;
}
