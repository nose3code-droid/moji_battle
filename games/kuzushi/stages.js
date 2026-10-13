// 全12面の定義。字の組み合わせがだんだん複雑になり、最後の2面はボス。
import { buildGlyph, allocHp, strokesOf } from './shapes.js';

// glyphs: { ch, size, x, y, motion?, forms? }
//   motion: x = x0 + ax·sin(wx·φ), y = y0 + ay·sin(wy·φ + py)。φ は時間とともに進み、体力が減るほど boost 倍に速くなる
//   forms: ボスの変身。[{ ch, size, motion? }, …] を順にたおす（先頭が最初の姿）
export const STAGES = [
  { name: '口', note: '穴の中へ通り抜けよう', hue: 200, speed: 250, glyphs: [{ ch: '口', size: 130, x: 180, y: 160 }] },
  { name: '日月', note: '字のすき間をねらえ', hue: 40, speed: 256, glyphs: [{ ch: '日', size: 104, x: 100, y: 150 }, { ch: '月', size: 104, x: 262, y: 150 }] },
  { name: '田', note: '四つの小部屋', hue: 130, speed: 262, glyphs: [{ ch: '田', size: 150, x: 180, y: 165 }] },
  { name: '国', note: '箱の中にもうひとつ', hue: 280, speed: 268, glyphs: [{ ch: '国', size: 160, x: 180, y: 170 }] },
  { name: '森', note: '木が三本', hue: 150, speed: 274, glyphs: [{ ch: '森', size: 168, x: 180, y: 175 }] },
  { name: '十井十', note: 'すき間だらけ', hue: 20, speed: 280, glyphs: [
    { ch: '十', size: 96, x: 62, y: 150 }, { ch: '井', size: 110, x: 180, y: 170, motion: { ax: 18, wx: 1.3, boost: 1 } }, { ch: '十', size: 96, x: 298, y: 150 }] },
  { name: 'あめゆ', note: 'ひらがなの曲線', hue: 330, speed: 286, glyphs: [
    { ch: 'あ', size: 104, x: 62, y: 150 }, { ch: 'め', size: 104, x: 180, y: 190 }, { ch: 'ゆ', size: 104, x: 298, y: 150 }] },
  { name: '◎米※', note: '記号と米', hue: 175, speed: 292, glyphs: [
    { ch: '◎', size: 100, x: 62, y: 150 }, { ch: '米', size: 112, x: 180, y: 190, motion: { ax: 22, wx: 1.1, boost: 1 } }, { ch: '※', size: 100, x: 298, y: 150 }] },
  { name: '雨電', note: '重いぞ', hue: 215, speed: 298, glyphs: [
    { ch: '雨', size: 128, x: 100, y: 160, motion: { ax: 12, wx: 1, boost: 1 } }, { ch: '電', size: 128, x: 262, y: 170, motion: { ax: 12, wx: 1, py: 1.4, boost: 1 } }] },
  { name: '回器回', note: '箱の中の箱', hue: 55, speed: 304, glyphs: [
    { ch: '回', size: 96, x: 56, y: 140 }, { ch: '器', size: 116, x: 180, y: 190 }, { ch: '回', size: 96, x: 304, y: 140 }] },
  { name: '鬱', boss: true, note: 'ボス：左右にゆれる大きな一字', hue: 350, speed: 310, glyphs: [
    { ch: '鬱', size: 188, x: 180, y: 175, motion: { ax: 70, wx: 0.9, ay: 12, wy: 1.8, boost: 1.6 } }] },
  { name: '龍', boss: true, note: 'ボス：たおすたびに姿を変える', hue: 265, speed: 318, glyphs: [{
    ch: '龍', size: 176, x: 180, y: 175, motion: { ax: 60, wx: 0.8, ay: 26, wy: 1.6, boost: 1.4 },
    forms: [
      { ch: '龍', size: 176 },
      { ch: '竜', size: 150, motion: { ax: 85, wx: 1.15, ay: 20, wy: 2.3, boost: 1.4 } },
      { ch: '立', size: 120, motion: { ax: 100, wx: 1.5, ay: 42, wy: 2.9, boost: 1.2 } },
    ] }] },
];

// 面の実体：字の形（フォントから）と体力（画数）を組み立てる
export function buildStage(font, index) {
  const def = STAGES[index];
  const glyphs = def.glyphs.map(g => {
    const forms = (g.forms || [{ ch: g.ch, size: g.size }]).map(f => {
      const geom = buildGlyph(font, f.ch, f.size);
      return { ch: f.ch, geom, hp: allocHp(strokesOf(f.ch), geom.comps), motion: f.motion || g.motion || null };
    });
    return { x: g.x, y: g.y, forms };
  });
  return { index, name: def.name, note: def.note, boss: !!def.boss, hue: def.hue, speed: def.speed, glyphs };
}
