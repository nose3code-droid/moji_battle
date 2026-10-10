// なぞり魔法：画面・操作・演出・進行（ゲームの中身は game.js、面とセリフは stages.js、判定は trace.js）
import { FONT_URL } from '../../config.js';
import { RING, ELEMS, STAGES, SPEAKERS, beats, counterOf } from './stages.js';
import { createGame, update, castPlan, applyHit, finalScore, avgAcc, MIN_ACC, WARD, HEARTS } from './game.js';
import { R, BRUSH, template, evaluate, scanRuns, fit, setFamily } from './trace.js';
import { Fx } from './fx.js';

const SAVE_KEY = 'moji_nazori.save';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search); // テスト用の近道：?stage=N 直接開始 / ?skip=1 会話を飛ばす＋全面解放 / ?slow=0.2 時間をゆっくり
const SKIP = params.has('skip');
const SLOW = params.has('slow') ? +params.get('slow') : 1;
const FAMILY = 'MojiNazori, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';

// ---------- 進行状況（クリアと最高スコア） ----------
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && Array.isArray(s.best)) return { best: STAGES.map((_, i) => s.best[i] | 0), cleared: STAGES.map((_, i) => !!(s.cleared && s.cleared[i])) }; } catch { /* 無ければ初期状態 */ }
  return { best: STAGES.map(() => 0), cleared: STAGES.map(() => false) };
}
let save = loadSave();
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } }
const unlocked = i => SKIP || i === 0 || save.cleared[i - 1];
const firstOpen = () => { const i = save.cleared.findIndex(c => !c); return i < 0 ? STAGES.length - 1 : i; };

// ---------- フォント（取れなくても遊べる） ----------
async function loadFont() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(FONT_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('font ' + res.status);
    document.fonts.add(await new FontFace('MojiNazori', await res.arrayBuffer(), { weight: '100 900' }).load());
  } catch (e) { console.warn('フォントを読み込めなかったので代わりのフォントで表示します', e); }
  setFamily(FAMILY);
}

// ---------- 状態 ----------
const field = $('field'), fctx = field.getContext('2d');
const pad = $('pad'), pctx = pad.getContext('2d');
let mode = 'title';            // title | talk | play | result | select
let cur = 0, game = null, sel = '火';
let strokes = [], drawing = null;
let fx = new Fx();
let fW = 0, fH = 0, pP = 0, dpr = 1;
let padFlash = 0, padFlashColor = '#fff';
let toastT = 0, shake = 0, tNow = 0, shownMsg = '';
let talkQueue = [], talkDone = null;
const pendingFly = new Set();   // 飛んでいる最中の魔法の数（終了判定の前に待つ）

window.__nazori = { // テスト用
  get game() { return game; }, get mode() { return mode; }, get save() { return save; }, get sel() { return sel; },
  runs: ch => scanRuns(ch), padRect: () => pad.getBoundingClientRect().toJSON(), R, BRUSH,
};

function toast(msg, sec = 2.4) { $('toast').textContent = msg; toastT = sec; }

// ---------- 相性の輪 ----------
function buildRing() {
  const cx = 52, cy = 52, rad = 36;
  const pos = RING.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad }; });
  let svg = `<svg viewBox="0 0 104 104"><defs><marker id="ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8z" fill="#e9e6ff"/></marker></defs>`;
  svg += `<circle cx="52" cy="52" r="50" fill="rgba(13,15,28,.6)"/>`;
  RING.forEach((ch, i) => {
    const a = pos[i], b = pos[(i + 1) % 5];
    const d = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    svg += `<line id="rl${i}" x1="${a.x + ux * 14}" y1="${a.y + uy * 14}" x2="${b.x - ux * 15}" y2="${b.y - uy * 15}" stroke="#e9e6ff" stroke-width="2" marker-end="url(#ah)" opacity=".8"/>`;
  });
  RING.forEach((ch, i) => {
    svg += `<circle id="rn${i}" cx="${pos[i].x}" cy="${pos[i].y}" r="13" fill="${ELEMS[ch].color}" stroke="#fff" stroke-width="1.5"/>`;
    svg += `<text x="${pos[i].x}" y="${pos[i].y + 6}" text-anchor="middle" font-size="17" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width=".6">${ch}</text>`;
  });
  svg += `<text x="52" y="50" text-anchor="middle" font-size="8" fill="#e9e6ff" style="font-family:sans-serif;font-weight:700">→ は</text><text x="52" y="61" text-anchor="middle" font-size="8" fill="#e9e6ff" style="font-family:sans-serif;font-weight:700">強い</text></svg>`;
  $('ring').innerHTML = svg;
}
function updateRing() {
  RING.forEach((ch, i) => {
    const on = ch === sel;
    $('rn' + i).setAttribute('stroke-width', on ? 4 : 1.5);
    $('rl' + i).setAttribute('stroke', on ? '#ffe066' : '#e9e6ff');
    $('rl' + i).setAttribute('stroke-width', on ? 4 : 2);
    $('rl' + i).setAttribute('opacity', on ? 1 : 0.7);
  });
}

// ---------- 魔法ボタン ----------
function buildElems() {
  const box = $('elems'); box.innerHTML = '';
  ['火', '水', '雷', '光', '闇'].forEach((ch, i) => {
    const b = document.createElement('button');
    b.dataset.ch = ch; b.style.background = ELEMS[ch].color;
    if (ch === '光') b.style.color = '#4a3b00';
    b.innerHTML = `<span class="c glyph">${ch}</span><small>${i + 1}・威力${ELEMS[ch].power}</small>`;
    b.onclick = () => select(ch);
    box.appendChild(b);
  });
}
function select(ch) {
  if (sel !== ch) { strokes = []; drawing = null; $('pad-info').textContent = ''; }
  sel = ch;
  for (const b of $('elems').children) b.classList.toggle('sel', b.dataset.ch === ch);
  updateRing();
}

// ---------- 会話 ----------
function showTalk(lines, done) {
  if (SKIP || !lines.length) { done(); return; }
  talkQueue = lines.slice(); talkDone = done; mode = 'talk';
  $('talk').hidden = false;
  nextTalk();
}
function nextTalk() {
  const l = talkQueue.shift();
  if (!l) { $('talk').hidden = true; const d = talkDone; talkDone = null; d(); return; }
  const sp = SPEAKERS[l[0]];
  $('talk-av').textContent = sp.glyph;
  $('talk-av').style.background = sp.color;
  $('talk-name').textContent = sp.name;
  $('talk-text').textContent = l[1];
}
$('talk').addEventListener('click', () => { if (mode === 'talk') nextTalk(); });

// ---------- 画面切り替え ----------
function show(name) {
  for (const id of ['title', 'select', 'result']) $(id).hidden = id !== name;
}
function toTitle() {
  mode = 'title'; show('title'); game = null;
  const any = save.cleared.some(c => c);
  $('continue').hidden = !any;
  $('start').textContent = any ? 'さいしょから' : 'はじめる';
  $('stage-name').textContent = '';
}
function toSelect() {
  mode = 'select'; show('select');
  const grid = $('stage-grid'); grid.innerHTML = '';
  STAGES.forEach((st, i) => {
    const b = document.createElement('button');
    b.innerHTML = `${i === STAGES.length - 1 ? '王' : i + 1}<small>${save.cleared[i] ? '★クリア' : '未クリア'}${save.best[i] ? '<br>' + save.best[i] : ''}</small>`;
    b.disabled = !unlocked(i);
    b.onclick = () => startStage(i);
    grid.appendChild(b);
  });
}

function startStage(i) {
  cur = i; $('talk').hidden = true;
  game = createGame(STAGES[i]);
  fx = new Fx(); strokes = []; drawing = null; shake = 0; pendingFly.clear(); $('pad-info').textContent = '';
  $('stage-name').textContent = STAGES[i].name;
  mode = 'talk'; show(null);
  select(sel);
  showTalk(STAGES[i].intro, () => { mode = 'play'; toast(i === 0 ? '魔物の弱点の字をえらんで、お手本をなぞり「唱える！」' : STAGES[i].boss ? '大魔王の弱点を順になぞれ！' : '', 3.2); });
}

function finish(win) {
  if (win) {
    const sc = finalScore(game);
    save.best[cur] = Math.max(save.best[cur], sc); save.cleared[cur] = true; writeSave();
    showTalk(STAGES[cur].outro, () => showResult(true));
  } else showResult(false);
}
function showResult(win) {
  mode = 'result'; show('result');
  const last = cur === STAGES.length - 1;
  const sc = finalScore(game);
  $('r-title').textContent = win ? (last ? '大魔王を倒した！ ―― おしまい' : `${STAGES[cur].name.split('　')[0]} クリア！`) : '町が魔物にのまれた…';
  $('r-info').innerHTML = `スコア <b>${sc}</b>（最高 ${save.best[cur]}）<br>撃破 ${game.kills} 体 ／ 平均精度 ${avgAcc(game).toFixed(0)}% ／ 町のハート ${game.hearts}/${HEARTS}`;
  $('r-next').hidden = !win || last;
  $('r-next').onclick = () => startStage(cur + 1);
  $('r-again').onclick = () => startStage(cur);
  $('r-select').onclick = toSelect;
}

$('start').onclick = () => { save = { best: STAGES.map(() => 0), cleared: STAGES.map(() => false) }; writeSave(); startStage(0); };
$('continue').onclick = () => startStage(firstOpen());
$('to-select').onclick = toSelect;
$('select-close').onclick = toTitle;
$('retry').onclick = () => { if (game) startStage(cur); };
$('stages').onclick = toSelect;

// ---------- レイアウト ----------
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const fr = field.getBoundingClientRect();
  fW = fr.width; fH = fr.height;
  field.width = Math.round(fW * dpr); field.height = Math.round(fH * dpr);
  const pr = pad.getBoundingClientRect();
  pP = pr.width;
  pad.width = Math.round(pP * dpr); pad.height = Math.round(pP * dpr);
}
window.addEventListener('resize', resize);

// ---------- なぞる ----------
const ptOf = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * R, y: (e.clientY - r.top) / r.height * R }; };
pad.addEventListener('pointerdown', e => {
  if (mode !== 'play') return;
  e.preventDefault(); pad.setPointerCapture(e.pointerId);
  drawing = [ptOf(e)]; strokes.push(drawing);
});
pad.addEventListener('pointermove', e => {
  if (!drawing) return;
  const p = ptOf(e), q = drawing[drawing.length - 1];
  if (Math.hypot(p.x - q.x, p.y - q.y) > 0.8) drawing.push(p);
});
const endStroke = () => { if (drawing) { drawing = null; if (strokes.length) liveCover(); } };
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);
function liveCover() {
  const r = evaluate(sel, strokes);
  $('pad-info').textContent = `なぞり ${r.cov.toFixed(0)}% ・ はみ出し ${r.out.toFixed(0)}% → 精度 ${r.acc.toFixed(0)}%`;
}
$('b-clear').onclick = clearPad;
function clearPad() { strokes = []; drawing = null; $('pad-info').textContent = ''; }

const RANKS = [[95, 'S'], [85, 'A'], [70, 'B'], [55, 'C'], [0, 'D']];
function cast() {
  if (mode !== 'play' || !game || game.state !== 'play') return;
  if (!strokes.length) { toast('お手本の字をなぞってから「唱える！」'); return; }
  const r = evaluate(sel, strokes);
  const acc = r.acc, ch = sel, el = ELEMS[ch];
  clearPad();
  const rank = RANKS.find(x => acc >= x[0])[1];
  const from = { x: fW / 2, y: fH + 6 };
  padFlash = 0.5; padFlashColor = el.glow;
  const plan = castPlan(game, ch, acc);
  if (plan.fizzle) { toast(`${ch}の魔法は不発… 精度 ${acc.toFixed(0)}%（${MIN_ACC}%以上で成功）`); fx.pop(fW / 2, fH - 60, '不発…', '#adb5bd', 20); return; }
  toast(`${ch}！ 精度 ${acc.toFixed(0)}%（${rank}）`, 1.6);
  const tgt = plan.target;
  const getTo = () => (tgt && !tgt.dead ? monPos(tgt) : null);
  const aim = tgt ? monPos(tgt) : { x: fW / 2, y: fH * 0.4 };
  pendingFly.add(plan);
  fx.spell(ch, from, () => getTo() || aim, () => {
    pendingFly.delete(plan);
    if (!tgt) return;
    const p = monPos(tgt);
    const res = applyHit(game, plan);
    if (res.gone) return;
    const col = plan.mult >= 2 ? '#ffe066' : plan.mult < 1 ? '#adb5bd' : '#fff';
    fx.pop(p.x, p.y - monR(tgt) - 6, `${Math.round(res.dmg)}${plan.mult >= 2 ? ' 弱点！' : plan.mult < 1 ? ' いまひとつ' : ''}`, col, plan.mult >= 2 ? 22 : 17);
    if (res.locked) fx.pop(p.x, p.y + 10, '結界！ 弱点でトドメを', '#ffa8a8', 14);
    if (plan.ch === '雷') shake = 0.25;
  });
}
$('b-cast').onclick = cast;
window.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); cast(); }
  else if (e.key === 'Escape') clearPad();
  else if (/^[1-5]$/.test(e.key)) select(['火', '水', '雷', '光', '闇'][+e.key - 1]);
});

// ---------- 描画：フィールド ----------
const lineY = () => fH - 30;
const monR = m => Math.max(16, Math.min(30, Math.min(fW * 0.075, fH * 0.12))) * (m.boss ? 1.9 : 1);
const monPos = m => { // 上から出てくるとき、体力バーと弱点バッジが画面内に収まる位置から始める
  const top = monR(m) * 1.35 + 40;
  return { x: 10 + m.px * (fW - 20), y: top + m.y * (lineY() - top - monR(m) * 0.6) + Math.sin(tNow * 5 + m.ph) * 2 };
};

function drawField(dt) {
  const c = fctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.save();
  if (shake > 0) { shake = Math.max(0, shake - dt); c.translate((Math.random() - .5) * 8, (Math.random() - .5) * 8); }
  const g = c.createLinearGradient(0, 0, 0, fH);
  g.addColorStop(0, '#12183a'); g.addColorStop(1, '#2b2350');
  c.fillStyle = g; c.fillRect(-10, -10, fW + 20, fH + 20);
  c.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 28; i++) { const x = (i * 97.3) % fW, y = (i * 53.7) % (fH * 0.6); c.fillRect(x, y, 1.5, 1.5); }
  // 町（守る場所）
  const ly = lineY();
  c.fillStyle = '#1a1735'; c.fillRect(0, ly, fW, fH - ly + 4);
  for (let x = 4, i = 0; x < fW; x += 34, i++) {
    const h = 14 + (i * 7) % 16;
    c.fillStyle = '#26214a'; c.fillRect(x, ly + 6 - h * 0.4, 28, h);
    c.fillStyle = (i % 3) ? '#ffd95a' : '#6c6f90'; c.fillRect(x + 6, ly + 8 - h * 0.3, 5, 5);
  }
  c.strokeStyle = 'rgba(255,224,102,.55)'; c.setLineDash([8, 6]); c.lineWidth = 2; c.beginPath(); c.moveTo(0, ly); c.lineTo(fW, ly); c.stroke(); c.setLineDash([]);

  if (game) {
    const hintOn = game.stage.hint;
    const ms = game.monsters.slice().sort((a, b) => a.y - b.y);
    for (const m of ms) drawMonster(c, m, hintOn || m.boss);
  }
  fx.draw(c);
  if (fx.flash > 0) { c.globalAlpha = Math.min(0.6, fx.flash); c.fillStyle = fx.flashColor; c.fillRect(-10, -10, fW + 20, fH + 20); c.globalAlpha = 1; }
  c.restore();
}

function drawMonster(c, m, hint) {
  const p = monPos(m), r = monR(m), el = ELEMS[m.elem];
  c.save(); c.translate(p.x, p.y);
  if (m.boss) { // 大魔王：まとう属性のオーラ
    const ag = c.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.5);
    ag.addColorStop(0, el.color + 'aa'); ag.addColorStop(1, el.color + '00');
    c.fillStyle = ag; c.beginPath(); c.arc(0, 0, r * 1.5, 0, 6.28); c.fill();
  }
  // 体
  const squash = Math.sin(tNow * 6 + m.ph) * 0.05;
  c.scale(1 + squash, 1 - squash);
  c.fillStyle = m.boss ? '#241046' : el.color;
  c.strokeStyle = m.flash > 0 ? '#fff' : (m.boss ? el.color : 'rgba(0,0,0,.35)'); c.lineWidth = m.boss ? 5 : 3;
  c.beginPath(); c.moveTo(-r, r * 0.7);
  c.quadraticCurveTo(-r * 1.05, -r * 1.1, 0, -r * 1.05); c.quadraticCurveTo(r * 1.05, -r * 1.1, r, r * 0.7);
  for (let i = 0; i < 4; i++) c.quadraticCurveTo(r - (i + 0.5) * r / 2, r * 1.05, r - (i + 1) * r / 2, r * 0.7);
  c.closePath(); c.fill(); c.stroke();
  if (m.flash > 0) { c.globalAlpha = Math.min(1, m.flash * 3); c.fillStyle = '#fff'; c.fill(); c.globalAlpha = 1; }
  if (m.boss) { // 角
    c.fillStyle = '#d0bfff'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.5, -r * 0.95); c.lineTo(s * r * 0.8, -r * 1.5); c.lineTo(s * r * 0.9, -r * 0.8); c.fill(); }
  }
  // 目と属性の字
  c.fillStyle = '#fff'; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * r * 0.34, -r * 0.3, r * 0.2, 0, 6.28); c.fill(); }
  c.fillStyle = '#222'; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * r * 0.34, -r * 0.27, r * 0.09, 0, 6.28); c.fill(); }
  c.font = `900 ${r * 0.8}px ${FAMILY}`; c.textAlign = 'center'; c.fillStyle = m.boss ? el.color : '#fff';
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.4)'; c.strokeText(m.elem, 0, r * 0.62); c.fillText(m.elem, 0, r * 0.62);
  c.restore();

  // 体力バー（結界の線つき）
  const bw = r * 1.8, bx = p.x - bw / 2, by = p.y - r * (m.boss ? 1.6 : 1.3) - 8;
  c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(bx - 1, by - 1, bw + 2, 7);
  c.fillStyle = m.lock ? '#adb5bd' : '#69db7c'; c.fillRect(bx, by, bw * Math.max(0, m.hp / m.max), 5);
  c.fillStyle = '#ff8787'; c.fillRect(bx + bw * WARD - 1, by - 2, 2, 9);
  if (m.lock) { c.font = `bold 11px ${FAMILY}`; c.textAlign = 'center'; c.fillStyle = '#ffa8a8'; c.fillText('結界', p.x, by - 4); }
  // 弱点の字
  if (hint) {
    const w = counterOf(m.elem), wc = ELEMS[w].color;
    const hy = by - (m.lock ? 17 : 6);
    c.fillStyle = wc; c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.arc(p.x, hy - 9, 11, 0, 6.28); c.fill(); c.stroke();
    c.font = `900 15px ${FAMILY}`; c.textAlign = 'center'; c.fillStyle = w === '光' ? '#4a3b00' : '#fff'; c.fillText(w, p.x, hy - 3.5);
    c.font = `bold 9px ${FAMILY}`; c.fillStyle = '#fff'; c.fillText('弱', p.x + 17, hy - 12);
  }
}

// ---------- 描画：魔法陣 ----------
function drawPad(dt) {
  const c = pctx, P = pP, k = P / R;
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, P, P);
  const el = ELEMS[sel];
  const bg = c.createRadialGradient(P / 2, P / 2, P * 0.1, P / 2, P / 2, P * 0.72);
  bg.addColorStop(0, '#1d2145'); bg.addColorStop(1, '#0b0d22');
  c.fillStyle = bg; c.fillRect(0, 0, P, P);
  // 魔法陣
  c.save(); c.translate(P / 2, P / 2);
  c.strokeStyle = el.color; c.lineWidth = 2.5; c.globalAlpha = 0.9;
  c.beginPath(); c.arc(0, 0, P * 0.485, 0, 6.28); c.stroke();
  c.lineWidth = 1.5; c.globalAlpha = 0.6; c.beginPath(); c.arc(0, 0, P * 0.455, 0, 6.28); c.stroke();
  c.rotate(tNow * 0.25);
  for (let i = 0; i < 5; i++) { // 5属性の星
    const a = i * 4 * Math.PI / 5 - Math.PI / 2, b = (i + 1) * 4 * Math.PI / 5 - Math.PI / 2;
    c.beginPath(); c.moveTo(Math.cos(a) * P * 0.45, Math.sin(a) * P * 0.45); c.lineTo(Math.cos(b) * P * 0.45, Math.sin(b) * P * 0.45); c.globalAlpha = 0.25; c.stroke();
  }
  c.restore(); c.globalAlpha = 1;
  // お手本（薄い字）
  const f = fit(sel);
  c.font = `900 ${f.fs * k}px ${FAMILY}`; c.textBaseline = 'alphabetic';
  c.fillStyle = el.color; c.globalAlpha = 0.3; c.fillText(sel, f.ox * k, f.oy * k);
  c.globalAlpha = 0.85; c.lineWidth = 1.5; c.strokeStyle = el.glow; c.strokeText(sel, f.ox * k, f.oy * k);
  c.globalAlpha = 1;
  // 軌跡
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const pass of [0, 1]) {
    c.lineWidth = (pass ? BRUSH * 0.45 : BRUSH) * k; c.strokeStyle = pass ? '#fff' : el.color; c.globalAlpha = pass ? 0.95 : 0.55;
    c.shadowColor = el.glow; c.shadowBlur = pass ? 0 : 10;
    for (const s of strokes) {
      c.beginPath(); c.moveTo(s[0].x * k, s[0].y * k);
      if (s.length === 1) c.lineTo(s[0].x * k + 0.01, s[0].y * k);
      for (let i = 1; i < s.length; i++) c.lineTo(s[i].x * k, s[i].y * k);
      c.stroke();
    }
  }
  c.shadowBlur = 0; c.globalAlpha = 1;
  if (padFlash > 0) { padFlash = Math.max(0, padFlash - dt * 1.8); c.globalAlpha = padFlash; c.fillStyle = padFlashColor; c.fillRect(0, 0, P, P); c.globalAlpha = 1; }
}

// ---------- HUD ----------
function drawHud() {
  if (!game) return;
  $('h-hearts').innerHTML = Array.from({ length: HEARTS }, (_, i) => `<span class="${i < game.hearts ? '' : 'off'}">♥</span>`).join('');
  $('h-score').textContent = game.score;
  const s = game.stage, total = s.spawns.length + (s.boss ? 1 : 0);
  const done = game.kills;
  $('h-prog').textContent = s.boss ? '大魔王を倒せ！' : `撃破 ${done}/${total}`;
}

// ---------- メインループ ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; tNow = now / 1000;
  if (mode === 'play' && game) {
    update(game, dt * SLOW);
    for (const ev of game.events) {
      if (ev.type === 'leak') { shake = 0.35; const p = monPos(ev.m); fx.burst(p.x, lineY(), '#ff6b6b', 20, 160, 5); toast(ev.m.boss ? '大魔王が町に着いてしまった…' : '町に魔物が入った！ ハートが減る'); }
      else if (ev.type === 'kill') { const p = monPos(ev.m); fx.burst(p.x, p.y, ELEMS[ev.m.elem].color, ev.m.boss ? 60 : 26, ev.m.boss ? 320 : 180, ev.m.boss ? 9 : 6); fx.pop(p.x, p.y - 20, ev.m.boss ? '大魔王を撃破！' : '撃破！', '#fff', ev.m.boss ? 30 : 20); if (ev.m.boss) fx.doFlash('#fff', 0.8); }
      else if (ev.type === 'phase') { const p = monPos(ev.m); fx.burst(p.x, p.y, '#fff', 40, 260, 7); fx.doFlash(ELEMS[ev.m.elem].glow, 0.4); toast(`殻がくだけた！ 大魔王は「${ev.m.elem}」をまとった ―― 弱点は「${counterOf(ev.m.elem)}」`, 3.2); }
      else if (ev.type === 'spawn' && ev.m.boss) toast(`大魔王の登場！ いま「${ev.m.elem}」をまとっている ―― 弱点は「${counterOf(ev.m.elem)}」`, 3.5);
    }
    game.events.length = 0;
    if (game.state !== 'play' && pendingFly.size === 0 && !fx.list.length) { const win = game.state === 'win'; mode = 'ending'; setTimeout(() => finish(win), 500); }
  }
  fx.update(dt);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').textContent = ''; }
  drawField(dt); drawPad(dt); drawHud();
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
buildRing(); buildElems(); select('火');
resize();
requestAnimationFrame(frame);
(async () => {
  await loadFont();
  resize();
  $('start').disabled = false; $('start').textContent = 'はじめる';
  toTitle();
  if (params.has('stage')) startStage(+params.get('stage') | 0);
})();
