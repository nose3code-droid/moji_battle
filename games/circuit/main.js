import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { TRACKS, buildTrack } from './tracks.js';
import { buildMachine, machinePath } from './machine.js';
import { DT, DIFFICULTY, physicsFromStats, makeCar, makeWorld, stepWorld, ranking, aiInput, clamp } from './sim.js';

const BEST_KEY = 'moji_circuit.best';          // { "コースID|文字": { lap, race } }
const GHOST_KEY = 'moji_circuit.ghost.';       // + "コースID|文字" → { t, d: [x*2, y*2, h*100, ...] }（2tickごと）
const LAPS = 3;
const PRESETS = ['〇', 'ー', '鬱', '星', '木', '口', '龍', 'S', 'I', 'あ'];
const RIVAL_POOL = ['〇', 'ー', '鬱', '星', '木', '口', '龍', 'S', 'I', 'あ', '田', '山'];
const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5'];
const COUNT_TICKS = 180;      // 3・2・1
const EM = 44;                // 文字1em の大きさ（ワールド単位）

const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } },
};

let font = null;
let sel = { text: '〇', track: 0, diff: 'normal' };
let phase = 'menu';           // menu / count / race / finish / result
let world = null, machines = [], gfx = null, aiConf = null;
let countTicks = 0, goTicks = 0, finishTicks = 0;
let auto = new URLSearchParams(location.search).has('auto'); // 自動操縦（確認用）
let speedMul = 1;
let ghost = null, rec = null, bestRec = null;
const cam = { x: 0, y: 0 };
const trackCache = new Map();
const getTrack = i => { if (!trackCache.has(i)) trackCache.set(i, buildTrack(TRACKS[i])); return trackCache.get(i); };

const fmt = s => s == null ? '―' : `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`.replace(/^0:/, '');
const keyOf = (ti, text) => `${TRACKS[ti].id}|${text}`;

// ---------- 入力 ----------
const keys = new Set();
const touches = new Map();
let brakeBtn = false;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); touches.clear(); brakeBtn = false; });
canvas.addEventListener('pointerdown', e => { touches.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1); canvas.setPointerCapture?.(e.pointerId); });
const endTouch = e => touches.delete(e.pointerId);
canvas.addEventListener('pointerup', endTouch); canvas.addEventListener('pointercancel', endTouch);
canvas.addEventListener('pointermove', e => { if (touches.has(e.pointerId)) touches.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1); });
const brakeEl = $('brake');
brakeEl.addEventListener('pointerdown', e => { brakeBtn = true; brakeEl.classList.add('on'); brakeEl.setPointerCapture?.(e.pointerId); });
for (const ev of ['pointerup', 'pointercancel']) brakeEl.addEventListener(ev, () => { brakeBtn = false; brakeEl.classList.remove('on'); });

function playerInput() {
  let s = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) s -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) s += 1;
  for (const d of touches.values()) s += d;
  const brake = brakeBtn || keys.has('Space') || keys.has('ArrowDown') || keys.has('KeyS') || keys.has('ShiftLeft') || keys.has('ShiftRight');
  return { steer: clamp(s, -1, 1), brake };
}

// ---------- マシン ----------
function rivalChars(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const pool = RIVAL_POOL.filter(c => !text.includes(c));
  const out = [];
  for (let i = 0; out.length < 3; i++) { const c = pool[(h + i) % pool.length]; if (!out.includes(c)) out.push(c); }
  return out;
}

function traitLine(st) {
  const t = [];
  if (st.grip >= 0.75) t.push('コーナーに強い');
  if (st.grip <= 0.4) t.push('曲がりにくい');
  if (st.speed >= 0.65) t.push('最高速が高い');
  if (st.speed <= 0.2) t.push('最高速は低め');
  if (st.accel <= 0.4) t.push('加速が遅い');
  if (st.mass >= 0.6) t.push('重くて当たり負けしない');
  if (st.spiky >= 0.5) t.push('壁に当たると大きく減速');
  return t.length ? t.join('・') : 'バランス型';
}

function statBar(cls, name, v) { return `<div class="stat ${cls}"><span>${name}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`; }

function updateMenu() {
  const text = [...sel.text].slice(0, 2).join('');
  $('go').disabled = !font || !text;
  if (!font || !text) return;
  let m;
  try { m = buildMachine(font, text); } catch (e) { console.error(e); $('msg').textContent = 'この文字は使えません'; $('go').disabled = true; return; }
  $('msg').textContent = '';
  sel.machine = m;
  const st = m.stats;
  $('stats').innerHTML = statBar('g', 'グリップ', st.grip) + statBar('s', '最高速', st.speed) + statBar('a', '加速', st.accel) + statBar('m', '重さ', st.mass) + statBar('k', '角の多さ', st.spiky);
  $('trait').textContent = traitLine(st);
  const pc = $('preview').getContext('2d');
  pc.clearRect(0, 0, 80, 80);
  pc.save(); pc.translate(40, 40);
  const sc = text.length === 1 ? 52 : 36;
  const p = machinePath(m.polys, sc);
  pc.fillStyle = COLORS[0]; pc.strokeStyle = '#fff'; pc.lineWidth = 3; pc.lineJoin = 'round';
  pc.stroke(p); pc.fill(p, 'evenodd'); pc.restore();
  for (const b of $('presets').children) b.classList.toggle('on', b.dataset.c === text);
  const best = store.get(BEST_KEY)?.[keyOf(sel.track, text)];
  $('records').innerHTML = best ? `この字×このコースのベスト：ラップ <b>${fmt(best.lap)}</b>　レース <b>${fmt(best.race)}</b>` : 'この字×このコースの記録はまだありません';
  $('rivals').innerHTML = 'ライバル：' + rivalChars(text).map((c, i) => `<b style="background:${COLORS[i + 1]}">${c}</b>`).join('');
}

function setupMenu() {
  $('presets').innerHTML = PRESETS.map(c => `<button data-c="${c}">${c}</button>`).join('');
  $('presets').onclick = e => { const c = e.target.dataset?.c; if (c) { $('char').value = c; sel.text = c; updateMenu(); } };
  $('char').oninput = e => { sel.text = e.target.value; updateMenu(); };
  $('tracks').innerHTML = TRACKS.map((t, i) => `<button data-i="${i}">${t.name}<small>${t.desc}</small></button>`).join('');
  $('tracks').onclick = e => { const b = e.target.closest('button'); if (b) { sel.track = +b.dataset.i; markChoice(); updateMenu(); } };
  $('diffs').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<button data-k="${k}">${d.name}</button>`).join('');
  $('diffs').onclick = e => { const b = e.target.closest('button'); if (b) { sel.diff = b.dataset.k; markChoice(); } };
  markChoice();
}
function markChoice() {
  for (const b of $('tracks').children) b.classList.toggle('on', +b.dataset.i === sel.track);
  for (const b of $('diffs').children) b.classList.toggle('on', b.dataset.k === sel.diff);
}

// ---------- レースの準備 ----------
function buildWorld(text, ti, diff) {
  const tr = getTrack(ti);
  const mine = buildMachine(font, text);
  const rivals = rivalChars(text).map(c => buildMachine(font, c));
  const ms = [mine, ...rivals];
  // スタート順：プレイヤーは最後尾（4番手）
  const slots = [3, 0, 1, 2];
  const cars = ms.map((m, i) => makeCar(i, physicsFromStats(m.stats), tr, slots[i], i === 0));
  return { w: makeWorld(tr, cars, LAPS), ms, conf: DIFFICULTY[diff] };
}

function startRace() {
  const text = [...sel.text].slice(0, 2).join('');
  if (!font || !text) return;
  sel.text = text;
  const b = buildWorld(text, sel.track, sel.diff);
  world = b.w; machines = b.ms; aiConf = b.conf;
  machines.forEach((m, i) => { m.color = COLORS[i]; m.scale = m.text.length === 1 ? EM : EM * 0.78; m.path = machinePath(m.polys, m.scale); });
  gfx = trackGfx(world.track);
  const k = keyOf(sel.track, text);
  ghost = store.get(GHOST_KEY + k);
  bestRec = store.get(BEST_KEY)?.[k] || null;
  rec = null; countTicks = COUNT_TICKS; goTicks = 0; finishTicks = 0;
  phase = 'count';
  $('menu').hidden = true; $('result').hidden = true; $('hud').hidden = false;
  $('hint').hidden = false; $('brake').hidden = false;
  setTimeout(() => { if (phase !== 'menu') $('hint').hidden = true; }, 9000);
  const p = world.cars[0]; cam.x = p.x; cam.y = p.y;
  buildBoard();
}

function backToMenu() {
  phase = 'menu'; world = null;
  $('menu').hidden = false; $('result').hidden = true; $('hud').hidden = true; $('count').textContent = '';
  $('hint').hidden = true; $('brake').hidden = true;
  updateMenu();
}

// ---------- 進行 ----------
function tick() {
  if (phase === 'count') {
    countTicks--;
    if (countTicks <= 0) { phase = 'race'; goTicks = 50; }
    return;
  }
  if (phase !== 'race' && phase !== 'finish') return;
  const p = world.cars[0];
  const inp = auto ? aiInput(p, world, { ...DIFFICULTY.hard, rb: 0 }, null) : playerInput();
  stepWorld(world, inp, aiConf);
  if (goTicks > 0) goTicks--;
  for (const ev of world.events) if (ev.type === 'cross' && ev.car === p) onPlayerCross(ev);
  if (rec && phase === 'race' && (world.tick - rec.start) % 2 === 0) rec.d.push(Math.round(p.x * 2), Math.round(p.y * 2), Math.round(p.h * 100));
  if (p.finishTick >= 0 && phase === 'race') { phase = 'finish'; finishTicks = 100; }
  if (phase === 'finish' && --finishTicks <= 0) showResult();
}

function onPlayerCross(ev) {
  const p = ev.car;
  // 直前の1周が終わった：ベストなら保存（表示中のゴーストは今回のレースが終わるまで前のまま）
  if (ev.c >= 2 && rec) {
    const lap = p.lapTimes[p.lapTimes.length - 1];
    if (!bestRec || lap < (bestRec.lap ?? Infinity)) {
      const all = store.get(BEST_KEY) || {}, k = keyOf(sel.track, sel.text);
      all[k] = { ...(all[k] || {}), lap }; bestRec = all[k]; store.set(BEST_KEY, all);
      store.set(GHOST_KEY + k, { t: lap, d: rec.d });
      p.newBestLap = true;
    }
  }
  rec = ev.c <= LAPS ? { start: ev.tick, d: [Math.round(p.x * 2), Math.round(p.y * 2), Math.round(p.h * 100)] } : null;
}

function showResult() {
  // 残りの車はまとめて先へ進めて順位を決める
  const p = world.cars[0];
  for (let i = 0; i < 60 * 60 && world.cars.some(c => c.finishTick < 0); i++) stepWorld(world, { steer: 0, brake: false }, aiConf);
  phase = 'result';
  const rank = ranking(world);
  const myRank = rank.indexOf(p) + 1;
  const race = p.finishTick * DT;
  const k = keyOf(sel.track, sel.text);
  const all = store.get(BEST_KEY) || {};
  const newRace = !all[k]?.race || race < all[k].race;
  if (newRace) { all[k] = { ...(all[k] || {}), race }; store.set(BEST_KEY, all); }
  $('r-title').textContent = myRank === 1 ? '🏆 優勝！' : `${myRank}位でゴール`;
  $('r-sub').textContent = `${TRACKS[sel.track].name}・${DIFFICULTY[sel.diff].name}・${LAPS}周`;
  $('r-list').innerHTML = rank.map((c, i) => {
    const m = machines[c.id];
    const t = c.finishTick >= 0 ? fmt(c.finishTick * DT) : '未完走';
    return `<li class="${c === p ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="ch" style="background:${m.color}">${m.text}</span><span>${c === p ? 'あなた' : 'CPU'}</span><span class="tm">${t}</span></li>`;
  }).join('');
  const fast = Math.min(...p.lapTimes);
  $('r-times').innerHTML = `ラップ：${p.lapTimes.map(fmt).join(' / ')}<br>最速ラップ <b>${fmt(fast)}</b>${p.newBestLap ? ' <span class="new">ベスト更新！</span>' : ''}`
    + `<br>レースタイム <b>${fmt(race)}</b>${newRace ? ' <span class="new">ベスト更新！</span>' : ''}`
    + `<br>この字×このコースのベスト：ラップ ${fmt(all[k]?.lap)} / レース ${fmt(all[k]?.race)}`;
  $('result').hidden = false; $('hud').hidden = true; $('hint').hidden = true; $('brake').hidden = true;
  window.__lastResult = { rank: rank.map(c => ({ text: machines[c.id].text, tick: c.finishTick, me: c === p })), lapTimes: p.lapTimes.slice(), race, myRank };
}

$('go').onclick = startRace;
$('again').onclick = startRace;
$('change').onclick = backToMenu;
$('quit').onclick = backToMenu;

// ---------- 描画 ----------
function trackGfx(tr) {
  const line = new Path2D(), left = new Path2D(), right = new Path2D();
  const kc = tr.halfW - tr.kerbW / 2;
  for (let i = 0; i <= tr.N; i++) {
    const j = i % tr.N;
    const f = (p, o) => { const x = tr.x[j] + tr.nx[j] * o, y = tr.y[j] + tr.ny[j] * o; if (i === 0) p.moveTo(x, y); else p.lineTo(x, y); };
    f(line, 0); f(left, kc); f(right, -kc);
  }
  return { line, left, right };
}

function drawTrack(tr, g, sc) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  const stroke = (p, w, c, dash) => { ctx.setLineDash(dash || []); ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke(p); };
  stroke(g.line, (tr.wallPos + 7) * 2, '#d8d8d8');           // 壁
  stroke(g.line, tr.wallPos * 2, '#b8935a');                 // ダート
  stroke(g.line, tr.halfW * 2, '#3a3d44');                   // 舗装
  stroke(g.left, tr.kerbW, '#e03131', [16, 16]); stroke(g.right, tr.kerbW, '#e03131', [16, 16]);
  ctx.lineDashOffset = 16; stroke(g.left, tr.kerbW, '#fff', [16, 16]); stroke(g.right, tr.kerbW, '#fff', [16, 16]);
  ctx.lineDashOffset = 0;
  stroke(g.line, 2, 'rgba(255,255,255,.35)', [14, 18]);
  ctx.setLineDash([]);
  // スタートライン（チェッカー）
  const x = tr.x[0], y = tr.y[0], nx = tr.nx[0], ny = tr.ny[0], tx = tr.tx[0], ty = tr.ty[0];
  const cells = 12, cw = tr.halfW * 2 / cells;
  for (let r = 0; r < 2; r++) for (let c = 0; c < cells; c++) {
    ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
    const o = -tr.halfW + c * cw, px = x + nx * o + tx * (r - 1) * 5, py = y + ny * o + ty * (r - 1) * 5;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx * cw, py + ny * cw); ctx.lineTo(px + nx * cw + tx * 5, py + ny * cw + ty * 5); ctx.lineTo(px + tx * 5, py + ty * 5); ctx.closePath(); ctx.fill();
  }
}

function drawMachine(m, x, y, h, alpha, isMe) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(h + Math.PI / 2);
  ctx.globalAlpha = alpha;
  if (isMe) { ctx.beginPath(); ctx.arc(0, 0, m.scale * 0.75, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.translate(2, 3); ctx.fill(m.path, 'evenodd'); ctx.translate(-2, -3);
  ctx.lineJoin = 'round'; ctx.lineWidth = 2.2; ctx.strokeStyle = '#fff'; ctx.stroke(m.path);
  ctx.fillStyle = m.color; ctx.fill(m.path, 'evenodd');
  ctx.restore();
}

function ghostPose() {
  const p = world.cars[0];
  if (!ghost || p.c < 1 || p.c > LAPS || phase === 'count') return null;
  const i = (world.tick - p.crossTicks[p.c]) / 2, d = ghost.d, n = d.length / 3;
  if (i < 0 || i >= n - 1) return null;
  const a = Math.floor(i), u = i - a, g = (k, o) => d[(a + k) * 3 + o];
  let dh = (g(1, 2) - g(0, 2)) / 100; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { x: (g(0, 0) + (g(1, 0) - g(0, 0)) * u) / 2, y: (g(0, 1) + (g(1, 1) - g(0, 1)) * u) / 2, h: g(0, 2) / 100 + dh * u };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  return dpr;
}

function draw() {
  const dpr = resize(), W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#4c8a3f'; ctx.fillRect(0, 0, W, H);
  if (!world) {
    // メニュー中は選択中のコースを遠景で表示
    const tr = getTrack(sel.track), bb = tr.bbox;
    const sc = Math.min(W / (bb.maxX - bb.minX), H / (bb.maxY - bb.minY));
    ctx.setTransform(sc, 0, 0, sc, W / 2 - (bb.minX + bb.maxX) / 2 * sc, H / 2 - (bb.minY + bb.maxY) / 2 * sc);
    drawTrack(tr, sel.gfx?.id === tr.id ? sel.gfx : (sel.gfx = { id: tr.id, ...trackGfx(tr) }), sc);
    return;
  }
  const tr = world.track, p = world.cars[0];
  const sc = Math.min(W, H) / 380 * (innerWidth < 600 ? 1.15 : 1);
  const tx = p.x + p.vx * 0.25, ty = p.y + p.vy * 0.25;
  cam.x += (tx - cam.x) * 0.15; cam.y += (ty - cam.y) * 0.15;
  ctx.setTransform(sc, 0, 0, sc, W / 2 - cam.x * sc, H / 2 - cam.y * sc);
  drawTrack(tr, gfx, sc);
  const gp = ghostPose();
  if (gp) drawMachine(machines[0], gp.x, gp.y, gp.h, 0.3, false);
  const order = world.cars.slice().sort((a, b) => (a === p) - (b === p));
  for (const c of order) drawMachine(machines[c.id], c.x, c.y, c.h, 1, c === p);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHud();
}

function buildBoard() {
  $('board').innerHTML = world.cars.map(c => `<li data-id="${c.id}"><span class="rk"></span><b style="background:${COLORS[c.id]}">${machines[c.id].text}</b></li>`).join('');
}

function drawHud() {
  const p = world.cars[0], rank = ranking(world);
  $('lap').textContent = `${clamp(Math.max(p.c, 1), 1, LAPS)}/${LAPS}`;
  $('pos').textContent = `${rank.indexOf(p) + 1}/${rank.length}`;
  const t0 = p.finishTick >= 0 ? p.finishTick : world.tick;
  $('time').textContent = fmt(phase === 'count' ? 0 : t0 * DT);
  $('laptime').textContent = p.c >= 1 && p.c <= LAPS ? fmt((world.tick - p.crossTicks[p.c]) * DT) : p.finishTick >= 0 ? fmt(p.lapTimes[p.lapTimes.length - 1]) : '0.00';
  $('bestlap').textContent = fmt(bestRec?.lap);
  const board = $('board');
  rank.forEach((c, i) => { const li = board.querySelector(`[data-id="${c.id}"]`); li.firstChild.textContent = `${i + 1}`; li.classList.toggle('me', c === p); board.appendChild(li); });
  $('count').textContent = phase === 'count' ? String(Math.ceil(countTicks / 60)) : goTicks > 0 ? 'GO!' : phase === 'finish' ? 'ゴール！' : '';
  // ミニマップ
  const mc = $('mini'), m = mc.getContext('2d'), tr = world.track, bb = tr.bbox;
  m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, mc.width, mc.height);
  const s = Math.min((mc.width - 12) / (bb.maxX - bb.minX), (mc.height - 12) / (bb.maxY - bb.minY));
  m.setTransform(s, 0, 0, s, mc.width / 2 - (bb.minX + bb.maxX) / 2 * s, mc.height / 2 - (bb.minY + bb.maxY) / 2 * s);
  m.lineJoin = 'round'; m.lineWidth = 3 / s; m.strokeStyle = 'rgba(255,255,255,.8)'; m.stroke(gfx.line);
  for (const c of world.cars) { m.beginPath(); m.arc(c.x, c.y, (c === p ? 6 : 4.5) / s, 0, Math.PI * 2); m.fillStyle = COLORS[c.id]; m.fill(); }
}

// ---------- ループ ----------
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000) * speedMul; last = now;
  let n = 0;
  while (acc >= DT && n++ < 600) { tick(); acc -= DT; }
  if (acc > DT) acc = 0;
  draw();
  requestAnimationFrame(frame);
}

// ---------- 確認用 ----------
// 自動操縦のタイムトライアル（画面なし）：字ごとの性能とタイムの比較に使う
function bench(text, ti, diff = 'hard') {
  const tr = getTrack(ti), m = buildMachine(font, text);
  const w = makeWorld(tr, [makeCar(0, physicsFromStats(m.stats), tr, 0, false)], LAPS);
  const conf = { ...DIFFICULTY[diff], rb: 0 };
  while (w.cars[0].finishTick < 0 && w.tick < 60 * 600) stepWorld(w, null, conf);
  const c = w.cars[0];
  return { text, stats: m.stats, lapTimes: c.lapTimes, finish: c.finishTick, hits: c.hits };
}
// 4台の完全なレースを自動操縦で（同じ入力なら同じ結果になるかの確認にも）
function headlessRace(text, ti, diff = 'normal') {
  const b = buildWorld(text, ti, diff);
  const w = b.w;
  while (w.cars.some(c => c.finishTick < 0) && w.tick < 60 * 600) stepWorld(w, aiInput(w.cars[0], w, { ...DIFFICULTY.hard, rb: 0 }, null), b.conf);
  return ranking(w).map(c => ({ text: b.ms[c.id].text, tick: c.finishTick, me: c.human }));
}
window.__circuit = {
  bench, headlessRace, buildMachine: t => buildMachine(font, t).stats,
  setAuto: v => { auto = !!v; }, setSpeed: v => { speedMul = v; },
  start: (o = {}) => { Object.assign(sel, o); if (o.text) $('char').value = o.text; startRace(); },
  state: () => ({ phase, tick: world?.tick, result: window.__lastResult }),
};

// ---------- 起動 ----------
setupMenu();
requestAnimationFrame(frame);
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  $('msg').textContent = '';
  updateMenu();
  window.__circuit.ready = true;
} catch (e) {
  console.error(e);
  $('msg').textContent = 'フォントの読み込みに失敗しました（ネットワークを確認してください）';
}
