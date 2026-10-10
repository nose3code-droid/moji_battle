// 火消し大作戦：画面・操作・演出・進行（ゲームの中身は game.js、面とセリフは stages.js）
import { FONT_URL } from '../../config.js';
import { COLS, ROWS, STAGES, SPEAKERS, OPENING } from './stages.js';
import { createGame, update, switchAmmo, stars, loss, residentAt, WATER_MAX, SAND_MAX } from './game.js';

const SAVE_KEY = 'moji_hikeshi.stars';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search); // テスト用の近道：?stage=N 直接開始 / ?skip=1 会話を飛ばす＋全面解放 / ?seed=N 乱数固定
const SKIP = params.has('skip');

// ---------- 進行状況（面ごとの星の数） ----------
function loadStars() {
  try { const a = JSON.parse(localStorage.getItem(SAVE_KEY)); if (Array.isArray(a)) return STAGES.map((_, i) => a[i] | 0); } catch { /* 無ければ初期状態 */ }
  return STAGES.map(() => 0);
}
let starsSaved = loadStars();
function saveStars() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(starsSaved)); } catch { /* 保存できなくても遊べる */ } }
const unlocked = i => SKIP || i === 0 || starsSaved[i - 1] > 0;
const firstOpen = () => { const i = starsSaved.findIndex(s => !s); return i < 0 ? STAGES.length - 1 : i; };

// ---------- 読み込み（フォントは取れなくても遊べる） ----------
const canvas = $('view');
const ctx = canvas.getContext('2d');
let fontNote = '';
async function loadFont() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(FONT_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('font ' + res.status);
    document.fonts.add(await new FontFace('MojiHikeshi', await res.arrayBuffer()).load());
  } catch (e) {
    fontNote = 'フォントを読み込めなかったので、代わりのフォントで表示します';
    console.warn(e);
  }
}
const FONT = 'MojiHikeshi, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';

// ---------- 状態 ----------
let mode = 'title';        // title | talk | play | result | select
let cur = 0;
let game = null;
let particles = [];
let shake = 0;
let rainT = 0;             // 勝利時の雨の演出（秒）
let endTimer = 0;          // 勝敗がついてから画面を切り替えるまでの待ち
let toastT = 0;
let talkQueue = [], talkDone = null;
let tNow = 0;
const seed = params.has('seed') ? +params.get('seed') : (Math.random() * 1e9) | 0;
window.__hikeshi = { get game() { return game; }, get mode() { return mode; }, get stars() { return starsSaved; } }; // テスト用

function toast(msg, sec = 2.4) { $('toast').textContent = msg; toastT = sec; }

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
  $('talk-av').style.background = { mizu: '#339af0', hito: '#51a35c', cho: '#7048a8', hi: '#e03131' }[l[0]];
  $('talk-name').textContent = sp.name;
  $('talk-text').textContent = l[1];
}
$('talk').addEventListener('click', () => { if (mode === 'talk') nextTalk(); });

// ---------- 画面切り替え ----------
function show(name) {
  for (const id of ['title', 'select', 'result']) $(id).hidden = id !== name;
  const playing = name === null;
  $('hud').classList.toggle('hide', !playing && mode !== 'talk');
  $('touch').classList.toggle('hide', !playing || mode === 'talk');
}
function toTitle() {
  mode = 'title'; show('title');
  $('continue').hidden = !starsSaved.some(s => s);
  $('start').textContent = starsSaved.some(s => s) ? 'さいしょから' : 'はじめる';
}
function toSelect() {
  mode = 'select'; show('select');
  const grid = $('stage-grid'); grid.innerHTML = '';
  STAGES.forEach((st, i) => {
    const b = document.createElement('button');
    const n = starsSaved[i];
    b.innerHTML = `${i === STAGES.length - 1 ? '終' : i + 1}<small>${'★'.repeat(n)}${'☆'.repeat(3 - n)}</small>`;
    b.disabled = !unlocked(i);
    b.onclick = () => startStage(i);
    grid.appendChild(b);
  });
}

function startStage(i) {
  cur = i;
  $('talk').hidden = true;
  game = createGame(STAGES[i], seed + i);
  particles = []; rainT = 0; endTimer = 0; shake = 0;
  $('stage-name').textContent = STAGES[i].name;
  $('h-limit').textContent = STAGES[i].limit;
  mode = 'talk'; show(null);
  showTalk(STAGES[i].intro, () => { mode = 'play'; show(null); toast(i === 0 ? 'スペースで放水！ 火のそばの家の人を助けよう' : '', 3); });
}

function finish(win) {
  if (win) {
    const n = stars(game);
    starsSaved[cur] = Math.max(starsSaved[cur], n); saveStars();
    showTalk(STAGES[cur].outro, () => showResult(true));
  } else showResult(false);
}
function showResult(win) {
  mode = 'result'; show('result');
  const last = cur === STAGES.length - 1;
  $('r-title').textContent = win ? (last ? '町に朝が来た！ ―― おしまい' : `${STAGES[cur].name.split('　')[0]} クリア！`) : '失敗…';
  const n = win ? stars(game) : 0;
  $('r-stars').innerHTML = [0, 1, 2].map(i => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
  $('r-info').innerHTML = win
    ? `燃え尽きた建物 ${game.burnt}　助けられなかった住人 ${game.lost}　救助 ${game.saved}${last ? '<br>あそんでくれて ありがとう！' : ''}`
    : `${game.reason}<br>火が広がる前に、水をかけて防火線を作ろう。`;
  $('r-next').hidden = !win || last;
}

// ---------- 入力 ----------
const held = [];         // 押されている方向キー（最後に押したものが優先）
let keyFire = false, btnFire = false;
const KEYDIR = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
window.addEventListener('keydown', e => {
  if (e.repeat) { if (KEYDIR[e.code] || e.code === 'Space') e.preventDefault(); return; }
  if (KEYDIR[e.code]) { e.preventDefault(); held.push(e.code); }
  else if (e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); keyFire = true; if (mode === 'talk') nextTalk(); }
  else if (e.code === 'Enter' && mode === 'talk') nextTalk();
  else if ((e.code === 'KeyK' || e.code === 'KeyX' || e.code === 'ShiftLeft') && mode === 'play') { switchAmmo(game); toast(game.player.ammo === 'water' ? '水に切り替え' : '砂に切り替え', 1); }
});
window.addEventListener('keyup', e => {
  const i = held.indexOf(e.code); if (i >= 0) held.splice(i, 1);
  if (e.code === 'Space' || e.code === 'KeyJ') keyFire = false;
});
window.addEventListener('blur', () => { held.length = 0; keyFire = false; btnFire = false; });

// 画面ドラッグ＝バーチャルスティック（最初に触った場所が中心）
let stick = null; // {id, ox, oy, x, y}
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'play' || stick) return;
  canvas.setPointerCapture(e.pointerId);
  stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => { if (stick && e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; } });
const endStick = e => { if (stick && e.pointerId === stick.id) stick = null; };
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);
function stickDir() {
  if (!stick) return null;
  const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
  if (Math.hypot(dx, dy) < 16) return null;
  return Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
}
const fireBtn = $('b-fire');
fireBtn.addEventListener('pointerdown', e => { e.preventDefault(); btnFire = true; fireBtn.setPointerCapture(e.pointerId); });
for (const ev of ['pointerup', 'pointercancel']) fireBtn.addEventListener(ev, () => { btnFire = false; });
$('b-switch').addEventListener('click', () => { if (mode === 'play') { switchAmmo(game); toast(game.player.ammo === 'water' ? '水に切り替え' : '砂に切り替え', 1); } });
function readInput() {
  let d = held.length ? KEYDIR[held[held.length - 1]] : stickDir();
  // 放水ボタンを押しながらドラッグ → 向きだけ変える
  return { dx: d ? d[0] : 0, dy: d ? d[1] : 0, fire: keyFire || btnFire };
}

// ---------- ボタン ----------
$('start').onclick = () => { starsSaved = STAGES.map(() => 0); saveStars(); startStage(0); };
$('continue').onclick = () => startStage(firstOpen());
$('to-select').onclick = toSelect;
$('select-close').onclick = toTitle;
$('r-next').onclick = () => startStage(cur + 1);
$('r-again').onclick = () => startStage(cur);
$('r-select').onclick = toSelect;
$('retry').onclick = () => { if (game) startStage(cur); };
$('stages').onclick = toSelect;

// ---------- 演出 ----------
function addP(p) { particles.push(Object.assign({ vx: 0, vy: 0, life: 0.6, max: 0.6, size: 0.1, g: 0 }, p, { max: p.life ?? 0.6 })); }
function handleEvents() {
  for (const e of game.events) {
    const cx = e.x + 0.5, cy = e.y + 0.5;
    if (e.type === 'shot') {
      const col = e.ammo === 'water' ? '120,190,255' : '224,178,92';
      for (let i = 0; i < 9; i++) {
        const sp = 5 + Math.random() * 3;
        addP({ x: e.x + 0.5 + e.dx * 0.5, y: e.y + 0.5 + e.dy * 0.5, vx: e.dx * sp + (Math.random() - .5) * 1.2, vy: e.dy * sp + (Math.random() - .5) * 1.2, life: e.len / 6.5 * (0.7 + Math.random() * .3), size: 0.07 + Math.random() * .05, col });
      }
    } else if (e.type === 'hit') {
      const col = e.ammo === 'water' ? '160,210,255' : '224,178,92';
      for (let i = 0; i < 5; i++) addP({ x: cx, y: cy, vx: (Math.random() - .5) * 3, vy: -Math.random() * 3 - 1, g: 9, life: 0.5, size: 0.06, col });
      if (e.boss) shake = 0.15;
    } else if (e.type === 'out') {
      for (let i = 0; i < 7; i++) addP({ x: cx + (Math.random() - .5) * .5, y: cy, vx: (Math.random() - .5) * .5, vy: -0.8 - Math.random(), life: 1.1, size: 0.18, col: '200,200,210', smoke: true });
    } else if (e.type === 'burnt') {
      for (let i = 0; i < 6; i++) addP({ x: cx + (Math.random() - .5) * .6, y: cy, vx: (Math.random() - .5) * .4, vy: -0.6 - Math.random() * .6, life: 1.6, size: 0.2, col: '60,55,55', smoke: true });
    } else if (e.type === 'rescue') {
      for (let i = 0; i < 10; i++) addP({ x: cx, y: cy, vx: (Math.random() - .5) * 3, vy: -1 - Math.random() * 2, g: 3, life: 1, size: 0.07, col: '120,255,150' });
      toast('住人を助けた！', 1.6);
    } else if (e.type === 'lost') { toast('住人を助けられなかった…', 2.2); shake = 0.3; }
    else if (e.type === 'noeffect') { if (game.noOilHint) { toast('油の火には水が効かない！ Kキーで砂に切り替え', 2.8); game.noOilHint = false; } }
    else if (e.type === 'empty') toast(e.ammo === 'water' ? '水がない！ 井戸（井）のそばで補給' : '砂がない！ 砂山（砂）のそばで補給', 1.6);
    else if (e.type === 'spark') {
      for (let i = 0; i < 6; i++) addP({ x: e.x + 0.5, y: e.y + 0.5, vx: (e.tx - e.x) * 2 + (Math.random() - .5), vy: (e.ty - e.y) * 2 + (Math.random() - .5), life: 0.5, size: 0.08, col: '255,170,60' });
    } else if (e.type === 'wind') toast('風向きが変わった！', 2);
  }
  game.events.length = 0;
}

// ---------- 描画 ----------
let L = { t: 40, ox: 0, oy: 0 };
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  const top = 82, avail = innerHeight - top - 6;
  const t = Math.floor(Math.min(innerWidth / COLS, avail / ROWS));
  L = { t, ox: Math.round((innerWidth - t * COLS) / 2), oy: top + Math.round((avail - t * ROWS) / 2), dpr };
}
addEventListener('resize', resize);

const COLORS = {
  '.': '#2c3249', K: '#8a5a3c', T: '#2f6b3d', S: '#767b86', W: '#2f6fb0', I: '#3b5a80', D: '#b89a58', O: '#2a1f33',
};
const GLYPH = { K: '家', T: '木', S: '石', W: '水', I: '井', D: '砂', O: '油' };

function text(ch, x, y, size, color, align = 'center') {
  ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.fillText(ch, x, y + size * 0.04);
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function flame(cx, base, s, ph, oil) {
  // 外側の炎と内側の炎を、揺らしながら重ねて描く
  for (let k = 0; k < 2; k++) {
    const sc = k ? 0.55 : 1, w = s * 0.42 * sc, h = s * (0.95 + 0.12 * Math.sin(ph * 5.1 + k)) * sc;
    const sway = Math.sin(ph * 3.3 + k * 2) * s * 0.1;
    const g = ctx.createLinearGradient(0, base, 0, base - h);
    if (k) { g.addColorStop(0, '#fff4a0'); g.addColorStop(1, '#ffd23f'); }
    else if (oil) { g.addColorStop(0, '#c04bff'); g.addColorStop(1, '#ff5a3a'); }
    else { g.addColorStop(0, '#ff7a1a'); g.addColorStop(1, '#ff3b1a'); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - w, base);
    ctx.quadraticCurveTo(cx - w * 1.1, base - h * 0.45, cx + sway, base - h);
    ctx.quadraticCurveTo(cx + w * 1.1, base - h * 0.45, cx + w, base);
    ctx.closePath(); ctx.fill();
  }
}

function drawTile(x, y, tl, t) {
  const px = x * t, py = y * t, c = tl.burnt ? '#1f1c1c' : COLORS[tl.t];
  if (tl.t === '.' || tl.burnt) {
    ctx.fillStyle = (x + y) % 2 ? c : (tl.burnt ? '#242020' : '#2f354e'); ctx.fillRect(px, py, t, t);
    if (tl.burnt && tl.t !== '.') text('灰', px + t / 2, py + t / 2, t * 0.5, '#4a4444');
    return;
  }
  ctx.fillStyle = '#2c3249'; ctx.fillRect(px, py, t, t);
  const m = t * 0.06;
  ctx.fillStyle = c; rr(px + m, py + m, t - m * 2, t - m * 2, t * 0.14); ctx.fill();
  if (tl.t === 'K') { ctx.fillStyle = '#b5472e'; rr(px + m, py + m, t - m * 2, t * 0.28, t * 0.12); ctx.fill(); }
  if (tl.t === 'W') { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px + t / 2, py + t / 2, t * 0.34 + Math.sin(tNow * 2 + x) * 2, 0, 7); ctx.stroke(); }
  if (tl.t === 'O') { ctx.fillStyle = 'rgba(160,90,220,.25)'; ctx.beginPath(); ctx.ellipse(px + t * 0.4, py + t * 0.35, t * 0.25, t * 0.1, -0.4, 0, 7); ctx.fill(); }
  const col = { K: '#ffe8c2', T: '#a8e6a0', S: '#d5d8de', W: '#9fd0ff', I: '#cfe6ff', D: '#fff0c0', O: '#b99be0' }[tl.t];
  text(GLYPH[tl.t], px + t / 2, py + t / 2 + (tl.t === 'K' ? t * 0.06 : 0), t * 0.56, col);
}

function render() {
  const { t, ox, oy, dpr } = L;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 夜空（雨が降ると朝の色に近づく）
  const dawn = Math.min(1, rainT / 4);
  ctx.fillStyle = `rgb(${16 + dawn * 90}, ${19 + dawn * 100}, ${31 + dawn * 120})`; ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!game) return;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * shake * 16, (Math.random() - .5) * shake * 16);
  ctx.translate(ox, oy);
  const p = game.player;

  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(x, y, game.tiles[y][x], t);

  // 濡れ・砂のおおい
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const tl = game.tiles[y][x];
    if (tl.wet > 0) { ctx.fillStyle = `rgba(80,160,255,${Math.min(.38, tl.wet / 6 * .38)})`; ctx.fillRect(x * t, y * t, t, t); }
    if (tl.sand) { ctx.fillStyle = 'rgba(224,178,92,.35)'; ctx.fillRect(x * t, y * t, t, t); }
  }

  // 住人
  for (const r of game.residents) {
    if (r.state === 'lost') continue;
    const cx = (r.x + 0.78) * t, cy = (r.y + 0.24) * t;
    if (r.state === 'saved') { text('✓', cx, cy, t * 0.34, '#7dffa0'); continue; }
    const danger = game.tiles[r.y][r.x].fire;
    const bob = Math.sin(tNow * (danger ? 14 : 4) + r.x) * t * (danger ? 0.04 : 0.02);
    ctx.fillStyle = danger ? '#ff6b6b' : '#ffffff';
    ctx.beginPath(); ctx.arc(cx, cy + bob, t * 0.2, 0, 7); ctx.fill();
    text('人', cx, cy + bob, t * 0.27, danger ? '#fff' : '#2b6b3a');
    if (danger) { ctx.fillStyle = '#ffd43b'; rr(cx - t * 0.2, cy + t * 0.25, t * 0.4 * r.hp, t * 0.05, 2); ctx.fill(); }
    else if (r.prog > 0) { ctx.strokeStyle = '#51cf66'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, t * 0.26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, r.prog / 0.6)); ctx.stroke(); }
  }

  // 炎
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const tl = game.tiles[y][x];
    if (!tl.fire) continue;
    const ph = tNow + x * 1.7 + y * 2.3;
    ctx.fillStyle = tl.t === 'O' ? 'rgba(180,60,255,.22)' : 'rgba(255,120,30,.28)';
    ctx.beginPath(); ctx.arc((x + 0.5) * t, (y + 0.5) * t, t * (0.62 + Math.sin(ph * 6) * .04), 0, 7); ctx.fill();
    const s = t * (0.55 + 0.35 * tl.heat);
    flame((x + 0.3) * t, (y + 0.92) * t, s * 0.9, ph, tl.t === 'O');
    flame((x + 0.7) * t, (y + 0.95) * t, s * 0.8, ph + 1.3, tl.t === 'O');
    flame((x + 0.5) * t, (y + 0.97) * t, s * 1.15, ph + 2.6, tl.t === 'O');
    if (Math.random() < 0.05) addP({ x: x + 0.3 + Math.random() * .4, y: y + 0.3, vx: (Math.random() - .5) * .6, vy: -1.5, life: 0.9, size: 0.04, col: '255,200,90' });
  }

  // 「火」の本体
  const b = game.boss;
  if (b && b.hp > 0) {
    const cx = (b.x + 0.5) * t, cy = (b.y + 0.5) * t, s = t * (2.5 + Math.sin(tNow * 4) * 0.12 + (b.hitT > 0 ? -0.2 : 0));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s);
    g.addColorStop(0, 'rgba(255,200,80,.9)'); g.addColorStop(0.5, 'rgba(255,90,30,.45)'); g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, s, 0, 7); ctx.fill();
    flame(cx, cy + s * 0.5, s * 1.1, tNow, false);
    text('火', cx, cy + t * 0.1, s * 0.75, b.hitT > 0 ? '#ffffff' : '#fff2c0');
    ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(cx - t * 1.2, cy - s * 0.75, t * 2.4, t * 0.2, 5); ctx.fill();
    ctx.fillStyle = '#ff6b3d'; rr(cx - t * 1.2, cy - s * 0.75, t * 2.4 * Math.max(0, b.hp / b.max), t * 0.2, 5); ctx.fill();
  }

  // 主人公
  const px = (p.x + 0.5) * t, py = (p.y + 0.5) * t;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(px, py + t * 0.34, t * 0.3, t * 0.1, 0, 0, 7); ctx.fill();
  ctx.fillStyle = p.ammo === 'water' ? '#339af0' : '#c8963c'; ctx.beginPath(); ctx.arc(px, py, t * 0.38, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  text(p.ammo === 'water' ? '水' : '砂', px, py, t * 0.46, '#fff');
  ctx.fillStyle = '#fff'; ctx.beginPath(); // 向きの矢印
  const ax = px + p.fx * t * 0.5, ay = py + p.fy * t * 0.5;
  ctx.moveTo(ax + p.fx * t * 0.14, ay + p.fy * t * 0.14);
  ctx.lineTo(ax - p.fy * t * 0.12, ay + p.fx * t * 0.12); ctx.lineTo(ax + p.fy * t * 0.12, ay - p.fx * t * 0.12); ctx.fill();

  // 粒（水しぶき・煙・火の粉）
  for (const q of particles) {
    const a = Math.max(0, q.life / q.max);
    ctx.fillStyle = `rgba(${q.col},${q.smoke ? a * .5 : a})`;
    ctx.beginPath(); ctx.arc(q.x * t, q.y * t, q.size * t * (q.smoke ? 1.6 - a : 1), 0, 7); ctx.fill();
  }
  ctx.restore();

  // 雨
  if (rainT > 0) {
    ctx.strokeStyle = 'rgba(170,210,255,.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.3 + tNow * 40) % innerWidth, y = ((i * 53.7 + tNow * 900) % (innerHeight + 40)) - 20;
      ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 16);
    }
    ctx.stroke();
  }
  // スティック
  if (stick && mode === 'play') {
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 40, 0, 7); ctx.stroke();
    const d = Math.min(40, Math.hypot(stick.x - stick.ox, stick.y - stick.oy)), a = Math.atan2(stick.y - stick.oy, stick.x - stick.ox);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(stick.ox + Math.cos(a) * d, stick.oy + Math.sin(a) * d, 18, 0, 7); ctx.fill();
  }
}

function updateHud() {
  const p = game.player;
  const tl = Math.max(0, Math.ceil(game.timeLeft));
  $('h-time').textContent = tl; $('h-time').className = tl <= 15 ? 'warn' : '';
  $('h-water').style.width = (p.water / WATER_MAX * 100) + '%';
  $('h-sand').style.width = (p.sand / SAND_MAX * 100) + '%';
  const l = loss(game);
  $('h-loss').textContent = l; $('h-loss').className = l >= game.stage.limit ? 'warn' : '';
  $('h-res').textContent = game.residents.length ? `${game.saved}/${game.residents.length}` : '-';
  $('h-wind').textContent = '風 ' + ({ N: '↑', E: '→', S: '↓', W: '←' }[game.windDir] || 'なし');
}

// ---------- メインループ ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; tNow = now / 1000;
  if (game) {
    if (mode === 'play') {
      update(game, dt, readInput());
      if (game.state !== 'play' && !endTimer) {
        endTimer = game.state === 'win' && game.rain ? 3.2 : 0.9;
        if (game.state === 'win' && game.rain) toast('雨だ…！ 町に雨が降り出した', 3);
      }
    }
    if (game.state !== 'play' && mode === 'play' && endTimer > 0) {
      if (game.rain) rainT += dt;
      endTimer -= dt;
      if (endTimer <= 0) { const w = game.state === 'win'; mode = 'talk'; finish(w); }
    } else if (game.rain) rainT += dt;
    handleEvents();
    for (const q of particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt; }
    particles = particles.filter(q => q.life > 0);
    shake = Math.max(0, shake - dt);
    updateHud();
  }
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').textContent = '';
  render();
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
$('lead').innerHTML = OPENING.join('<br>');
resize(); toTitle();
show('title'); $('hud').classList.add('hide'); $('touch').classList.add('hide');
requestAnimationFrame(frame);
await loadFont();
$('start').disabled = false;
toTitle();
if (fontNote) { $('lead').innerHTML += `<br><small style="color:#a33">${fontNote}</small>`; }
if (params.has('stage')) startStage(Math.max(0, Math.min(STAGES.length - 1, +params.get('stage') - 1)));
