// ルールのテスト（Node）：全レシピの検証、配りの検証、CPU同士で最後まで遊んで勝敗が出ることの確認
import { PARTS, RECIPES, SPECIALS } from '../recipes.js';
import { newGame, findMoves, evaluate, matchRecipe, cpuStep, applyMake, applyDraw, applySpecial, endTurn, RECIPE_BY_CH, PART_CHARS } from '../logic.js';

let bad = 0;
const fail = m => { bad++; console.log('NG:', m); };

// 1) レシピの整合性
const seen = new Map();
for (const r of RECIPES) {
  if ([...r.ch].length !== 1) fail('漢字が1文字でない ' + r.ch);
  if (![...(r.parts), ...(r.alts || []).flat()].every(c => PARTS[c])) fail('カードにない部品 ' + r.ch);
  if (r.parts.length < 2 || r.parts.length > 3) fail('枚数が不正 ' + r.ch);
  if (!(r.strokes > 0) || !r.desc || !r.kind) fail('項目不足 ' + r.ch);
  for (const ps of [r.parts, ...(r.alts || [])]) {
    const k = [...ps].sort().join('');
    if (seen.has(k) && seen.get(k) !== r.ch) fail(`組み合わせが重複 ${k}: ${seen.get(k)} と ${r.ch}`);
    seen.set(k, r.ch);
    if (matchRecipe(ps)?.ch !== r.ch) fail('索引が合わない ' + r.ch);
  }
}
if (RECIPE_BY_CH.size !== RECIPES.length) fail('漢字が重複');
console.log('レシピ数', RECIPES.length, '／部品の種類', PART_CHARS.length, '／重複なし:', bad === 0);

// 2) すべてのレシピが、山札の枚数で実際に作れるか（同じ部品の必要枚数 ≤ 山札の枚数）
for (const r of RECIPES) for (const ps of [r.parts, ...(r.alts || [])]) {
  const need = {}; for (const c of ps) need[c] = (need[c] || 0) + 1;
  for (const [c, n] of Object.entries(need)) if (PARTS[c].n < n) fail(`山札の枚数が足りない ${r.ch} ${c}`);
}

// 3) 配りの検証：全員が最初から作れる
let deals = 0;
for (let seed = 1; seed <= 300; seed++) for (const count of [2, 3, 4]) {
  const st = newGame({ count, seed });
  deals++;
  for (const p of st.players) if (!findMoves(p.hand).length) fail('作れない手札 seed ' + seed);
}
console.log('配りの検証', deals, '回 OK');

// 4) CPU 同士で最後まで
const stat = {};
for (const level of ['easy', 'normal', 'hard']) for (const count of [2, 3, 4]) {
  let ended = 0, turns = 0, cap = 0;
  const wins = Array(count).fill(0);
  for (let seed = 1; seed <= 60; seed++) {
    const st = newGame({ count, level, seed: seed * 7 + count });
    let guard = 0;
    while (!st.over && guard++ < 5000) {
      const pi = st.cur; let acted = false;
      for (let k = 0; k < 6 && !st.over && !acted; k++) {
        const a = cpuStep(st, pi);
        if (a.type === 'special') { if (!applySpecial(st, pi, a.card, a.opts)) fail('特別カード失敗'); }
        else if (a.type === 'make') { applyMake(st, pi, a.move); acted = true; }
        else { applyDraw(st, pi); acted = true; }
      }
      if (st.over) break;
      endTurn(st);
    }
    if (st.over) { ended++; turns += st.turn; wins[st.winner]++; if (st.reason.includes('長引')) cap++; } else fail('決着しない');
  }
  stat[`${level}/${count}人`] = { 終了: ended + '/60', 平均ターン: (turns / ended).toFixed(1), 長引き: cap, 勝ち: wins.join(',') };
}
console.table(stat);

// 5) ワイルド・入れ替えの動作
const st = newGame({ count: 2, seed: 5 });
const w = { id: 9001, kind: 'wild' }, a = { id: 9002, kind: 'part', ch: '日' };
const ev = evaluate([w, a]);
console.log('ワイルド+日 →', ev?.recipe.ch, '(化けた字', ev?.as + ')');
if (!ev) fail('ワイルドが働かない');
console.log(bad ? `失敗 ${bad} 件` : 'すべて OK');
process.exit(bad ? 1 : 0);
