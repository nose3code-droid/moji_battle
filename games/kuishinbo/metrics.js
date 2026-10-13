// 主人公の字 → 性能。形の指標（丸さ・縦横比・面積の詰まり）から決定的に決める
// CDN が読めたら glyph.js の shapeMetrics、読めなければ canvas に描いたマスクから同じ指標を出す
import { FONT_URL } from '../../config.js';

const FAMILY = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", "IPAGothic", sans-serif';
export const FONT_FAMILY = FAMILY;

let glyph = null, font = null, loading = null;
// フォントの読み込み（失敗してもよい。10秒で諦める）
export function loadGlyphLib() {
  if (!loading) loading = (async () => {
    try {
      const [g, opentype] = await Promise.all([import('../../glyph.js'), import('opentype')]);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      const res = await fetch(FONT_URL, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('font ' + res.status);
      font = opentype.parse(await res.arrayBuffer());
      glyph = g;
      return true;
    } catch (e) {
      console.warn('フォントを読み込めなかったので、canvas の字から性能を決めます', e);
      glyph = font = null;
      return false;
    }
  })();
  return loading;
}
export const usingFont = () => !!glyph;

// 指標：roundness 丸さ（0〜1）/ aspect 縦横比（横÷縦）/ fill 外接長方形の中の詰まり（0〜1）
function rawMetrics(ch) {
  if (glyph) {
    const polys = glyph.glyphPolygons(font, ch, 100);
    if (polys.length) {
      const m = glyph.shapeMetrics(polys);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const { outer } of polys) for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      return { roundness: m.roundness, aspect: w / h, fill: Math.min(1, m.area / (w * h)) };
    }
  }
  return canvasMetrics(ch);
}

function canvasMetrics(ch) {
  const N = 96, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${N * 0.8}px ${FAMILY}`;
  g.fillText(ch, N / 2, N / 2 + N * 0.04);
  const d = g.getImageData(0, 0, N, N).data;
  let x0 = N, y0 = N, x1 = -1, y1 = -1, area = 0;
  const lo = new Array(N).fill(N), hi = new Array(N).fill(-1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (d[(y * N + x) * 4 + 3] > 128) {
      area++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      lo[y] = Math.min(lo[y], x); hi[y] = Math.max(hi[y], x);
    }
  }
  if (x1 < 0) return { roundness: 0.6, aspect: 1, fill: 0.5 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  // 凸包の丸さ（glyph.js の shapeMetrics と同じ 4πA/P²）
  const pts = [];
  for (let y = 0; y < N; y++) if (hi[y] >= 0) { pts.push({ x: lo[y], y }, { x: hi[y] + 1, y: y + 1 }); }
  const hull = hullOf(pts);
  let ha = 0, hp = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    ha += a.x * b.y - b.x * a.y; hp += Math.hypot(b.x - a.x, b.y - a.y);
  }
  ha = Math.abs(ha) / 2;
  return { roundness: hp > 0 ? Math.min(1, 4 * Math.PI * ha / (hp * hp)) : 0, aspect: w / h, fill: Math.min(1, area / (w * h)) };
}

function hullOf(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 指標 → ゲームでの性能
//   speed    進む速さ（マス/秒）。細長い字（縦横比が極端）ほど速い
//   turn     曲がり角の許容（マス）。丸い字ほど手前でも曲がれる
//   eatR     粒を食べる範囲（マス）。詰まった（面積の大きい）字ほど広い
//   hitR     おばけに触れる当たり判定の半径（マス）。細長い字は小さい
//   scale    表示の大きさ（1 = 1マス分）
export function statsFor(ch) {
  const m = rawMetrics(ch);
  const slender = clamp(Math.abs(Math.log(m.aspect)) / 0.9, 0, 1);       // 0 正方形 → 1 とても細長い
  const thin = clamp((0.62 - m.fill) / 0.42, 0, 1);                        // 0 みっしり → 1 すかすか（一・川など）
  const speed = 5.4 + 1.0 * slender + 0.5 * thin;
  const turn = 0.06 + 0.26 * clamp((m.roundness - 0.55) / 0.4, 0, 1);
  const eatR = clamp(0.5 + 0.28 * m.fill - 0.08 * slender, 0.45, 0.78);
  const hitR = clamp(0.5 - 0.1 * slender - 0.06 * thin, 0.34, 0.5);
  const stars = v => Math.max(1, Math.min(5, Math.round(v)));
  return {
    ch, metrics: m, speed, turn, eatR, hitR,
    rating: { speed: stars(1 + (speed - 5.4) / 1.5 * 4), turn: stars(1 + turn / 0.32 * 4), eat: stars(1 + (eatR - 0.45) / 0.33 * 4) },
  };
}
