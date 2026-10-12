// 謎の絵：Canvas 2D で描く簡単な線画（画像ファイルは使わない）。座標は 280×170 の仮想キャンバス
const INK = '#3b2f2a', RED = '#d62828', GRN = '#6a994e', BLU = '#3a86ff', BRN = '#8a5a2b';
export const PIC_W = 280, PIC_H = 170;

function line(c, pts, color, w) {
  c.strokeStyle = color; c.lineWidth = w;
  c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) c.lineTo(...p); c.stroke();
}

// 木：みき・えだ・根。marks で赤い印をつける
function tree(c, mark) {
  line(c, [[140, 145], [140, 45]], BRN, 9);
  line(c, [[140, 100], [108, 68]], BRN, 7);
  line(c, [[140, 100], [172, 68]], BRN, 7);
  line(c, [[140, 70], [124, 48]], BRN, 6);
  line(c, [[140, 70], [156, 48]], BRN, 6);
  line(c, [[140, 145], [116, 162]], BRN, 7);
  line(c, [[140, 145], [164, 162]], BRN, 7);
  if (mark === 'root') line(c, [[118, 128], [162, 128]], RED, 8);
  if (mark === 'top') line(c, [[120, 30], [160, 30]], RED, 8);
}

const PICS = {
  sun(c) {
    c.fillStyle = '#ffb703'; c.strokeStyle = '#e85d04'; c.lineWidth = 4;
    c.beginPath(); c.arc(140, 85, 36, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      line(c, [[140 + Math.cos(a) * 48, 85 + Math.sin(a) * 48], [140 + Math.cos(a) * 64, 85 + Math.sin(a) * 64]], '#e85d04', 5);
    }
  },
  moon(c) {
    c.fillStyle = '#ffd166'; c.strokeStyle = '#d4a017'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(150, 22); c.quadraticCurveTo(55, 85, 150, 148); c.quadraticCurveTo(108, 85, 150, 22); c.fill(); c.stroke();
    for (const [x, y] of [[200, 45], [225, 110], [90, 30]]) { line(c, [[x - 6, y], [x + 6, y]], '#d4a017', 3); line(c, [[x, y - 6], [x, y + 6]], '#d4a017', 3); }
  },
  mountain(c) {
    c.fillStyle = GRN; c.strokeStyle = INK; c.lineWidth = 4;
    c.beginPath(); c.moveTo(35, 142); c.lineTo(92, 62); c.lineTo(120, 100); c.lineTo(156, 30); c.lineTo(192, 102); c.lineTo(212, 76); c.lineTo(255, 142); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(156, 30); c.lineTo(142, 55); c.lineTo(156, 50); c.lineTo(170, 56); c.closePath(); c.fill();
  },
  tree(c) { tree(c); },
  river(c) {
    for (const x0 of [88, 140, 192]) {
      c.strokeStyle = BLU; c.lineWidth = 8; c.beginPath();
      for (let y = 18; y <= 152; y += 4) { const x = x0 + 9 * Math.sin(y / 13 + x0); y === 18 ? c.moveTo(x, y) : c.lineTo(x, y); }
      c.stroke();
    }
  },
  mouth(c) {
    c.fillStyle = '#e5383b'; c.strokeStyle = INK; c.lineWidth = 4;
    c.beginPath(); c.moveTo(78, 85); c.quadraticCurveTo(108, 38, 140, 60); c.quadraticCurveTo(172, 38, 202, 85); c.quadraticCurveTo(140, 140, 78, 85); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#5a0f1a'; c.beginPath(); c.ellipse(140, 88, 40, 17, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.fillRect(120, 73, 40, 8);
  },
  ue(c) { line(c, [[50, 105], [230, 105]], INK, 7); line(c, [[122, 72], [158, 72]], RED, 9); },
  shita(c) { line(c, [[50, 65], [230, 65]], INK, 7); line(c, [[122, 100], [158, 100]], RED, 9); },
  hon(c) { tree(c, 'root'); },
  sue(c) { tree(c, 'top'); },
  ha(c) {
    c.lineWidth = 4; c.strokeStyle = INK;
    c.fillStyle = BRN; c.beginPath(); c.roundRect(40, 68, 74, 26, 8); c.fill(); c.stroke();
    c.fillStyle = '#cfd8dc'; c.beginPath(); c.moveTo(114, 68); c.lineTo(205, 68); c.quadraticCurveTo(245, 76, 248, 112); c.lineTo(114, 94); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = RED; c.fillStyle = 'rgba(214,40,40,.25)'; c.lineWidth = 5;
    c.beginPath(); c.arc(190, 103, 11, 0, Math.PI * 2); c.fill(); c.stroke();
  },
};

export function drawPic(cv, id) {
  const dpr = 2;
  cv.width = PIC_W * dpr; cv.height = PIC_H * dpr;
  const c = cv.getContext('2d');
  c.scale(dpr, dpr); c.lineCap = 'round'; c.lineJoin = 'round';
  PICS[id](c);
}
