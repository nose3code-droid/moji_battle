// pairs.js の整合性チェック：node games/machigai/test/check_pairs.mjs
import { PAIRS } from '../pairs.js';
let bad = 0;
const fail = m => { console.log('FAIL', m); bad++; };
const ids = new Set();
for (const p of PAIRS) {
  if ([...p.a].length !== 1 || [...p.b].length !== 1) fail(`1文字ではない ${p.id}`);
  if (p.a === p.b) fail(`同じ字 ${p.id}`);
  if (![1, 2, 3].includes(p.lv)) fail(`むずかしさ ${p.id}`);
  const key = [p.a, p.b].sort().join('');
  if (ids.has(key)) fail(`重複 ${p.id}`);
  ids.add(key);
}
const by = lv => PAIRS.filter(p => p.lv === lv).length;
console.log(`ペア ${PAIRS.length} 組（むずかしさ1:${by(1)} 2:${by(2)} 3:${by(3)}）、説明なし ${PAIRS.filter(p => !p.tip).length}`);
if (PAIRS.length < 40) fail('40組未満');
console.log(bad ? 'NG' : 'OK');
process.exit(bad ? 1 : 0);
