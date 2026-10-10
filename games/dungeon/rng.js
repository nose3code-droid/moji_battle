// 乱数：同じシードなら同じ列になる（地形・敵の配置・戦闘のダメージ揺れをすべてこれで決める）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 複数の整数を混ぜて 1 つのシードにする
export function hashSeed(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1)); // a〜b の整数
export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
