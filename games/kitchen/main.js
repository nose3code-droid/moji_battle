// 漢字キッチン：漢字を作って売る料理・経営ゲーム。ルールは logic.js、データは recipes.js・story.js
// 画面は DOM（カード・お客さん）と Canvas 2D（鍋の湯気・完成の光）。保存は localStorage
// （three / opentype / フォントを CDN から読めないときは、ふつうの文字で遊べる）
import { FONT_URL } from '../../config.js';
import { PARTS, RANKS, RECIPES, CUSTOMERS } from './recipes.js';
import { INTRO, RANKUP, ENDING } from './story.js';
import {
  MAX_POT, TRAY_MAX, BURN_COST, RECIPE_BY_CH, INTERMEDIATE, findRecipe, recipeRank, shelfChars, priceOf, tipOf, patienceOf,
  makeRng, pickRecipe, pickCustomer, newSave, bookCount,
} from './logic.js';

const SAVE_KEY = 'moji_kitchen.save';
const SPEED = new URLSearchParams(location.search).has('fast') ? 0.1 : 1; // ?fast は自動テスト用（演出を短くする）
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const wait = ms => new Promise(r => setTimeout(r, ms * SPEED));

// ---------- 保存 ----------
let save = newSave();
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (d && typeof d === 'object') {
    save = { ...newSave(), ...d, book: d.book || {}, met: d.met || {}, tray: Array.isArray(d.tray) ? d.tray.filter(c => RECIPE_BY_CH.has(c)) : [] };
    save.rank = Math.min(RANKS.length, Math.max(1, save.rank | 0));
  }
} catch (e) { /* 保存データが無い・壊れていてもはじめから遊べる */ }
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できなくても続行 */ } }

// ---------- 文字の輪郭（Path2D）。完成の光の演出に使う ----------
let font = null, glyphPolygons = null;
const pathCache = new Map();
function glyphPath(ch) {
  if (!font) return null;
  if (pathCache.has(ch)) return pathCache.get(ch);
  let res = null;
  try {
    if (font.charToGlyph(ch).index > 0) {
      const polys = glyphPolygons(font, ch, 1);
      if (polys.length) {
        const path = new Path2D();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        const add = pts => { pts.forEach((p, i) => (i ? path.lineTo(p.x, -p.y) : path.moveTo(p.x, -p.y))); path.closePath(); };
        for (const { outer, holes } of polys) {
          add(outer);
          for (const q of outer) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, -q.y); y1 = Math.max(y1, -q.y); }
          for (const h of holes) add(h);
        }
        res = { path, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
      }
    }
  } catch (e) { res = null; }
  pathCache.set(ch, res);
  return res;
}
function drawGlyph(ctx, ch, x, y, size) {
  const gp = glyphPath(ch);
  if (gp) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(size, size); ctx.translate(-gp.cx, -gp.cy);
    ctx.fill(gp.path, 'evenodd');
    ctx.restore();
  } else {
    ctx.font = `bold ${size}px "MojiKitchen","Noto Sans JP","Hiragino Sans","Yu Gothic","WenQuanYi Zen Hei",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + size * 0.04);
  }
}
async function loadFont() {
  try {
    const [g, ot] = await Promise.all([import('../../glyph.js'), import('opentype')]);
    const buf = await (await fetch(FONT_URL)).arrayBuffer();
    glyphPolygons = g.glyphPolygons;
    font = ot.parse(buf);
    try {
      const face = new FontFace('MojiKitchen', buf.slice(0));
      document.fonts.add(await face.load());
    } catch (e) { /* DOM の文字は代わりのフォントで出る */ }
    pathCache.clear();
  } catch (e) {
    font = null; // ふつうの文字描画で遊べる
  }
}

// ---------- ゲーム状態 ----------
const rng = makeRng((Date.now() & 0xffffff) + 1);
let pot = [];                // 鍋に入っている字
let custs = [];              // 座っているお客さん { id, c, r, left, max, el }
let nextId = 1, spawnT = 1;
let selDish = -1;            // 選んでいるお皿
let busy = false;            // 調理中
let newChars = new Set();    // 棚に増えたばかりの字（ぴかぴか）
const capOf = () => RANKS[save.rank - 1].cap;

// ---------- 小さな部品 ----------
let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms * (SPEED < 1 ? 0.5 : 1));
}
function floatText(text, el) {
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'float'; f.textContent = text;
  f.style.left = `${r.left + r.width / 2 - 30}px`; f.style.top = `${r.top}px`; f.style.fontSize = '20px';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1200);
}
const hueOf = ch => {
  if (PARTS[ch]) return PARTS[ch].hue;
  const r = RECIPE_BY_CH.get(ch);
  return r ? hueOf(r.parts[0]) : 30;
};
const cardHtml = (ch, cls = 'card-part') => `<div class="${cls} glyph${PARTS[ch] ? '' : ' made'}" style="--h:${hueOf(ch)}" data-ch="${esc(ch)}">${esc(ch)}</div>`;
const isOverlayOpen = () => [...document.querySelectorAll('.overlay')].some(o => !o.hidden);

// ---------- ダイアログ（会話）と、閉じるまで待つカード ----------
const speakerOf = key => {
  const c = CUSTOMERS.find(x => x.ch === key);
  return c ? { name: c.name, color: c.color, av: c.ch } : { name: '', color: '#6b6f78', av: '…' };
};
async function say(lines) {
  const ov = $('dialog');
  ov.hidden = false;
  for (const [who, text] of lines) {
    const s = speakerOf(who);
    $('say-av').textContent = s.av; $('say-av').style.background = s.color; $('say-av').className = 'av glyph';
    $('say-who').textContent = s.name; $('say-text').textContent = text;
    await new Promise(res => {
      const next = () => { $('say-next').removeEventListener('click', next); ov.removeEventListener('click', next); res(); };
      $('say-next').addEventListener('click', next);
      ov.addEventListener('click', next);
    });
  }
  ov.hidden = true;
}
function modal(id, okId) {
  $(id).hidden = false;
  return new Promise(res => {
    const ok = () => { $(okId).removeEventListener('click', ok); $(id).hidden = true; res(); };
    $(okId).addEventListener('click', ok);
  });
}

// ---------- 描画：上の帯・棚・鍋・お皿 ----------
function renderTop() {
  const next = RANKS[save.rank];
  $('rank-name').textContent = `${RANKS[save.rank - 1].name}（ランク${save.rank}/${RANKS.length}）`;
  $('money-n').textContent = save.money;
  $('zukan-n').textContent = `${bookCount(save.book)}/${RECIPES.length}`;
  const b = $('btn-expand');
  if (next) {
    b.textContent = `🏠 ${next.name}へ ¥${next.cost}`;
    b.disabled = false;
    b.classList.toggle('ready', save.money >= next.cost);
  } else {
    b.textContent = '🏠 町いちばんの人気店！';
    b.disabled = true; b.classList.remove('ready');
  }
  $('custs').style.gridTemplateColumns = `repeat(${capOf()}, 1fr)`;
  renderSlots();
}
function renderShelf() {
  const sh = $('shelf');
  sh.innerHTML = shelfChars(save.rank, save.book).map(ch => cardHtml(ch).replace('class="', `class="${newChars.has(ch) ? 'new ' : ''}`)).join('');
  for (const el of sh.children) attachPress(el, { kind: 'part', ch: el.dataset.ch });
}
function renderPot() {
  const s = $('slots');
  let h = '';
  for (let i = 0; i < MAX_POT; i++) h += pot[i] ? `<div class="chip glyph" data-i="${i}">${esc(pot[i])}</div>` : '<div class="empty"></div>';
  s.innerHTML = h;
  s.querySelectorAll('.chip').forEach(el => attachPress(el, { kind: 'chip', i: +el.dataset.i }));
  $('btn-cook').disabled = busy || pot.length < 2;
  $('btn-clear').disabled = busy || pot.length === 0;
}
function renderTray() {
  const t = $('tray');
  t.innerHTML = save.tray.map((ch, i) => `<div class="dish glyph${i === selDish ? ' sel' : ''}" data-i="${i}">${esc(ch)}</div>`).join('');
  t.querySelectorAll('.dish').forEach(el => attachPress(el, { kind: 'dish', i: +el.dataset.i }));
}

// ---------- 入力：タップとドラッグ ----------
function attachPress(el, info) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, dragging = false;
    const hover = ev => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      $('pot').classList.toggle('drop', !!(t && t.closest('#pot-area')) && info.kind !== 'dish');
      document.querySelectorAll('.cust.accept').forEach(c => c.classList.remove('accept'));
      if (info.kind === 'dish') t?.closest('.cust')?.classList.add('accept');
    };
    const move = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
        dragging = true;
        ghost = el.cloneNode(true); ghost.classList.add('ghost');
        document.body.appendChild(ghost);
      }
      if (dragging) { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; hover(ev); }
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', end);
      ghost?.remove(); $('pot').classList.remove('drop');
      document.querySelectorAll('.cust.accept').forEach(c => c.classList.remove('accept'));
    };
    const up = ev => {
      end();
      if (!dragging) { tap(info); return; }
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      if (info.kind === 'part') { if (t?.closest('#pot-area')) addToPot(info.ch); }
      else if (info.kind === 'chip') { if (!t?.closest('#pot-area')) removeFromPot(info.i); }
      else if (info.kind === 'dish') { const c = t?.closest('.cust'); if (c) deliver(+c.dataset.id, info.i); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', end);
  });
}
function tap(info) {
  if (info.kind === 'part') addToPot(info.ch);
  else if (info.kind === 'chip') removeFromPot(info.i);
  else if (info.kind === 'dish') { selDish = selDish === info.i ? -1 : info.i; renderTray(); }
}

// ---------- 鍋 ----------
function addToPot(ch) {
  if (busy) return;
  if (pot.length >= MAX_POT) { toast(`鍋には${MAX_POT}個までだよ`); return; }
  pot.push(ch); renderPot();
}
function removeFromPot(i) { if (busy) return; pot.splice(i, 1); renderPot(); }

async function cook() {
  if (busy || pot.length < 2) return;
  busy = true; renderPot();
  $('pot').classList.add('boil'); fx.boil = true;
  await wait(1100);
  $('pot').classList.remove('boil'); fx.boil = false;
  const used = pot.slice();
  const r = findRecipe(used);
  pot = []; renderPot();
  if (r) await succeed(r); else burn(used);
  busy = false; renderPot();
}
function burn(used) {
  const cost = Math.min(save.money, BURN_COST * used.length);
  save.money -= cost; save.burnt++; writeSave();
  fx.smoke();
  toast(`こげた！ 材料代 -¥${cost}（レシピ帳を見てみよう）`);
  renderTop();
}
async function succeed(r) {
  const first = !save.book[r.ch];
  save.book[r.ch] = (save.book[r.ch] || 0) + 1;
  save.tray.push(r.ch);
  if (save.tray.length > TRAY_MAX) save.tray.shift();
  selDish = -1; writeSave();
  fx.reveal(r.ch);
  await wait(1500);
  renderTray(); renderTop();
  if (first) {
    if (INTERMEDIATE.has(r.ch)) newChars = new Set([r.ch]);
    renderShelf();
    await showFound(r);
    newChars = new Set();
    await checkEnding();
  } else toast(`「${r.ch}」ができた！`);
}
function showFound(r) {
  $('found-ch').textContent = r.ch;
  $('found-meta').innerHTML = `${esc(r.yomi)} ・ <span class="tag ${esc(r.kind)}">${esc(r.kind)}</span> ・ ${r.parts.map(esc).join(' + ')}`;
  $('found-desc').textContent = r.desc;
  return modal('found', 'found-ok');
}
async function checkEnding() {
  if (save.endingSeen || bookCount(save.book) < RECIPES.length) return;
  save.endingSeen = true; writeSave();
  await say(ENDING);
  $('ending-text').textContent = `${RECIPES.length}種類の漢字をぜんぶ作りました！ 売上は合計 ¥${save.total}、お客さんに渡したお皿は ${save.served} 皿。`;
  $('ending').hidden = false;
}

// ---------- お客さん ----------
function renderSlots() {
  const box = $('custs');
  while (box.children.length < 3) { const d = document.createElement('div'); d.className = 'slot'; box.appendChild(d); }
  [...box.children].forEach((s, i) => { s.hidden = i >= capOf(); });
}
function spawn() {
  const seated = custs.map(c => c.c.ch);
  const c = pickCustomer(rng, save.rank, save.met, seated);
  const r = pickRecipe(rng, save.rank, save.book, custs.map(x => x.r.ch));
  if (!c || !r) return;
  const used = new Set(custs.map(x => x.slot));
  let slot = 0; while (used.has(slot)) slot++;
  const max = patienceOf(r, save.rank);
  const cu = { id: nextId++, c, r, left: max, max, slot };
  const el = document.createElement('div');
  el.className = 'cust'; el.dataset.id = cu.id;
  el.innerHTML = `<div class="bubble">${esc(r.order)}<small>（部品 ${r.parts.length}つ）</small></div>
    <div class="face glyph" style="background:${c.color}">${esc(c.ch)}</div><div class="name">${esc(c.name)}</div><div class="bar"><i></i></div>`;
  cu.el = el; cu.bar = el.querySelector('.bar i');
  $('custs').children[slot].appendChild(el);
  custs.push(cu);
}
function removeCust(cu, cls, ms) {
  custs = custs.filter(c => c !== cu);
  cu.el.classList.add(cls);
  setTimeout(() => cu.el.remove(), ms * SPEED + 30);
}
async function deliver(id, dishIdx) {
  const cu = custs.find(c => c.id === id);
  const ch = save.tray[dishIdx];
  if (!cu || ch === undefined) return;
  selDish = -1;
  if (ch !== cu.r.ch) {
    cu.el.classList.remove('wrong'); void cu.el.offsetWidth; cu.el.classList.add('wrong');
    toast(`${cu.c.name}「うーん、ちょっとちがうな…」`);
    renderTray(); return;
  }
  const fav = ch === cu.c.fav;
  const price = priceOf(cu.r), tip = tipOf(cu.r, cu.left / cu.max, fav);
  save.money += price + tip; save.total += price + tip; save.served++;
  save.tray.splice(dishIdx, 1);
  const first = !save.met[cu.c.ch];
  save.met[cu.c.ch] = true; writeSave();
  floatText(`+¥${price + tip}${tip ? `（チップ${tip}）` : ''}`, cu.el.querySelector('.face'));
  cu.el.classList.add('happy');
  removeCust(cu, 'leaving', 600);
  $('money').classList.remove('bump'); void $('money').offsetWidth; $('money').classList.add('bump');
  renderTray(); renderTop();
  if (first) await say(cu.c.first.map(t => [cu.c.ch, t]));
  else toast(`${cu.c.name}「${fav ? cu.c.favLine : cu.c.thanks[Math.floor(rng() * cu.c.thanks.length)]}」`);
}
$('custs').addEventListener('click', e => {
  const el = e.target.closest('.cust');
  if (!el) return;
  const cu = custs.find(c => c.id === +el.dataset.id);
  if (!cu) return;
  if (selDish >= 0) deliver(cu.id, selDish);
  else toast(`${cu.c.name}：${cu.c.likeHint}`, 3600);
});

// ---------- お店を広げる ----------
async function expand() {
  const next = RANKS[save.rank];
  if (!next) return;
  if (save.money < next.cost) { toast(`あと ¥${next.cost - save.money} で「${next.name}」に広げられるよ`); return; }
  save.money -= next.cost; save.rank++;
  const before = new Set(shelfChars(save.rank - 1, save.book));
  newChars = new Set(shelfChars(save.rank, save.book).filter(c => !before.has(c)));
  writeSave(); renderTop(); renderShelf();
  await say(RANKUP[save.rank]);
  toast(`新しい部品：${[...newChars].join(' ')}　レシピ帳に新しいページ！`, 4000);
  setTimeout(() => { newChars = new Set(); }, 4000);
}

// ---------- レシピ帳 ----------
let recipeTab = 1;
function renderRecipeBook() {
  const tabs = $('recipe-tabs');
  tabs.innerHTML = RANKS.map((r, i) => {
    const n = i + 1, list = RECIPES.filter(x => recipeRank(x) === n);
    const locked = n > save.rank;
    return `<button data-t="${n}" class="${n === recipeTab ? 'on' : ''}" ${locked ? 'disabled' : ''}>${locked ? '🔒' : ''}${esc(r.name)} ${locked ? '' : `${list.filter(x => save.book[x.ch]).length}/${list.length}`}</button>`;
  }).join('');
  tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { recipeTab = +b.dataset.t; renderRecipeBook(); }));
  $('recipe-list').innerHTML = RECIPES.filter(r => recipeRank(r) === recipeTab).map(r => {
    if (save.book[r.ch]) {
      return `<div class="rec"><div class="c glyph">${esc(r.ch)}</div><div><b>${r.parts.map(esc).join(' ＋ ')} ＝ ${esc(r.ch)}</b>
        <span class="tag ${esc(r.kind)}">${esc(r.kind)}</span><div class="f">${esc(r.yomi)}　注文：「${esc(r.order)}」</div>${esc(r.desc)}</div></div>`;
    }
    return `<div class="rec todo"><div class="c glyph">？</div><div><b>${esc(r.parts[0])} ＋ ？${r.parts.length > 2 ? ' ＋ ？' : ''} ＝ ？</b>
      <div class="f">注文：「${esc(r.order)}」</div>まだ作ったことのない字。ヒントの字から考えてみよう。</div></div>`;
  }).join('');
}

// ---------- 図鑑 ----------
let zTab = 'kanji';
function renderZukan() {
  $('zukan-count').textContent = `${bookCount(save.book)}/${RECIPES.length}種`;
  $('tab-kanji').classList.toggle('on', zTab === 'kanji'); $('tab-guests').classList.toggle('on', zTab === 'guests');
  const grid = $('zukan-grid');
  if (zTab === 'kanji') {
    grid.innerHTML = RECIPES.map(r => save.book[r.ch] ? `<button class="z glyph" data-ch="${esc(r.ch)}">${esc(r.ch)}</button>` : '<div class="z no">？</div>').join('');
    grid.querySelectorAll('button.z').forEach(b => b.addEventListener('click', () => {
      grid.querySelectorAll('.z').forEach(x => x.classList.toggle('on', x === b));
      const r = RECIPE_BY_CH.get(b.dataset.ch);
      $('zukan-detail').innerHTML = `<b style="font-size:22px" class="glyph">${esc(r.ch)}</b> ${esc(r.yomi)} <span class="tag ${esc(r.kind)}">${esc(r.kind)}</span>
        <div>${r.parts.map(esc).join(' ＋ ')} ＝ ${esc(r.ch)}（${save.book[r.ch]}回作った）</div><div>${esc(r.desc)}</div>`;
    }));
    $('zukan-detail').innerHTML = '字をタップすると成り立ちが読めるよ。';
  } else {
    grid.innerHTML = CUSTOMERS.map(c => save.met[c.ch]
      ? `<div class="guest"><div class="face glyph" style="background:${c.color}">${esc(c.ch)}</div><div><b>${esc(c.name)}</b><br>${esc(c.likeHint)}</div></div>`
      : `<div class="guest no"><div class="face glyph" style="background:#c9bfa8">？</div><div>まだ会っていないお客さん（ランク${c.minRank}から来店）</div></div>`).join('');
    $('zukan-detail').innerHTML = 'お客さんをタップすると、その人の好みのヒントが見られるよ。';
  }
}

// ---------- 鍋の演出（Canvas 2D） ----------
const fx = {
  parts: [], boil: false, rev: null, cv: $('fx'), ctx: null, w: 0, h: 0,
  smoke() { for (let i = 0; i < 26; i++) this.puff(true); },
  puff(dark) {
    const p = $('pot').getBoundingClientRect(), a = this.cv.getBoundingClientRect();
    this.parts.push({ x: p.left - a.left + p.width / 2 + (Math.random() - .5) * 60, y: p.top - a.top + 22, vx: (Math.random() - .5) * 14, vy: -(20 + Math.random() * 25),
      r: 6 + Math.random() * 7, life: 0, max: 1.4 + Math.random() * .8, dark: !!dark });
  },
  reveal(ch) {
    const p = $('pot').getBoundingClientRect(), a = this.cv.getBoundingClientRect();
    const x = p.left - a.left + p.width / 2, y = p.top - a.top + 30;
    this.rev = { ch, t0: performance.now(), x, y };
    for (let i = 0; i < 28; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 90;
      this.parts.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30, r: 2 + Math.random() * 3, life: 0, max: .8 + Math.random() * .6, star: true });
    }
  },
  resize() {
    const a = this.cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    this.w = a.width; this.h = a.height;
    this.cv.width = Math.round(a.width * d); this.cv.height = Math.round(a.height * d);
    this.ctx = this.cv.getContext('2d'); this.ctx.setTransform(d, 0, 0, d, 0, 0);
  },
  frame(now, dt) {
    const ctx = this.ctx; if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (Math.random() < (this.boil ? 0.7 : 0.06)) this.puff(false);
    this.parts = this.parts.filter(p => (p.life += dt) < p.max);
    for (const p of this.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.star) p.vy += 120 * dt;
      const k = 1 - p.life / p.max;
      if (p.star) {
        ctx.fillStyle = `rgba(255,${200 + Math.random() * 40 | 0},60,${k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k + .5, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = p.dark ? `rgba(40,40,40,${k * .6})` : `rgba(255,255,255,${k * .75})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - k * .6), 0, 7); ctx.fill();
      }
    }
    if (this.rev) {
      const t = (now - this.rev.t0) / (1500 * SPEED);
      if (t >= 1) this.rev = null;
      else {
        const sc = t < .3 ? .2 + .8 * (t / .3) : 1, al = t > .8 ? (1 - t) / .2 : 1, rise = Math.min(1, t / .5) * 18;
        ctx.save();
        ctx.globalAlpha = al;
        const g = ctx.createRadialGradient(this.rev.x, this.rev.y - rise, 4, this.rev.x, this.rev.y - rise, 80);
        g.addColorStop(0, 'rgba(255,240,150,.9)'); g.addColorStop(1, 'rgba(255,240,150,0)');
        ctx.fillStyle = g; ctx.fillRect(this.rev.x - 90, this.rev.y - rise - 90, 180, 180);
        ctx.shadowColor = '#ffb703'; ctx.shadowBlur = 18; ctx.fillStyle = '#fff';
        drawGlyph(ctx, this.rev.ch, this.rev.x, this.rev.y - rise, 84 * sc);
        ctx.restore();
      }
    }
  },
};
let lastFrame = performance.now();
function loop(now) {
  fx.frame(now, Math.min(.1, (now - lastFrame) / 1000));
  lastFrame = now;
  requestAnimationFrame(loop);
}

// ---------- 時間の流れ ----------
const TICK = 0.1;
function tick() {
  if (document.hidden || isOverlayOpen()) return;
  for (const cu of custs.slice()) {
    cu.left -= TICK;
    const f = Math.max(0, cu.left / cu.max);
    cu.bar.style.width = `${f * 100}%`;
    cu.bar.style.background = f > .5 ? '#51cf66' : f > .25 ? '#fcc419' : '#ff6b6b';
    if (cu.left <= 0) {
      toast(`${cu.c.name}「${cu.c.leave}」`);
      removeCust(cu, 'leaving', 500);
    }
  }
  if (custs.length < capOf()) {
    spawnT -= TICK;
    if (custs.length === 0) spawnT = Math.min(spawnT, 1.5);
    if (spawnT <= 0) { spawn(); spawnT = 6 + rng() * 6; }
  }
}

// ---------- 起動・ボタン ----------
function openOverlay(id, render) { render?.(); $(id).hidden = false; }
$('btn-cook').addEventListener('click', cook);
$('btn-clear').addEventListener('click', () => { if (!busy) { pot = []; renderPot(); } });
$('btn-expand').addEventListener('click', expand);
$('btn-recipe').addEventListener('click', () => { recipeTab = Math.min(recipeTab, save.rank); openOverlay('recipe', renderRecipeBook); });
$('recipe-close').addEventListener('click', () => { $('recipe').hidden = true; });
$('btn-zukan').addEventListener('click', () => openOverlay('zukan', renderZukan));
$('zukan-close').addEventListener('click', () => { $('zukan').hidden = true; });
$('tab-kanji').addEventListener('click', () => { zTab = 'kanji'; renderZukan(); });
$('tab-guests').addEventListener('click', () => { zTab = 'guests'; renderZukan(); });
$('ending-keep').addEventListener('click', () => { $('ending').hidden = true; });
function resetAll() {
  if (!confirm('最初からやり直しますか？\nお金・お店のランク・図鑑が消えます。')) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 消せなくても続行 */ }
  location.reload();
}
$('btn-reset').addEventListener('click', resetAll);
$('ending-reset').addEventListener('click', resetAll);
$('shelf').addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('shelf').scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
window.addEventListener('resize', () => fx.resize());

async function start() {
  renderTop(); renderShelf(); renderPot(); renderTray();
  fx.resize(); requestAnimationFrame(loop);
  setInterval(tick, TICK * 1000);
  // 自動テストが見る入口と、近道（?debug のときだけ使える）
  window.__kitchen = {
    get save() { return save; }, get custs() { return custs; }, get pot() { return pot; }, get busy() { return busy; },
    debug: new URLSearchParams(location.search).has('debug'),
    cheat(o) {
      if (!this.debug) return;
      if (o.money != null) save.money = o.money;
      if (o.rank != null) save.rank = o.rank;
      writeSave(); renderTop(); renderShelf();
    },
  };
  loadFont();
  if (!save.introDone) { save.introDone = true; writeSave(); await say(INTRO); }
}
start();
