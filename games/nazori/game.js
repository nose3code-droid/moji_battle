// なぞり魔法：ゲームの中身（画面には依存しない）
import { RING, beats, ELEMS, BOSS_ORDER } from './stages.js';

export const MIN_ACC = 40;   // これ未満の精度は魔法が失敗する
export const WARD = 0.3;     // 結界：弱点以外の魔法では、体力がこの割合より下がらない
export const HEARTS = 5;

export function createGame(stage, rand = Math.random) {
  return {
    stage, rand, t: 0, state: 'play', hearts: HEARTS, score: 0, kills: 0,
    accSum: 0, castN: 0, monsters: [], events: [], nextId: 1,
    spawnIdx: 0, bossSpawned: false, addT: 0, addN: 0, usedElems: {},
  };
}

function addMonster(g, elem, opt = {}) {
  const s = g.stage;
  const hp = opt.boss ? s.bossHp : s.hp;
  const m = {
    id: g.nextId++, elem, hp, max: hp, boss: !!opt.boss, phase: 0,
    y: 0, baseX: opt.boss ? 0.5 : 0.12 + g.rand() * 0.76, ph: g.rand() * 6.28, px: 0.5,
    speed: 1 / (opt.boss ? s.bossCross : s.cross) * (opt.boss ? 1 : 0.9 + g.rand() * 0.25),
    dead: false, accSum: 0, accN: 0, flash: 0, lock: false,
  };
  g.monsters.push(m);
  g.events.push({ type: 'spawn', m });
  return m;
}

export function update(g, dt) {
  if (g.state !== 'play') return;
  g.t += dt;
  const s = g.stage;
  while (g.spawnIdx < s.spawns.length && g.t >= s.spawns[g.spawnIdx][0]) addMonster(g, s.spawns[g.spawnIdx++][1]);
  if (s.boss) {
    if (!g.bossSpawned && g.t >= 1) { g.bossSpawned = true; addMonster(g, BOSS_ORDER[0], { boss: true }); }
    if (g.bossSpawned && g.monsters.some(m => m.boss && !m.dead)) { // 大魔王が健在のあいだ、手下を送ってくる
      g.addT += dt;
      if (g.addT >= s.addGap) { g.addT = 0; addMonster(g, RING[(g.addN++ * 2 + 1) % 5]); }
    }
  }
  for (const m of g.monsters) {
    if (m.dead) continue;
    m.flash = Math.max(0, m.flash - dt);
    m.y += m.speed * dt;
    m.px = Math.min(0.92, Math.max(0.08, m.baseX + Math.sin(g.t * 1.1 + m.ph) * (m.boss ? 0.12 : 0.05)));
    if (m.y >= 1) { // 町に着いてしまった
      m.dead = true;
      g.hearts = m.boss ? 0 : g.hearts - 1;
      g.events.push({ type: 'leak', m });
    }
  }
  g.monsters = g.monsters.filter(m => !m.dead);
  if (g.hearts <= 0) { g.state = 'lose'; return; }
  const bossDone = !s.boss || (g.bossSpawned && !g.monsters.some(m => m.boss));
  if (g.spawnIdx >= s.spawns.length && g.monsters.length === 0 && bossDone && (!s.boss || g.bossSpawned)) g.state = 'win';
}

// 倍率：弱点 ×2、同じ属性・逆の相性 ×0.5、それ以外 ×1
export function multiplier(ch, target) {
  if (beats(ch, target)) return 2;
  if (ch === target || beats(target, ch)) return 0.5;
  return 1;
}

// 魔法を唱える。誰を狙うか・ダメージを決めるだけで、実際の反映は applyHit（弾が届いたとき）
export function castPlan(g, ch, acc) {
  g.castN++; g.accSum += acc;
  g.usedElems[ch] = (g.usedElems[ch] || 0) + 1;
  if (acc < MIN_ACC) return { fizzle: true, ch, acc };
  const live = g.monsters.filter(m => !m.dead);
  if (!live.length) return { fizzle: false, ch, acc, target: null, mult: 1, dmg: 0 };
  const weak = live.filter(m => beats(ch, m.elem));       // その属性が効く魔物を優先してねらう
  const pool = weak.length ? weak : live;
  const target = pool.reduce((a, b) => (b.y > a.y ? b : a));
  const mult = multiplier(ch, target.elem);
  const dmg = ELEMS[ch].power * Math.pow(acc / 100, 1.5) * mult;
  return { fizzle: false, ch, acc, target, mult, dmg };
}

export function applyHit(g, plan) {
  const m = plan.target;
  if (!m || m.dead) return { gone: true };
  m.accSum += plan.acc; m.accN++;
  m.flash = 0.25;
  const before = m.hp;
  if (plan.mult >= 2) m.hp -= plan.dmg;
  else m.hp = Math.min(m.hp, Math.max(m.hp - plan.dmg, m.max * WARD)); // 結界：弱点以外では倒しきれない
  m.lock = plan.mult < 2 && m.hp <= m.max * WARD + 0.01;
  const res = { dmg: before - m.hp, locked: m.lock && plan.mult < 2, mult: plan.mult };
  if (m.hp <= 0.001) {
    const avg = m.accSum / m.accN;
    if (m.boss && m.phase < BOSS_ORDER.length - 1) { // 殻をやぶった：次の属性をまとう
      m.phase++; m.elem = BOSS_ORDER[m.phase]; m.hp = m.max; m.lock = false;
      m.y = Math.max(0, m.y - 0.1);
      g.score += Math.round(avg * 10);
      m.accSum = 0; m.accN = 0;
      g.events.push({ type: 'phase', m });
      res.phase = true;
    } else {
      m.dead = true; g.kills++;
      g.score += Math.round(avg * 10) * (m.boss ? 5 : 1);
      g.events.push({ type: 'kill', m });
      res.kill = true;
    }
  }
  return res;
}

export function finalScore(g) { return g.score + (g.state === 'win' ? g.hearts * 100 : 0); }
export const avgAcc = g => (g.castN ? g.accSum / g.castN : 0);
