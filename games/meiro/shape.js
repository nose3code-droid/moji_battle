// 字の形：中心を原点にした「ワールド座標」（y は下向き）で、内側判定 inside(x,y) と描画 draw(ctx) を持つ
// - polygonShape：フォントの輪郭（glyph.js）から作る。正確で、いつもこちらを使う
// - canvasShape ：フォントや CDN が読めないときの代わり。canvas に字を描いたマスクで判定する

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonShape(glyph, font, text, em) {
  const polys = [];
  let offset = 0;
  for (const ch of text) {
    for (const p of glyph.glyphPolygons(font, ch, em)) {
      for (const q of p.outer) q.x += offset;
      for (const h of p.holes) for (const q of h) q.x += offset;
      polys.push(p);
    }
    offset += font.getAdvanceWidth(ch, em) || em;
  }
  const size = glyph.centerPolygons(polys);
  const items = polys.map(({ outer, holes }) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    return { outer, holes, x0, x1, y0, y1 };
  });
  return {
    kind: 'outline',
    W: size.x, H: size.y,
    inside(x, y) {
      y = -y; // 輪郭は y 上向き
      for (const p of items) {
        if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) continue;
        if (pointInRing(x, y, p.outer) && !p.holes.some(h => pointInRing(x, y, h))) return true;
      }
      return false;
    },
    draw(ctx) {
      ctx.beginPath();
      for (const { outer, holes } of items) {
        for (const ring of [outer, ...holes]) {
          ring.forEach((q, i) => (i ? ctx.lineTo(q.x, -q.y) : ctx.moveTo(q.x, -q.y)));
          ctx.closePath();
        }
      }
      ctx.fill('evenodd');
    },
  };
}

export function canvasShape(text, em, family) {
  const n = [...text].length;
  const cw = Math.ceil(em * (n + 1)), ch = Math.ceil(em * 2);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d', { willReadFrequently: true });
  const font = `700 ${em}px ${family}`;
  const bx = em * 0.5, by = em * 1.3;
  c.font = font; c.textBaseline = 'alphabetic'; c.fillStyle = '#000';
  c.fillText(text, bx, by);
  const data = c.getImageData(0, 0, cw, ch).data;
  let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (data[(y * cw + x) * 4 + 3] > 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) throw new Error('この字は表示できません');
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  return {
    kind: 'canvas',
    W: x1 - x0 + 1, H: y1 - y0 + 1,
    inside(x, y) {
      const px = Math.round(x + cx - 0.5), py = Math.round(y + cy - 0.5);
      return px >= 0 && py >= 0 && px < cw && py < ch && data[(py * cw + px) * 4 + 3] > 100;
    },
    draw(ctx) {
      ctx.font = font; ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, bx - cx, by - cy);
    },
  };
}
