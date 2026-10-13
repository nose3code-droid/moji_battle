// データの整合性チェック：node games/mogura/test/check_data.mjs
// お題ごとに「正解12字以上・不正解12字以上」を確認し、不正解が本当にお題に合わないこと（属性から計算）を確かめる
import { KANJI } from '../kanji.js';
import { TOPICS } from '../topics.js';
let bad = 0;
const fail = m => { console.log('FAIL', m); bad++; };

for (const [ch, e] of Object.entries(KANJI)) {
  if (e.s !== undefined && !(Number.isInteger(e.s) && e.s >= 1 && e.s <= 30)) fail(`画数が変 ${ch}`);
  if (e.on && e.on.some(y => !/^[ァ-ヶ]+$/.test(y))) fail(`音読みがカタカナではない ${ch}`);
}
if (TOPICS.length !== 10) fail('お題が10個ではない');
for (const t of TOPICS) {
  const dec = t.decoys;
  if (new Set(dec).size !== dec.length) fail(`${t.id}: 不正解に重複`);
  for (const ch of dec) {
    if (t.test(ch) !== false) fail(`${t.id}: 不正解の ${ch} が false にならない（${t.test(ch)}）`);
    try { t.explain(ch, false); } catch (e) { fail(`${t.id}: ${ch} の解説が作れない ${e.message}`); }
  }
  for (const ch of t.correct) {
    try { if (!t.explain(ch, true)) fail('空の解説'); } catch (e) { fail(`${t.id}: ${ch} の解説が作れない ${e.message}`); }
  }
  if (t.correct.length < 12) fail(`${t.id}: 正解が12字未満 (${t.correct.length})`);
  if (dec.length < 12) fail(`${t.id}: 不正解が12字未満 (${dec.length})`);
  if (dec.some(ch => t.correct.includes(ch))) fail(`${t.id}: 正解と不正解が重なる`);
  console.log(`${t.id.padEnd(7)} ${t.title}  正解${t.correct.length} 不正解${dec.length}  例：${t.correct.slice(0, 8).join('')} / ${dec.slice(0, 6).join('')}`);
}
console.log(`字の数 ${Object.keys(KANJI).length}`);
console.log(bad ? 'NG' : 'OK');
process.exit(bad ? 1 : 0);
