// なぞり魔法：属性・相性・面・セリフのデータ

// 5すくみの輪：左の字は右の字に強い（水→火→闇→光→雷→水）
export const RING = ['水', '火', '闇', '光', '雷'];
export const beats = (a, b) => RING[(RING.indexOf(a) + 1) % 5] === b;
export const counterOf = ch => RING[(RING.indexOf(ch) + 4) % 5]; // ch に強い字

// 魔法ごとの性格：威力は画数の多さに比例して高い（火4画・水4画・光6画・雷13画・闇17画）
export const ELEMS = {
  火: { name: '火', mon: '火の魔物', color: '#ff5a1f', glow: '#ffb347', power: 20, strokes: 4,  trait: '素早く唱えられる基本の炎' },
  水: { name: '水', mon: '水の魔物', color: '#339af0', glow: '#a5d8ff', power: 20, strokes: 4,  trait: '素早く唱えられる清らかな水' },
  光: { name: '光', mon: '光の魔物', color: '#ffd95a', glow: '#fff9db', power: 28, strokes: 6,  trait: '少し画数が多く、威力も上がる' },
  雷: { name: '雷', mon: '雷の魔物', color: '#fcc419', glow: '#fff3a0', power: 36, strokes: 13, trait: '画数が多く難しいぶん、高威力' },
  闇: { name: '闇', mon: '闇の魔物', color: '#9c5de8', glow: '#d0a5ff', power: 44, strokes: 17, trait: '最も難しいが、最大の威力' },
};

// 大魔王がまとう属性の順番（その時の弱点は 水→雷→光→闇→火 の順 ＝ 5字すべてが必要）
export const BOSS_ORDER = ['火', '水', '雷', '光', '闇'];

export const SPEAKERS = {
  ji:   { name: '字',   glyph: '字', color: '#e8590c' },
  shi:  { name: '先生', glyph: '師', color: '#2b8a3e' },
  mao:  { name: '大魔王', glyph: '魔', color: '#6741d9' },
  tomo: { name: '町の人', glyph: '民', color: '#868e96' },
};

// 出現の並び：5属性を必ず全部含め、順番だけずらす
function seq(n, shift) {
  const base = ['火', '水', '雷', '光', '闇'];
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[(i * 2 + shift + Math.floor(i / 5)) % 5]);
  return out;
}
function spawns(n, shift, first, gap) {
  return seq(n, shift).map((e, i) => [first + i * gap, e]);
}

export const STAGES = [
  {
    name: '第1面　はじまりの商店街',
    hp: 40, cross: 46, hint: true, spawns: spawns(5, 0, 3, 8),
    intro: [
      ['shi', '字よ、町に魔物があふれておる。魔法とは、漢字を正しくなぞって唱えるものじゃ。'],
      ['ji', 'はい、先生！ 火・水・雷・光・闇――五つの字を、お手本どおりになぞるんですね。'],
      ['shi', '魔物にも属性がある。画面の相性の輪を見よ。弱点の字で唱えれば、威力は二倍じゃ。'],
    ],
    outro: [
      ['tomo', '助かった！ 商店街に灯りが戻ったよ。'],
      ['shi', '見事じゃ。じゃが魔物は五つの属性すべてで押し寄せる。五つの字、どれも欠かせぬぞ。'],
    ],
  },
  {
    name: '第2面　雨の港町',
    hp: 46, cross: 43, hint: true, spawns: spawns(7, 1, 3, 7),
    intro: [
      ['tomo', '港に魔物が上がってきたぞ！ 水も火も、雷までいる！'],
      ['ji', '落ち着いて、ていねいに…。精度が高いほど、魔法は強くなる。'],
    ],
    outro: [
      ['ji', '雨が上がった。精度が高いと、本当に威力が違うなあ。'],
      ['shi', '「結界」にも気をつけよ。弱点の字でなければ、魔物は倒しきれぬ。'],
    ],
  },
  {
    name: '第3面　雷鳴の丘',
    hp: 54, cross: 40, hint: true, spawns: spawns(9, 2, 3, 6.5),
    intro: [
      ['shi', '丘の上は雷雲が渦巻いておる。雷と闇は画数が多く難しいが、そのぶん威力は大きい。'],
      ['ji', '17画の「闇」…！ 焦らず、すみずみまでなぞります。'],
    ],
    outro: [
      ['ji', '難しい字ほど、決まったときの手ごたえがすごい！'],
      ['shi', '次は聖堂じゃ。魔物の頭上の弱点の字は、もう出ぬぞ。輪を覚えておけ。'],
    ],
  },
  {
    name: '第4面　光の大聖堂',
    hp: 62, cross: 38, hint: false, spawns: spawns(10, 3, 3, 6),
    intro: [
      ['tomo', '聖堂が魔物に囲まれています！ ……あれ、弱点の表示が見えない？'],
      ['ji', '輪を思い出そう。水は火に、火は闇に、闇は光に、光は雷に、雷は水に強い。'],
    ],
    outro: [
      ['tomo', 'ステンドグラスが輝きを取り戻したわ。ありがとう！'],
      ['shi', '魔王の力が近い。もう一面、森を抜けるのじゃ。'],
    ],
  },
  {
    name: '第5面　闇の森',
    hp: 70, cross: 36, hint: false, spawns: spawns(11, 4, 3, 5.6),
    intro: [
      ['mao', 'ククク…よくここまで来たな、見習いよ。'],
      ['ji', '魔王の声…！ 森の魔物をすべて倒して、お城へ向かう！'],
    ],
    outro: [
      ['ji', '森が静かになった。いよいよ魔王城だ。'],
      ['shi', '大魔王は五つの属性を順にまとう。そのときの弱点の字を、順になぞるのじゃ。'],
    ],
  },
  {
    name: '最終面　魔王城（大魔王）',
    hp: 56, cross: 36, hint: true, boss: true, bossHp: 75, bossCross: 130, spawns: [[8, '雷'], [18, '光'], [28, '火']],
    addGap: 11,
    intro: [
      ['mao', '我は大魔王。火・水・雷・光・闇、五つの力をまとう者。一つの字では我を倒せぬ！'],
      ['ji', '五つの字、全部使う…。まとった属性の弱点を、順番になぞるんだ！'],
    ],
    outro: [
      ['mao', 'ぐあああ…五つの字の力が、そろうとは……。'],
      ['shi', '見事じゃ、字よ。そなたはもう立派な魔法使いじゃ。'],
      ['ji', 'みなさんのおかげです。これからも、字をていねいになぞっていきます！'],
    ],
  },
];
