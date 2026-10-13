// 文字つり：字の形 → 性格、そして「やりとり」の計算。DOM にも描画にも触れない（ブラウザでも node でも動く）
const clamp01 = x => Math.max(0, Math.min(1, x));

// 目もり（テンション 0〜1）がこの帯に入っているあいだだけ、巻いた分だけ字をよせられる
export const BAND = { lo: 0.38, hi: 0.66 };

// 全部の字の形指標 { ch: { ink 面積, per 周長, round 丸さ } } から、性格 { ch: { power, thrash, nimble } }（各0〜1）を出す。
// 他の字との比べっこ（10〜90パーセンタイルで正規化）なので、フォントが違っても差がつく。決定的（乱数なし）
export function deriveTraits(raw) {
  const list = Object.entries(raw);
  const norm = fn => {
    const v = list.map(([, m]) => fn(m)).sort((a, b) => a - b);
    const lo = v[Math.floor(v.length * 0.1)], hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.9))];
    return m => clamp01((fn(m) - lo) / ((hi - lo) || 1));
  };
  const nInk = norm(m => m.ink), nPer = norm(m => m.per), nRound = norm(m => m.round), nRag = norm(m => m.per / Math.sqrt(m.ink));
  const out = {};
  for (const [ch, m] of list) {
    out[ch] = {
      power: 0.5 * nInk(m) + 0.5 * nPer(m),                       // 大きくて画数が多い → 引きが強い
      thrash: 0.6 * (1 - nRound(m)) + 0.4 * nRag(m),              // 角ばっていて複雑 → 暴れる
      nimble: 0.65 * nRound(m) + 0.35 * (1 - nInk(m)),            // 丸くて軽い → すばしこい
    };
  }
  return out;
}

export function personality(t) {
  const { power: p, thrash: b, nimble: n } = t;
  if (p >= 0.62 && b >= 0.62) return { name: 'ごうわん型', text: '大きくて角ばった荒くれ者。強く引き、急に暴れる。' };
  if (p >= 0.62) return { name: 'ずっしり型', text: '大きくて画数が多く、引きが強い。長いやりとりになる。' };
  if (b >= 0.62) return { name: 'あばれ型', text: '角ばった形。ふだんは静かだが、急にぐんと暴れる。' };
  if (n >= 0.62 && p < 0.45) return { name: 'するり型', text: '丸くて軽い。力は弱いが、巻くのをさぼるとするりと逃げる。' };
  if (n >= 0.62) return { name: 'すばしこい型', text: 'すばやく、逃げ足が速い。' };
  if (p < 0.35 && b < 0.4) return { name: 'おとなしい型', text: '小さくて素直。落ち着いて巻けば、まず釣れる。' };
  return { name: 'ふつう型', text: 'クセのない、ふつうの引き。' };
}

// アタリの受付時間（秒）：すばしこい字ほど短い
export const strikeWindow = t => 1.15 - 0.5 * t.nimble;

// やりとりを始める。D: 字までのきょり（0になれば釣れる）
export function createFight(tr, rnd = Math.random) {
  const D0 = 28 + 40 * tr.power;
  return {
    tr, rnd, t: 0, T: 0.5, D: D0, D0, slack: 0, slackMax: 2.6 - 1.3 * tr.nimble,
    phase: rnd() * 6.28, nextBurst: 1.2 + rnd() * 1.2, tell: 0, burst: 0, burstRate: 0, result: null,
  };
}

const REEL_UP = 0.95, REEL_DOWN = 0.8;   // 巻くと目もりが上がり、放すと下がる（1秒あたり）

// 1ステップ進める。reeling: 巻いているか。終わると f.result が 'win'（釣れた） / 'snap'（糸が切れた） / 'escape'（逃げられた）
export function stepFight(f, dt, reeling) {
  if (f.result) return f.result;
  const tr = f.tr;
  f.t += dt;
  const tired = 0.55 + 0.45 * (f.D / f.D0);                       // 字が弱るほど暴れも小さくなる
  // 左右にぶれる（常にゆらゆら）
  const freq = 0.9 + 0.9 * tr.thrash;
  const wob = (0.25 + 0.9 * tr.thrash) * tired * Math.sin(f.t * freq * 6.283 + f.phase);
  // 急なひと引き：予告（ぶるっ）→ 0.3 秒の急変。上＝ぐんと引く、下＝こちらへ突進して糸がゆるむ
  let br = 0;
  if (f.burst > 0) { f.burst -= dt; br = f.burstRate; }
  else if (f.tell > 0) {
    f.tell -= dt;
    if (f.tell <= 0) {
      const mag = (0.16 + 0.32 * tr.thrash) * (0.7 + 0.3 * tr.power) * tired;
      f.burstRate = (f.rnd() < 0.62 ? 1 : -1) * mag / 0.3;
      f.burst = 0.3;
    }
  } else {
    f.nextBurst -= dt;
    if (f.nextBurst <= 0) { f.tell = 0.4; f.nextBurst = (2.6 - 1.4 * tr.thrash) * (0.7 + 0.6 * f.rnd()); }
  }
  f.T += ((reeling ? REEL_UP : -REEL_DOWN) + wob + br) * dt;
  if (f.T >= 1) { f.T = 1; return (f.result = 'snap'); }
  f.T = Math.max(0, f.T);

  const inBand = f.T >= BAND.lo && f.T <= BAND.hi;
  if (reeling && inBand) f.D -= 22 * (1 - 0.25 * tr.power) * dt;      // 帯の中で巻く＝よってくる
  if (f.T < BAND.lo) {                                                 // ゆるみ：字がきょりをかせぎ、針が外れそうになる
    f.slack += dt;
    f.D += (0.5 + 1.2 * tr.nimble) * 8 * dt;
  } else f.slack = Math.max(0, f.slack - 1.5 * dt);
  if (f.D <= 0) { f.D = 0; return (f.result = 'win'); }
  if (f.slack > f.slackMax || f.D > f.D0 * 1.3) return (f.result = 'escape');
  return null;
}

// 動作確認用：単純なプレイヤー（目もりの目標値に向けて巻く／放す。反応おくれつき。aware=true なら「ぶるっ」の予告を見て力をぬく）で1回やりとりして結果を返す
export function botFight(tr, { target = 0.52, delay = 0.18, aware = true, rnd = Math.random } = {}) {
  const f = createFight(tr, rnd), dt = 1 / 60, q = [];
  let reeling = false;
  while (!f.result && f.t < 90) {
    q.push(f.T < (aware && (f.tell > 0 || f.burst > 0) ? target - 0.12 : target));
    if (q.length > Math.round(delay / dt)) reeling = q.shift();
    stepFight(f, dt, reeling);
  }
  return { result: f.result || 'timeout', time: f.t };
}
