// コース定義。制御点（中心線）を滑らかな閉曲線にして、等間隔の点列に直す
// 座標は画面と同じ（x 右、y 下）。マシンの大きさは半径およそ 13〜17

const arc = (cx, cy, r, a0, a1, n) => {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
};

export const TRACKS = [
  {
    id: 'oval', name: 'やさしい楕円', desc: '広い道幅のなだらかなオーバル',
    halfW: 66, dirtW: 30,
    pts: [
      [-700, 330], [-300, 360], [150, 360], [550, 350],
      ...arc(600, 100, 250, 90, -90, 8).slice(1, -1),
      [550, -150], [250, -180], [-250, -170],
      [-650, -150], [-880, 0], [-860, 220],
    ],
  },
  {
    id: 'tech', name: 'テクニカル', desc: 'S字の続く曲がりくねったコース',
    halfW: 56, dirtW: 28,
    pts: [
      [-500, 380], [-100, 380], [300, 380], [680, 330], [880, 170], [740, -30],
      [540, -140], [340, -90], [150, 40], [-60, 90], [-280, 20], [-330, -150],
      [-190, -290], [60, -340], [300, -370], [520, -480], [520, -630], [380, -740],
      [100, -740], [-250, -650], [-560, -520], [-800, -330], [-860, -60], [-780, 200],
    ],
  },
  {
    id: 'champ', name: 'チャンピオンシップ', desc: 'ヘアピンもある本格コース',
    halfW: 50, dirtW: 28,
    pts: [
      [-640, 0], [-420, 0], [-200, 0], [20, 0], [240, 0], [420, 0],
      ...arc(420, 150, 150, -90, 90, 8).slice(1, -1),
      [420, 300], [240, 300], [60, 310], [-120, 370], [-240, 480], [-360, 590],
      [-560, 630], [-760, 560], [-850, 380], [-840, 190], [-790, 70],
    ],
  },
];

// 一様 Catmull-Rom（閉曲線）
function spline(pts, per) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  return out;
}

const DS = 8; // 点列の間隔（だいたい）

export function buildTrack(def) {
  const dense = spline(def.pts, 40);
  // 弧長で等間隔に取り直す
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[cum.length - 1];
  const N = Math.round(length / DS), ds = length / N;
  const x = new Float64Array(N), y = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const u = (s - cum[j]) / (cum[j + 1] - cum[j]);
    x[i] = a[0] + (b[0] - a[0]) * u; y[i] = a[1] + (b[1] - a[1]) * u;
  }
  const tx = new Float64Array(N), ty = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
  const th = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    const dx = x[b] - x[a], dy = y[b] - y[a], l = Math.hypot(dx, dy);
    tx[i] = dx / l; ty[i] = dy / l; nx[i] = -ty[i]; ny[i] = tx[i]; // n は進行方向に対して +h 側（回る向き）
    th[i] = Math.atan2(ty[i], tx[i]);
  }
  // 曲率（符号つき、n 側へ曲がるとき正）
  const kap = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let d = th[(i + 1) % N] - th[(i + N - 1) % N];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    kap[i] = d / (2 * ds);
  }
  const smooth = (src, r, fn) => {
    const o = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let acc = fn === 'max' ? 0 : 0;
      for (let k = -r; k <= r; k++) {
        const v = src[(i + k + N) % N];
        acc = fn === 'max' ? Math.max(acc, Math.abs(v)) : acc + v / (2 * r + 1);
      }
      o[i] = acc;
    }
    return o;
  };
  const kapS = smooth(smooth(kap, 3, 'avg'), 3, 'max');           // 速度計画用：|曲率| の先読み用
  const kapW = smooth(smooth(kap, 14, 'avg'), 6, 'avg');          // ライン取り用：広く平均
  const lineOff = new Float64Array(N);
  const maxOff = def.halfW * 0.5;
  for (let i = 0; i < N; i++) lineOff[i] = Math.max(-maxOff, Math.min(maxOff, kapW[i] * 3200)); // カーブの内側へ寄せる

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]); minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]); }
  const pad = def.halfW + def.dirtW + 40;
  return {
    id: def.id, name: def.name, desc: def.desc, halfW: def.halfW, dirtW: def.dirtW,
    wallPos: def.halfW + def.dirtW, kerbW: 9,
    N, ds, length, x, y, tx, ty, nx, ny, kap, kapS, lineOff,
    bbox: { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad },
  };
}
