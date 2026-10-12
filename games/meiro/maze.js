// 迷路づくり：使えるマスの判定 → パーツ同士に橋 → 深さ優先探索で迷路 → スタート／ゴールと最短経路
// 字の形（inside）と数値だけで決まるので、同じ字・同じ大きさ・同じシードなら必ず同じ迷路になる
import { mulberry32, hashSeed } from '../dungeon/rng.js';

// 向き：0 上 / 1 右 / 2 下 / 3 左。open の各ビットが「その向きに通れる」
export const DIRS = [{ dx: 0, dy: -1, bit: 1 }, { dx: 1, dy: 0, bit: 2 }, { dx: 0, dy: 1, bit: 4 }, { dx: -1, dy: 0, bit: 8 }];
// across：字の長いほうの辺を何マスに分けるか。minCells：使えるマスがこれより少ないときは細かくして作り直す
export const LEVELS = [
  { name: 'やさしい', across: 12, minCells: 30 },
  { name: 'ふつう', across: 20, minCells: 60 },
  { name: 'むずかしい', across: 32, minCells: 110 },
];
const BRAID = 0.04;       // 行き止まりでない壁をこの確率で壊して、近道（輪）を少し作る
const MAX_REFINE = 5;     // 細かくして作り直す最大回数（×1.25 ずつ）

// 字を across マスに分けて、各マスの中が字の内側かを 3×3 点でためす（3点以上が内側なら使えるマス）
function rasterize(shape, across) {
  const cs = Math.max(shape.W, shape.H) / across;
  const cols = Math.ceil(shape.W / cs), rows = Math.ceil(shape.H / cs);
  const ox = -cols * cs / 2, oy = -rows * cs / 2;
  const usable = new Uint8Array(cols * rows);
  let cells = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let hit = 0;
    for (let j = 0; j < 3 && hit < 3; j++) for (let i = 0; i < 3; i++) {
      if (shape.inside(ox + (c + (i * 2 + 1) / 6) * cs, oy + (r + (j * 2 + 1) / 6) * cs)) hit++;
    }
    if (hit >= 3) { usable[r * cols + c] = 1; cells++; }
  }
  return { cols, rows, cs, ox, oy, usable, bridge: new Uint8Array(cols * rows), cells };
}

// つながっている使えるマスのかたまり（パーツ）に分けて、小さすぎるごみを捨て、残りを橋でつなぐ
function connectParts(g) {
  const { cols, rows, usable } = g;
  const n = cols * rows;
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const nbrs = i => {
    const c = i % cols, r = (i / cols) | 0, out = [];
    if (r > 0) out.push(i - cols);
    if (c < cols - 1) out.push(i + 1);
    if (r < rows - 1) out.push(i + cols);
    if (c > 0) out.push(i - 1);
    return out;
  };
  for (let s = 0; s < n; s++) {
    if (!usable[s] || comp[s] >= 0) continue;
    const id = sizes.length, stack = [s];
    comp[s] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop(); size++;
      for (const j of nbrs(i)) if (usable[j] && comp[j] < 0) { comp[j] = id; stack.push(j); }
    }
    sizes.push(size);
  }
  if (!sizes.length) throw new Error('この字は迷路にできません');
  // 1マスだけのごみは捨てる（ただし全部1マスなら最大のものを残す）
  const big = Math.max(...sizes);
  const keep = sizes.map(s => s >= 2 || s === big);
  let kept = 0;
  const memberOf = sizes.map(() => []);
  for (let i = 0; i < n; i++) {
    if (comp[i] < 0) continue;
    if (!keep[comp[i]]) { usable[i] = 0; comp[i] = -1; } else memberOf[comp[i]].push(i);
  }
  for (const k of keep) if (k) kept++;
  g.parts = kept;

  // いちばん大きいパーツから始めて、いちばん近い別のパーツへ最短の橋（幅1マスの通路）をかけていく
  const joined = new Uint8Array(sizes.length), inSet = new Uint8Array(n);
  const first = sizes.indexOf(big);
  const join = id => { joined[id] = 1; for (const i of memberOf[id]) inSet[i] = 1; };
  join(first);
  let left = kept - 1;
  while (left > 0) {
    const parent = new Int32Array(n).fill(-1), seen = new Uint8Array(n);
    let queue = [];
    for (let i = 0; i < n; i++) if (inSet[i]) { seen[i] = 1; queue.push(i); }
    let found = -1;
    for (let q = 0; q < queue.length && found < 0; q++) {
      const i = queue[q];
      for (const j of nbrs(i)) {
        if (seen[j]) continue;
        seen[j] = 1; parent[j] = i; queue.push(j);
        if (usable[j] && comp[j] >= 0 && !joined[comp[j]]) { found = j; break; }
      }
    }
    for (let i = parent[found]; i >= 0 && !inSet[i]; i = parent[i]) { usable[i] = 1; g.bridge[i] = 1; inSet[i] = 1; }
    join(comp[found]);
    left--;
  }
  g.cells = 0;
  for (let i = 0; i < n; i++) if (usable[i]) g.cells++;
}

// 幅優先探索：from からの歩数（行けないマスは -1）
export function bfs(maze, from) {
  const { cols, open } = maze;
  const dist = new Int32Array(open.length).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (let d = 0; d < 4; d++) {
      if (!(open[i] & DIRS[d].bit)) continue;
      const j = i + DIRS[d].dy * cols + DIRS[d].dx;
      if (dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  return dist;
}

// from → to の最短経路（マス番号の列。両端を含む）
export function shortestPath(maze, from, to) {
  const dist = bfs(maze, to); // ゴール側から測れば、from から下るだけで経路になる
  if (dist[from] < 0) return null;
  const path = [from];
  let i = from;
  while (i !== to) {
    for (let d = 0; d < 4; d++) {
      if (!(maze.open[i] & DIRS[d].bit)) continue;
      const j = i + DIRS[d].dy * maze.cols + DIRS[d].dx;
      if (dist[j] === dist[i] - 1) { i = j; break; }
    }
    path.push(i);
  }
  return path;
}

const farthest = dist => { let b = 0; for (let i = 1; i < dist.length; i++) if (dist[i] > dist[b]) b = i; return b; };

// shape：{W,H,inside}、lv：LEVELS の番号、seedParts：同じ迷路にしたい数値（字のコード・シードなど）
// scale：マスの数にかける倍（2文字は大きいので 1.5）
export function makeMaze(shape, lv, seedParts, scale = 1) {
  const L = LEVELS[lv];
  let across = L.across * scale, g;
  for (let k = 0; k <= MAX_REFINE; k++) {
    g = rasterize(shape, across);
    if (g.cells >= L.minCells || k === MAX_REFINE) break;
    across *= 1.25;
  }
  connectParts(g);
  const { cols, rows, usable } = g;
  const n = cols * rows;

  // 深さ優先探索で、かべを壊しながら全マスをつなぐ
  const rng = mulberry32(hashSeed(...seedParts, lv));
  const open = new Uint8Array(n), seen = new Uint8Array(n);
  const first = usable.indexOf(1);
  const stack = [first];
  seen[first] = 1;
  while (stack.length) {
    const i = stack[stack.length - 1];
    const c = i % cols, r = (i / cols) | 0;
    const order = [0, 1, 2, 3];
    for (let k = 3; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    let moved = false;
    for (const d of order) {
      const nc = c + DIRS[d].dx, nr = r + DIRS[d].dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!usable[j] || seen[j]) continue;
      open[i] |= DIRS[d].bit; open[j] |= DIRS[(d + 2) % 4].bit;
      seen[j] = 1; stack.push(j); moved = true;
      break;
    }
    if (!moved) stack.pop();
  }
  // 近道：右・下の壁をときどき壊す
  for (let i = 0; i < n; i++) {
    if (!usable[i]) continue;
    const c = i % cols, r = (i / cols) | 0;
    for (const d of [1, 2]) {
      const nc = c + DIRS[d].dx, nr = r + DIRS[d].dy;
      if (nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (usable[j] && !(open[i] & DIRS[d].bit) && rng() < BRAID) { open[i] |= DIRS[d].bit; open[j] |= DIRS[(d + 2) % 4].bit; }
    }
  }

  const maze = { ...g, open };
  // 迷路の中でいちばん遠い2点（端から端へ2回測る）。左上に近いほうをスタートにする
  const a = farthest(bfs(maze, first));
  const distA = bfs(maze, a);
  const b = farthest(distA);
  const centerSum = i => (i % cols) + ((i / cols) | 0);
  maze.start = centerSum(a) <= centerSum(b) ? a : b;
  maze.goal = maze.start === a ? b : a;
  maze.shortest = distA[b];
  let junctions = 0, deadEnds = 0;
  for (let i = 0; i < n; i++) {
    if (!usable[i]) continue;
    const k = (open[i] & 1) + ((open[i] >> 1) & 1) + ((open[i] >> 2) & 1) + ((open[i] >> 3) & 1);
    if (k >= 3) junctions++; else if (k === 1) deadEnds++;
  }
  maze.junctions = junctions;
  maze.deadEnds = deadEnds;
  maze.bridges = g.bridge.reduce((s, v) => s + v, 0);
  return maze;
}
