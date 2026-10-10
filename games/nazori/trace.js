// なぞりの判定：お手本の字を canvas に描いてマスクにし、プレイヤーの軌跡との重なりで精度を出す
export const R = 160;          // 判定用の解像度（正方形）
export const BRUSH = 13;       // なぞる筆の太さ
const TOL = 7;                 // お手本からのはみ出しを許す幅
export let FAMILY = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
export const setFamily = f => { FAMILY = f; cache.clear(); };

const cache = new Map();
const mk = () => { const c = document.createElement('canvas'); c.width = c.height = R; return c; };
const scratch = mk();

// 字を R×R の中央に収めるときのフォントサイズと基準位置
export function fit(ch) {
  const c = scratch.getContext('2d');
  c.font = `900 100px ${FAMILY}`;
  const m = c.measureText(ch);
  const l = m.actualBoundingBoxLeft, r = m.actualBoundingBoxRight, a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
  const sc = (R * 0.82) / Math.max(l + r, a + d);
  return { fs: 100 * sc, ox: R / 2 + (l - r) / 2 * sc, oy: R / 2 + (a - d) / 2 * sc };
}

export function template(ch) {
  if (cache.has(ch)) return cache.get(ch);
  const f = fit(ch);
  const cv = mk(), c = cv.getContext('2d', { willReadFrequently: true });
  c.font = `900 ${f.fs}px ${FAMILY}`; c.textBaseline = 'alphabetic';
  c.fillText(ch, f.ox, f.oy);
  const a = c.getImageData(0, 0, R, R).data;
  const mask = new Uint8Array(R * R); let count = 0;
  for (let i = 0; i < R * R; i++) if (a[i * 4 + 3] > 127) { mask[i] = 1; count++; }
  c.clearRect(0, 0, R, R);
  c.lineWidth = TOL * 2; c.lineJoin = 'round'; c.strokeText(ch, f.ox, f.oy); c.fillText(ch, f.ox, f.oy);
  const b = c.getImageData(0, 0, R, R).data;
  const tol = new Uint8Array(R * R);
  for (let i = 0; i < R * R; i++) if (b[i * 4 + 3] > 127) tol[i] = 1;
  const t = { ch, fit: f, mask, tol, count };
  cache.set(ch, t);
  return t;
}

// 軌跡（R座標の点列の配列）を採点：お手本をどれだけ埋めたか × はみ出しの少なさ
export function evaluate(ch, strokes) {
  const t = template(ch);
  const cv = mk(), c = cv.getContext('2d', { willReadFrequently: true });
  c.lineWidth = BRUSH; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#000';
  for (const s of strokes) {
    if (!s.length) continue;
    c.beginPath(); c.moveTo(s[0].x, s[0].y);
    if (s.length === 1) c.lineTo(s[0].x + 0.01, s[0].y);
    for (let i = 1; i < s.length; i++) c.lineTo(s[i].x, s[i].y);
    c.stroke();
  }
  const a = c.getImageData(0, 0, R, R).data;
  let hit = 0, total = 0, out = 0;
  for (let i = 0; i < R * R; i++) {
    if (a[i * 4 + 3] > 127) { total++; if (!t.tol[i]) out++; if (t.mask[i]) hit++; }
  }
  if (!total) return { acc: 0, cov: 0, out: 0 };
  const cov = hit / t.count, o = out / total;
  const acc = Math.max(0, Math.min(1, cov * (1 - Math.min(1, o * 1.3)))) * 100;
  return { acc, cov: cov * 100, out: o * 100 };
}

// テスト用：お手本の内側を横線でなぞるための走査線（行ごとの連続区間）
export function scanRuns(ch, step = 6) {
  const t = template(ch), runs = [];
  for (let y = 4; y < R - 3; y += step) {
    let x = 0;
    while (x < R) {
      if (!t.mask[y * R + x]) { x++; continue; }
      let x1 = x; while (x1 + 1 < R && t.mask[y * R + x1 + 1]) x1++;
      if (x1 - x >= 3) runs.push({ y, x0: x + 1.5, x1: x1 - 1.5 }); else runs.push({ y, x0: x, x1 });
      x = x1 + 1;
    }
  }
  return runs;
}
