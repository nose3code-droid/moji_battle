// 文字くいしん坊：ゲームの進行（迷路の中の移動・おばけの追い方・得点・ライフ）。画面には触らない
// 出来事（粒を食べた・おばけを食べた…）は game.events に積み、描画側が取り出して演出する
import { getMaze, W, H, DOOR, PEN, EXIT } from './maps.js';

export const STAGES = 5;
export const DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }]; // 0 上 / 1 右 / 2 下 / 3 左
export const opp = d => (d + 2) % 4;

// 面ごとの食べ物（粒）とボーナスアイテム
export const PELLET_CHARS = ['米', '豆', '麦', '栗', '柿'];
export const FRUITS = [{ ch: '桃', pts: 100 }, { ch: '梨', pts: 300 }, { ch: '梅', pts: 500 }, { ch: '瓜', pts: 700 }, { ch: '苺', pts: 1000 }];
export const GHOST_DEFS = [
  { ch: '鬼', color: '#ff4d4d', name: '直接追う', scatter: { x: W - 2, y: -2 } },
  { ch: '幽', color: '#ff8fd0', name: '先回り', scatter: { x: 1, y: -2 } },
  { ch: '怪', color: '#46d9ff', name: '気まぐれ', scatter: { x: W - 2, y: H + 1 } },
  { ch: '魔', color: '#ffa63d', name: '離れると追う', scatter: { x: 1, y: H + 1 } },
];
export const SCARED_CHAR = '弱';

const PELLET_SCORE = 10, POWER_SCORE = 50, EXTRA_LIFE_AT = 10000;
const READY_TIME = 2.2, DYING_TIME = 1.5, CLEAR_TIME = 2.0, FREEZE_TIME = 0.5;
const EPS = 1e-6;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 面ごとの強さ（stage は 0 始まり）
export function stageParams(stage) {
  return {
    ghostSpeed: 4.0 + 0.3 * stage,                       // 面が進むほど速い
    scatter: Math.max(2.5, 7 - stage),                    // 散らばる時間（短いほど追いかけ時間が長い）
    powerTime: [7, 6, 5, 4, 3][stage] ?? 3,
    release: [0, 1.5, 4, 7].map(t => t / (1 + 0.18 * stage)),
    aheadTiles: 4 + (stage >= 2 ? 2 : 0),                 // 先回りが何マス先を狙うか
    capricious: Math.max(0.1, 0.55 - 0.11 * stage),       // 気まぐれがランダムに動く確率
    keepAway: stage >= 3 ? 6 : 8,                         // 離れると追う：この距離より遠いと追う
  };
}

export class Game {
  // opts: { stage, stats(statsFor の結果), score, lives, god, seed }
  constructor(opts) {
    this.stage = opts.stage;
    this.stats = opts.stats;
    this.score = opts.score ?? 0;
    this.lives = opts.lives ?? 3;
    this.god = !!opts.god;
    this.rng = mulberry32((opts.seed ?? 1) * 7919 + this.stage * 131);
    this.params = stageParams(this.stage);
    this.maze = getMaze(this.stage);
    this.rows = this.maze.rows;
    this.events = [];
    this.pellets = new Uint8Array(W * H);     // 0 なし / 1 粒 / 2 パワーえさ
    this.total = 0;
    this.eaten = 0;
    this.extraGiven = this.score >= EXTRA_LIFE_AT;
    this.fruit = null;
    this.fruitsShown = 0;
    this.pelletCh = PELLET_CHARS[this.stage % PELLET_CHARS.length];
    this.penDist = this.floodFromPen();
    this.time = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = this.rows[y][x];
      if (c === 'P') this.start = { x, y };
      if (c === 'F') this.fruitSpot = { x, y };
      if (c === '.') { this.pellets[y * W + x] = 1; this.total++; }
      if (c === 'o') { this.pellets[y * W + x] = 2; this.total++; }
    }
    this.left = this.total;
    this.resetActors();
  }

  // 面の途中でやられたあとにも使う：主人公とおばけを最初の位置に戻す
  resetActors() {
    this.player = { x: this.start.x, y: this.start.y, dir: -1, want: this.player ? this.player.want : -1, mouth: 0, hop: 0 };
    this.ghosts = GHOST_DEFS.map((d, i) => ({
      id: i, ch: d.ch, color: d.color, def: d,
      x: i === 0 ? EXIT.x : PEN.x + (i === 2 ? -1 : i === 3 ? 1 : 0), y: i === 0 ? EXIT.y : PEN.y,
      dir: i === 0 ? 3 : -1, state: i === 0 ? 'normal' : 'house', reverse: false, wait: this.params.release[i],
    }));
    this.mode = 'scatter';
    this.modeIdx = 0;
    this.modeTimer = this.params.scatter;
    this.power = 0;
    this.combo = 0;
    this.phase = 'ready';
    this.phaseTimer = READY_TIME;
    this.freeze = 0;
    this.fruit = null;
    this.events.push({ type: 'ready' });
  }

  // ---------- 迷路の判定 ----------
  cell(x, y) {
    if (y < 0 || y >= H) return '#';
    return this.rows[y][((x % W) + W) % W];
  }
  // kind: 'player' 主人公 / 'ghost' ふつうのおばけ / 'pen' 巣に入れるおばけ（目・出てくるとき）
  passable(x, y, kind) {
    const c = this.cell(x, y);
    if (c === '#') return false;
    if (c === 'D' || c === 'H') return kind === 'pen';
    return true;
  }
  canGo(e, d, kind) { return this.passable(Math.round(e.x) + DIRS[d].dx, Math.round(e.y) + DIRS[d].dy, kind); }

  // 巣からの最短歩数（目になったおばけが戻る道しるべ）
  floodFromPen() {
    const dist = new Int16Array(W * H).fill(-1);
    const q = [[PEN.x, PEN.y]];
    dist[PEN.y * W + PEN.x] = 0;
    while (q.length) {
      const [x, y] = q.shift();
      for (const d of DIRS) {
        const nx = (x + d.dx + W) % W, ny = y + d.dy;
        if (ny < 0 || ny >= H || dist[ny * W + nx] >= 0 || this.cell(nx, ny) === '#') continue;
        dist[ny * W + nx] = dist[y * W + x] + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }

  // ---------- 動かす共通の仕組み：マスの中心でだけ向きを決め、あとは dist だけ進む ----------
  advance(e, dist, decide) {
    for (let guard = 0; dist > 1e-9 && guard < 30; guard++) {
      if (Math.abs(e.x - Math.round(e.x)) < EPS && Math.abs(e.y - Math.round(e.y)) < EPS) {
        e.x = Math.round(e.x); e.y = Math.round(e.y);
        decide(e);
      }
      if (e.dir < 0) return;
      const d = DIRS[e.dir];
      const p = d.dx ? e.x : e.y;
      const target = (d.dx + d.dy) > 0 ? Math.floor(p + EPS) + 1 : Math.ceil(p - EPS) - 1;
      const dd = Math.abs(target - p);
      const step = Math.min(dist, dd);
      e.x += d.dx * step; e.y += d.dy * step; dist -= step;
      if (step >= dd - 1e-9) { if (d.dx) e.x = target; else e.y = target; }
      if (e.x < -0.5) e.x += W; else if (e.x > W - 0.5) e.x -= W; // ワープトンネル
    }
  }

  // ---------- 主人公 ----------
  playerDecide(p) {
    if (p.want >= 0 && this.canGo(p, p.want, 'player')) p.dir = p.want;
    else if (p.dir >= 0 && !this.canGo(p, p.dir, 'player')) p.dir = -1;
  }
  // 先行入力：曲がり角の手前・少し先でも、許容範囲（丸い字ほど広い）なら中心に寄せて曲がる
  playerAssist(p) {
    const w = p.want;
    if (w < 0 || w === p.dir || p.dir < 0) return;
    if (w === opp(p.dir)) { p.dir = w; return; }                 // 逆向きはその場で
    const d = DIRS[p.dir];
    const along = d.dx ? p.x : p.y;
    const c = Math.round(along), off = along - c;
    if (Math.abs(off) < EPS || Math.abs(off) > this.stats.turn) return;
    const cx = d.dx ? c : Math.round(p.x), cy = d.dx ? Math.round(p.y) : c;
    if (Math.abs((d.dx ? p.y : p.x) - Math.round(d.dx ? p.y : p.x)) > EPS) return;
    if (this.passable(cx + DIRS[w].dx, cy + DIRS[w].dy, 'player') && this.passable(cx, cy, 'player')) {
      p.x = cx; p.y = cy; p.dir = w;
    }
  }

  // ---------- おばけ ----------
  ghostSpeed(g) {
    if (g.state === 'eyes') return 10;
    if (g.state === 'leaving' || g.state === 'house') return 3.5;
    let s = this.params.ghostSpeed;
    if (g.id === 0 && this.left <= 20 && this.stage >= 2) s *= 1.06; // 鬼は粒が減るとあせる
    if (g.state === 'frightened') s *= 0.55;
    if (Math.round(g.y) === PEN.y && (g.x <= 2.5 || g.x >= W - 3.5)) s *= 0.55;  // トンネルの中は遅い
    return s;
  }
  ghostTarget(g) {
    const p = this.player, pr = this.params;
    if (this.mode === 'scatter') return g.def.scatter;
    switch (g.id) {
      case 0: return { x: p.x, y: p.y };                                                  // 鬼：直接追う
      case 1: { const d = p.dir >= 0 ? DIRS[p.dir] : { dx: 0, dy: 0 };                    // 幽：先回り
        return { x: p.x + d.dx * pr.aheadTiles, y: p.y + d.dy * pr.aheadTiles }; }
      case 2: return { x: p.x, y: p.y };                                                  // 怪：気まぐれ（ランダムは decide 側）
      default: return Math.hypot(g.x - p.x, g.y - p.y) > pr.keepAway ? { x: p.x, y: p.y } : g.def.scatter; // 魔：近いと逃げる
    }
  }
  ghostDecide(g) {
    if (g.state === 'eyes') {
      if (Math.round(g.x) === PEN.x && Math.round(g.y) === PEN.y) { g.state = 'leaving'; g.dir = -1; return; }
      let best = -1, bd = 1e9;
      for (let d = 0; d < 4; d++) {
        const nx = (Math.round(g.x) + DIRS[d].dx + W) % W, ny = Math.round(g.y) + DIRS[d].dy;
        if (ny < 0 || ny >= H || this.cell(nx, ny) === '#') continue;
        const v = this.penDist[ny * W + nx];
        if (v >= 0 && v < bd) { bd = v; best = d; }
      }
      g.dir = best;
      return;
    }
    const avail = [];
    for (let d = 0; d < 4; d++) if (this.canGo(g, d, 'ghost')) avail.push(d);
    if (!avail.length) { g.dir = -1; return; }
    if (g.reverse) {
      g.reverse = false;
      if (g.dir >= 0 && avail.includes(opp(g.dir))) { g.dir = opp(g.dir); return; }
    }
    let cand = g.dir >= 0 ? avail.filter(d => d !== opp(g.dir)) : avail;
    if (!cand.length) cand = avail;                                   // 行き止まりは引き返す
    if (cand.length === 1) { g.dir = cand[0]; return; }
    if (g.state === 'frightened' || (g.id === 2 && this.mode === 'chase' && this.rng() < this.params.capricious)) {
      g.dir = cand[Math.floor(this.rng() * cand.length)];
      return;
    }
    const t = this.ghostTarget(g);
    let best = cand[0], bd = 1e9;
    for (const d of [0, 3, 2, 1]) {                                    // 同点なら 上 → 左 → 下 → 右
      if (!cand.includes(d)) continue;
      const nx = Math.round(g.x) + DIRS[d].dx, ny = Math.round(g.y) + DIRS[d].dy;
      const dd = (nx - t.x) ** 2 + (ny - t.y) ** 2;
      if (dd < bd - 1e-9) { bd = dd; best = d; }
    }
    g.dir = best;
  }

  updateGhost(g, dt) {
    const sp = this.ghostSpeed(g) * dt;
    if (g.state === 'house') {
      g.wait -= dt;
      if (g.wait <= 0) g.state = 'leaving';
      return;
    }
    if (g.state === 'leaving') {                                      // 巣の中 → 真ん中へ → 戸を通って上へ
      let rest = sp;
      if (Math.abs(g.x - PEN.x) > EPS) {
        const m = Math.min(rest, Math.abs(g.x - PEN.x));
        g.x += Math.sign(PEN.x - g.x) * m; rest -= m;
        if (Math.abs(g.x - PEN.x) < 1e-9) g.x = PEN.x;
      }
      if (Math.abs(g.x - PEN.x) < EPS && rest > 0) {
        g.y = Math.max(EXIT.y, g.y - rest);
        if (g.y <= EXIT.y + EPS) {
          g.y = EXIT.y;
          g.state = this.power > 0 ? 'frightened' : 'normal';
          g.dir = this.rng() < 0.5 ? 1 : 3;
        }
      }
      return;
    }
    this.advance(g, sp, e => this.ghostDecide(e));
  }

  // ---------- 1回の更新 ----------
  update(dtTotal) {
    let rest = Math.min(dtTotal, 0.25);
    while (rest > 1e-9) {                                             // 細かく刻んですり抜けを防ぐ
      const dt = Math.min(rest, 1 / 60);
      rest -= dt;
      this.step(dt);
    }
  }
  step(dt) {
    this.time += dt;
    if (this.phase === 'ready') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) { this.phase = 'play'; this.events.push({ type: 'go' }); }
      return;
    }
    if (this.phase === 'dying') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.lives--;
        if (this.lives <= 0) { this.phase = 'over'; this.events.push({ type: 'over' }); }
        else this.resetActors();
      }
      return;
    }
    if (this.phase === 'clear') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) { this.phase = 'done'; this.events.push({ type: 'stageClear' }); }
      return;
    }
    if (this.phase !== 'play') return;
    if (this.freeze > 0) { this.freeze -= dt; return; }                // おばけを食べた一瞬の止まり

    // 追いかけ／散らばりの切り替え（パワー中は止める）
    if (this.power > 0) {
      this.power -= dt;
      if (this.power <= 0) {
        this.power = 0;
        for (const g of this.ghosts) if (g.state === 'frightened') g.state = 'normal';
        this.events.push({ type: 'powerEnd' });
      }
    } else {
      this.modeTimer -= dt;
      if (this.modeTimer <= 0 && this.modeIdx < 5) {
        this.modeIdx++;
        this.mode = this.modeIdx % 2 ? 'chase' : 'scatter';
        this.modeTimer = this.modeIdx === 5 ? 1e9 : this.mode === 'chase' ? 20 : Math.max(2, this.params.scatter - this.modeIdx / 2);
        for (const g of this.ghosts) if (g.state === 'normal') g.reverse = true;
      }
    }

    // 主人公
    const p = this.player;
    this.playerAssist(p);
    const before = { x: p.x, y: p.y };
    this.advance(p, this.stats.speed * dt, e => this.playerDecide(e));
    p.moved = Math.abs(p.x - before.x) + Math.abs(p.y - before.y) > 1e-6 || p.dir >= 0;
    if (p.dir >= 0) p.mouth += dt * 11;
    this.eatAround();

    // おばけ
    for (const g of this.ghosts) this.updateGhost(g, dt);
    this.collide();

    // ボーナスアイテム
    if (this.fruit) {
      this.fruit.t -= dt;
      if (Math.hypot(this.fruit.x - p.x, this.fruit.y - p.y) < 0.65) {
        this.addScore(this.fruit.pts);
        this.events.push({ type: 'fruit', x: this.fruit.x, y: this.fruit.y, pts: this.fruit.pts, ch: this.fruit.ch });
        this.fruit = null;
      } else if (this.fruit.t <= 0) this.fruit = null;
    }
  }

  addScore(n) {
    this.score += n;
    if (!this.extraGiven && this.score >= EXTRA_LIFE_AT) {
      this.extraGiven = true; this.lives = Math.min(5, this.lives + 1);
      this.events.push({ type: 'life' });
    }
  }

  eatAround() {
    const p = this.player, r = this.stats.eatR;
    for (let y = Math.floor(p.y - r); y <= Math.ceil(p.y + r); y++) {
      for (let xx = Math.floor(p.x - r); xx <= Math.ceil(p.x + r); xx++) {
        if (y < 0 || y >= H) continue;
        const x = ((xx % W) + W) % W, idx = y * W + x, v = this.pellets[idx];
        if (!v || Math.hypot(xx - p.x, y - p.y) > r) continue;
        this.pellets[idx] = 0; this.left--; this.eaten++;
        this.addScore(v === 2 ? POWER_SCORE : PELLET_SCORE);
        this.events.push({ type: 'pellet', x, y, power: v === 2 });
        if (v === 2) this.startPower();
        if (this.eaten === 60 || this.eaten === 120) this.spawnFruit();
        if (this.left <= 0) {
          this.phase = 'clear'; this.phaseTimer = CLEAR_TIME; this.fruit = null;
          this.events.push({ type: 'clear' });
          return;
        }
      }
    }
  }

  spawnFruit() {
    const f = FRUITS[this.stage % FRUITS.length];
    this.fruit = { x: this.fruitSpot.x, y: this.fruitSpot.y, ch: f.ch, pts: f.pts, t: 10 };
    this.events.push({ type: 'fruitAppear' });
  }

  startPower() {
    this.power = this.params.powerTime;
    this.combo = 0;
    for (const g of this.ghosts) if (g.state === 'normal') { g.state = 'frightened'; g.reverse = true; }
    this.events.push({ type: 'power' });
  }

  collide() {
    const p = this.player, hit = this.stats.hitR;
    for (const g of this.ghosts) {
      if (g.state === 'house' || g.state === 'leaving' || g.state === 'eyes') continue;
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (g.state === 'frightened') {
        if (d < hit + 0.3) {
          const pts = 200 * 2 ** Math.min(this.combo, 3);
          this.combo++;
          this.addScore(pts);
          g.state = 'eyes';
          this.freeze = FREEZE_TIME;
          this.events.push({ type: 'ghostEaten', x: g.x, y: g.y, pts, id: g.id });
        }
      } else if (d < hit + 0.12 && !this.god) {
        this.phase = 'dying'; this.phaseTimer = DYING_TIME;
        this.events.push({ type: 'death', x: p.x, y: p.y });
        return;
      }
    }
  }

  // 入力：向きを予約する（曲がり角で自動的に曲がる）
  setWant(d) { this.player.want = d; }
  takeEvents() { const e = this.events; this.events = []; return e; }
}
