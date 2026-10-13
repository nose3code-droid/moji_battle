// ターン制の自動戦闘の中身（DOM に触らない）。行動の結果はイベントの列で返し、演出は main.js が担当する
import { ELEMENTS } from './parts.js';

const DMG_K = 0.62;        // ダメージ全体の大きさ
const SPECIAL_COST = 3;    // 必殺に必要なゲージ
const EFFECTIVE = 1.35, RESISTED = 0.75;   // 属性の相性

export const TECHS = {
  punchR: { name: 'パンチ', slot: 'rarm' },
  punchL: { name: 'パンチ', slot: 'larm' },
  kick:   { name: 'キック', slot: 'legs' },
  head:   { name: '頭突き', slot: 'head' },
  special: { name: '必殺', slot: 'body' },
};
const SPECIAL_NAMES = {
  fire: 'ファイアブロー', water: 'ウォーターブレイク', wood: 'ウッドクラッシュ', metal: 'メタルブレード', earth: 'ロックバスター', none: 'メガインパクト',
};

export function createBattle(player, enemy) {
  const mk = (side, r) => ({
    side, name: r.name, robo: r, stats: r.stats, maxHp: r.stats.hp, hp: r.stats.hp, gauge: 0, element: r.element,
  });
  return { p: mk('p', player), e: mk('e', enemy), round: 0, queue: [], turns: 0, over: null };
}

const other = (b, f) => f.side === 'p' ? b.e : b.p;

// 属性の倍率：攻撃した部品の属性 vs 相手の胴の属性
export function elementFactor(atkEl, defEl) {
  if (!atkEl || !defEl) return 1;
  if (ELEMENTS[atkEl].beats === defEl) return EFFECTIVE;
  if (ELEMENTS[defEl].beats === atkEl) return RESISTED;
  return 1;
}

// 技の性能（倍率・命中補正・属性）。技は部品の素の値から決まる
export function techInfo(f, tech) {
  const parts = f.robo.parts;
  switch (tech) {
    case 'punchR': case 'punchL': {
      const p = parts[TECHS[tech].slot];
      return { mult: 1 + (p.raw.atk - 50) / 200, hit: 0, element: p.element };
    }
    case 'kick': {
      const p = parts.legs;
      return { mult: .85 + p.raw.atk / 300, hit: .04, element: p.element };
    }
    case 'head': {
      const p = parts.head;
      return { mult: 1.35 + p.raw.atk / 400, hit: -.12, element: p.element, recoil: .04 };
    }
    default: {
      const arms = parts.rarm.raw.atk + parts.larm.raw.atk;
      return { mult: 2 + arms / 400, hit: 99, element: parts.body.element };   // 必殺は外れない
    }
  }
}

export const specialName = f => SPECIAL_NAMES[f.robo.parts.body.element || 'none'];

const hitChance = (a, d, info) => Math.min(.98, Math.max(.55, .9 + (a.stats.aim - d.stats.spd) * .003 + info.hit));
const randIn = (lo, hi) => lo + Math.random() * (hi - lo);

// 技の選び方：「判断」が高いほど、期待ダメージの大きい技を選ぶ（低いと気まぐれ）
function chooseTech(b, a) {
  const d = other(b, a);
  if (a.gauge >= SPECIAL_COST) return 'special';
  const witN = Math.min(1, a.stats.wit / 100);
  let best = null, bestScore = -1;
  for (const t of ['punchR', 'punchL', 'kick', 'head']) {
    const info = techInfo(a, t);
    const exp = info.mult * hitChance(a, d, info) * elementFactor(info.element, d.element) * (1 - (info.recoil || 0) * 3);
    const score = exp * (1 + randIn(-1, 1) * (1.1 - witN) * .8);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

// 次に動く側。ラウンドの始めに 素早さ順（少しの運つき）で並べる
function nextActor(b) {
  if (!b.queue.length) {
    b.round++;
    const sp = f => f.stats.spd * randIn(.9, 1.1);
    b.queue = [b.p, b.e].map(f => ({ f, s: sp(f) })).sort((x, y) => y.s - x.s).map(o => o.f);
  }
  return b.queue.shift();
}

// 1回の行動。イベントの列を返す
export function step(b) {
  if (b.over) return [];
  const a = nextActor(b), d = other(b, a);
  b.turns++;
  const tech = chooseTech(b, a), info = techInfo(a, tech);
  const label = tech === 'special' ? specialName(a) : TECHS[tech].name;
  const ev = [{ type: 'act', who: a.side, tech, text: tech === 'special' ? `${a.name}の 必殺「${label}」！` : `${a.name}の ${label}！` }];
  if (tech === 'special') a.gauge -= SPECIAL_COST;
  a.gauge += 1;
  if (Math.random() > hitChance(a, d, info)) {
    ev.push({ type: 'miss', who: a.side, text: `${d.name}は ひらりと かわした！` });
    return ev;
  }
  const crit = Math.random() < .04 + a.stats.wit * .001;
  const eff = elementFactor(info.element, d.element);
  let dmg = a.stats.atk * info.mult * DMG_K * 80 / (80 + d.stats.def) * eff * randIn(.9, 1.1) * (crit ? 1.5 : 1);
  dmg = Math.min(d.hp, Math.max(1, Math.round(dmg)));
  d.hp -= dmg;
  d.gauge += 1;
  ev.push({ type: 'hit', who: a.side, target: d.side, dmg, crit, eff, hp: d.hp,
    text: `${dmg} ダメージ！${crit ? ' 会心の一撃！' : ''}${eff > 1 ? ' こうかは ばつぐんだ！' : eff < 1 ? ' いまひとつ…' : ''}` });
  if (info.recoil && d.hp > 0) {
    const r = Math.max(1, Math.round(a.maxHp * info.recoil));
    a.hp = Math.max(1, a.hp - r);
    ev.push({ type: 'recoil', who: a.side, dmg: r, hp: a.hp, text: `${a.name}も ${r} ダメージを うけた` });
  }
  if (d.hp <= 0) { b.over = a.side; ev.push({ type: 'ko', who: d.side, text: `${d.name}は うごかなくなった！` }); }
  return ev;
}

// 演出なしで最後まで進める（スキップ・検証用）
export function runAll(b) {
  const log = [];
  let guard = 0;
  while (!b.over && guard++ < 400) log.push(...step(b));
  return log;
}
