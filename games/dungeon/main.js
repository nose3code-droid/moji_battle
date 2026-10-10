import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { SPECIALS } from '../status/stats.js';
import { charOf, bossOf, WILD_POOL, HERO, BOSSES, LEGEND, MAX_FLOOR, strokesOf } from './chars.js';
import { createRun, act, resolveHandFull, specialOf, specialReady, isFloor } from './game.js';
import { PROLOGUE, FLOOR_INTRO, BOSS_TALK, LEGEND_TALK, ENDING, GAMEOVER } from './story.js';

// 動作確認用のパラメータ：?seed=数字（同じ地形）&start=階層&god（ダメージ無効）&cards=最初から持つ字&skip（会話を飛ばす）&debug
const Q = new URLSearchParams(location.search);
const SAVE_KEY = 'moji_dungeon.save';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let font = null, pool = WILD_POOL;
const ch2 = ch => charOf(font, ch);

// ---------- 記録（localStorage） ----------
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') return { best: s.best | 0, clears: s.clears | 0, codex: s.codex && typeof s.codex === 'object' ? s.codex : {} };
  } catch { /* 読めなければ新規扱い */ }
  return { best: 0, clears: 0, codex: {} };
}
const save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できない環境でも遊べる */ } }

// ---------- 文字の絵 ----------
const pathCache = new Map();
function glyphInfo(ch) {
  if (!pathCache.has(ch)) {
    const c = ch2(ch);
    const { box } = c.shape;
    const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y;
    const s = 0.86 / Math.max(bw, bh, 0.6);   // 小さい字を拡大しすぎない
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
    // 外形は 1 つずつ塗り、穴はあとでくり抜く（輪郭が重なるフォントでも evenodd で消えない）
    const outers = [], holes = [], rings = [];
    const toPath = ring => {
      const p = new Path2D();
      const pts = ring.map(q => [(q.x - cx) * s, -(q.y - cy) * s]);
      pts.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y));
      p.closePath();
      rings.push(pts);
      return p;
    };
    for (const poly of c.shape.polys) {
      outers.push(toPath(poly.outer));
      for (const h of poly.holes) holes.push(toPath(h));
    }
    const path = { outers, holes };
    pathCache.set(ch, { path, rings });
  }
  return pathCache.get(ch);
}

// 欠けの位置は字と何番目かだけで決まる（毎回同じ場所が欠ける）
function chipSpot(ch, i, rings) {
  let h = 2166136261;
  for (const n of [ch.codePointAt(0), i, 31]) { h ^= n; h = Math.imul(h, 16777619); h ^= h >>> 15; }
  const ring = rings[(h >>> 0) % rings.length];
  const pt = ring[((h >>> 8) >>> 0) % ring.length];
  return { x: pt[0], y: pt[1], rot: ((h >>> 4) % 628) / 100 };
}

// 欠けた字の絵。lost = 欠けた数、maxChips = 欠けの最大数（1 画ずつ欠けていく見た目）
const spriteCache = new Map();
function sprite(ch, color, lost, maxChips, px) {
  const key = `${ch}|${color}|${lost}|${maxChips}|${px}`;
  let cv = spriteCache.get(key);
  if (cv) return cv;
  if (spriteCache.size > 600) spriteCache.clear();
  cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  g.translate(px / 2, px / 2); g.scale(px, px);
  const { path, rings } = glyphInfo(ch);
  g.fillStyle = color;
  for (const o of path.outers) g.fill(o);
  g.globalCompositeOperation = 'destination-out';
  for (const h of path.holes) g.fill(h);
  if (lost > 0) {
    const r = 0.12 + 0.22 / maxChips;
    for (let i = 0; i < lost; i++) {
      const k = chipSpot(ch, i, rings);
      g.beginPath();
      for (let j = 0; j < 9; j++) {
        const a = j / 9 * Math.PI * 2 + k.rot, rr = r * (j % 2 ? 0.55 : 1);
        g.lineTo(k.x + Math.cos(a) * rr, k.y + Math.sin(a) * rr);
      }
      g.fill();
    }
  }
  spriteCache.set(key, cv);
  return cv;
}
const chipsOf = (hp, maxHp) => {
  const maxChips = Math.min(maxHp, 12);
  const lost = maxHp - hp;
  return { maxChips, lost: lost <= 0 ? 0 : Math.min(maxChips, Math.max(1, Math.round(lost / maxHp * maxChips))) };
};
const cardSprite = (c, color, px) => { const k = chipsOf(c.hp, c.maxHp); return sprite(c.ch, color, k.lost, k.maxChips, px); };

// 小さな canvas に字を描く（HUD・手札・会話など）
function paintGlyph(canvas, ch, color, lost = 0, maxChips = 1) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const size = canvas.clientWidth || 48;
  canvas.width = canvas.height = Math.round(size * dpr);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(sprite(ch, color, lost, maxChips, canvas.width), 0, 0);
}

// ---------- 状態 ----------
let run = null;
let busy = false;        // 会話や選択の最中は操作を受けない
const logLines = [];
const popups = [];       // 浮かぶ数字 { x, y, text, color, t0 }
const particles = [];    // 倒れたときのかけら
const flashes = new Map();   // 敵の id / 'p' → 光った時刻

// ---------- 会話 ----------
function showScene(lines) {
  if (Q.has('skip') || !lines?.length) return Promise.resolve();
  return new Promise(resolve => {
    const box = $('scene'), face = $('scene-face'), text = $('scene-text');
    let i = 0, typing = null, full = '';
    const finish = () => {
      clearInterval(typing);
      box.hidden = true;
      $('scene-skip').onclick = null; box.onclick = null;
      removeEventListener('keydown', onKey);
      resolve();
    };
    const show = () => {
      const l = lines[i];
      face.classList.toggle('none', !l.who);
      if (l.who) paintGlyph(face, l.who, l.who === HERO ? '#5aa0ff' : '#f1ead8');
      $('scene-name').textContent = l.who ? `「${l.who}」` : '';
      full = l.text; text.textContent = '';
      let n = 0;
      clearInterval(typing);
      typing = setInterval(() => { text.textContent = full.slice(0, ++n); if (n >= full.length) clearInterval(typing); }, 28);
    };
    const advance = () => {
      if (text.textContent.length < full.length) { clearInterval(typing); text.textContent = full; return; }
      if (++i >= lines.length) finish(); else show();
    };
    const onKey = e => { if (['Enter', ' ', 'ArrowRight'].includes(e.key)) { e.preventDefault(); advance(); } };
    box.hidden = false;
    box.onclick = e => { if (e.target.id !== 'scene-skip') advance(); };
    $('scene-skip').onclick = e => { e.stopPropagation(); finish(); };
    addEventListener('keydown', onKey);
    show();
  });
}

// ---------- ログ・演出 ----------
function log(text) {
  if (!text) return;
  logLines.push(text);
  if (logLines.length > 4) logLines.shift();
  $('log').innerHTML = logLines.slice(-3).map(l => `<div>${esc(l)}</div>`).join('');
}
const popup = (x, y, text, color = '#fff') => popups.push({ x, y, text, color, t0: performance.now() });
function burst(x, y, color) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * 6.28, v = 1 + Math.random() * 2.5;
    particles.push({ x: x + .5, y: y + .5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, color, t0: performance.now() });
  }
}
function banner(text, boss) {
  const b = $('banner');
  b.hidden = true; b.className = boss ? 'boss' : '';
  b.textContent = text;
  void b.offsetWidth;
  b.hidden = false;
  setTimeout(() => { b.hidden = true; }, 1600);
}
function shake() {
  const s = $('stage');
  s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake');
  navigator.vibrate?.(30);
}

// ---------- 操作 → 出来事の処理 ----------
async function doAction(a) {
  if (!run || busy || run.over) return;
  const evs = act(run, a);
  if (!evs.length) return;
  busy = true;
  try { await handleEvents(evs); } finally { busy = false; }
  refreshUI();
}

async function handleEvents(evs) {
  for (const ev of evs) {
    if (ev.text) log(ev.text);
    switch (ev.type) {
      case 'hit':
        popup(ev.x, ev.y, ev.dmg ? `-${ev.dmg}` : '0', ev.side === 'p' ? '#ff6b6b' : ev.crit ? '#ffd24a' : '#fff');
        flashes.set(ev.id, performance.now());
        if (ev.side === 'p') shake();
        break;
      case 'dodge': popup(ev.x, ev.y, 'かわした', '#9ad'); break;
      case 'heal': popup(ev.x, ev.y, `+${ev.amount}`, '#5fe08d'); break;
      case 'kill': burst(ev.x, ev.y, '#e5484d'); break;
      case 'pickup':
        if (ev.item === 'card') { save.codex[ev.ch] = (save.codex[ev.ch] || 0) + 1; persist(); }
        break;
      case 'fall': shake(); break;
      case 'handFull': await chooseDiscard(); break;
      case 'bossSight': await showScene(bossLines(BOSS_TALK[ev.floor].before)); break;
      case 'bossDown': await showScene(bossLines(BOSS_TALK[ev.floor].after)); break;
      case 'floor': await onFloor(ev); break;
      case 'legend': await onLegend(); break;
      case 'lose': await onLose(); break;
    }
  }
}

// 台詞の 'boss' / {boss} を、この階のぬしの字に置き換える
function bossLines(lines) {
  const b = run.fl.bossCh;
  return lines.map(l => ({ who: l.who === 'boss' ? b : l.who, text: l.text.replaceAll('{boss}', b) }));
}

async function onFloor(ev) {
  save.best = Math.max(save.best, ev.floor);
  persist();
  refreshUI();
  banner(`地下 ${ev.floor} 階`, ev.boss);
  await showScene(FLOOR_INTRO[ev.floor]);
}

async function onLegend() {
  save.codex[LEGEND] = (save.codex[LEGEND] || 0) + 1;
  save.clears++;
  persist();
  await showScene(LEGEND_TALK);
  await showScene(ENDING);
  showResult(true);
}

async function onLose() {
  await showScene(GAMEOVER);
  showResult(false);
}

function showResult(clear) {
  $('result-title').textContent = clear ? '伝説の1文字を持ち帰った！' : '町に戻された…';
  const found = run.found.map(c => `「${esc(c)}」`).join('') || 'なし';
  $('result-body').innerHTML =
    `${clear ? 'エンディング達成！<br>' : ''}到達した階層：地下 <b>${run.floor}</b> 階（最高 <b>${save.best}</b> 階）<br>` +
    `たおした字：<b>${run.kills}</b> 体<br>新しい仲間：${found}`;
  $('again').textContent = clear ? 'もう一度潜る' : 'もう一度 潜る';
  $('result').hidden = false;
}

// 手持ちがいっぱいのとき、入れ替える字を選ぶ
function chooseDiscard() {
  return new Promise(resolve => {
    const it = run.pending.item;
    $('full-title').textContent = `「${it.ch}」を見つけた！`;
    const list = $('full-list');
    list.innerHTML = '';
    const finish = card => {
      $('full').hidden = true;
      handleEvents(resolveHandFull(run, card)).then(resolve);
    };
    for (const c of run.hand) list.append(cardButton(c, () => finish(c)));
    $('full-skip').onclick = () => finish(null);
    $('full').hidden = false;
  });
}

function cardButton(c, onclick, active = false) {
  const b = document.createElement('button');
  b.className = 'card' + (active ? ' active' : '');
  b.innerHTML = `<canvas></canvas><span>${esc(c.ch)}</span><span class="hp${c.hp <= c.maxHp * 0.34 ? ' low' : ''}">画 ${c.hp}/${c.maxHp}</span>`;
  b.onclick = onclick;
  const k = chipsOf(c.hp, c.maxHp);
  requestAnimationFrame(() => paintGlyph(b.querySelector('canvas'), c.ch, active ? '#5aa0ff' : '#cfc8dc', k.lost, k.maxChips));
  return b;
}

// ---------- HUD ----------
function refreshUI() {
  if (!run) return;
  $('floor-label').textContent = `地下 ${run.floor} 階${BOSSES[run.floor] ? '（ぬし）' : ''}`;
  const c = run.cur;
  const k = chipsOf(c.hp, c.maxHp);
  paintGlyph($('hud-glyph'), c.ch, '#5aa0ff', k.lost, k.maxChips);
  // 画数の目盛り（多いときは 14 個にまとめる）
  const n = Math.min(c.maxHp, 14);
  const filled = c.hp >= c.maxHp ? n : Math.max(c.hp > 0 ? 1 : 0, Math.round(c.hp / c.maxHp * n));
  const low = c.hp <= c.maxHp * 0.34;
  const ticks = Array.from({ length: n }, (_, i) => `<i class="tick${i >= filled ? ' lost' : low ? ' low' : ''}"></i>`).join('');
  const sp = specialOf(c);
  $('hud-info').innerHTML =
    `<div class="name">「${esc(c.ch)}」<small>Lv${c.lv}　画 ${c.hp}/${c.maxHp}</small></div><div class="ticks">${ticks}</div>` +
    `<div class="sp-line"><b>${sp.name}</b> ${sp.desc}</div>`;
  const hand = $('hand');
  hand.innerHTML = '';
  run.hand.forEach(card => {
    const b = cardButton(card, () => doAction({ type: 'swap', card }), card === c);
    hand.append(b);
  });
  const btn = $('special'), ready = specialReady(c);
  btn.disabled = false;
  btn.classList.toggle('ready', ready);
  btn.innerHTML = `${sp.name}<small>${ready ? 'つかえる' : `あと ${c.cd} ターン`}</small>`;
}

// ---------- 描画（Canvas 2D） ----------
let last = performance.now();
let playerScreen = null;   // 自分の字が画面のどこにいるか（タップの向きに使う）
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (run && !$('game').hidden) draw(now, dt);
}

function draw(now, dt) {
  const cv = $('map'), cw = cv.clientWidth, chh = cv.clientHeight;
  if (!cw || !chh) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(chh * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0d0d12';
  g.fillRect(0, 0, cw, chh);

  const fl = run.fl, T = Math.max(30, Math.floor(cw / 9)), px = Math.round(T * dpr);
  const ease = Math.min(1, dt * 16);
  // 見た目の位置を、本当の位置になめらかに近づける
  if (fl.pvx === undefined) { fl.pvx = fl.px; fl.pvy = fl.py; }
  fl.pvx += (fl.px - fl.pvx) * ease; fl.pvy += (fl.py - fl.pvy) * ease;
  for (const e of fl.enemies) {
    if (e.vx === undefined) { e.vx = e.x; e.vy = e.y; }
    e.vx += (e.x - e.vx) * ease; e.vy += (e.y - e.vy) * ease;
  }
  const vw = cw / T, vh = chh / T;
  const cam = (p, v, size) => size <= v ? (size - v) / 2 : Math.min(size - v, Math.max(0, p + 0.5 - v / 2));
  const camX = cam(fl.pvx, vw, fl.W), camY = cam(fl.pvy, vh, fl.H);
  const sx = x => (x - camX) * T, sy = y => (y - camY) * T;

  const x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(fl.W - 1, Math.ceil(camX + vw));
  const y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(fl.H - 1, Math.ceil(camY + vh));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * fl.W + x;
      if (!fl.seen[i]) continue;
      const floor = isFloor(fl, x, y);
      if (floor) {
        g.fillStyle = (x + y) % 2 ? '#e9dfc8' : '#e2d7bc';
        g.fillRect(sx(x), sy(y), T + 0.5, T + 0.5);
      } else {
        // 床に接している壁だけ描く
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => isFloor(fl, x + dx, y + dy));
        if (!near) continue;
        g.fillStyle = '#3a3748'; g.fillRect(sx(x), sy(y), T + 0.5, T + 0.5);
        g.fillStyle = '#2b2937'; g.fillRect(sx(x) + 2, sy(y) + 2, T - 4, T - 4);
      }
    }
  }
  const visible = (x, y) => fl.vis[y * fl.W + x] === 1;
  const drawGlyphAt = (ch, color, x, y, scale = 1, alpha = 1, lost = 0, maxChips = 1) => {
    const s = sprite(ch, color, lost, maxChips, px);
    g.globalAlpha = alpha;
    const size = T * scale;
    g.drawImage(s, sx(x) + (T - size) / 2, sy(y) + (T - size) / 2, size, size);
    g.globalAlpha = 1;
  };
  const bob = Math.sin(now / 300) * 0.04;

  // 出口
  if (fl.exit && fl.seen[fl.exit.y * fl.W + fl.exit.x]) {
    const o = fl.exitOpen;
    g.fillStyle = o ? 'rgba(232,163,61,.35)' : 'rgba(90,90,110,.4)';
    g.fillRect(sx(fl.exit.x), sy(fl.exit.y), T, T);
    drawGlyphAt(o ? '階' : '封', o ? '#b9770e' : '#6a6878', fl.exit.x, fl.exit.y, 0.8);
  }
  // アイテム
  for (const it of fl.items) {
    if (!fl.seen[it.y * fl.W + it.x]) continue;
    const y = it.y + bob;
    if (it.type === 'ink') drawGlyphAt('墨', '#25222e', it.x, y, 0.7);
    else if (it.type === 'brush') drawGlyphAt('筆', '#a5561a', it.x, y, 0.7);
    else if (it.type === 'card') {
      const cx = sx(it.x) + T * 0.14, cy = sy(y) + T * 0.1, w = T * 0.72, h = T * 0.8;
      g.fillStyle = '#fffaf0'; g.strokeStyle = '#7a4bd1'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(cx, cy, w, h, 6); g.fill(); g.stroke();
      drawGlyphAt(it.ch, '#5b2fb0', it.x, y, 0.62);
    } else if (it.type === 'altar') {
      g.save(); g.shadowColor = '#ffd24a'; g.shadowBlur = 18 + Math.sin(now / 200) * 8;
      drawGlyphAt(it.ch, '#d89b00', it.x, y, 0.95);
      g.restore();
    }
  }
  // 敵
  for (const e of fl.enemies) {
    if (e.hp <= 0 || !visible(e.x, e.y)) continue;
    const k = chipsOf(e.hp, e.maxHp);
    const flash = now - (flashes.get(e.id) || -1e9) < 150;
    drawGlyphAt(e.ch, flash ? '#ffffff' : e.boss ? '#7a2bd1' : '#c8323c', e.vx, e.vy + bob, e.boss ? 1.25 : 0.92, 1, flash ? 0 : k.lost, k.maxChips);
    if (e.hp < e.maxHp) {   // 体力ゲージ
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(sx(e.vx) + 3, sy(e.vy) + T - 5, T - 6, 4);
      g.fillStyle = '#e5484d'; g.fillRect(sx(e.vx) + 3, sy(e.vy) + T - 5, (T - 6) * e.hp / e.maxHp, 4);
    }
  }
  // プレイヤー
  {
    const c = run.cur, k = chipsOf(c.hp, c.maxHp);
    const flash = now - (flashes.get('p') || -1e9) < 150;
    g.fillStyle = 'rgba(43,125,233,.18)'; g.beginPath(); g.arc(sx(fl.pvx) + T / 2, sy(fl.pvy) + T / 2, T * 0.46, 0, 7); g.fill();
    playerScreen = { x: sx(fl.pvx) + T / 2, y: sy(fl.pvy) + T / 2 };
    drawGlyphAt(c.ch, flash ? '#ff9a9a' : '#1f63c7', fl.pvx, fl.pvy + bob, 0.92, 1, flash ? 0 : k.lost, k.maxChips);
  }
  // 見えない場所を暗くする
  g.fillStyle = 'rgba(10,10,16,.55)';
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fl.seen[y * fl.W + x] && !visible(x, y)) g.fillRect(sx(x), sy(y), T + 0.5, T + 0.5);

  // 数字・かけら
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i], t = (now - p.t0) / 800;
    if (t > 1) { popups.splice(i, 1); continue; }
    g.globalAlpha = 1 - t * t;
    g.font = `bold ${Math.round(T * 0.42)}px MojiUI, sans-serif`;
    g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#000'; g.fillStyle = p.color;
    const tx = sx(p.x) + T / 2, ty = sy(p.y) + T * 0.3 - t * T * 0.7;
    g.strokeText(p.text, tx, ty); g.fillText(p.text, tx, ty);
    g.globalAlpha = 1;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i], t = (now - p.t0) / 600;
    if (t > 1) { particles.splice(i, 1); continue; }
    g.globalAlpha = 1 - t; g.fillStyle = p.color;
    g.fillRect(sx(p.x + p.vx * t * 0.8) - 3, sy(p.y + p.vy * t * 0.8 + t * t) - 3, 6, 6);
    g.globalAlpha = 1;
  }
}

// ---------- 入力 ----------
const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const move = d => doAction({ type: 'move', dx: DIR[d][0], dy: DIR[d][1] });

function setupInput() {
  for (const b of document.querySelectorAll('#dpad button')) {
    b.addEventListener('click', () => b.dataset.dir ? move(b.dataset.dir) : doAction({ type: 'wait' }));
  }
  $('special').addEventListener('click', () => doAction({ type: 'special' }));
  const keys = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
  addEventListener('keydown', e => {
    if ($('game').hidden || !run) return;
    if (keys[e.key]) { e.preventDefault(); move(keys[e.key]); }
    else if (e.key === ' ' || e.key === '.') { e.preventDefault(); doAction({ type: 'wait' }); }
    else if (e.key === 'q' || e.key === 'e') doAction({ type: 'special' });
    else if (/^[1-5]$/.test(e.key) && run.hand[e.key - 1]) doAction({ type: 'swap', card: run.hand[e.key - 1] });
  });
  // スワイプ（短くタップしたときは、タップした側へ 1 歩）
  const map = $('map');
  let down = null;
  map.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; map.setPointerCapture?.(e.pointerId); });
  map.addEventListener('pointerup', e => {
    if (!down) return;
    let dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.hypot(dx, dy) < 12) {   // タップ：自分の字から見た向きへ 1 歩（真上をタップなら待機）
      const r = map.getBoundingClientRect(), T = Math.max(30, Math.floor(r.width / 9));
      if (!playerScreen) return;
      dx = e.clientX - r.left - playerScreen.x; dy = e.clientY - r.top - playerScreen.y;
      if (Math.hypot(dx, dy) < T * 0.5) return doAction({ type: 'wait' });
    }
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  map.addEventListener('pointercancel', () => { down = null; });
}

// ---------- 画面の切り替え ----------
function showTown() {
  run = null;
  $('game').hidden = true; $('town').hidden = false; $('result').hidden = true;
  const owned = Object.keys(save.codex).length;
  $('town-stats').innerHTML = `最深到達：${save.best ? `地下 <b>${save.best}</b> 階` : 'まだ潜っていない'}　クリア：<b>${save.clears}</b> 回<br>仲間にした字：<b>${owned}</b> 種`;
  $('dive').textContent = save.best ? 'もう一度 潜る' : '迷宮へ潜る';
}

async function startRun() {
  $('town').hidden = true; $('result').hidden = true; $('game').hidden = false;
  logLines.length = 0; $('log').innerHTML = '';
  popups.length = 0; particles.length = 0; flashes.clear();
  const start = Math.max(1, Math.min(MAX_FLOOR, +Q.get('start') || 1));
  run = createRun({ charOf: ch2, bossOf: f => bossOf(font, f), pool }, {
    seed: Q.has('seed') ? +Q.get('seed') : undefined, startFloor: start, god: Q.has('god'), cards: Q.get('cards') || '',
  });
  save.best = Math.max(save.best, start); persist();
  refreshUI();
  busy = true;
  try {
    if (start === 1) await showScene(PROLOGUE);
    banner(`地下 ${start} 階`, !!BOSSES[start]);
    await showScene(FLOOR_INTRO[start]);
  } finally { busy = false; }
  refreshUI();
}

function openCodex() {
  const grid = $('codex-grid');
  grid.innerHTML = '';
  const owned = Object.keys(save.codex).sort((a, b) => strokesOf(a) - strokesOf(b));
  $('codex-count').textContent = `${owned.length} 種`;
  $('codex-detail').textContent = owned.length ? '字をタップすると くわしく見られる' : 'まだ仲間がいない。倒した字がカードを落とすことがある';
  for (const ch of owned) {
    const c = ch2(ch);
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<canvas></canvas><span>${esc(ch)}</span><span class="hp">${strokesOf(ch)}画</span>`;
    b.onclick = () => {
      const s = c.stats, sp = SPECIALS[c.special];
      $('codex-detail').innerHTML = `<b>「${esc(ch)}」</b> ${strokesOf(ch)}画　こうげき ${s.atk}／ぼうぎょ ${s.def}／すばやさ ${s.spd}<br>とくぎ <b>${sp.name}</b>：${sp.desc}`;
    };
    grid.append(b);
    requestAnimationFrame(() => paintGlyph(b.querySelector('canvas'), ch, '#cfc8dc'));
  }
  $('codex').hidden = false;
}

// ---------- 起動 ----------
async function loadFont() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf.slice(0));
  // 画面の文字も同じフォントで出す（端末に日本語フォントがなくても読めるように）
  try { document.fonts.add(await new FontFace('MojiUI', buf).load()); } catch { /* 無くても system のフォントで表示される */ }
}

function setup() {
  setupInput();
  $('dive').onclick = startRun;
  $('again').onclick = startRun;
  $('result-town').onclick = showTown;
  $('to-town').onclick = () => { if (!busy && confirm('町に戻りますか？（この冒険はここで終わります）')) showTown(); };
  $('open-codex').onclick = openCodex;
  $('codex-close').onclick = () => { $('codex').hidden = true; };
  requestAnimationFrame(frame);
}

if (Q.has('debug')) window.__dungeon = { get run() { return run; }, act: doAction, save, get busy() { return busy; }, newRun: o => createRun({ charOf: ch2, bossOf: f => bossOf(font, f), pool }, o), rawAct: act };
setup();
try {
  await loadFont();
  pool = WILD_POOL.filter(c => ch2(c));
  $('loading').hidden = true;
  showTown();
  if (Q.has('start') && Q.has('auto')) startRun();   // 動作確認用：町を飛ばして始める
} catch (e) {
  $('loading').querySelector('.box').textContent = `フォントを読み込めませんでした（${e.message}）。再読み込みしてください`;
}
