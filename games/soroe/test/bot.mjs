// 全15面のクリア可能性を調べる自動テスト：盤を作り、貪欲な bot で何度も遊ぶ
//   node games/soroe/test/bot.mjs [試行回数]
import { STAGES, starsFor } from '../stages.js';
import { stageInfo, makeRng, newBoard, listMoves, previewMove, playMove, newProgress, applyWavesToProgress, goalDone } from '../logic.js';

const TRIES = +process.argv[2] || 100;
let allOk = true;
for (let si = 0; si < STAGES.length; si++) {
  const stage = STAGES[si], info = stageInfo(stage);
  let wins = 0, starSum = 0, kinds = 0;
  for (let t = 0; t < TRIES; t++) {
    const rng = makeRng(si * 100003 + t * 7919 + 1);
    let grid = newBoard(info, rng);
    const prog = newProgress(stage);
    let left = stage.moves;
    while (left > 0 && !goalDone(stage, prog)) {
      const moves = listMoves(grid, info.recipes);
      if (!moves.length) throw new Error('動かせる手がない盤が残った');
      // 各手の第1波を採点：未達のゴールに近づく手を高く評価
      let best = null, bestV = -1;
      for (const [a, b] of moves) {
        const w = previewMove(grid, a, b, info);
        let v = w.clear.length + rng();
        stage.goals.forEach((g, i) => {
          const need = g.n - prog.goals[i];
          if (need <= 0) return;
          if (g.t === 'make') v += 60 * w.made.filter(m => m.ch === g.ch).length;
          if (g.t === 'clear') v += 4 * (w.cleared[g.ch] || 0);
          if (g.t === 'special') v += 60 * w.create.filter(c => c.kind === g.kind).length;
          if (g.t === 'score') v += w.gain / 10;
        });
        v += w.made.length * 5 + w.create.length * 8;
        if (v > bestV) { bestV = v; best = [a, b]; }
      }
      const res = playMove(grid, best[0], best[1], info, rng);
      if (!res.valid) throw new Error('listMoves が有効と言った手が無効だった');
      applyWavesToProgress(stage, prog, res.waves);
      grid = res.grid;
      left--;
      for (const w of res.waves) kinds += w.made.length;
    }
    if (goalDone(stage, prog)) { wins++; starSum += starsFor(left, stage.moves); }
  }
  const rate = wins / TRIES;
  if (rate < 0.7) allOk = false;
  console.log(`面${String(si + 1).padStart(2)} ${stage.name.padEnd(8, '　')} 手数${stage.moves} クリア率 ${(rate * 100).toFixed(0)}%  平均星 ${wins ? (starSum / wins).toFixed(2) : '-'}`);
}
console.log(allOk ? 'OK：全面で bot が7割以上クリア' : '調整が必要な面あり');
process.exit(allOk ? 0 : 1);
