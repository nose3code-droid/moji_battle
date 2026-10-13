// Canvas 2D での描画：筐体、ガラスの箱、景品の字、アーム、影、ガラスの反射、ライト
import { X0, X1, CH_X, BIN_Y, LIP_H, CEIL, PIN_LEN } from './sim.js';

// 表示する世界の範囲（m）。左右に筐体の枠、上にマーキー（看板）、下に取り出し口の受け皿
const VX0 = -4.35, VX1 = 4.05, VY0 = -2.4, VY1 = 7.7;
const DEPTH = 0.38; // 奥行きの見せかけ（奥の壁がどれだけ内側に寄るか）

const hueOf = ch => (ch.codePointAt(0) * 47) % 360;

export function createRenderer(canvas, fontFamily) {
  const ctx = canvas.getContext('2d');
  let W = 1, H = 1, S = 1, ox = 0, oy = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    S = Math.min(W / (VX1 - VX0), H / (VY1 - VY0));
    ox = (W - S * (VX1 - VX0)) / 2 - VX0 * S;
    oy = (H + S * (VY1 - VY0)) / 2 + VY0 * S; // y は上向きなので、下端を VY0 に合わせる
  }
  // 画面の座標（CSS ピクセル）→ 世界座標
  function toWorld(px, py) { return { x: (px * dpr - ox) / S, y: (oy - py * dpr) / S }; }

  const world = () => ctx.setTransform(S, 0, 0, -S, ox, oy);
  const screen = () => ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rect = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); };

  function drawBack(t) {
    // 部屋の背景
    screen();
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b1030'); bg.addColorStop(1, '#0b0716');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    world();
    // 筐体の外枠
    const body = ctx.createLinearGradient(VX0, 0, VX1, 0);
    body.addColorStop(0, '#d63a6e'); body.addColorStop(0.5, '#ff6f9c'); body.addColorStop(1, '#c42f62');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.roundRect(VX0 + 0.02, VY0 + 0.05, VX1 - VX0 - 0.04, VY1 - VY0 - 0.1, 0.35); ctx.fill();
    // ガラスの箱の奥の壁（奥行きを出すため、手前より小さい四角）
    const bx0 = X0 + DEPTH, bx1 = X1 - DEPTH, by0 = DEPTH, by1 = CEIL - DEPTH;
    const wall = ctx.createLinearGradient(0, by0, 0, by1);
    wall.addColorStop(0, '#3b2a6e'); wall.addColorStop(1, '#241a4d');
    ctx.fillStyle = wall; rect(X0, 0, X1, CEIL); ctx.fill();
    ctx.fillStyle = wall; rect(bx0, by0, bx1, by1); ctx.fill();
    // 奥の壁の模様（ぼんやり光る水玉）
    ctx.save(); rect(bx0, by0, bx1, by1); ctx.clip();
    for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) {
      ctx.fillStyle = `hsla(${280 + (i * 7 + j * 11) % 60}, 70%, 65%, ${0.06 + 0.03 * Math.sin(t * 1.5 + i + j)})`;
      ctx.beginPath(); ctx.arc(bx0 + (i + 0.5 + (j % 2) * 0.5) * (bx1 - bx0) / 6, by0 + (j + 0.5) * (by1 - by0) / 8, 0.28, 0, 6.3); ctx.fill();
    }
    ctx.restore();
    // 側面・天井・床（奥へ縮む台形）
    const side = (a, b, c, d, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath(); ctx.fill(); };
    side([X0, 0], [bx0, by0], [bx0, by1], [X0, CEIL], '#2a1d55');
    side([X1, 0], [bx1, by0], [bx1, by1], [X1, CEIL], '#2a1d55');
    side([X0, CEIL], [bx0, by1], [bx1, by1], [X1, CEIL], '#4a3a8a');
    side([CH_X, 0], [CH_X + DEPTH * 0.6, by0], [bx1, by0], [X1, 0], '#6a58b0');
    // 取り出し口の受け皿
    const bin = ctx.createLinearGradient(0, BIN_Y, 0, 0);
    bin.addColorStop(0, '#120a24'); bin.addColorStop(1, '#2d1f58');
    ctx.fillStyle = bin; rect(X0, BIN_Y - 0.3, CH_X, 0); ctx.fill();
    ctx.fillStyle = '#17102e'; rect(X0, BIN_Y - 0.3, CH_X, BIN_Y); ctx.fill();
    // 手前の台（床の下）
    const base = ctx.createLinearGradient(0, -2, 0, 0);
    base.addColorStop(0, '#8d1f4a'); base.addColorStop(1, '#c0356a');
    ctx.fillStyle = base; rect(CH_X, BIN_Y - 0.3, X1, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; rect(CH_X, -0.04, X1, 0); ctx.fill();
    // 取り出し口のふち
    ctx.fillStyle = '#ffd24d'; rect(CH_X - 0.07, BIN_Y, CH_X + 0.07, LIP_H); ctx.fill();
    ctx.fillStyle = '#ffb000'; rect(CH_X - 0.07, LIP_H - 0.06, CH_X + 0.07, LIP_H); ctx.fill();
  }

  function glyphColor(ch, f) { return `hsl(${hueOf(ch)}, ${68 - f * 10}%, ${64 - f * 14}%)`; }

  function drawPrize(p, focus, t, silhouetteOnly) {
    const b = p.body.translation(), a = p.body.rotation(), def = p.def;
    ctx.save();
    ctx.translate(b.x, b.y); ctx.rotate(a);
    ctx.fillStyle = silhouetteOnly; // 影の色
    if (silhouetteOnly) { ctx.fill(def.path, 'evenodd'); ctx.restore(); return; }
    const g = ctx.createLinearGradient(0, def.radius, 0, -def.radius);
    g.addColorStop(0, glyphColor(p.ch, 0)); g.addColorStop(1, glyphColor(p.ch, 1));
    ctx.fillStyle = g; ctx.fill(def.path, 'evenodd');
    // つや：字の形で切り抜いて、上側にハイライト
    ctx.save(); ctx.clip(def.path, 'evenodd');
    const hl = ctx.createLinearGradient(-def.radius, def.radius, def.radius * 0.6, -def.radius * 0.2);
    hl.addColorStop(0, 'rgba(255,255,255,.55)'); hl.addColorStop(0.5, 'rgba(255,255,255,.08)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.rotate(-a); ctx.fillStyle = hl; ctx.fillRect(-def.radius, -def.radius, def.radius * 2, def.radius * 2); // 光は常に左上から
    ctx.restore();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(40,10,50,.7)'; ctx.stroke(def.path);
    if (focus === p) {
      ctx.lineWidth = 0.07; ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.3 * Math.sin(t * 6)})`; ctx.stroke(def.path);
    }
    ctx.restore();
  }

  function fingerPaths(sim, fn) {
    for (let i = 0; i < 2; i++) for (const quad of sim.fingerShapes(i)) {
      ctx.beginPath(); quad.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); fn();
    }
  }

  function drawArm(sim, shadow) {
    const hx = sim.hx, hy = sim.hy;
    if (shadow) { // 奥の壁に落ちる影（右下へずらす）
      ctx.save(); ctx.translate(0.22, -0.16); ctx.fillStyle = 'rgba(0,0,0,.28)';
      fingerPaths(sim, () => ctx.fill());
      ctx.fillRect(hx - 0.25, hy - 0.15, 0.5, 0.3);
      ctx.restore();
      // 床の影：爪が降りるほど濃く小さくなる
      const k = Math.max(0, Math.min(1, 1 - (hy - 0.6) / (RAIL_SPAN)));
      const sp = ctx.createRadialGradient(hx, 0.05, 0, hx, 0.05, 1.2);
      sp.addColorStop(0, `rgba(0,0,0,${0.15 + 0.35 * k})`); sp.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(hx, 0.05); ctx.scale(1, 0.18); ctx.translate(-hx, -0.05);
      ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(hx, 0.05, 1.2, 0, 6.3); ctx.fill(); ctx.restore();
      return;
    }
    // レールと台車
    const ry = CEIL - 0.22;
    ctx.fillStyle = '#9aa3b8'; rect(X0, ry + 0.06, X1, ry + 0.16); ctx.fill();
    ctx.fillStyle = '#e8ecf6'; rect(X0, ry + 0.13, X1, ry + 0.16); ctx.fill();
    ctx.fillStyle = '#5b6482'; ctx.beginPath(); ctx.roundRect(hx - 0.35, ry - 0.08, 0.7, 0.32, 0.06); ctx.fill();
    // ケーブル
    ctx.strokeStyle = '#2b2b3c'; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(hx, ry - 0.05); ctx.lineTo(hx, hy + 0.15); ctx.stroke();
    // ピン
    ctx.strokeStyle = '#cfd6e6'; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - PIN_LEN); ctx.stroke();
    ctx.fillStyle = '#ff3d3d'; ctx.beginPath(); ctx.arc(hx, hy - PIN_LEN, 0.07, 0, 6.3); ctx.fill();
    // 爪
    const metal = ctx.createLinearGradient(hx - 1, 0, hx + 1, 0);
    metal.addColorStop(0, '#8b94ad'); metal.addColorStop(0.5, '#e9edf7'); metal.addColorStop(1, '#8b94ad');
    ctx.fillStyle = metal; ctx.strokeStyle = '#3a4058'; ctx.lineWidth = 0.025; ctx.lineJoin = 'round';
    fingerPaths(sim, () => { ctx.fill(); ctx.stroke(); });
    // 本体
    ctx.fillStyle = '#4a5270'; ctx.beginPath(); ctx.roundRect(hx - 0.3, hy - 0.16, 0.6, 0.34, 0.08); ctx.fill();
    ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(hx, hy + 0.01, 0.07, 0, 6.3); ctx.fill();
  }
  const RAIL_SPAN = 4.5;

  function drawGlass(t) {
    // ライト：天井から差す光
    ctx.save(); rect(X0, 0, X1, CEIL); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const lamp = ctx.createRadialGradient(0, CEIL, 0, 0, CEIL, 6);
    lamp.addColorStop(0, 'rgba(255,240,200,.30)'); lamp.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = lamp; rect(X0, 0, X1, CEIL); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // ガラスの反射（斜めの帯）
    const sw = Math.sin(t * 0.35) * 0.15;
    const streak = (x, w, a) => {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(x + 2.6, CEIL); ctx.lineTo(x + 2.6 + w, CEIL); ctx.lineTo(x + w, 0); ctx.lineTo(x, 0); ctx.closePath(); ctx.fill();
    };
    streak(-3.2 + sw, 1.0, 0.16); streak(-1.7 + sw, 0.35, 0.12); streak(1.4 - sw, 0.8, 0.1);
    // ガラス全体のうっすらした色
    const tint = ctx.createLinearGradient(0, 0, 0, CEIL);
    tint.addColorStop(0, 'rgba(160,200,255,.05)'); tint.addColorStop(1, 'rgba(255,255,255,.1)');
    ctx.fillStyle = tint; rect(X0, 0, X1, CEIL); ctx.fill();
    ctx.restore();
    // 受け皿のガラス
    ctx.fillStyle = 'rgba(180,220,255,.10)'; rect(X0, BIN_Y - 0.3, CH_X, 0.0); ctx.fill();
  }

  function drawFrame(t, stageName, state) {
    // 筐体の手前の枠（ガラスの箱のまわり）：外側の四角から、ガラスの窓をくり抜く
    const frame = ctx.createLinearGradient(VX0, VY1, VX1, VY0);
    frame.addColorStop(0, '#ff8fb0'); frame.addColorStop(1, '#b8275a');
    ctx.fillStyle = frame;
    ctx.beginPath();
    ctx.roundRect(VX0, VY0, VX1 - VX0, VY1 - VY0, 0.35);
    ctx.rect(X0, BIN_Y - 0.3, CH_X - X0, CEIL - BIN_Y + 0.3); // ガラスの窓（取り出し口の受け皿まで）
    ctx.rect(CH_X, 0, X1 - CH_X, CEIL);                         // 窓（箱の本体）
    ctx.fill('evenodd');
    // 窓の内側の縁
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.06; rect(CH_X, 0, X1, CEIL); ctx.stroke(); rect(X0, BIN_Y - 0.3, CH_X, CEIL); ctx.stroke();
    // 取り出し口の枠
    ctx.fillStyle = 'rgba(0,0,0,.5)'; rect(X0, BIN_Y - 0.3, CH_X, BIN_Y - 0.25); ctx.fill();
    // マーキー（看板）
    const mx0 = X0 - 0.1, mx1 = X1 + 0.1, my0 = CEIL + 0.35, my1 = VY1 - 0.2;
    const mg = ctx.createLinearGradient(0, my0, 0, my1);
    mg.addColorStop(0, '#2a1650'); mg.addColorStop(1, '#4a2a8a');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.roundRect(mx0, my0, mx1 - mx0, my1 - my0, 0.2); ctx.fill();
    for (let i = 0; i < 18; i++) { // 点滅する電球
      const on = ((i + Math.floor(t * 3)) % 3) === 0;
      ctx.fillStyle = on ? '#fff3a0' : '#7a6a30';
      ctx.beginPath(); ctx.arc(mx0 + 0.25 + i * (mx1 - mx0 - 0.5) / 17, my1 - 0.12, 0.06, 0, 6.3); ctx.fill();
    }
    screen();
    const px = v => v * S;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${px(0.5)}px ${fontFamily}, sans-serif`;
    ctx.shadowColor = '#ff5cf0'; ctx.shadowBlur = px(0.25);
    ctx.fillStyle = '#ffe9ff';
    ctx.fillText('文字クレーン', ox + S * (mx0 + mx1) / 2, oy - S * ((my0 + my1) / 2 + 0.02));
    ctx.shadowBlur = 0;
    // 取り出し口の看板
    ctx.font = `bold ${px(0.26)}px ${fontFamily}, sans-serif`;
    ctx.fillStyle = `rgba(255,224,102,${0.7 + 0.3 * Math.sin(t * 5)})`;
    ctx.fillText('取り出し口 ▼', ox + S * (X0 + CH_X) / 2, oy - S * (BIN_Y - 0.12 - 0.25));
    ctx.fillStyle = '#ffffffcc';
    ctx.font = `${px(0.24)}px ${fontFamily}, sans-serif`;
    ctx.fillText(stageName, ox + S * (CH_X + X1) / 2, oy - S * (-0.95));
    world();
  }

  function draw(sim, opts) {
    resize();
    const t = opts.time || 0;
    drawBack(t);
    // 奥の壁と床の影
    ctx.save(); rect(X0, BIN_Y - 0.3, X1, CEIL); ctx.clip();
    const alive = sim.prizes;
    for (const p of alive) {
      const b = p.body.translation();
      if (b.y > -0.4 && b.x > CH_X) { // 床の影（床に近いほど濃い）
        const h = Math.max(0, b.y - p.def.radius);
        const al = Math.max(0, 0.4 - h * 0.25);
        if (al > 0.02) {
          const sg = ctx.createRadialGradient(b.x, 0.06, 0, b.x, 0.06, p.def.radius * 1.1);
          sg.addColorStop(0, `rgba(0,0,0,${al})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.save(); ctx.translate(b.x, 0.06); ctx.scale(1, 0.2); ctx.translate(-b.x, -0.06);
          ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(b.x, 0.06, p.def.radius * 1.1, 0, 6.3); ctx.fill(); ctx.restore();
        }
      }
    }
    ctx.save(); ctx.translate(0.17, -0.12);
    for (const p of alive) drawPrize(p, null, t, 'rgba(0,0,0,.30)');
    ctx.restore();
    drawArm(sim, true);
    for (const p of alive) drawPrize(p, opts.focus, t, null);
    drawArm(sim, false);
    // 手に入れたときの光
    for (const e of opts.effects || []) {
      const k = e.age / e.life;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = '#fff6b0';
      for (let i = 0; i < 8; i++) {
        const an = i * 0.785 + e.age * 2, r = 0.2 + k * 1.2;
        ctx.beginPath(); ctx.arc(e.x + Math.cos(an) * r, e.y + Math.sin(an) * r, 0.07 * (1 - k) + 0.02, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    drawGlass(t);
    drawFrame(t, opts.stageName || '', sim.state);
    screen();
  }

  return { draw, resize, toWorld };
}
