// 画数の表（表にある字だけ数えられる。ない字は「？」と表示する）
export const STROKES = {
  一: 1, 口: 3, 三: 3, 川: 3, 山: 3, 大: 3, 小: 3, 日: 4, 月: 4, 木: 4, 火: 4, 水: 4, 犬: 4, 王: 4,
  文: 4, 田: 5, 本: 5, 永: 5, 字: 6, 米: 6, 花: 7, 麦: 7, 雨: 8, 空: 8, 門: 8, 星: 9, 海: 9, 春: 9, 風: 9,
  鳥: 11, 魚: 11, 猫: 11, 亀: 11, 森: 12, 愛: 13, 夢: 13, 雷: 13, 新: 13, 龍: 16, 鬱: 29,
  ハ: 2, あ: 3, め: 2, き: 4, ほ: 4, ぬ: 2, S: 1, A: 3, B: 2, M: 4,
};
export const POOL = Object.keys(STROKES);

// 1〜2文字の画数の合計。表にない字があれば null
export function strokeCount(text) {
  let sum = 0;
  for (const ch of text) {
    if (!(ch in STROKES)) return null;
    sum += STROKES[ch];
  }
  return sum;
}
