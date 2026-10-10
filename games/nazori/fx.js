// なぞり魔法：魔法ごとのエフェクト（火＝炎、水＝しずく、雷＝稲妻、光＝輝き、闇＝渦）
import { ELEMS } from './stages.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

export class Fx {
  constructor() { this.list = []; this.parts = []; this.pops = []; this.flash = 0; this.flashColor = '#fff'; }

  particle(x, y, vx, vy, life, size, color, grav = 0) { this.parts.push({ x, y, vx, vy, life, max: life, size, color, grav }); }
  burst(x, y, color, n = 16, speed = 120, size = 4) {
    for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), v = rnd(speed * 0.3, speed); this.particle(x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.3, 0.7), rnd(size * 0.5, size), color); }
  }
  pop(x, y, text, color, size = 18) { this.pops.push({ x, y, text, color, size, t: 0 }); }
  doFlash(color, v = 0.5) { this.flash = v; this.flashColor = color; }

  // 魔法を放つ。from は発射位置、getTo は狙う位置（動く魔物に追従）、onHit は届いた瞬間
  spell(ch, from, getTo, onHit) {
    const el = ELEMS[ch];
    const o = { ch, t: 0, hit: false, from, getTo, onHit, el, last: { ...getTo() } };
    o.dur = { 火: 0.45, 水: 0.55, 雷: 0.35, 光: 0.4, 闇: 0.65 }[ch];
    this.list.push(o);
  }

  update(dt) {
    for (const o of this.list) {
      o.t += dt;
      const e = Math.min(1, o.t / o.dur);
      const to = o.getTo() || o.last; o.last = { ...to };
      const pos = this.pos(o, e, to);
      if (e < 1) this.trail(o, pos, e, dt);
      if (!o.hit && (o.ch === '雷' ? o.t > 0.12 : e >= 1)) { o.hit = true; this.impact(o, to); o.onHit && o.onHit(); }
    }
    this.list = this.list.filter(o => o.t < o.dur + (o.ch === '闇' ? 0.6 : o.ch === '雷' ? 0.1 : 0.05));
    for (const p of this.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const p of this.pops) { p.t += dt; p.y -= 26 * dt; }
    this.pops = this.pops.filter(p => p.t < 1.1);
    this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  pos(o, e, to) {
    const { from } = o;
    let x = lerp(from.x, to.x, e), y = lerp(from.y, to.y, e);
    if (o.ch === '火') y -= Math.sin(e * Math.PI) * 30;
    if (o.ch === '水') y -= Math.sin(e * Math.PI) * 70;
    if (o.ch === '闇') { const k = (1 - e) * 46; x += Math.cos(e * 18) * k; y += Math.sin(e * 18) * k; }
    return { x, y };
  }

  trail(o, p, e, dt) {
    const el = o.el;
    if (o.ch === '火') for (let i = 0; i < 3; i++) this.particle(p.x + rnd(-4, 4), p.y + rnd(-4, 4), rnd(-20, 20), rnd(-10, 40), rnd(0.2, 0.45), rnd(3, 8), Math.random() < 0.5 ? el.color : el.glow);
    if (o.ch === '水') this.particle(p.x + rnd(-6, 6), p.y, rnd(-10, 10), rnd(10, 50), 0.4, rnd(2, 4), Math.random() < 0.5 ? el.color : el.glow, 150);
    if (o.ch === '光') this.particle(p.x + rnd(-8, 8), p.y + rnd(-8, 8), rnd(-30, 30), rnd(-30, 30), 0.4, rnd(2, 4), Math.random() < 0.5 ? '#fff' : el.color);
    if (o.ch === '闇') this.particle(p.x + rnd(-5, 5), p.y + rnd(-5, 5), rnd(-15, 15), rnd(-15, 15), 0.5, rnd(2, 6), Math.random() < 0.5 ? el.color : '#3b1a6b');
  }

  impact(o, to) {
    const el = o.el;
    if (o.ch === '火') { this.burst(to.x, to.y, el.color, 22, 160, 7); this.burst(to.x, to.y, el.glow, 10, 90, 5); o.ring = 1; }
    if (o.ch === '水') { this.burst(to.x, to.y, el.color, 14, 130, 4); for (let i = 0; i < 12; i++) this.particle(to.x, to.y, rnd(-100, 100), rnd(-170, -40), rnd(0.5, 0.9), rnd(2, 5), el.glow, 420); }
    if (o.ch === '雷') { this.burst(to.x, to.y, el.color, 22, 220, 4); this.doFlash('#fff7bf', 0.55); }
    if (o.ch === '光') { this.burst(to.x, to.y, '#fff', 18, 190, 5); this.burst(to.x, to.y, el.color, 12, 120, 6); this.doFlash('#fffbe0', 0.4); }
    if (o.ch === '闇') { for (let i = 0; i < 24; i++) { const a = rnd(0, 6.28), r = rnd(30, 60); this.particle(to.x + Math.cos(a) * r, to.y + Math.sin(a) * r, -Math.cos(a) * r * 1.6 - Math.sin(a) * 70, -Math.sin(a) * r * 1.6 + Math.cos(a) * 70, rnd(0.4, 0.7), rnd(3, 6), Math.random() < 0.5 ? el.color : el.glow); } }
  }

  draw(c) {
    for (const o of this.list) this.drawSpell(c, o);
    for (const p of this.parts) {
      const a = Math.max(0, p.life / p.max);
      c.globalAlpha = a; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, 6.28); c.fill();
    }
    c.globalAlpha = 1;
    for (const p of this.pops) {
      c.globalAlpha = Math.min(1, (1.1 - p.t) * 2.2);
      c.font = `900 ${p.size}px 'MojiNazori', sans-serif`; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.75)';
      c.strokeText(p.text, p.x, p.y); c.fillStyle = p.color; c.fillText(p.text, p.x, p.y);
    }
    c.globalAlpha = 1;
  }

  drawSpell(c, o) {
    const e = Math.min(1, o.t / o.dur), el = o.el, to = o.getTo() || o.last;
    const p = this.pos(o, e, to);
    c.save();
    if (o.ch === '火' && e < 1) {
      const g = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, 20);
      g.addColorStop(0, '#fff3bf'); g.addColorStop(0.4, el.glow); g.addColorStop(1, 'rgba(255,90,31,0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 20, 0, 6.28); c.fill();
    }
    if (o.ch === '火' && o.hit) { // 着弾の炎の輪
      const k = (o.t - o.dur) * 4; c.globalAlpha = Math.max(0, 0.8 - k); c.strokeStyle = el.color; c.lineWidth = 6; c.beginPath(); c.arc(to.x, to.y, 12 + k * 40, 0, 6.28); c.stroke();
    }
    if (o.ch === '水') {
      if (e < 1) for (let i = 0; i < 4; i++) { // 4つのしずくが少しずつずれて飛ぶ
        const ee = Math.max(0, Math.min(1, e * 1.25 - i * 0.07));
        const q = this.pos(o, ee, to);
        c.fillStyle = i % 2 ? el.glow : el.color; c.beginPath(); c.ellipse(q.x, q.y, 6, 9, 0, 0, 6.28); c.fill();
      }
      if (o.hit) { const k = (o.t - o.dur) * 5; c.globalAlpha = Math.max(0, 0.9 - k); c.strokeStyle = el.glow; c.lineWidth = 4; c.beginPath(); c.ellipse(to.x, to.y + 8, 14 + k * 50, 6 + k * 18, 0, 0, 6.28); c.stroke(); }
    }
    if (o.ch === '雷') {
      const flick = Math.random() < 0.3 ? 0.6 : 1;
      this.bolt(c, { x: to.x + rnd(-10, 10), y: -10 }, to, el, flick);
      this.bolt(c, o.from, to, el, flick * 0.8);
    }
    if (o.ch === '光') {
      if (e < 1) {
        c.fillStyle = '#fff'; c.shadowColor = el.color; c.shadowBlur = 24; c.beginPath(); c.arc(p.x, p.y, 8, 0, 6.28); c.fill();
        c.strokeStyle = el.glow; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x - 20, p.y); c.lineTo(p.x + 20, p.y); c.moveTo(p.x, p.y - 20); c.lineTo(p.x, p.y + 20); c.stroke();
      } else {
        const k = (o.t - o.dur) * 6; c.globalAlpha = Math.max(0, 1 - k * 1.2); c.strokeStyle = '#fff'; c.shadowColor = el.color; c.shadowBlur = 14; c.lineWidth = 3;
        for (let i = 0; i < 10; i++) { const a = i * 0.628; c.beginPath(); c.moveTo(to.x + Math.cos(a) * (10 + k * 30), to.y + Math.sin(a) * (10 + k * 30)); c.lineTo(to.x + Math.cos(a) * (30 + k * 60), to.y + Math.sin(a) * (30 + k * 60)); c.stroke(); }
      }
    }
    if (o.ch === '闇') {
      if (e < 1) {
        const g = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, 18);
        g.addColorStop(0, '#1b0636'); g.addColorStop(0.6, el.color); g.addColorStop(1, 'rgba(156,93,232,0)');
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 18, 0, 6.28); c.fill();
      } else { // 着弾点の渦
        const k = (o.t - o.dur); c.globalAlpha = Math.max(0, 1 - k * 1.7); c.lineWidth = 4;
        for (let i = 0; i < 3; i++) { c.strokeStyle = i % 2 ? el.glow : el.color; const r = (50 - k * 60) * (1 - i * 0.25); c.beginPath(); c.arc(to.x, to.y, Math.max(2, r), k * 9 + i * 2, k * 9 + i * 2 + 3.6); c.stroke(); }
      }
    }
    c.restore();
  }

  bolt(c, a, b, el, alpha) {
    const pts = [a]; const n = 7;
    for (let i = 1; i < n; i++) pts.push({ x: lerp(a.x, b.x, i / n) + rnd(-18, 18), y: lerp(a.y, b.y, i / n) + rnd(-8, 8) });
    pts.push(b);
    c.lineJoin = 'round'; c.globalAlpha = alpha;
    for (const [w, col] of [[9, el.color], [4, '#fff']]) {
      c.strokeStyle = col; c.lineWidth = w; c.shadowColor = el.color; c.shadowBlur = 18; c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
      for (const q of pts) c.lineTo(q.x, q.y); c.stroke();
    }
  }
}
