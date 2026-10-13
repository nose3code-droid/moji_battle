// 各面の解を全探索で求め、solutions.js として標準出力に書き出す。
// 使い方：LOCAL_FONT=フォント.otf node games/domino/tools/solve.mjs [面番号…] > games/domino/solutions.js
//   -v で経過を stderr に。面番号（1始まり）を渡すと、その面だけ調べて結果を stderr に出す（試作用）
import { setup } from './lib.mjs';
const { LEVELS } = await import(process.env.LEVELS_FILE || '../levels.js');   // LEVELS_FILE：試作の面ファイルで探索するとき
import { Sim, DT, isTool, overlapping } from '../physics.js';

const { R, shapes } = await setup();
const log = (...a) => console.error(...a);
const only = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);

// 最後まで（または steps 刻み）走らせて、各字が倒れたかを返す
function run(level, placement, steps) {
  const sim = new Sim(R, level, shapes, placement);
  sim.idleLimit = 0.8;
  for (let i = 0; i < steps && !sim.result; i++) sim.step();
  const moved = sim.bodies.filter(b => b.kind === 'glyph' && b.slot >= 0).map(b => {
    const t = b.body.translation(), sl = level.slots[b.slot];
    return { slot: b.slot, moved: Math.abs(b.body.rotation()) > 0.5 || Math.abs(t.x - sl.x) > 0.15 || b.gone };
  });
  const out = { result: sim.result, moved, time: sim.time };
  sim.free();
  return out;
}
const FULL = Math.ceil(46 / DT);

function solveLevel(level, idx) {
  const slots = level.slots, hand = level.hand;
  const accepts = (sl, card) => (sl.kind ?? 'glyph') === 'glyph' ? !isTool(card) : card === '@' + sl.kind;
  const sols = [];
  let sims = 0;
  const lastToolIdx = slots.reduce((m, s, i) => ((s.kind ?? 'glyph') !== 'glyph' ? i : m), -1);
  const cur = slots.map(() => null);
  const firstGlyph = slots.findIndex(s => !s.kind);
  const chainOnly = lastToolIdx < 0 && level.segs.length === 1 && level.segs[0].length === 3;   // 道具の無い面は、字と字の間隔が広すぎる置き方を最初から捨てる
  let lastX = -9;
  const used = hand.map(() => false);
  const rec = i => {
    if (sols.length >= 400 || sims > 12000) return;
    if (i === slots.length) {
      if (!cur.some(c => c && !isTool(c))) return;
      sims++;
      if (run(level, cur, FULL).result === 'clear') sols.push(cur.slice());
      return;
    }
    const seen = new Set();
    for (let k = hand.length - 1 + 0; k >= -1; k--) {
      if (k === -1 && level.kick && i === firstGlyph) continue;      // 棒が押す最初の置き場は必ず埋める
      if (k >= 0 && (used[k] || !accepts(slots[i], hand[k]) || seen.has(hand[k]))) continue;
      if (k >= 0 && !isTool(hand[k]) && overlapping(level, cur.map((c, j) => (j === i ? hand[k] : c)), shapes)) continue;   // 重なる置き方は無し
      if (k >= 0 && chainOnly && !isTool(hand[k]) && lastX > -9 && slots[i].x - lastX > 1.05) continue;
      const prevX = lastX;
      if (k >= 0) { seen.add(hand[k]); used[k] = true; cur[i] = hand[k]; if (!isTool(hand[k])) lastX = slots[i].x; } else cur[i] = null;
      let ok = true;
      // 枝刈り：道具の置き場がもう無いなら、いま置いた字が倒れていないものは見込みなし
      if (k >= 0 && !isTool(hand[k]) && i >= lastToolIdx) {
        sims++;
        const r = run(level, cur, FULL);
        const me = r.moved.find(m => m.slot === i);
        if (r.result !== 'clear' && me && !me.moved) ok = false;
      }
      if (ok) rec(i + 1);
      if (k >= 0) { used[k] = false; cur[i] = null; }
      lastX = prevX;
    }
  };
  rec(0);
  const glyphCount = s => s.filter(c => c && !isTool(c)).length;
  sols.sort((a, b) => glyphCount(a) - glyphCount(b));
  const par = sols.length ? glyphCount(sols[0]) : 0;
  return { sols, par, sims, nPar: sols.filter(s => glyphCount(s) === par).length };
}

const out = [];
LEVELS.forEach((lv, i) => {
  if (only.length && !only.includes(i + 1)) return;
  const t0 = Date.now();
  const r = solveLevel(lv, i);
  log(`面${i + 1} ${lv.name}${lv.variant ? ' [' + lv.variant + ']' : ''}: 解 ${r.sols.length}${r.sols.length >= 400 ? '+' : ''}、最少 ${r.par} 字（${r.nPar} 通り）、${r.sims} 回、${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  if (only.length) log('  最少の例:', JSON.stringify(r.sols[0]), r.sols.slice(1, 4).map(s => JSON.stringify(s)).join(' | '));
  out.push({ placement: r.sols[0] ?? null, par: r.par });
  if (only.length) console.log(JSON.stringify({ i: i + 1, placement: r.sols[0] ?? null, par: r.par }));   // 試作用：面ごとの結果を標準出力へ
});
if (!only.length) {
  console.log('// tools/solve.mjs が作った各面の最短解（置き場ごとの札。null は置かない）と、その字数（星3の基準）。手で書き換えない');
  console.log('export const SOLUTIONS = ' + JSON.stringify(out) + ';');
}
