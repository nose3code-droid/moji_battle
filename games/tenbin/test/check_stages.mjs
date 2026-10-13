// 全30面に解があること、最初から解けた状態でないことを確かめる。node test/check_stages.mjs
import { STAGES } from '../stages.js';
import { KANJI } from '../kanji.js';
import { allSolutions, parOf, isSolved } from '../logic.js';
let bad = 0;
const chars = new Set(KANJI.map(k => k.ch));
if (new Set(KANJI.map(k => k.ch)).size !== KANJI.length) { console.log('字の重複'); bad++; }
STAGES.forEach((st, i) => {
  const items = [...st.plates.flat(), ...st.hand].filter(x => typeof x === 'string');
  const unknown = items.filter(c => !chars.has(c));
  const sols = unknown.length ? [] : allSolutions(st);
  const par = sols.length ? Math.min(...sols.map(s => s.filter(p => p >= 0).length)) : null;
  const init = unknown.length ? false : isSolved(st, st.hand.map(() => -1));
  const ok = sols.length > 0 && !init && !unknown.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${String(i + 1).padStart(2)} ${st.type.padEnd(5)} ${st.name} 解${sols.length}通り 最少${par}枚 手${st.hand.length}${unknown.length ? ' 未登録:' + unknown : ''}`);
});
console.log(STAGES.length === 30 ? '30面' : `面数が${STAGES.length}`, bad ? `NG ${bad}` : 'すべてOK');
process.exit(bad || STAGES.length !== 30 ? 1 : 0);
