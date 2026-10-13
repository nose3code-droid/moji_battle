// 部首トランプ：部首と部品のカードで漢字を作るカードゲーム。ルールは logic.js、データは recipes.js
// 画面は DOM（カード・卓）と Canvas 2D（成功のキラキラ）。保存は localStorage
// （フォントを CDN から読めないときは、ふつうの文字で遊べる）
import { FONT_URL } from '../../config.js';
import { PARTS, SPECIALS, RECIPES } from './recipes.js';
import { newGame, evaluate, bestMove, cpuStep, applyMake, applyDraw, applySpecial, endTurn, RECIPE_BY_CH, HINT_COST, LEVELS } from './logic.js';

const SAVE_KEY = 'moji_torampu.save';
const params = new URLSearchParams(location.search);
const SPEED = params.has('fast') ? 0.05 : 1; // ?fast は自動テスト用（演出を短くする）
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const wait = ms => new Promise(r => setTimeout(r, ms * SPEED));
const CPU_NAMES = ['あなた', 'タロウ', 'ハナコ', 'ケンタ'];

// ---------- 保存 ----------
let save = { games: 0, wins: 0, book: {} };
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (d && typeof d === 'object') save = { games: d.games | 0, wins: d.wins | 0, book: d.book && typeof d.book === 'object' ? d.book : {} };
} catch (e) { /* 保存データが無い・壊れていてもはじめから遊べる */ }
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続行 */ } }

// ---------- フォント（読めなければふつうの文字） ----------
(async () => {
  try {
    const face = new FontFace('MojiTorampu', `url(${FONT_URL})`);
    await Promise.race([face.load(), new Promise((_, rej) => setTimeout(rej, 6000))]);
    document.fonts.add(face);
  } catch (e) { /* 代用フォントで続行 */ }
})();

// ---------- 状態 ----------
let st = null;
let opts = { count: 2, level: 'normal', target: 30 };
let sel = [];            // 選んでいるカード
let turnActive = false;  // 人間の番で入力を受けつける間 true
let swap = null;         // 入れ替えモード中：{ hand, field }
let hintIds = new Set();
let lastHandIds = new Set();
let runId = 0;           // 新しいゲームを始めたら古い進行を止める
let resolver = null;
const waitAction = () => new Promise(r => { resolver = r; });
const fire = a => { if (resolver) { const r = resolver; resolver = null; r(a); } };

// ---------- 描画 ----------
const hueOf = c => c.kind === 'part' ? PARTS[c.ch].hue : SPECIALS[c.kind].hue;
function cardEl(c) {
  const d = document.createElement('div');
  d.className = 'card-c' + (c.kind === 'part' ? '' : ' sp');
  d.style.setProperty('--h', hueOf(c));
  d.dataset.id = c.id;
  if (c.kind === 'part') d.innerHTML = `<span class="glyph">${esc(c.ch)}</span>`;
  else d.innerHTML = `<span class="ic">${SPECIALS[c.kind].icon}</span><span class="lb">${SPECIALS[c.kind].label}</span>`;
  return d;
}
const handEl = id => $('hand').querySelector(`[data-id="${id}"]`);
const rectOf = el => el.getBoundingClientRect();
const seatEl = pi => document.getElementById(`cpu-${pi}`) || $('hand');

function buildSeats() {
  for (const id of ['seat-top', 'seat-left', 'seat-right']) $(id).innerHTML = '';
  const n = st.players.length;
  const pos = n === 2 ? ['seat-top'] : n === 3 ? ['seat-left', 'seat-right'] : ['seat-left', 'seat-top', 'seat-right'];
  pos.forEach((id, k) => { $(id).innerHTML = `<div class="cpu" id="cpu-${k + 1}"><div class="nm"></div><div class="sc"></div><div class="fan"></div><div class="cn"></div></div>`; });
}
function renderSeats() {
  st.players.forEach((p, i) => {
    if (!i) return;
    const el = $(`cpu-${i}`);
    el.classList.toggle('act', st.cur === i && !st.over);
    el.classList.toggle('skip', p.skip);
    el.querySelector('.nm').textContent = p.name;
    el.querySelector('.sc').innerHTML = `${p.score}<small>点</small>`;
    el.querySelector('.fan').innerHTML = '<i></i>'.repeat(Math.min(8, p.hand.length));
    el.querySelector('.cn').textContent = `手札 ${p.hand.length}枚`;
  });
  const me = st.players[0];
  $('you-score').textContent = me.score;
  $('you-made').textContent = me.made.length ? '作った字：' + me.made.join('') : '';
  $('you').classList.toggle('act', st.cur === 0 && !st.over);
  $('deck-n').textContent = st.deck.length;
  $('discard-n').textContent = st.discard.length;
  $('target').textContent = st.target;
}
// 手札を描き直す。新しく増えたカードは from の位置からスライドして入ってくる
function renderHand(from) {
  const h = $('hand'), me = st.players[0];
  const fromRect = from || rectOf($('deck-pile'));
  h.innerHTML = '';
  const fresh = [];
  for (const c of me.hand) {
    const el = cardEl(c);
    if (sel.includes(c)) el.classList.add('sel');
    if (hintIds.has(c.id)) el.classList.add('hint');
    if (swap?.hand === c) el.classList.add('swappick');
    el.addEventListener('pointerdown', e => onCardDown(e, c, el));
    h.appendChild(el);
    if (!lastHandIds.has(c.id)) fresh.push(el);
  }
  lastHandIds = new Set(me.hand.map(c => c.id));
  h.classList.toggle('disabled', !turnActive);
  fresh.forEach((el, i) => {
    const r = rectOf(el);
    el.animate([{ transform: `translate(${fromRect.left - r.left}px, ${fromRect.top - r.top}px) scale(.6) rotate(-15deg)`, opacity: .3 }, { transform: 'none', opacity: 1 }],
      { duration: 380 * SPEED + 1, delay: i * 90 * SPEED, easing: 'ease-out', fill: 'backwards' });
  });
}
function refreshSel() {
  for (const el of $('hand').children) {
    const c = st.players[0].hand.find(x => x.id == el.dataset.id);
    el.classList.toggle('sel', sel.includes(c));
    el.classList.toggle('swappick', swap?.hand === c);
  }
  updateButtons();
}
function renderField(hideMinis = false) {
  const fc = $('field-cards');
  fc.innerHTML = '';
  st.field.forEach((c, i) => {
    const m = document.createElement('div');
    m.className = 'mini glyph' + (hideMinis ? ' hid' : '') + (swap?.field === c ? ' pick' : '');
    m.style.setProperty('--h', PARTS[c.ch].hue);
    m.textContent = c.ch;
    m.dataset.id = c.id;
    m.addEventListener('click', () => { if (swap && turnActive) { swap.field = c; fc.querySelectorAll('.mini').forEach(x => x.classList.toggle('pick', x === m)); checkSwapReady(); } });
    fc.appendChild(m);
  });
  $('field').classList.toggle('swapmode', !!swap);
}
function setMsg(t) { $('msg').textContent = t || ''; }
function setLog(t) { $('log').textContent = t || ''; }
function updateButtons() {
  const mk = $('btn-make'), single = sel.length === 1 && sel[0].kind !== 'part' && sel[0].kind !== 'wild';
  const on = turnActive && !st.over;
  if (swap) {
    mk.textContent = 'やめる'; mk.disabled = !on; mk.classList.remove('ready');
    $('btn-draw').disabled = true; $('btn-hint').disabled = true;
    return;
  }
  mk.textContent = single ? '使う！' : '作る！';
  mk.disabled = !on || !(single || (sel.length >= 2 && sel.length <= 3));
  mk.classList.toggle('ready', !mk.disabled);
  $('btn-draw').disabled = !on;
  $('btn-hint').disabled = !on;
  $('btn-hint').textContent = `ヒント(-${HINT_COST}点)`;
}

// ---------- カードの選択・ドラッグ ----------
function toggleSelect(c, force) {
  if (!turnActive) return;
  if (swap) { // 入れ替え中は、手札の部品を1枚えらぶだけ
    if (c.kind !== 'part') { setMsg('部品のカードをえらんでね'); return; }
    swap.hand = swap.hand === c ? null : c; refreshSel(); checkSwapReady(); return;
  }
  hintIds.clear(); for (const el of $('hand').children) el.classList.remove('hint');
  const i = sel.indexOf(c);
  if (i >= 0) { if (force) return; sel.splice(i, 1); }
  else {
    const special = c.kind !== 'part' && c.kind !== 'wild';
    if (special) sel = [c];
    else { sel = sel.filter(x => x.kind === 'part' || x.kind === 'wild'); if (sel.length >= 3) { setMsg('えらべるのは3枚までだよ'); return; } sel.push(c); }
  }
  setMsg(sel.length === 1 && sel[0].kind !== 'part' && sel[0].kind !== 'wild' ? SPECIALS[sel[0].kind].desc : '');
  refreshSel();
}
function overField(x, y) { const r = rectOf($('center')); return x >= r.left && x <= r.right && y >= r.top - 10 && y <= r.bottom + 10; }
function onCardDown(e, c, el) {
  if (!turnActive) return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  let ghost = null;
  const move = ev => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
      ghost = cardEl(c); ghost.classList.add('ghost'); document.body.appendChild(ghost); el.style.opacity = .35;
    }
    if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; $('field').classList.toggle('drop', overField(ev.clientX, ev.clientY)); }
  };
  const up = ev => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    $('field').classList.remove('drop'); el.style.opacity = '';
    if (ghost) { ghost.remove(); if (overField(ev.clientX, ev.clientY)) toggleSelect(c, true); }
    else toggleSelect(c);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

// ---------- 演出 ----------
// from の位置から to の位置へ、カードの複製を飛ばす
function flyCard(c, fromRect, toRect, { dur = 450, delay = 0, back = false } = {}) {
  const f = back ? Object.assign(document.createElement('div'), { className: 'card-c' }) : cardEl(c);
  if (back) { f.style.background = 'repeating-linear-gradient(45deg,#3b5bdb,#3b5bdb 4px,#5c7cfa 4px,#5c7cfa 8px)'; f.style.borderColor = '#fff'; }
  Object.assign(f.style, { left: fromRect.left + 'px', top: fromRect.top + 'px', width: fromRect.width + 'px', height: fromRect.height + 'px' });
  $('fly').appendChild(f);
  const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2), dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
  const s = toRect.width / fromRect.width;
  const a = f.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${(Math.random() - .5) * 20}deg)` }],
    { duration: dur * SPEED + 1, delay: delay * SPEED, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  return a.finished.then(() => f.remove(), () => f.remove());
}
const particles = [];
function burst(x, y, n = 36) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 6;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 1, hue: Math.random() * 360, r: 3 + Math.random() * 4 });
  }
  if (particles.length === n) requestAnimationFrame(tickFx);
}
function tickFx() {
  const cv = $('fx'), ctx = cv.getContext('2d');
  const dpr = devicePixelRatio || 1;
  if (cv.width !== innerWidth * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += .22; p.life -= .016; }
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = `hsl(${p.hue} 90% 60%)`; ctx.fillRect(p.x, p.y, p.r, p.r); }
  ctx.globalAlpha = 1;
  if (particles.length) requestAnimationFrame(tickFx); else ctx.clearRect(0, 0, innerWidth, innerHeight);
}

// ---------- 行動 ----------
async function doMake(pi, move) {
  const my = runId, p = st.players[pi], r = move.recipe;
  // 飛ばす元の位置（人間は手札のカード、CPU は席）を、描き直す前に控える
  const froms = move.cards.map(c => {
    const el = pi === 0 ? handEl(c.id) : null;
    return el ? rectOf(el) : (() => { const s = rectOf(seatEl(pi)); return { left: s.left + s.width / 2 - 27, top: s.top + s.height / 2 - 38, width: 54, height: 76 }; })();
  });
  sel = []; hintIds.clear();
  applyMake(st, pi, move);
  renderSeats(); renderHand(); renderField(true);
  setMsg('');
  const minis = [...$('field-cards').children];
  await Promise.all(move.cards.map((c, i) => flyCard(c.kind === 'wild' ? { ...c, kind: 'part', ch: move.as } : c, froms[i], rectOf(minis[i]), { delay: i * 90 })));
  if (my !== runId) return;
  minis.forEach(m => m.classList.remove('hid'));
  const fch = $('field-char');
  fch.textContent = r.ch; fch.classList.remove('pop'); void fch.offsetWidth; fch.classList.add('pop');
  const fr = rectOf(fch);
  burst(fr.left + fr.width / 2, fr.top + fr.height / 2, pi === 0 ? 48 : 24);
  const wildNote = move.wild ? `（ワイルドを「${move.as}」にした）` : '';
  $('field-info').innerHTML = `<b>${esc(r.ch)}</b>（${r.strokes}画・${esc(r.kind)}）<b>+${move.score}点</b>${esc(wildNote)}<span class="why">${esc(r.desc)}</span>`;
  setLog(`${p.name}が「${r.ch}」を作った！ +${move.score}点`);
  await wait(pi === 0 ? 1800 : 1400);
}
async function doDraw(pi) {
  const p = st.players[pi];
  const from = rectOf($('deck-pile'));
  if (pi === 0) { const got = applyDrawSafe(pi); renderSeats(); renderHand(); setLog(got ? 'あなたは山札から1枚ひいた' : '山札がない！'); }
  else {
    const got = applyDrawSafe(pi);
    if (got) await flyCard(null, rectOf($('deck-pile').firstElementChild), rectOf(seatEl(pi)), { dur: 350, back: true });
    renderSeats(); setLog(`${p.name}は作れず、1枚ひいた`);
  }
  await wait(600);
}
function applyDrawSafe(pi) { return applyDraw(st, pi).length; }

async function doSpecial(pi, card, o) {
  const p = st.players[pi], label = SPECIALS[card.kind].label;
  const fromEl = pi === 0 ? handEl(card.id) : null;
  const from = fromEl ? rectOf(fromEl) : (() => { const s = rectOf(seatEl(pi)); return { left: s.left + s.width / 2 - 27, top: s.top + s.height / 2 - 38, width: 54, height: 76 }; })();
  const before = new Set(p.hand.map(c => c.id));
  if (!applySpecial(st, pi, card, o)) return false;
  sel = []; swap = null;
  setLog(`${p.name}が「${label}」を使った！ ${card.kind === 'stop' ? 'つぎの人は1回休み' : card.kind === 'more' ? '山札から2枚ひく' : '場のカードと入れ替え'}`);
  renderSeats(); renderHand(); renderField();
  void before;
  await flyCard(card, from, rectOf($('discard-pile').firstElementChild), { dur: 450 });
  await wait(pi === 0 ? 300 : 900);
  return true;
}

function checkSwapReady() {
  if (swap && swap.hand && swap.field) fire({ type: 'swapdone' });
  else setMsg(!swap.hand ? '① 手札の部品を1枚えらぶ' : '② 場の部品を1枚えらぶ');
}

async function humanTurn() {
  turnActive = true; sel = []; swap = null;
  renderSeats(); renderHand(); updateButtons();
  setMsg('あなたの番！ カードを2〜3枚えらんで「作る！」');
  for (;;) {
    const a = await waitAction();
    if (!st || st.over) return;
    if (a.type === 'make') {
      if (sel.length === 1 && sel[0].kind !== 'part' && sel[0].kind !== 'wild') {
        const card = sel[0];
        if (st.specialUsed) { setMsg('とくべつカードは1ターンに1枚までだよ'); continue; }
        if (card.kind === 'swap') {
          if (!st.field.length) { setMsg('場にまだカードがないよ'); continue; }
          if (!st.players[0].hand.some(c => c.kind === 'part')) { setMsg('入れ替える部品がないよ'); continue; }
          swap = { hand: null, field: null }; sel = []; renderHand(); renderField(); updateButtons(); setMsg('① 手札の部品を1枚えらぶ');
          for (;;) {
            const b = await waitAction();
            if (!st || st.over) return;
            if (b.type === 'cancel') { swap = null; renderHand(); renderField(); updateButtons(); setMsg('入れ替えをやめた'); break; }
            if (b.type === 'swapdone') {
              const o = { hand: swap.hand, field: swap.field }; swap = null; turnActive = false;
              await doSpecial(0, card, o); turnActive = true; updateButtons(); renderHand(); setMsg('入れ替えた！ このまま作れるよ'); break;
            }
          }
          continue;
        }
        turnActive = false;
        await doSpecial(0, card);
        turnActive = true; updateButtons(); renderHand(); setMsg('つづけて、カードを2〜3枚えらんで「作る！」');
        continue;
      }
      if (swap) continue;
      const ev = evaluate(sel);
      if (!ev) {
        setMsg('漢字にならなかった…カードは手札にもどるよ');
        for (const c of sel) handEl(c.id)?.classList.add('shake');
        turnActive = false; updateButtons(); await wait(450);
        turnActive = true; sel = []; renderHand(); updateButtons();
        continue;
      }
      turnActive = false; updateButtons();
      await doMake(0, { cards: [...sel], ...ev, score: ev.recipe.strokes, wild: !!ev.as });
      return;
    }
    if (a.type === 'cancel') continue;
    if (a.type === 'draw') { turnActive = false; updateButtons(); await doDraw(0); return; }
    if (a.type === 'hint') {
      const m = bestMove(st.players[0].hand);
      if (!m) { setMsg('いまは作れる組み合わせがないよ。「1枚ひく」を押そう'); continue; }
      const me = st.players[0], cost = Math.min(HINT_COST, me.score);
      me.score -= cost; sel = []; hintIds = new Set(m.cards.map(c => c.id));
      setMsg(`ヒント！ 光っているカードで作れるよ（-${cost}点）`);
      renderSeats(); renderHand(); updateButtons();
    }
  }
}
async function cpuTurn(pi) {
  turnActive = false; updateButtons(); renderSeats();
  setMsg(`${st.players[pi].name}の番…`);
  await wait(800);
  for (let k = 0; k < 5; k++) {
    const a = cpuStep(st, pi);
    if (a.type === 'special') { await doSpecial(pi, a.card, a.opts); if (st.over) return; continue; }
    if (a.type === 'make') await doMake(pi, a.move); else await doDraw(pi);
    return;
  }
}

// ---------- ゲームの進行 ----------
async function run() {
  const my = runId;
  while (!st.over && my === runId) {
    renderSeats();
    if (st.cur === 0) await humanTurn(); else await cpuTurn(st.cur);
    if (my !== runId) return;
    if (st.over) break;
    const skipped = endTurn(st);
    if (skipped.length) { setLog(`${skipped.join('・')}は1回お休み`); await wait(900); }
  }
  if (my !== runId) return;
  turnActive = false; renderSeats(); renderHand(); updateButtons();
  await wait(800);
  showResult();
}
function startGame() {
  runId++;
  const names = CPU_NAMES;
  st = newGame({ count: opts.count, level: opts.level, target: opts.target, seed: params.has('seed') ? +params.get('seed') : Date.now(), names });
  sel = []; swap = null; hintIds.clear(); lastHandIds = new Set(); turnActive = false; resolver = null;
  buildSeats(); $('table').classList.toggle('two', opts.count === 2);
  $('field-char').textContent = '？'; $('field-char').classList.remove('pop');
  $('field-info').innerHTML = 'ここに漢字ができるよ。<br>手札から2〜3枚えらんで「作る！」';
  $('field-cards').innerHTML = '';
  setMsg(''); setLog(`${opts.count}人対戦・CPUは「${LEVELS[opts.level]}」`);
  $('title').hidden = true; $('result').hidden = true;
  renderSeats(); renderHand(); updateButtons();
  run();
}
function showResult() {
  const win = st.winner === 0, me = st.players[0];
  save.games++; if (win) save.wins++;
  for (const ch of me.made) save.book[ch] = (save.book[ch] || 0) + 1;
  writeSave();
  $('result-title').textContent = win ? '🎉 あなたの勝ち！' : `${st.players[st.winner].name}の勝ち…`;
  $('result-sub').textContent = st.reason;
  $('result-scores').innerHTML = st.players.map((p, i) => `<span class="${i === st.winner ? 'win' : ''}">${esc(p.name)} ${p.score}点</span>`).join('');
  $('result-made').innerHTML = me.made.length ? `<span class="glyph">${esc(me.made.join(' '))}</span>` : 'まだ漢字を作れなかった';
  $('result').hidden = false;
}
function showTitle() {
  runId++; st = st && st.over ? st : null;
  $('result').hidden = true; $('title').hidden = false;
  $('record').textContent = `戦績：${save.games}戦 ${save.wins}勝 ${save.games - save.wins}敗 ／ 作った漢字 ${Object.keys(save.book).length}/${RECIPES.length}`;
}
function showBook() {
  const got = Object.keys(save.book).filter(c => RECIPE_BY_CH.has(c)).length;
  $('book-count').textContent = `${got} / ${RECIPES.length}`;
  $('book-list').innerHTML = RECIPES.map(r => {
    const n = save.book[r.ch];
    return n
      ? `<div class="bk got"><span class="c glyph">${esc(r.ch)}</span><b>${esc(r.parts.join('＋'))}</b> ${r.strokes}画・${esc(r.kind)}<br>×${n}<div class="d">${esc(r.desc)}</div></div>`
      : `<div class="bk no"><span class="c glyph">？</span>${r.strokes}画・${esc(r.kind)}<div class="d">まだ作っていない</div></div>`;
  }).join('');
  $('book').hidden = false;
}

// ---------- 画面の部品 ----------
for (const [id, key, num] of [['opt-count', 'count', true], ['opt-level', 'level', false], ['opt-target', 'target', true]]) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    opts[key] = num ? +b.dataset.v : b.dataset.v;
    for (const x of $(id).children) x.classList.toggle('on', x === b);
  });
}
$('special-rules').innerHTML = Object.values(SPECIALS).map(s => `<li><b>${s.icon} ${s.label}</b>：${s.desc}</li>`).join('');
$('btn-start').onclick = startGame;
$('btn-again').onclick = startGame;
$('btn-title').onclick = showTitle;
$('btn-rule').onclick = () => { $('rule').hidden = false; };
$('rule-close').onclick = () => { $('rule').hidden = true; };
$('btn-book').onclick = showBook; $('title-book').onclick = showBook; $('result-book').onclick = showBook;
$('book-close').onclick = () => { $('book').hidden = true; };
$('btn-make').onclick = () => fire({ type: swap ? 'cancel' : 'make' });
$('btn-draw').onclick = () => fire({ type: 'draw' });
$('btn-hint').onclick = () => fire({ type: 'hint' });
showTitle();

// 自動テスト用に、状態と判定関数を公開する（遊ぶだけなら使わない）
window.__torampu = { get st() { return st; }, bestMove, SPEED };
