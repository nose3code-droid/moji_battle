// 文字タワーバトルの物理まわり：台・文字の駒・高さの見積もり・CPU の置き場所探索
// 物理は Rapier の 2D 版（rapier3d で軸を固定すると摩擦が効かず、積んだ字が滑り続けるため）
import { glyphPolygons, centerPolygons, buildPrisms } from '../../glyph.js';

export const GLYPH_SIZE = 1.4;      // 1em の大きさ（m）
export const DEPTH = 0.8;           // 文字の厚み（m）
export const DT = 1 / 60;
export const STAGE_W = 4.6;         // 台の幅（m）。上面が y=0
export const STAGE_H = 0.5;
export const FALL_Y = -0.8;         // 駒の中心がこれより下に行ったら「台から落ちた」
export const ROT_STEP = Math.PI / 4; // 回転は 45° 刻み
export const COL = 0.05;            // 左右の位置の刻み。高さの見積もりもこの幅の列で行う
const DROP_GAP = 0.5;               // 塔のいちばん高い所から、駒の下端までの落下の高さ
const FRICTION = 0.8;

export const angleOf = body => body.rotation();

// 1文字ぶんの形（当たり判定・見た目・重心など）を用意する
export function makeShape(font, ch) {
  const polys = glyphPolygons(font, ch, GLYPH_SIZE);
  if (!polys.length) return null;
  centerPolygons(polys);
  // 三角形分割は見た目と同じ buildPrisms のものを使い、手前の面の 2D 座標だけ取り出す
  // 細すぎる三角形は rapier2d が当たり判定を作れない（createCollider が例外になる）ので除く
  const tris = buildPrisms(polys, DEPTH).map(p => [p[0], p[1], p[3], p[4], p[6], p[7]]).filter(t => {
    const area2 = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]));
    const edge = Math.max(Math.hypot(t[2] - t[0], t[3] - t[1]), Math.hypot(t[4] - t[2], t[5] - t[3]), Math.hypot(t[0] - t[4], t[1] - t[5]));
    return area2 / edge > 0.004; // 最も長い辺に対する高さ（m）
  });
  if (!tris.length) return null;
  let A = 0, cx = 0, cy = 0;
  for (const t of tris) {
    const a = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2;
    A += a; cx += a * (t[0] + t[2] + t[4]) / 3; cy += a * (t[1] + t[3] + t[5]) / 3;
  }
  return { ch, polys, tris, com: { x: cx / A, y: cy / A }, pts: polys.flatMap(p => p.outer), bottoms: [] };
}

export function createWorld(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.81 });
  world.timestep = DT;
  const stage = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -STAGE_H / 2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(STAGE_W / 2, STAGE_H / 2).setFriction(FRICTION), stage);
  return world;
}

export function addBody(RAPIER, world, shape, x, y, a) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y).setRotation(a)
    .setAngularDamping(0.3)
    .setCcdEnabled(true));
  for (const t of shape.tris) {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(t));
    if (!desc) continue;
    try { world.createCollider(desc.setDensity(1).setFriction(FRICTION).setRestitution(0), body); } catch { /* 作れない形は無視 */ }
  }
  return body;
}

// 回転した輪郭の y の最小・最大
function extentY(shape, a) {
  const c = Math.cos(a), s = Math.sin(a);
  let lo = Infinity, hi = -Infinity;
  for (const q of shape.pts) { const y = q.x * s + q.y * c; if (y < lo) lo = y; if (y > hi) hi = y; }
  return { lo, hi };
}

// 置かれている駒のいちばん上の高さ
export function pieceTop(p) {
  const t = p.body.translation();
  return t.y + extentY(p.shape, angleOf(p.body)).hi;
}

// 塔のいちばん高い所から DROP_GAP 上に駒の下端が来る高さ
export function hoverY(shape, a, towerTop) {
  return Math.max(0, towerTop) + DROP_GAP - extentY(shape, a).lo;
}

// ---------- 高さの見積もり（列ごとの上端・下端） ----------
function rotTris(tris, a, ox, oy) {
  const c = Math.cos(a), s = Math.sin(a);
  return tris.map(t => {
    const r = new Array(6);
    for (let i = 0; i < 6; i += 2) { r[i] = t[i] * c - t[i + 1] * s + ox; r[i + 1] = t[i] * s + t[i + 1] * c + oy; }
    return r;
  });
}

// 三角形を x = k*COL の縦線で切り、列ごとの上端（useMax）か下端を out に集める
function sweep(tris, out, useMax) {
  for (const t of tris) {
    const x0 = Math.min(t[0], t[2], t[4]), x1 = Math.max(t[0], t[2], t[4]);
    for (let k = Math.ceil(x0 / COL); k * COL <= x1; k++) {
      const x = k * COL;
      let lo = Infinity, hi = -Infinity;
      for (let e = 0; e < 6; e += 2) {
        const ax = t[e], ay = t[e + 1], bx = t[(e + 2) % 6], by = t[(e + 3) % 6];
        if ((x - ax) * (x - bx) > 0) continue;
        if (ax === bx) { lo = Math.min(lo, ay, by); hi = Math.max(hi, ay, by); continue; }
        const y = ay + (by - ay) * (x - ax) / (bx - ax);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      if (lo > hi) continue;
      const v = useMax ? hi : lo, cur = out.get(k);
      if (cur === undefined || (useMax ? v > cur : v < cur)) out.set(k, v);
    }
  }
}

// 塔の上面：列番号 → 高さ。台の外の列は無い（＝支えが無い）
export function topProfile(pieces) {
  const top = new Map();
  for (let k = Math.ceil(-STAGE_W / 2 / COL - 1e-9); k * COL <= STAGE_W / 2 + 1e-9; k++) top.set(k, 0);
  for (const p of pieces) {
    if (p.fallen) continue;
    const t = p.body.translation();
    sweep(rotTris(p.shape.tris, angleOf(p.body), t.x, t.y), top, true);
  }
  return top;
}

// 駒の下面（回転ごとにキャッシュ）：[列番号, 中心から見た下端の高さ] の並び
export function bottomProfile(shape, r) {
  if (!shape.bottoms[r]) {
    const m = new Map();
    sweep(rotTris(shape.tris, r * ROT_STEP, 0, 0), m, false);
    shape.bottoms[r] = [...m];
  }
  return shape.bottoms[r];
}

// 列 j（x = j*COL）からまっすぐ落としたときに止まる中心の高さ。支えが無ければ -Infinity
export function landing(top, bottom, j) {
  let y = -Infinity;
  for (const [k, m] of bottom) {
    const t = top.get(j + k);
    if (t !== undefined && t - m > y) y = t - m;
  }
  return y;
}

// ---------- CPU：置き場所の探索 ----------
// まず高さの見積もりで全候補に点を付け、上位いくつかを物理で実際に落として確かめる。
// 重い処理なので generator にして、呼び出し側が数ミリ秒ずつ進める
export function* cpuPlan(RAPIER, pieces, hand, towerTop, verify) {
  const top = topProfile(pieces);
  const cands = [];
  const jMax = Math.round((STAGE_W / 2 + 0.6) / COL);
  for (let h = 0; h < hand.length; h++) {
    const shape = hand[h];
    for (let r = 0; r < 8; r++) {
      const a = r * ROT_STEP, c = Math.cos(a), s = Math.sin(a);
      const bottom = bottomProfile(shape, r);
      const comX = shape.com.x * c - shape.com.y * s;
      const hi = extentY(shape, a).hi;
      for (let j = -jMax; j <= jMax; j += 2) {
        const y = landing(top, bottom, j);
        if (y === -Infinity) continue;
        // 触れている列の左右の端。重心がその間にあれば倒れにくい
        let cmin = Infinity, cmax = -Infinity;
        for (const [k, m] of bottom) {
          const t = top.get(j + k);
          if (t !== undefined && t - m > y - 0.04) { const x = (j + k) * COL; if (x < cmin) cmin = x; if (x > cmax) cmax = x; }
        }
        const gx = j * COL + comX;
        const margin = Math.min(gx - cmin, cmax - gx);
        if (margin < 0.03) continue;
        const score = Math.min(margin, 0.6) * 3 + Math.min(cmax - cmin, 1.5) - (y + hi) * 0.6 - Math.abs(gx) * 0.3;
        cands.push({ h, r, x: j * COL, score });
      }
      yield;
    }
  }
  cands.sort((a, b) => b.score - a.score);

  // 似た候補ばかりを試さないよう間引く
  const picked = [];
  for (const c of cands) {
    if (picked.length >= verify) break;
    if (picked.some(p => p.h === c.h && p.r === c.r && Math.abs(p.x - c.x) < 0.4)) continue;
    picked.push(c);
  }
  if (!picked.length) return { h: 0, r: 0, x: 0, score: -999 }; // どこも無理：とりあえず真ん中へ

  // 今の塔を写した練習用のワールドで試す（rapier2d 0.21 は restoreSnapshot したワールドに駒を足せないため作り直す）
  const now = pieces.filter(p => !p.fallen).map(p => ({ shape: p.shape, t: p.body.translation(), a: angleOf(p.body), v: p.body.linvel(), w: p.body.angvel() }));
  let best = null;
  for (const c of picked) {
    const shape = hand[c.h], a = c.r * ROT_STEP;
    const sim = createWorld(RAPIER);
    const before = new Map();
    for (const p of now) {
      const b = addBody(RAPIER, sim, p.shape, p.t.x, p.t.y, p.a);
      b.setLinvel(p.v, true); b.setAngvel(p.w, true);
      before.set(b.handle, p.t);
    }
    const y0 = hoverY(shape, a, towerTop);
    const body = addBody(RAPIER, sim, shape, c.x, y0, a);
    for (let i = 0; i < 150; i++) {
      sim.step();
      if (i % 25 === 24) yield;
    }
    let fell = false, moved = 0;
    sim.bodies.forEach(b => {
      if (!b.isDynamic()) return;
      const t = b.translation();
      if (t.y < FALL_Y) fell = true;
      const p = before.get(b.handle);
      if (p) moved = Math.max(moved, Math.hypot(t.x - p.x, t.y - p.y));
    });
    const drift = Math.abs(body.translation().x - c.x);
    sim.free();
    const total = fell ? c.score - 100 : c.score - drift * 3 - moved * 4;
    if (!best || total > best.total) best = { ...c, total };
    yield;
  }
  return best;
}
