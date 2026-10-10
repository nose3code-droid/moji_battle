// 各面の最短解を全探索で求め、solutions.js として標準出力に書き出す。
// 使い方：node tools/solve.mjs > solutions.js   （引数 -v で面ごとの経過を stderr に）
import { LEVELS } from '../levels.js';
import { parseLevel, simulate, isSolved, canPlace } from '../engine.js';

const log = (...a) => process.argv.includes('-v') && console.error(...a);
const only = process.argv.find(a => /^\d+$/.test(a));

// 面を解く。予算 B 手以下で解ける最小の手数を探す（鏡ごとに「別のマスへ移動 = 1手」「タップ1回 = 1手」）
function solve(level) {
  const P = parseLevel(level);
  const ms = level.mirrors;
  const free = [];
  for (let y = 0; y < P.rows; y++) for (let x = 0; x < P.cols; x++) if (P.grid[y][x] === '.') free.push([x, y]);
  // 鏡 i が取りうる (x, y, o) とその手数
  const opts = ms.map(m => {
    const list = [];
    const cells = m.fixed ? [[m.x, m.y]] : free;
    for (const [x, y] of cells) for (let o = 0; o < 4; o++) {
      const cost = (x !== m.x || y !== m.y ? 1 : 0) + ((o - m.o + 4) % 4);
      list.push({ x, y, o, cost });
    }
    return list.sort((a, b) => a.cost - b.cost);
  });
  const test = cur => {
    const mirrors = cur.map((c, i) => ({ x: c.x, y: c.y, o: c.o, type: ms[i].type }));
    return isSolved(P, simulate(P, mirrors, new Set()));
  };
  for (let B = 0; B <= 14; B++) {
    let found = null, count = 0;
    const cur = [];
    const rec = (i, left) => {
      if (found && count > 0 && false) return;
      if (i === ms.length) {
        if (left !== 0) return; // ちょうど B 手のものだけ数える（小さい B は調べ済み）
        if (new Set(cur.map(c => c.x + ',' + c.y)).size !== cur.length) return;
        if (test(cur)) { count++; if (!found) found = cur.map(c => ({ ...c })); }
        return;
      }
      for (const o of opts[i]) {
        if (o.cost > left) break;
        cur[i] = o;
        rec(i + 1, left - o.cost);
      }
    };
    rec(0, B);
    if (found) return { par: B, count, sol: found.map((c, i) => ({ i, x: c.x, y: c.y, o: c.o })) };
  }
  return null;
}

const out = {};
for (const lv of LEVELS) {
  if (only && +only !== lv.id) continue;
  const P = parseLevel(lv);
  const init = isSolved(P, simulate(P, lv.mirrors, new Set()));
  const t = Date.now();
  const r = solve(lv);
  log(`面${lv.id} ${lv.title}: ${r ? `最短${r.par}手 (解${r.count}通り)` : '解なし！'}${init ? '（最初から解けている！）' : ''} ${Date.now() - t}ms`);
  if (r) out[lv.id] = { par: r.par, sol: r.sol };
}
console.log('// tools/solve.mjs が自動生成。手で編集しない（node tools/solve.mjs > solutions.js）');
console.log('export const SOLUTIONS = ' + JSON.stringify(out) + ';');
