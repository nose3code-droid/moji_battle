import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { makeCharacter, SPECIALS, STAT_KEYS, STAT_NAMES, STAT_MAX } from './stats.js';
import { createBattle, nextActor, act, cpuChoose, winner, unit, alive, specialReady, specialNeedsTarget } from './battle.js';

const TEAM_MAX = 3;
const PRESETS = Array.from('〇あ木鬱一SiB龍米');
const CPU_POOL = Array.from('〇のあ木山龍田S@Oろるぬめ米水火風日月永花ゆ一！i8%小大口W');
const SLOW = new URLSearchParams(location.search).has('fast') ? 0.15 : 1; // ?fast で演出を速く（動作確認用）
const COLORS = { p: '#2b7de9', e: '#e5484d' };

const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms * SLOW));
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

let font = null;
const charCache = new Map();   // 文字 → キャラ（計算は決定的なので使い回す）
function character(ch) {
  if (!charCache.has(ch)) charCache.set(ch, makeCharacter(font, ch));
  return charCache.get(ch);
}

// ---------- 文字の絵（Canvas 2D） ----------
// 輪郭ポリゴンを塗る。chips は欠けた跡（em 座標の円）
function drawGlyph(canvas, c, color, chips = []) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 100, h = canvas.clientHeight || 100;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const { box } = c.shape;
  const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y;
  // 小さい字（「.」など）を拡大しすぎないよう、1em を基準に収める
  const s = Math.min(w, h) * 0.86 / Math.max(bw, bh, 0.6);
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
  const X = x => w / 2 + (x - cx) * s, Y = y => h / 2 - (y - cy) * s;   // y 上向き → 画面の下向き
  ctx.beginPath();
  for (const { outer, holes } of c.shape.polys) {
    for (const ring of [outer, ...holes]) {
      ring.forEach((q, i) => i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y)));
      ctx.closePath();
    }
  }
  ctx.fillStyle = color;
  ctx.fill('evenodd');
  if (chips.length) {
    ctx.globalCompositeOperation = 'destination-out';
    for (const k of chips) {
      ctx.beginPath();
      // ぎざぎざの欠け
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + k.rot, r = k.r * s * (i % 2 ? 0.55 : 1);
        ctx.lineTo(X(k.x) + Math.cos(a) * r, Y(k.y) + Math.sin(a) * r);
      }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// 欠けを1つ足す：輪郭のふちのどこかを、ダメージに応じた大きさで削る
function addChip(u, ratio) {
  const rings = u.char.shape.polys.flatMap(p => [p.outer, ...p.holes]);
  const ring = rings[Math.floor(Math.random() * rings.length)];
  const q = ring[Math.floor(Math.random() * ring.length)];
  u.chips.push({ x: q.x, y: q.y, r: 0.05 + Math.min(ratio, 0.6) * 0.2, rot: Math.random() * 6 });
}

// ---------- レーダーチャート（SVG） ----------
function radarSVG(stats, color, size = 180, labels = true) {
  const n = STAT_KEYS.length, c = size / 2, R = size / 2 - (labels ? 30 : 6);
  const pt = (i, r) => {
    const a = -Math.PI / 2 + i / n * Math.PI * 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  const ring = f => STAT_KEYS.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(',')).join(' ');
  const val = STAT_KEYS.map((k, i) => pt(i, R * Math.max(0.06, Math.min(1, stats[k] / STAT_MAX[k]))).map(v => v.toFixed(1)).join(',')).join(' ');
  let g = '';
  for (const f of [0.25, 0.5, 0.75, 1]) g += `<polygon points="${ring(f)}" class="grid"/>`;
  STAT_KEYS.forEach((_, i) => { const [x, y] = pt(i, R); g += `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="grid"/>`; });
  g += `<polygon points="${val}" fill="${color}" fill-opacity=".35" stroke="${color}" stroke-width="2"/>`;
  if (labels) STAT_KEYS.forEach((k, i) => {
    const [x, y] = pt(i, R + 17);
    g += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${STAT_NAMES[k]}</text><text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" class="num">${stats[k]}</text>`;
  });
  const pad = labels ? 24 : 0;   // 左右のラベルが切れないよう横に余白
  return `<svg class="radar" viewBox="${-pad} 0 ${size + pad * 2} ${size}" width="${size + pad * 2}" height="${size}">${g}</svg>`;
}

// キャラの詳しいカード（チーム作り・詳細表示で使う）
function profileCard(c, color) {
  const sp = SPECIALS[c.special];
  const el = document.createElement('div');
  el.className = 'profile';
  el.innerHTML = `
    <canvas class="glyph"></canvas>
    ${radarSVG(c.stats, color)}
    <div class="sp-box"><b>特技：${sp.name}</b><span>${sp.desc}</span></div>
    <div class="traits">${c.traits.map(t => `<i>${t}</i>`).join('') || '<i>ふつう</i>'}</div>`;
  requestAnimationFrame(() => drawGlyph(el.querySelector('canvas'), c, color));
  return el;
}

// ---------- チーム作り ----------
function teamChars() {
  return Array.from($('team').value).filter(ch => ch.trim()).slice(0, TEAM_MAX);
}

function renderBuild() {
  const list = teamChars();
  const bad = list.filter(ch => !character(ch));
  $('preview').innerHTML = '';
  for (const ch of list) {
    const c = character(ch);
    if (c) $('preview').append(profileCard(c, COLORS.p));
  }
  $('team-msg').textContent = bad.length ? `「${bad.join('」「')}」はフォントに無いので使えません`
    : Array.from($('team').value).filter(ch => ch.trim()).length > TEAM_MAX ? `チームは ${TEAM_MAX} 文字までです（先頭の ${TEAM_MAX} 文字を使います）` : '';
  $('fight').disabled = !list.length || bad.length > 0;
}

function setupBuild() {
  $('presets').innerHTML = PRESETS.map(ch => `<button data-c="${esc(ch)}">${esc(ch)}</button>`).join('');
  $('presets').addEventListener('click', e => {
    const ch = e.target.closest('button')?.dataset.c;
    if (!ch) return;
    const list = teamChars();
    if (list.length >= TEAM_MAX) list.shift();   // 満員なら古いほうから押し出す
    list.push(ch);
    $('team').value = list.join('');
    renderBuild();
  });
  $('team').addEventListener('input', renderBuild);
  $('random').addEventListener('click', () => { $('team').value = pickRandom(CPU_POOL, TEAM_MAX).join(''); renderBuild(); });
  $('fight').addEventListener('click', () => startBattle(teamChars()));
}

function pickRandom(pool, n, avoid = []) {
  const rest = pool.filter(ch => !avoid.includes(ch));
  const out = [];
  while (out.length < n && rest.length) out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  return out;
}

// ---------- バトル ----------
let battle = null;
let playerTeam = [];
let battleId = 0;       // やり直したら古いバトルの非同期処理を止めるため
let choose = null;      // プレイヤーの入力待ち（resolve 関数）
let targetingFor = null;

function cardHTML(u) {
  return `<div class="card ${u.side}" data-id="${u.id}">
    <canvas class="glyph"></canvas>
    <div class="badges"><i class="guard" title="ぼうぎょ中">🛡</i><i class="shell" title="まもり強化">◎</i><i class="ready" title="特技OK">★</i></div>
    <div class="hp"><b></b></div>
    <div class="hp-num"></div>
  </div>`;
}

function cardEl(u) { return document.querySelector(`.card[data-id="${u.id}"]`); }

function updateCard(u, redraw = false) {
  const el = cardEl(u);
  const r = u.hp / u.maxHp;
  el.querySelector('.hp b').style.width = `${r * 100}%`;
  el.querySelector('.hp b').className = r < 0.25 ? 'low' : r < 0.5 ? 'mid' : '';
  el.querySelector('.hp-num').textContent = `${u.hp} / ${u.maxHp}`;
  el.classList.toggle('ko', u.hp <= 0);
  el.classList.toggle('guarding', u.guard);
  el.classList.toggle('shelled', u.shell > 0);
  el.classList.toggle('sp-ready', u.hp > 0 && specialReady(u));
  if (redraw) drawGlyph(el.querySelector('canvas'), u.char, COLORS[u.side], u.chips);
}

function log(text) {
  if (!text) return;
  const p = document.createElement('p');
  p.textContent = text;
  $('log').append(p);
  while ($('log').children.length > 4) $('log').firstChild.remove();
}

function popNumber(u, text, cls) {
  const s = document.createElement('span');
  s.className = `pop ${cls}`;
  s.textContent = text;
  cardEl(u).append(s);
  setTimeout(() => s.remove(), 1100);
}

function flash(el, cls, ms) {
  el.classList.remove(cls);
  void el.offsetWidth;   // アニメーションをやり直す
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

async function startBattle(chars) {
  playerTeam = chars;
  const enemy = pickRandom(CPU_POOL, chars.length, chars);
  battle = createBattle(chars.map(character), enemy.map(character));
  const id = ++battleId;
  $('build').hidden = true;
  $('result').hidden = true;
  $('battle').hidden = false;
  $('enemy-row').innerHTML = alive(battle, 'e').map(cardHTML).join('');
  $('player-row').innerHTML = alive(battle, 'p').map(cardHTML).join('');
  $('log').innerHTML = '';
  $('vs').textContent = `${chars.join('')}  VS  ${enemy.join('')}`;
  for (const u of battle.units) updateCard(u, true);
  setCommand(null);
  log(`CPU チーム「${enemy.join('')}」が あらわれた！`);
  await wait(700);

  for (;;) {
    if (id !== battleId) return;
    const u = nextActor(battle);
    if (!u) break;
    for (const x of battle.units) updateCard(x);
    document.querySelectorAll('.card.turn').forEach(el => el.classList.remove('turn'));
    cardEl(u).classList.add('turn');
    let choice;
    if (u.side === 'p') {
      choice = await askPlayer(u);
      if (id !== battleId) return;
    } else {
      setCommand(null, `「${u.ch}」(CPU) が かんがえている…`);
      await wait(550);
      choice = cpuChoose(battle, u);
    }
    setCommand(null, '');
    await play(u, act(battle, u, choice.action, choice.target));
    if (id !== battleId) return;
    await wait(250);
  }
  document.querySelectorAll('.card.turn').forEach(el => el.classList.remove('turn'));
  showResult(winner(battle));
}

// イベントを順に演出する
async function play(actor, events) {
  for (const ev of events) {
    log(ev.text);
    if (ev.type === 'move' || ev.type === 'special') {
      flash(cardEl(actor), ev.type === 'special' ? 'cast' : 'lunge', 450);
      await wait(ev.type === 'special' ? 450 : 280);
    } else if (ev.type === 'hit') {
      const t = unit(battle, ev.to);
      addChip(t, ev.dmg / t.maxHp);
      if (ev.dmg / t.maxHp > 0.25) addChip(t, ev.dmg / t.maxHp * 0.5);
      flash(cardEl(t), ev.crit ? 'hit-big' : 'hit', 450);
      popNumber(t, ev.dmg, ev.crit ? 'dmg crit' : 'dmg');
      if (ev.crit) log('かいしんの いちげき！');
      if (ev.guarded) log(`「${t.ch}」は ぼうぎょで ダメージを へらした`);
      updateCard(t, true);
      await wait(380);
    } else if (ev.type === 'heal') {
      const t = unit(battle, ev.who);
      popNumber(t, `+${ev.amount}`, 'heal');
      updateCard(t, true);
      await wait(350);
    } else if (ev.type === 'guard') {
      updateCard(unit(battle, ev.who));
      await wait(350);
    } else if (ev.type === 'ko') {
      updateCard(unit(battle, ev.who), true);
      await wait(500);
    } else {
      await wait(250);
    }
  }
}

function setCommand(u, text = '') {
  $('prompt').textContent = text;
  $('actions').hidden = !u;
  $('targeting').hidden = true;
  if (!u) return;
  const sp = SPECIALS[u.char.special];
  const btn = document.querySelector('[data-act="special"]');
  btn.disabled = !specialReady(u);
  $('sp-name').textContent = specialReady(u) ? sp.name : `${sp.name}（あと${u.cd}）`;
}

// プレイヤーのコマンド入力を待つ
function askPlayer(u) {
  setCommand(u, `「${u.ch}」のばん。どうする？`);
  return new Promise(resolve => { choose = { u, resolve }; });
}

function onAction(action) {
  if (!choose) return;
  const { u, resolve } = choose;
  const finish = target => { choose = null; targetingFor = null; resolve({ action, target }); };
  const needTarget = action === 'attack' || (action === 'special' && specialNeedsTarget(u));
  if (!needTarget) return finish();
  const targets = alive(battle, 'e');
  if (targets.length === 1) return finish(targets[0].id);
  // 相手を選ぶ
  targetingFor = finish;
  $('actions').hidden = true;
  $('targeting').hidden = false;
  $('prompt').textContent = action === 'attack' ? 'だれを こうげきする？' : `だれに ${SPECIALS[u.char.special].name}？`;
  document.body.classList.add('targeting');
}

function setupBattle() {
  $('actions').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) onAction(b.dataset.act);
  });
  $('cancel').addEventListener('click', () => {
    targetingFor = null;
    document.body.classList.remove('targeting');
    if (choose) setCommand(choose.u, `「${choose.u.ch}」のばん。どうする？`);
  });
  $('battle').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const u = unit(battle, card.dataset.id);
    if (targetingFor) {
      if (u.side !== 'e' || u.hp <= 0) return;
      document.body.classList.remove('targeting');
      targetingFor(u.id);
      return;
    }
    showDetail(u);
  });
  $('detail').addEventListener('click', () => { $('detail').hidden = true; });
  $('again').addEventListener('click', () => startBattle(playerTeam));
  $('rebuild').addEventListener('click', () => {
    battleId++;
    $('result').hidden = true;
    $('battle').hidden = true;
    $('build').hidden = false;
    renderBuild();
  });
}

function showDetail(u) {
  const box = $('detail-box');
  box.innerHTML = `<div class="detail-head">${u.side === 'p' ? 'みかた' : 'あいて'}「${esc(u.ch)}」 HP ${u.hp} / ${u.maxHp}</div>`;
  box.append(profileCard(u.char, COLORS[u.side]));
  box.insertAdjacentHTML('beforeend', '<div class="note">タップでとじる</div>');
  $('detail').hidden = false;
}

function showResult(w) {
  const win = w === 'p';
  $('result-title').textContent = win ? 'かち！' : 'まけ…';
  $('result-title').className = win ? 'win' : 'lose';
  const left = alive(battle, w).map(u => `「${u.ch}」`).join('');
  $('result-sub').textContent = `${battle.round} ラウンド・のこり ${left}`;
  setCommand(null, '');
  $('result').hidden = false;
}

// ---------- 起動 ----------
async function loadFont() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
}

setupBuild();
setupBattle();
addEventListener('resize', () => { if (battle && !$('battle').hidden) for (const u of battle.units) updateCard(u, true); });
try {
  await loadFont();
  $('loading').hidden = true;
  renderBuild();
} catch (e) {
  $('loading').querySelector('.box').textContent = `フォントを読み込めませんでした（${e.message}）。再読み込みしてください`;
}
