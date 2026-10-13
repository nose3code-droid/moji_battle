// CPU の投げ方：的のどこをねらうか（中心に寄せる／相手をはじく／手前にガード）を盤面から選び、
// 字の性格（滑り・曲がり・重さ）を使って試し打ち（シミュレーション）で向きと力加減を決める。
import { World, SHEET, VMAX, G, DT, MAX_STEPS, evalBoard, judgeThrown, quantizeShot } from './physics.js';

// 決定的な乱数（同じ種なら同じ並び）
export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const gauss = rng => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

export const LEVELS = {
  easy:   { name: 'やさしい', angle: 0.05,  power: 0.10 },
  normal: { name: 'ふつう',   angle: 0.016, power: 0.035 },
  hard:   { name: 'むずかしい', angle: 0.004, power: 0.01 },
};

// 空の氷でストーン1個だけ投げた結果。ty を通過した瞬間の x も返す
function trial(def, shot, sweep, ty) {
  const w = new World();
  const s = w.launch(def, 0, shot);
  let crossX = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    w.step(sweep);
    if (crossX === null && s.y <= ty) crossX = s.x;
    if (w.settled()) break;
  }
  return { x: s.x, y: s.y, crossX };
}

// 目標点 (tx,ty) に止める（draw）／目標点を通る（takeout）ための向きと強さを求める
function calibrate(def, spin, tx, ty, sweep, fixedPower) {
  const dist = SHEET.hackY - ty;
  const a = def.traits.mu * G * (sweep ? def.traits.sweepMul : 1);
  let power = fixedPower ?? Math.min(1, Math.sqrt(2 * a * dist) / (VMAX * def.traits.power));
  let angle = Math.atan2(tx, dist);
  for (let it = 0; it < 4; it++) {
    const r = trial(def, { angle, power, spin }, sweep, ty);
    if (fixedPower == null) {
      const ex = r.x - tx;
      angle -= ex / dist;
      const d = SHEET.hackY - r.y;
      if (d > 5) power = Math.min(1, power * Math.sqrt(dist / d));
    } else if (r.crossX != null) {
      angle -= (r.crossX - tx) / dist;
    }
  }
  return quantizeShot({ angle, power, spin });
}

// 1投ぶんを実際の盤面で試した結果の盤面
function playOut(world, def, team, shot, sweep) {
  const w = world.clone();
  const s = w.launch(def, team, shot);
  w.run(sweep);
  judgeThrown(s);
  return w;
}

// ctx: { team, myNo(自分の何投目か 0〜2), pool(字の定義の配列), level, rng }
export function planShot(world, ctx) {
  const { team, myNo, pool, level, rng } = ctx;
  const lv = LEVELS[level] || LEVELS.normal;
  const early = myNo < 2;
  const foes = world.stones.filter(s => !s.out && s.team !== team && s.y < 110 && Math.abs(s.x) < SHEET.halfW - 6);
  const cands = [];
  const add = (kind, label, def, spin, tx, ty, sweep, power) => {
    cands.push({ kind, label, def, sweep, shot: calibrate(def, spin, tx, ty, sweep, power), tx, ty });
  };
  const pick = arr => arr[Math.floor(rng() * arr.length)];

  if (level === 'easy') {
    // やさしい：だいたい中心をねらって、ときどき適当にはじきにいく。評価はしない
    const def = pick(pool), spin = rng() < 0.5 ? 1 : -1;
    if (foes.length && rng() < 0.25) {
      const f = pick(foes);
      add('takeout', 'はじきにいく', def, spin, f.x, f.y, false, 0.8);
    } else {
      add('draw', '中心にねらう', def, spin, (rng() - 0.5) * 20, (rng() - 0.5) * 20, false);
    }
    return finish(cands[0], lv, rng);
  }

  const defs = pool;
  const spins = level === 'hard' ? [1, -1] : [rng() < 0.5 ? 1 : -1];
  for (const def of defs) for (const spin of spins) {
    for (const sweep of level === 'hard' ? [false, true] : [false]) {
      add('draw', '中心に寄せる', def, spin, 0, 0, sweep);
      add('draw', '中心に寄せる', def, spin, -14, 8, sweep);
      add('draw', '中心に寄せる', def, spin, 14, 8, sweep);
      if (early) {
        add('guard', '手前にガードを置く', def, spin, 0, 135, sweep);
        add('guard', '手前にガードを置く', def, spin, spin * -22, 118, sweep);
      }
    }
    for (const f of foes) add('takeout', '相手のストーンをはじく', def, spin, f.x, f.y, false, level === 'hard' ? 0.95 : 0.88);
  }
  for (const c of cands) {
    const w = playOut(world, c.def, team, c.shot, c.sweep);
    c.score = evalBoard(w, team, early) + (c.kind === 'guard' ? 0.3 : 0);
  }
  cands.sort((a, b) => b.score - a.score);
  let best = cands[0];
  if (level === 'hard') {
    // 上位3つは、向きが少しずれてもよいかを見て選ぶ
    let bs = -1e9;
    for (const c of cands.slice(0, 3)) {
      let sum = c.score;
      for (const d of [-0.012, 0.012]) {
        const w = playOut(world, c.def, team, { ...c.shot, angle: c.shot.angle + d }, c.sweep);
        sum += evalBoard(w, team, early);
      }
      sum /= 3;
      if (sum > bs) { bs = sum; best = c; }
    }
  } else {
    // ふつう：同点くらいの上位から選ぶ
    const top = cands.filter(c => c.score >= cands[0].score - 1.5).slice(0, 3);
    best = pick(top);
  }
  return finish(best, lv, rng);
}

// 強さのばらつき（腕前）を乗せる
function finish(c, lv, rng) {
  const shot = quantizeShot({
    angle: c.shot.angle + gauss(rng) * lv.angle,
    power: c.shot.power * (1 + gauss(rng) * lv.power),
    spin: c.shot.spin,
  });
  return { def: c.def, shot, sweep: c.sweep, label: c.label, kind: c.kind };
}

// プレイヤー用の目安：空の氷で止まる位置（スイープなし）
export function predictStop(def, shot) {
  const r = trial(def, shot, false, -9999);
  return { x: r.x, y: r.y };
}
