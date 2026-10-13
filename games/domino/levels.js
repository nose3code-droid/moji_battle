// 全15面の定義。座標は m（x 右、y 上）。左の棒（キッカー）が最初の置き場の字を押して、右の鐘まで連鎖させる
// segs：地面。[x0, x1, 高さ] は平ら、[x0, x1, 左の高さ, 右の高さ] は坂。segs に無い所は穴（落ちたら消える）
// slots：札を置ける場所。kind 省略は字（足の高さが y）。'plank' | 'spring' | 'ball' | 'balloon' は道具専用
// fixed：最初から立っている字（動かせない障害物）
// hand：持ち札（字はそのまま、道具は '@ball' '@plank' '@spring' '@balloon'）
// 解（SOLUTIONS）は tools/solve.mjs が全探索で作る。面を変えたら必ず作り直す
export const WORLD_H = 6;

export function build({ name, W = 14, segs, slots, bell, hand, note, fixed = [], kick = [2.4, 1.4] }) {   // kick が null の面は棒なし（ボールなどで始まる）
  const boxes = [], polys = [];
  for (const s of segs) {
    if (s.length === 3) boxes.push([s[0], 0, s[1], s[2]]);
    else polys.push([[s[0], 0], [s[0], s[2]], [s[1], s[3]], [s[1], 0]]);
  }
  const groundAt = x => {
    const f = segs.find(s => x >= s[0] && x <= s[1]);
    return f.length === 3 ? f[2] : f[2] + (f[3] - f[2]) * (x - f[0]) / (f[1] - f[0]);
  };
  const sl = slots.map(x => typeof x === 'number' ? { x } : x).map(s => s.y === undefined ? { ...s, y: groundAt(s.x) } : s);
  const first = sl.find(s => !s.kind);
  const kx = first.x + 0.05 - 0.25 - (kick ? kick[1] : 0);
  return {
    name, W, H: WORLD_H, boxes, polys, segs, note,
    kick: kick && { x: kx, y: groundAt(first.x) + 0.5, w: 0.5, h: 0.14, v: kick[0], stroke: kick[1] },
    bell: { x: bell, y: groundAt(bell) + 0.6 }, slots: sl, hand,
    fixed: fixed.map(f => ({ ...f, y: groundAt(f.x) })),
  };
}

export const LEVELS = [
  build({ name: 'はじめの一歩', segs: [[0, 14, 1]], slots: [3.4, 4.4, 5.4], bell: 6.3, hand: ['｜', 'I', '口', '｜'],
    note: '細長い字は、すこしの力でもパタンと倒れて、遠くまで届く' }),
  build({ name: 'すき間をこえる', segs: [[0, 14, 1]], slots: [3.4, 4.3, 5.2, 6.1], bell: 7.0, hand: ['｜', 'I', '口', '日', 'I'],
    note: '字ごとに、倒れて届く長さがちがう' }),
  build({ name: 'ころがる字', segs: [[0, 6, 1.8], [6, 10, 1.8, 1], [10, 14, 1]], slots: [3.4, 10.6, 11.6], bell: 12.7, hand: ['〇', 'O', '口', '｜', '｜'],
    note: '丸い字は立っていられない。坂を転がって、次の字を倒す（鐘を鳴らすのは倒れる字）' }),
  build({ name: '風船でそっと', segs: [[0, 14, 1]], slots: [3.4, 4.4, { x: 5.6, y: 1.8, kind: 'balloon', v: 2.4 }, 8.4, 9.4], bell: 10.6, hand: ['｜', 'I', '@balloon', '口', '｜'],
    note: '風船はスタートでふわっと流れ出して、背の高い字のてっぺんを押す' }),
  build({ name: '長い道', segs: [[0, 14, 1]], slots: [3.4, 3.9, 4.4, 4.9, 5.4, 5.9, 6.4, 6.9, 7.4], bell: 8.6, hand: ['｜', '｜', '｜', 'I', 'I', '口'],
    note: '置き場がこまかい。少ない字で鐘まで届かせると、星が増える' }),
  build({ name: 'ひろい谷', segs: [[0, 6.9, 1], [8.1, 14, 1]], slots: [3.5, 4.5, 5.5, 6.5, { x: 7.5, y: 0.94, kind: 'plank', len: 1.8 }, { x: 7.5, y: 1 }, 8.5], bell: 9.7, hand: ['｜', '｜', '｜', '｜', '｜', 'I', '口', '@plank'],
    note: '板で谷に橋をかければ、字を立てられる' }),
  build({ name: 'どっしり押す', segs: [[0, 14, 1]], slots: [3.4, 4.4, { x: 5.6, kind: 'ball' }, 8.0, 9.0], bell: 10.2, hand: ['口', '日', '｜', 'I', '@ball', '｜'],
    note: '四角い字は倒れないけれど、重くて押す力が強い。ボールを動かせるのは、軽い字には無理' }),
  build({ name: 'ころがって、つづく', segs: [[0, 5, 1.8], [5, 8, 1.8, 1], [8, 14, 1]], slots: [3.4, 9.2, 10.2, 11.0], bell: 12.1, hand: ['〇', 'O', '｜', '｜', 'I', '口'] }),
  build({ name: 'バネでジャンプ', kick: null, segs: [[0, 3, 4.2], [3, 6, 4.2, 1], [6, 7.9, 1], [9.2, 14, 1]],
    slots: [{ x: 3.5, y: 3.2, cy: 4.105, kind: 'ball' }, { x: 7.0, y: 1, kind: 'spring', angle: 0.5 }, 10.4, 11.3], bell: 12.3, hand: ['@ball', '@spring', '｜', '｜', 'I', '口'],
    note: 'ボールが坂をくだる。谷はバネで跳びこえよう' }),
  build({ name: 'こまかい道', segs: [[0, 14, 1]], slots: [3.4, 3.9, 4.4, 4.9, 5.4, 5.9, 6.4, 6.9, 7.4], bell: 8.2, hand: ['｜', '｜', 'I', 'I', '日', '人'] }),
  build({ name: '坂のあとの谷', segs: [[0, 5, 1.8], [5, 8, 1.8, 1], [8, 9.9, 1], [11.1, 14, 1]], slots: [3.4, 8.7, { x: 10.5, y: 0.94, kind: 'plank', len: 1.8 }, { x: 10.5, y: 1 }, 11.6], bell: 12.8, hand: ['〇', '｜', '｜', 'I', '口', '@plank', 'O'] }),
  build({ name: 'ボールの先に', segs: [[0, 14, 1]], slots: [3.4, 4.4, { x: 5.6, kind: 'ball' }, 7.8, 8.6, 9.6], bell: 10.8, hand: ['口', '日', '｜', '｜', 'I', '@ball', '人'] }),
  build({ name: 'ボールと板', segs: [[0, 6.9, 1], [8.1, 14, 1]], slots: [3.4, 4.4, { x: 5.5, kind: 'ball' }, { x: 7.5, y: 0.94, kind: 'plank', len: 1.8 }, 9.0, 10.0], bell: 11.2, hand: ['口', '日', '｜', '｜', 'I', '@ball', '@plank', '人'] }),
  build({ name: 'ぎゅっと長い道', segs: [[0, 14, 1]], slots: [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0], bell: 7.9, hand: ['｜', '｜', '｜', 'I', 'I', 'I', '口'] }),
  build({ name: 'さいごの鐘', segs: [[0, 14, 1]], slots: [3.4, 4.4, { x: 5.6, kind: 'ball' }, 8.0, 9.0, 10.0], bell: 11.2, hand: ['口', '日', '｜', 'I', '@ball', '｜', '人', 'ハ'] }),
];
