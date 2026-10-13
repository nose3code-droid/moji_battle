// 文字ブロックくずし：固定刻み（1/120秒）の決定的シミュレーション。DOM にも描画にも依存しない。
// 同じ面・同じ seed・同じ入力列なら、いつ・どこで動かしても同じ結果になる（乱数は seed 付きの自前、Math.random は使わない）。
import { insideComp } from './shapes.js';

export const W = 360, H = 600;       // 盤面の大きさ（論理座標、y は下向き）
export const DT = 1 / 120;
export const BALL_R = 5.5;
export const PADDLE_Y = 552, PADDLE_H = 10;
export const PADDLE_W = { normal: 76, big: 126, small: 46 };
export const MAX_LIVES = 6;
export const MAX_BALLS = 6;
export const MAX_ANGLE = 62 * Math.PI / 180;   // パドル端で返る角度（真上から）

const PADDLE_SPEED = 900;     // 指・マウスに追いつく最高速度
const KEY_SPEED = 520;        // 矢印キーの速度
const MIN_ANGLE = 14 * Math.PI / 180;  // 水平から最低この角度は上下に進む（横に張りつかない）
const MIN_VERT = 6 * Math.PI / 180;    // 真上・真下から最低この角度は横にずれる
const IDLE_LIMIT = 12 * 120;           // 何にも当たらず 12 秒続いたら向きを変える
const ITEM_FALL = 110;
const FIRE_TICKS = 6 * 120, BIG_TICKS = 12 * 120, SMALL_TICKS = 15 * 120, FAST_TICKS = 10 * 120;

export const ITEMS = {
  big: { ch: '大', name: 'パドル大', color: '#4cc9f0' },
  small: { ch: '小', name: '小・得点×2', color: '#f7b731' },
  fast: { ch: '速', name: '加速・得点UP', color: '#ff6b6b' },
  split: { ch: '分', name: '3つに分裂', color: '#a6e22e' },
  fire: { ch: '火', name: '火の玉', color: '#ff922b' },
  life: { ch: '命', name: '残機＋1', color: '#f783ac' },
};
const DROP_TABLE = [['big', 18], ['small', 10], ['fast', 12], ['split', 18], ['fire', 12], ['life', 4]];

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Sim {
  // stage: stages.js の buildStage の結果
  constructor({ stage, lives = 3, score = 0, seed = 1 }) {
    this.stage = stage;
    this.rng = mulberry32(seed * 7919 + stage.index * 104729 + 1);
    this.tick = 0;
    this.state = 'ready';            // ready（ボールを持っている）| play | clear | over
    this.lives = lives;
    this.score = score;
    this.px = W / 2;
    this.pw = PADDLE_W.normal;
    this.balls = [];
    this.items = [];
    this.glyphs = [];
    this.blocks = [];                // 生きている成分ブロックの一覧
    this.eff = { paddle: null, paddleT: 0, fast: 0, fire: 0 };
    this.events = [];
    this.keepEvents = true;
    this.serve = 0;
    this.nextId = 1;
    this.stats = { hits: 0, breaks: 0, paddleHits: 0, lost: 0, caught: {}, dropped: {}, maxBalls: 1 };
    for (const spec of stage.glyphs) this.addGlyph(spec);
    this.newBall();
  }

  emit(t, d) { if (this.keepEvents) this.events.push({ t, ...d }); }

  // ---------- 面の組み立て ----------
  addGlyph(spec) {
    const g = { id: this.nextId++, spec, form: 0, x: spec.x, y: spec.y, vx: 0, vy: 0, phase: 0, comps: [], state: 'alive', wait: 0, motion: null, x0: spec.x, y0: spec.y };
    this.glyphs.push(g);
    this.spawnForm(g, 0);
    this.placeGlyph(g, false);
  }

  spawnForm(g, i) {
    const f = g.spec.forms[i];
    g.form = i;
    g.motion = f.motion;
    g.comps = f.geom.comps.map((c, k) => ({
      id: this.nextId++, g, c, hp: f.hp[k], maxHp: f.hp[k], alive: true, flash: 0, cd: {},
      invuln: i > 0 ? 100 : 0,
    }));
    g.state = 'alive';
    this.blocks.push(...g.comps);
  }

  hpRatio(g) {
    let a = 0, m = 0;
    for (const b of g.comps) { m += b.maxHp; if (b.alive) a += b.hp; }
    return m ? a / m : 0;
  }

  placeGlyph(g, advance) {
    const m = g.motion;
    let x = g.x0, y = g.y0;
    if (m) {
      if (advance) g.phase += DT * (1 + (m.boost || 0) * (1 - this.hpRatio(g)));
      x += (m.ax || 0) * Math.sin(g.phase * (m.wx || 1));
      y += (m.ay || 0) * Math.sin(g.phase * (m.wy || 1) + (m.py || 0));
    }
    g.vx = advance ? (x - g.x) / DT : 0;
    g.vy = advance ? (y - g.y) / DT : 0;
    g.x = x; g.y = y;
  }

  // ---------- ボール ----------
  ballSpeed() { return this.stage.speed * (this.eff.fast > 0 ? 1.3 : 1); }

  newBall() {
    this.balls.push({ id: this.nextId++, x: this.px, y: PADDLE_Y - BALL_R, px: this.px, py: PADDLE_Y - BALL_R, vx: 0, vy: 0, attached: true, idle: 0, dirX: 1, dirY: -1 });
    this.state = 'ready';
  }

  launch() {
    if (this.state !== 'ready') return;
    const ang = (this.serve++ % 2 ? 1 : -1) * 12 * Math.PI / 180;
    const sp = this.ballSpeed();
    for (const b of this.balls) if (b.attached) { b.attached = false; b.vx = sp * Math.sin(ang); b.vy = -sp * Math.cos(ang); b.idle = 0; }
    this.state = 'play';
    this.emit('launch', {});
  }

  // ---------- 1 ティック ----------
  // input: { tx: 目標の x（なければ null）, dir: -1/0/1（キー）, launch: bool }
  step(inp = {}) {
    if (this.state === 'clear' || this.state === 'over') return;
    this.tick++;
    this.movePaddle(inp);
    this.updateEffects();
    for (const g of this.glyphs) this.updateGlyph(g);
    for (const b of this.blocks) { if (b.flash > 0) b.flash = Math.max(0, b.flash - DT * 6); if (b.invuln > 0) b.invuln--; }
    if (this.state === 'ready' && inp.launch) this.launch();
    this.updateBalls();
    this.updateItems();
    if (this.state === 'play') {
      if (!this.balls.length) this.loseLife();
      else if (this.glyphs.every(g => g.state === 'done')) this.clear();
    }
  }

  movePaddle(inp) {
    const half = this.pw / 2;
    if (inp.dir) this.px += inp.dir * KEY_SPEED * DT;
    else if (inp.tx != null) {
      const d = inp.tx - this.px, m = PADDLE_SPEED * DT;
      this.px += Math.abs(d) <= m ? d : Math.sign(d) * m;
    }
    this.px = Math.max(half, Math.min(W - half, this.px));
  }

  updateEffects() {
    const e = this.eff;
    if (e.paddleT > 0 && --e.paddleT === 0) e.paddle = null;
    if (e.fast > 0) e.fast--;
    if (e.fire > 0) e.fire--;
    const target = PADDLE_W[e.paddle || 'normal'];
    this.pw += (target - this.pw) * Math.min(1, 10 * DT);
    if (Math.abs(this.pw - target) < 0.05) this.pw = target;
  }

  updateGlyph(g) {
    if (g.state === 'wait') {
      if (--g.wait <= 0) {
        this.spawnForm(g, g.form + 1);
        g.phase = 0;
        this.placeGlyph(g, false);
        this.emit('form', { g });
      }
      return;
    }
    if (g.state === 'alive') this.placeGlyph(g, true);
  }

  updateBalls() {
    const r = BALL_R;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (ball.attached) { ball.x = this.px; ball.y = PADDLE_Y - r; continue; }
      ball.px = ball.x; ball.py = ball.y;
      ball.x += ball.vx * DT; ball.y += ball.vy * DT;
      ball.idle++;
      const fire = this.eff.fire > 0;
      for (const b of this.blocks) if (b.alive && b.invuln <= 0) this.collide(ball, b, fire);
      // 壁
      if (ball.x < r) { ball.x = r; if (ball.vx < 0) { ball.vx = -ball.vx; this.emit('wall', { x: 0, y: ball.y }); } }
      else if (ball.x > W - r) { ball.x = W - r; if (ball.vx > 0) { ball.vx = -ball.vx; this.emit('wall', { x: W, y: ball.y }); } }
      if (ball.y < r) { ball.y = r; if (ball.vy < 0) { ball.vy = -ball.vy; this.emit('wall', { x: ball.x, y: 0 }); } }
      this.paddleBounce(ball);
      if (ball.idle > IDLE_LIMIT) {   // どこにも当たらず飛び続けるときの保険
        const a = 0.6, c = Math.cos(a), s = Math.sin(a);
        [ball.vx, ball.vy] = [ball.vx * c - ball.vy * s, ball.vx * s + ball.vy * c];
        ball.idle = IDLE_LIMIT / 2;
      }
      this.normalize(ball);
      if (ball.y > H + 30) this.balls.splice(i, 1);
    }
  }

  paddleBounce(ball) {
    const r = BALL_R;
    if (ball.vy <= 0 || ball.y + r < PADDLE_Y || ball.py + r > PADDLE_Y + 8) return;
    const half = this.pw / 2;
    if (ball.x < this.px - half - r * 0.6 || ball.x > this.px + half + r * 0.6) return;
    const u = Math.max(-1, Math.min(1, (ball.x - this.px) / half));
    const ang = u * MAX_ANGLE, sp = this.ballSpeed();
    ball.vx = sp * Math.sin(ang); ball.vy = -sp * Math.cos(ang);
    ball.y = PADDLE_Y - r;
    ball.idle = 0;
    this.stats.paddleHits++;
    this.emit('paddle', { x: ball.x, y: PADDLE_Y, u });
  }

  // 速さを目標に寄せ、水平・垂直に近すぎる向きを直す
  normalize(ball) {
    const target = this.ballSpeed();
    let sp = Math.hypot(ball.vx, ball.vy) || target;
    if (sp !== target) { const k = (sp + (target - sp) * 0.08) / sp; ball.vx *= k; ball.vy *= k; sp = Math.hypot(ball.vx, ball.vy); }
    const minVy = sp * Math.sin(MIN_ANGLE);
    if (Math.abs(ball.vy) < minVy) {
      ball.vy = (ball.vy !== 0 ? Math.sign(ball.vy) : ball.dirY) * minVy;
      ball.vx = (ball.vx < 0 ? -1 : ball.vx > 0 ? 1 : ball.dirX) * Math.sqrt(sp * sp - ball.vy * ball.vy);
    }
    const minVx = sp * Math.sin(MIN_VERT);
    if (Math.abs(ball.vx) < minVx) {
      ball.vx = (ball.vx !== 0 ? Math.sign(ball.vx) : ball.dirX) * minVx;
      ball.vy = (ball.vy < 0 ? -1 : 1) * Math.sqrt(sp * sp - ball.vx * ball.vx);
    }
    ball.dirX = ball.vx < 0 ? -1 : 1;
    ball.dirY = ball.vy < 0 ? -1 : 1;
  }

  // ボール × 字の輪郭。輪郭の線分との最近点で反射するので、曲線もそのまま跳ね返る
  collide(ball, b, fire) {
    const g = b.g, c = b.c, bb = c.bbox, r = BALL_R, r2 = r * r;
    let lx = ball.x - g.x, ly = ball.y - g.y;
    if (lx < bb[0] - r || lx > bb[2] + r || ly < bb[1] - r || ly > bb[3] + r) return;
    const s = c.segs;
    if (fire) {   // 貫通：触れている間、一定間隔でダメージ
      let touch = false;
      for (let i = 0; i < s.length && !touch; i += 4) touch = segDist2(s, i, lx, ly) < r2;
      if (!touch) touch = insideComp(c, lx, ly);
      if (touch && this.tick - (b.cd[ball.id] ?? -999) >= 14) { b.cd[ball.id] = this.tick; this.hit(b, ball.x, ball.y); }
      return;
    }
    let approach = 0, hx = ball.x, hy = ball.y, contact = false;
    for (let it = 0; it < 4; it++) {
      let bd2 = r2, bi = -1;
      for (let i = 0; i < s.length; i += 4) { const d2 = segDist2(s, i, lx, ly); if (d2 < bd2) { bd2 = d2; bi = i; } }
      if (bi < 0) break;
      // 最近点
      const x1 = s[bi], y1 = s[bi + 1], dx = s[bi + 2] - x1, dy = s[bi + 3] - y1;
      const t = Math.max(0, Math.min(1, ((lx - x1) * dx + (ly - y1) * dy) / (dx * dx + dy * dy)));
      const cx = x1 + t * dx, cy = y1 + t * dy;
      const d = Math.sqrt(bd2);
      let nx, ny, push;
      if (d < 1e-6) {     // 線の上にぴったり：線の法線で、ボールの来た側へ
        const l = Math.hypot(dx, dy) || 1;
        nx = dy / l; ny = -dx / l;
        if (nx * ball.vx + ny * ball.vy > 0) { nx = -nx; ny = -ny; }
        push = r;
      } else if (insideComp(c, lx, ly)) {   // 中心が字の中にめり込んでいたら外へ出す
        nx = (cx - lx) / d; ny = (cy - ly) / d; push = d + r;
      } else {
        nx = (lx - cx) / d; ny = (ly - cy) / d; push = r - d;
      }
      lx += nx * push; ly += ny * push; ball.x += nx * push; ball.y += ny * push;
      const rvx = ball.vx - g.vx, rvy = ball.vy - g.vy, vn = rvx * nx + rvy * ny;
      if (vn < 0) { ball.vx -= 2 * vn * nx; ball.vy -= 2 * vn * ny; if (-vn > approach) { approach = -vn; hx = cx + g.x; hy = cy + g.y; } }
      contact = true;
    }
    if (contact) ball.idle = 0;
    if (approach > 25 && this.tick - (b.cd[ball.id] ?? -999) >= 3) { b.cd[ball.id] = this.tick; this.hit(b, hx, hy); }
  }

  mult() { return (this.eff.paddle === 'small' ? 2 : 1) * (this.eff.fast > 0 ? 1.5 : 1); }

  hit(b, x, y) {
    b.hp--; b.flash = 1;
    this.stats.hits++;
    this.score += Math.round(10 * this.mult());
    this.emit('hit', { x, y, b, hp: b.hp });
    if (this.rng() < 0.05) this.dropItem(x, y);
    if (b.hp <= 0) this.breakBlock(b);
  }

  breakBlock(b) {
    b.alive = false;
    this.blocks.splice(this.blocks.indexOf(b), 1);
    this.stats.breaks++;
    this.score += Math.round(50 * b.maxHp * this.mult());
    const bb = b.c.bbox, cx = b.g.x + (bb[0] + bb[2]) / 2, cy = b.g.y + (bb[1] + bb[3]) / 2;
    this.emit('break', { b, g: b.g, x: cx, y: cy });
    if (this.rng() < 0.6) this.dropItem(cx, cy);
    const g = b.g;
    if (g.comps.every(c => !c.alive)) {
      if (g.form + 1 < g.spec.forms.length) { g.state = 'wait'; g.wait = 130; this.emit('shatter', { g, last: false }); }
      else { g.state = 'done'; this.emit('shatter', { g, last: true }); }
    }
  }

  // ---------- アイテム ----------
  dropItem(x, y, kind) {
    if (!kind) {
      let t = this.rng() * DROP_TABLE.reduce((s, d) => s + d[1], 0);
      for (const [k, w] of DROP_TABLE) { if ((t -= w) < 0) { kind = k; break; } }
      kind = kind || 'big';
    }
    this.items.push({ id: this.nextId++, kind, x, y });
    this.stats.dropped[kind] = (this.stats.dropped[kind] || 0) + 1;
  }

  updateItems() {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.y += ITEM_FALL * DT;
      if (it.y + 11 >= PADDLE_Y && it.y - 11 <= PADDLE_Y + PADDLE_H && Math.abs(it.x - this.px) <= this.pw / 2 + 11) {
        this.items.splice(i, 1);
        this.applyItem(it);
      } else if (it.y > H + 20) this.items.splice(i, 1);
    }
  }

  applyItem(it) {
    const k = it.kind, e = this.eff;
    this.stats.caught[k] = (this.stats.caught[k] || 0) + 1;
    this.score += 100;
    if (k === 'big') { e.paddle = 'big'; e.paddleT = BIG_TICKS; }
    else if (k === 'small') { e.paddle = 'small'; e.paddleT = SMALL_TICKS; }
    else if (k === 'fast') e.fast = FAST_TICKS;
    else if (k === 'fire') e.fire = FIRE_TICKS;
    else if (k === 'life') this.lives = Math.min(MAX_LIVES, this.lives + 1);
    else if (k === 'split') {
      for (const src of this.balls.slice()) {
        if (src.attached) continue;
        for (const a of [0.42, -0.42]) {
          if (this.balls.length >= MAX_BALLS) break;
          const c = Math.cos(a), s = Math.sin(a);
          const clone = { ...src, id: this.nextId++, vx: src.vx * c - src.vy * s, vy: src.vx * s + src.vy * c, idle: 0 };
          this.normalize(clone);
          this.balls.push(clone);
        }
      }
      this.stats.maxBalls = Math.max(this.stats.maxBalls, this.balls.length);
    }
    this.emit('item', { kind: k, x: it.x, y: PADDLE_Y });
  }

  // ---------- 進行 ----------
  loseLife() {
    this.lives--;
    this.stats.lost++;
    this.eff = { paddle: null, paddleT: 0, fast: 0, fire: 0 };
    this.emit('lost', { lives: this.lives });
    if (this.lives <= 0) { this.state = 'over'; this.emit('over', {}); }
    else this.newBall();
  }

  clear() {
    this.state = 'clear';
    this.bonus = this.lives * 500;
    this.score += this.bonus;
    this.emit('clear', { bonus: this.bonus });
  }

  // 結果の比較用（決定性のテスト）
  digest() {
    let h = 2166136261 >>> 0;
    const mix = v => { h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0; };
    mix(this.tick); mix(this.score); mix(this.lives); mix(this.px);
    for (const b of this.balls) { mix(b.x); mix(b.y); mix(b.vx); mix(b.vy); }
    for (const b of this.blocks) { mix(b.hp); mix(b.g.x); mix(b.g.y); }
    for (const i of this.items) { mix(i.x); mix(i.y); }
    return h;
  }
}

// 線分 i（segs の 4 要素）と点の距離²
function segDist2(s, i, px, py) {
  const x1 = s[i], y1 = s[i + 1], dx = s[i + 2] - x1, dy = s[i + 3] - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (x1 + t * dx), ey = py - (y1 + t * dy);
  return ex * ex + ey * ey;
}
