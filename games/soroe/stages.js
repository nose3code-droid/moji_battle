// 全15面。chars=この面で出る字、moves=手数、goals=ゴール（すべて満たすとクリア）
//   { t:'make', ch, n }     漢字をn回つくる
//   { t:'score', n }        スコアn
//   { t:'clear', ch, n }    字をn個消す（特殊ブロックでの消去も数える）
//   { t:'special', kind, n } 'bomb'(爆) / 'rainbow'(虹) をn個つくる
export const STAGES = [
  { name: 'はじめの森', moves: 20, chars: '木日月人口', goals: [{ t: 'make', ch: '森', n: 2 }] },
  { name: '日と月', moves: 20, chars: '木日月人口', goals: [{ t: 'make', ch: '明', n: 3 }] },
  { name: '木かげで休む', moves: 22, chars: '木日月人口火', goals: [{ t: 'make', ch: '休', n: 3 }, { t: 'score', n: 800 }] },
  { name: 'ほのおの字', moves: 22, chars: '木日月人口火', goals: [{ t: 'make', ch: '炎', n: 3 }] },
  { name: '女と子', moves: 24, chars: '木日月人口火女子', goals: [{ t: 'make', ch: '好', n: 3 }, { t: 'make', ch: '森', n: 1 }] },
  { name: '虹をかけよう', moves: 38, chars: '木日月人口火女子', goals: [{ t: 'special', kind: 'rainbow', n: 1 }, { t: 'make', ch: '好', n: 1 }] },
  { name: '山と石', moves: 26, chars: '木日月人口火女子山石', goals: [{ t: 'make', ch: '岩', n: 3 }] },
  { name: '石ころ拾い', moves: 30, chars: '木日月人口火女子山石', goals: [{ t: 'clear', ch: '石', n: 18 }, { t: 'make', ch: '明', n: 2 }] },
  { name: '田んぼの男', moves: 28, chars: '木日月人口火女子山石田力', goals: [{ t: 'make', ch: '男', n: 3 }] },
  { name: '爆発のれんぞく', moves: 32, chars: '木日月人口火女子山石田力', goals: [{ t: 'special', kind: 'bomb', n: 1 }, { t: 'make', ch: '休', n: 2 }, { t: 'make', ch: '男', n: 1 }] },
  { name: '仙人と畑', moves: 30, chars: '木日月人口火女子山石田力', goals: [{ t: 'make', ch: '仙', n: 2 }, { t: 'make', ch: '畑', n: 2 }] },
  { name: 'きらきら晶', moves: 30, chars: '木日月人口火女子山石田力', goals: [{ t: 'make', ch: '晶', n: 2 }, { t: 'make', ch: '品', n: 2 }] },
  { name: '三つ巴', moves: 34, chars: '木日月人口火女子山石田力', goals: [{ t: 'make', ch: '森', n: 2 }, { t: 'make', ch: '炎', n: 2 }, { t: 'make', ch: '男', n: 2 }] },
  { name: '石の山', moves: 38, chars: '木日月人口火女子山石田力', goals: [{ t: 'make', ch: '磊', n: 2 }, { t: 'make', ch: '焱', n: 1 }, { t: 'make', ch: '岩', n: 2 }] },
  { name: '文字そろえ名人', moves: 34, chars: '木日月人口火女子山石田力', goals: [{ t: 'score', n: 9000 }, { t: 'make', ch: '明', n: 3 }, { t: 'make', ch: '好', n: 2 }] },
];

export function goalText(g) {
  if (g.t === 'make') return `「${g.ch}」を${g.n}回つくる`;
  if (g.t === 'score') return `スコア ${g.n}`;
  if (g.t === 'clear') return `「${g.ch}」を${g.n}こ消す`;
  return `「${g.kind === 'bomb' ? '爆' : '虹'}」を${g.n}こつくる`;
}

// 残り手数の割合で星1〜3
export function starsFor(left, total) {
  const r = left / total;
  return r >= 0.3 ? 3 : r >= 0.12 ? 2 : 1;
}
