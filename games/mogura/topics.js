// 文字もぐらたたき：お題（全10ラウンド）
// test(ch) は、字の属性（kanji.js）から正解かどうかを計算する。
//   true＝お題に合う／false＝合わない／null＝属性が書かれていないので判定しない
// 正解の字は、データにある字のうち test が true のもの全部。
// 不正解の字は decoys に書いた「まぎらわしい字」（test が false であることをテストで確認する）。
import { KANJI } from './kanji.js';

const rad = name => ch => { const r = KANJI[ch]?.r; return r === undefined ? null : r === name; };
const eqS = n => ch => { const s = KANJI[ch]?.s; return s === undefined ? null : s === n; };
const hasNichi = ch => { const p = KANJI[ch]?.parts; return p === undefined ? null : p.includes('日'); };
const hasOn = yomi => ch => { const o = KANJI[ch]?.on; return o === undefined ? null : o.includes(yomi); };
const isKind = k => ch => { const v = KANJI[ch]?.k; return v === undefined ? null : v === k; };

const radExplain = label => (ch, ok) => {
  const e = KANJI[ch];
  return ok ? `${ch}は${label}の字（${e.s}画）。` : `${ch}は${e.r}の字（${e.s}画）。${label}ではない。`;
};
const strokeExplain = n => (ch, ok) => ok ? `${ch}は${n}画。` : `${ch}は${KANJI[ch].s}画。${n}画ではない。`;
const KIND_TEXT = {
  象形: '物の形をかたどってできた字',
  指事: '点や線で位置・状態を示してできた字',
  会意: '意味を組み合わせてできた字',
  形声: '意味を表す部分と音を表す部分を組み合わせてできた字',
};

const T = (id, title, short, test, decoys, explain, level) => ({ id, title, short, test, decoys: [...decoys], explain });

export const TOPICS = [
  T('ki', '木へんの字', '木へん', rad('きへん'), '秋科秒私移税休体作持指打投待後役', radExplain('木へん')),
  T('s5', '画数が5の字', '5画', eqS(5), '木日月火水手犬方少太天先糸年百耳当同名気回', strokeExplain(5)),
  T('sanzui', 'さんずいの字', 'さんずい', rad('さんずい'), '冷凍氷待後役径徒快情地場坂', radExplain('さんずい')),
  T('nichi', '「日」が入る字', '日を含む', hasNichi, '目田由甲自見貝青回国月用周西',
    (ch, ok) => ok ? `${ch}には部品として「日」が入っている。` : `${ch}には「日」は入っていない。`),
  T('kusa', 'くさかんむりの字', 'くさかんむり', rad('くさかんむり'), '笑筆第算笛答家室安宿雲雪電', radExplain('くさかんむり')),
  T('nin', 'にんべんの字', 'にんべん', rad('にんべん'), '待後役径徒往律持指打投拾', radExplain('にんべん')),
  T('on-kou', '音読みが「こう」の字', '音読み「こう」', hasOn('コウ'), '空左右土士亭商仏松先兄日田中文父夜同老者女役',
    (ch, ok) => `${ch}の音読みは「${KANJI[ch].on.join('・')}」。${ok ? '' : '「コウ」はない。'}`),
  T('s8', '画数が8の字', '8画', eqS(8), '男町見足赤豆車里来近図麦兵弟草春秋南食星昼音海活計', strokeExplain(8)),
  T('gon', 'ごんべんの字', 'ごんべん', rad('ごんべん'), '紙線絵組終細銀鉄針飲貨買', radExplain('ごんべん')),
  T('shokei', '象形文字（物の形の字）', '象形文字', isKind('象形'), '林森明休男岩炎看鳴好位海花校河清晴時語板村上下本末',
    (ch, ok) => {
      const e = KANJI[ch];
      const how = e.c ? `（${e.c}）` : '';
      return `${ch}は${e.k}文字${how}。${KIND_TEXT[e.k]}。`;
    }),
];

// 正解にできる字（属性から計算）
for (const t of TOPICS) {
  t.correct = Object.keys(KANJI).filter(ch => t.test(ch) === true);
}
