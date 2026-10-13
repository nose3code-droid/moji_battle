// ロボと文字の絵（Canvas 2D）とレーダーチャート（SVG）
import { STAT_KEYS, STAT_NAMES, STAT_MAX, SLOTS } from './parts.js';

const dprOf = () => Math.min(devicePixelRatio || 1, 2);

// 輪郭ポリゴンを、中心 (cx,cy)・枠 (w,h) に収まるように path に積む（字は縦横比を保つ。枠いっぱいに大きく）
function glyphPath(ctx, part, cx, cy, w, h) {
  const { box, polys } = part.shape;
  const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y;
  const s = Math.min(w / Math.max(bw, .3), h / Math.max(bh, .3));
  const mx = (box.min.x + box.max.x) / 2, my = (box.min.y + box.max.y) / 2;
  ctx.beginPath();
  for (const { outer, holes } of polys) {
    for (const ring of [outer, ...holes]) {
      ring.forEach((q, i) => { const x = cx + (q.x - mx) * s, y = cy - (q.y - my) * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
    }
  }
}

// 部品を1つ描く。fill は [明るい色, 暗い色]
function paintGlyph(ctx, part, cx, cy, w, h, fill, alpha = 1) {
  glyphPath(ctx, part, cx, cy, w, h);
  const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
  ctx.fillStyle = g; ctx.fill('evenodd');
  ctx.shadowColor = 'transparent';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5; ctx.strokeStyle = '#161c2c'; ctx.stroke();      // 外の輪郭
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke(); // ハイライトのふち
  ctx.restore();
}

function joint(ctx, x, y, r = 8) {
  const g = ctx.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r);
  g.addColorStop(0, '#e6eaf2'); g.addColorStop(1, '#5b6578');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#161c2c'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * .3, 0, Math.PI * 2); ctx.fillStyle = '#2b3347'; ctx.fill();
}
function rod(ctx, x1, y1, x2, y2) {
  ctx.lineCap = 'round';
  ctx.lineWidth = 11; ctx.strokeStyle = '#161c2c'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.lineWidth = 6; ctx.strokeStyle = '#8c95a8'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function shade(hex, k) {   // 色を明るく(k>0)/暗く(k<0)
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(Math.min(255, Math.max(0, k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ロボの寸法（足元が y=0、上が負）。全高は約 215
const L = {
  legs: { dx: 26, w: 44, h: 58, y: -29 },
  body: { w: 104, h: 92, y: -104 },
  head: { w: 66, h: 58, y: -179 },
  arm: { dx: 76, w: 46, h: 84, y: -112, sx: 52, sy: -140 },   // sx, sy は肩の関節
};
export const ROBO_H = 215;

// ロボを描く。pose: x,y（足元）, scale, dir（+1 右向き／-1 左向き）, color, 動きの値
//   lunge/shake/flash/alpha/rot/armF（前の腕の角度）/armB/legK（前の脚の角度）/headD（頭を下げる）/bob
export function drawRobo(ctx, robo, pose) {
  const { x, y, scale = 1, dir = 1, color = '#2b7de9', shake = 0, flash = 0, alpha = 1, rot = 0, armF = 0, armB = 0, legK = 0, headD = 0, bob = 0, lunge = 0 } = pose;
  const P = robo.parts;
  const c0 = shade(color, .35), c1 = shade(color, -.1), d0 = shade(color, .1), d1 = shade(color, -.4);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x + lunge + (shake ? (Math.random() - .5) * shake : 0), y);
  // 影
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(-lunge, 4, 70 * scale, 11 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.scale(scale, scale);
  ctx.rotate(rot * dir);
  ctx.translate(0, bob);
  const flashed = flash > 0;
  const fillOf = f => flashed ? ['#fff', '#ffd0d0'] : f;

  // 脚（2本）。前の脚が蹴る
  for (const side of [-1, 1]) {
    const front = side === dir;
    const lx = side * L.legs.dx;
    ctx.save();
    if (front && legK) { ctx.translate(lx, -58); ctx.rotate(legK * dir); ctx.translate(-lx, 58); }
    rod(ctx, lx, -60, lx, -52);
    paintGlyph(ctx, P.legs, lx, L.legs.y, L.legs.w, L.legs.h, fillOf([d0, d1]));
    ctx.restore();
  }
  // 腕：後ろの腕 → 胴 → 前の腕
  const arm = (slot, side, ang) => {
    const sx = side * L.arm.sx, sy = L.arm.sy;
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(ang * dir); ctx.translate(-sx, -sy);
    rod(ctx, sx, sy, side * L.arm.dx, L.arm.y - 20);
    paintGlyph(ctx, P[slot], side * L.arm.dx, L.arm.y, L.arm.w, L.arm.h, fillOf([c0, c1]));
    joint(ctx, sx, sy, 9);
    ctx.restore();
  };
  // 右腕は画面の左（ロボの右手）。味方（dir=+1）は右腕が前、敵（dir=-1）は左腕が前
  const frontSlot = dir === 1 ? 'rarm' : 'larm', backSlot = dir === 1 ? 'larm' : 'rarm';
  const frontSide = dir, backSide = -dir;
  arm(backSlot, backSide, armB);
  // 胴
  ctx.save();
  const bw = L.body.w, bh = L.body.h;
  ctx.fillStyle = flashed ? '#fff' : shade(color, -.55);
  ctx.strokeStyle = '#161c2c'; ctx.lineWidth = 3;
  roundRect(ctx, -bw / 2 - 4, L.body.y - bh / 2 - 4, bw + 8, bh + 8, 14); ctx.fill(); ctx.stroke();
  ctx.restore();
  paintGlyph(ctx, P.body, 0, L.body.y, bw, bh, fillOf([c0, c1]));
  // リベット
  for (const [rx, ry] of [[-bw / 2, L.body.y - bh / 2], [bw / 2, L.body.y - bh / 2], [-bw / 2, L.body.y + bh / 2], [bw / 2, L.body.y + bh / 2]]) joint(ctx, rx, ry, 3.5);
  // 頭：首の関節 → アンテナ → 板 → 字
  ctx.save();
  ctx.translate(headD * dir * 8, headD * 6); ctx.translate(0, -150); ctx.rotate(headD * dir * .25); ctx.translate(0, 150);
  joint(ctx, 0, -150, 7);
  ctx.strokeStyle = '#161c2c'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, L.head.y - 29); ctx.lineTo(0, L.head.y - 44); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, L.head.y - 47, 5, 0, Math.PI * 2); ctx.fillStyle = flashed ? '#fff' : '#ff6b6b'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = flashed ? '#fff' : shade(color, -.6);
  roundRect(ctx, -L.head.w / 2 - 5, L.head.y - L.head.h / 2 - 5, L.head.w + 10, L.head.h + 10, 16); ctx.fill(); ctx.stroke();
  // 目のランプ（板の左右）
  ctx.fillStyle = '#7ff0ff';
  for (const s2 of [-1, 1]) { ctx.beginPath(); ctx.arc(s2 * (L.head.w / 2 + 5), L.head.y, 4, 0, Math.PI * 2); ctx.fill(); }
  paintGlyph(ctx, P.head, 0, L.head.y, L.head.w, L.head.h, fillOf([c0, c1]));
  ctx.restore();
  arm(frontSlot, frontSide, armF);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// キャンバスを大きさに合わせる（高解像度）。論理サイズ (w,h) を返す
export function fitCanvas(canvas) {
  const dpr = dprOf();
  const w = canvas.clientWidth || 100, h = canvas.clientHeight || 100;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// 部品カード用の字の絵
export function drawPartIcon(canvas, part, color = '#34415f') {
  const { ctx, w, h } = fitCanvas(canvas);
  glyphPath(ctx, part, w / 2, h / 2, w * .84, h * .84);
  ctx.fillStyle = color; ctx.fill('evenodd');
}

// ロボの組み立て画面用の絵
export function drawRoboPreview(canvas, robo, color, bob = 0) {
  const { ctx, w, h } = fitCanvas(canvas);
  const sc = Math.min(w / 230, h / 250);
  ctx.fillStyle = 'rgba(0,0,0,.08)';
  drawRobo(ctx, robo, { x: w / 2, y: h - 18, scale: sc, dir: 1, color, bob });
}

// レーダーチャート（SVG文字列）
export function radarSVG(stats, color = '#2b7de9', size = 190, labels = true) {
  const n = STAT_KEYS.length, c = size / 2, R = size / 2 - (labels ? 34 : 6);
  const pt = (i, r) => { const a = -Math.PI / 2 + i / n * Math.PI * 2; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  const ring = f => STAT_KEYS.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(',')).join(' ');
  const val = STAT_KEYS.map((k, i) => pt(i, R * Math.min(1, stats[k] / STAT_MAX[k])).map(v => v.toFixed(1)).join(',')).join(' ');
  let s = `<svg class="radar" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="ステータス">`;
  for (const f of [.33, .66, 1]) s += `<polygon class="grid" points="${ring(f)}"/>`;
  STAT_KEYS.forEach((_, i) => { const [x, y] = pt(i, R); s += `<line class="grid" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; });
  s += `<polygon points="${val}" fill="${color}" fill-opacity=".35" stroke="${color}" stroke-width="2"/>`;
  if (labels) STAT_KEYS.forEach((k, i) => {
    const [x, y] = pt(i, R + 15);
    s += `<text x="${x.toFixed(1)}" y="${(y - 4).toFixed(1)}">${STAT_NAMES[k]}</text><text class="num" x="${x.toFixed(1)}" y="${(y + 8).toFixed(1)}">${stats[k]}</text>`;
  });
  return s + '</svg>';
}
