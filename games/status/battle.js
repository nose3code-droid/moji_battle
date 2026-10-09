// ターン制バトルの中身（DOM に触らない）。行動の結果はイベントの列で返し、演出は main.js が担当する
import { SPECIALS } from './stats.js';

const SPECIAL_WAIT = 3;   // 特技を使ったあと、また使えるまでの自分のターン数
const CRIT_RATE = 0.06;   // 通常攻撃の会心率

export function createBattle(playerChars, enemyChars) {
  const mk = (side, c, idx) => ({
    id: `${side}${idx}`, side, idx, ch: c.ch, char: c,
    maxHp: c.stats.hp, hp: c.stats.hp,
    guard: false,   // ぼうぎょ中（自分の次のターンまで）
    shell: 0,       // まるまり の守り強化が残っているターン数
    cd: 2,          // 特技が使えるまでのターン数（0 で使える）
    chips: [],      // 欠けた跡（演出用）
  });
  const units = [...playerChars.map((c, i) => mk('p', c, i)), ...enemyChars.map((c, i) => mk('e', c, i))];
  return { units, queue: [], round: 0, turns: 0 };
}

export const alive = (b, side) => b.units.filter(u => u.hp > 0 && (!side || u.side === side));
export const unit = (b, id) => b.units.find(u => u.id === id);
const foes = (b, u) => alive(b, u.side === 'p' ? 'e' : 'p');

// 勝敗：'p' / 'e' / null（まだ続く）
export function winner(b) {
  if (!alive(b, 'e').length) return 'p';
  if (!alive(b, 'p').length) return 'e';
  return null;
}

// 次に動くキャラ。ラウンドの始めに すばやさ順で並べる（同じなら味方→敵、左から）
export function nextActor(b) {
  if (winner(b)) return null;
  for (;;) {
    if (!b.queue.length) {
      b.round++;
      b.queue = alive(b).slice().sort((x, y) =>
        y.char.stats.spd - x.char.stats.spd || (x.side === y.side ? x.idx - y.idx : x.side === 'p' ? -1 : 1)).map(u => u.id);
    }
    const u = unit(b, b.queue.shift());
    if (u.hp > 0) {
      // 自分のターンが来たら ぼうぎょ は解け、特技のチャージが進む
      u.guard = false;
      if (u.cd > 0) u.cd--;
      if (u.shell > 0) u.shell--;
      b.turns++;
      return u;
    }
  }
}

export const specialReady = u => u.cd === 0;
// 特技に相手を選ぶ必要があるか
export const specialNeedsTarget = u => !['all', 'heal'].includes(SPECIALS[u.char.special].kind);

function defense(u) { return u.char.stats.def * (u.shell > 0 ? 1.5 : 1); }

// ダメージ計算。A は攻撃側の力、power は技の倍率
function hit(b, from, to, A, power, { ignoreDef = false, critRate = CRIT_RATE } = {}) {
  const D = ignoreDef ? defense(to) * 0.2 : defense(to);
  const crit = Math.random() < critRate;
  let dmg = A * power * 60 / (60 + D) * 0.9 * (0.9 + Math.random() * 0.2);
  if (crit) dmg *= 1.5;
  if (to.guard) dmg *= 0.5;
  dmg = Math.max(1, Math.round(dmg));
  dmg = Math.min(dmg, to.hp);
  to.hp -= dmg;
  const ev = [{ type: 'hit', from: from.id, to: to.id, dmg, crit, guarded: to.guard }];
  if (to.hp <= 0) ev.push({ type: 'ko', who: to.id, text: `「${to.ch}」は くずれおちた！` });
  return ev;
}

const randomOf = list => list[Math.floor(Math.random() * list.length)];

// 行動する。action: 'attack' | 'guard' | 'special'。戻り値はイベントの列（text があるものはログに出す）
export function act(b, u, action, targetId) {
  const ev = [];
  let target = targetId && unit(b, targetId);
  if (!target || target.hp <= 0) target = randomOf(foes(b, u));
  const st = u.char.stats;

  if (action === 'guard') {
    u.guard = true;
    const heal = Math.min(u.maxHp - u.hp, Math.round(u.maxHp * 0.05));
    u.hp += heal;
    ev.push({ type: 'guard', who: u.id, text: `「${u.ch}」は みをまもっている` });
    if (heal) ev.push({ type: 'heal', who: u.id, amount: heal });
    return ev;
  }

  if (action === 'attack' || !specialReady(u)) {
    ev.push({ type: 'move', who: u.id, to: target.id, text: `「${u.ch}」の こうげき！` });
    ev.push(...hit(b, u, target, st.atk, 1));
    return ev;
  }

  // 特技：とくしゅ の値が効く
  const sp = SPECIALS[u.char.special];
  const A = st.atk * 0.5 + st.sp * 0.8;
  u.cd = SPECIAL_WAIT + 1;   // 次の自分のターン開始で 1 減るので +1
  ev.push({ type: 'special', who: u.id, to: target.id, text: `「${u.ch}」の ${sp.name}！` });
  switch (sp.kind) {
    case 'all':
      for (const t of foes(b, u)) ev.push(...hit(b, u, t, A, sp.power));
      break;
    case 'pierce':
      ev.push(...hit(b, u, target, A, sp.power, { ignoreDef: true }));
      break;
    case 'multi': {
      const n = Math.min(4, Math.max(2, u.char.shape.parts));
      for (let i = 0; i < n; i++) {
        if (target.hp <= 0) target = randomOf(foes(b, u));
        if (!target) break;
        ev.push(...hit(b, u, target, A, sp.power));
      }
      ev.push({ type: 'note', text: `${n}回 こうげきした！` });
      break;
    }
    case 'drain': {
      const hits = hit(b, u, target, A, sp.power * (1 + 0.1 * u.char.shape.holes));
      ev.push(...hits);
      const heal = Math.min(u.maxHp - u.hp, Math.round(hits[0].dmg * 0.5));
      u.hp += heal;
      if (heal) ev.push({ type: 'heal', who: u.id, amount: heal, text: `「${u.ch}」は HPを ${heal} すいとった` });
      break;
    }
    case 'heal': {
      const heal = Math.min(u.maxHp - u.hp, Math.round(u.maxHp * (sp.power + st.sp / 400)));
      u.hp += heal;
      u.shell = 3;
      u.chips.length = Math.floor(u.chips.length / 2);   // 欠けた跡も少し直る
      ev.push({ type: 'heal', who: u.id, amount: heal, text: `「${u.ch}」は まるくなって HPが ${heal} かいふく！ ぼうぎょが あがった` });
      break;
    }
    case 'crit':
      ev.push(...hit(b, u, target, A, sp.power, { critRate: 0.5 }));
      break;
  }
  return ev;
}

// CPU の行動選び
export function cpuChoose(b, u) {
  const targets = foes(b, u);
  // HP の少ない相手を狙いやすい
  const weakest = targets.slice().sort((x, y) => x.hp - y.hp)[0];
  const target = Math.random() < 0.6 ? weakest : randomOf(targets);
  const kind = SPECIALS[u.char.special].kind;
  if (specialReady(u)) {
    if (kind === 'heal') { if (u.hp < u.maxHp * 0.6) return { action: 'special' }; }
    else if (Math.random() < 0.7) return { action: 'special', target: target.id };
  }
  if (u.hp < u.maxHp * 0.35 && Math.random() < 0.3) return { action: 'guard' };
  return { action: 'attack', target: target.id };
}
