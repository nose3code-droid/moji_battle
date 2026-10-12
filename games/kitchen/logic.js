// 漢字キッチン：ゲームのルール（画面に依存しない部分）。node でもテストできる
import { PARTS, RANKS, RECIPES, CUSTOMERS } from './recipes.js';

export const MAX_POT = 3;      // 鍋に入れられる部品の数
export const TRAY_MAX = 6;     // お皿に置ける数
export const BURN_COST = 10;   // こげたときの材料代（部品1個あたり）

// 材料の組み合わせ → レシピ（順番は問わない）
export const recipeKey = parts => parts.slice().sort().join('');
export const RECIPE_BY_CH = new Map(RECIPES.map(r => [r.ch, r]));
export const RECIPE_BY_KEY = new Map();
for (const r of RECIPES) {
  for (const ps of [r.parts, ...(r.alts || [])]) RECIPE_BY_KEY.set(recipeKey(ps), r);
}
export const findRecipe = parts => RECIPE_BY_KEY.get(recipeKey(parts)) || null;

// 材料に使われる字（棚に並ぶ、作った字）
export const INTERMEDIATE = new Set(RECIPES.flatMap(r => [r.parts, ...(r.alts || [])].flat()).filter(c => RECIPE_BY_CH.has(c)));

// レシピのランク＝材料がそろう最初のお店のランク
const rankMemo = new Map();
export function recipeRank(r) {
  if (rankMemo.has(r.ch)) return rankMemo.get(r.ch);
  const rank = Math.max(...r.parts.map(c => (PARTS[c] ? PARTS[c].rank : recipeRank(RECIPE_BY_CH.get(c)))));
  rankMemo.set(r.ch, rank);
  return rank;
}

// 棚に並ぶ字：ランクまでの部品＋作ったことのある「材料になる字」
export function shelfChars(rank, book) {
  const base = Object.keys(PARTS).filter(c => PARTS[c].rank <= rank);
  const made = RECIPES.map(r => r.ch).filter(c => INTERMEDIATE.has(c) && book[c]);
  return base.concat(made);
}

// 代金とチップ
export function priceOf(r) { return 60 + 30 * recipeRank(r) + 20 * (r.parts.length - 2); }
export function tipOf(r, patienceFrac, fav) {
  const tip = Math.round(priceOf(r) * 0.5 * Math.max(0, patienceFrac) / 5) * 5;
  return tip + (fav ? Math.round(priceOf(r) * 0.4 / 5) * 5 : 0);
}
export function patienceOf(r, rank) { return Math.max(50, 80 + 15 * (r.parts.length - 2) - 5 * (rank - 1)); }

// 乱数（シード付き）
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// いま注文できるレシピ（ランク内）。まだ作ってない字ほど出やすい。いま座っている注文とは重ねない
export function pickRecipe(rng, rank, book, waiting) {
  const pool = RECIPES.filter(r => recipeRank(r) <= rank && !waiting.includes(r.ch));
  if (!pool.length) return null;
  const w = pool.map(r => (book[r.ch] ? 1 : 4) * (recipeRank(r) === rank ? 2 : 1));
  let x = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x < 0) return pool[i]; }
  return pool[pool.length - 1];
}
// 来るお客さん。まだ会っていない人を優先する
export function pickCustomer(rng, rank, met, seated) {
  const pool = CUSTOMERS.filter(c => c.minRank <= rank && !seated.includes(c.ch));
  if (!pool.length) return null;
  const w = pool.map(c => (met[c.ch] ? 1 : 3));
  let x = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x < 0) return pool[i]; }
  return pool[pool.length - 1];
}

export const newSave = () => ({ money: 0, total: 0, rank: 1, book: {}, met: {}, served: 0, burnt: 0, tray: [], introDone: false, endingSeen: false });
export const bookCount = book => RECIPES.filter(r => book[r.ch]).length;

// データの整合性チェック（テストで使う）。問題があれば文字列の配列で返す
export function validateData() {
  const bad = [];
  const seen = new Set();
  for (const r of RECIPES) {
    if (seen.has(r.ch)) bad.push(`重複: ${r.ch}`);
    seen.add(r.ch);
    for (const ps of [r.parts, ...(r.alts || [])]) {
      if (ps.length < 2 || ps.length > MAX_POT) bad.push(`${r.ch}: 材料の数`);
      for (const c of ps) if (!PARTS[c] && !seen.has(c) ) bad.push(`${r.ch}: 材料 ${c} が先に作れない`);
      if (RECIPE_BY_KEY.get(recipeKey(ps)) !== r) bad.push(`${r.ch}: 材料の組み合わせが他と重なる`);
    }
    if (!r.desc || !r.order || !r.kind) bad.push(`${r.ch}: 説明がたりない`);
  }
  for (const c of CUSTOMERS) if (!RECIPE_BY_CH.has(c.fav)) bad.push(`${c.ch}: 好きな字 ${c.fav} がない`);
  return bad;
}
export { PARTS, RANKS, RECIPES, CUSTOMERS };
