// 文字もぐらたたき：画面・進行・保存。ゲームの中身は logic.js、お題は topics.js、字のデータは kanji.js
// 描画は DOM（穴ごとのボタン）と CSS アニメーション。外部ファイルは使わない
import { TOPICS } from './topics.js';
import { KANJI } from './kanji.js';
import { ROUND_COUNT, ROUND_TIME, LIFE, newRound, step, tap, comboMult, rankFor } from './logic.js';

const SAVE_KEY = 'moji_mogura.v1';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SPEED = Number(params.get('fast')) || 1;   // 動作確認用：時間を速める（?fast=3）

// ---------- 保存：通しのハイスコア、ラウンドごとのハイスコア ----------
let save = { best: 0, rounds: {} };
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (d && typeof d === 'object') save = { best: Number(d.best) || 0, rounds: d.rounds || {} };
} catch (e) { /* 保存データが無い・壊れていてもはじめから遊べる */ }
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続行 */ } }

// ---------- 画面の切りかえ ----------
const overlays = ['title', 'select', 'intro', 'rresult', 'final'];
function show(name) { overlays.forEach(o => { $(o).hidden = o !== name; }); }

// ---------- 状態 ----------
let mode = 'all';      // 'all'＝全10ラウンド／'single'＝1ラウンドだけ
let roundIndex = 0;
let round = null;
let totals = [];       // 全ラウンドモードの、ラウンドごとの得点
let running = false;
let lastTime = 0;
let holeEls = [];
let timers = [];

function renderBest() {
  $('best-line').textContent = save.best ? `通しのハイスコア：${save.best}点` : '';
}

// ---------- 盤の組み立て ----------
function buildBoard(n) {
  const b = $('board');
  b.innerHTML = '';
  b.style.setProperty('--n', n);
  b.className = n === 4 ? 'board4' : '';
  holeEls = [];
  for (let i = 0; i < n * n; i++) {
    const h = document.createElement('div');
    h.className = 'hole';
    h.dataset.i = i;
    h.innerHTML = '<div class="pop"></div><div class="front"></div><div class="hammer"></div><div class="fx"></div>';
    h.addEventListener('pointerdown', e => { e.preventDefault(); onTap(i); });
    b.appendChild(h);
    holeEls.push({ root: h, pop: h.querySelector('.pop'), fx: h.querySelector('.fx'), key: null });
  }
}

// ---------- ラウンドの開始 ----------
function openIntro(i) {
  roundIndex = i;
  const t = TOPICS[i];
  round = newRound(i);
  buildBoard(round.cfg.n);
  syncHud();
  $('topic').textContent = `お題：${t.title}`;
  $('round-name').textContent = `ラウンド ${i + 1} / ${ROUND_COUNT}`;
  $('intro-no').textContent = `ラウンド ${i + 1}`;
  $('intro-title').textContent = t.title;
  const ex = $('intro-examples');
  ex.innerHTML = '';
  const pool = [...t.correct].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const ch of pool) { const s = document.createElement('span'); s.className = 'glyph'; s.textContent = ch; ex.appendChild(s); }
  setInfo('お題に合う字だけを叩こう！', 'empty');
  show('intro');
}

function startRound() {
  show(null);
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

// ---------- 毎フレーム ----------
function loop(now) {
  if (!running) return;
  const dt = Math.min(50, now - lastTime) * SPEED;
  lastTime = now;
  handleEvents(step(round, dt));
  syncHud();
  syncHoles();
  if (round.done) { running = false; setTimeout(finishRound, 500); return; }
  requestAnimationFrame(loop);
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === 'escape') {
      fx(ev.i, '逃げた！ −30', 'bad');
      setInfo(`逃げられた… ${explain(ev.ch, true)}`, 'ng');
    }
  }
}

// 穴の見た目を、ゲームの状態に合わせる
function syncHoles() {
  round.holes.forEach((h, i) => {
    const e = holeEls[i];
    const key = h ? `${h.ch}@${h.born}` : null;
    if (key === e.key) return;
    e.key = key;
    e.pop.className = 'pop';
    if (h) {
      e.pop.textContent = h.ch;
      e.pop.classList.add('glyph');
      void e.pop.offsetWidth;
      e.pop.classList.add('up');
    }
  });
}

function syncHud() {
  const r = round;
  $('score').textContent = r.score;
  $('combo').textContent = r.combo >= 2 ? `${r.combo}コンボ ×${comboMult(r.combo)}` : '';
  $('life').textContent = '♥'.repeat(Math.max(0, r.life)) + '♡'.repeat(LIFE - Math.max(0, r.life));
  const sec = Math.max(0, r.left) / 1000;
  $('timefill').style.width = `${(sec / ROUND_TIME) * 100}%`;
  $('timefill').classList.toggle('low', sec <= 5);
  $('timetext').textContent = `のこり ${Math.ceil(sec)} 秒`;
}

function setInfo(text, cls) {
  const e = $('info');
  e.textContent = text;
  e.className = cls || '';
}

function fx(i, text, cls) {
  const f = holeEls[i].fx;
  f.textContent = text;
  f.className = `fx ${cls}`;
  void f.offsetWidth;
  f.classList.add('show');
}

// 叩いたあとの1行解説
function explain(ch, ok) { return TOPICS[roundIndex].explain(ch, ok); }

// ---------- タップ ----------
function onTap(i) {
  if (!running || !round || round.done) return;
  const e = holeEls[i];
  e.root.classList.remove('swing'); void e.root.offsetWidth; e.root.classList.add('swing');
  const shownCh = round.holes[i] && round.holes[i].ch;
  const res = tap(round, i);
  if (res.kind === 'none') return;
  const el = e.pop;
  if (res.kind === 'hit') {
    el.className = 'pop glyph up hit';
    setTimeout(() => el.classList.remove('up'), 160);
    fx(i, `+${res.gained}`, 'good');
    setInfo(`○ ${explain(shownCh, true)}`, 'ok');
  } else {
    el.className = 'pop glyph up bad';
    setTimeout(() => el.classList.remove('up'), 160);
    fx(i, 'ちがう！', 'bad');
    const b = $('board'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    setInfo(`× ${explain(shownCh, false)}`, 'ng');
  }
  e.key = null;   // 次に同じ穴へ出たとき、見た目を作り直す
  syncHud();
}

// ---------- ラウンド終了 ----------
function finishRound() {
  const r = round;
  const prev = save.rounds[roundIndex] || 0;
  const newBest = r.score > prev;
  if (newBest) save.rounds[roundIndex] = r.score;
  writeSave();
  totals[roundIndex] = r.score;
  const last = mode === 'all' && roundIndex === ROUND_COUNT - 1;
  $('rr-title').textContent = `ラウンド ${roundIndex + 1}：${r.reason === 'life' ? 'ライフがなくなった…' : 'おつかれさま！'}`;
  $('rr-score').textContent = `${r.score}点`;
  $('rr-sub').innerHTML =
    `叩いた正解 ${r.hits}　まちがい ${r.wrongs}　逃がした ${r.escapes}<br>` +
    `最大コンボ ${r.maxCombo}` +
    (mode === 'single' ? `<br>このラウンドのハイスコア：${save.rounds[roundIndex]}点${newBest ? '　<span style="color:#d6001c;font-weight:bold">新記録！</span>' : ''}` : '');
  const btns = $('rr-btns');
  btns.innerHTML = '';
  const add = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; btns.appendChild(b); return b; };
  if (mode === 'all') {
    const nxt = add(last ? '結果を見る' : 'つぎのラウンドへ', () => (last ? showFinal() : openIntro(roundIndex + 1)));
    nxt.id = 'rr-next';
  } else {
    add('もう一度', () => openIntro(roundIndex)).id = 'rr-again';
    add('ラウンド選択', openSelect, 'sub');
  }
  show('rresult');
}

function showFinal() {
  const total = totals.reduce((a, b) => a + (b || 0), 0);
  const isNew = total > save.best;
  if (isNew) { save.best = total; writeSave(); }
  $('fin-rank').textContent = rankFor(total);
  $('fin-total').textContent = `${total}点`;
  $('fin-best').innerHTML = isNew ? '<span class="new">ハイスコア更新！</span>' : `ハイスコア：${save.best}点`;
  const list = $('fin-list');
  list.innerHTML = '';
  TOPICS.forEach((t, i) => {
    const d = document.createElement('div');
    d.innerHTML = `<span>${i + 1}. ${t.short}</span><b>${totals[i] || 0}</b>`;
    list.appendChild(d);
  });
  show('final');
}

// ---------- ラウンド選択 ----------
function openSelect() {
  const g = $('select-grid');
  g.innerHTML = '';
  TOPICS.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'sel-btn';
    b.innerHTML = `<b>ラウンド ${i + 1}</b>${t.short}<br><small>${save.rounds[i] ? `ハイスコア ${save.rounds[i]}` : 'まだ未プレイ'}</small>`;
    b.onclick = () => { mode = 'single'; openIntro(i); };
    g.appendChild(b);
  });
  show('select');
}

function backToTitle() {
  running = false;
  renderBest();
  show('title');
}

// ---------- ボタン ----------
$('go-all').onclick = () => { mode = 'all'; totals = []; openIntro(0); };
$('go-select').onclick = openSelect;
$('select-close').onclick = backToTitle;
$('intro-go').onclick = startRound;
$('btn-quit').onclick = backToTitle;
$('fin-again').onclick = () => { mode = 'all'; totals = []; openIntro(0); };
$('fin-select').onclick = openSelect;
$('fin-title').onclick = backToTitle;

renderBest();
buildBoard(3);
show('title');

// 動作確認用（Playwright から使う）
window.__mogura = {
  state: () => round && ({
    index: roundIndex, n: round.cfg.n, left: round.left, life: round.life, score: round.score, combo: round.combo,
    done: round.done, running,
    holes: round.holes.map(h => h && { ch: h.ch, target: h.target }),
  }),
  holeCenter: i => { const r = holeEls[i].root.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  speed: SPEED,
};
