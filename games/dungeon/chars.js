// 文字ダンジョンに出てくる字と画数。強さ（攻撃・防御・素早さ・特技）は games/status/stats.js が
// 文字の形から決める。ここでは「画数＝体力」にするため、画数の表を持つ
import { makeCharacter } from '../status/stats.js';

export const HERO = '一';
export const FIRST_ALLY = '人';       // 老師がくれる最初の仲間
export const BOSSES = { 5: '鬱', 10: '驫', 15: '龘' };
// フォントにその字がないときの代わり（画数の多い字）
const BOSS_FALLBACK = { 5: ['爨'], 10: ['鸞'], 15: ['麤', '鸞'] };
export const LEGEND = '言';           // 伝説の1文字
export const MAX_FLOOR = 15;

// 「字 + 画数」を並べた表。敵・仲間・ボスはここにある字から選ぶ
const TABLE =
  '一1乙1二2人2入2力2十2丁2九2七2八2又2刀2了2' +
  '三3口3土3大3小3山3川3女3子3工3下3上3千3才3万3丸3夕3寸3' +
  '日4月4火4水4木4王4犬4中4文4心4手4天4方4円4切4午4今4太4少4牛4友4止4内4分4' +
  '石5田5目5白5本5左5右5玉5生5立5出5北5古5号5四5外5冬5市5平5母5可5' +
  '竹6米6糸6虫6年6先6気6百6光6全6会6毎6自6地6多6色6回6同6' +
  '花7見7赤7町7男7村7足7声7助7返7言7辞7' +
  '林8雨8青8空8金8長8国8画8学8店8明8命8昔8夜8' +
  '星9草9音9秋9南9風9度9' +
  '夏10桜10竜10紙10時10島10帰10家10校10' +
  '強11動11理11雪11魚11鳥11黒11野11船11' +
  '森12晴12道12間12場12絵12雲12' +
  '感13園13新13雷13' +
  '語14鳴14駅14' +
  '線15箱15論15' +
  '親16龍16築16館16' +
  '難18顔18藤18鏡19願19麗19羅19' +
  '響20護20競20議20' +
  '魔21艦21躍21纏21鶴21驚22鷹24' +
  '鬱29驫30龘48爨30鸞30麤33';

export const STROKES = {};
for (const [, ch, n] of TABLE.matchAll(/(\D)(\d+)/gu)) STROKES[ch] = +n;

// 敵・仲間カードとして出る字（ボス・伝説・老師は除く）
const BOSS_ALL = [...Object.values(BOSSES), ...Object.values(BOSS_FALLBACK).flat()];
export const WILD_POOL = Object.keys(STROKES).filter(c => !BOSS_ALL.includes(c) && c !== LEGEND && c !== '辞');

export const strokesOf = ch => STROKES[ch] || 4;

// 階層に合った敵の字。深くなるほど画数の多い字が出る
export function pickEnemyChar(rng, floor, pool = WILD_POOL) {
  const center = 1.5 + floor * 1.5;
  const lo = Math.max(1, Math.floor(center * 0.45)), hi = Math.ceil(center * 1.25) + 1;
  const list = pool.filter(c => strokesOf(c) >= lo && strokesOf(c) <= hi);
  return list[Math.floor(rng() * list.length)] || pool[0];
}

// 字 → キャラ（status の stats.js で形から強さを決め、HP は画数に置き換える）
const cache = new Map();
export function charOf(font, ch) {
  if (!cache.has(ch)) {
    const c = makeCharacter(font, ch);
    if (c) c.stats = { ...c.stats, hp: strokesOf(ch) };
    cache.set(ch, c);
  }
  return cache.get(ch);
}

// その階のぬしの字（フォントにあるものを選ぶ）
export function bossOf(font, floor) {
  return [BOSSES[floor], ...(BOSS_FALLBACK[floor] || [])].find(c => c && charOf(font, c)) || '龍';
}
