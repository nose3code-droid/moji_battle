// 動かせる手がない盤が、自動シャッフルで解消されることを確かめる
import { stageInfo, makeRng, listMoves, ensureMoves, SIZE } from '../logic.js';
const info = { ...stageInfo({ chars: '日月人口', goals: [] }), recipes: [] }; // レシピ無し＝そろえるだけ
const FILL = '日月人口';
// ((行*2+列)%4) で並べると、どこを入れ替えても3つそろわない（手なしの盤）
const g = Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => ({ id: r * 8 + c, c: FILL[(r * 2 + c) % 4] })));
console.log('手なしの盤の手の数：', listMoves(g, []).length);
if (listMoves(g, []).length) { console.log('この盤は手なしにならなかった'); process.exit(1); }
const res = ensureMoves(g, makeRng(3), info);
const ok = res && listMoves(res.grid, []).length > 0 && res.grid.flat().length === 64;
console.log(ok ? `自動シャッフルOK（作り直し=${res.regenerated}）` : '自動シャッフルNG');
process.exit(ok ? 0 : 1);
