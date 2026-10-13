// 文字くいしん坊：画面・入力・音・記録（進行は game.js、描画は render.js、字の性能は metrics.js）
import { Game, STAGES, PELLET_CHARS } from './game.js';
import { Renderer } from './render.js';
import { statsFor, loadGlyphLib, usingFont } from './metrics.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search); // テスト用：?ch= &stage=1〜5 &god=1 &speed=倍速 &autostart=1
const SAVE_KEY = 'moji_kuishinbo.save';
const PRESETS = ['口', '丸', '一', '川', '龍', '愛', '〇', 'あ', 'S'];
const TIME_SCALE = Math.max(0.5, Math.min(6, +params.get('speed') || 1));

// ---------- 記録 ----------
let save = { hi: 0, reached: 1, ch: '口', mute: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch { /* 保存できなくても遊べる */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 無視 */ } };

// ---------- 状態 ----------
const view = $('view');
const rend = new Renderer(view);
let ch = [...(params.get('ch') || save.ch || '口')][0] || '口';
let stats = statsFor(ch);
let startStage = Math.min(STAGES, Math.max(1, +params.get('stage') || 1));
let game = null;
let paused = false;
let want = -1;        // 予約している向き（ゲームが始まる前の入力も覚えておく）

function setHi() { $('hi').textContent = $('hi2').textContent = String(save.hi); $('reached').textContent = String(save.reached); }

// ---------- 画面の部品 ----------
function starText(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
function renderStatBox() {
  const r = stats.rating, m = stats.metrics;
  $('statbox').innerHTML =
    `<span class="big">${ch}</span>速さ <span class="star">${starText(r.speed)}</span><br>` +
    `曲がりやすさ <span class="star">${starText(r.turn)}</span><br>` +
    `食べる範囲 <span class="star">${starText(r.eat)}</span>` +
    `<br><small style="color:#9a98b8">丸さ ${m.roundness.toFixed(2)} ／ 縦横比 ${m.aspect.toFixed(2)} ／ 詰まり ${m.fill.toFixed(2)}${usingFont() ? '' : '（簡易判定）'}</small>`;
}
function chooseChar(c) {
  if (!c) return;
  ch = [...c][0]; stats = statsFor(ch); save.ch = ch; persist();
  $('char').value = ch;
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.textContent === ch));
  renderStatBox();
}
function buildTitle() {
  const pre = $('presets');
  for (const c of PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.onclick = () => chooseChar(c); pre.appendChild(b); }
  $('form').onsubmit = e => { e.preventDefault(); chooseChar($('char').value.trim()); };
  $('char').addEventListener('input', () => { const v = $('char').value.trim(); if (v) chooseChar(v); });
  renderStages();
  chooseChar(ch);
  $('btn-start').onclick = () => { audioStart(); begin(startStage, 0, 3); };
  setHi();
}
function renderStages() {
  const box = $('stages'); box.innerHTML = '';
  for (let i = 1; i <= STAGES; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `${i}面 ${PELLET_CHARS[i - 1]}`;
    b.disabled = i > save.reached && !params.has('stage');
    b.classList.toggle('on', i === startStage);
    b.onclick = () => { startStage = i; renderStages(); };
    box.appendChild(b);
  }
}
function showResult(title, body, buttons) {
  $('r-title').textContent = title; $('r-body').innerHTML = body;
  const box = $('r-btns'); box.innerHTML = '';
  for (const [label, fn, sub] of buttons) {
    const b = document.createElement('button'); b.textContent = label; if (sub) b.className = 'sub';
    b.onclick = () => { $('result').hidden = true; fn(); };
    box.appendChild(b);
  }
  $('result').hidden = false;
}
function showTitle() { $('title').hidden = false; $('result').hidden = true; renderStages(); setHi(); game = null; }

// ---------- ゲームの開始・進行 ----------
function begin(stage, score, lives) {
  $('title').hidden = true; $('result').hidden = true; $('pause').hidden = true; paused = false;
  game = new Game({ stage: stage - 1, stats, score, lives, god: params.has('god'), seed: Math.floor(Math.random() * 1e6) });
  game.player.want = want;
  save.reached = Math.max(save.reached, stage); persist();
  rend.fx = []; rend.resize();
  $('stage').textContent = `${stage}/${STAGES}`;
  $('pellet-demo').textContent = PELLET_CHARS[stage - 1];
  hud();
}
function hud() {
  if (!game) return;
  $('score').textContent = String(game.score);
  $('lives').textContent = '●'.repeat(Math.max(0, game.lives - (game.phase === 'dying' ? 1 : 0)) ) || '-';
  if (game.score > save.hi) { save.hi = game.score; }
  $('hi').textContent = String(save.hi);
  $('powerfill').style.width = game.power > 0 ? `${game.power / game.params.powerTime * 100}%` : '0';
}
function onStageClear() {
  save.reached = Math.max(save.reached, Math.min(STAGES, game.stage + 2));
  persist(); hud(); sfx('clear');
  const stage = game.stage + 1, score = game.score, lives = game.lives;
  if (stage >= STAGES) {
    showResult('全面クリア！', `${STAGES}面ぜんぶ食べつくした！<br>スコア <b>${score}</b>${score >= save.hi ? '（ハイスコア！）' : ''}`,
      [['もう一度（1面から）', () => begin(1, 0, 3)], ['字をえらびなおす', showTitle, true]]);
  } else {
    showResult(`${stage}面クリア！`, `スコア <b>${score}</b> ／ ライフ ${'●'.repeat(lives)}<br>つぎは ${stage + 1}面（粒は「${PELLET_CHARS[stage]}」）`,
      [[`${stage + 1}面へ`, () => begin(stage + 1, score, lives)], ['面セレクト', showTitle, true]]);
  }
}
function onGameOver() {
  persist(); hud();
  const stage = game.stage + 1;
  showResult('ゲームオーバー', `${stage}面まで進んだ。スコア <b>${game.score}</b>（ハイスコア ${save.hi}）`,
    [[`${stage}面からもう一度`, () => begin(stage, 0, 3)], ['面セレクト', showTitle, true]]);
}

// ---------- 入力 ----------
const KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
function input(d) { want = d; if (game) game.setWant(d); }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code in KEYS) { e.preventDefault(); audioStart(); input(KEYS[e.code]); }
  else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
// スワイプ：指をある程度動かすたびに向きを決め直す
let sw = null;
view.addEventListener('pointerdown', e => { audioStart(); sw = { id: e.pointerId, x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', e => {
  if (!sw || e.pointerId !== sw.id) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (Math.hypot(dx, dy) < 22) return;
  input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  sw.x = e.clientX; sw.y = e.clientY;
});
const swEnd = e => { if (sw && e.pointerId === sw.id) sw = null; };
view.addEventListener('pointerup', swEnd); view.addEventListener('pointercancel', swEnd);
// バーチャルスティック
const stickEl = $('stick'), knob = $('knob');
let stickId = null;
function stickMove(e) {
  const r = stickEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2, len = Math.hypot(dx, dy) || 1, k = Math.min(1, len / max);
  knob.style.transform = `translate(${dx / len * k * max * 0.6}px, ${dy / len * k * max * 0.6}px)`;
  if (len > max * 0.3) input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
}
stickEl.addEventListener('pointerdown', e => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); audioStart(); stickMove(e); });
stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = e => { if (e.pointerId === stickId) { stickId = null; knob.style.transform = ''; } };
stickEl.addEventListener('pointerup', stickEnd); stickEl.addEventListener('pointercancel', stickEnd);

function togglePause() {
  if (!game || !$('title').hidden || !$('result').hidden) return;
  paused = !paused; $('pause').hidden = !paused;
}
$('btn-pause').onclick = togglePause;
$('btn-resume').onclick = togglePause;
$('btn-menu').onclick = () => { if (game && game.phase !== 'done') { paused = false; $('pause').hidden = true; showTitle(); } };
document.addEventListener('visibilitychange', () => { if (document.hidden && game && $('title').hidden && $('result').hidden && !paused) togglePause(); });
addEventListener('resize', () => rend.resize());

// ---------- 音（WebAudio の合成だけ） ----------
let ac = null, flip = 0;
function audioStart() {
  try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch { ac = null; }
}
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
  if (!ac || save.mute) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(name) {
  switch (name) {
    case 'pellet': flip ^= 1; tone(flip ? 520 : 660, 0.07, 'square', 0.035); break;
    case 'power': tone(200, 0.4, 'sawtooth', 0.06, 500); break;
    case 'ghost': tone(500, 0.25, 'square', 0.06, 900); break;
    case 'fruit': [880, 1100, 1320].forEach((f, i) => tone(f, 0.1, 'triangle', 0.07, 0, i * 0.07)); break;
    case 'death': tone(700, 0.9, 'sawtooth', 0.07, -600); break;
    case 'ready': [392, 523, 659].forEach((f, i) => tone(f, 0.14, 'triangle', 0.06, 0, i * 0.12)); break;
    case 'clear': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, 0, i * 0.12)); break;
    case 'life': [784, 988, 1175].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, 0, i * 0.08)); break;
    default:
  }
}
$('btn-sound').onclick = () => { save.mute = !save.mute; persist(); $('btn-sound').textContent = save.mute ? '音 OFF' : '音 ON'; audioStart(); };
$('btn-sound').textContent = save.mute ? '音 OFF' : '音 ON';

// ---------- メインループ ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game) {
    if (!paused && $('title').hidden) {
      game.update(dt * TIME_SCALE);
      for (const e of game.takeEvents()) {
        rend.event(e, game);
        if (e.type === 'pellet') sfx('pellet');
        else if (e.type === 'power') sfx('power');
        else if (e.type === 'ghostEaten') sfx('ghost');
        else if (e.type === 'fruit') sfx('fruit');
        else if (e.type === 'death') sfx('death');
        else if (e.type === 'ready') sfx('ready');
        else if (e.type === 'life') sfx('life');
        else if (e.type === 'stageClear') onStageClear();
        else if (e.type === 'over') onGameOver();
      }
      hud();
    }
    rend.draw(game, now / 1000, paused ? 0 : dt);
  } else {
    rend.ctx.setTransform(1, 0, 0, 1, 0, 0);
    rend.ctx.fillStyle = '#07070f'; rend.ctx.fillRect(0, 0, view.width, view.height);
  }
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
buildTitle();
rend.resize();
requestAnimationFrame(frame);
loadGlyphLib().then(ok => { if (ok) { stats = statsFor(ch); if (!game) renderStatBox(); } });
if (params.has('autostart')) begin(startStage, 0, 3);

// テスト用の取っ手
window.__kui = {
  game: () => game, input, begin, stats: () => stats, chooseChar, rend,
  save: () => save,
};
