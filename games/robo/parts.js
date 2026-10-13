// 部品（字）の一覧と、字の形 → 部品の性能。乱数を使わないので、同じ字なら必ず同じ性能になる
import { measureGlyph } from './shape.js';

export const SLOTS = ['head', 'body', 'rarm', 'larm', 'legs'];
export const SLOT_NAMES = { head: '頭', body: '胴', rarm: '右腕', larm: '左腕', legs: '脚' };
export const STAT_KEYS = ['hp', 'atk', 'def', 'spd', 'aim', 'wit'];
export const STAT_NAMES = { hp: 'HP', atk: '攻撃', def: '防御', spd: '素早さ', aim: '命中', wit: '判断' };
export const STAT_MAX = { hp: 300, atk: 110, def: 110, spd: 110, aim: 110, wit: 100 };   // レーダーチャートの外周

// 五行の属性。勝つ側 → 負ける側（水は火を消す／火は金をとかす／金の刃は木を切る／木の根は土を割る／土は水をせき止める）
export const ELEMENTS = {
  fire:  { name: '火', color: '#e5484d', beats: 'metal', why: '火は 金をとかす' },
  water: { name: '水', color: '#2b7de9', beats: 'fire',  why: '水は 火を消す' },
  wood:  { name: '木', color: '#2f9e55', beats: 'earth', why: '木は 根で土を割る' },
  metal: { name: '金', color: '#c99a1b', beats: 'wood',  why: '金の刃は 木を切る' },
  earth: { name: '土', color: '#9a6a3a', beats: 'water', why: '土は 水をせき止める' },
};

// 字 / 画数 / 属性。画数は「胴向き」の判定に使う
const TABLE = [
  ['一', 1], ['二', 2], ['人', 2], ['力', 2], ['十', 2], ['刀', 2, 'metal'],
  ['口', 3], ['土', 3, 'earth'], ['大', 3], ['小', 3], ['山', 3, 'earth'], ['川', 3, 'water'], ['工', 3], ['女', 3], ['子', 3],
  ['日', 4, 'fire'], ['月', 4], ['火', 4, 'fire'], ['水', 4, 'water'], ['木', 4, 'wood'], ['王', 4], ['犬', 4], ['心', 4], ['手', 4], ['天', 4], ['文', 4],
  ['石', 5, 'earth'], ['田', 5, 'earth'], ['目', 5], ['白', 5], ['玉', 5], ['本', 5, 'wood'], ['立', 5], ['氷', 5, 'water'],
  ['竹', 6, 'wood'], ['米', 6], ['虫', 6], ['光', 6, 'fire'],
  ['花', 7, 'wood'], ['足', 7], ['男', 7], ['車', 7],
  ['金', 8, 'metal'], ['雨', 8, 'water'], ['青', 8], ['空', 8], ['林', 8, 'wood'],
  ['風', 9], ['星', 9], ['草', 9, 'wood'],
  ['鬼', 10], ['剣', 10, 'metal'],
  ['雪', 11, 'water'],
  ['森', 12, 'wood'],
  ['雷', 13], ['鉄', 13, 'metal'],
  ['龍', 16], ['機', 16],
  ['鬱', 29],
];
export const CATALOG = TABLE.map(([ch, strokes, element]) => ({ ch, strokes, element: element || null }));
export const PART_INFO = Object.fromEntries(CATALOG.map(p => [p.ch, p]));

// 最初の手持ち（どれも小さくて、まだ弱い字）
export const STARTERS = Array.from('一二人口土木火小川');

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// 枠ごとの効き方の重み（部品の素の値 × 重み が、ロボの値に足される）
const W = {
  head: { hp: .15, atk: 0,   def: .25, spd: 0,   aim: .8,  wit: .8 },
  body: { hp: .9,  atk: .05, def: .8,  spd: 0,   aim: 0,   wit: 0 },
  arm:  { hp: .1,  atk: .55, def: .1,  spd: .05, aim: .15, wit: 0 },
  legs: { hp: .15, atk: .05, def: .1,  spd: .9,  aim: 0,   wit: .05 },
};
const kindOf = slot => slot === 'rarm' || slot === 'larm' ? 'arm' : slot;
export const weightOf = slot => W[kindOf(slot)];

// 全部品の形を測り、部品の性能を決める。指標は「全部品の中での順位（0〜1）」にそろえるので、
// どの枠にも得意な字が必ずいる。フォントが同じなら、いつでも同じ結果になる
export function buildParts(font) {
  const list = [];
  for (const info of CATALOG) {
    const s = measureGlyph(font, info.ch);
    if (!s) continue;
    list.push({ info, s,
      mass: .5 * s.area + .5 * info.strokes / 29,                                        // 大きくて画数が多い
      angular: .6 * (s.spiky - 7) / 8 + .4 * (.95 - s.roundness) / .2,                    // 角ばっている
      round: s.roundness + .02 * Math.min(s.holes, 1),                                    // 丸い
      slender: .5 * Math.abs(Math.log(s.aspect)) / .3 + .5 * (1 - s.area / .5),           // 細長い・軽い
      fill: s.fill, strokes: info.strokes });
  }
  const rank = key => {
    const v = list.map(o => o[key]);
    return o => {
      const less = v.filter(x => x < o[key] - 1e-9).length, eq = v.filter(x => Math.abs(x - o[key]) <= 1e-9).length;
      return (less + (eq - 1) / 2) / Math.max(1, v.length - 1);
    };
  };
  const rm = rank('mass'), ra = rank('angular'), rr = rank('round'), rs = rank('slender'), rf = rank('fill'), rk = rank('strokes');
  const parts = new Map();
  for (const o of list) {
    const m = rm(o), a = ra(o), r = rr(o), sl = rs(o), f = rf(o), k = rk(o), holesN = Math.min(o.s.holes, 2) / 2;
    const raw = {
      hp:  20 + 80 * (.7 * m + .3 * k),
      atk: 15 + 85 * (.65 * a + .35 * m),
      def: 15 + 85 * (.5 * f + .5 * m),
      spd: 15 + 85 * (.75 * sl + .25 * (1 - m)),
      aim: 15 + 85 * (.6 * r + .2 * holesN + .2 * (1 - a)),
      wit: 15 + 85 * (.5 * k + .3 * holesN + .2 * r),
    };
    for (const key of STAT_KEYS) raw[key] = Math.round(raw[key]);
    const aff = { head: clamp(.7 * r + .3 * holesN), body: m, rarm: a, larm: a, legs: sl };
    const part = { ch: o.info.ch, strokes: o.info.strokes, element: o.info.element, shape: o.s, raw, aff };
    part.best = ['head', 'body', 'rarm', 'legs'].reduce((b, sl2) => aff[sl2] > aff[b] ? sl2 : b, 'head');
    part.power = STAT_KEYS.reduce((n, key) => n + raw[key], 0);
    parts.set(part.ch, part);
  }
  return parts;
}

// 相性 → ボーナス倍率と記号
export function fitOf(aff) {
  const mult = 1 + .3 * clamp((aff - .4) / .5);
  return { mult, mark: aff >= .8 ? '◎' : aff >= .6 ? '○' : '', label: aff >= .8 ? 'ぴったり' : aff >= .6 ? 'まずまず' : '' };
}

// ロボの組み立て：build = { head: 'あ', ... }、get(ch) → 部品。未完成なら null
export function assemble(build, get, boost = 1) {
  const parts = {};
  for (const slot of SLOTS) {
    const p = get(build[slot]);
    if (!p) return null;
    parts[slot] = p;
  }
  const sum = Object.fromEntries(STAT_KEYS.map(k => [k, 0]));
  const fits = {};
  for (const slot of SLOTS) {
    const p = parts[slot], f = fitOf(p.aff[slot]);
    fits[slot] = f;
    const w = weightOf(slot);
    for (const k of STAT_KEYS) sum[k] += p.raw[k] * w[k] * f.mult;
  }
  const stats = {
    hp: 60 + 1.5 * sum.hp, atk: sum.atk, def: sum.def, spd: sum.spd, aim: sum.aim, wit: sum.wit,
  };
  for (const k of ['hp', 'atk', 'def', 'spd', 'aim']) stats[k] *= boost;
  for (const k of STAT_KEYS) stats[k] = Math.round(stats[k]);
  return { build: { ...build }, parts, stats, fits, element: parts.body.element };
}

// 手持ちの中で、いちばん良い組み合わせを探す（おまかせ組み立て）。枠を順に、貪欲に決める
export function autoBuild(chars, get, previous = null) {
  const used = new Set(), build = {};
  const order = ['body', 'legs', 'rarm', 'larm', 'head'];
  const score = (p, slot) => {
    const w = weightOf(slot), f = fitOf(p.aff[slot]);
    return STAT_KEYS.reduce((n, k) => n + p.raw[k] * w[k] * f.mult, 0);
  };
  for (const slot of order) {
    let best = null;
    for (const ch of chars) {
      if (used.has(ch)) continue;
      const p = get(ch);
      if (!p) continue;
      if (!best || score(p, slot) > score(get(best), slot)) best = ch;
    }
    if (best) { build[slot] = best; used.add(best); }
  }
  return build;
}
