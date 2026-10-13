// ステージ：景品の山の種類。chars の順に、シード固定の位置から落として山を作る
// big は字ごとの大きさの倍率（大物）
export const STAGES = [
  { id: 'easy', name: 'やさしい山', glyph: '日', seed: 11,
    desc: '四角くて軽い字ばかり。まずはここから。',
    chars: Array.from('口日田目王山工土中') },
  { id: 'holes', name: '穴だらけ', glyph: '回', seed: 23,
    desc: '穴のある字の山。真ん中のピンを穴に通そう。',
    chars: Array.from('口回四国日田図白中') },
  { id: 'heavy', name: '重い字ばかり', glyph: '鬱', seed: 37,
    desc: '画数の多い重い字ばかり。持ち上げても途中で落ちやすい。',
    chars: Array.from('鬱驚響護議難顔願鑑') },
  { id: 'round', name: '丸い字だけ', glyph: '〇', seed: 41,
    desc: 'つるつるの丸い字。爪をかけるのが難しい。',
    chars: Array.from('〇の〇ぬめゆあ〇の') },
  { id: 'dragon', name: '大物「龍」入り', glyph: '龍', seed: 53,
    desc: '山のてっぺんに大きな「龍」。取れたら大きな得点。',
    chars: Array.from('口日田山木土目王龍'), big: { 龍: 1.25 } },
];
