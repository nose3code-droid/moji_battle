// リングのネット：見た目だけの簡単なヴェルレ法の布（物理の結果には関係しない）
const COLS = 7, ROWS = 5, LEN = 0.5, TAPER = 0.4;

export function makeNet(ring, pos) {
  const nodes = [];
  for (let k = 0; k < ROWS; k++) for (let i = 0; i < COLS; i++) {
    const p = home(ring, pos, i, k);
    nodes.push({ x: p.x, y: p.y, px: p.x, py: p.y });
  }
  return { ring, nodes };
}

// 節 (i, k) の「つるした位置」：下ほど細くなる
function home(ring, pos, i, k) {
  const w = 1 - TAPER * k / (ROWS - 1);
  return { x: pos.x + (i / (COLS - 1) * 2 - 1) * ring.r * w, y: pos.y - LEN * k / (ROWS - 1) };
}

// 1ステップ進める。ball は { x, y, r } か null（ボールが網を押しのける）
export function stepNet(net, pos, ball) {
  const { ring, nodes } = net;
  for (let k = 0; k < ROWS; k++) for (let i = 0; i < COLS; i++) {
    const n = nodes[k * COLS + i];
    if (k === 0) { const h = home(ring, pos, i, 0); n.x = n.px = h.x; n.y = n.py = h.y; continue; } // 上の段はふちに固定
    const vx = (n.x - n.px) * 0.96, vy = (n.y - n.py) * 0.96;
    n.px = n.x; n.py = n.y;
    n.x += vx; n.y += vy - 0.0009;
    const h = home(ring, pos, i, k);                // もとの形に戻ろうとするバネ
    n.x += (h.x - n.x) * 0.06; n.y += (h.y - n.y) * 0.06;
    if (ball) {
      const dx = n.x - ball.x, dy = n.y - ball.y, d = Math.hypot(dx, dy);
      if (d < ball.r && d > 1e-6) { n.x = ball.x + dx / d * ball.r; n.y = ball.y + dy / d * ball.r; }
    }
  }
}

// 描画用の線（縦の糸と横の糸）を座標の配列で返す
export function netLines(net) {
  const lines = [], at = (i, k) => net.nodes[k * COLS + i];
  for (let i = 0; i < COLS; i++) lines.push(Array.from({ length: ROWS }, (_, k) => at(i, k)));
  for (let k = 1; k < ROWS; k++) lines.push(Array.from({ length: COLS }, (_, i) => at(i, k)));
  // ひし形の網目っぽく斜めも
  for (let i = 0; i < COLS - 1; i++) {
    lines.push(Array.from({ length: ROWS }, (_, k) => at(Math.min(COLS - 1, i + (k % 2)), k)));
  }
  return lines;
}
