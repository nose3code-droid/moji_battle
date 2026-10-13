import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { SLOTS, SLOT_NAMES, STAT_KEYS, STAT_NAMES, ELEMENTS, CATALOG, STARTERS, buildParts, assemble, autoBuild, fitOf } from './parts.js';
import { createBattle, step, runAll } from './battle.js';
import { rewardOptions } from './rewards.js';
import { MASTER, INTRO, AFTER_NAME, MATCHES, LOSE, WIN_MID, ENDING } from './story.js';
import { drawRobo, drawRoboPreview, drawPartIcon, fitCanvas, radarSVG } from './render.js';

const params = new URLSearchParams(location.search);
const TIME = params.has('fast') ? 0.12 : 1;     // ?fast で演出を速く（動作確認用）
const SAVE_KEY = 'moji_robo.save.v1';
const PLAYER_COLOR = '#2b7de9';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

let font = null, parts = null;
const get = ch => parts.get(ch);

// ---------- 記録（localStorage） ----------
function freshSave() { return { name: '', owned: [...STARTERS], build: {}, progress: 0, sel: 0, intro: false, cleared: false, reward: null }; }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && Array.isArray(s.owned)) {
      const base = { ...freshSave(), ...s };
      base.owned = base.owned.filter(ch => parts.has(ch));
      for (const sl of SLOTS) if (!base.owned.includes(base.build[sl])) delete base.build[sl];
      return base;
    }
  } catch { /* 壊れていたら最初から */ }
  return freshSave();
}
let save = null;
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できない環境でも遊べる */ } }

// ---------- 組み立て中のロボ ----------
const BLANK = {
  ch: '', strokes: 0, element: null, aff: { head: 0, body: 0, rarm: 0, larm: 0, legs: 0 },
  raw: { hp: 0, atk: 0, def: 0, spd: 0, aim: 0, wit: 0 },
  shape: { box: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }, polys: [{ outer: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }], holes: [] }] },
};
const getOrBlank = ch => (ch && parts.get(ch)) || BLANK;
const myRobo = () => { const r = assemble(save.build, getOrBlank); r.name = save.name || 'ロボ'; return r; };
const complete = () => SLOTS.every(s => save.build[s]);
function enemyRobo(i) {
  const m = MATCHES[i];
  const r = assemble(Object.fromEntries(SLOTS.map((s, k) => [s, m.parts[k]])), get, m.boost);
  r.name = m.name;
  return r;
}

// ---------- 画面の切り替え ----------
function show(id) { for (const s of ['shop', 'battle']) $(s).hidden = s !== id; if (id) window.scrollTo(0, 0); }
const bestName = p => p.best === 'rarm' ? '腕' : SLOT_NAMES[p.best];
const elChip = el => el ? `<span class="el" style="background:${ELEMENTS[el].color}">${ELEMENTS[el].name}</span>` : '';

// ---------- 会話 ----------
function faceChar(who) {
  if (parts.has(who)) return who;
  const m = MATCHES.find(x => x.name === who);
  return m ? m.parts[0] : MASTER.ch;
}
function talk(lines) {
  return new Promise(resolve => {
    let i = 0;
    const box = $('talk');
    const next = () => {
      if (i >= lines.length) { box.hidden = true; box.removeEventListener('click', next); resolve(); return; }
      const [who, text] = lines[i++];
      $('talk-who').textContent = who;
      $('talk-text').textContent = text;
      box.hidden = false;
      drawPartIcon($('talk-face'), get(faceChar(who)), '#34415f');
    };
    box.addEventListener('click', next);
    next();
  });
}

// ---------- 組み立て画面 ----------
let selected = null;   // タップで選んだ手持ちの字
function assign(ch, slot) {
  const from = SLOTS.find(s => save.build[s] === ch);
  const old = save.build[slot];
  if (from) { if (old) save.build[from] = old; else delete save.build[from]; }
  save.build[slot] = ch;
  selected = null;
  persist(); renderShop();
}
function unassign(slot) { delete save.build[slot]; selected = null; persist(); renderShop(); }

function renderShop() {
  $('robo-name').textContent = `ロボ「${save.name}」`;
  const r = myRobo();
  $('radar').innerHTML = radarSVG(r.stats, PLAYER_COLOR, 190);
  // 枠
  const slots = $('slots');
  slots.innerHTML = '';
  for (const sl of SLOTS) {
    const ch = save.build[sl], p = ch && get(ch);
    const d = document.createElement('div');
    d.className = 'slot' + (p ? ' filled' : '') + (selected ? ' target' : '');
    d.dataset.slot = sl;
    const f = p ? fitOf(p.aff[sl]) : null;
    d.innerHTML = `<span class="lbl">${SLOT_NAMES[sl]}</span>` + (p ? '<canvas></canvas>' : '<span class="empty">＋</span>') +
      `<span class="mark">${f ? f.mark : ''}</span>` + (p ? '<button class="x" aria-label="はずす">×</button>' : '');
    slots.append(d);
    if (p) drawPartIcon(d.querySelector('canvas'), p, '#34415f');
  }
  // 手持ち
  const hand = $('hand');
  hand.innerHTML = '';
  for (const ch of save.owned) {
    const p = get(ch), used = SLOTS.find(s => save.build[s] === ch);
    const c = document.createElement('div');
    c.className = 'card' + (used ? ' used' : '') + (selected === ch ? ' sel' : '');
    c.dataset.ch = ch;
    c.innerHTML = `<canvas></canvas><small>${used ? SLOT_NAMES[used] + 'に装備' : bestName(p) + '向き'}</small><small>${p.element ? elChip(p.element) : '&nbsp;'}</small>`;
    hand.append(c);
    drawPartIcon(c.querySelector('canvas'), p, '#34415f');
  }
  renderNext();
  $('summary').textContent = complete()
    ? `HP ${r.stats.hp}／攻撃 ${r.stats.atk}／防御 ${r.stats.def}／素早さ ${r.stats.spd}／命中 ${r.stats.aim}／判断 ${r.stats.wit}` + (r.element ? `　胴の属性：${ELEMENTS[r.element].name}` : '')
    : '5つの枠（頭・胴・右腕・左腕・脚）に 部品を取りつけよう';
}

function renderNext() {
  const i = Math.min(save.sel, MATCHES.length - 1), m = MATCHES[i], e = enemyRobo(i), me = myRobo();
  const open = i <= save.progress;
  // 属性の相性のヒント（確実に説明できるものだけ）
  let hint = '';
  if (complete() && e.element) {
    const strong = SLOTS.filter(s => me.parts[s].element && ELEMENTS[me.parts[s].element].beats === e.element);
    const weak = me.element && SLOTS.filter(s => e.parts[s].element && ELEMENTS[e.parts[s].element].beats === me.element);
    if (strong.length) hint += `あなたの ${strong.map(s => `${SLOT_NAMES[s]}「${me.parts[s].ch}」`).join('・')} は あいての胴「${e.parts.body.ch}」に 強い！（${ELEMENTS[me.parts[strong[0]].element].why}）`;
    if (weak && weak.length) hint += ` 気をつけて：あいての ${weak.map(s => `「${e.parts[s].ch}」`).join('')} は あなたの胴「${me.parts.body.ch}」に 強い`;
  }
  $('next').innerHTML = `
    <div class="match-nav"><button class="sub small" id="m-prev" ${i <= 0 ? 'disabled' : ''}>◀</button>
      <h3 style="flex:1;margin:0">${esc(m.title)}　${m.boss ? '👑 ' : ''}${esc(m.name)} ${elChip(e.element)}</h3>
      <button class="sub small" id="m-next" ${i >= save.progress || i >= MATCHES.length - 1 ? 'disabled' : ''}>▶</button></div>
    <div class="opp">${SLOTS.map(s => `${SLOT_NAMES[s]}<canvas data-ch="${m.parts[SLOTS.indexOf(s)]}"></canvas>`).join('')}</div>
    <div class="note">HP ${e.stats.hp}／攻撃 ${e.stats.atk}／防御 ${e.stats.def}／素早さ ${e.stats.spd}／命中 ${e.stats.aim}／判断 ${e.stats.wit}</div>
    <div class="note">${hint}</div>
    <div class="row"><button id="fight" ${complete() && open ? '' : 'disabled'}>${i < save.progress ? 'もういちど たたかう' : 'しあいへ！'}</button></div>
    ${complete() ? '' : '<div class="note">ロボを完成させると 試合に出られます</div>'}`;
  for (const cv of $('next').querySelectorAll('canvas')) drawPartIcon(cv, get(cv.dataset.ch), '#34415f');
}

// ドラッグ＆ドロップ（タップでも取りつけられる）
function setupDrag() {
  const hand = $('hand'), ghost = $('ghost');
  let d = null, justDragged = false;
  const slotAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.slot');
  hand.addEventListener('pointerdown', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    d = { ch: card.dataset.ch, id: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType !== 'mouse', card };
  });
  addEventListener('pointermove', e => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.started) {
      const go = d.touch ? Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) : Math.hypot(dx, dy) > 6;
      if (!go) return;
      d.started = true;
      ghost.innerHTML = '<div class="card"><canvas style="width:52px;height:52px"></canvas></div>';
      drawPartIcon(ghost.querySelector('canvas'), get(d.ch), '#34415f');
      ghost.hidden = false;
    }
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    const over = slotAt(e.clientX, e.clientY);
    for (const s of document.querySelectorAll('.slot')) s.classList.toggle('over', s === over);
  });
  const end = e => {
    if (!d || e.pointerId !== d.id) return;
    const cur = d; d = null;
    ghost.hidden = true;
    for (const s of document.querySelectorAll('.slot')) s.classList.remove('over');
    if (cur.started) {
      justDragged = true; setTimeout(() => { justDragged = false; }, 50);
      if (e.type === 'pointerup') { const s = slotAt(e.clientX, e.clientY); if (s) assign(cur.ch, s.dataset.slot); }
    }
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  hand.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card || justDragged) return;
    selected = selected === card.dataset.ch ? null : card.dataset.ch;
    renderShop();
  });
  $('slots').addEventListener('click', e => {
    if (e.target.closest('.x')) { unassign(e.target.closest('.slot').dataset.slot); return; }
    const s = e.target.closest('.slot');
    if (s && selected) assign(selected, s.dataset.slot);
  });
  $('auto').addEventListener('click', () => { save.build = autoBuild(save.owned, get); selected = null; persist(); renderShop(); });
  $('clear').addEventListener('click', () => { save.build = {}; selected = null; persist(); renderShop(); });
  $('next').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'm-prev') { save.sel = Math.max(0, save.sel - 1); persist(); renderNext(); }
    else if (id === 'm-next') { save.sel = Math.min(save.progress, MATCHES.length - 1, save.sel + 1); persist(); renderNext(); }
    else if (id === 'fight' && !e.target.disabled) playMatch(Math.min(save.sel, MATCHES.length - 1));
  });
}

// ---------- 名前 ----------
function askName() {
  return new Promise(resolve => {
    const box = $('namebox'), input = $('name-input');
    input.value = save.name || '';
    box.hidden = false;
    const ok = () => {
      const v = input.value.trim().slice(0, 8);
      if (!v) { input.focus(); return; }
      save.name = v; persist(); box.hidden = true;
      $('name-ok').removeEventListener('click', ok);
      resolve();
    };
    $('name-ok').addEventListener('click', ok);
    input.onkeydown = e => { if (e.key === 'Enter') ok(); };
    input.focus();
  });
}

// ---------- バトル演出 ----------
const SPEEDS = [1, 2, 4];
let speed = 1, skipping = false, battleOn = false;
const wait = ms => skipping ? Promise.resolve() : new Promise(r => setTimeout(r, ms * TIME / speed));
const POSE0 = { lunge: 0, shake: 0, flash: 0, alpha: 1, rot: 0, armF: 0, armB: 0, legK: 0, headD: 0, bob: 0 };
function tween(o, to, ms) {
  if (skipping || ms <= 0) { Object.assign(o, to); return Promise.resolve(); }
  const from = Object.fromEntries(Object.keys(to).map(k => [k, o[k]]));
  const dur = ms * TIME / speed, t0 = performance.now();
  return new Promise(res => {
    const f = now => {
      const t = Math.min(1, (now - t0) / dur), e = t * t * (3 - 2 * t);
      for (const k in to) o[k] = from[k] + (to[k] - from[k]) * e;
      t < 1 ? requestAnimationFrame(f) : res();
    };
    requestAnimationFrame(f);
  });
}

let arena = null;   // { fx: {p, e}, b, bursts, pops, boss }
function startArena(b, color, boss) {
  arena = {
    b, bursts: [], pops: [], boss,
    fx: { p: { ...POSE0, dir: 1, color: PLAYER_COLOR, robo: b.p.robo }, e: { ...POSE0, dir: -1, color, robo: b.e.robo } },
  };
  setBars();
}
function setBars() {
  for (const s of ['p', 'e']) {
    const f = arena.b[s];
    $(`${s}-name`).textContent = f.name;
    $(`${s}-hp`).style.width = Math.max(0, f.hp / f.maxHp * 100) + '%';
    $(`${s}-hpnum`).textContent = `${f.hp} / ${f.maxHp}`;
    $(`${s}-gauge`).style.width = Math.min(100, f.gauge / 3 * 100) + '%';
  }
}
function logLine(t) {
  const log = $('log');
  const d = document.createElement('div'); d.textContent = t; log.append(d);
  while (log.children.length > 4) log.firstChild.remove();
}
function arenaGeom() {
  const cv = $('arena'), w = cv.clientWidth, h = cv.clientHeight;
  const sc = Math.min(h * .66 / 215, w * .0021);
  return { w, h, sc, base: h * .86, px: w * .24, ex: w * .76 };
}
const pop = (x, y, text, color, big) => { if (!skipping) arena.pops.push({ x, y, text, color, big, t: 0 }); };
const burst = (x, y, color, big) => { if (!skipping) arena.bursts.push({ x, y, color, big, t: 0 }); };

async function playEvent(ev) {
  const g = arenaGeom(), me = arena.fx[ev.who], oppSide = ev.who === 'p' ? 'e' : 'p';
  if (ev.text) logLine(ev.text);
  const tgt = arena.fx[ev.target || oppSide];
  const dir = me.dir;
  if (ev.type === 'act') {
    const mk = arena.b[ev.who];
    const reach = Math.abs(g.ex - g.px) - 150 * g.sc * (arena.boss ? 1.2 : 1);
    if (ev.tech === 'punchR' || ev.tech === 'punchL') {
      const front = ev.who === 'p' ? ev.tech === 'punchR' : ev.tech === 'punchL';
      const key = front ? 'armF' : 'armB';
      await tween(me, { [key]: .9, lunge: -dir * 14 }, 160);
      await Promise.all([tween(me, { [key]: -1.75, lunge: dir * reach * .8 }, 130)]);
    } else if (ev.tech === 'kick') {
      await tween(me, { legK: .7, lunge: -dir * 10 }, 150);
      await tween(me, { legK: -1.35, lunge: dir * reach * .75 }, 140);
    } else if (ev.tech === 'head') {
      await tween(me, { headD: -.5, lunge: -dir * 20 }, 160);
      await tween(me, { headD: 1.3, lunge: dir * reach * .9 }, 130);
    } else {
      mk.glow = true;
      await tween(me, { armF: -2.5, armB: -2.5, lunge: -dir * 12, flash: 0 }, 300);
      burst(g[ev.who === 'p' ? 'px' : 'ex'], g.base - 100 * g.sc, '#ffd23f', true);
      await tween(me, { lunge: dir * reach }, 120);
    }
  } else if (ev.type === 'hit') {
    const el = arena.b[ev.who].robo.parts;
    tgt.flash = 1; tgt.shake = ev.crit ? 26 : 14;
    const tx = g[ev.target === 'p' ? 'px' : 'ex'], big = ev.crit || ev.eff > 1;
    burst(tx - tgt.dir * 20, g.base - 100 * g.sc, ev.eff > 1 ? '#ff7a2f' : '#ffe27a', big);
    pop(tx, g.base - 190 * g.sc, `-${ev.dmg}`, ev.crit ? '#ff3b3b' : '#fff', ev.crit);
    arena.b[ev.target].hp = ev.hp;
    tgt.lunge = -tgt.dir * 0; await tween(tgt, { lunge: -tgt.dir * 16 }, 70);
    setBars();
    await wait(160);
    tgt.flash = 0; tgt.shake = 0;
    await Promise.all([tween(tgt, { lunge: 0 }, 160), returnPose(me)]);
  } else if (ev.type === 'miss') {
    const tx = g[oppSide === 'p' ? 'px' : 'ex'];
    pop(tx, g.base - 190 * g.sc, 'ミス！', '#9fe0ff', false);
    await tween(tgt, { lunge: -tgt.dir * 50, rot: .1 }, 110);
    await Promise.all([returnPose(me), tween(tgt, { lunge: 0, rot: 0 }, 220)]);
  } else if (ev.type === 'recoil') {
    me.flash = 1; me.shake = 8; setBars();
    await wait(140); me.flash = 0; me.shake = 0;
  } else if (ev.type === 'ko') {
    const t = arena.fx[ev.who];
    t.flash = 0; t.shake = 0;
    await Promise.all([tween(t, { rot: -.7, alpha: .4, lunge: -t.dir * 10 }, 700)]);
    await wait(250);
  }
  setBars();
}
function returnPose(f) { return tween(f, { lunge: 0, armF: 0, armB: 0, legK: 0, headD: 0, rot: f.rot }, 180); }

function drawArena(t) {
  const cv = $('arena');
  const { ctx, w, h } = fitCanvas(cv);
  const g = arenaGeom();
  // 背景の飾り（遠くのビル）
  ctx.fillStyle = 'rgba(120,140,180,.35)';
  for (let i = 0; i < 8; i++) { const bw = w / 8; const bh = 40 + ((i * 37) % 70); ctx.fillRect(i * bw + 4, h * .6 - bh, bw - 8, bh); }
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
  for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, h * .6 + i * (h * .4 / 6)); ctx.lineTo(w, h * .6 + i * (h * .4 / 6)); ctx.stroke(); }
  if (!arena) return;
  for (const s of ['p', 'e']) {
    const f = arena.fx[s];
    const sc = g.sc * (s === 'e' && arena.boss ? 1.28 : 1);
    drawRobo(ctx, f.robo, { ...f, x: s === 'p' ? g.px : g.ex, y: g.base, scale: sc, bob: Math.sin(t / 420 + (s === 'e' ? 2 : 0)) * 2 * (f.alpha === 1 ? 1 : 0) });
  }
  // 火花
  arena.bursts = arena.bursts.filter(b => (b.t += .05) < 1);
  for (const b of arena.bursts) {
    ctx.save(); ctx.globalAlpha = 1 - b.t; ctx.strokeStyle = b.color; ctx.fillStyle = b.color; ctx.lineWidth = 4;
    const n = b.big ? 12 : 7, r0 = (b.big ? 30 : 16) * (.4 + b.t);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0); ctx.lineTo(b.x + Math.cos(a) * (r0 + 18 + b.t * 30), b.y + Math.sin(a) * (r0 + 18 + b.t * 30)); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(b.x, b.y, r0 * .7, 0, Math.PI * 2); ctx.globalAlpha = (1 - b.t) * .5; ctx.fill();
    ctx.restore();
  }
  arena.pops = arena.pops.filter(p => (p.t += .018) < 1);
  for (const p of arena.pops) {
    ctx.save(); ctx.globalAlpha = 1 - p.t * p.t; ctx.font = `bold ${p.big ? 34 : 26}px system-ui`; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = '#1b2236'; ctx.strokeText(p.text, p.x, p.y - p.t * 40); ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y - p.t * 40);
    ctx.restore();
  }
}

// ---------- 試合の流れ ----------
let busy = false;
async function playMatch(i) {
  if (busy) return;
  busy = true;
  const m = MATCHES[i];
  const first = i === save.progress;
  await talk(m.pre);
  const player = myRobo(), enemy = enemyRobo(i);
  const b = createBattle(player, enemy);
  show('battle');
  $('log').innerHTML = '';
  skipping = false;
  startArena(b, m.color, m.boss);
  logLine(`${m.title}　${player.name} VS ${enemy.name}`);
  await wait(600);
  battleOn = true;
  while (!b.over) {
    for (const ev of step(b)) await playEvent(ev);
    await wait(260);
  }
  battleOn = false;
  const win = b.over === 'p';
  await wait(500);
  show('shop');
  await showResult(win, i, first);
  busy = false;
}

function rewardCard(ch) {
  const p = get(ch);
  return `<div class="reward" data-ch="${esc(ch)}"><canvas></canvas><div><b>「${esc(ch)}」</b> ${elChip(p.element)}</div>
    <div>${bestName(p)}向き ${fitOf(p.aff[p.best]).mark}</div>
    <div class="bars2">${STAT_KEYS.map(k => `<div>${STAT_NAMES[k]}<i style="width:${p.raw[k] * .6}px"></i></div>`).join('')}</div></div>`;
}
function pickReward(options) {
  return new Promise(resolve => {
    $('result-title').textContent = 'しょうり！'; $('result-title').className = 'win';
    $('result-sub').textContent = '新しい部品を 1つ えらぼう（タップ）';
    const box = $('rewards');
    box.innerHTML = options.map(rewardCard).join('');
    box.querySelectorAll('.reward').forEach(el => drawPartIcon(el.querySelector('canvas'), get(el.dataset.ch), '#34415f'));
    let pick = null;
    $('result-ok').textContent = 'この字にする'; $('result-ok').disabled = true;
    $('result').hidden = false;
    box.onclick = e => {
      const c = e.target.closest('.reward');
      if (!c) return;
      pick = c.dataset.ch;
      box.querySelectorAll('.reward').forEach(x => x.classList.toggle('sel', x === c));
      $('result-ok').disabled = false;
    };
    $('result-ok').onclick = () => { $('result').hidden = true; box.onclick = null; resolve(pick); };
  });
}
function simpleResult(title, cls, sub) {
  return new Promise(resolve => {
    $('result-title').textContent = title; $('result-title').className = cls;
    $('result-sub').textContent = sub;
    $('rewards').innerHTML = '';
    $('result-ok').textContent = 'つぎへ'; $('result-ok').disabled = false;
    $('result').hidden = false;
    $('result-ok').onclick = () => { $('result').hidden = true; resolve(); };
  });
}

async function showResult(win, i, first) {
  const m = MATCHES[i];
  if (!win) {
    await simpleResult('まけ…', 'lose', '部品を 組みかえて もういちど！');
    await talk(LOSE);
    renderShop();
    return;
  }
  await talk(m.post);
  if (first) {
    save.progress = Math.min(MATCHES.length, i + 1);
    save.sel = Math.min(save.progress, MATCHES.length - 1);
    if (m.boss) { save.cleared = true; persist(); renderShop(); await runEnding(); return; }
    save.reward = { match: i, options: rewardOptions(i, save.owned, parts) };
    persist();
    await talk(WIN_MID);
    await runReward();
  } else {
    await simpleResult('かち！', 'win', 'れんしゅう試合に 勝った');
  }
  renderShop();
}
async function runReward() {
  if (!save.reward || !save.reward.options.length) { save.reward = null; persist(); return; }
  const pick = await pickReward(save.reward.options);
  if (pick && !save.owned.includes(pick)) save.owned.push(pick);
  save.reward = null; persist();
}
async function runEnding() {
  await talk(ENDING);
  $('ending-text').textContent = `ロボ「${save.name}」は チャンピオン「鬼」を たおし、字ヶ丘の 新しい名人になった！ 集めた部品：${save.owned.length}個／全${CATALOG.length}個`;
  $('ending').hidden = false;
  const r = myRobo();
  let t = 0;
  const loop = () => { if ($('ending').hidden) return; drawRoboPreview($('ending-robo'), r, PLAYER_COLOR, Math.sin(++t / 15) * 3); requestAnimationFrame(loop); };
  loop();
  await new Promise(res => { $('ending-ok').onclick = () => { $('ending').hidden = true; res(); }; });
}

// ---------- 図鑑 ----------
function setupZukan() {
  $('zukan-btn').addEventListener('click', () => { renderZukan(); $('zukan').hidden = false; });
  $('zukan-close').addEventListener('click', () => { $('zukan').hidden = true; });
  $('zukan-grid').addEventListener('click', e => { const c = e.target.closest('.zcell'); if (c) zukanDetail(c.dataset.ch); });
}
function renderZukan() {
  const have = CATALOG.filter(c => save.owned.includes(c.ch)).length;
  $('zukan-count').textContent = `${have} / ${CATALOG.filter(c => parts.has(c.ch)).length}`;
  const grid = $('zukan-grid');
  grid.innerHTML = '';
  for (const c of CATALOG) {
    const p = parts.get(c.ch);
    if (!p) continue;
    const own = save.owned.includes(c.ch);
    const d = document.createElement('div');
    d.className = 'zcell' + (own ? '' : ' locked');
    d.dataset.ch = c.ch;
    d.innerHTML = `<canvas></canvas><div>${own ? esc(c.ch) : '？'}</div>`;
    grid.append(d);
    drawPartIcon(d.querySelector('canvas'), p, own ? '#34415f' : '#556');
  }
  $('zukan-detail').innerHTML = 'タップすると くわしく見られます';
}
function zukanDetail(ch) {
  const p = parts.get(ch), own = save.owned.includes(ch);
  document.querySelectorAll('.zcell').forEach(c => c.classList.toggle('sel', c.dataset.ch === ch));
  if (!own) { $('zukan-detail').innerHTML = '<b>？</b>　まだ 手に入れていない部品。試合に勝って 集めよう'; return; }
  const fits = ['head', 'body', 'rarm', 'legs'].map(s => `${SLOT_NAMES[s === 'rarm' ? 'rarm' : s].replace('右腕', '腕')}${fitOf(p.aff[s]).mark || '－'}`).join('　');
  $('zukan-detail').innerHTML = `<b style="font-size:16px">「${esc(ch)}」</b> 画数${p.strokes} ${elChip(p.element)}
    ${p.element ? `<span class="note">${ELEMENTS[p.element].why}</span>` : ''}<br>枠との相性：${fits}
    <div class="bars2">${STAT_KEYS.map(k => `<div><span>${STAT_NAMES[k]}</span><i style="width:${p.raw[k] * 1.6}px"></i> ${p.raw[k]}</div>`).join('')}</div>`;
}

// ---------- 起動 ----------
async function boot() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  parts = buildParts(font);
  save = loadSave();
  setupDrag(); setupZukan();
  $('speed').addEventListener('click', () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; $('speed').textContent = `はやおくり ×${speed}`; });
  $('skip').addEventListener('click', () => { skipping = true; });
  $('rename').addEventListener('click', async () => { await askName(); renderShop(); });
  $('reset-btn').addEventListener('click', async () => {
    if (!confirm('最初からやり直しますか？（部品と進行が消えます）')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* なにもしない */ }
    save = freshSave(); selected = null; busy = false;
    $('result').hidden = true;
    await startIntro();
  });
  // 毎フレーム：組み立て画面のロボ／バトル
  const frame = t => {
    if (!$('shop').hidden && !busy) drawRoboPreview($('preview'), myRobo(), PLAYER_COLOR, Math.sin(t / 500) * 2);
    if (!$('battle').hidden) drawArena(t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (params.has('test')) window.__robo = { get save() { return save; }, parts, persist, renderShop, MATCHES,
    // 検証用：その字を足したときの、おまかせ組み立ての強さ
    score(ch) { const r = assemble(autoBuild([...save.owned, ch], get), get); const s = r.stats; return s.hp / 3 + s.atk + s.def + s.aim * .5 + s.spd * .3; } };
  $('loading').hidden = true;
  if (!save.intro) await startIntro();
  else { show('shop'); renderShop(); if (save.reward) { busy = true; await runReward(); busy = false; renderShop(); } }
}
async function startIntro() {
  show('shop'); renderShop();
  await talk(INTRO);
  await askName();
  await talk(AFTER_NAME);
  save.intro = true; persist(); renderShop();
}

boot().catch(e => { $('loading').hidden = false; $('loading').querySelector('.box').textContent = `読みこめませんでした（${e.message}）。再読み込みしてください`; console.error(e); });
