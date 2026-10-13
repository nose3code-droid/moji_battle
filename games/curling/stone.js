// 文字 → ストーン（当たり判定の凸ピース、重さ、性格）。glyph.js の輪郭と shapeMetrics を使う。
import * as THREE from 'three';
import { glyphPolygons, shapeMetrics } from '../../glyph.js';
import { R } from './physics.js';

const clamp01 = x => Math.max(0, Math.min(1, x));
const q = x => Math.round(x * 50) / 50; // フォントの細かな差で結果が変わらないよう 0.02 刻みにそろえる

// 文字の形の指標 → ストーンの性格。metrics: { area(em²), roundness(凸包の丸さ), aspect(外接箱の短辺/長辺) }
export function traitsFromMetrics({ area, roundness, aspect }) {
  const roll = q(clamp01((roundness - 0.7) / 0.3));   // 丸さ：よく滑り、よく弾く
  const heavy = q(clamp01((area - 0.08) / 0.40));     // 画数・インクの量：重い
  const flat = q(clamp01((0.6 - aspect) / 0.4));      // 平たさ
  const angular = 1 - roll;
  return {
    roll, heavy, flat,
    mu: Math.round((0.066 - 0.026 * roll) * 400) / 400,                         // 氷の上の摩擦（小さいほどよく滑る）
    vStop: Math.round(4 + 14 * angular),                                 // この速さを切ると引っかかって止まる
    curl: q((0.25 + 0.9 * angular) * (1 - 0.6 * Math.max(flat, heavy * 0.7))), // 曲がりやすさ
    sweepEff: q(Math.max(0.25, 1 - 0.5 * heavy - 0.4 * flat)),           // スイープの効き
    power: q(1 - 0.08 * heavy),                                          // 重い字は同じ引きでも初速が少し落ちる
    bounce: q(0.3 + 0.5 * roll),                                         // 当たったときの反発
    mass: q(0.55 + 1.0 * heavy),
  };
}

// 画面に出す 0〜1 の4つ
export function traitView(t) {
  return {
    slide: clamp01((0.075 - t.mu) / 0.035),
    curl: clamp01(t.curl / 1.1),
    heavy: t.heavy,
    sweep: clamp01((t.sweepEff - 0.25) / 0.75),
    stop: clamp01((t.vStop - 4) / 14),
  };
}

// 一言説明
export function describe(t) {
  const v = traitView(t), out = [];
  out.push(v.slide > 0.66 ? 'よく滑る' : v.slide < 0.33 ? '引っかかって止まりやすい' : '滑りは普通');
  out.push(v.curl > 0.66 ? 'よく曲がる' : v.curl < 0.33 ? 'まっすぐ進む' : '少し曲がる');
  out.push(v.heavy > 0.66 ? '重くて相手を押しのける' : v.heavy < 0.25 ? '軽くて当たると動かされやすい' : '重さは普通');
  if (v.sweep < 0.4) out.push('スイープの効きは弱い');
  if (t.bounce > 0.6) out.push('当たると大きく弾く');
  return out.join('・');
}

// Douglas-Peucker（開いた折れ線）。端点は残す
function dpLine(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1e-9;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - x1) * dy - (pts[i][1] - y1) * dx) / l;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// 閉じた輪を、いちばん離れた2点で2つの折れ線に分けて簡略化する
function simplifyRing(pts, tol) {
  if (pts.length <= 5) return pts;
  let far = 1, fd = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const first = dpLine(pts.slice(0, far + 1), tol);
  const second = dpLine(pts.slice(far).concat([pts[0]]), tol);
  const out = first.concat(second.slice(1, -1));
  return out.length >= 3 ? out : pts;
}

// 三角形（頂点インデックス）を、凸を保つかぎりくっつけて凸ピースにする（Hertel-Mehlhorn 風）
function mergeTriangles(verts, tris) {
  const polys = tris.map(t => t.slice());
  const convex = idx => {
    const n = idx.length;
    for (let i = 0; i < n; i++) {
      const a = verts[idx[i]], b = verts[idx[(i + 1) % n]], c = verts[idx[(i + 2) % n]];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) return false;
    }
    return true;
  };
  for (let i = 0; i < polys.length; i++) {
    let merged = true;
    while (merged) {
      merged = false;
      const A = polys[i];
      for (let j = i + 1; j < polys.length && !merged; j++) {
        const B = polys[j];
        for (let p = 0; p < A.length && !merged; p++) {
          const u = A[p], v = A[(p + 1) % A.length];
          const qi = B.findIndex((x, k) => x === v && B[(k + 1) % B.length] === u);
          if (qi < 0) continue;
          const out = [];
          for (let k = 1; k <= A.length; k++) out.push(A[(p + k) % A.length]);
          for (let k = 2; k < B.length; k++) out.push(B[(qi + k) % B.length]);
          if (convex(out)) { polys[i] = out; polys.splice(j, 1); merged = true; }
        }
      }
    }
  }
  return polys;
}

// 1〜2文字のテキストからストーンの定義を作る。作れなければ null
export function makeStoneDef(font, text) {
  const chars = [...text].slice(0, 2);
  const polys = [];
  let off = 0;
  for (const c of chars) {
    for (const p of glyphPolygons(font, c, 100)) {
      for (const pt of p.outer) pt.x += off;
      for (const h of p.holes) for (const pt of h) pt.x += off;
      polys.push(p);
    }
    off += font.getAdvanceWidth(c, 100);
  }
  if (!polys.length) return null;
  const m = shapeMetrics(polys);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const { outer } of polys) for (const p of outer) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const w = x1 - x0, h = y1 - y0;
  const traits = traitsFromMetrics({ area: m.area / 1e4, roundness: m.roundness, aspect: Math.min(w, h) / Math.max(w, h) });
  const scale = R * 2 * (1 + 0.32 * (chars.length - 1)) / Math.max(w, h);
  const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;

  // ワールド座標（y 下向き）の輪にして、三角形分割
  const groups = []; // { rings:[outer, ...holes] (each [[x,y]..]), verts, tris }
  let areaSum = 0, mx = 0, my = 0;
  for (const { outer, holes } of polys) {
    const rings = [outer, ...holes].map(r => simplifyRing(r.map(p => [(p.x - cx0) * scale, -(p.y - cy0) * scale]), 0.1));
    const verts = rings.flat();
    const tv = rings.map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
    const idx = THREE.ShapeUtils.triangulateShape(tv[0], tv.slice(1));
    const tris = [];
    for (const [i, j, k] of idx) {
      const a = verts[i], b = verts[j], c = verts[k];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cr) < 1e-6) continue;
      const t = cr > 0 ? [i, j, k] : [i, k, j];
      tris.push(t);
      const A = Math.abs(cr) / 2;
      areaSum += A; mx += A * (a[0] + b[0] + c[0]) / 3; my += A * (a[1] + b[1] + c[1]) / 3;
    }
    groups.push({ rings, verts, tris });
  }
  mx /= areaSum; my /= areaSum; // 重心
  let iRaw = 0, radius = 0;
  const pieces = [];
  for (const g of groups) {
    for (const p of g.verts) { p[0] -= mx; p[1] -= my; radius = Math.max(radius, Math.hypot(p[0], p[1])); }
    for (const [i, j, k] of g.tris) {
      const a = g.verts[i], b = g.verts[j], c = g.verts[k];
      const A = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      iRaw += A / 6 * (a[0] * a[0] + a[1] * a[1] + b[0] * b[0] + b[1] * b[1] + c[0] * c[0] + c[1] * c[1]
        + a[0] * b[0] + a[1] * b[1] + b[0] * c[0] + b[1] * c[1] + c[0] * a[0] + c[1] * a[1]);
    }
    for (const idx of mergeTriangles(g.verts, g.tris)) pieces.push(Float64Array.from(idx.flatMap(i => g.verts[i])));
  }
  const mass = traits.mass;
  const def = {
    ch: chars.join(''), traits, metrics: { ...m, aspect: Math.min(w, h) / Math.max(w, h) },
    pieces, radius, mass, inertia: iRaw * mass / areaSum,
    rings: groups.flatMap(g => g.rings), path: null,
  };
  def.traits.sweepMul = q(1 - 0.55 * traits.sweepEff); // スイープ中の摩擦倍率
  if (typeof Path2D !== 'undefined') {
    const path = new Path2D();
    for (const ring of def.rings) {
      ring.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
      path.closePath();
    }
    def.path = path;
  }
  return def;
}
