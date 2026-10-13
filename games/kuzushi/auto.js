// 自動操縦：ボールの落下位置を壁の反射まで読んでパドルを動かし、残っている字へ向けて打ち返す。
// テストと、?auto のデモ用。人間より少し上手いが、パドルの最高速度は sim.js の制限を受ける。
import { W, PADDLE_Y, BALL_R, MAX_ANGLE, mulberry32 } from './sim.js';

export function makeAutopilot(seed = 7) {
  const rng = mulberry32(seed);
  let key = -1, target = null;

  return function autopilot(sim) {
    if (sim.state === 'ready') return { tx: sim.px, launch: true };
    // いちばん早くパドルに届く落下中のボール
    let best = null, bt = Infinity;
    for (const b of sim.balls) {
      if (b.attached || b.vy <= 0) continue;
      const t = (PADDLE_Y - BALL_R - b.y) / b.vy;
      if (t < bt) { bt = t; best = b; }
    }
    if (best && (bt < 1.6 || !sim.items.length)) {
      if (key !== sim.stats.paddleHits || !target) {   // パドルで打つたびに次のねらいを決める
        key = sim.stats.paddleHits;
        const live = sim.blocks.filter(b => b.alive);
        target = live.length ? live[Math.floor(rng() * live.length)] : null;
      }
      const xl = fold(best.x + best.vx * bt);
      let u = (rng() - 0.5) * 0.4;
      if (target) {
        const bb = target.c.bbox;
        const tx = target.g.x + (bb[0] + bb[2]) / 2, ty = target.g.y + (bb[1] + bb[3]) / 2;
        u = Math.max(-0.9, Math.min(0.9, Math.atan2(tx - xl, PADDLE_Y - ty) / MAX_ANGLE));
      }
      return { tx: xl - u * sim.pw / 2 };
    }
    // ボールに余裕があるときは落ちてくる字（アイテム）を取りに行く
    let item = null;
    for (const it of sim.items) if (!item || it.y > item.y) item = it;
    if (item) return { tx: item.x };
    return { tx: sim.px };
  };
}

// 壁で折り返した後の x
function fold(x) {
  const lo = BALL_R, hi = W - BALL_R, span = hi - lo;
  let t = (x - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return lo + (t > span ? 2 * span - t : t);
}
