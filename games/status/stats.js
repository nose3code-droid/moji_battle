// 文字の形 → ステータス。乱数を使わないので、同じ文字なら必ず同じステータスになる
import * as THREE from 'three';
import { glyphPolygons, shapeMetrics } from '../../glyph.js';

export const STAT_KEYS = ['hp', 'atk', 'def', 'spd', 'sp'];
export const STAT_NAMES = { hp: 'HP', atk: 'こうげき', def: 'ぼうぎょ', spd: 'すばやさ', sp: 'とくしゅ' };
export const STAT_MAX = { hp: 180, atk: 100, def: 100, spd: 100, sp: 100 }; // レーダーチャートの外周

// 特技の一覧。kind で効果を分ける（battle.js が解釈する）
export const SPECIALS = {
  sweep:  { name: 'なぎはらい',   kind: 'all',    power: 0.75, desc: '横長の体で 敵全員を なぎはらう' },
  pierce: { name: 'つらぬき',     kind: 'pierce', power: 1.2,  desc: '細長い体で 相手の ぼうぎょを 無視する' },
  combo:  { name: 'ぶんれつ連撃', kind: 'multi',  power: 0.5,  desc: 'バラバラのパーツで 何回も 攻撃する' },
  drain:  { name: 'あなぼこ吸収', kind: 'drain',  power: 1.0,  desc: '穴に 相手の力を 吸いこみ 回復する' },
  curl:   { name: 'まるまり',     kind: 'heal',   power: 0.35, desc: 'まるくなって 回復し しばらく 守りを固める' },
  spike:  { name: 'とがりづき',   kind: 'crit',   power: 1.6,  desc: 'とがった角で 急所を ねらう' },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 文字の形を測る。フォントに無い文字・空白は null
export function measureGlyph(font, ch) {
  if (font.charToGlyph(ch).index === 0) return null;
  const polys = glyphPolygons(font, ch, 1);   // 1em = 1 の大きさで測る
  if (!polys.length) return null;
  const m = shapeMetrics(polys);
  if (m.area < 1e-4) return null;
  const box = new THREE.Box2();
  for (const { outer } of polys) for (const q of outer) box.expandByPoint(q);
  const size = box.getSize(new THREE.Vector2());
  const hull = convexHull(polys.flatMap(p => p.outer));
  const hullArea = Math.abs(THREE.ShapeUtils.area(hull));
  return {
    polys, box,
    area: m.area,                                   // 黒い部分の面積（em²）
    perim: m.perim,                                 // 周長（穴のふちも含む）
    roundness: m.roundness,                         // 凸包の丸さ（円で1）
    holes: polys.reduce((n, p) => n + p.holes.length, 0),
    parts: polys.length,                            // つながっていない輪郭の数
    aspect: size.x / Math.max(size.y, 1e-6),        // 横 ÷ 縦
    fill: hullArea > 0 ? m.area / hullArea : 0,     // 凸包のうち黒い割合（ずっしり度）
    spiky: m.perim / Math.sqrt(m.area),             // 面積のわりに周長が長い＝とがっている
  };
}

// 形の指標 → ステータス
export function statsFromShape(s) {
  const slender = Math.max(s.aspect, 1 / s.aspect);
  const stats = {
    hp:  Math.round(clamp(50 + s.area * 200, 30, STAT_MAX.hp)),
    atk: Math.round(clamp(10 + (s.spiky - 5) * 7 + (1 - s.roundness) * 40, 10, 100)),
    def: Math.round(clamp(10 + (s.fill - 0.4) * 90 + (s.roundness - 0.6) * 80, 10, 100)),
    spd: Math.round(clamp(100 - s.area * 130 + Math.min(15, (slender - 1) * 5) - (s.parts - 1) * 3, 10, 100)),
    sp:  Math.round(clamp(5 + s.holes * 13 + (s.parts - 1) * 8 + (s.spiky - 5) * 1.5, 5, 100)),
  };
  return { stats, special: pickSpecial(s), traits: traitsOf(s) };
}

// いちばん目立つ形の特徴で特技を決める（上から順に優先）
function pickSpecial(s) {
  if (s.aspect >= 1.6) return 'sweep';
  if (s.aspect <= 0.6) return 'pierce';
  if (s.parts >= 3) return 'combo';
  if (s.holes >= 1 && s.roundness < 0.95) return 'drain';
  if (s.roundness >= 0.9) return 'curl';
  return 'spike';
}

// カードに出す短い特徴
function traitsOf(s) {
  const t = [];
  if (s.holes) t.push(`穴${s.holes}`);
  if (s.parts > 1) t.push(`パーツ${s.parts}`);
  if (s.aspect >= 1.3) t.push('横長'); else if (s.aspect <= 0.77) t.push('縦長');
  if (s.roundness >= 0.95) t.push('まんまる'); else if (s.roundness < 0.7) t.push('かくかく');
  if (s.area >= 0.45) t.push('どっしり'); else if (s.area <= 0.15) t.push('ちっちゃい');
  return t;
}

// 1文字 → キャラクター（null ならキャラにできない文字）
export function makeCharacter(font, ch) {
  const shape = measureGlyph(font, ch);
  if (!shape) return null;
  return { ch, shape, ...statsFromShape(shape) };
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
