// 各ホールの「解の打ち方」を探索する（検証用。ゲーム本体は使わない）。
// 物理は決定的なので、見つけた打ち方は同じ文字なら必ず再現される。
import { simulateShot, quantizeShot, PULL_MAX } from './physics.js';

// 今の位置から1打でカップインする打ち方（なければ null）。粗い格子 → 当たりの近くを細かく
export function findHoleInOne(hole, traits, st, { aStep = 1, pStep = 0.02 } = {}) {
  const base = Math.atan2(hole.cup.y - st.y, hole.cup.x - st.x);
  const tries = [];
  for (let d = 0; d < 360; d += aStep) tries.push(((d % 360) / 180) * Math.PI);
  tries.sort((a, b) => Math.abs(angDiff(a, base)) - Math.abs(angDiff(b, base))); // カップの方向から近い順
  for (const a of tries) {
    for (let p = pStep; p <= 1.0001; p += pStep) {
      const shot = quantizeShot(a, p);
      if (simulateShot(hole, traits, st, shot, false).result === 'cup') return shot;
    }
  }
  return null;
}

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// 打数が少ない順に探す：1打 → 候補位置を作って2打 → 3打…。返り値: 打ち方の配列（なければ null）
export function solveHole(hole, traits, maxStrokes = 4, beam = 18) {
  let frontier = [{ st: { x: hole.tee.x, y: hole.tee.y, t: 0 }, shots: [] }];
  for (let depth = 1; depth <= maxStrokes; depth++) {
    for (const node of frontier) {
      const shot = findHoleInOne(hole, traits, node.st);
      if (shot) return [...node.shots, shot];
    }
    if (depth === maxStrokes) break;
    // 次の候補位置：すべての打ち方の止まった場所を、カップへの近さと散らばりで選ぶ
    const cand = new Map();
    for (const node of frontier) {
      for (let d = 0; d < 360; d += 3) for (let p = 0.1; p <= 1.0001; p += 0.1) {
        const shot = quantizeShot((d / 180) * Math.PI, p);
        const r = simulateShot(hole, traits, node.st, shot, false);
        if (r.result !== 'rest') continue;
        const key = Math.round(r.end.x / 30) + ',' + Math.round(r.end.y / 30) + ',' + Math.round(r.end.t / 60);
        if (!cand.has(key)) cand.set(key, { st: r.end, shots: [...node.shots, shot], score: Math.hypot(r.end.x - hole.cup.x, r.end.y - hole.cup.y) });
      }
    }
    frontier = [...cand.values()].sort((a, b) => a.score - b.score).slice(0, beam);
    if (!frontier.length) return null;
  }
  return null;
}

// 引っぱり量（コース座標）に直す
export const pullOf = shot => shot.power * PULL_MAX;
