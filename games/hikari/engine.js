// 光と闇のともしび：光線の計算（DOM に依存しない純粋なロジック。ゲーム本体とソルバーの両方が使う）
// 座標は盤面のマス (x, y)、y は下向き。向き 0=右 1=下 2=左 3=上
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// 鏡の向き o（タップで +1 = 45°回転）：0 「—」 1 「／」 2 「｜」 3 「＼」
// REFLECT[o][入ってくる向き] = 出ていく向き。-1 は鏡の側面に当たってそのまま通り抜ける
const REFLECT = [
  [-1, 3, -1, 1],
  [3, 2, 1, 0],
  [2, -1, 0, -1],
  [1, 0, 3, 2],
];

// 地図の文字：# 石  . 床  S 光の源  T ともしび台  Y 闇  W 水（プリズム）
export function parseLevel(level) {
  const grid = level.rows.map(r => r.split(''));
  const rows = grid.length, cols = grid[0].length;
  const targets = [];
  let src = null;
  for (let y = 0; y < rows; y++) {
    if (grid[y].length !== cols) throw new Error(`面${level.id}: ${y}行目の長さが違う`);
    for (let x = 0; x < cols; x++) {
      const c = grid[y][x];
      if (c === 'S') src = { x, y, dir: level.dir };
      if (c === 'T') targets.push({ x, y });
    }
  }
  if (!src) throw new Error(`面${level.id}: S がない`);
  return { cols, rows, grid, src, targets };
}

// 光線をたどる。mirrors: [{x,y,o,type}]（type 'm' 鏡 / 'h' 半透鏡）、dissolved: 晴れた闇のマス番号の Set
export function trace(P, mirrors, dissolved) {
  const { cols, rows, grid } = P;
  const mAt = new Map();
  for (const m of mirrors) mAt.set(m.y * cols + m.x, m);
  const tIdx = new Map(P.targets.map((t, i) => [t.y * cols + t.x, i]));
  const segs = [], lit = new Set(), hitDark = new Set(), seen = new Set();
  const queue = [{ x: P.src.x, y: P.src.y, d: P.src.dir }];
  let guard = 0;
  while (queue.length && guard++ < 400) {
    let { x, y, d } = queue.pop();
    const sx = x, sy = y;
    for (let step = 0; step < 200; step++) {
      const [dx, dy] = DIRS[d];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { segs.push([sx, sy, x + dx * 0.5, y + dy * 0.5]); break; }
      const c = grid[ny][nx], cell = ny * cols + nx;
      const edge = [sx, sy, nx - dx * 0.5, ny - dy * 0.5]; // 手前の縁で止まる
      if (c === '#' || c === 'S') { segs.push(edge); break; }
      if (c === 'Y' && !dissolved.has(cell)) { hitDark.add(cell); segs.push(edge); break; }
      const key = cell * 4 + d;
      if (seen.has(key)) { segs.push([sx, sy, nx, ny]); break; }
      seen.add(key);
      x = nx; y = ny;
      if (c === 'T') { lit.add(tIdx.get(cell)); segs.push([sx, sy, x, y]); break; }
      if (c === 'W') { // プリズム：進行方向と直角の 2 本に分かれる
        segs.push([sx, sy, x, y]);
        queue.push({ x, y, d: (d + 1) % 4 }, { x, y, d: (d + 3) % 4 });
        break;
      }
      const m = mAt.get(cell);
      if (m) {
        const nd = REFLECT[m.o][d];
        if (nd === -1) continue; // 側面：通り抜ける
        segs.push([sx, sy, x, y]);
        queue.push({ x, y, d: nd });
        if (m.type === 'h') queue.push({ x, y, d }); // 半透鏡：まっすぐ進む光も残る
        break;
      }
    }
  }
  return { segs, lit, hitDark };
}

// 闇が晴れて新しく光が通るようになるぶんまで、固定点になるまで繰り返す（dissolved は書き換わる）
export function simulate(P, mirrors, dissolved) {
  for (let i = 0; i < 50; i++) {
    const r = trace(P, mirrors, dissolved);
    let changed = false;
    for (const k of r.hitDark) if (!dissolved.has(k)) { dissolved.add(k); changed = true; }
    if (!changed) return r;
  }
  throw new Error('simulate: 収束しない');
}

export const isSolved = (P, r) => r.lit.size === P.targets.length;

// 鏡を置けるマスか（床、または晴れた闇。ほかの鏡のいるマスは不可）
export function canPlace(P, mirrors, dissolved, x, y, self) {
  if (x < 0 || y < 0 || x >= P.cols || y >= P.rows) return false;
  const c = P.grid[y][x], cell = y * P.cols + x;
  if (!(c === '.' || (c === 'Y' && dissolved.has(cell)))) return false;
  return !mirrors.some(m => m !== self && m.x === x && m.y === y);
}
