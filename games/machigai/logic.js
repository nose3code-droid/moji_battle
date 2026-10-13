// まちがい字さがし：盤の作り方・面の設定（画面に依存しない部分）

export const ROUNDS = 3;        // ステージ1面あたりの盤の数
export const STAGE_COUNT = 20;  // ステージ数
export const TA_TIME = 60;      // タイムアタックの制限時間（秒）
export const TA_FIND = 3;       // 見つけたときの回復（秒）
export const TA_MISS = 5;       // まちがえたときの減少（秒）
export const HINT_COST = 50;    // ヒントを使うと減る点

// 乱数（同じシードなら同じ盤。テストで再現できる）
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 盤の一辺のマス数：3 → 4 → … → 最大10
export const sizeFor = k => Math.min(10, 3 + k);
// ステージ k（0〜19）の盤の一辺
export const stageSize = k => Math.min(10, 3 + Math.round(k * 7 / (STAGE_COUNT - 1)));

// 進み具合 p（0〜1）で出してよいむずかしさ
export function levelsFor(p) {
  if (p < 0.25) return [1];
  if (p < 0.5) return [1, 2];
  if (p < 0.75) return [2, 3];
  return [2, 3];
}
// タイムアタックの進み具合は、14問で最大
export const taProgress = k => Math.min(1, k / 14);
export const stageProgress = k => k / (STAGE_COUNT - 1);

// ペアを選ぶ（直近に出したものは避ける）
export function pickPair(pairs, p, rng, recent = []) {
  const lvs = levelsFor(p);
  let pool = pairs.filter(x => lvs.includes(x.lv) && !recent.includes(x.id));
  if (!pool.length) pool = pairs.filter(x => lvs.includes(x.lv));
  return pool[Math.floor(rng() * pool.length)];
}

// 盤を作る。n×n のマスに、基準の字を並べ、1つだけ似た字にする
// 見た目のゆれ（太さ・傾き・位置・大きさ・色）は、正解のマスにも同じ幅でかける
export function buildBoard(pair, n, rng) {
  const flip = rng() < 0.5;
  const base = flip ? pair.b : pair.a, odd = flip ? pair.a : pair.b;
  const oddIndex = Math.floor(rng() * n * n);
  const hue = Math.floor(rng() * 360);                 // 盤ごとの基本の色
  const baseW = -0.004 + rng() * 0.016;                // 盤ごとの基本の太さ（em）
  const cells = [];
  for (let i = 0; i < n * n; i++) {
    cells.push({
      ch: i === oddIndex ? odd : base,
      dx: (rng() - 0.5) * 0.06, dy: (rng() - 0.5) * 0.06,
      rot: (rng() - 0.5) * 0.28,                       // ±8度ほど（ラジアン）
      sc: 0.95 + rng() * 0.1,
      w: baseW + (rng() - 0.5) * 0.012,
      dh: (rng() - 0.5) * 20, dl: (rng() - 0.5) * 12,
    });
  }
  return { n, pair, base, odd, oddIndex, hue, cells };
}

// ステージの星：ミス（ヒントも1回につき1ミス）0回で★3、2回までで★2、それ以上は★1
export const starsFor = misses => (misses === 0 ? 3 : misses <= 2 ? 2 : 1);
