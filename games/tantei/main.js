// 漢字なりたち探偵：画面・会話・進行・保存（データは data.js、絵は pics.js）
import { FONT_URL } from '../../config.js';
import { CASES, CHARS, KINDS, HARD, QTYPE, ENDING, ALL_LEARN } from './data.js';
import { drawPic } from './pics.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'moji_tantei.v1';
const HINT_COST = 50, WRONG_COST = 10;

// ---------- フォント（読み込めなければ端末のフォントで表示する） ----------
try {
  new FontFace('MojiTantei', `url(${FONT_URL})`).load().then(f => document.fonts.add(f)).catch(() => {});
} catch { /* フォントなしでも遊べる */ }

// ---------- 保存：事件ごとの星・点数、図鑑 ----------
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') return { cases: s.cases || {}, dex: s.dex || {} };
  } catch { /* 無ければ初期状態 */ }
  return { cases: {}, dex: {} };
}
let save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } }
const cleared = i => !!save.cases[CASES[i].id]?.cleared;
const unlocked = i => i === 0 || cleared(i - 1);
const firstOpen = () => { const i = CASES.findIndex((_, k) => !cleared(k)); return i < 0 ? 0 : i; };
const starsOf = hints => hints === 0 ? 3 : hints <= 2 ? 2 : 1;
const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);

// ---------- 画面の切りかえ ----------
const SCREENS = ['title', 'select', 'play', 'pick', 'result', 'dex', 'ending'];
let screen = 'title';
function show(name) {
  screen = name;
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('hint').hidden = $('reset').hidden = name !== 'play';
  $('to-select').hidden = name === 'title' || name === 'select';
  window.scrollTo(0, 0);
}

// ---------- 確認ダイアログ ----------
function ask(text, ok = 'はい') {
  return new Promise(res => {
    $('modal-text').textContent = text; $('modal-ok').textContent = ok; $('modal').hidden = false;
    const done = v => { $('modal').hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; res(v); };
    $('modal-ok').onclick = () => done(true);
    $('modal-cancel').onclick = () => done(false);
  });
}

// ---------- 会話 ----------
let talkQ = [], talkI = 0, afterTalk = null, talking = false;
function talk(lines, done) {
  talkQ = lines; talkI = 0; afterTalk = done; talking = true;
  $('talk').hidden = false; showLine();
}
function showLine() {
  const [who, text] = talkQ[talkI];
  const av = $('talk-av'), c = CHARS[who] || { color: '#888' };
  av.textContent = c.av ?? who; av.style.background = c.color;
  $('talk-name').textContent = who === '語り' ? '' : '「' + who + '」';
  $('talk-text').textContent = text;
}
function nextLine() {
  if (!talking) return;
  if (++talkI < talkQ.length) { showLine(); return; }
  talking = false; $('talk').hidden = true;
  const f = afterTalk; afterTalk = null; f?.();
}
$('talk').addEventListener('click', nextLine);
document.addEventListener('keydown', e => { if (talking && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nextLine(); } });

// ---------- 小さな道具 ----------
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function kindBadge(kind) { const b = el('span', 'kind', kind); b.style.background = KINDS[kind] || '#888'; return b; }
function learnBlock(l) {
  const d = el('div', 'learn');
  d.append(el('div', 'ch', l.ch));
  const p = el('p'); p.append(kindBadge(l.kind));
  if (HARD.has(l.ch)) p.append(el('span', 'tag-hard', 'むずかしい字'), ' ');
  p.append(l.text); d.append(p);
  return d;
}

// ---------- 事件の進行 ----------
let G = null;   // 今の事件の状態
let Q = null;   // 今の謎の状態

function startCase(ci) {
  const c = CASES[ci];
  G = { ci, qi: 0, out: new Set(), reason: {}, clues: [], hints: 0, mistakes: 0, score: 0 };
  if (c.useMemos) {  // 最後の事件：これまでの証言を持ちこむ
    CASES.slice(0, ci).forEach((p, k) => {
      if (!p.memo) return;
      G.clues.push({ text: p.memo.text, tag: `事件${k + 1}の証言` });
      for (const ch of p.memo.out) { G.out.add(ch); G.reason[ch] = p.memo.text; }
    });
  }
  show('play');
  $('case-title').textContent = `事件${ci + 1}「${c.title}」`;
  $('case-place').textContent = c.place;
  $('bar-title').textContent = `事件${ci + 1}`;
  renderSuspects(); renderClues();
  $('qbox').replaceChildren();
  talk(c.intro, showQuestion);
}

function susChip(ch, extra = '') {
  const b = el('div', 'sus' + (G.out.has(ch) ? ' out' : '') + extra, ch);
  if (HARD.has(ch)) b.append(el('span', 'hard', '難'));
  return b;
}
function renderSuspects(justOut = []) {
  const box = $('suspects'); box.replaceChildren();
  for (const ch of CASES[G.ci].suspects) box.append(susChip(ch, justOut.includes(ch) ? ' just' : ''));
}
function renderClues() {
  const ol = $('clues'); ol.replaceChildren();
  G.clues.forEach(c => {
    const li = el('li');
    if (c.tag) li.append(el('span', 'clue-tag', c.tag));
    li.append(c.text); ol.append(li);
  });
}

function showQuestion() {
  const c = CASES[G.ci], q = c.questions[G.qi], N = c.questions.length;
  Q = { q, hinted: false, wrong: 0, done: false, placed: [] };
  const box = $('qbox'); box.replaceChildren();
  const head = el('div', 'qhead'); head.append(el('span', '', `謎 ${G.qi + 1} / ${N}`), el('span', 'qtype', QTYPE[q.type]));
  box.append(head, el('div', 'qtext', q.q));
  if (q.type === 'draw') { const cv = el('canvas', 'pic'); drawPic(cv, q.pic); box.append(cv); }
  if (q.big) box.append(el('div', 'qbig', q.big));
  if (q.type === 'assemble') buildAssemble(box, q); else buildChoices(box, q);
  $('hint').disabled = false; $('hint').textContent = 'ヒント';
  updateHintLabel();
}
function updateHintLabel() { $('hint').textContent = Q && Q.hinted ? 'ヒント済' : `ヒント −${HINT_COST}`; $('hint').title = `使うと得点が${HINT_COST}点へる`; }

function buildChoices(box, q) {
  const wrap = el('div', 'choices');
  for (const ch of shuffle(q.choices)) {
    const b = el('button', ch.length === 1 ? 'kan' : '', ch);
    b.dataset.ans = ch;
    b.addEventListener('click', () => {
      if (Q.done || b.classList.contains('wrong')) return;
      if (ch === q.ans) { b.classList.add('right'); correct(); }
      else { b.classList.add('wrong'); b.disabled = true; Q.wrong++; G.mistakes++; }
    });
    wrap.append(b);
  }
  box.append(wrap);
}

// ----- 部品を並べる（ドラッグ、またはタップ） -----
function buildAssemble(box, q) {
  const slotsBox = el('div', 'slots'), tray = el('div', 'tray');
  const parts = shuffle(q.parts.map((ch, id) => ({ ch, id })));
  Q.placed = q.slots.map(() => null);
  const slotEls = q.slots.map((s, i) => {
    const e = el('div', 'slot'); e.dataset.i = i; return e;
  });
  q.slots.forEach((s, i) => {
    if (i > 0) slotsBox.append(el('span', '', '＋'));
    slotsBox.append(slotEls[i]);
  });
  slotsBox.append(el('span', '', '＝'), el('div', 'slot', '？'));
  const chipEls = new Map();

  const render = () => {
    q.slots.forEach((s, i) => {
      const e = slotEls[i], p = Q.placed[i];
      e.className = 'slot' + (p ? ' filled' : '');
      e.replaceChildren(p ? p.ch : '');
      if (s.label) e.append(el('small', '', s.label));
    });
    for (const [id, e] of chipEls) e.classList.toggle('used', Q.placed.some(p => p && p.id === id));
  };
  const place = (part, i) => {
    const old = Q.placed[i]; Q.placed[i] = part;
    if (old) {/* 入れかえ：元の部品は自動でトレイにもどる */}
    render(); check();
  };
  const firstEmpty = () => Q.placed.findIndex(p => !p);
  const check = () => {
    if (Q.done || Q.placed.some(p => !p)) return;
    const got = Q.placed.map(p => p.ch), want = q.slots.map(s => s.ans);
    const ok = q.anyOrder ? got.slice().sort().join() === want.slice().sort().join() : got.every((ch, i) => ch === want[i]);
    if (ok) { slotEls.forEach(e => e.classList.add('good')); slotsBox.lastChild.textContent = q.target; correct(); return; }
    Q.wrong++; G.mistakes++;
    slotEls.forEach(e => e.classList.add('bad'));
    setTimeout(() => { Q.placed = q.slots.map(() => null); render(); }, 600);
  };

  for (const part of parts) {
    const b = el('button', 'chip', part.ch);
    chipEls.set(part.id, b);
    b.addEventListener('pointerdown', e => startDrag(e, b, part));
    tray.append(b);
  }
  slotEls.forEach((e, i) => e.addEventListener('click', () => { if (!Q.done && Q.placed[i]) { Q.placed[i] = null; render(); } }));

  function startDrag(e, chip, part) {
    if (Q.done || e.button > 0 || chip.classList.contains('used')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const move = ev => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { ghost = el('div', 'chip ghost', part.ch); document.body.append(ghost); }
      if (ghost) {
        ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
        const t = slotUnder(ev.clientX, ev.clientY);
        slotEls.forEach(s => s.classList.toggle('over', s === t));
      }
    };
    const up = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      slotEls.forEach(s => s.classList.remove('over'));
      if (ghost) {
        ghost.remove();
        const t = slotUnder(ev.clientX, ev.clientY);
        if (t) place(part, +t.dataset.i);
      } else {  // タップ：空いているところへ入れる
        const i = firstEmpty(); if (i >= 0) place(part, i);
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  function slotUnder(x, y) {
    return slotEls.find(s => { const r = s.getBoundingClientRect(); return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8; });
  }
  box.append(slotsBox, tray);
  render();
}

// ----- ヒント -----
function useHint() {
  if (screen !== 'play' || !Q || Q.done || Q.hinted || talking) return;
  Q.hinted = true; G.hints++;
  const q = Q.q, box = $('qbox');
  box.append(el('div', 'hintbox', '💡 ' + q.hint));
  if (q.type === 'assemble') {  // 使わない部品をうすくする
    const need = q.slots.map(s => s.ans);
    box.querySelectorAll('.chip').forEach(c => { const i = need.indexOf(c.textContent); if (i >= 0) need.splice(i, 1); else c.classList.add('dim'); });
  } else {  // まちがいの選択肢を2つ消す
    const wrongs = [...box.querySelectorAll('.choices button')].filter(b => b.dataset.ans !== q.ans && !b.classList.contains('wrong'));
    shuffle(wrongs).slice(0, 2).forEach(b => b.classList.add('gone'));
  }
  updateHintLabel();
}

// ----- せいかい -----
function correct() {
  Q.done = true;
  const q = Q.q, c = CASES[G.ci];
  const pts = Math.max(0, 100 - (Q.hinted ? HINT_COST : 0) - Q.wrong * WRONG_COST);
  G.score += pts;
  for (const l of q.learn) save.dex[l.ch] = true;
  persist();

  // 手がかりをふやして、容疑者をへらす
  const newOut = q.clue.out.filter(ch => !G.out.has(ch));
  for (const ch of q.clue.out) { G.out.add(ch); G.reason[ch] = q.clue.text; }
  G.clues.push({ text: q.clue.text });
  renderSuspects(newOut); renderClues();

  const fb = el('div', 'fb');
  fb.append(el('div', 'fb-h', `せいかい！ +${pts}点`));
  for (const l of q.learn) fb.append(learnBlock(l));
  const nc = el('div', 'newclue'); nc.append('🔍 手がかり：' + q.clue.text);
  if (newOut.length) nc.append(el('br'), `→ 「${newOut.join('」「')}」は犯人ではない！`);
  fb.append(nc);
  const last = G.qi + 1 >= c.questions.length;
  const nb = el('button', 'main', last ? '推理タイムへ ▶' : 'つぎの謎へ ▶');
  nb.id = 'next';
  nb.addEventListener('click', () => {
    G.qi++;
    if (last) { toPick(); return; }
    if (c.midAt === G.qi) { talk(c.mid, showQuestion); return; }
    showQuestion();
  });
  fb.append(nb);
  $('qbox').append(fb);
  $('hint').disabled = true;
  fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- 推理 ----------
let picked = null;
function toPick() {
  const c = CASES[G.ci];
  show('pick'); picked = null;
  $('pick-msg').textContent = ''; $('pick-go').disabled = true;
  const box = $('pick-suspects'); box.replaceChildren();
  for (const ch of c.suspects) {
    const s = susChip(ch);
    s.setAttribute('role', 'button'); s.tabIndex = 0;
    const choose = () => {
      picked = ch;
      box.querySelectorAll('.sus').forEach(x => x.classList.remove('sel')); s.classList.add('sel');
      $('pick-go').disabled = false; $('pick-msg').textContent = '';
    };
    s.addEventListener('click', choose);
    s.addEventListener('keydown', e => { if (e.key === 'Enter') choose(); });
    box.append(s);
  }
  const ol = $('pick-clues'); ol.replaceChildren();
  for (const k of G.clues) { const li = el('li'); if (k.tag) li.append(el('span', 'clue-tag', k.tag)); li.append(k.text); ol.append(li); }
}
$('pick-go').addEventListener('click', () => {
  const c = CASES[G.ci];
  if (!picked) return;
  if (picked === c.culprit) { $('pick-go').disabled = true; talk(c.solve, finishCase); return; }
  G.mistakes++;
  const why = G.reason[picked];
  $('pick-msg').textContent = `「${picked}」ではなさそう。` + (why ? `手がかり「${why}」と合わないよ。` : 'もう一度、手がかりを見なおそう。');
});

function finishCase() {
  const c = CASES[G.ci], id = c.id;
  const stars = starsOf(G.hints), prev = save.cases[id] || {};
  save.cases[id] = { cleared: true, stars: Math.max(stars, prev.stars || 0), score: Math.max(G.score, prev.score || 0) };
  persist();
  if (G.ci === CASES.length - 1) { showEnding(); return; }
  show('result');
  $('res-title').textContent = `事件${G.ci + 1}「${c.title}」解決！`;
  $('res-stars').replaceChildren(...[0, 1, 2].map(i => el('span', i < stars ? '' : 'off', '★')));
  $('res-detail').textContent = `点数 ${G.score}　ヒント ${G.hints}回　まちがい ${G.mistakes}回` + (stars < 3 ? '　（ヒントを使わないと★3つ）' : '');
}
$('res-next').addEventListener('click', () => startCase(G.ci + 1));
$('res-retry').addEventListener('click', () => startCase(G.ci));
$('res-select').addEventListener('click', showSelect);

function showEnding() {
  show('ending');
  $('end-title').textContent = ENDING.title; $('end-text').textContent = ENDING.text;
  const total = CASES.reduce((s, c) => s + (save.cases[c.id]?.stars || 0), 0);
  $('end-stars').textContent = `★ ${total} / ${CASES.length * 3}`;
}
$('end-dex').addEventListener('click', showDex);
$('end-select').addEventListener('click', showSelect);

// ---------- 事件セレクト ----------
function showSelect() {
  show('select');
  $('bar-title').textContent = '事件をえらぶ';
  const grid = $('case-grid'); grid.replaceChildren();
  CASES.forEach((c, i) => {
    const b = el('button', 'case'); b.disabled = !unlocked(i);
    b.append(el('div', 'n', `事件${i + 1}`), el('div', 'stolen', unlocked(i) ? c.stolen : '？'), el('div', 't', unlocked(i) ? c.title : 'ロック中'),
      el('div', 's', save.cases[c.id]?.cleared ? starText(save.cases[c.id].stars) : (unlocked(i) ? 'みかいけつ' : '')));
    b.addEventListener('click', () => startCase(i));
    grid.append(b);
  });
}

// ---------- 図鑑 ----------
let dexFrom = 'title';
function showDex() {
  dexFrom = screen === 'dex' ? dexFrom : screen;
  show('dex'); $('bar-title').textContent = '漢字図鑑';
  const got = ALL_LEARN.filter(l => save.dex[l.ch]).length;
  $('dex-count').textContent = `${got} / ${ALL_LEARN.length}`;
  const grid = $('dex-grid'); grid.replaceChildren(); $('dex-detail').replaceChildren();
  for (const l of ALL_LEARN) {
    const known = !!save.dex[l.ch];
    const b = el('button', 'dcell' + (known ? '' : ' unknown'), known ? l.ch : '？');
    if (known) {
      const bar = el('i'); bar.style.background = KINDS[l.kind] || '#888'; b.append(bar);
      b.addEventListener('click', () => {
        grid.querySelectorAll('.dcell').forEach(x => x.classList.remove('sel')); b.classList.add('sel');
        $('dex-detail').replaceChildren(learnBlock(l));
      });
    }
    grid.append(b);
  }
  const hint = el('p', '', 'タップすると成り立ちが読めるよ。'); hint.style.cssText = 'font-size:12px;color:#6b6f78;margin:10px 0 0';
  $('dex-detail').append(hint);
}
$('to-dex').addEventListener('click', showDex);
$('title-dex').addEventListener('click', showDex);
$('dex-close').addEventListener('click', () => { if (dexFrom === 'play' || dexFrom === 'pick') showSelect(); else if (dexFrom === 'select') showSelect(); else showTitle(); });

// ---------- ヘッダーのボタン ----------
$('hint').addEventListener('click', useHint);
$('reset').addEventListener('click', async () => { if (screen === 'play' && await ask('この事件を、さいしょからやり直しますか？', 'やり直す')) startCase(G.ci); });
$('to-select').addEventListener('click', async () => {
  if (screen === 'play' && !await ask('今の事件を中断して、事件えらびにもどりますか？（途中の進行はリセットされます）', 'もどる')) return;
  showSelect();
});

// ---------- タイトル ----------
function showTitle() {
  show('title'); $('bar-title').textContent = '漢字なりたち探偵';
  const any = CASES.some((_, i) => cleared(i));
  $('start').hidden = any; $('continue').hidden = !any;
  $('title-select').hidden = !any; $('title-dex').hidden = !any; $('wipe').hidden = !any;
  if (any) $('continue').textContent = cleared(CASES.length - 1) ? 'もういちど さいごの事件へ' : `つづきから（事件${firstOpen() + 1}）`;
}
$('start').addEventListener('click', () => startCase(0));
$('continue').addEventListener('click', () => startCase(cleared(CASES.length - 1) ? CASES.length - 1 : firstOpen()));
$('title-select').addEventListener('click', showSelect);
$('wipe').addEventListener('click', async () => {
  if (!await ask('進行状況・図鑑・星をすべて消します。よろしいですか？', '消す')) return;
  save = { cases: {}, dex: {} }; persist(); showTitle();
});

showTitle();
