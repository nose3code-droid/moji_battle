// 描画（Canvas 2D）と演出。ゲームの状態を読むだけで、書き換えない
import { W, H, DOOR } from './maps.js';
import { DIRS, SCARED_CHAR } from './game.js';
import { FONT_FAMILY } from './metrics.js';

const WALL_COLORS = ['#5b8cff', '#b97bff', '#3fd6a0', '#ffa347', '#ff6b9a'];  // 面ごとの壁の光
const FACE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];                          // 向き → 口の向く角度

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = [];            // 光る輪・跳ねる字・得点の文字
    this.shake = 0;
    this.flash = 0;
    this.sprites = new Map();
    this.board = null;
    this.tile = 20; this.ox = 0; this.oy = 0;
    this.stageKey = '';
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.tile = Math.max(8, Math.floor(Math.min(w / W, h / H)));
    this.ox = Math.floor((w - this.tile * W) / 2);
    this.oy = Math.floor((h - this.tile * H) / 2);
    this.board = null; this.sprites.clear();
  }

  // 文字を小さな画像にしておく（粒は100個以上あるので毎回 fillText しない）
  sprite(ch, size, color, glow) {
    const key = `${ch}|${size}|${color}|${glow}`;
    let s = this.sprites.get(key);
    if (s) return s;
    const pad = Math.ceil(size * 0.5), n = Math.ceil(size + pad * 2);
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${size}px ${FONT_FAMILY}`;
    if (glow) { g.shadowColor = glow; g.shadowBlur = size * 0.35; }
    g.fillStyle = color;
    g.fillText(ch, n / 2, n / 2 + size * 0.04);
    s = { c, n };
    this.sprites.set(key, s);
    return s;
  }
  drawSprite(ch, cx, cy, size, color, glow, alpha = 1, scale = 1) {
    const s = this.sprite(ch, Math.round(size), color, glow);
    const ctx = this.ctx, d = s.n * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(s.c, cx - d / 2, cy - d / 2, d, d);
    ctx.globalAlpha = 1;
  }

  // 壁の描画（面ごとに1回だけ作って使い回す）
  buildBoard(game) {
    const t = this.tile, c = document.createElement('canvas');
    c.width = t * W; c.height = t * H;
    const g = c.getContext('2d');
    const col = WALL_COLORS[game.stage % WALL_COLORS.length];
    const isWall = (x, y) => y >= 0 && y < H && x >= 0 && x < W && game.rows[y][x] === '#';
    const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
    g.fillStyle = '#0a0a1c'; g.fillRect(0, 0, c.width, c.height);
    // 壁のぬりつぶし
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWall(x, y)) {
      g.fillStyle = 'rgba(70,90,220,0.20)';
      g.fillRect(x * t, y * t, t + 0.5, t + 0.5);
    }
    // 道と接する縁に、光る線を引く
    g.strokeStyle = col; g.lineWidth = Math.max(2, t * 0.09); g.lineCap = 'round';
    g.shadowColor = col; g.shadowBlur = t * 0.45;
    g.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isWall(x, y)) continue;
      const k = t * 0.5, px = x * t, py = y * t;
      const seg = (x1, y1, x2, y2) => { g.moveTo(px + x1, py + y1); g.lineTo(px + x2, py + y2); };
      if (!isWall(x, y - 1) && inside(x, y - 1)) seg(0, 0, t, 0);
      if (!isWall(x, y + 1) && inside(x, y + 1)) seg(0, t, t, t);
      if (!isWall(x - 1, y) && inside(x - 1, y)) seg(0, 0, 0, t);
      if (!isWall(x + 1, y) && inside(x + 1, y)) seg(t, 0, t, t);
      // 盤面のふちも囲う（トンネルの出入り口は開ける）
      if (y === 0) seg(0, 0, t, 0);
      if (y === H - 1) seg(0, t, t, t);
      if (x === 0 && game.rows[y][0] === '#') seg(0, 0, 0, t);
      if (x === W - 1 && game.rows[y][W - 1] === '#') seg(t, 0, t, t);
      void k;
    }
    g.stroke();
    // 巣の戸
    g.shadowBlur = 0; g.strokeStyle = '#ff9fd8'; g.lineWidth = Math.max(2, t * 0.12);
    g.beginPath(); g.moveTo(DOOR.x * t + t * 0.1, DOOR.y * t + t / 2); g.lineTo((DOOR.x + 1) * t - t * 0.1, DOOR.y * t + t / 2); g.stroke();
    this.board = c;
    this.stageKey = game.stage + ':' + t;
  }

  // ---------- 演出 ----------
  event(e, game) {
    const fx = this.fx;
    switch (e.type) {
      case 'pellet':
        fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: e.power ? 0.7 : 0.35, big: e.power });
        fx.push({ k: 'hop', x: e.x, y: e.y, t: 0, life: 0.45, ch: e.power ? '力' : game.pelletCh, power: e.power });
        if (e.power) { this.flash = 0.35; }
        break;
      case 'ghostEaten':
        fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.6, big: true });
        fx.push({ k: 'pop', x: e.x, y: e.y, t: 0, life: 1.0, text: String(e.pts), color: '#7fe9ff' });
        this.shake = 0.25;
        break;
      case 'fruit':
        fx.push({ k: 'ring', x: e.x, y: e.y, t: 0, life: 0.6, big: true });
        fx.push({ k: 'pop', x: e.x, y: e.y, t: 0, life: 1.1, text: String(e.pts), color: '#ffd1e8' });
        break;
      case 'death': this.shake = 0.3; break;
      case 'clear': this.flash = 0.5; break;
      default:
    }
  }

  draw(game, now, dt) {
    const ctx = this.ctx, t = this.tile;
    if (!this.board || this.stageKey !== game.stage + ':' + t) this.buildBoard(game);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07070f'; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    this.shake = Math.max(0, this.shake - dt);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * t * 0.35 * this.shake / 0.3 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * t * 0.35 * this.shake / 0.3 : 0;
    ctx.save();
    ctx.translate(this.ox + sx, this.oy + sy);
    ctx.beginPath(); ctx.rect(0, 0, W * t, H * t); ctx.clip();          // トンネルを出た分は見せない

    // クリア時は壁が白く点滅
    if (game.phase === 'clear' && Math.floor(game.phaseTimer * 6) % 2 === 0) ctx.filter = 'brightness(2.2) saturate(0.4)';
    ctx.drawImage(this.board, 0, 0);
    ctx.filter = 'none';

    const p = game.player;
    // 字の粒：ゆらゆら光る。主人公に近いほど明るい
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = game.pellets[y * W + x];
      if (!v) continue;
      const cx = (x + 0.5) * t, cy = (y + 0.5) * t;
      const ph = x * 0.7 + y * 1.3;
      if (v === 1) {
        const near = Math.max(0, 1 - Math.hypot(x - p.x, y - p.y) / 3);
        const tw = 0.5 + 0.5 * Math.sin(now * 3 + ph);
        this.drawSprite(game.pelletCh, cx, cy, t * 0.54, '#fff0c0', near > 0.2 ? '#ffd24a' : null, 0.78 + 0.2 * tw + 0.3 * near, 0.95 + 0.1 * tw);
      } else {
        const pulse = 1 + 0.15 * Math.sin(now * 7);
        this.drawSprite('力', cx, cy, t * 0.92, '#ff6a3d', '#ffb347', 1, pulse);
      }
    }

    // ボーナスアイテム
    if (game.fruit) {
      const f = game.fruit, bounce = Math.abs(Math.sin(now * 6)) * t * 0.14;
      if (f.t > 3 || Math.floor(now * 8) % 2 === 0) this.drawSprite(f.ch, (f.x + 0.5) * t, (f.y + 0.5) * t - bounce, t * 1.0, '#ff9ab8', '#ffd0e0');
    }

    // おばけ
    for (const g of game.ghosts) this.drawGhost(game, g, now);
    // 主人公
    this.drawPlayer(game, now);

    // 演出（輪・跳ねる字・得点）
    this.drawFx(dt);

    // 合図の文字
    if (game.phase === 'ready') {
      this.text('よーい！', 9.5 * t, 11.5 * t, t * 0.95, '#ffe14a', true);
    }
    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      this.flash = Math.max(0, this.flash - dt);
    }
  }

  text(s, x, y, size, color, outline) {
    const ctx = this.ctx;
    ctx.font = `800 ${size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (outline) { ctx.lineWidth = size * 0.18; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }

  drawPlayer(game, now) {
    const ctx = this.ctx, t = this.tile, p = game.player;
    const cx = (p.x + 0.5) * t, cy = (p.y + 0.5) * t;
    const size = t * 1.12;
    ctx.save();
    ctx.translate(cx, cy);
    let alpha = 1;
    if (game.phase === 'dying') {                                       // くるくる回って縮む
      const k = 1 - game.phaseTimer / 1.5;
      ctx.rotate(k * Math.PI * 5); const s = Math.max(0.02, 1 - k); ctx.scale(s, s); alpha = 1 - k * 0.5;
    }
    ctx.globalAlpha = alpha;
    // 後ろのうっすらした光
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, t * 0.8);
    gr.addColorStop(0, 'rgba(255,225,74,0.28)'); gr.addColorStop(1, 'rgba(255,225,74,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, t * 0.8, 0, Math.PI * 2); ctx.fill();
    // 食べたときにぷくっとふくらむ
    const squash = 1 + 0.08 * Math.max(0, Math.sin(now * 20)) * (p.dir >= 0 ? 1 : 0);
    ctx.scale(squash, 1 / squash);
    // 口：字のうえに楔形の切り欠きを作る
    const face = p.dir >= 0 ? FACE[p.dir] : (p.faceLast ?? Math.PI);
    if (p.dir >= 0) p.faceLast = FACE[p.dir];
    const open = game.phase === 'dying' ? 0.1 : p.dir >= 0 ? 0.08 + Math.abs(Math.sin(p.mouth)) * 0.62 : 0.3;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-t * 2, -t * 2, t * 4, t * 4);
    ctx.moveTo(0, 0); ctx.arc(0, 0, t * 2.2, face - open, face + open); ctx.closePath();
    ctx.clip('evenodd');
    ctx.font = `800 ${size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.12; ctx.strokeStyle = '#3a2a00';
    ctx.strokeText(game.stats.ch, 0, size * 0.04);
    ctx.fillStyle = '#ffe14a'; ctx.fillText(game.stats.ch, 0, size * 0.04);
    ctx.restore();
    ctx.restore();
  }

  drawGhost(game, g, now) {
    const ctx = this.ctx, t = this.tile;
    let cx = (g.x + 0.5) * t, cy = (g.y + 0.5) * t;
    if (g.state === 'house' || g.state === 'leaving') cy += Math.sin(now * 8 + g.id) * t * 0.05;
    const r = t * 0.46;
    if (g.state === 'eyes') { this.drawEyes(cx, cy, r, g.dir); return; }
    const scared = g.state === 'frightened';
    const blink = scared && game.power < 2 && Math.floor(now * 6) % 2 === 0;
    const body = scared ? (blink ? '#f4f4ff' : '#3340e0') : g.color;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = body;
    ctx.shadowColor = scared ? '#5566ff' : g.color; ctx.shadowBlur = t * 0.3;
    // 頭は半円、裾は波
    const wob = Math.sin(now * 10 + g.id * 2) * 0.06 * r;
    ctx.beginPath();
    ctx.arc(0, -r * 0.1, r, Math.PI, 0);
    ctx.lineTo(r, r * 0.9);
    const n = 4, w = (2 * r) / n;
    for (let i = 0; i < n; i++) {
      const x1 = r - w * i, x2 = x1 - w;
      ctx.quadraticCurveTo(x1 - w * 0.5, r * (i % 2 ? 0.62 : 1.18) + wob * (i % 2 ? 1 : -1), x2, r * 0.9);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // 字：おばけの種類が見分けられるように白で大きく
    ctx.font = `800 ${t * 0.66}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ch = scared ? SCARED_CHAR : g.ch;
    ctx.lineJoin = 'round'; ctx.lineWidth = t * 0.1; ctx.strokeStyle = scared && blink ? '#3340e0' : 'rgba(0,0,0,0.65)';
    ctx.strokeText(ch, 0, r * 0.08);
    ctx.fillStyle = scared && blink ? '#3340e0' : '#fff'; ctx.fillText(ch, 0, r * 0.08);
    ctx.restore();
  }
  drawEyes(cx, cy, r, dir) {
    const ctx = this.ctx, d = dir >= 0 ? DIRS[dir] : { dx: 0, dy: 0 };
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(cx + sx * r * 0.42, cy - r * 0.1, r * 0.3, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2438c8'; ctx.beginPath(); ctx.arc(cx + sx * r * 0.42 + d.dx * r * 0.14, cy - r * 0.1 + d.dy * r * 0.18, r * 0.16, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawFx(dt) {
    const ctx = this.ctx, t = this.tile;
    for (const f of this.fx) {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) continue;
      const cx = (f.x + 0.5) * t, cy = (f.y + 0.5) * t;
      if (f.k === 'ring') {
        ctx.strokeStyle = `rgba(255,230,140,${(1 - k) * 0.9})`; ctx.lineWidth = t * (f.big ? 0.14 : 0.07) * (1 - k * 0.5);
        ctx.beginPath(); ctx.arc(cx, cy, t * (0.2 + k * (f.big ? 1.9 : 0.9)), 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === 'hop') {                                          // 食べた字がぴょんと跳ねて消える
        const h = Math.sin(k * Math.PI) * t * 0.9;
        this.drawSprite(f.ch, cx, cy - h, t * (f.power ? 0.9 : 0.5), '#fff6c8', '#ffd24a', 1 - k, 1 + k * 0.4);
      } else if (f.k === 'pop') {
        this.text(f.text, cx, cy - k * t * 1.1, t * 0.7, f.color, true);
      }
    }
    this.fx = this.fx.filter(f => f.t < f.life);
  }
}
