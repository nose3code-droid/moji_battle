// 勝ったときにもらえる部品の選択肢（3つ）。試合の番号から決まるので、読みこみ直しても同じ3つになる
import { CATALOG } from './parts.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 試合が進むほど、強い字が出やすくなる。なるべく得意な枠がばらけるように選ぶ
export function rewardOptions(matchIdx, owned, parts) {
  const pool = CATALOG.map(c => parts.get(c.ch)).filter(p => p && !owned.includes(p.ch))
    .sort((a, b) => a.power - b.power || a.ch.localeCompare(b.ch));
  if (pool.length <= 3) return pool.map(p => p.ch);
  const rnd = mulberry32(matchIdx * 7919 + 13);
  const center = Math.round((0.18 + 0.075 * matchIdx) * (pool.length - 1));
  const half = Math.max(3, Math.ceil(pool.length * 0.2));
  const lo = Math.max(0, Math.min(pool.length - 1 - 2 * half, center - half)), hi = Math.min(pool.length - 1, lo + 2 * half);
  const cand = pool.slice(lo, hi + 1);
  const picked = [];
  while (picked.length < 3 && cand.length) {
    const usedBest = new Set(picked.map(p => p.best));
    const fresh = cand.filter(p => !usedBest.has(p.best));
    const from = fresh.length ? fresh : cand;
    const p = from[Math.floor(rnd() * from.length)];
    picked.push(p);
    cand.splice(cand.indexOf(p), 1);
  }
  return picked.map(p => p.ch);
}
