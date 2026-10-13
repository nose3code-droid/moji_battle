// 文字てんびん：盤面のルール（画面に依存しない純粋な計算）
// 面 stage = { plates: [[固定のおもり...], ...], hand: [字...], useAll?: bool }
//   おもりは字（文字列）か、数字だけの分銅（数値）。字の重さは画数
// 割り当て assign = 手持ちカードごとの皿の番号（-1 は手元）
import { strokes } from './kanji.js';

export const weightOf = item => (typeof item === 'number' ? item : strokes(item));

export const plateFixed = (stage, p) => stage.plates[p].reduce((s, it) => s + weightOf(it), 0);

// 各皿の重さ
export function totals(stage, assign) {
  const t = stage.plates.map((_, p) => plateFixed(stage, p));
  assign.forEach((p, i) => { if (p >= 0) t[p] += strokes(stage.hand[i]); });
  return t;
}

export const usedCount = assign => assign.filter(p => p >= 0).length;

// つり合っているか（全部の皿が同じ重さ）。useAll の面は、全部の字を使い切っていること
export function isBalanced(stage, assign) {
  const t = totals(stage, assign);
  return t.every(w => w === t[0]);
}
export function isSolved(stage, assign) {
  if (usedCount(assign) === 0) return false; // 何も置かずに終わりにはしない
  if (stage.useAll && assign.some(p => p < 0)) return false;
  return isBalanced(stage, assign);
}

// すべての解を数え上げる（手持ちは多くても 10 枚ほどなので全探索で足りる）
export function allSolutions(stage) {
  const n = stage.hand.length, P = stage.plates.length;
  const w = stage.hand.map(strokes);
  const base = stage.plates.map((_, p) => plateFixed(stage, p));
  const sols = [];
  const cur = new Array(n).fill(-1);
  const t = base.slice();
  (function rec(i) {
    if (i === n) {
      if (t.every(x => x === t[0]) && cur.some(p => p >= 0)) sols.push(cur.slice());
      return;
    }
    if (!stage.useAll) { cur[i] = -1; rec(i + 1); }
    for (let p = 0; p < P; p++) { cur[i] = p; t[p] += w[i]; rec(i + 1); t[p] -= w[i]; }
    cur[i] = -1;
  })(0);
  return sols;
}

// 使う枚数がいちばん少ない解の枚数
export function parOf(stage) {
  const sols = allSolutions(stage);
  if (!sols.length) return null;
  return Math.min(...sols.map(usedCount));
}

// いまの置き方にいちばん近い解（ヒント用）。ちがう枚数が同じなら、使う枚数が少ないほう
export function nearestSolution(stage, assign) {
  let best = null, bd = Infinity, bu = Infinity;
  for (const s of allSolutions(stage)) {
    const d = s.reduce((c, p, i) => c + (p !== assign[i] ? 1 : 0), 0), u = usedCount(s);
    if (d < bd || (d === bd && u < bu)) { best = s; bd = d; bu = u; }
  }
  return best;
}

// 星：ムダ（余分に使った枚数＋ヒント回数）が 0 なら★3、2以下なら★2、それ以外は★1
export function starsFor(used, par, hints) {
  const waste = Math.max(0, used - par) + hints;
  return waste === 0 ? 3 : waste <= 2 ? 2 : 1;
}
