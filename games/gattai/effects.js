// 文字がったいの見た目の演出：合体のときに飛び散る粒、輪っか、光の柱、画面のゆれ、必殺技の名前
import * as THREE from 'three';

// ---------- 粒の形（白で描いておき、色は材質で付ける） ----------
const SIZE = 64;
function makeTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = g.strokeStyle = '#fff';
  g.translate(SIZE / 2, SIZE / 2);
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const star = (g, n, ro, ri) => {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / n;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath(); g.fill();
};
const SHAPES = {
  dot: g => { g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill(); },
  leaf: g => {
    g.beginPath(); g.ellipse(0, 0, 13, 28, 0.5, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-12, 22); g.lineTo(12, -22); g.stroke();
  },
  flame: g => {
    g.beginPath(); g.moveTo(0, -30);
    g.bezierCurveTo(18, -6, 22, 8, 0, 28); g.bezierCurveTo(-22, 8, -18, -6, 0, -30); g.fill();
  },
  star: g => star(g, 5, 30, 13),
  spark: g => star(g, 4, 30, 6),
  heart: g => {
    g.beginPath(); g.moveTo(0, 26);
    g.bezierCurveTo(-34, 2, -22, -30, 0, -12); g.bezierCurveTo(22, -30, 34, 2, 0, 26); g.fill();
  },
  shard: g => { g.beginPath(); g.moveTo(-24, 18); g.lineTo(4, -28); g.lineTo(26, 10); g.lineTo(2, 24); g.closePath(); g.fill(); },
  square: g => g.fillRect(-20, -20, 40, 40),
  note: g => {
    g.beginPath(); g.ellipse(-8, 16, 12, 9, -0.4, 0, Math.PI * 2); g.fill();
    g.fillRect(1, -26, 5, 42);
    g.beginPath(); g.moveTo(6, -26); g.quadraticCurveTo(24, -18, 18, -2); g.quadraticCurveTo(18, -14, 6, -14); g.fill();
  },
};
let textures = null;
const tex = name => {
  textures ??= Object.fromEntries(Object.entries(SHAPES).map(([k, f]) => [k, makeTex(f)]));
  return textures[name];
};

// 合体エフェクトの種類（recipes.js の BASE の4つめで選ぶ）
//   shape：粒の形　colors：色　n：粒の数　speed：飛び出す速さ　gravity：重力（＋で上へ）
//   life：消えるまでの秒　size：粒の大きさ（m）　ring：輪っかの色　shake：画面のゆれ
export const KINDS = {
  leaf:     { shape: 'leaf',   colors: [0x43a047, 0x81c784, 0x2e7d32, 0xc0ca33], n: 14, speed: 3.2, gravity: -2.5, life: 1.3, size: 0.28, spin: 4 },
  flame:    { shape: 'flame',  colors: [0xff5722, 0xff9800, 0xffc107, 0xe53935], n: 18, speed: 2.2, gravity: 5, life: 0.8, size: 0.32, ring: 0xff7043 },
  note:     { shape: 'note',   colors: [0xef6c00, 0x8d6e63, 0xffa726], n: 9, speed: 2.4, gravity: 1.5, life: 1.1, size: 0.34, ring: 0xffb74d },
  confetti: { shape: 'square', colors: [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0x8e24aa], n: 20, speed: 4, gravity: -6, life: 1.2, size: 0.14, spin: 9 },
  sun:      { shape: 'spark',  colors: [0xffd54f, 0xffb300, 0xfff59d], n: 14, speed: 3.8, gravity: 0, life: 0.8, size: 0.32, ring: 0xffe082 },
  moon:     { shape: 'star',   colors: [0x9fa8da, 0xfff9c4, 0x5c6bc0], n: 12, speed: 1.8, gravity: 0.3, life: 1.3, size: 0.26, spin: 2 },
  heart:    { shape: 'heart',  colors: [0xec407a, 0xf48fb1, 0xff80ab], n: 10, speed: 2, gravity: 2.2, life: 1.2, size: 0.3 },
  toy:      { shape: 'star',   colors: [0xab47bc, 0x29b6f6, 0xffca28, 0x66bb6a], n: 12, speed: 3.4, gravity: -5, life: 1.1, size: 0.26, spin: 6 },
  rock:     { shape: 'shard',  colors: [0x6d8b74, 0x8d6e63, 0x5d4037], n: 12, speed: 3.5, gravity: -10, life: 1, size: 0.24, spin: 8, shake: 0.08 },
  stone:    { shape: 'shard',  colors: [0x90a4ae, 0x607d8b, 0xb0bec5], n: 12, speed: 3.5, gravity: -10, life: 1, size: 0.24, spin: 8, shake: 0.1 },
  field:    { shape: 'square', colors: [0x9ccc65, 0xd4e157, 0x795548], n: 12, speed: 2.6, gravity: -3, life: 1, size: 0.18, spin: 3 },
  power:    { shape: 'spark',  colors: [0xffee58, 0xffffff, 0x7e57c2], n: 14, speed: 5, gravity: 0, life: 0.5, size: 0.36, ring: 0x9575cd, shake: 0.08 },
  white:    { shape: 'dot',    colors: [0xffffff, 0xfff8e1], n: 16, speed: 3, gravity: 0, life: 0.6, size: 0.18 },
};

const PLANE = new THREE.PlaneGeometry(1, 1);
const RING = new THREE.RingGeometry(0.86, 1, 48);
const Z = 0.9; // 字（厚み 0.6）より手前に描く

export function createFx(scene) {
  const items = []; // { mesh, t, life, vx, vy, gravity, spin, grow, fade, shrink }
  let shake = 0;

  function add(mesh, o) {
    scene.add(mesh);
    items.push({ mesh, t: 0, vx: 0, vy: 0, gravity: 0, spin: 0, grow: 0, shrink: false, op: mesh.material.opacity, ...o });
  }
  const mat = (color, map, opacity = 1) => new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

  // 粒を飛び散らせる。power は 1 が普通の合体、大きいほど派手に
  function burst(x, y, kindName, power = 1, opt = {}) {
    const k = KINDS[kindName] ?? KINDS.white;
    const n = Math.round(k.n * (0.6 + power * 0.5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = k.speed * (0.4 + Math.random() * 0.8) * (0.8 + power * 0.25);
      const m = new THREE.Mesh(PLANE, mat(k.colors[i % k.colors.length], tex(k.shape)));
      const s = k.size * (0.7 + Math.random() * 0.6) * (0.9 + power * 0.15);
      m.scale.set(s, s, 1);
      m.rotation.z = Math.random() * Math.PI * 2;
      const r = opt.spread ?? 0.2;
      m.position.set(x + Math.cos(a) * r * Math.random(), y + Math.sin(a) * r * Math.random(), Z);
      let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
      if (opt.inward) { // 外から中心へ集まる
        m.position.set(x + Math.cos(a) * opt.inward, y + Math.sin(a) * opt.inward, Z);
        vx = -Math.cos(a) * opt.inward * 1.6; vy = -Math.sin(a) * opt.inward * 1.6;
      }
      if (opt.up) { vx *= 0.3; vy = Math.abs(vy) * 0.5 + opt.up; }
      add(m, { vx, vy, gravity: opt.inward ? 0 : k.gravity, spin: (Math.random() - 0.5) * (k.spin ?? 1.5), life: k.life * (0.7 + Math.random() * 0.6) * (opt.inward ? 0.6 : 1), shrink: true });
    }
    if (k.ring) ring(x, y, k.ring, 0.9 + power * 0.5, 0.45);
    if (k.shake) addShake(k.shake * power);
  }

  // 広がる輪っか
  function ring(x, y, color, radius, life = 0.5, shrinkIn = false) {
    const m = new THREE.Mesh(RING, mat(color, null, 0.85));
    m.position.set(x, y, Z);
    const s0 = shrinkIn ? radius : 0.2;
    m.scale.set(s0, s0, 1);
    add(m, { life, grow: (shrinkIn ? 0.05 - radius : radius - 0.2) / life });
  }

  // たてかよこの光の帯（beam・row の必殺技用）
  function band(x, y, w, h, color, life = 0.7) {
    const m = new THREE.Mesh(PLANE, mat(color, null, 0.75));
    m.position.set(x, y, Z - 0.05);
    m.scale.set(w, h, 1);
    add(m, { life });
    const core = new THREE.Mesh(PLANE, mat(0xffffff, null, 0.9));
    core.position.set(x, y, Z);
    core.scale.set(w > h ? w : w * 0.35, w > h ? h * 0.35 : h, 1);
    add(core, { life: life * 0.7 });
  }

  function addShake(v) { shake = Math.min(0.5, shake + v); }

  function update(dt) {
    for (const it of items) {
      it.t += dt;
      const m = it.mesh, f = it.t / it.life;
      it.vy += it.gravity * dt;
      if (it.gravity < 0) { it.vx *= 1 - dt * 1.2; } // 落ちる粒は空気でゆっくりに
      m.position.x += it.vx * dt; m.position.y += it.vy * dt;
      m.rotation.z += it.spin * dt;
      if (it.grow) { const s = Math.max(0.01, m.scale.x + it.grow * dt); m.scale.set(s, s, 1); }
      if (it.shrink && f > 0.6) { const s = m.scale.x * (1 - dt * 3); m.scale.set(s, s, 1); }
      m.material.opacity = it.op * Math.min(1, (1 - f) * 2.5);
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].t >= items[i].life) {
        scene.remove(items[i].mesh); items[i].mesh.material.dispose();
        items.splice(i, 1);
      }
    }
    shake = Math.max(0, shake - dt * 0.8);
  }

  // 画面のゆれ（カメラをずらす量）
  function shakeOffset() {
    return shake > 0 ? { x: (Math.random() - 0.5) * shake, y: (Math.random() - 0.5) * shake } : { x: 0, y: 0 };
  }

  function clear() {
    for (const it of items) { scene.remove(it.mesh); it.mesh.material.dispose(); }
    items.length = 0;
    shake = 0;
  }

  return { burst, ring, band, addShake, update, shakeOffset, clear };
}

// 画面全体を一瞬光らせる
export function flash(color = '#fff') {
  const el = document.createElement('div');
  el.className = 'flash';
  el.style.background = color;
  document.body.append(el);
  setTimeout(() => el.remove(), 600);
}

// 必殺技の名前を大きく出す
export function banner(ch, name) {
  document.querySelector('.special-banner')?.remove();
  const el = document.createElement('div');
  el.className = 'special-banner';
  el.innerHTML = `<span class="glyph">${ch}</span><b>${name}！</b>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}
