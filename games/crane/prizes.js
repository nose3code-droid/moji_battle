// 景品の字：輪郭 → 凸分割した当たり判定の形、見た目の経路、字の性格（重さ・すべりやすさ・ひっかかり）
import * as THREE from 'three';
import { glyphPolygons, centerPolygons, shapeMetrics } from '../../glyph.js';
import { ZUKAN } from './zukan.js';

export const PRIZE_SIZE = 1.05;      // 1em の大きさ（m）
const HOLE_MIN = 0.17;               // ピンが通る穴の最小の幅（m）

export const hasGlyph = (font, ch) => { const g = font.charToGlyph(ch); return !!g && g.index !== 0; };

// ---- 凸分割：三角形分割 → 隣り合う三角形を、凸のままくっつけていく（Hertel–Mehlhorn 法）----
function convexPieces(polys) {
  const out = [];
  for (const { outer, holes } of polys) {
    const all = outer.concat(...holes);
    let list = THREE.ShapeUtils.triangulateShape(outer, holes).map(([i, j, k]) => {
      const cr = (all[j].x - all[i].x) * (all[k].y - all[i].y) - (all[k].x - all[i].x) * (all[j].y - all[i].y);
      if (Math.abs(cr) < 1e-7) return null;       // 潰れた三角形
      return cr > 0 ? [i, j, k] : [i, k, j];      // 反時計回りにそろえる
    }).filter(Boolean);

    const convex = idx => {
      const n = idx.length;
      for (let a = 0; a < n; a++) {
        const p = all[idx[a]], q = all[idx[(a + 1) % n]], r = all[idx[(a + 2) % n]];
        if ((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) < -1e-9) return false;
      }
      return true;
    };
    for (let changed = true; changed;) {
      changed = false;
      const edge = new Map(); // "a,b"（a→b の向き）→ 多角形の番号
      list.forEach((idx, pi) => idx.forEach((v, e) => edge.set(v + ',' + idx[(e + 1) % idx.length], pi)));
      search: for (let pi = 0; pi < list.length; pi++) {
        const p = list[pi];
        for (let e = 0; e < p.length; e++) {
          const a = p[e], b = p[(e + 1) % p.length];
          const qi = edge.get(b + ',' + a);
          if (qi === undefined || qi === pi) continue;
          const q = list[qi];
          const pr = [...p.slice(e + 1), ...p.slice(0, e + 1)];     // b … a
          const k = q.indexOf(a);
          const qr = [...q.slice(k), ...q.slice(0, k)];              // a … b
          const merged = pr.concat(qr.slice(1, -1));
          if (merged.length > 10 || !convex(merged)) continue;       // 頂点が多すぎる塊は作らない
          list = list.filter((_, i) => i !== pi && i !== qi);
          list.push(merged);
          changed = true;
          break search;
        }
      }
    }
    for (const idx of list) out.push(new Float32Array(idx.flatMap(i => [all[i].x, all[i].y])));
  }
  return out;
}

function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

// 穴の中心と大きさ。ピンを通せるのは、ある程度大きな穴だけ
function holeInfo(polys) {
  const list = [];
  for (const { holes } of polys) {
    for (const h of holes) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const q of h) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
      const A = polyArea(h);
      let cx = 0, cy = 0;
      for (let i = 0; i < h.length; i++) {
        const a = h[i], b = h[(i + 1) % h.length], cr = a.x * b.y - b.x * a.y;
        cx += (a.x + b.x) * cr; cy += (a.y + b.y) * cr;
      }
      const c = { x: cx / (6 * A), y: cy / (6 * A) };
      list.push({ pts: h.map(q => ({ x: q.x, y: q.y })), c, w: Math.min(maxX - minX, maxY - minY), area: Math.abs(A) });
    }
  }
  return list;
}

// ---- 字の性格 ----
// 丸さ・面積・周長だけから決める（同じ字なら、いつも同じ性格）
//  weight  : 重さ。インクの面積が多いほど重い（密度も少し上がるので、画数の多い字ほど重くなる）
//  friction: 爪との摩擦。丸いほど小さく（つるっと逃げる）、周長が長く入り組むほど大きい（引っかかる）
//  hole    : ピンを通せる穴があるか
function traitsOf(m, size, holes) {
  const ink = m.area / (size * size);                       // em 四方に対するインクの割合
  const comp = m.perim / (4 * Math.sqrt(m.area));           // 入り組み具合（正方形で 1）
  const density = 0.8 + 2.4 * Math.max(0, ink - 0.25);      // 重い字は密度も高い
  const mass = m.area * density;
  const massN = mass / ((size / PRIZE_SIZE) ** 2);           // 大きさの分を除いた重さ（つかみやすさの判定に使う）
  // 丸さ 0.78（四角）〜1.0（円）を、摩擦 0.85〜0.12 に。入り組んだ字は、爪が引っかかるぶん摩擦が増える
  const round = Math.max(0, Math.min(1, (1 - m.roundness) / 0.22));
  const friction = 0.12 + 0.73 * round + 0.25 * Math.max(0, Math.min(1, (comp - 2.3) / 2.5));
  const stars = (v, lo, hi) => Math.max(1, Math.min(5, 1 + Math.round(4 * (v - lo) / (hi - lo))));
  return {
    ink, comp, density, mass, massN, friction,
    hook: holes.some(h => h.w >= HOLE_MIN),
    // 表示用の 1〜5
    weightStars: stars(mass, 0.25, 1.0),
    slipStars: stars(1 - friction, 0.1, 0.85),
    catchStars: stars(comp, 2.2, 5.0),
  };
}

export function makePrize(font, ch, scale = 1) {
  const size = PRIZE_SIZE * scale;
  const polys = glyphPolygons(font, ch, size);
  if (!polys.length) return null;
  centerPolygons(polys);
  const pieces = convexPieces(polys).filter(p => p.length >= 6);
  if (!pieces.length) return null;
  const metrics = shapeMetrics(polys);
  const holes = holeInfo(polys);
  const traits = traitsOf(metrics, size, holes);
  // 見た目用の経路（原点は字の中心、単位は m、y 上向き）
  const path = new Path2D();
  for (const { outer, holes: hs } of polys) {
    for (const c of [outer, ...hs]) {
      c.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
      path.closePath();
    }
  }
  let r = 0;
  for (const { outer } of polys) for (const q of outer) r = Math.max(r, Math.hypot(q.x, q.y));
  const z = ZUKAN[ch] || { yomi: '', strokes: 1, note: '' };
  return { ch, size, scale, polys, pieces, holes, metrics, traits, path, radius: r, strokes: z.strokes };
}
