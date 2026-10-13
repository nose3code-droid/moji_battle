// 文字クレーンゲーム：画面・操作・図鑑・保存。物理とルールは sim.js
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { CraneSim, DT, CHANCES, HUB_MIN, HUB_MAX } from './sim.js';
import { makePrize, hasGlyph } from './prizes.js';
import { STAGES } from './stages.js';
import { ZUKAN } from './zukan.js';
import { createRenderer } from './render.js';

const SAVE_KEY = 'moji_crane.v1';
const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 保存 ----------
let save = { zukan: {}, best: {}, stage: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s === 'object') save = { ...save, ...s }; } catch { /* 保存なしで始める */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } };

// ---------- 状態 ----------
let font = null;
let sim = null;
let stageIndex = Math.min(save.stage | 0, STAGES.length - 1);
let screen = 'title';          // title | play | result
const prizeCache = new Map();
let focus = null;              // 性格を表示している景品
let aimTarget = null;          // タップで指定した位置
let effects = [];
let overTimer = 0;
const held = { left: false, right: false };
let dropReq = false;

await RAPIER.init();
const canvas = $('view');
const renderer = createRenderer(canvas, 'MojiCrane');

function prizeOf(ch, scale = 1) {
  const key = ch + '@' + scale;
  if (!prizeCache.has(key)) prizeCache.set(key, makePrize(font, ch, scale));
  return prizeCache.get(key);
}
function buildStage(i) {
  const st = STAGES[i];
  const defs = st.chars.filter(c => hasGlyph(font, c)).map(c => prizeOf(c, (st.big && st.big[c]) || 1)).filter(Boolean);
  return new CraneSim(RAPIER, defs, st);
}

// ---------- 画面 ----------
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
function showInfo(p) {
  focus = p;
  if (!p) { $('info-ch').textContent = '？'; $('info-title').textContent = '字をタップ、またはアームを重ねると性格が出ます'; $('info-bars').innerHTML = ''; return; }
  const z = ZUKAN[p.ch] || {}, t = p.def.traits;
  $('info-ch').textContent = p.ch;
  $('info-title').textContent = `${p.ch}（${z.yomi || ''}）${p.def.strokes}画` + (p.def.scale > 1 ? ' 大物！' : '');
  $('info-bars').innerHTML =
    `<span>おもさ <i>${stars(t.weightStars)}</i></span>` +
    `<span>すべりやすさ <i>${stars(t.slipStars)}</i></span>` +
    `<span>ひっかかり <i>${stars(t.catchStars)}</i></span>` +
    (t.hook ? '<span><em>穴あり：ピンを通せる</em></span>' : '');
}
function updateHud() {
  $('stage-name').textContent = STAGES[stageIndex].name;
  $('chances').textContent = sim ? '●'.repeat(sim.chances) + '○'.repeat(CHANCES - sim.chances) : '―';
  $('score').textContent = sim ? sim.score : 0;
  const ctrl = sim && screen === 'play';
  $('drop').disabled = !(ctrl && sim.state === 'aim');
  $('left').disabled = $('right').disabled = !(ctrl && sim.state === 'aim');
}
let toastTimer = 0;
function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
}

function renderStages() {
  $('stages').innerHTML = STAGES.map((s, i) => `
    <button type="button" data-i="${i}" class="${i === stageIndex ? 'on' : ''}">
      <span class="g">${s.glyph}</span><span class="t"><b>${i + 1}. ${s.name}</b>${s.desc}</span>
      <span class="s">最高 ${save.best[s.id] ?? '―'}</span>
    </button>`).join('');
}
$('stages').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  stageIndex = +b.dataset.i; save.stage = stageIndex; persist(); renderStages();
});

function startGame() {
  sim = buildStage(stageIndex);
  screen = 'play'; focus = null; aimTarget = null; effects = []; overTimer = 0;
  $('title').hidden = true; $('result').hidden = true; $('zukan').hidden = true;
  showInfo(null); updateHud();
}
$('start').addEventListener('click', startGame);
$('retry').addEventListener('click', startGame);
$('to-title').addEventListener('click', () => { screen = 'title'; $('result').hidden = true; $('title').hidden = false; renderStages(); });

function finish() {
  screen = 'result';
  const st = STAGES[stageIndex];
  const prev = save.best[st.id] ?? 0;
  const isBest = sim.score > prev;
  if (isBest) save.best[st.id] = sim.score;
  persist();
  $('result-title').textContent = sim.score > 0 ? `${sim.score} 点！` : '残念…ゼロ点';
  $('result-sub').textContent = `${st.name}　取れた字 ${sim.caught.length} 個` + (isBest && sim.score > 0 ? '　ハイスコア更新！' : `　最高 ${Math.max(prev, sim.score)} 点`);
  $('result-got').innerHTML = sim.caught.map(p => `<span>${p.ch}</span>`).join('');
  $('result').hidden = false;
  updateHud();
}

// ---------- 図鑑 ----------
const ALL_CHARS = [...new Set(STAGES.flatMap(s => s.chars))];
function openZukan(sel) {
  $('zukan').hidden = false;
  const got = ALL_CHARS.filter(c => save.zukan[c]).length;
  $('zcount').textContent = `${got} / ${ALL_CHARS.length}`;
  $('zgrid').innerHTML = ALL_CHARS.map(c => {
    const n = save.zukan[c] | 0;
    return `<button type="button" data-c="${c}" class="${n ? '' : 'no'} ${c === sel ? 'on' : ''}">${n ? c : '？'}${n ? `<small>×${n}</small>` : ''}</button>`;
  }).join('');
  const c = sel;
  if (!c) { $('zdetail').textContent = '取った字をタップすると、くわしく見られます。'; return; }
  const z = ZUKAN[c], n = save.zukan[c] | 0;
  $('zdetail').innerHTML = n
    ? `<span class="big">${c}</span><span>読み：${z.yomi}<br>画数：${z.strokes}画（得点 ${z.strokes}）<br>取った回数：${n}回<br>${z.note}</span>`
    : '<span class="big">？</span><span>まだ取っていない字です。</span>';
}
$('zgrid').addEventListener('click', e => { const b = e.target.closest('button'); if (b) openZukan(b.dataset.c); });
$('open-zukan').addEventListener('click', () => openZukan(null));
$('result-zukan').addEventListener('click', () => openZukan(null));
$('zclose').addEventListener('click', () => { $('zukan').hidden = true; });

// ---------- 操作 ----------
const bindHold = (id, key) => {
  const el = $(id);
  const on = e => { e.preventDefault(); held[key] = true; aimTarget = null; };
  const off = () => { held[key] = false; };
  el.addEventListener('pointerdown', on);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, off);
};
bindHold('left', 'left'); bindHold('right', 'right');
$('drop').addEventListener('pointerdown', e => { e.preventDefault(); dropReq = true; });
addEventListener('keydown', e => {
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
  if (e.code === 'ArrowLeft') { held.left = true; aimTarget = null; e.preventDefault(); }
  else if (e.code === 'ArrowRight') { held.right = true; aimTarget = null; e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'ArrowDown') { dropReq = true; e.preventDefault(); }
});
addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft') held.left = false;
  if (e.code === 'ArrowRight') held.right = false;
});
// 字をタップ：性格を表示して、その真上へアームを寄せる
canvas.addEventListener('pointerdown', e => {
  if (screen !== 'play' || !sim) return;
  const r = canvas.getBoundingClientRect(), w = renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  let best = null, bd = Infinity;
  for (const p of sim.alive()) {
    const b = p.body.translation(), d = Math.hypot(b.x - w.x, b.y - w.y);
    if (d < p.def.radius && d < bd) { best = p; bd = d; }
  }
  if (best) { showInfo(best); if (sim.state === 'aim') aimTarget = best.body.translation().x; }
  else if (sim.state === 'aim' && w.y > 0) aimTarget = w.x;
});

function currentInput() {
  let dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  if (!dir && aimTarget !== null && sim.state === 'aim') {
    const d = Math.max(HUB_MIN, Math.min(HUB_MAX, aimTarget)) - sim.hx;
    if (Math.abs(d) < 0.03) aimTarget = null; else dir = d > 0 ? 1 : -1;
  }
  const drop = dropReq; dropReq = false;
  return { dir, drop };
}

// アームの真下にある景品（いちばん上のもの）を、性格の表示対象にする
function pickUnderArm() {
  let best = null, by = -Infinity;
  for (const p of sim.alive()) {
    const b = p.body.translation();
    if (Math.abs(b.x - sim.hx) < p.def.radius * 0.7 && b.y > by) { best = p; by = b.y; }
  }
  return best;
}

function handleEvents() {
  for (const ev of sim.events) {
    if (ev.type === 'get') {
      const p = ev.prize, first = !save.zukan[p.ch];
      save.zukan[p.ch] = (save.zukan[p.ch] | 0) + 1; persist();
      toast(`${p.ch} ゲット！ +${p.def.strokes}点` + (first ? '　図鑑に登録！' : ''));
      const b = p.body.translation(); effects.push({ x: b.x, y: b.y, age: 0, life: 1.2 });
    } else if (ev.type === 'hook') toast('ピンが穴に通った！');
    else if (ev.type === 'unhook') toast('ピンから外れた…');
    else if (ev.type === 'slip') toast(`${ev.prize.ch} が滑り落ちる！`);
    else if (ev.type === 'turnEnd' && !ev.gained.length) toast('取れなかった…');
  }
  sim.events.length = 0;
}

// ---------- メインループ ----------
let acc = 0, last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
  if (sim && screen === 'play') {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      sim.step(currentInput());
      handleEvents();
      if (sim.state === 'over' && !overTimer) overTimer = 1;
    }
    if (sim.state === 'aim' && !held.left && !held.right && aimTarget === null) { const u = pickUnderArm(); if (u && u !== focus) showInfo(u); }
    if (overTimer && (overTimer -= dt) <= 0) { overTimer = 0; finish(); }
    updateHud();
  }
  for (const e of effects) e.age += dt;
  effects = effects.filter(e => e.age < e.life);
  if (sim) renderer.draw(sim, { time: clock, focus, effects, stageName: STAGES[stageIndex].name });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 動作確認用：画面なしで物理を進める・新しい盤面を作る
window.__crane = {
  RAPIER, STAGES, ZUKAN, get sim() { return sim; }, get font() { return font; },
  buildStage, makePrize: (ch, s) => prizeOf(ch, s), CraneSim,
  start(i) { stageIndex = i; startGame(); return sim; },
  run(n, input) { for (let k = 0; k < n; k++) { sim.step(input); } sim.events.length = 0; },
  get screen() { return screen; },
};

// ---------- フォント読み込み ----------
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf);
  try { // 画面の文字も同じフォントにする（形が同じに見えるように）
    const face = new FontFace('MojiCrane', buf.slice(0));
    document.fonts.add(await face.load());
  } catch { /* 表示用なので失敗してもよい */ }
  msg('');
  renderStages();
  $('start').disabled = false;
  $('start').textContent = 'スタート';
  window.__crane.ready = true;
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
updateHud();
renderStages();
