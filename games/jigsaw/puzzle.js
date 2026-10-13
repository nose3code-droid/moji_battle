// 字のジグソー：ピースの作り方（画面には依存しない部分）
// 字を大きく描いて格子に分け、つまみ（凸凹）の切り口でピースにする。同じ字・むずかしさ・シードなら必ず同じピースになる。
// 座標は「モデル座標」：字の外接四角の左上が (0,0)、長い辺が L、y は下向き

export const L = 840;          // 字の長い辺の長さ
const MS = 0.5;                // 中身があるかを数えるときの縮尺（1ピクセル = 2 モデル単位）
export const PAD = 0.32;       // ピース画像の余白（つまみがはみ出す分）。セル幅に対する比

// むずかしさ：ねらいのピース数と、回転の有無
export const LEVELS = [
  { name: 'やさしい',   target: 7.5, rotate: false },
  { name: 'ふつう',     target: 16,  rotate: false },
  { name: 'むずかしい', target: 32,  rotate: true },
];

// ---------- 乱数（同じ入力なら同じ並び） ----------
export function makeRng(parts) {
  let h = 2166136261;
  for (const v of parts) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 15; }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 字の絵：{ W, H, draw(ctx, color) }。字の外接四角の左上が原点 ----------
// フォントの輪郭から（opentype.js の font。フォントに無い字なら例外）
export function glyphFromFont(font, ch) {
  const g = font.charToGlyph(ch);
  if (!g || g.index === 0) throw new Error('フォントに無い字');
  const path = font.getPath(ch, 0, 0, 1000);
  const bb = path.getBoundingBox();
  const bw = bb.x2 - bb.x1, bh = bb.y2 - bb.y1;
  if (!(bw > 0 && bh > 0)) throw new Error('この字は表示できません');
  const sc = L / Math.max(bw, bh);
  return {
    kind: 'outline', W: bw * sc, H: bh * sc,
    draw(ctx, color) {
      ctx.save(); ctx.scale(sc, sc); ctx.translate(-bb.x1, -bb.y1);
      path.fill = color; path.stroke = null; path.draw(ctx);
      ctx.restore();
    },
  };
}

// フォントや CDN が読めないときの代わり：canvas に字を描いて外接四角を測る
export function glyphFromCanvas(ch, family) {
  const em = 400, cw = em * 2, chh = em * 2, bx = em * 0.4, by = em * 1.3;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = chh;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.font = `700 ${em}px ${family}`; c.textBaseline = 'alphabetic'; c.fillStyle = '#000';
  c.fillText(ch, bx, by);
  const d = c.getImageData(0, 0, cw, chh).data;
  let x0 = cw, x1 = -1, y0 = chh, y1 = -1;
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    if (d[(y * cw + x) * 4 + 3] > 100) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('この字は表示できません');
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, sc = L / Math.max(bw, bh);
  return {
    kind: 'canvas', W: bw * sc, H: bh * sc,
    draw(ctx, color) {
      ctx.save(); ctx.fillStyle = color; ctx.font = `700 ${em}px ${family}`; ctx.textBaseline = 'alphabetic';
      ctx.scale(sc, sc); ctx.fillText(ch, bx - x0, by - y0);
      ctx.restore();
    },
  };
}

const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

// ---------- つまみ ----------
// 長さ1の辺に沿って u（0〜1）、はみ出す向きが v。3次ベジェの列 [p0, c1, c2, p3] を返す
function tabSegments({ s, c, H, h, n }) {
  const P = (u, v) => [u, v * s];
  const line = (a, b) => [P(...a), P(a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3), P(a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3), P(...b)];
  return [
    line([0, 0], [c - n, 0]),
    [P(c - n, 0), P(c - n, 0.35 * H), P(c - h, 0.30 * H), P(c - h, 0.62 * H)],
    [P(c - h, 0.62 * H), P(c - h, 0.90 * H), P(c - 0.5 * h, H), P(c, H)],
    [P(c, H), P(c + 0.5 * h, H), P(c + h, 0.90 * H), P(c + h, 0.62 * H)],
    [P(c + h, 0.62 * H), P(c + h, 0.30 * H), P(c + n, 0.35 * H), P(c + n, 0)],
    line([c + n, 0], [1, 0]),
  ];
}

// ---------- ピースを作る ----------
// src：字の絵　lv：0〜2　seedParts：乱数の種になる整数の配列
export function buildPuzzle(src, lv, seedParts) {
  const rng = makeRng(seedParts);
  const W = src.W, H = src.H;

  // 字のマスク（縮尺 MS）と、その積分画像（四角の中に字が何ピクセルあるかをすぐ数える）
  const mw = Math.ceil(W * MS), mh = Math.ceil(H * MS);
  const mc = newCanvas(mw, mh), mx = mc.getContext('2d', { willReadFrequently: true });
  mx.scale(MS, MS); src.draw(mx, '#000');
  const md = mx.getImageData(0, 0, mw, mh).data;
  const sat = new Int32Array((mw + 1) * (mh + 1));
  for (let y = 0; y < mh; y++) {
    let row = 0;
    for (let x = 0; x < mw; x++) {
      row += md[(y * mw + x) * 4 + 3] >= 128 ? 1 : 0;
      sat[(y + 1) * (mw + 1) + x + 1] = sat[y * (mw + 1) + x + 1] + row;
    }
  }
  const countRect = (x0, y0, x1, y1) => {
    const a = Math.max(0, Math.floor(x0 * MS)), b = Math.max(0, Math.floor(y0 * MS));
    const c = Math.min(mw, Math.ceil(x1 * MS)), d = Math.min(mh, Math.ceil(y1 * MS));
    if (c <= a || d <= b) return 0;
    return sat[d * (mw + 1) + c] - sat[b * (mw + 1) + c] - sat[d * (mw + 1) + a] + sat[b * (mw + 1) + a];
  };

  // 格子の大きさと位置を選ぶ：字に重なるセルの数がねらいに近く、かけらのように小さいセルが少ないもの
  const lvInfo = LEVELS[lv];
  let best = null;
  for (let g = 2; g <= 26; g++) {
    const cell = L / g;
    const cols = Math.ceil(W / cell - 1e-9), rows = Math.ceil(H / cell - 1e-9);
    for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
      const gox = -fx * (cols * cell - W), goy = -fy * (rows * cell - H);
      let kept = 0, tiny = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const n = countRect(gox + c * cell, goy + r * cell, gox + (c + 1) * cell, goy + (r + 1) * cell);
        if (n > 0) { kept++; if (n < 0.05 * cell * cell * MS * MS) tiny++; }
      }
      if (kept < 2 && g < 26) continue;
      const diff = lv === 2 ? (kept < 30 ? (30 - kept) * 3 : kept - 30) : Math.abs(kept - lvInfo.target) + (lv === 0 && kept < 6 ? 3 : 0);
      const score = diff + 1.5 * tiny + rng() * 0.01;
      if (!best || score < best.score) best = { score, g, cell, cols, rows, gox, goy };
    }
  }
  const { g, cell, cols, rows, gox, goy } = best;

  const keptCell = [];
  for (let r = 0; r < rows; r++) {
    keptCell.push([]);
    for (let c = 0; c < cols; c++) {
      keptCell[r].push(countRect(gox + c * cell, goy + r * cell, gox + (c + 1) * cell, goy + (r + 1) * cell) > 0);
    }
  }
  const isKept = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && keptCell[r][c];

  // 辺ごとのつまみ（両側のセルに字があるときだけ。乱数は全部の辺で同じ順に使う）
  const mkEdge = () => ({
    s: rng() < 0.5 ? -1 : 1, c: 0.42 + rng() * 0.16, H: 0.22 + rng() * 0.06,
    h: 0.115 + rng() * 0.025, n: 0.055 + rng() * 0.015,
  });
  const hEdge = [], vEdge = [];   // hEdge[r][c]：(r,c) の下の辺　vEdge[r][c]：(r,c) の右の辺
  for (let r = 0; r < rows; r++) {
    hEdge.push([]); vEdge.push([]);
    for (let c = 0; c < cols; c++) {
      const he = mkEdge(), ve = mkEdge();
      hEdge[r].push(isKept(r, c) && isKept(r + 1, c) ? tabSegments(he) : null);
      vEdge[r].push(isKept(r, c) && isKept(r, c + 1) ? tabSegments(ve) : null);
    }
  }

  const f = v => v.toFixed(2);
  const pad = PAD * cell;
  const cands = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!keptCell[r][c]) continue;
    const x0 = gox + c * cell, y0 = goy + r * cell, x1 = x0 + cell, y1 = y0 + cell;
    let d = `M${f(x0)} ${f(y0)}`, flats = 0;
    // 辺を（はじめの点を除いて）たどる。reverse なら逆向き
    const edge = (segs, map, reverse) => {
      if (!segs) { flats++; return null; }
      const list = reverse ? segs.slice().reverse().map(([a, b, c2, e]) => [e, c2, b, a]) : segs;
      let out = '';
      for (const [, p1, p2, p3] of list) out += `C${map(p1).map(f).join(' ')} ${map(p2).map(f).join(' ')} ${map(p3).map(f).join(' ')}`;
      return out;
    };
    const top = r > 0 ? hEdge[r - 1][c] : null, bottom = hEdge[r][c];
    const left = c > 0 ? vEdge[r][c - 1] : null, right = vEdge[r][c];
    // 上：左→右（u が x、v が +y）
    d += edge(top, ([u, v]) => [x0 + u * cell, y0 + v * cell], false) ?? `L${f(x1)} ${f(y0)}`;
    // 右：上→下（u が y、v が +x）
    d += edge(right, ([u, v]) => [x1 + v * cell, y0 + u * cell], false) ?? `L${f(x1)} ${f(y1)}`;
    // 下：右→左
    d += edge(bottom, ([u, v]) => [x0 + u * cell, y1 + v * cell], true) ?? `L${f(x0)} ${f(y1)}`;
    // 左：下→上
    d += edge(left, ([u, v]) => [x0 + v * cell, y0 + u * cell], true) ?? `L${f(x0)} ${f(y0)}`;
    d += 'Z';
    cands.push({ r, c, d, flats, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rect: { x: x0, y: y0, w: cell, h: cell } });
  }

  // つまみを足したあとの形で字がまったく残らないピースは捨てる。あわせて字の面積を数える
  const pieces = [];
  const cw = (cell + 2 * pad) * MS;
  const tc = newCanvas(cw, cw), tx = tc.getContext('2d', { willReadFrequently: true });
  for (const p of cands) {
    tx.setTransform(1, 0, 0, 1, 0, 0); tx.clearRect(0, 0, tc.width, tc.height);
    tx.globalCompositeOperation = 'source-over';
    tx.setTransform(MS, 0, 0, MS, (pad - p.rect.x) * MS, (pad - p.rect.y) * MS);
    tx.fillStyle = '#000'; tx.fill(new Path2D(p.d));
    tx.globalCompositeOperation = 'source-in';
    src.draw(tx, '#000');
    const data = tx.getImageData(0, 0, tc.width, tc.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) n++;
    if (n === 0) continue;
    pieces.push({ id: pieces.length, ...p, ink: n / (MS * MS), path: new Path2D(p.d) });
  }

  // ボードの範囲（ピースのセルをすべて含む）
  let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
  for (const p of pieces) {
    wx0 = Math.min(wx0, p.rect.x); wy0 = Math.min(wy0, p.rect.y);
    wx1 = Math.max(wx1, p.rect.x + cell); wy1 = Math.max(wy1, p.rect.y + cell);
  }
  return { src, lv, g, cell, pad, cols, rows, gox, goy, pieces, rotate: lvInfo.rotate, W, H, world: { x0: wx0, y0: wy0, x1: wx1, y1: wy1 } };
}

// ---------- ピースの絵（縮尺 k：モデル1単位が k ピクセル） ----------
export const PAPER = '#f7f0df', INK = '#2b2d42';
export function renderPieceImages(puz, k) {
  const size = (puz.cell + 2 * puz.pad) * k;
  for (const p of puz.pieces) {
    const cv = newCanvas(size, size), c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, (puz.pad - p.rect.x) * k, (puz.pad - p.rect.y) * k);
    const x = p.rect.x, y = p.rect.y, w = puz.cell;
    c.save();
    c.clip(p.path);
    c.fillStyle = PAPER; c.fillRect(x - puz.pad, y - puz.pad, w + 2 * puz.pad, w + 2 * puz.pad);
    puz.src.draw(c, INK);
    const gr = c.createLinearGradient(x, y, x + w, y + w);   // 左上が明るく、右下が暗い：立体感
    gr.addColorStop(0, 'rgba(255,255,255,.38)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.16)');
    c.fillStyle = gr; c.fillRect(x - puz.pad, y - puz.pad, w + 2 * puz.pad, w + 2 * puz.pad);
    c.restore();
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(40,30,20,.55)'; c.lineWidth = 3; c.stroke(p.path);
    c.save(); c.clip(p.path);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 3; c.translate(2, 2); c.stroke(p.path);   // 内側の縁のハイライト
    c.restore();
    p.img = cv;
  }
  puz.imgK = k;
}

// ---------- 自己検査（テスト用）：空のピース／かけ／重なりがないか ----------
// 全ピースの字の部分を正解位置に重ねて、元の字と見比べる。差のあるピクセルの数などを返す
export function selfCheck(puz) {
  const cw = Math.ceil(puz.W * MS), ch = Math.ceil(puz.H * MS);
  const a = newCanvas(cw, ch), b = newCanvas(cw, ch);
  const ax = a.getContext('2d', { willReadFrequently: true }), bx = b.getContext('2d', { willReadFrequently: true });
  ax.scale(MS, MS); puz.src.draw(ax, '#000');
  bx.scale(MS, MS);
  let empty = 0;
  for (const p of puz.pieces) {
    if (!(p.ink > 0)) empty++;
    bx.save(); bx.clip(p.path); puz.src.draw(bx, '#000'); bx.restore();
  }
  const da = ax.getImageData(0, 0, cw, ch).data, db = bx.getImageData(0, 0, cw, ch).data;
  let ink = 0, lost = 0, extra = 0;
  for (let i = 3; i < da.length; i += 4) {
    if (da[i] >= 128) ink++;
    if (da[i] >= 230 && db[i] < 110) lost++;     // 元の字のまんなかにあるのに、ピースの側に無い（かけ。ふちの半端なピクセルは数えない）
    if (da[i] < 25 && db[i] >= 128) extra++;      // 元の字に無いのに、ピースの側にある
  }
  // 重なり：ピースの形（塗り）を全部足して、同じ場所に2枚以上が濃く重なるところを数える
  const cover = new Float32Array(cw * ch);
  const t = newCanvas(cw, ch), tx = t.getContext('2d', { willReadFrequently: true });
  for (const p of puz.pieces) {
    tx.setTransform(1, 0, 0, 1, 0, 0); tx.clearRect(0, 0, cw, ch);
    tx.setTransform(MS, 0, 0, MS, 0, 0); tx.fillStyle = '#000'; tx.fill(p.path);
    const d = tx.getImageData(0, 0, cw, ch).data;
    for (let i = 0; i < cover.length; i++) cover[i] += d[i * 4 + 3] / 255;
  }
  let overlap = 0;
  for (const v of cover) if (v > 1.6) overlap++;
  const centers = new Set(puz.pieces.map(p => `${p.r},${p.c}`));
  return { pieces: puz.pieces.length, empty, ink, lost, extra, overlap, unique: centers.size === puz.pieces.length };
}
