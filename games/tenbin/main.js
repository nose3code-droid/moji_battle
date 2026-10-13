// 文字てんびん：字の重さ（画数）で天秤をつり合わせるパズル。ルールは logic.js、面は stages.js、字のデータは kanji.js
// 天秤の絵は Canvas 2D、字のカードは DOM。カードは皿の動きに合わせて毎フレーム位置を更新する
import { FONT_URL } from '../../config.js';
import { BY_CH, FACTS } from './kanji.js';
import { STAGES, TYPES } from './stages.js';
import { weightOf, totals, usedCount, isSolved, isBalanced, allSolutions, nearestSolution, starsFor } from './logic.js';

const SAVE_KEY = 'moji_tenbin.save';
const SPEED = new URLSearchParams(location.search).has('fast') ? 4 : 1; // ?fast は自動テスト用（ゆれが早く落ち着く）
const $ = id => document.getElementById(id);

// ---------- 保存 ----------
let save = { stars: {} };
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (d && typeof d === 'object') save = { stars: d.stars || {} };
} catch (e) { /* 保存データが無い・壊れていてもはじめから遊べる */ }
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続行 */ } }

// ---------- フォント（読めなければふつうの文字で表示） ----------
(async () => {
  try {
    const face = new FontFace('MojiTenbin', `url(${FONT_URL})`);
    document.fonts.add(await face.load());
  } catch (e) {
    $('load-state').textContent = '（フォントを読めなかったので、ふつうの文字で表示します）';
  }
})();

// ---------- ゲーム状態 ----------
let stageIdx = 0, stage = STAGES[0], P = 2, par = 1, sols = [];
let assign = [], plateOrder = [], hints = 0, busy = true, winAt = 0;
let hintCard = -1, hintPlate = -1;
let fixedEls = [], handEls = [], slotEls = [];
const phys = { th: 0, w: 0, sag: 0, sv: 0 }; // 天秤のかたむき（ばね）と、真ん中の皿のたるみ
const sparks = [];

// ---------- 画面の寸法 ----------
const stageEl = $('stage'), canvas = $('scale'), ctx = canvas.getContext('2d'), pansEl = $('pans');
let W = 300, H = 300, dpr = 1, geo = null;
function resize() {
  W = stageEl.clientWidth; H = stageEl.clientHeight;
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  geo = null;
}
addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);

function makeGeo() {
  const three = P === 3;
  const L = three ? Math.min(0.34 * W, 130) : Math.min(0.28 * W, 150);
  const pw = three ? L * 0.92 : L * 1.56;
  const hang = H * 0.34;
  return {
    px: W / 2, py: H * 0.17, L, pw, hang, three,
    xs: three ? [-L, 0, L] : [-L, L],
    base: H - 16,
  };
}

// 皿 p の位置（th は天秤のかたむき）。x,y は皿の床の中心、ax,ay はつり下げ点
function ensureGeo() { if (geo === null || geo.three !== (P === 3)) geo = makeGeo(); return geo; }
function panPos(p) {
  const g = ensureGeo();
  if (g.three && p === 1) return { x: g.px, y: g.py + g.hang * 1.1 + phys.sag, ax: g.px, ay: g.py };
  const ex = g.px + g.xs[p] * Math.cos(phys.th), ey = g.py + g.xs[p] * Math.sin(phys.th);
  return { x: ex, y: ey + g.hang, ax: ex, ay: ey };
}

// ---------- カードの DOM ----------
function cardHTML(item) {
  if (typeof item === 'number') return `<small>おもり</small><span class="n">${item}</span>`;
  return `<span class="glyph">${item}</span><span class="n">${weightOf(item)}</span>`;
}
function makeCard(item, cls) {
  const el = document.createElement('div');
  el.className = `tcard ${cls}`;
  el.innerHTML = cardHTML(item);
  return el;
}

function showInfo(item) {
  if (typeof item === 'number') { $('info').innerHTML = `おもり <b>${item}</b>`; return; }
  const k = BY_CH.get(item);
  $('info').innerHTML = `「${k.ch}」（${k.yomi}）… <b>${k.n}画</b>`;
}

let toastTimer = 0;
function toast(t, ms = 1800) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- 面のはじまり ----------
function startStage(i) {
  stageIdx = i; stage = STAGES[i]; P = stage.plates.length;
  sols = allSolutions(stage);
  par = Math.min(...sols.map(usedCount));
  hints = 0; busy = false; winAt = 0; hintCard = -1; hintPlate = -1; sparks.length = 0;
  assign = stage.hand.map(() => -1);
  plateOrder = stage.plates.map(() => []);
  phys.th = 0; phys.w = 0; phys.sag = 0; phys.sv = 0;
  pansEl.innerHTML = ''; $('hand').innerHTML = '';
  fixedEls = stage.plates.map((items, p) => items.map(it => {
    const el = makeCard(it, typeof it === 'number' ? 'fixed weight onpan' : 'fixed onpan');
    el.addEventListener('pointerdown', () => showInfo(it));
    pansEl.appendChild(el);
    return el;
  }));
  slotEls = []; handEls = [];
  stage.hand.forEach((ch, k) => {
    const slot = document.createElement('div');
    slot.className = 'slot has';
    const el = makeCard(ch, '');
    el.addEventListener('pointerdown', e => onDown(e, k));
    slot.appendChild(el);
    $('hand').appendChild(slot);
    slotEls.push(slot); handEls.push(el);
  });
  const ty = TYPES[stage.type];
  $('stage-name').textContent = `${i + 1}. ${stage.name}`;
  $('rule').textContent = `【${ty.label}】${ty.rule}`;
  $('info').textContent = '';
  $('title').hidden = true; $('result').hidden = true;
  resize();
  refresh();
}

// ---------- カードの移動 ----------
function setPlate(k, p) {
  const el = handEls[k];
  const old = assign[k];
  if (old >= 0) plateOrder[old] = plateOrder[old].filter(x => x !== k);
  assign[k] = p;
  if (p >= 0) {
    plateOrder[p].push(k);
    if (!el.classList.contains('onpan')) { el.classList.add('onpan'); el.style.width = el.style.height = ''; pansEl.appendChild(el); slotEls[k].classList.remove('has'); }
  } else if (el.classList.contains('onpan')) {
    el.classList.remove('onpan'); el.style.transform = ''; el.style.width = el.style.height = el.style.fontSize = '';
    slotEls[k].appendChild(el); slotEls[k].classList.add('has');
  }
  hintCard = -1; hintPlate = -1;
  refresh();
}

function lightestPlate() {
  const t = totals(stage, assign);
  return t.indexOf(Math.min(...t));
}

// 手元の字・皿の字のドラッグ（動かさずに離したらタップ：手元→かるい皿、皿→手元）
function onDown(e, k) {
  if (busy || (e.button != null && e.button > 0)) return;
  e.preventDefault();
  showInfo(stage.hand[k]);
  const el = handEls[k];
  const sx = e.clientX, sy = e.clientY;
  let clone = null;
  const move = ev => {
    if (!clone && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
      clone = document.createElement('div');
      clone.className = 'tcard dragging';
      clone.innerHTML = el.innerHTML;
      document.body.appendChild(clone);
      el.classList.add('ghost');
    }
    if (clone) clone.style.transform = `translate(${ev.clientX - 26}px, ${ev.clientY - 29}px)`;
  };
  const up = ev => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    el.classList.remove('ghost');
    if (clone) {
      clone.remove();
      if (ev.type === 'pointercancel') return;
      const p = pickPlate(ev.clientX, ev.clientY);
      if (p !== assign[k]) setPlate(k, p);
    } else if (ev.type === 'pointerup') {
      setPlate(k, assign[k] >= 0 ? -1 : lightestPlate());
    }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  move(e);
}

// 離した場所に近い皿。天秤のエリアの外なら -1（手元にもどる）
function pickPlate(x, y) {
  const r = stageEl.getBoundingClientRect();
  if (x < r.left - 8 || x > r.right + 8 || y < r.top - 8 || y > r.bottom + 8) return -1;
  let best = 0, bd = Infinity;
  for (let p = 0; p < P; p++) {
    const pos = panPos(p);
    const d = Math.abs(r.left + pos.x - x) + Math.abs(r.top + pos.y - y) * 0.3;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ---------- 状態の反映・クリア判定 ----------
function refresh() {
  $('used').textContent = usedCount(assign);
  if (!busy && isSolved(stage, assign)) win();
}

function win() {
  busy = true; winAt = performance.now();
  setTimeout(showResult, 1100 / SPEED);
}

function showResult() {
  const used = usedCount(assign);
  const stars = starsFor(used, par, hints);
  save.stars[stageIdx] = Math.max(save.stars[stageIdx] || 0, stars);
  writeSave();
  $('result-title').textContent = `${stageIdx + 1}. ${stage.name} クリア！`;
  $('result-stars').innerHTML = [1, 2, 3].map(n => `<span class="${n <= stars ? '' : 'off'}">★</span>`).join('');
  const chips = stage.hand.filter((_, k) => assign[k] >= 0).map(ch => {
    const k = BY_CH.get(ch);
    return `<span class="chip"><span class="glyph">${ch}</span> ${k.yomi} ${k.n}画</span>`;
  }).join('');
  $('result-sub').innerHTML = `${chips}<br>使った字 ${used} 枚（さいしょう ${par} 枚）・ヒント ${hints} 回`;
  // 豆知識：使った字・載っていた字に一言があればそれ、なければ面ごとの豆知識
  const seen = [...stage.plates.flat(), ...stage.hand.filter((_, k) => assign[k] >= 0)];
  const noted = seen.map(ch => BY_CH.get(ch)).find(k => k && k.note);
  $('result-fact').textContent = noted ? `豆知識：「${noted.ch}」… ${noted.note}` : `豆知識：${FACTS[stageIdx % FACTS.length]}`;
  $('result-next').hidden = stageIdx >= STAGES.length - 1;
  $('result').hidden = false;
}

// ---------- ボタン ----------
$('btn-reset').onclick = () => { if (busy) return; handEls.forEach((_, k) => { if (assign[k] >= 0) setPlate(k, -1); }); };
$('btn-hint').onclick = () => {
  if (busy) return;
  const sol = nearestSolution(stage, assign);
  const k = sol.findIndex((p, i) => p !== assign[i]);
  if (k < 0) return;
  hints++;
  hintCard = k;
  if (sol[k] < 0) { hintPlate = -1; toast(`「${stage.hand[k]}」は、はずしてみよう`); }
  else { hintPlate = sol[k]; toast(`「${stage.hand[k]}」を光っている皿にのせよう`); }
  handEls.forEach((el, i) => el.classList.toggle('hinted', i === k));
};
$('btn-select').onclick = () => { buildGrid(); $('title-close').hidden = false; $('title').hidden = false; };
$('title-close').onclick = () => { $('title').hidden = true; };
$('result-next').onclick = () => startStage(stageIdx + 1);
$('result-retry').onclick = () => startStage(stageIdx);
$('result-select').onclick = () => { $('result').hidden = true; buildGrid(); $('title-close').hidden = true; $('title').hidden = false; };

const unlocked = i => i === 0 || (save.stars[i - 1] || 0) > 0;
function buildGrid() {
  const g = $('stage-grid'); g.innerHTML = '';
  let last = '';
  STAGES.forEach((st, i) => {
    if (st.type !== last) {
      last = st.type;
      const lb = document.createElement('div'); lb.className = 'group-label'; lb.textContent = TYPES[st.type].label; g.appendChild(lb);
    }
    const b = document.createElement('button');
    const s = save.stars[i] || 0, ok = unlocked(i);
    b.className = 'stage-btn' + (ok ? '' : ' locked');
    b.innerHTML = `<b>${i + 1}</b><small>${ok ? '★'.repeat(s) + '☆'.repeat(3 - s) : '🔒'}</small>`;
    b.dataset.stage = i;
    b.onclick = () => { if (ok) startStage(i); else toast('前の面をクリアすると遊べるよ'); };
    g.appendChild(b);
  });
}

// ---------- 描画 ----------
const PAN_COLORS = [['#ff9eb5', '#e0678a'], ['#ffe08a', '#d9a521'], ['#7cc4ff', '#3f8fd6']];
const panColor = p => (P === 2 ? PAN_COLORS[p === 0 ? 0 : 2] : PAN_COLORS[p]);

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function drawScene(now) {
  const g = geo, c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const tot = totals(stage, assign);
  const balanced = tot.every(w => w === tot[0]);
  const won = winAt > 0;
  const wt = won ? (now - winAt) / 1000 : 0;

  // 光（クリア時）
  if (won) {
    const a = Math.min(1, wt * 2) * (0.75 + 0.25 * Math.sin(wt * 6));
    const gr = c.createRadialGradient(g.px, g.py, 5, g.px, g.py, Math.max(W, H) * 0.7);
    gr.addColorStop(0, `rgba(255,240,150,${0.85 * a})`); gr.addColorStop(1, 'rgba(255,240,150,0)');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.save(); c.translate(g.px, g.py); c.rotate(wt * 0.6);
    c.fillStyle = `rgba(255,224,102,${0.28 * a})`;
    for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(-18, -Math.max(W, H)); c.lineTo(18, -Math.max(W, H)); c.fill(); }
    c.restore();
  }

  // 台とはしら
  c.fillStyle = '#c98f4a';
  roundRect(c, g.px - 70, g.base - 10, 140, 22, 10); c.fill();
  c.fillStyle = '#b57a36'; roundRect(c, g.px - 8, g.py, 16, g.base - g.py - 4, 5); c.fill();
  c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(g.px - 4, g.py + 6, 3, g.base - g.py - 18);

  // 皿のひも・皿
  const pans = [];
  for (let p = 0; p < P; p++) pans.push(panPos(p));
  pans.forEach((pos, p) => {
    c.strokeStyle = '#8a6a3a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(pos.x - g.pw / 2, pos.y); c.lineTo(pos.ax, pos.ay); c.lineTo(pos.x + g.pw / 2, pos.y); c.stroke();
  });

  // はり
  c.save(); c.translate(g.px, g.py); c.rotate(phys.th);
  const half = g.L + 18;
  const bg = c.createLinearGradient(0, -8, 0, 8); bg.addColorStop(0, '#ffcf70'); bg.addColorStop(1, '#e0932a');
  c.fillStyle = bg; roundRect(c, -half, -7, half * 2, 14, 7); c.fill();
  c.fillStyle = '#c47a1c';
  for (const x of g.xs) { if (!(g.three && x === 0)) { c.beginPath(); c.arc(x, 0, 6, 0, 7); c.fill(); } }
  c.restore();

  pans.forEach((pos, p) => {
    const [fill, edge] = panColor(p);
    const hinted = p === hintPlate;
    c.save();
    c.beginPath(); c.moveTo(pos.x - g.pw / 2 - 4, pos.y); c.quadraticCurveTo(pos.x, pos.y + g.pw * 0.5, pos.x + g.pw / 2 + 4, pos.y); c.closePath();
    c.fillStyle = fill; c.strokeStyle = hinted ? '#ff9f1c' : edge; c.lineWidth = hinted ? 5 : 2.5;
    if (hinted) { c.shadowColor = '#ff9f1c'; c.shadowBlur = 18 + 8 * Math.sin(now / 120); }
    c.fill(); c.stroke();
    c.restore();
    c.fillStyle = edge; c.beginPath(); c.arc(pos.x, pos.y, 4, 0, 7); c.fill();
    // 合計
    c.font = 'bold 17px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = balanced ? '#fff' : '#fff'; c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3;
    const ty = pos.y + g.pw * 0.17;
    c.strokeText(tot[p], pos.x, ty); c.fillText(tot[p], pos.x, ty);
  });

  // 支点
  c.fillStyle = won ? '#fff08a' : '#ffd24a'; c.strokeStyle = '#b8801c'; c.lineWidth = 3;
  c.beginPath(); c.arc(g.px, g.py, 11, 0, 7); c.fill(); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(g.px - 3, g.py - 3, 3.5, 0, 7); c.fill();
  // 支点の上の星：つり合うと光る
  const starOn = balanced && usedCount(assign) > 0;
  c.save(); c.translate(g.px, g.py - 26); c.rotate(won ? wt * 2 : 0);
  c.fillStyle = starOn ? '#ffe35a' : '#e2d4b8'; c.strokeStyle = starOn ? '#e0a800' : '#c8b78f'; c.lineWidth = 2;
  c.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 13, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath(); c.fill(); c.stroke(); c.restore();

  // きらきら
  if (won && wt < 2.2 && sparks.length < 80) {
    for (let i = 0; i < 2; i++) {
      const pos = pans[Math.floor(Math.random() * P)];
      sparks.push({ x: pos.x + (Math.random() - .5) * g.pw, y: pos.y - 10, vx: (Math.random() - .5) * 90, vy: -60 - Math.random() * 90, life: 1, hue: 40 + Math.random() * 30 });
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx * 0.016; s.y += s.vy * 0.016; s.vy += 140 * 0.016; s.life -= 0.016;
    if (s.life <= 0) { sparks.splice(i, 1); continue; }
    c.fillStyle = `hsla(${s.hue},100%,62%,${s.life})`;
    c.beginPath(); c.arc(s.x, s.y, 3 + 2 * s.life, 0, 7); c.fill();
  }
}

// 皿の上のカードを並べる
function layoutCards() {
  const g = geo;
  for (let p = 0; p < P; p++) {
    const els = [...fixedEls[p], ...plateOrder[p].map(k => handEls[k])];
    const n = els.length;
    if (!n) continue;
    const pos = panPos(p);
    const cols = g.three && n <= 4 ? 2 : n > 6 ? 4 : 3;
    const gap = 3;
    const s = Math.min(46, (g.pw - 12) / cols - gap);
    const hgt = s * 1.1;
    els.forEach((el, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const inRow = Math.min(cols, n - row * cols);
      const x0 = pos.x - (inRow * s + (inRow - 1) * gap) / 2;
      const x = x0 + col * (s + gap), y = pos.y - (row + 1) * (hgt + gap) + gap;
      if (el._s !== s) { el.style.width = s + 'px'; el.style.height = hgt + 'px'; el.style.fontSize = s * 0.58 + 'px'; el._s = s; }
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }
}

// ---------- メインループ ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000) * SPEED; last = now;
  ensureGeo();
  // かたむきの目標：右の皿が重いほど右が下がる
  const tot = totals(stage, assign);
  const diff = tot[P - 1] - tot[0];
  const target = 0.4 * Math.tanh(diff / 5);
  const sagT = geo.three ? Math.max(-26, Math.min(26, (tot[1] - (tot[0] + tot[2]) / 2) * 3)) : 0;
  const K = 60, C = 4.2;
  phys.w += (-K * (phys.th - target) - C * phys.w) * dt; phys.th += phys.w * dt;
  phys.sv += (-K * (phys.sag - sagT) - C * phys.sv) * dt; phys.sag += phys.sv * dt;
  drawScene(now);
  layoutCards();
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
resize();
buildGrid();
startStage(0);
$('title').hidden = false; // 最初は面セレクト（タイトル）
busy = false;
requestAnimationFrame(frame);

// 自動テスト用
window.__tenbin = {
  get state() { return { stageIdx, assign: assign.slice(), hints, busy, par, won: winAt > 0, th: phys.th, tot: totals(stage, assign), solved: isSolved(stage, assign), balanced: isBalanced(stage, assign) }; },
  get save() { return save; },
  startStage,
  // 皿 p の画面上の位置（自動テストのドラッグ先）
  panScreen(p) { const r = stageEl.getBoundingClientRect(), q = panPos(p); return [r.left + q.x, r.top + q.y - 30]; },
};
