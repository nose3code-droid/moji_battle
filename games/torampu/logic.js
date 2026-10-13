// 部首トランプ：ゲームのルールとCPUの考え方（画面に依存しないので、Node でもテストできる）
import { PARTS, SPECIALS, RECIPES } from './recipes.js';

export const HAND_MAX = 14;       // 手札の上限（これ以上は引けない）
export const TURN_LIMIT = 400;    // これを超えたら、いちばん点の高い人の勝ち
export const HINT_COST = 3;       // ヒントを使うと減る点
export const LEVELS = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };

// ---------- レシピの索引 ----------
const keyOf = arr => [...arr].sort().join('');
export const RECIPE_BY_CH = new Map(RECIPES.map(r => [r.ch, r]));
const BY_KEY = new Map();
for (const r of RECIPES) for (const ps of [r.parts, ...(r.alts || [])]) BY_KEY.set(keyOf(ps), r);
export const PART_CHARS = Object.keys(PARTS);

// 部品の字の並びからレシピを探す（なければ undefined）
export const matchRecipe = chars => BY_KEY.get(keyOf(chars));

// ---------- 乱数 ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// ---------- カード ----------
// card = { id, kind: 'part'|'wild'|'stop'|'more'|'swap', ch(部品の字) }
export function buildDeck() {
  const deck = []; let id = 1;
  for (const [ch, p] of Object.entries(PARTS)) for (let i = 0; i < p.n; i++) deck.push({ id: id++, kind: 'part', ch });
  for (const [kind, s] of Object.entries(SPECIALS)) for (let i = 0; i < s.n; i++) deck.push({ id: id++, kind });
  return deck;
}
const usable = c => c.kind === 'part' || c.kind === 'wild';

// 選んだカード（部品＋ワイルド最大1枚）で作れる漢字を調べる。{ recipe, as }（as=ワイルドが化けた字）か null
export function evaluate(cards) {
  if (cards.length < 2 || cards.length > 3 || !cards.every(usable)) return null;
  const wilds = cards.filter(c => c.kind === 'wild').length;
  if (wilds > 1) return null;
  const chars = cards.filter(c => c.kind === 'part').map(c => c.ch);
  if (!wilds) { const r = matchRecipe(chars); return r ? { recipe: r, as: null } : null; }
  let best = null;
  for (const ch of PART_CHARS) {
    const r = matchRecipe([...chars, ch]);
    if (r && (!best || r.strokes > best.recipe.strokes)) best = { recipe: r, as: ch };
  }
  return best;
}

// 手札から作れる手を全部数える。[{ cards, recipe, as, score, wild }]
export function findMoves(hand) {
  const pool = hand.filter(usable), out = [];
  const n = pool.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let ev = evaluate([pool[i], pool[j]]);
    if (ev) out.push({ cards: [pool[i], pool[j]], ...ev, score: ev.recipe.strokes, wild: !!ev.as });
    for (let k = j + 1; k < n; k++) {
      ev = evaluate([pool[i], pool[j], pool[k]]);
      if (ev) out.push({ cards: [pool[i], pool[j], pool[k]], ...ev, score: ev.recipe.strokes, wild: !!ev.as });
    }
  }
  return out;
}
export const bestMove = hand => findMoves(hand).sort((a, b) => b.score - a.score || (a.wild - b.wild))[0] || null;

// ---------- ゲームの状態 ----------
export function newGame({ count = 2, level = 'normal', target = 30, seed = Date.now(), names } = {}) {
  const rng = makeRng(seed);
  const handSize = count === 2 ? 7 : 6;
  for (let tries = 0; tries < 500; tries++) {
    const deck = shuffle(buildDeck(), rng);
    const players = Array.from({ length: count }, (_, i) => ({
      name: i === 0 ? 'あなた' : (names?.[i] || `CPU${i}`), human: i === 0, hand: [], score: 0, skip: false, made: [],
    }));
    for (const p of players) p.hand = deck.splice(0, handSize);
    // 全員、最初の手札で1つは作れること（行き詰まらない配り）
    if (players.every(p => bestMove(p.hand))) {
      return { players, deck, discard: [], field: [], fieldRecipe: null, cur: 0, target, level, rng, turn: 1, specialUsed: false, over: false, winner: null, reason: '' };
    }
  }
  throw new Error('配り直しに失敗');
}

// 山札から n 枚引く（足りなければ捨て札を混ぜ直す。手札の上限まで）。引いたカードを返す
export function draw(st, pi, n) {
  const p = st.players[pi], got = [];
  for (let i = 0; i < n && p.hand.length < HAND_MAX; i++) {
    if (!st.deck.length) { if (!st.discard.length) break; st.deck = shuffle(st.discard.splice(0), st.rng); }
    const c = st.deck.pop(); p.hand.push(c); got.push(c);
  }
  return got;
}

function checkEnd(st, pi) {
  const p = st.players[pi];
  if (p.score >= st.target) { st.over = true; st.winner = pi; st.reason = `${st.target}点にとどいた！`; }
  else if (!p.hand.length) { st.over = true; st.winner = pi; st.reason = '手札がなくなった！'; }
}

// 漢字を作る（move = findMoves の1要素）。場のカードは捨て札へ、出したカードが新しい場になる
export function applyMake(st, pi, move) {
  const p = st.players[pi];
  for (const c of move.cards) p.hand.splice(p.hand.indexOf(c), 1);
  st.discard.push(...st.field);
  // ワイルドは化けた字の通常カードとして場に残る（拾っても、またワイルドにはならない）
  st.field = move.cards.map(c => c.kind === 'wild' ? { id: c.id, kind: 'part', ch: move.as, fromWild: true } : c);
  st.fieldRecipe = move.recipe;
  p.score += move.score;
  p.made.push(move.recipe.ch);
  checkEnd(st, pi);
}

// 山札から1枚引いて終わり（作れないとき）
export function applyDraw(st, pi) { return draw(st, pi, 1); }

// 特別カードを使う（1ターンに1枚）。opts.hand / opts.field は入れ替えるカード
export function applySpecial(st, pi, card, opts = {}) {
  const p = st.players[pi];
  if (st.specialUsed) return false;
  if (card.kind === 'swap') {
    if (!opts.hand || !opts.field || opts.hand.kind !== 'part') return false;
    const fi = st.field.indexOf(opts.field);
    if (fi < 0 || !p.hand.includes(opts.hand)) return false;
    st.field[fi] = opts.hand;
    p.hand[p.hand.indexOf(opts.hand)] = opts.field;
  }
  p.hand.splice(p.hand.indexOf(card), 1);
  st.discard.push(card);
  st.specialUsed = true;
  if (card.kind === 'stop') st.players[(pi + 1) % st.players.length].skip = true;
  if (card.kind === 'more') draw(st, pi, 2);
  checkEnd(st, pi);
  return true;
}

// ターンを終えて次の人へ。お休みになった人の名前を返す
export function endTurn(st) {
  const skipped = [], n = st.players.length;
  st.specialUsed = false;
  st.turn++;
  do {
    st.cur = (st.cur + 1) % n;
    if (st.players[st.cur].skip) { st.players[st.cur].skip = false; skipped.push(st.players[st.cur].name); st.turn++; } else break;
  } while (true);
  if (st.turn > TURN_LIMIT) {
    st.over = true;
    const top = Math.max(...st.players.map(p => p.score));
    st.winner = st.players.findIndex(p => p.score === top);
    st.reason = '長引いたので、点の高い人の勝ち';
  }
  return skipped;
}

// ---------- CPU ----------
// 場のカードと入れ替えて、作れる手が増える（または点が上がる）入れ替えを探す
function findSwap(st, pi) {
  const p = st.players[pi];
  const base = bestMove(p.hand)?.score || 0;
  let best = null;
  for (const h of p.hand) {
    if (h.kind !== 'part') continue;
    for (const f of st.field) {
      const hand2 = p.hand.map(c => c === h ? f : c);
      const m = bestMove(hand2);
      if (m && m.score > base && (!best || m.score > best.gain)) best = { hand: h, field: f, gain: m.score };
    }
  }
  return best;
}

// CPU の次の一手：{ type: 'make', move } | { type: 'draw' } | { type: 'special', card, opts }
export function cpuStep(st, pi) {
  const p = st.players[pi], lv = st.level, rng = st.rng;
  const moves = findMoves(p.hand);
  const specials = kind => p.hand.find(c => c.kind === kind);
  const others = st.players.filter((_, i) => i !== pi);
  const lead = Math.max(...others.map(o => o.score));
  const nextP = st.players[(pi + 1) % st.players.length];

  if (!st.specialUsed && lv !== 'easy') {
    const stop = specials('stop'), more = specials('more'), swap = specials('swap');
    const winNow = moves.some(m => p.score + m.score >= st.target);
    if (stop && !winNow && nextP.score >= st.target - (lv === 'hard' ? 14 : 8) && (lv === 'hard' || rng() < 0.6)) return { type: 'special', card: stop };
    if (more && (!moves.length || (lv === 'hard' && p.hand.length <= 5)) && p.hand.length < HAND_MAX - 1) return { type: 'special', card: more };
    if (swap && st.field.length && (lv === 'hard' || rng() < 0.4) && !winNow) {
      const s = findSwap(st, pi);
      if (s && (!moves.length || s.gain >= bestMove(p.hand).score + 3)) return { type: 'special', card: swap, opts: { hand: s.hand, field: s.field } };
    }
  }
  if (!moves.length) return { type: 'draw' };

  const value = m => {
    const wildCost = m.wild ? (lv === 'hard' ? 3 : 1) : 0;
    return m.score - wildCost + (lv === 'hard' ? 0.3 * m.cards.length : 0);
  };
  const sorted = [...moves].sort((a, b) => value(b) - value(a));
  if (lv === 'easy') {
    if (rng() < 0.35) return { type: 'draw' };               // ときどき見逃す
    const pool = sorted.filter(m => !m.wild || rng() < 0.3);
    const list = pool.length ? pool : sorted;
    return { type: 'make', move: rng() < 0.5 ? list[0] : list[Math.floor(rng() * list.length)] };
  }
  if (lv === 'normal' && rng() < 0.1) return { type: 'draw' };
  const win = sorted.find(m => p.score + m.score >= st.target || m.cards.length === p.hand.length);
  return { type: 'make', move: win || sorted[0] };
}
