// 階層の地形づくり（部屋と通路）。DOM に触らない。同じ seed・階層なら必ず同じ地形になる
import { mulberry32, hashSeed, randInt } from './rng.js';

export const FLOOR_W = 40;
export const FLOOR_H = 40;
export const WALL = 0, FLOOR = 1;

export function generateFloor(seed, floor) {
  for (let attempt = 0; ; attempt++) {
    const g = tryGenerate(mulberry32(hashSeed(seed, floor, attempt)), floor);
    if (g) return g;
  }
}

function tryGenerate(rng, floor) {
  const W = FLOOR_W, H = FLOOR_H;
  const tiles = new Uint8Array(W * H);
  const rooms = [];
  const want = Math.min(11, 7 + Math.floor(floor / 4));
  for (let i = 0; i < 120 && rooms.length < want; i++) {
    const w = randInt(rng, 5, 10), h = randInt(rng, 4, 8);
    const x = randInt(rng, 1, W - w - 2), y = randInt(rng, 1, H - h - 2);
    // 部屋どうしは 2 マス以上あける
    if (rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  if (rooms.length < 6) return null;

  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[y * W + x] = FLOOR;

  const corridor = (a, b) => {
    const horizFirst = rng() < 0.5;
    const carve = (x, y) => { tiles[y * W + x] = FLOOR; };
    let x = a.cx, y = a.cy;
    const goX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); carve(x, y); } };
    const goY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); carve(x, y); } };
    if (horizFirst) { goX(); goY(); } else { goY(); goX(); }
  };
  // 先に作った部屋のうち一番近いものとつなぐ（全部つながる）。さらにランダムに数本足して輪を作る
  for (let i = 1; i < rooms.length; i++) {
    let best = 0, bd = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
      if (d < bd) { bd = d; best = j; }
    }
    corridor(rooms[i], rooms[best]);
  }
  for (let k = 0; k < 2; k++) corridor(rooms[randInt(rng, 0, rooms.length - 1)], rooms[randInt(rng, 0, rooms.length - 1)]);

  // 入口（rooms[0]）から一番遠い部屋を出口の部屋にする
  const dist = bfsDist(tiles, W, H, rooms[0].cx, rooms[0].cy);
  let exitRoom = 1, far = -1;
  rooms.forEach((r, i) => {
    const d = dist[r.cy * W + r.cx];
    if (i > 0 && d > far) { far = d; exitRoom = i; }
  });
  return { W, H, tiles, rooms, startRoom: 0, exitRoom, start: { x: rooms[0].cx, y: rooms[0].cy } };
}

function bfsDist(tiles, W, H, sx, sy) {
  const dist = new Int16Array(W * H).fill(-1);
  const q = [sy * W + sx];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (tiles[n] === FLOOR && dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
    }
  }
  return dist;
}
