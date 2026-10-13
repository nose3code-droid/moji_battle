// 字 → ブロック用の形（輪郭の線分・砕ける破片・描画用の輪郭）に変換する。DOM 非依存。
import * as THREE from 'three';
import { glyphPolygons, centerPolygons } from '../../glyph.js';

// 画数（硬さ）。表にない字は FALLBACK_STROKES
export const STROKES = {
  口: 3, 日: 4, 月: 4, 田: 5, 国: 8, 森: 12, 十: 2, 井: 4, 木: 4, 米: 6,
  あ: 3, め: 2, ゆ: 2, 雨: 8, 電: 13, 回: 6, 器: 15, 鬱: 29, 龍: 16, 竜: 10, 立: 5,
  '◎': 2, '※': 4, 大: 3, 小: 3, 速: 10, 分: 4, 火: 4, 命: 8,
};
const FALLBACK_STROKES = 3;
export const strokesOf = ch => STROKES[ch] ?? FALLBACK_STROKES;

const cache = new Map();

export function hasGlyph(font, ch) {
  const g = font.charToGlyph(ch);
  return !!g && g.index !== 0;
}

// 字 1 つぶんの形。連結成分（外形ごと）を comps にわける。座標は字の中心が原点、y は画面と同じ下向き
export function buildGlyph(font, ch, size) {
  const key = ch + ':' + size;
  if (cache.has(key)) return cache.get(key);
  const polys = glyphPolygons(font, ch, size);
  if (!polys.length) throw new Error('輪郭のない文字: ' + ch);
  const dims = centerPolygons(polys);
  const comps = polys.map(({ outer, holes }) => {
    const all = outer.concat(...holes);
    const tris = THREE.ShapeUtils.triangulateShape(outer, holes)
      .map(([i, j, k]) => [all[i].x, -all[i].y, all[j].x, -all[j].y, all[k].x, -all[k].y]);
    const loops = [outer, ...holes].map(pts => {
      const a = new Float64Array(pts.length * 2);
      pts.forEach((q, i) => { a[i * 2] = q.x; a[i * 2 + 1] = -q.y; });
      return a;
    });
    const nseg = loops.reduce((s, l) => s + l.length / 2, 0);
    const segs = new Float64Array(nseg * 4);
    let o = 0;
    for (const l of loops) {
      const m = l.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        segs[o++] = l[i * 2]; segs[o++] = l[i * 2 + 1]; segs[o++] = l[j * 2]; segs[o++] = l[j * 2 + 1];
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, -q.y); y1 = Math.max(y1, -q.y); }
    const area = Math.abs(THREE.ShapeUtils.area(outer)) - holes.reduce((s, h) => s + Math.abs(THREE.ShapeUtils.area(h)), 0);
    return { loops, segs, tris, bbox: [x0, y0, x1, y1], area: Math.max(area, 1) };
  });
  const geom = { ch, size, w: dims.x, h: dims.y, comps };
  cache.set(key, geom);
  return geom;
}

// 画数 total を成分の面積に応じて割りふる（各成分 1 以上、合計は total 以上にならないよう最大剰余法）
export function allocHp(total, comps) {
  const n = comps.length;
  if (n === 1) return [total];
  if (total <= n) return comps.map(() => 1);
  const sum = comps.reduce((s, c) => s + c.area, 0);
  const rest = total - n;
  const raw = comps.map(c => rest * c.area / sum);
  const hp = raw.map(v => 1 + Math.floor(v));
  let left = total - hp.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) hp[order[k][1]]++;
  return hp;
}

// 点が成分の内側か（偶奇判定）
export function insideComp(c, x, y) {
  const s = c.segs;
  let inside = false;
  for (let i = 0; i < s.length; i += 4) {
    const ay = s[i + 1], by = s[i + 3];
    if ((ay > y) !== (by > y) && x < (s[i + 2] - s[i]) * (y - ay) / (by - ay) + s[i]) inside = !inside;
  }
  return inside;
}
