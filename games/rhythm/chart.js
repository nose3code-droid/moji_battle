// 五属性リズム：レーン定義・譜面・会話のデータ

export const LANES = [
  { id: 'fire',    ch: '火', key: 'D', code: 'KeyD', name: '火の太鼓',   color: '#ff5a2a', light: '#ffb066', fall: 1.7,  gimmick: '連打' },
  { id: 'water',   ch: '水', key: 'F', code: 'KeyF', name: '水のハープ', color: '#3d8bff', light: '#9cc8ff', fall: 1.7,  gimmick: '長押し' },
  { id: 'thunder', ch: '雷', key: 'J', code: 'KeyJ', name: '雷のギター', color: '#ffe14d', light: '#fff7b0', fall: 0.62, gimmick: '瞬間' },
  { id: 'light',   ch: '光', key: 'K', code: 'KeyK', name: '光のフルート', color: '#ffe7a0', light: '#ffffff', fall: 1.7, gimmick: 'ガイド' },
  { id: 'dark',    ch: '闇', key: 'L', code: 'KeyL', name: '闇のベース', color: '#a24bff', light: '#d7a8ff', fall: 1.7,  gimmick: '隠れ' },
];

export const LEAD_BEATS = 4;   // 曲の頭のカウントイン（拍）
export const GRID = 2;         // 譜面文字列の1文字 = 1/GRID 拍（2 = 八分音符）

// 譜面の書き方：モチーフ（2小節 = 16文字）をレーンごとの文字列で持ち、order の順に並べる
//   火   : o = 単打、x = 連打ノーツ（burst の回数ぶん細かく叩く）
//   水   : 数字 = ロングノーツ（数字ぶんの文字数だけ押し続ける）
//   雷光闇: x = ノーツ
//   . = 休み
export const SONGS = [
  {
    id: 'easy', name: 'めざめの太鼓', level: 'やさしい', bpm: 92,
    burst: { n: 3, step: 0.5 },
    scale: [261.63, 293.66, 329.63, 392.0, 440.0],   // ド レ ミ ソ ラ
    bass: [65.41, 55.0, 87.31, 98.0],                 // C A F G
    motifs: {
      A: { fire: 'o...o...o.......', water: '..4.......4.....', thunder: '......x.......x.', light: '...x.......x....', dark: '............x...' },
      B: { fire: 'x.......o...o...', water: '4.......6.......', thunder: '....x...x...x...', light: '..x.....x.....x.', dark: '......x.......x.' },
      C: { fire: 'o.o.o.o.x.......', water: '..2...2.....4...', thunder: 'x.......x.x.....', light: '....x.x.....x.x.', dark: '...x.........x..' },
    },
    order: ['A', 'A', 'B', 'C', 'B', 'C', 'A', 'B'],
    talkBefore: [
      { who: '指', name: '指揮者', text: '音の消えた字の都……。まずは火の太鼓を叩いて、精霊を起こそう。' },
      { who: '火', name: '火の太鼓の精', text: 'ドン……ドン……。五つの音がそろわぬと、都は目を覚まさぬ。' },
      { who: '指', name: '指揮者', text: '降ってくる字に合わせて、D F J K L だ！　スマホは下のパッドをタップ！' },
    ],
    talkAfter: [
      { who: '水', name: '水のハープの精', text: 'ぽろん……。ふふ、少しだけ都に音が戻りましたね。' },
      { who: '指', name: '指揮者', text: 'この調子で、もっと大きな曲にいどもう！' },
    ],
  },
  {
    id: 'normal', name: 'かみなりのうた', level: 'ふつう', bpm: 112,
    burst: { n: 3, step: 0.5 },
    scale: [293.66, 329.63, 369.99, 440.0, 493.88],   // レ ミ ファ# ラ シ
    bass: [73.42, 98.0, 73.42, 110.0],                // D G D A
    motifs: {
      A: { fire: 'o.o.x...o.o.x...', water: '..4...4.....4...', thunder: 'x...x...x.x.x...', light: '....x...x...x.x.', dark: '.x...x.......x..' },
      B: { fire: 'x.......x.......', water: '2...2...4.....2.', thunder: '..x...x...x...x.', light: 'x...x...x...x...', dark: '.x...x...x...x..' },
      C: { fire: 'o.o.o.o.o.o.x...', water: '4.......4...4...', thunder: '..x...x...x.x.x.', light: '....x.x.x.x.....', dark: 'x.....x.....x...' },
    },
    order: ['A', 'A', 'B', 'C', 'B', 'C', 'A', 'B', 'C', 'A'],
    talkBefore: [
      { who: '雷', name: '雷のギターの精', text: 'ビリッ！　おれの音は一瞬で消えるぜ。見逃すなよ！' },
      { who: '光', name: '光のフルートの精', text: '私の音は、光の筋が先に教えてくれます。' },
      { who: '闇', name: '闇のベースの精', text: '……俺は、ぎりぎりまで姿を見せない。耳で数えろ。' },
    ],
    talkAfter: [
      { who: '闇', name: '闇のベースの精', text: '……悪くない。低い音が、都の底に響いた。' },
      { who: '指', name: '指揮者', text: '五つの音が少しずつ重なってきた。次が最後の曲だ！' },
    ],
  },
  {
    id: 'hard', name: '五つの音のうた', level: 'むずかしい', bpm: 128,
    burst: { n: 4, step: 0.25 },
    scale: [329.63, 392.0, 440.0, 493.88, 587.33],    // ミ ソ ラ シ レ
    bass: [82.41, 65.41, 73.42, 98.0],                // E C D G
    motifs: {
      A: { fire: 'x.o.x.o.x.o.x.o.', water: '4...4...4...4...', thunder: '..x.x...x.x.x...', light: 'x.x...x.x.x...x.', dark: '.x.x...x.x.x...x' },
      B: { fire: 'x...x...x...x...', water: '6.....2.6.....2.', thunder: '..x.x.x...x.x.x.', light: 'x...x.x.x...x.x.', dark: '.x.x.x...x.x.x..' },
      C: { fire: 'o.o.o.x.o.o.o.x.', water: '4...2.2.4...2.2.', thunder: 'x.x.x...x.x.x.x.', light: '.x.x.x.x.x.x.x.x', dark: 'x...x...x...x...' },
    },
    order: ['A', 'A', 'B', 'C', 'B', 'C', 'A', 'B', 'C', 'C', 'A', 'B'],
    talkBefore: [
      { who: '指', name: '指揮者', text: '火、水、雷、光、闇。五つの精霊の音を、ぜんぶ重ねるぞ！' },
      { who: '火', name: '火の太鼓の精', text: 'いくぞ！　最後の曲だ、ドンと来い！' },
    ],
    talkAfter: [
      { who: '光', name: '光のフルートの精', text: '都じゅうの窓に、あかりと音が戻っていきます……。' },
      { who: '水', name: '水のハープの精', text: '五つの音がそろいましたね。ありがとう、指揮者さん。' },
      { who: '指', name: '指揮者', text: '字の都に、音楽が帰ってきた。さあ、もう一曲いこうか！' },
    ],
  },
];

// 譜面データ → ノーツ配列（秒）
export function buildChart(song) {
  const spb = 60 / song.bpm;
  const notes = [];
  let cursor = 0;           // 文字数単位の現在位置
  for (const name of song.order) {
    const m = song.motifs[name];
    const len = m.fire.length;
    for (let l = 0; l < LANES.length; l++) {
      const s = m[LANES[l].id];
      if (s.length !== len) throw new Error(`譜面の長さが違う: ${song.id} ${name} ${LANES[l].id}`);
      for (let i = 0; i < len; i++) {
        const c = s[i];
        if (c === '.') continue;
        const beat = (cursor + i) / GRID + LEAD_BEATS;
        const t = beat * spb;
        if (l === 0) {
          if (c === 'o') notes.push({ lane: 0, t, end: t, hold: false });
          else {
            const { n, step } = song.burst;
            for (let k = 0; k < n; k++) notes.push({ lane: 0, t: t + k * step * spb, end: t + k * step * spb, hold: false, grp: `${cursor + i}`, gi: k, gn: n });
          }
        } else if (l === 1) {
          const d = Number(c);
          if (!(d >= 1)) throw new Error(`水は数字で書く: ${song.id} ${name}`);
          notes.push({ lane: 1, t, end: t + (d / GRID) * spb - 0.001, hold: true });
        } else {
          notes.push({ lane: l, t, end: t, hold: false });
        }
      }
    }
    cursor += len;
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const idx = [0, 0, 0, 0, 0];
  for (const n of notes) { n.idx = idx[n.lane]++; n.state = 0; }
  const total = notes.reduce((s, n) => s + (n.hold ? 2 : 1), 0);
  const endTime = Math.max(...notes.map(n => n.end)) + 1.4;
  return { notes, total, endTime, endBeat: Math.ceil(endTime / spb), spb };
}
