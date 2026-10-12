// 文字そだて：会話（数行ずつ）。who: 'n' ナレーション / 'granny' となりのおばあさん / 'kid' 育てている字 / 他は名前をそのまま出す
export const PROLOGUE = [
  { who: 'n', text: 'ある朝、庭のすみに、小さな字が落ちていた。' },
  { who: 'n', text: '横にひと筆。たった1画の、ちっぽけな「一」。' },
  { who: 'granny', text: 'あらまあ、字の子じゃないか。拾ったんなら、あんたが「字の育て親」だよ。' },
  { who: 'granny', text: '米を食べさせて、水をやって、日に当てて。遊んでやって、夜はちゃんと寝かせるんだ。' },
  { who: 'granny', text: '育ち方は、あげたエサしだい。いろんな字に化けるから、たのしみにしな。' },
  { who: 'kid', text: '……いち。（ぷるぷる）' },
];

// 進化のときの会話。from → to
export function evolveTalk(from, to, form, firstEver) {
  const lines = [
    { who: 'n', text: `「${from}」が、ぽうっと光りはじめた……！` },
    { who: 'n', text: `「${to}」に進化した！（${form.n}画）` },
    { who: 'kid', text: form.say },
  ];
  if (EXTRA[to]) lines.push({ who: 'granny', text: EXTRA[to] });
  lines.push({ who: 'n', text: `【${to}】${form.note}` });
  if (firstEver) lines.push({ who: 'n', text: 'ずかんに あたらしい字が のった！' });
  return lines;
}

// 特定の字になったときのおばあさんのひとこと
const EXTRA = {
  '二': 'ほう、画がひとつ増えたね。字はね、足し算で大きくなるのさ。',
  '王': 'おやまあ、王さまじゃないか。頭が高い、頭が高い。',
  '森': 'こりゃたまげた。庭に森ができちまったよ。',
  '品': 'ずいぶん口数の多い子になったねえ。',
  '晶': 'まぶしくて、まともに見られやしない。',
  '犬': 'おや、わんちゃんだ。吠えるのは、ほどほどにしておくれよ。',
};

export const TALK_WAKE_UP = '……ふぁ。おはよう。';

// 旅立ち（エンディング）
export function endingTalk(ch, form) {
  return [
    { who: 'n', text: `旅立ちの朝。「${ch}」は、すっかり立派な字になった。` },
    { who: 'granny', text: `ほれ、堂々としたもんだ。${ch}、よくここまで育ったねえ。` },
    { who: 'n', text: '町の人たちが、庭の前に集まってきた。' },
    { who: 'パン屋', text: 'うちの看板に、一字かいてほしいくらいだ！' },
    { who: '先生', text: '画をひとつずつ足して、ここまで来たんだなあ。字は、育つんだ。' },
    { who: '子ども', text: 'いってらっしゃーい！ またあそぼうね！' },
    { who: 'kid', text: `（「${ch}」は、ふかくおじぎをして、朝の道へゆっくり歩きだした）` },
    { who: 'n', text: `町のみんなに見送られて、「${ch}」は旅立っていった。` },
    { who: 'granny', text: 'さて、庭がさびしくなるねえ。……おや？ 地面に、また何か落ちてるよ。' },
    { who: 'n', text: 'ちっぽけな「一」だ。……また、はじまる。' },
  ];
}
