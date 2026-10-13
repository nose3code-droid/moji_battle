// 得点のめやす確認：正解だけをすぐ叩く人／少し遅れて叩く人／ミスを混ぜる人の合計点
import { newRound, step, tap, makeRng, ROUND_COUNT, rankFor } from '../logic.js';
function play(reactMs, errRate, seed) {
  const rng = makeRng(seed); let total = 0;
  for (let k = 0; k < ROUND_COUNT; k++) {
    const r = newRound(k, makeRng(seed * 31 + k));
    while (!r.done) {
      step(r, 16);
      r.holes.forEach((h, i) => {
        if (!h || r.t - h.born < reactMs) return;
        if (h.target) tap(r, i);
        else if (rng() < errRate / 60) tap(r, i);
      });
    }
    total += r.score;
  }
  return total;
}
for (const [label, ms, err] of [['完璧(0.1秒)', 100, 0], ['速い(0.4秒)', 400, 0], ['ふつう(0.7秒)', 700, 0.02], ['のんびり(1.0秒)', 1000, 0.05]]) {
  const xs = [1, 2, 3, 4, 5].map(s => play(ms, err, s));
  console.log(label, xs.map(x => `${x}(${rankFor(x)})`).join(' '));
}
