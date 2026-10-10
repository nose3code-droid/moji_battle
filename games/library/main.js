// 夜の文字館：ステルス・かくれんぼ（Canvas 2D・CDN 不要）
// 文字は FontFace で Noto Sans JP を読み込み（届かなければシステムフォント）fillText で描く
import { FONT_URL } from '../../config.js';

// ---------- 定数 ----------
const SAVE_KEY = 'moji-library-save-v2';
const N_SHIORI = 6;
// ★ふつうのレンタルサーバーに置いたら保存したいとき：save.php を同じ場所に置き、下に './save.php' を入れる（空のままなら端末内の localStorage だけ）
const SERVER_SAVE_URL = '';           // しおりの総数
const FONT_STACK = "'NotoJPLib','Hiragino Sans','Yu Gothic','Noto Sans CJK JP','WenQuanYi Zen Hei',sans-serif";
const WALK = 2.8, RUN = 4.8;  // プレイヤー速度（マス/秒）
const NOISE_WALK = 2.2, NOISE_RUN = 7; // 足音の届く半径
const T = 40;                 // 地図キャッシュ 1 マスのピクセル数

// ---------- マップ ----------
// # 壁  B 本棚(視界を遮る)  D 机(低い)  H ロッカー(かくれる)  L 館長室の扉  E 出口
// P スタート  1〜6 しおり  K 出口のかぎ
// 階段：S(1F→B1F) U(B1F→1F) T(上の階へ) V(下の階へ)
// 難易度は階ごとのパラメータで少しずつ上がる：light 懐中電灯の半径 / sight 視界の距離 / fov 視野角(片側rad) /
//   hear 足音への敏感さ / hide かくれ中でも気づく距離 / lose 見失うまでの秒数 / patrolSpeed・chaseSpeed 速さ
const LEVELS = [
  {
    name: '1F 閲覧室',
    rows: [
      '############################',
      '#P........................1#',
      '#.BBBB.BBBB.BBBB.BBBB.BBBB.#',
      '#..........H...............#',
      '#.BBBB.BBBB.BBBB.BBBB.BBBB.#',
      '#..........................#',
      '#.DD..H...DD........DD.....#',
      '#..........................#',
      '#.BBBB.BBBB.BBBB.BBBB.BBBB.#',
      'E..........................#',
      '#.BBBB.BBBB.BBBB..##########',
      '#.................#........#',
      '#.BBBB.BBBB.BBBB..#..DDD...#',
      '#.................L........#',
      '#..DD......DD.....#.....K..#',
      '#.2...............#........#',
      '#S......H......T..#........#',
      '############################',
    ],
    patrol: [[3, 3], [25, 3], [25, 5], [13, 7], [25, 9], [14, 13], [3, 15], [3, 9], [3, 5]],
    enemy: [13, 7], patrolSpeed: 1.8, chaseSpeed: 4.0,
    light: 5.2, sight: 6.5, fov: 0.96, hear: 1.0, hide: 1.2, lose: 4,
    extra: [[24, 5, 'H'], [14, 11, 'H']],
  },
  {
    name: 'B1F 地下書庫',
    rows: [
      '############################',
      '#U.........................#',
      '#.BBBBBBBBBB.BBBBBBBBBBBB..#',
      '#..........H...............#',
      '#..BBBBBBBBBBBBBBB.BBBBBBB.#',
      '#..........................#',
      '#.BBBBBBBBBB.BBBBBBBBBBBB..#',
      '#....H.....................#',
      '#..BBBBBBBBBBBBBBB.BBBBBBB.#',
      '#..........................#',
      '#.BBBBBBBBBB.BBBBBBBBBBBB..#',
      '#.....................H....#',
      '#..BBBBBBBBBBBBBBB.BBBBBBB.#',
      '#.......H..................#',
      '#.BBBBBBBBBB.BBBBBBBBBBBB..#',
      '#..........................#',
      '#.........................3#',
      '############################',
    ],
    patrol: [[13, 1], [25, 3], [2, 5], [25, 7], [2, 9], [25, 11], [2, 13], [25, 15], [13, 15], [2, 11], [13, 5]],
    enemy: [13, 9], patrolSpeed: 2.0, chaseSpeed: 4.3,
    light: 5.0, sight: 7.0, fov: 1.05, hear: 1.1, hide: 1.3, lose: 4.5,
    extra: [],
  },
  {
    name: '2F 古文書室',
    rows: [
      '############################',
      '#V....B........B........T..#',
      '#.BBB.B.BBBBBB.B.BBBBBB.BB.#',
      '#.....B..H.....B.........H.#',
      '#.BBB.BBBBBB.BBBBBBB.BBBBB.#',
      '#............B.............#',
      '#.BBBBBB.BBBB.BBBBBBBB.BBB.#',
      '#.....H....................#',
      '#.BBB.BBBBBBBBB.BBBBBB.BBB.#',
      '#.B.....B..........B.....B.#',
      '#.B.BBB.B.BBBBBBBB.B.BBBBB.#',
      '#...........H..............#',
      '#.BBBBBB.BBBBB.BBBBBBB.BBB.#',
      '#..........................#',
      '#.BBBB.BBBBBBBB.BBBBBBB.B..#',
      '#....H.....................#',
      '#.........................4#',
      '############################',
    ],
    patrol: [[3, 3], [11, 5], [25, 5], [25, 7], [10, 9], [4, 9], [11, 11], [24, 11], [24, 13], [10, 13], [3, 15], [24, 15]],
    enemy: [14, 9], patrolSpeed: 2.3, chaseSpeed: 4.5,
    light: 4.7, sight: 7.5, fov: 1.12, hear: 1.2, hide: 1.5, lose: 5,
    extra: [],
  },
  {
    name: '3F 屋根裏',
    rows: [
      '############################',
      '#.........................5#',
      '#..BBB...BB....BBBB..D.....#',
      '#..BBB...BB....BBBB...BBB..#',
      '#........BB........H..BBB..#',
      '#H......D....D............D#',
      '#....BB...........BB.......#',
      '#....BB....BBBB...BB......H#',
      '#....BB....BBBB...BB...BBB.#',
      '#.D.......D.....H......BBB.#',
      '#.......H........D....D....#',
      '#..BBB...BB..............D.#',
      '#..BBB...BB...BBBB..BB.....#',
      '#......D.BB...BBBB..BB.....#',
      '#............H......BB..BB.#',
      '#.....BBB...D.....D...H.BB.#',
      '#V........................T#',
      '############################',
    ],
    patrol: [[2, 3], [7, 4], [12, 3], [20, 5], [25, 6], [24, 10], [18, 13], [15, 10], [10, 8], [5, 10], [4, 14], [10, 14], [17, 16], [26, 15]],
    enemy: [14, 9], patrolSpeed: 2.6, chaseSpeed: 4.7,
    light: 4.4, sight: 8.0, fov: 1.22, hear: 1.35, hide: 1.7, lose: 6,
    extra: [],
  },
  {
    name: '4F 時計塔',
    rows: [
      '############################',
      '#..........................#',
      '#..........................#',
      '#..BBBBB.BBBBB.BBBBBBBBBB..#',
      '#..B......H.............B..#',
      '#H.B....................B..#',
      '#..B..BBBBBBBB.BBBBBBB..B..#',
      '#..B..B.................B..#',
      '#.....B...D..6.......B..B..#',
      '#..B.............D...B.....#',
      '#..B..B......H.......B..B..#',
      '#..B..B.BBBBBBBBBBBBBB..B..#',
      '#..B....................B.H#',
      '#..B.............H......B..#',
      '#..BBBBBBBBBBBBBBB.BBBBBB..#',
      '#..........................#',
      '#V..H......................#',
      '############################',
    ],
    patrol: [[2, 2], [25, 2], [25, 9], [25, 15], [13, 15], [2, 15], [2, 8], [8, 4], [13, 5], [19, 4], [7, 9], [13, 9], [20, 8]],
    enemy: [13, 5], patrolSpeed: 2.8, chaseSpeed: 4.75,
    light: 4.1, sight: 8.5, fov: 1.3, hear: 1.5, hide: 1.9, lose: 7,
    extra: [],
  },
];

// 階段のつながり：'階+文字' → [行き先の階, 行き先で出てくる階段の文字, 必要なしおりの数]
const STAIRS = {
  '0S': [1, 'U', 0], '1U': [0, 'S', 0],
  '0T': [2, 'V', 3], '2V': [0, 'T', 0],
  '2T': [3, 'V', 4], '3V': [2, 'T', 0],
  '3T': [4, 'V', 5], '4V': [3, 'T', 0],
};

// ---------- 会話 ----------
const H = 'ひ', U = '鬱';
const TALK = {
  intro: [
    [H, '……んん……あれ？ まっくら……'],
    ['', 'ここは図書館「文字館」。本をよんでいるうちに、ねむってしまったみたい。'],
    [H, '閉館の時間はとっくにすぎてる。出口のかぎは、館長室にあるはず。'],
    [H, '懐中電灯だけがたよりだ。はしると足音がひびくから、そっと歩こう。'],
  ],
  meet: [
    [U, '……いる……？ だれか……いる……？'],
    [H, '（本からぬけだした、大きな文字だ……！ 見つからないようにしなきゃ）'],
    ['', 'ヒント：本棚のかげや、ロッカーの中にかくれると、やりすごせるよ。'],
  ],
  shiori0: [
    [H, '床にしおりが落ちてる。「ひとりは さみしい」って書いてある……'],
  ],
  shiori1: [
    [H, 'またしおり。「だれか いっしょに いて」……？'],
    [H, '書いたのは、あの大きな文字かな。'],
  ],
  shiori2: [
    [H, '3まいめ。「わたしは うつ。本の中はさむくて、出てきてしまった」'],
    [H, '……こわい文字じゃ、なかったのかも。'],
    ['', '3まいあつめたら、1Fの下のほうで、上へのぼる階段（▲）が使えるようになった気がする。'],
  ],
  shiori3: [
    [H, '4まいめ。「おとなの字は、いそがしそうで、こわかった」'],
    [H, 'この上にも、まだ階段がある。屋根裏かな……'],
  ],
  shiori4: [
    [H, '5まいめ。「鬱は、ひとりで、ずっと時計の音をきいていた」'],
    ['', 'まだ上に階段がある。屋根裏のいちばん奥だ。'],
  ],
  shiori5: [
    [H, '6まいめ！ 「ほんとうは、いっしょに あそびたかった」'],
    ['', 'しおりが6まい、ぱあっと光って――気づくと、館長室のとびらの前にいた。'],
  ],
  up2: [[H, '2Fの古文書室。ほこりっぽくて、どこか息がつまる……']],
  up3: [[H, '屋根裏だ。荷物のかげが多くて、鬱の足音もよく響く……']],
  up4: [[H, '時計塔だ。かちこち、かちこち……鬱の気配が、いちばん濃い。']],
  down: [[H, '地下書庫への階段。ひんやりする……']],
  up: [[H, 'もどってきた。']],
  door: [
    ['', '6まいのしおりをとびらのみぞにはめると、カチッと音がしてとびらが開いた。'],
  ],
  key: [
    [H, '机の上に出口のかぎがあった！ あとは出口へ。'],
    ['', '出口は1Fの左はし。'],
  ],
  caught: [
    [U, 'みつけた……'],
    [H, '（うう……さっきの場所にもどされちゃった。足音に気をつけよう）'],
  ],
  ending: [
    [H, 'かぎを回して……あれ？ 鬱が、ついてきてる。'],
    [U, '……行っちゃうの……？'],
    [H, 'ねえ、鬱。さがしてたのは、ともだちだったんだね。'],
    [U, '……うん。ずっと、ひとりで、ページのすみにいたの。'],
    [H, 'ぼくがここにいるよ。朝まで、いっしょにおはなししよう。'],
    [U, '……！ ありがとう、ひ。'],
    ['', '窓の外が、うっすらと明るくなってきた。'],
    ['', 'ふたりは朝まで、ならんで本をよんでいました。'],
  ],
};

// ---------- 状態 ----------
const params = new URLSearchParams(location.search);
const GOD = params.has('god');       // テスト用：見つからない・捕まらない
const QUICK = params.has('quick');   // テスト用：タイトルと導入会話を飛ばす
const DEBUG = params.has('debug');   // テスト用：window.__lib を公開

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const dark = document.createElement('canvas'); // 暗闇レイヤー
const dctx = dark.getContext('2d');
const mapCv = document.createElement('canvas'); // 地図キャッシュ
const mctx = mapCv.getContext('2d');
const $ = id => document.getElementById(id);

let S = { level: 0, got: Array(N_SHIORI).fill(false), doorOpen: false, key: false, cp: null, met: false, caught: 0, ended: false };
let grid = [], gw = 0, gh = 0, items = [];
const player = { x: 1.5, y: 1.5, moving: false, run: false, hidden: false, face: 0 };
const enemy = { x: 0, y: 0, face: 0, mode: 'patrol', wp: 0, path: [], pi: 0, repath: 0, alert: 0, lose: 0, wait: 0, look: 0, last: null, calm: false };
let mode = 'title';   // title | play | caught | ending
let dialog = null, dawn = 0, caughtT = 0, time = 0, noiseT = 0, stairLock = true, doorMsgT = 0, chaseAmt = 0;
const rings = [];
let W = 0, Hh = 0, SC = 40, DPR = 1;

// ---------- 入力 ----------
const keys = new Set();
let stickV = { x: 0, y: 0 }, runBtn = false;
addEventListener('keydown', e => {
  if (['Space', 'Enter', 'KeyZ'].includes(e.code) && dialog) { e.preventDefault(); nextLine(); return; }
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  audioStart();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
$('dialog').addEventListener('pointerdown', e => { e.preventDefault(); audioStart(); nextLine(); });

// バーチャルスティックと「はしる」ボタン
const stickEl = $('stick'), knob = $('knob');
let stickId = null;
function stickMove(e) {
  const r = stickEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2, d = Math.hypot(dx, dy);
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  stickV = { x: dx / max, y: dy / max };
  knob.style.transform = `translate(${dx}px,${dy}px)`;
}
stickEl.addEventListener('pointerdown', e => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); audioStart(); });
stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; stickV = { x: 0, y: 0 }; knob.style.transform = ''; };
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointercancel', stickEnd);
const runEl = $('run');
runEl.addEventListener('pointerdown', e => { runBtn = true; runEl.classList.add('on'); runEl.setPointerCapture(e.pointerId); audioStart(); });
const runEnd = () => { runBtn = false; runEl.classList.remove('on'); };
runEl.addEventListener('pointerup', runEnd);
runEl.addEventListener('pointercancel', runEnd);
if (matchMedia('(pointer: coarse)').matches) $('touch').hidden = false;
addEventListener('touchstart', () => { $('touch').hidden = false; }, { once: true, passive: true });

// ---------- 音（WebAudio。無くても遊べる） ----------
let ac = null;
function audioStart() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { ac = null; }
}
function beep(f, dur, type = 'sine', gain = 0.12, f2 = f) {
  if (!ac) return;
  try {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(f2, ac.currentTime + dur);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
  } catch (e) { /* 無視 */ }
}

// ---------- セーブ ----------
function save() {
  S.updatedAt = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 保存できなくても続行 */ }
  serverSaveSoon();
}
// セーブデータとして使えるか確認。しおりの数が増える前の古いデータは、足りない分を未取得にして引き継ぐ
function validSave(d) {
  if (!d || !Array.isArray(d.got) || d.got.length > N_SHIORI || !d.cp || !LEVELS[d.cp.level] || !LEVELS[d.level]) return null;
  while (d.got.length < N_SHIORI) d.got.push(false);
  d.got = d.got.map(Boolean);
  return d;
}
function loadSave() {
  try { return validSave(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (e) { return null; }
}

// ---------- サーバー保存（SERVER_SAVE_URL が空なら何もしない） ----------
// 端末ごとのひみつの ID（推測されにくいランダム値）をキーに、save.php へ JSON を送る・受け取る
function playerId() {
  try {
    let id = localStorage.getItem('moji-library-id');
    if (!/^[a-f0-9-]{36}$/.test(id || '')) {
      id = crypto.randomUUID();
      localStorage.setItem('moji-library-id', id);
    }
    return id;
  } catch (e) { return null; }
}
let serverTimer = 0;
function serverSaveSoon() { // 続けて保存しても 1.5 秒ごとに 1 回だけ送る
  if (!SERVER_SAVE_URL || serverTimer) return;
  serverTimer = setTimeout(() => {
    serverTimer = 0;
    const id = playerId();
    if (!id) return;
    fetch(SERVER_SAVE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ id, data: S }),
    }).catch(() => { /* ネットワークエラーでも遊びは続ける */ });
  }, 1500);
}
async function serverLoad() {
  const id = SERVER_SAVE_URL && playerId();
  if (!id) return null;
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(`${SERVER_SAVE_URL}?id=${id}`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return validSave((await res.json()).data);
  } catch (e) { return null; }
}

// ---------- レベル読み込み ----------
function loadLevel(i) {
  const L = LEVELS[i];
  S.level = i;
  grid = L.rows.map(r => r.split(''));
  for (const [x, y, c] of L.extra) grid[y][x] = c;
  gh = grid.length; gw = grid[0].length;
  items = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const c = grid[y][x];
    if ('123456'.includes(c)) { items.push({ kind: 's', n: +c - 1, x: x + .5, y: y + .5 }); grid[y][x] = '.'; }
    else if (c === 'K') { items.push({ kind: 'k', x: x + .5, y: y + .5 }); grid[y][x] = '.'; }
    else if (c === 'P') grid[y][x] = '.';
  }
  items = items.filter(it => it.kind === 'k' ? !S.key : !S.got[it.n]);
  if (S.doorOpen) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y][x] === 'L') grid[y][x] = '.';
  renderMap();
  resetEnemy();
}
function resetEnemy() {
  const L = LEVELS[S.level];
  enemy.x = L.enemy[0] + .5; enemy.y = L.enemy[1] + .5;
  Object.assign(enemy, { mode: 'patrol', wp: 0, path: [], pi: 0, repath: 0, alert: 0, lose: 0, wait: 0, look: 0, last: null, calm: false });
}
function spawnAt(x, y) { player.x = x; player.y = y; rings.length = 0; }
function levelStart(c) { // 階段の文字 c の横（階段を使った直後の位置）
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y][x] === c) {
    for (const [dx, dy] of [[1, 0], [0, -1], [0, 1], [-1, 0]]) if (!solidAt(x + dx, y + dy)) return [x + dx + .5, y + dy + .5];
  }
  return [1.5, 1.5];
}

// ---------- 当たり判定 ----------
const solidAt = (x, y) => {
  if (x < 0 || y < 0 || x >= gw || y >= gh) return true;
  return '#BDLE'.includes(grid[y][x]);
};
const blocksLight = (x, y) => {
  if (x < 0 || y < 0 || x >= gw || y >= gh) return true;
  return '#BLE'.includes(grid[y][x]);
};
function hitsSolid(x, y, r) {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
    if (!solidAt(tx, ty)) continue;
    const nx = Math.max(tx, Math.min(x, tx + 1)), ny = Math.max(ty, Math.min(y, ty + 1));
    if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
  }
  return false;
}
function moveCircle(o, dx, dy, r) { // 軸ごとに動かして壁にそってすべる
  o.x += dx; if (hitsSolid(o.x, o.y, r)) o.x -= dx;
  o.y += dy; if (hitsSolid(o.x, o.y, r)) o.y -= dy;
}
// 2点間に光を遮るものが無いか
function los(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.12);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blocksLight(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false;
  }
  return true;
}
// 体の幅ぶん（左右 0.3）もさえぎられないか
function losWide(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / d * .3, ny = (bx - ax) / d * .3;
  return los(ax, ay, bx, by) && los(ax + nx, ay + ny, bx + nx, by + ny) && los(ax - nx, ay - ny, bx - nx, by - ny);
}

// ---------- 経路探索（幅優先） ----------
function bfs(sx, sy, gx, gy) {
  if (sx === gx && sy === gy) return [[sx, sy]];
  const prev = new Map(), key = (x, y) => y * gw + x;
  const q = [[sx, sy]]; prev.set(key(sx, sy), null);
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (solidAt(nx, ny) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [x, y]);
      if (nx === gx && ny === gy) {
        const path = [[nx, ny]];
        let p = [x, y];
        while (p) { path.push(p); p = prev.get(key(p[0], p[1])); }
        return path.reverse();
      }
      q.push([nx, ny]);
    }
  }
  return [[sx, sy]];
}
function setPath(e, gx, gy) {
  e.path = bfs(Math.floor(e.x), Math.floor(e.y), gx, gy);
  e.pi = e.path.length > 1 ? 1 : 0;
}
// 経路にそって進む。着いたら true
function follow(e, speed, dt) {
  while (e.pi < e.path.length) {
    const [tx, ty] = e.path[e.pi];
    const dx = tx + .5 - e.x, dy = ty + .5 - e.y, d = Math.hypot(dx, dy);
    if (d < 0.12) { e.pi++; continue; }
    const st = Math.min(speed * dt, d);
    moveCircle(e, dx / d * st, dy / d * st, 0.33);
    e.face = turnTo(e.face, Math.atan2(dy, dx), dt * 8);
    return false;
  }
  return true;
}
function turnTo(a, b, k) {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * Math.min(1, k);
}

// ---------- 会話 ----------
function say(key, done) {
  dialog = { lines: TALK[key], i: 0, done };
  showLine();
}
function showLine() {
  const [who, text] = dialog.lines[dialog.i];
  $('dialog').hidden = false;
  $('who').textContent = who;
  $('who').className = who === H ? 'hi' : '';
  $('text').textContent = text;
}
function nextLine() {
  if (!dialog) return;
  if (++dialog.i >= dialog.lines.length) {
    const d = dialog.done; dialog = null; $('dialog').hidden = true;
    if (d) d();
  } else showLine();
}
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------- ゲームの流れ ----------
function newGame() {
  S = { level: 0, got: Array(N_SHIORI).fill(false), doorOpen: false, key: false, cp: null, met: false, caught: 0, ended: false };
  if (params.has('give')) { // テスト用の近道：?give=3 でしおり全部＋とびら開放
    const n = +params.get('give');
    for (let i = 0; i < Math.min(N_SHIORI, n); i++) S.got[i] = true;
    if (n >= N_SHIORI) S.doorOpen = true;
  }
  if (params.has('level')) S.level = Math.max(0, Math.min(LEVELS.length - 1, +params.get('level') || 0));
  loadLevel(S.level);
  const p = S.level === 0 ? [1.5, 1.5] : levelStart(S.level === 1 ? 'U' : 'V');
  spawnAt(p[0], p[1]);
  S.cp = { level: S.level, x: p[0], y: p[1] };
  save();
  startPlay();
  if (!QUICK) say('intro');
}
function continueGame(d) {
  S = d;
  loadLevel(S.cp.level);
  spawnAt(S.cp.x, S.cp.y);
  startPlay();
}
function startPlay() {
  mode = 'play'; dawn = 0; stairLock = true;
  $('title').hidden = true; $('ending').hidden = true; $('hud').hidden = false;
  updateHud();
}
function checkpoint(x, y) {
  S.cp = { level: S.level, x, y };
  save();
}
function pickup(it) {
  items.splice(items.indexOf(it), 1);
  beep(880, .25, 'triangle', .15, 1320);
  if (it.kind === 's') {
    S.got[it.n] = true;
    checkpoint(it.x, it.y);
    updateHud();
    const n = S.got.filter(Boolean).length;
    if (n === N_SHIORI) say('shiori5', warpToDoor); else say('shiori' + (n - 1));
  } else {
    S.key = true;
    checkpoint(it.x, it.y);
    updateHud();
    say('key');
  }
}
// 最後のしおりを手にしたら、館長室のとびらの前へ（長い道のりを戻らなくていいように）
function warpToDoor() {
  loadLevel(0);
  spawnAt(17.5, 13.5);
  stairLock = true;
  checkpoint(player.x, player.y);
  updateHud();
}
function caught() {
  mode = 'caught'; caughtT = 0; S.caught++;
  beep(120, .6, 'sawtooth', .18, 40);
}
function respawn() {
  if (S.cp.level !== S.level) loadLevel(S.cp.level);
  spawnAt(S.cp.x, S.cp.y);
  resetEnemy();
  mode = 'play';
  updateHud();
  if (S.caught === 1) say('caught'); else toast('つかまった……！ チェックポイントからやりなおし');
}
function startEnding() {
  mode = 'ending';
  S.ended = true; save();
  // 鬱をそばに呼んで、おだやかな状態にする
  enemy.calm = true; enemy.mode = 'calm';
  enemy.x = player.x + 2; enemy.y = player.y; enemy.face = Math.PI;
  say('ending', () => {
    $('ending').hidden = false; $('hud').hidden = true;
    mode = 'ended';
  });
}
function updateHud() {
  $('shiori').textContent = S.got.map(g => g ? '栞' : '・').join(' ');
  $('floor').textContent = LEVELS[S.level].name;
  const n = S.got.filter(Boolean).length;
  $('goal').textContent = S.key ? '出口（1Fの左はし）へ！'
    : S.doorOpen ? '館長室のかぎをとろう'
    : n >= N_SHIORI ? '館長室のとびら（1Fの右下）へ'
    : `しおりをさがそう（${n}/${N_SHIORI}）`;
}

// ---------- 更新 ----------
function playerInput() {
  let ix = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
  let iy = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
  if (!ix && !iy && Math.hypot(stickV.x, stickV.y) > 0.15) { ix = stickV.x; iy = stickV.y; }
  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }
  return [ix, iy, keys.has('ShiftLeft') || keys.has('ShiftRight') || runBtn];
}

function update(dt) {
  time += dt;
  const [ix, iy, wantRun] = playerInput();
  const mag = Math.hypot(ix, iy);
  player.moving = mag > 0.05;
  player.run = player.moving && wantRun;
  const sp = player.run ? RUN : WALK;
  if (player.moving) {
    moveCircle(player, ix * sp * dt, iy * sp * dt, 0.28);
    player.face = turnTo(player.face, Math.atan2(iy, ix), dt * 12);
  }
  const tile = grid[Math.floor(player.y)]?.[Math.floor(player.x)];
  player.hidden = tile === 'H' && !player.moving;

  // 足音の輪
  const noise = !player.moving ? 0 : player.run ? NOISE_RUN : NOISE_WALK;
  player.noise = noise;
  noiseT -= dt;
  if (noise && noiseT <= 0) {
    noiseT = player.run ? 0.32 : 0.6;
    rings.push({ x: player.x, y: player.y, t: 0, r: noise });
    beep(player.run ? 90 : 60, .06, 'square', player.run ? .05 : .02);
  }
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.9) rings.splice(i, 1); }

  // アイテム・階段・扉・出口
  for (const it of items.slice()) if (Math.hypot(it.x - player.x, it.y - player.y) < 0.65) { pickup(it); if (dialog) return; }
  doorMsgT -= dt;
  const px = Math.floor(player.x), py = Math.floor(player.y);
  const st = STAIRS[S.level + tile];
  if (!st) stairLock = false;
  if (!stairLock && st) {
    const [to, arrive, need] = st;
    if (S.got.filter(Boolean).length < need) {
      if (doorMsgT <= 0) { doorMsgT = 3; toast(`階段の先はまだ入れない（しおり ${S.got.filter(Boolean).length}/${need}）`); }
    } else {
      const from = S.level;
      loadLevel(to);
      const q = levelStart(arrive);
      spawnAt(q[0], q[1]);
      stairLock = true;
      checkpoint(player.x, player.y);
      updateHud();
      say(to > from ? (to === 1 ? 'down' : 'up' + to) : 'up');
      return;
    }
  }
  const near = c => { for (let y = py - 1; y <= py + 1; y++) for (let x = px - 1; x <= px + 1; x++) if (grid[y]?.[x] === c && Math.hypot(x + .5 - player.x, y + .5 - player.y) < 1.15) return true; return false; };
  if (S.level === 0 && !S.doorOpen && near('L')) {
    if (S.got.every(Boolean)) {
      S.doorOpen = true;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y][x] === 'L') grid[y][x] = '.';
      renderMap(); save(); updateHud(); beep(440, .3, 'square', .1, 220);
      say('door');
      return;
    }
    if (doorMsgT <= 0) { doorMsgT = 3; toast(`とびらに${N_SHIORI}つのみぞがある。しおりが ${S.got.filter(Boolean).length}/${N_SHIORI}`); }
  }
  if (S.level === 0 && near('E')) {
    if (S.key) { startEnding(); return; }
    if (doorMsgT <= 0) { doorMsgT = 3; toast('出口はとじている。かぎは館長室にあるはず'); }
  }

  updateEnemy(dt);

  // HUD の状態表示
  $('status').textContent = player.hidden ? '🫥 かくれている' : enemy.mode === 'chase' ? '‼ おいかけられている！' : player.run ? '👣 足音が大きい' : '';
}

function updateEnemy(dt) {
  const L = LEVELS[S.level], e = enemy;
  const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
  const chasing = e.mode === 'chase';

  // 視界：前方 fov 内・sight マス（追跡中は全方向で +1.5）。かくれ中は hide マス
  let sees = false;
  if (!GOD) {
    const range = player.hidden ? L.hide : chasing ? L.sight + 1.5 : L.sight;
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - e.face), Math.cos(Math.atan2(dy, dx) - e.face)));
    if (d <= range && (chasing || d < 1.4 || ang < L.fov) && los(e.x, e.y, player.x, player.y)) sees = true;
  }
  if (sees) e.alert += dt * (d < 3 ? 2.2 : 0.95);
  else if (!chasing) e.alert = Math.max(0, e.alert - dt * 0.5);

  // 初めて鬱が見えたときの会話（ライトの範囲に入ったら）
  if (!S.met && d < LEVELS[S.level].light && los(e.x, e.y, player.x, player.y)) {
    S.met = true; save(); say('meet'); return;
  }

  if (!GOD && e.alert >= 1 && !chasing) { e.mode = 'chase'; e.lose = 0; e.repath = 0; beep(500, .3, 'sawtooth', .1, 200); }

  // 足音が聞こえたら、その場所を見に来る
  if (!GOD && player.noise && d < player.noise * L.hear && (e.mode === 'patrol' || e.mode === 'search')) {
    e.mode = 'investigate'; e.target = [Math.floor(player.x), Math.floor(player.y)]; setPath(e, ...e.target);
  }

  e.repath -= dt;
  if (e.mode === 'chase') {
    if (sees) { e.lose = 0; e.last = [player.x, player.y]; } else e.lose += dt;
    if (e.lose > L.lose) { e.mode = 'search'; e.look = 3; e.alert = 0.3; setPath(e, Math.floor(e.last[0]), Math.floor(e.last[1])); }
    else {
      if (sees && d < 6 && losWide(e.x, e.y, player.x, player.y)) { // まっすぐ追う
        const st = L.chaseSpeed * dt;
        moveCircle(e, dx / d * st, dy / d * st, 0.33);
        e.face = turnTo(e.face, Math.atan2(dy, dx), dt * 10);
        e.path = []; e.pi = 0;
      } else {
        if (e.repath <= 0 || !e.path.length) {
          e.repath = 0.2;
          const tgt = e.lose < 1.2 ? [player.x, player.y] : e.last;
          setPath(e, Math.floor(tgt[0]), Math.floor(tgt[1]));
        }
        follow(e, L.chaseSpeed, dt);
      }
    }
    if (!GOD && d < 0.75) { caught(); return; }
  } else if (e.mode === 'investigate') {
    if (follow(e, L.patrolSpeed * 1.5, dt)) { e.mode = 'search'; e.look = 2.5; }
  } else if (e.mode === 'search') {
    e.look -= dt;
    e.face += dt * 1.6; // きょろきょろ見回す
    if (e.look <= 0) { e.mode = 'patrol'; e.path = []; }
  } else if (e.mode === 'patrol') {
    if (e.wait > 0) { e.wait -= dt; e.face += dt * 0.8; return; }
    if (!e.path.length || e.pi >= e.path.length) { const w = L.patrol[e.wp]; setPath(e, w[0], w[1]); }
    if (follow(e, L.patrolSpeed, dt)) { e.wp = (e.wp + 1) % L.patrol.length; e.path = []; e.wait = 1.2; }
  }
}

// ---------- 描画：地図キャッシュ ----------
const hash = (x, y, k = 0) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
function renderMap() {
  mapCv.width = gw * T; mapCv.height = gh * T;
  const c = mctx;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const ch = grid[y][x], px = x * T, py = y * T;
    // 床
    const v = hash(x, y) * 10;
    c.fillStyle = `rgb(${58 + v | 0},${46 + v | 0},${36 + v | 0})`;
    c.fillRect(px, py, T, T);
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.fillRect(px, py + T / 2 - 1, T, 1); c.fillRect(px + (hash(x, y, 1) * T | 0), py, 1, T / 2);
    if (ch === '#' || ch === 'E') {
      c.fillStyle = '#26232f'; c.fillRect(px, py, T, T);
      c.fillStyle = '#35313f'; c.fillRect(px, py, T, 6);
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px, py + T / 2, T, 1); c.fillRect(px + (y % 2 ? 10 : 25), py, 1, T / 2); c.fillRect(px + (y % 2 ? 25 : 10), py + T / 2, 1, T / 2);
      if (ch === 'E') {
        c.fillStyle = '#12301f'; c.fillRect(px + 4, py + 6, T - 8, T - 12);
        c.fillStyle = '#6dffa8'; c.font = `bold 14px ${FONT_STACK}`; c.fillText('出口', px + T / 2, py + T / 2);
      }
    } else if (ch === 'B') {
      c.fillStyle = '#3a2416'; c.fillRect(px, py, T, T);
      for (let r = 0; r < 3; r++) { // 本の背表紙
        let bx = px + 2;
        while (bx < px + T - 4) {
          const w = 3 + (hash(x * 9 + r, y, bx) * 4 | 0), h = 9 + (hash(x, y * 9 + r, bx) * 3 | 0);
          c.fillStyle = `hsl(${hash(bx, y * 3 + r, x) * 360 | 0},35%,${28 + hash(x, bx, r) * 18 | 0}%)`;
          c.fillRect(bx, py + 2 + r * 12 + (11 - h), w, h);
          bx += w + 1;
        }
        c.fillStyle = '#20120a'; c.fillRect(px, py + 13 + r * 12, T, 2);
      }
    } else if (ch === 'D') {
      c.fillStyle = '#6a4727'; c.fillRect(px + 2, py + 4, T - 4, T - 8);
      c.fillStyle = '#7d5731'; c.fillRect(px + 4, py + 6, T - 8, T - 14);
      c.fillStyle = '#e6dcc0'; c.fillRect(px + 10, py + 12, 10, 8);
    } else if (ch === 'H') {
      c.fillStyle = '#3d4a5c'; c.fillRect(px + 4, py + 2, T - 8, T - 4);
      c.fillStyle = '#1e2733'; for (let i = 0; i < 4; i++) c.fillRect(px + 10, py + 8 + i * 5, T - 20, 2);
      c.fillStyle = '#9fb0c8'; c.font = `bold 9px ${FONT_STACK}`; c.fillText('かくれ', px + T / 2, py + T - 7);
    } else if (ch === 'L') {
      c.fillStyle = '#5a3a1e'; c.fillRect(px, py, T, T);
      c.fillStyle = '#3c2512'; c.fillRect(px + 3, py + 3, T - 6, T - 6);
      c.fillStyle = '#e0b84a'; for (let i = 0; i < 3; i++) c.fillRect(px + 14, py + 8 + i * 9, 12, 4);
      c.fillStyle = '#e0b84a'; c.font = `bold 8px ${FONT_STACK}`; c.fillText('館長室', px + T / 2, py + 4);
    } else if ('SUTV'.includes(ch)) {
      c.fillStyle = '#1c1c24'; c.fillRect(px, py, T, T);
      for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(190,190,210,${.25 + i * .12})`; c.fillRect(px + 4, py + 4 + i * 7, T - 8, 4); }
      c.fillStyle = '#fff'; c.font = `bold 14px ${FONT_STACK}`; c.fillText('SV'.includes(ch) ? '▼' : '▲', px + T / 2, py + T / 2);
    }
  }
}

// ---------- 描画 ----------
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; Hh = innerHeight;
  for (const cv of [canvas, dark]) { cv.width = W * DPR; cv.height = Hh * DPR; }
  SC = Math.max(30, Math.min(W, Hh) / 9);
}
addEventListener('resize', resize);

function visPolygon(cx, cy, R) { // プレイヤーから見える範囲の多角形（本棚や壁で影ができる）
  const pts = [], N = 120;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let d = 0;
    while (d < R) {
      d += 0.1;
      if (blocksLight(Math.floor(cx + ca * d), Math.floor(cy + sa * d))) { d += 0.3; break; }
    }
    d = Math.min(d, R);
    pts.push([cx + ca * d, cy + sa * d]);
  }
  return pts;
}

function glyph(ch, x, y, size, color, glow, rot = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * .5; }
  ctx.fillStyle = color;
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, W, Hh);
  if (mode === 'title' || !grid.length) return;

  // カメラ（プレイヤー中心。地図より画面が大きいときは中央）
  let camX = player.x * SC - W / 2, camY = player.y * SC - Hh / 2;
  camX = gw * SC < W ? -(W - gw * SC) / 2 : Math.max(0, Math.min(gw * SC - W, camX));
  camY = gh * SC < Hh ? -(Hh - gh * SC) / 2 : Math.max(0, Math.min(gh * SC - Hh, camY));
  const sx = x => x * SC - camX, sy = y => y * SC - camY;

  ctx.drawImage(mapCv, 0, 0, mapCv.width, mapCv.height, -camX, -camY, gw * SC, gh * SC);

  // アイテム
  for (const it of items) {
    const bob = Math.sin(time * 3 + it.x) * 2;
    if (it.kind === 's') {
      ctx.save(); ctx.translate(sx(it.x), sy(it.y) + bob);
      ctx.shadowColor = '#ffd75e'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffd75e'; const w = SC * .22, h = SC * .5;
      ctx.beginPath(); ctx.moveTo(-w, -h / 2); ctx.lineTo(w, -h / 2); ctx.lineTo(w, h / 2); ctx.lineTo(0, h / 3); ctx.lineTo(-w, h / 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else glyph('鍵', sx(it.x), sy(it.y) + bob, SC * .6, '#9ff', '#6df');
  }

  // 鬱
  const ex = sx(enemy.x), ey = sy(enemy.y);
  if (enemy.mode === 'chase') { ctx.fillStyle = 'rgba(255,40,40,.25)'; ctx.beginPath(); ctx.arc(ex, ey, SC * 1.1, 0, 7); ctx.fill(); }
  glyph('鬱', ex, ey + Math.sin(time * 2) * 2, SC * 1.7, enemy.calm ? '#9a86d8' : enemy.mode === 'chase' ? '#b0306a' : '#5b3a8c', enemy.calm ? '#c9b6ff' : '#2a1250');
  // ひ
  const bob = player.moving ? Math.sin(time * (player.run ? 20 : 12)) * 2 : 0;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx(player.x), sy(player.y) + SC * .3, SC * .25, SC * .1, 0, 0, 7); ctx.fill();
  glyph('ひ', sx(player.x), sy(player.y) + bob - SC * .05, SC * .8, player.hidden ? '#8a8060' : '#ffe9a8', '#ffcf6a');

  // 暗闇：ライトの範囲だけ消す
  const da = 0.965 * (1 - dawn);
  dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  dctx.globalCompositeOperation = 'source-over';
  dctx.clearRect(0, 0, W, Hh);
  if (da > 0.01) {
    dctx.fillStyle = `rgba(2,2,10,${da})`; dctx.fillRect(0, 0, W, Hh);
    dctx.globalCompositeOperation = 'destination-out';
    const R = LEVELS[S.level].light * (1 + dawn * 3), cx = sx(player.x), cy = sy(player.y);
    const g = dctx.createRadialGradient(cx, cy, SC * .3, cx, cy, R * SC);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.6, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g;
    dctx.beginPath();
    const poly = visPolygon(player.x, player.y, R);
    poly.forEach(([x, y], i) => i ? dctx.lineTo(sx(x), sy(y)) : dctx.moveTo(sx(x), sy(y)));
    dctx.closePath(); dctx.fill();
    // 足元のぼんやりした明かり（壁は透かさない）
    const g2 = dctx.createRadialGradient(cx, cy, 0, cx, cy, SC * 1.1);
    g2.addColorStop(0, 'rgba(0,0,0,.55)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g2; dctx.beginPath(); dctx.arc(cx, cy, SC * 1.1, 0, 7); dctx.fill();
    // ほかの光源：しおり・出口の標識
    for (const it of items) {
      const g3 = dctx.createRadialGradient(sx(it.x), sy(it.y), 0, sx(it.x), sy(it.y), SC * 1.3);
      g3.addColorStop(0, 'rgba(0,0,0,.7)'); g3.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g3; dctx.beginPath(); dctx.arc(sx(it.x), sy(it.y), SC * 1.3, 0, 7); dctx.fill();
    }
    if (S.level === 0) {
      const g4 = dctx.createRadialGradient(sx(.5), sy(9.5), 0, sx(.5), sy(9.5), SC * 2);
      g4.addColorStop(0, 'rgba(0,0,0,.75)'); g4.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g4; dctx.beginPath(); dctx.arc(sx(.5), sy(9.5), SC * 2, 0, 7); dctx.fill();
    }
  }
  ctx.drawImage(dark, 0, 0, W * DPR, Hh * DPR, 0, 0, W, Hh);

  // 暗闇の上：鬱の目（近くにいると光って見える）と足音の輪
  if (enemy.mode !== 'calm') {
    const ed = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (ed < 9) {
      const a = Math.min(1, (9 - ed) / 5) * (enemy.mode === 'chase' ? 1 : .6);
      ctx.fillStyle = enemy.mode === 'chase' ? `rgba(255,70,90,${a})` : `rgba(210,150,255,${a})`;
      for (const o of [-.2, .2]) { ctx.beginPath(); ctx.ellipse(ex + o * SC, ey - SC * .1, SC * .05, SC * .08, 0, 0, 7); ctx.fill(); }
    }
    if (enemy.alert > 0.05 || enemy.mode === 'chase') {
      glyph(enemy.mode === 'chase' ? '！' : '？', ex, ey - SC * 1.2, SC * .7, enemy.mode === 'chase' ? '#ff5a6e' : '#ffe27a', '#000');
    }
  }
  for (const r of rings) {
    const p = r.t / 0.9;
    ctx.strokeStyle = `rgba(255,255,255,${.35 * (1 - p)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(r.x), sy(r.y), r.r * p * SC, 0, 7); ctx.stroke();
  }
  // 出口の標識は暗闇でも少し光る
  if (S.level === 0 && S.key) glyph('出口', sx(.5), sy(9.5), SC * .5, '#6dffa8', '#3f8');

  // 追われているときの赤いふち
  chaseAmt += ((enemy.mode === 'chase' ? 1 : 0) - chaseAmt) * 0.08;
  if (chaseAmt > 0.02) {
    const v = ctx.createRadialGradient(W / 2, Hh / 2, Math.min(W, Hh) * .3, W / 2, Hh / 2, Math.max(W, Hh) * .7);
    v.addColorStop(0, 'rgba(120,0,20,0)'); v.addColorStop(1, `rgba(120,0,20,${.5 * chaseAmt})`);
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, Hh);
  }
  if (mode === 'caught') { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, caughtT / 0.8)})`; ctx.fillRect(0, 0, W, Hh); }
  if (dawn > 0) { ctx.fillStyle = `rgba(255,214,150,${dawn * .22})`; ctx.fillRect(0, 0, W, Hh); }
}

// ---------- メインループ ----------
let prev = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - prev) / 1000 || 0); prev = t;
  if (mode === 'play' && !dialog) update(dt);
  else if (mode === 'caught') { caughtT += dt; if (caughtT > 1.3) respawn(); }
  else if (mode === 'ending' || mode === 'ended') { time += dt; if (!dialog) dawn = Math.min(1, dawn + dt * .5); else dawn = Math.min(.5, dawn + dt * .08); }
  if (mode !== 'title') render();
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
async function loadFont() {
  try {
    const f = new FontFace('NotoJPLib', `url(${FONT_URL})`, { weight: '700' });
    await Promise.race([f.load(), new Promise((_, rej) => setTimeout(rej, 4000))]);
    document.fonts.add(f);
  } catch (e) { console.info('Noto Sans JP を読み込めなかったので、システムフォントで表示します'); }
}

async function boot() {
  resize();
  requestAnimationFrame(frame);
  $('btn-continue').disabled = true; // サーバーのセーブを確認するまで押せない
  let d = loadSave();
  const remote = await serverLoad();
  if (remote && (!d || (remote.updatedAt || 0) > (d.updatedAt || 0))) d = remote; // 新しいほうを使う
  $('btn-continue').disabled = !d || d.ended;
  $('btn-new').onclick = () => { audioStart(); newGame(); };
  $('btn-continue').onclick = () => { audioStart(); continueGame(d); };
  $('btn-again').onclick = () => { newGame(); };
  await loadFont();
  renderMapIfReady();
  if (QUICK) { if (d && !d.ended && !params.has('give') && !params.has('level')) continueGame(d); else newGame(); }
}
function renderMapIfReady() { if (grid.length) renderMap(); }

if (DEBUG) window.__lib = { S: () => S, player, enemy, items: () => items, mode: () => mode, tp: (x, y) => { player.x = x; player.y = y; }, say, nextLine, dialog: () => dialog, loadLevel };
boot();
