// 文字そろえの「漢字レシピ」。ここに1つ足すだけで新しい漢字が増える
//
// ・CHARS：盤に出る部品の字と色（hue は色相 0〜360、sat は彩度 %）
// ・RECIPES：ch=できる漢字、parts=材料、shape=並べ方
//     line：同じ字を“ちょうど3つ”縦か横にそろえる（4つ以上は「爆」「虹」になる）
//     pair：入れ替えた字が、隣の字とくっついたとき（順番は問わない）
//   score=漢字ボーナス、yomi=読み、desc=成り立ち（正確な内容だけ書く）
// ・SPECIALS：特殊ブロック。字にちなんだ名前と見た目
export const CHARS = {
  '木': { hue: 130, sat: 50 }, '火': { hue: 8, sat: 70 }, '日': { hue: 45, sat: 80 }, '月': { hue: 255, sat: 55 },
  '人': { hue: 190, sat: 55 }, '女': { hue: 335, sat: 60 }, '子': { hue: 28, sat: 75 }, '山': { hue: 160, sat: 45 },
  '石': { hue: 215, sat: 30 }, '田': { hue: 78, sat: 55 }, '力': { hue: 278, sat: 50 }, '口': { hue: 20, sat: 30 },
};

export const RECIPES = [
  // 同じ字を3つそろえる
  { ch: '森', parts: ['木', '木', '木'], shape: 'line', score: 500, yomi: 'もり', desc: '「木」を3つ重ねた字。木がたくさん集まった「もり」を表す。' },
  { ch: '品', parts: ['口', '口', '口'], shape: 'line', score: 500, yomi: 'しな', desc: '「口」を3つ組み合わせた字。たくさんの物を表し、「しな」の意味になった。' },
  { ch: '晶', parts: ['日', '日', '日'], shape: 'line', score: 500, yomi: 'しょう', desc: '「日」を3つ重ねた字。日がいくつも光るようすから、「かがやく」の意味になった。' },
  { ch: '焱', parts: ['火', '火', '火'], shape: 'line', score: 600, yomi: 'ほのお', desc: '「火」を3つ重ねた字。火が勢いよく燃えさかる「ほのお」を表す。' },
  { ch: '磊', parts: ['石', '石', '石'], shape: 'line', score: 600, yomi: 'らい', desc: '「石」を3つ重ねた字。石がごろごろと積み重なるようすを表す。' },
  // 2つを組み合わせる
  { ch: '明', parts: ['日', '月'], shape: 'pair', score: 300, yomi: 'あかるい', desc: '「日」と「月」を合わせた字。日と月で明るい。' },
  { ch: '休', parts: ['人', '木'], shape: 'pair', score: 300, yomi: 'やすむ', desc: '「人」が「木」に寄りかかる形。人が木のそばで休む。' },
  { ch: '好', parts: ['女', '子'], shape: 'pair', score: 300, yomi: 'すき', desc: '「女」と「子」を合わせた字。女の人が子をいつくしむ姿から、「このむ」「すき」の意味になった。' },
  { ch: '岩', parts: ['山', '石'], shape: 'pair', score: 300, yomi: 'いわ', desc: '「山」と「石」を合わせた字。山のようにそびえる大きな石、「いわ」。' },
  { ch: '炎', parts: ['火', '火'], shape: 'pair', score: 300, yomi: 'ほのお', desc: '「火」を2つ重ねた字。火が燃え上がる「ほのお」を表す。' },
  { ch: '男', parts: ['田', '力'], shape: 'pair', score: 300, yomi: 'おとこ', desc: '「田」と「力」を合わせた字。田で力を出して働く人。' },
  { ch: '仙', parts: ['人', '山'], shape: 'pair', score: 300, yomi: 'せん', desc: '「人」と「山」を合わせた字。山で暮らす人、「仙人」を表す。' },
  { ch: '畑', parts: ['火', '田'], shape: 'pair', score: 300, yomi: 'はたけ', desc: '日本で作られた漢字（国字）。火を入れて開いた田、「はたけ」を表す。' },
];

export const SPECIALS = {
  bomb: { ch: '爆', name: '爆', desc: '4つ一直線にそろえる。まわり3×3を消す' },
  rainbow: { ch: '虹', name: '虹', desc: '5つ一直線、またはL字・T字にそろえる。同じ字をぜんぶ消す' },
};

const sortedKey = (a, b) => [a, b].sort().join('');
export const LINE = new Map(RECIPES.filter(r => r.shape === 'line').map(r => [r.parts[0], r]));
export const PAIR = new Map(RECIPES.filter(r => r.shape === 'pair').map(r => [sortedKey(r.parts[0], r.parts[1]), r]));
export const pairKey = sortedKey;
export const recipeOf = ch => RECIPES.find(r => r.ch === ch);
