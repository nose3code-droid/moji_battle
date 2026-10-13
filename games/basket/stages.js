// 文字バスケット：ステージ定義（単位はメートル、y 上向き、地面が y = 0）
export const WORLD_L = -0.6, WORLD_R = 12.0;   // 画面に映る横の範囲（右は壁）
export const LAUNCH = { x: 1.3, y: 1.25 };      // 字を撃ち出す位置

// ring: 輪の中心(x,y)・内側の半幅 r・動き（move: 振幅 ax, ay と周期 sec）。ボードは輪の右側につく
export const STAGES = [
  { name: 'ハイリング', note: '高い位置のリング',
    rings: [{ x: 9.2, y: 4.3, r: 0.6 }], walls: [] },
  { name: 'ムービング', note: 'リングが上下に動く',
    rings: [{ x: 9.4, y: 3.7, r: 0.6, move: { ax: 0, ay: 0.9, sec: 6 } }], walls: [] },
  { name: 'ミニリング', note: 'リングが小さい',
    rings: [{ x: 9.0, y: 3.4, r: 0.45 }], walls: [] },
  { name: 'かべ', note: '壁を越えて入れる',
    rings: [{ x: 9.6, y: 3.3, r: 0.6 }], walls: [{ x: 5.4, y: 0, w: 0.35, h: 4.2 }] },
  { name: 'ダブル', note: 'リングが2つ（奥は+1点）',
    rings: [{ x: 6.4, y: 2.7, r: 0.58 }, { x: 10.4, y: 4.9, r: 0.58, bonus: 1 }], walls: [] },
];

// ステップ数 n のときの輪の中心（動くリングは固定刻みの経過ステップだけで決まる）
export function ringPos(ring, n) {
  if (!ring.move) return { x: ring.x, y: ring.y };
  const s = sinTurn(n / (ring.move.sec * 60));
  return { x: ring.x + ring.move.ax * s, y: ring.y + ring.move.ay * s };
}

// sin(2π·t)。Math.sin は環境で末尾の桁が違いうるので、四則演算だけで計算する（テイラー展開）
export function sinTurn(t) {
  t -= Math.floor(t + 0.5);          // -0.5〜0.5 周
  const x = t * 6.283185307179586;   // -π〜π
  let term = x, sum = x;
  for (let n = 1; n < 14; n++) { term *= -x * x / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
