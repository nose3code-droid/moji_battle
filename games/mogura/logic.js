// 文字もぐらたたき：ゲームの中身（画面に依存しない）。main.js から使う
import { TOPICS } from './topics.js';

export const ROUND_COUNT = 10;
export const ROUND_TIME = 30;      // 1ラウンドの秒数
export const LIFE = 3;             // 1ラウンドのライフ
export const WRONG_PENALTY = 50;   // お題に合わない字を叩いたときの減点
export const ESCAPE_PENALTY = 30;  // お題の字を見逃したときの減点
export const HIT_BASE = 100;
export const SPEED_BONUS = 50;     // すぐ叩くほど最大でこれだけ加点
export const COOL_MS = 350;        // 叩いた穴が次に使えるまで
export const RANKS = [['S', 45000], ['A', 32000], ['B', 18000], ['C', 0]];

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ラウンドごとの設定。後半ほど速く、穴も増える（3×3 → 4×4）
export function roundConfig(i) {
  return {
    n: i < 5 ? 3 : 4,
    interval: 1000 - i * 50,         // 出現の間隔（ms）
    stay: 1900 - i * 100,            // 顔を出している時間（ms）
    pTarget: i < 5 ? 0.5 : 0.42,     // 出てくる字がお題に合う確率
    maxUp: i < 5 ? 3 : 5,            // 同時に顔を出す数の上限
  };
}

export function comboMult(combo) { return Math.min(1 + Math.floor(combo / 3) * 0.5, 3); }
export function rankFor(total) { return RANKS.find(([, min]) => total >= min)[0]; }

export function newRound(index, rng = Math.random) {
  const cfg = roundConfig(index);
  return {
    index, topic: TOPICS[index], cfg, rng,
    holes: Array(cfg.n * cfg.n).fill(null),
    blocked: Array(cfg.n * cfg.n).fill(0),  // この時刻（t）まで使えない
    t: 0, left: ROUND_TIME * 1000, nextSpawn: 600,
    life: LIFE, score: 0, combo: 0, maxCombo: 0,
    hits: 0, wrongs: 0, escapes: 0, shown: 0,
    recent: [], done: false, reason: null,
  };
}

function pickChar(r, target) {
  const list = target ? r.topic.correct : r.topic.decoys;
  for (let k = 0; k < 8; k++) {
    const ch = list[Math.floor(r.rng() * list.length)];
    if (!r.recent.includes(ch)) return ch;   // 直近に出した字は避ける
  }
  return list[Math.floor(r.rng() * list.length)];
}

// 時間を dtMs 進める。起きたことを [{type:'spawn'|'escape'|'end', ...}] で返す
export function step(r, dtMs) {
  const events = [];
  if (r.done) return events;
  r.t += dtMs; r.left -= dtMs;
  for (let i = 0; i < r.holes.length; i++) {
    const h = r.holes[i];
    if (h && r.t - h.born >= h.stay) {
      r.holes[i] = null; r.blocked[i] = r.t + COOL_MS;
      if (h.target) {
        r.escapes++; r.combo = 0;
        r.score = Math.max(0, r.score - ESCAPE_PENALTY);
        events.push({ type: 'escape', i, ch: h.ch });
      } else events.push({ type: 'leave', i, ch: h.ch });
    }
  }
  r.nextSpawn -= dtMs;
  while (r.nextSpawn <= 0 && r.left > 0) {
    r.nextSpawn += r.cfg.interval * (0.75 + r.rng() * 0.5);
    const up = r.holes.filter(Boolean).length;
    if (up >= r.cfg.maxUp) continue;
    const free = [];
    r.holes.forEach((h, i) => { if (!h && r.t >= r.blocked[i]) free.push(i); });
    if (!free.length) continue;
    const i = free[Math.floor(r.rng() * free.length)];
    const target = r.rng() < r.cfg.pTarget;
    const ch = pickChar(r, target);
    r.recent.push(ch); if (r.recent.length > 6) r.recent.shift();
    r.holes[i] = { ch, target, born: r.t, stay: r.cfg.stay };
    r.shown++;
    events.push({ type: 'spawn', i, ch, target });
  }
  if (r.left <= 0) finish(r, 'time', events);
  return events;
}

function finish(r, reason, events) {
  r.left = Math.max(0, r.left); r.done = true; r.reason = reason;
  for (let i = 0; i < r.holes.length; i++) r.holes[i] = null;
  events.push({ type: 'end', reason });
}

// 穴 i を叩く。結果：{ kind:'none'|'hit'|'wrong', ch, gained, ended }
export function tap(r, i) {
  const h = r.holes[i];
  if (r.done || !h) return { kind: 'none' };
  r.holes[i] = null; r.blocked[i] = r.t + COOL_MS;
  if (h.target) {
    const speed = 1 - Math.min(1, (r.t - h.born) / h.stay);
    const gained = Math.round((HIT_BASE + SPEED_BONUS * speed) * comboMult(r.combo));
    r.combo++; r.maxCombo = Math.max(r.maxCombo, r.combo);
    r.score += gained; r.hits++;
    return { kind: 'hit', ch: h.ch, gained, combo: r.combo, ended: false };
  }
  const before = r.score;
  r.score = Math.max(0, r.score - WRONG_PENALTY);
  r.combo = 0; r.wrongs++; r.life--;
  const events = [];
  if (r.life <= 0) finish(r, 'life', events);
  return { kind: 'wrong', ch: h.ch, gained: r.score - before, ended: r.done };
}
