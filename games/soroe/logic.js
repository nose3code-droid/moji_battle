// 文字そろえの盤面ロジック（画面に依存しない。テストからも使う）
// 盤は grid[行][列]、行0が上。字（タイル）は { id, c: 字, sp?: 'bomb'|'rainbow' }
import { LINE, PAIR, pairKey, RECIPES } from './recipes.js';

export const SIZE = 8;
const K = (r, c) => r * SIZE + c;
const inb = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeRng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idSeq = 1;
const newTile = c => ({ id: idSeq++, c });
export const cloneGrid = g => g.map(row => row.slice());
export const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

// この面で出る字から、使えるレシピと、出やすさの重み（ゴールに関わる字を少し出やすくする）
export function stageInfo(stage) {
  const chars = [...stage.chars];
  const recipes = RECIPES.filter(r => r.parts.every(p => chars.includes(p)));
  const weights = new Map(chars.map(c => [c, 1]));
  for (const g of stage.goals) {
    if (g.t === 'make') for (const p of RECIPES.find(r => r.ch === g.ch).parts) weights.set(p, 1.6);
    if (g.t === 'clear') weights.set(g.ch, 1.6);
  }
  return { chars, recipes, weights };
}

function pick(rng, info) {
  const total = [...info.weights.values()].reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (const [c, w] of info.weights) { x -= w; if (x < 0) return c; }
  return info.chars[0];
}

// ---- 検出 ----
function findRuns(g) {
  const runs = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE;) {
      let j = c + 1;
      while (j < SIZE && g[r][j].c === g[r][c].c) j++;
      if (j - c >= 3) runs.push({ ch: g[r][c].c, cells: Array.from({ length: j - c }, (_, i) => [r, c + i]) });
      c = j;
    }
  }
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE;) {
      let j = r + 1;
      while (j < SIZE && g[j][c].c === g[r][c].c) j++;
      if (j - r >= 3) runs.push({ ch: g[r][c].c, cells: Array.from({ length: j - r }, (_, i) => [r + i, c]) });
      r = j;
    }
  }
  return runs;
}

// 重なる列（L字・T字）を1グループにする
function groupRuns(runs) {
  const groups = [];
  for (const run of runs) {
    const hit = groups.filter(gr => gr.ch === run.ch && gr.cells.some(a => run.cells.some(b => a[0] === b[0] && a[1] === b[1])));
    const gr = hit[0] || { ch: run.ch, runs: [], cells: [] };
    if (!hit[0]) groups.push(gr);
    for (const o of hit.slice(1)) { gr.runs.push(...o.runs); gr.cells.push(...o.cells); groups.splice(groups.indexOf(o), 1); }
    gr.runs.push(run);
    gr.cells.push(...run.cells);
  }
  for (const gr of groups) {
    const seen = new Set();
    gr.cells = gr.cells.filter(([r, c]) => !seen.has(K(r, c)) && seen.add(K(r, c)));
  }
  return groups;
}

// 入れ替えた2つが、隣の字と“組み合わせ”をつくったか（入れ替えの相手どうしは数えない）
function findPairs(g, swapped, used, active) {
  const pairs = [], taken = new Set(used);
  for (let i = 0; i < 2; i++) {
    const p = swapped[i], q = swapped[1 - i];
    const t = g[p[0]][p[1]];
    if (t.sp || taken.has(K(...p))) continue;
    for (const [dr, dc] of DIRS) {
      const n = [p[0] + dr, p[1] + dc];
      if (!inb(...n) || (n[0] === q[0] && n[1] === q[1]) || taken.has(K(...n))) continue;
      const u = g[n[0]][n[1]];
      if (u.sp) continue;
      const rec = PAIR.get(pairKey(t.c, u.c));
      if (rec && active.includes(rec)) {
        pairs.push({ recipe: rec, cells: [p, n] });
        taken.add(K(...p)); taken.add(K(...n));
        break;
      }
    }
  }
  return pairs;
}

// 入れ替え後の盤から、第1波（そろい・組み合わせ・特殊ブロックの発動）を探す
function detect(g, swapped, active) {
  const groups = groupRuns(findRuns(g));
  const used = groups.flatMap(gr => gr.cells.map(x => K(...x)));
  const pairs = swapped ? findPairs(g, swapped, used, active) : [];
  const trig = [];
  if (swapped) {
    for (let i = 0; i < 2; i++) {
      const [r, c] = swapped[i], t = g[r][c], o = g[swapped[1 - i][0]][swapped[1 - i][1]];
      if (t.sp) trig.push({ r, c, kind: t.sp, ch: t.sp === 'rainbow' && !o.sp ? o.c : t.c });
    }
  }
  return { groups, pairs, trig, any: groups.length > 0 || pairs.length > 0 || trig.length > 0 };
}

function swapIn(g, a, b) {
  const h = cloneGrid(g);
  [h[a[0]][a[1]], h[b[0]][b[1]]] = [h[b[0]][b[1]], h[a[0]][a[1]]];
  return h;
}

export function isValidSwap(g, a, b, active) {
  return detect(swapIn(g, a, b), [a, b], active).any;
}

export function listMoves(g, active) {
  const out = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      const b = [r + dr, c + dc];
      if (inb(...b) && isValidSwap(g, [r, c], b, active)) out.push([[r, c], b]);
    }
  }
  return out;
}

// ---- 1手の解決 ----
// 消す・つくる処理を1波ぶん行う（g を書きかえる）。波の中身を返す
function applyWave(g, det, swapped, chain) {
  const marked = new Set(), made = [], create = [], protect = new Set(), explosions = [];
  const mark = (r, c) => { if (!protect.has(K(r, c)) && g[r][c]) marked.add(K(r, c)); };

  for (const gr of det.groups) {
    const maxLen = Math.max(...gr.runs.map(r => r.cells.length));
    let kind = null;
    if (maxLen >= 5 || (gr.runs.length > 1 && gr.cells.length >= 5)) kind = 'rainbow'; // 5つ一直線、またはL字・T字で5マス以上
    else if (maxLen === 4) kind = 'bomb';
    const rec = !kind && LINE.get(gr.ch);
    if (kind) {
      const sw = swapped && swapped.find(s => gr.cells.some(x => x[0] === s[0] && x[1] === s[1]));
      const longest = gr.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
      const pos = sw || longest.cells[Math.floor(longest.cells.length / 2)];
      create.push({ r: pos[0], c: pos[1], kind, id: g[pos[0]][pos[1]].id });
      protect.add(K(...pos));
    } else if (rec && det.active.includes(rec)) {
      made.push({ ch: rec.ch, cells: gr.cells, score: rec.score });
    }
    for (const [r, c] of gr.cells) marked.add(K(r, c));
  }
  for (const p of det.pairs) {
    made.push({ ch: p.recipe.ch, cells: p.cells, score: p.recipe.score });
    for (const [r, c] of p.cells) marked.add(K(r, c));
  }
  for (const cr of create) marked.delete(K(cr.r, cr.c));

  // 特殊ブロックの発動（連鎖的に広がる）
  const queue = [...det.trig];
  const fired = new Set();
  for (const k of marked) { const t = g[Math.floor(k / SIZE)][k % SIZE]; if (t.sp) queue.push({ r: Math.floor(k / SIZE), c: k % SIZE, kind: t.sp, ch: t.c }); }
  for (const cr of create) { const t = g[cr.r][cr.c]; if (t.sp) queue.push({ r: cr.r, c: cr.c, kind: t.sp, ch: t.c }); }
  for (const t of det.trig) mark(t.r, t.c);
  while (queue.length) {
    const t = queue.shift();
    if (fired.has(K(t.r, t.c))) continue;
    fired.add(K(t.r, t.c));
    explosions.push({ r: t.r, c: t.c, kind: t.kind });
    const before = new Set(marked);
    if (t.kind === 'bomb') {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inb(t.r + dr, t.c + dc)) mark(t.r + dr, t.c + dc);
    } else {
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g[r][c].c === t.ch) mark(r, c);
    }
    mark(t.r, t.c);
    for (const k of marked) {
      if (before.has(k)) continue;
      const r = Math.floor(k / SIZE), c = k % SIZE;
      if (g[r][c].sp) queue.push({ r, c, kind: g[r][c].sp, ch: g[r][c].c });
    }
  }

  const clear = [], cleared = {};
  for (const k of marked) {
    const r = Math.floor(k / SIZE), c = k % SIZE, tile = g[r][c];
    clear.push({ r, c, tile });
    cleared[tile.c] = (cleared[tile.c] || 0) + 1;
    g[r][c] = null;
  }
  for (const cr of create) g[cr.r][cr.c] = { ...g[cr.r][cr.c], sp: cr.kind };
  const gain = (clear.length * 10 + made.reduce((s, m) => s + m.score, 0)) * chain;
  return { chain, clear, made, create, explosions, cleared, gain };
}

// 重力で落とし、上から補充する（g を書きかえる）
function refill(g, rng, info) {
  const fall = [], spawn = [];
  for (let c = 0; c < SIZE; c++) {
    let w = SIZE - 1;
    for (let r = SIZE - 1; r >= 0; r--) {
      if (!g[r][c]) continue;
      if (r !== w) { g[w][c] = g[r][c]; g[r][c] = null; fall.push({ id: g[w][c].id, c, from: r, to: w }); }
      w--;
    }
    const n = w + 1;
    for (let r = w; r >= 0; r--) {
      const tile = newTile(pick(rng, info));
      g[r][c] = tile;
      spawn.push({ tile, c, from: r - n, to: r });
    }
  }
  return { fall, spawn };
}

// 動かせる手がなければ混ぜ直す。混ぜても無理なら新しく作り直す
export function ensureMoves(g, rng, info) {
  if (listMoves(g, info.recipes).length) return null;
  const tiles = g.flat();
  for (let n = 0; n < 300; n++) {
    for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    const h = Array.from({ length: SIZE }, (_, r) => tiles.slice(r * SIZE, r * SIZE + SIZE));
    if (!findRuns(h).length && listMoves(h, info.recipes).length) return { grid: h, regenerated: false };
  }
  return { grid: newBoard(info, rng), regenerated: true };
}

export function newBoard(info, rng) {
  for (;;) {
    const g = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => newTile(pick(rng, info))));
    // 最初からそろっている所は字を変えて消しておく
    for (let guard = 0; guard < 200 && findRuns(g).length; guard++) {
      for (const run of findRuns(g)) { const [r, c] = run.cells[1]; g[r][c] = newTile(pick(rng, info)); }
    }
    if (!findRuns(g).length && listMoves(g, info.recipes).length) return g;
  }
}

// 1手を最後まで解決する。無効な手なら { valid:false }
export function playMove(grid, a, b, info, rng) {
  const g = swapIn(grid, a, b);
  let det = detect(g, [a, b], info.recipes);
  if (!det.any) return { valid: false };
  det.active = info.recipes;
  const waves = [];
  let swapped = [a, b];
  for (let chain = 1; det.any && chain <= 60; chain++) {
    const wave = applyWave(g, det, swapped, chain);
    Object.assign(wave, refill(g, rng, info));
    waves.push(wave);
    swapped = null;
    det = detect(g, null, info.recipes);
    det.active = info.recipes;
  }
  const result = { valid: true, waves, grid: g, shuffle: null };
  result.shuffle = ensureMoves(g, rng, info);
  if (result.shuffle) result.grid = result.shuffle.grid;
  return result;
}

// ---- ゴールの進み具合 ----
export function newProgress(stage) { return { score: 0, goals: stage.goals.map(() => 0) }; }

export function applyWavesToProgress(stage, prog, waves) {
  for (const w of waves) {
    prog.score += w.gain;
    stage.goals.forEach((g, i) => {
      if (g.t === 'make') prog.goals[i] += w.made.filter(m => m.ch === g.ch).length;
      else if (g.t === 'clear') prog.goals[i] += w.cleared[g.ch] || 0;
      else if (g.t === 'special') prog.goals[i] += w.create.filter(c => c.kind === g.kind).length;
    });
  }
  stage.goals.forEach((g, i) => { if (g.t === 'score') prog.goals[i] = prog.score; });
}

export const goalDone = (stage, prog) => stage.goals.every((g, i) => prog.goals[i] >= g.n);

// 手の下見：第1波だけ解決したときの中身（ヒントや、テスト用の bot が使う）
export function previewMove(grid, a, b, info) {
  const g = swapIn(grid, a, b);
  const det = detect(g, [a, b], info.recipes);
  if (!det.any) return null;
  det.active = info.recipes;
  return applyWave(g, det, [a, b], 1);
}
