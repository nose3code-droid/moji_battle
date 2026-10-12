// コース定義。座標は左上が原点で y は下向き。
// outline: フェアウェイの外周（跳ね返る壁）／ walls: 中にある壁の多角形／ zones: slope(坂)・sand(砂)・water(水たまり)
// movers: 動くしかけ ／ warps: 一方通行のワープ ／ tee: スタート ／ cup: カップ ／ par: 目標打数
// コースや物理を変えたらこの番号を上げる（ベストスコアの保存先が別になる）
export const COURSE_ID = 'standard-v1';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export const HOLES = [
  {
    name: 'まっすぐ', hint: 'まずは直線。引く強さがカギ',
    par: 2, tee: { x: 120, y: 570 }, cup: { x: 120, y: 80 },
    outline: rect(0, 0, 240, 640),
  },
  {
    name: 'L字', hint: '角を曲がってカップへ。壁を使おう',
    par: 3, tee: { x: 85, y: 510 }, cup: { x: 385, y: 85 },
    outline: [[0, 0], [450, 0], [450, 170], [170, 170], [170, 580], [0, 580]],
  },
  {
    name: '坂', hint: '矢印の方向へ転がされる。丸い字ほど流される',
    par: 3, tee: { x: 235, y: 580 }, cup: { x: 70, y: 90 },
    outline: rect(0, 0, 300, 640),
    zones: [
      { type: 'slope', x: 0, y: 230, w: 300, h: 190, ax: 240, ay: 0 },
      { type: 'slope', x: 0, y: 30, w: 300, h: 130, ax: 0, ay: 120 },
    ],
  },
  {
    name: '砂場', hint: '砂は強く減速する。右のすき間は芝',
    par: 3, tee: { x: 160, y: 580 }, cup: { x: 160, y: 90 },
    outline: rect(0, 0, 320, 640),
    zones: [
      { type: 'sand', x: 0, y: 250, w: 230, h: 150 },
      { type: 'sand', x: 160, y: 90, r: 72 },
    ],
  },
  {
    name: '水たまり', hint: '落ちると1打罰で元の位置から',
    par: 3, tee: { x: 60, y: 580 }, cup: { x: 160, y: 90 },
    outline: rect(0, 0, 320, 640),
    zones: [
      { type: 'water', x: 0, y: 230, w: 110, h: 180 },
      { type: 'water', x: 210, y: 230, w: 110, h: 180 },
      { type: 'water', x: 0, y: 50, w: 100, h: 110 },
      { type: 'water', x: 220, y: 50, w: 100, h: 110 },
    ],
  },
  {
    name: '動くかべ', hint: '左右に動くかべのすき間をねらう',
    par: 3, tee: { x: 160, y: 580 }, cup: { x: 160, y: 80 },
    outline: rect(0, 0, 320, 640),
    movers: [
      { type: 'slider', x: 160, y: 400, w: 170, h: 22, dx: 1, dy: 0, amp: 80, period: 420, phase: 0 },
      { type: 'slider', x: 160, y: 240, w: 170, h: 22, dx: 1, dy: 0, amp: 80, period: 420, phase: Math.PI },
    ],
  },
  {
    name: '風車', hint: 'まわる羽根のタイミングをはかろう',
    par: 3, tee: { x: 180, y: 580 }, cup: { x: 180, y: 70 },
    outline: rect(0, 0, 360, 640),
    movers: [
      { type: 'windmill', x: 180, y: 320, len: 105, arms: 2, speed: 1.3, phase: 0.6, th: 5 },
    ],
  },
  {
    name: 'ワープ', hint: 'かべの向こうへはワープで。ダミーもあるよ',
    par: 3, tee: { x: 170, y: 580 }, cup: { x: 90, y: 80 },
    outline: rect(0, 0, 340, 640),
    walls: [rect(0, 300, 340, 18), rect(125, 120, 100, 16)],
    warps: [
      { from: { x: 80, y: 470 }, to: { x: 255, y: 210 }, r: 22 },
      { from: { x: 265, y: 450 }, to: { x: 265, y: 590 }, r: 22 },
    ],
  },
  {
    name: 'ぜんぶのせ', hint: '砂・坂・風車・水…ぜんぶ越えて最終ホール',
    par: 4, tee: { x: 200, y: 730 }, cup: { x: 200, y: 80 },
    outline: rect(0, 0, 400, 780),
    zones: [
      { type: 'sand', x: 0, y: 560, w: 250, h: 90 },
      { type: 'slope', x: 0, y: 400, w: 400, h: 130, ax: -200, ay: 0 },
      { type: 'water', x: 0, y: 30, w: 130, h: 170 },
      { type: 'water', x: 270, y: 30, w: 130, h: 170 },
    ],
    movers: [
      { type: 'windmill', x: 200, y: 290, len: 95, arms: 2, speed: -1.4, phase: 0, th: 5 },
    ],
  },
];

export function holeBounds(h) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of h.outline) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
