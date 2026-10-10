// 五属性の守り：火・水・雷・光・闇の字を砲台にして「字の都」を守るタワーディフェンス
import * as opentype from 'opentype';
import { glyphPolygons, centerPolygons } from '../../glyph.js';
import { FONT_URL } from '../../config.js';
import { ELS, COLOR, CYCLE, BEATS, COLS, ROWS, TOWERS, MAPS, SHRINE_LINES, WHO } from './data.js';
import {
  WAVES, createGame, step, build, upgrade, sell, startWave, canBuild, towerAt, towerStat, upgradeCost, sellValue, enemyEl, damageMult,
} from './sim.js';

const KEY = 'moji_bouei.v1';
const CELL = 64, SIZE = CELL * COLS;
const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };
const DEBUG = new URLSearchParams(location.search).has('debug');

// ---------- 保存 ----------
let save = { stars: [0, 0, 0] };
try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.stars)) save = { stars: MAPS.map((_, i) => s.stars[i] | 0) }; } catch { /* 保存なしで始める */ }
function writeSave() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } }

// ---------- 文字の輪郭 → Path2D ----------
let font = null;
const paths = new Map();
function glyphPath(ch) {
  if (paths.has(ch)) return paths.get(ch);
  let p = null;
  if (font) {
    const polys = glyphPolygons(font, ch, 100);
    centerPolygons(polys);
    p = new Path2D();
    for (const { outer, holes } of polys) for (const ring of [outer, ...holes]) {
      ring.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
      p.closePath();
    }
  }
  paths.set(ch, p);
  return p;
}
const canvas = $('view');
const ctx = canvas.getContext('2d');
const dpr = Math.min(devicePixelRatio || 1, 2);
canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;

// 文字 ch を中心 (x,y)、高さ約 size で塗る（輪郭が読めなければ普通のフォントで代用）
function drawGlyph(ch, x, y, size, fill, stroke, lw = 3) {
  const p = glyphPath(ch);
  ctx.save();
  ctx.translate(x, y);
  if (p) {
    ctx.scale(size / 100, -size / 100);
    if (stroke) { ctx.lineWidth = lw * 100 / size; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.stroke(p); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(p, 'evenodd'); }
  } else {
    ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(ch, 0, 0); }
    if (fill) { ctx.fillStyle = fill; ctx.fillText(ch, 0, 0); }
  }
  ctx.restore();
}

// ---------- 状態 ----------
let g = null;
let mapIdx = 0;
let speed = 1, paused = false;
let talk = null;          // { lines, i, done }
let panelOpen = false;
let armed = null;         // 建てようとしている砲台の属性
let selCell = null;       // { c, r }
let selTower = null;
let banner = { text: '', until: 0 };
let clock = 0;            // 画面の時間（秒）

function bannerShow(text, sec = 2.2) { banner = { text, until: clock + sec }; $('banner').textContent = text; }

// ---------- DOM ----------
function buildCycle() {
  const box = $('cycle');
  box.innerHTML = '';
  CYCLE.forEach((el, i) => {
    const s = document.createElement('span');
    s.className = 'el g'; s.textContent = el; s.style.color = COLOR[el]; s.style.borderColor = COLOR[el];
    box.appendChild(s);
    const a = document.createElement('span');
    a.className = 'ar'; a.textContent = '→';
    box.appendChild(a);
    if (i === CYCLE.length - 1) { const s2 = box.firstChild.cloneNode(true); s2.style.opacity = .45; box.appendChild(s2); }
  });
  const sm = document.createElement('small');
  sm.textContent = '矢印の先の属性に強い（ダメージ2倍）／逆は半分。敵の頭の字がその属性';
  box.appendChild(sm);
}
function buildShrines() {
  const box = $('shrines');
  box.innerHTML = '';
  ELS.forEach(el => {
    const s = document.createElement('span');
    s.className = 'g'; s.textContent = el; s.style.setProperty('--c', COLOR[el]); s.dataset.el = el;
    box.appendChild(s);
  });
}
function buildPalette() {
  const box = $('palette');
  box.innerHTML = '';
  ELS.forEach(el => {
    const b = document.createElement('button');
    b.dataset.el = el; b.style.setProperty('--c', COLOR[el]);
    b.innerHTML = `<span class="ch g">${el}</span><span class="co">${TOWERS[el].cost}</span>`;
    b.title = TOWERS[el].info;
    b.addEventListener('click', () => onPalette(el));
    box.appendChild(b);
  });
}

function refreshHud() {
  if (!g) return;
  $('money').textContent = g.money;
  $('lives').textContent = g.lives;
  $('wave').textContent = g.wave;
  document.querySelectorAll('#shrines span').forEach((s, i) => s.classList.toggle('on', i < g.lit));
  document.querySelectorAll('#palette button').forEach(b => {
    b.classList.toggle('armed', armed === b.dataset.el);
    b.classList.toggle('poor', g.money < TOWERS[b.dataset.el].cost);
  });
  const go = $('btn-go');
  go.disabled = !!g.over || g.waveActive || g.wave >= WAVES || !!talk || panelOpen;
  go.textContent = g.wave >= WAVES ? '最終波' : g.waveActive ? `第${g.wave}波 進行中` : `第${g.wave + 1}波を始める`;
  $('btn-speed').textContent = `倍速 ×${speed}`;
  $('btn-pause').textContent = paused ? '再開' : '一時停止';
  $('paused').hidden = !paused || !!talk || panelOpen;
  refreshSel();
}

let selKey = '';
function refreshSel() {
  const box = $('sel');
  const t = selTower;
  const key = t ? `${t.id}:${t.lv}:${g.money}` : armed ? `armed:${armed}:${g.money}:${!!selCell}` : selCell ? 'cell' : 'none';
  if (key === selKey) return;
  selKey = key;
  if (t) {
    const s = towerStat(t), d = TOWERS[t.el], up = upgradeCost(t);
    let extra = '';
    if (t.el === '火') extra = `範囲 ${s.splash.toFixed(1)}マス`;
    if (t.el === '水') extra = `鈍足 ${Math.round(s.slow * 100)}%`;
    if (t.el === '雷') extra = `連鎖 ${s.chain}体`;
    if (t.el === '光') extra = `防御ダウン ×${s.vuln}（貫通）`;
    if (t.el === '闇') extra = `毒 ${s.dot}/秒・倒すと+${s.bonus}`;
    box.innerHTML = `<div class="head"><b class="g" style="color:${COLOR[t.el]}">${t.el}</b> Lv${t.lv + 1}${t.lv === 3 ? '（最大）' : ''}　威力 ${s.dmg}　射程 ${s.range.toFixed(1)}　${extra}</div>
      <div class="hint">${d.info}</div>
      <div class="row"><button id="b-up" ${up == null || g.money < up ? 'disabled' : ''}>${up == null ? '最大まで強化済み' : `強化 ${up}`}</button><button id="b-sell" class="sub">売却 +${sellValue(t)}</button></div>`;
    $('b-up').onclick = () => { if (upgrade(g, t)) { selKey = ''; refreshHud(); } };
    $('b-sell').onclick = () => { sell(g, t); selTower = null; selKey = ''; refreshHud(); };
  } else if (armed) {
    box.innerHTML = `<div class="head"><b class="g" style="color:${COLOR[armed]}">${armed}</b>　${TOWERS[armed].info}</div>
      <div class="hint">${BEATS[armed]}の敵に2倍。${selCell ? '' : '建てるマスをタップ'}</div>`;
  } else if (selCell) {
    box.innerHTML = '<div class="hint">建てたい字を、下の5つから選ぼう</div>';
  } else {
    box.innerHTML = '<div class="hint">マスをタップして、下の字で砲台を建てよう（砲台をタップすると強化・売却）</div>';
  }
}

// ---------- 操作 ----------
function tryBuild(el, c, r) {
  if (g.over) return;
  if (g.money < TOWERS[el].cost) { msg('資金が足りません'); return false; }
  const t = build(g, el, c, r);
  if (!t) { msg('そこには建てられません'); return false; }
  msg('');
  return t;
}
function onPalette(el) {
  if (talk || panelOpen || !g || g.over) return;
  if (selCell && !towerAt(g, selCell.c, selCell.r) && canBuild(g, selCell.c, selCell.r)) {
    const t = tryBuild(el, selCell.c, selCell.r);
    if (t) { selCell = null; selTower = t; armed = null; }
  } else {
    armed = armed === el ? null : el;
    selTower = null;
  }
  selKey = ''; refreshHud();
}
canvas.addEventListener('pointerdown', ev => {
  if (talk || panelOpen || !g) return;
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor((ev.clientX - rect.left) / rect.width * COLS), r = Math.floor((ev.clientY - rect.top) / rect.height * ROWS);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
  tapCell(c, r);
});
function tapCell(c, r) {
  const t = towerAt(g, c, r);
  msg('');
  if (t) { selTower = selTower === t ? null : t; selCell = null; armed = null; }
  else if (!canBuild(g, c, r)) { selTower = null; selCell = null; }
  else if (armed) { const nt = tryBuild(armed, c, r); if (nt) selTower = nt; }
  else { selCell = { c, r }; selTower = null; }
  selKey = ''; refreshHud();
}
$('btn-go').addEventListener('click', () => { if (g && startWave(g)) refreshHud(); });
$('btn-speed').addEventListener('click', () => { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; refreshHud(); });
$('btn-pause').addEventListener('click', () => { paused = !paused; refreshHud(); });
$('btn-retry').addEventListener('click', () => { if (g) startMap(mapIdx, false); });
$('btn-maps').addEventListener('click', showMaps);
addEventListener('keydown', ev => {
  if (ev.key === ' ' && talk) { ev.preventDefault(); advanceTalk(); }
  else if (ev.key === 'p') { paused = !paused; refreshHud(); }
});

// ---------- 会話 ----------
function showTalk(lines, done) {
  talk = { lines, i: 0, done };
  $('talk').hidden = false;
  renderTalk();
  refreshHud();
}
function renderTalk() {
  const [who, text] = talk.lines[talk.i];
  const w = WHO[who] || { name: '', color: '#cdd' };
  const ch = $('talk-ch');
  ch.textContent = who; ch.style.color = w.color; ch.style.borderColor = w.color;
  $('talk-name').textContent = w.name; $('talk-name').style.color = w.color;
  $('talk-text').textContent = text;
}
function advanceTalk() {
  if (!talk) return;
  if (++talk.i >= talk.lines.length) {
    const done = talk.done;
    talk = null; $('talk').hidden = true;
    refreshHud();
    if (done) done();
  } else renderTalk();
}
$('talk').addEventListener('click', advanceTalk);

// ---------- パネル（マップ選択・結果） ----------
function openPanel(title, sub, build) {
  panelOpen = true;
  $('panel').hidden = false;
  $('panel-title').innerHTML = title;
  $('panel-sub').innerHTML = sub;
  const body = $('panel-body');
  body.innerHTML = '';
  build(body);
  refreshHud();
}
function closePanel() { panelOpen = false; $('panel').hidden = true; refreshHud(); }
const starsText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
function showMaps() {
  openPanel('マップ選択', '3つの面。それぞれ10波、最後は大きな影！', body => {
    MAPS.forEach((m, i) => {
      const b = document.createElement('button');
      b.innerHTML = `${i + 1}. ${m.name}　<span class="stars">${starsText(save.stars[i])}</span>${save.stars[i] ? '　クリア済み' : ''}`;
      b.addEventListener('click', () => { closePanel(); startMap(i, true); });
      body.appendChild(b);
    });
    if (g && !g.over) {
      const b = document.createElement('button');
      b.className = 'sub'; b.textContent = '閉じる（続ける）';
      b.addEventListener('click', closePanel);
      body.appendChild(b);
    }
  });
}
function showResult() {
  const win = g.over === 'win';
  const next = mapIdx + 1 < MAPS.length;
  openPanel(win ? '字の都を守りきった！' : '都が影にのまれた…',
    win ? `<span class="stars" style="font-size:30px">${starsText(g.stars)}</span><br>残りライフ ${g.lives}/${g.maxLives}` : '砲台の配置や、属性の相性を見直そう',
    body => {
      const row = document.createElement('div'); row.className = 'row';
      const retry = document.createElement('button'); retry.textContent = 'もう一度';
      retry.addEventListener('click', () => { closePanel(); startMap(mapIdx, false); });
      row.appendChild(retry);
      if (win && next) {
        const nb = document.createElement('button'); nb.textContent = '次のマップへ';
        nb.addEventListener('click', () => { closePanel(); startMap(mapIdx + 1, true); });
        row.appendChild(nb);
      }
      body.appendChild(row);
      const m = document.createElement('button'); m.className = 'sub'; m.textContent = 'マップ選択';
      m.addEventListener('click', showMaps);
      body.appendChild(m);
    });
}

// ---------- 進行 ----------
function startMap(i, withIntro) {
  mapIdx = i;
  g = createGame(i);
  if (DEBUG) g.money = 9999;
  armed = null; selCell = null; selTower = null; selKey = ''; paused = false; talk = null; $('talk').hidden = true;
  banner.text = ''; $('banner').textContent = '';
  msg('');
  refreshHud();
  if (withIntro) showTalk(MAPS[i].intro, null);
}
function onEvent(ev) {
  if (ev.type === 'wave') bannerShow(ev.wave === WAVES ? '大きな影があらわれた！　削るたびに属性が変わる' : `第${ev.wave}波`);
  else if (ev.type === 'clear' && ev.wave < WAVES) bannerShow(`第${ev.wave}波クリア！`, 1.6);
  else if (ev.type === 'shrine') bannerShow(SHRINE_LINES[ev.n - 1], 3);
  else if (ev.type === 'leak') bannerShow(ev.boss ? '大きな影が都に着いた！' : '影が都に入り込んだ！', 1.2);
  else if (ev.type === 'win') {
    save.stars[mapIdx] = Math.max(save.stars[mapIdx], ev.stars); writeSave();
    showTalk(MAPS[mapIdx].outro, showResult);
  } else if (ev.type === 'lose') showResult();
}

// ---------- 描画 ----------
const px = v => v * CELL;
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawBoard() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const path = g.pathCells.has(`${c},${r}`);
    ctx.fillStyle = path ? '#5b4a3a' : (c + r) % 2 ? '#1f2a46' : '#1b2540';
    ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    if (path) { ctx.fillStyle = '#6e5b47'; ctx.fillRect(c * CELL + 6, r * CELL + 6, CELL - 12, CELL - 12); }
  }
  // 建てられるマスの目印（砲台を選んでいる間）
  if (armed) {
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (canBuild(g, c, r)) ctx.fillRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4);
  }
  // 出入口と都
  for (const p of g.paths) {
    const a = p.pts[0], b = p.pts[p.pts.length - 1];
    const clamp = (q) => ({ x: Math.min(COLS - 0.5, Math.max(0.5, q.x)), y: Math.min(ROWS - 0.5, Math.max(0.5, q.y)) });
    const s = clamp(a), e = clamp(b);
    ctx.fillStyle = 'rgba(176,92,255,.35)'; ctx.beginPath(); ctx.arc(px(s.x), px(s.y), 26, 0, 7); ctx.fill();
    drawGlyph('影', px(s.x), px(s.y), 34, '#b78bdc');
    ctx.fillStyle = 'rgba(255,224,120,.3)'; ctx.beginPath(); ctx.arc(px(e.x), px(e.y), 26, 0, 7); ctx.fill();
    drawGlyph('都', px(e.x), px(e.y), 34, '#ffe08a');
  }
}
function drawTower(t) {
  const x = px(t.x), y = px(t.y), col = COLOR[t.el], k = 1 + t.kick * 1.2;
  ctx.fillStyle = '#10162c'; rr(x - 27, y - 27, 54, 54, 12); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10 + t.lv * 3;
  drawGlyph(t.el, x, y - 1, 38 * k, col);
  ctx.restore();
  for (let i = 0; i <= t.lv; i++) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - t.lv * 4 + i * 8, y + 22, 2.4, 0, 7); ctx.fill(); }
}
function drawEnemy(e) {
  const x = px(e.x), y = px(e.y), el = enemyEl(e), col = COLOR[el];
  const R = e.boss ? 26 : 16 + (e.el === '闇' ? 2 : 0);
  const wob = Math.sin(clock * 8 + e.id) * 1.5;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y + R * .8, R * .9, R * .35, 0, 0, 7); ctx.fill();
  ctx.fillStyle = e.flash > 0 ? '#fff' : '#171024';
  ctx.beginPath(); ctx.ellipse(x, y + wob * .3, R, R * (1 + wob * .02), 0, 0, 7); ctx.fill();
  ctx.lineWidth = e.boss ? 4 : 2; ctx.strokeStyle = col; ctx.stroke();
  if (g.t < e.slowUntil) { ctx.fillStyle = 'rgba(63,160,255,.4)'; ctx.fill(); }
  if (g.t < e.vulnUntil) { ctx.strokeStyle = '#fff6c0'; ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  if (g.t < e.dotUntil) { ctx.fillStyle = COLOR.闇; for (let i = 0; i < 3; i++) { const a = clock * 4 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * R, y + Math.sin(a) * R * .8, 2.5, 0, 7); ctx.fill(); } }
  // 目
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - R * .35, y - R * .1, R * .18, 0, 7); ctx.arc(x + R * .35, y - R * .1, R * .18, 0, 7); ctx.fill();
  // 属性のしるし（頭の上の色付きの字）
  const my = y - R - 12, mr = e.boss ? 14 : 10;
  ctx.fillStyle = '#0c0f1e'; ctx.beginPath(); ctx.arc(x, my, mr, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
  drawGlyph(el, x, my, mr * 1.45, col);
  // HP
  const w = e.boss ? 56 : 28, hy = y + R + 4;
  ctx.fillStyle = '#000a'; ctx.fillRect(x - w / 2, hy, w, 4);
  ctx.fillStyle = e.boss ? '#ff5a7a' : '#6bdc7a'; ctx.fillRect(x - w / 2, hy, w * Math.max(0, e.hp / e.maxHp), 4);
  if (e.boss) { ctx.fillStyle = '#ffffff55'; for (let i = 1; i < 5; i++) ctx.fillRect(x - w / 2 + w * i / 5 - .5, hy, 1, 4); }
}
function drawShot(s) {
  const x = px(s.x), y = px(s.y);
  ctx.save();
  if (s.k === '火') { ctx.shadowColor = COLOR.火; ctx.shadowBlur = 14; ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(x, y, 8 + Math.sin(clock * 30) * 1.5, 0, 7); ctx.fill(); ctx.fillStyle = '#ff4d1a'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
  else if (s.k === '水') { ctx.shadowColor = COLOR.水; ctx.shadowBlur = 8; ctx.fillStyle = '#8ccaff'; ctx.beginPath(); ctx.ellipse(x, y, 5, 7, 0, 0, 7); ctx.fill(); }
  else { ctx.shadowColor = COLOR.闇; ctx.shadowBlur = 12; ctx.fillStyle = '#7a2fd0'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.strokeStyle = '#d9b0ff'; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();
}
function drawFx(f) {
  const p = Math.min(1, (g.t - f.t0) / f.ttl), a = 1 - p;
  ctx.save(); ctx.globalAlpha = a;
  if (f.k === 'boom') {
    const R = px(f.r) * (0.4 + p * 0.7);
    const gr = ctx.createRadialGradient(px(f.x), px(f.y), 2, px(f.x), px(f.y), R);
    gr.addColorStop(0, '#fff3c0'); gr.addColorStop(.5, '#ff8a2b'); gr.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px(f.x), px(f.y), R, 0, 7); ctx.fill();
  } else if (f.k === 'ripple') {
    ctx.strokeStyle = COLOR.水; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px(f.x), px(f.y), 8 + p * 22, 0, 7); ctx.stroke();
  } else if (f.k === 'bolt') {
    ctx.shadowColor = COLOR.雷; ctx.shadowBlur = 12; ctx.strokeStyle = '#fff7a0'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    f.pts.forEach((q, i) => {
      if (i === 0) { ctx.moveTo(px(q.x), px(q.y)); return; }
      const o = f.pts[i - 1], n = 5;
      for (let k = 1; k <= n; k++) {
        const u = k / n, j = k === n ? 0 : Math.sin((f.t0 * 97 + i * 13 + k * 7.3) * 3.1) * 9;
        ctx.lineTo(px(o.x + (q.x - o.x) * u) + j, px(o.y + (q.y - o.y) * u) - j);
      }
    });
    ctx.stroke();
  } else if (f.k === 'beam') {
    ctx.shadowColor = '#ffe9a0'; ctx.shadowBlur = 16;
    ctx.strokeStyle = '#fffbe8'; ctx.lineWidth = 10 * a + 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px(f.x), px(f.y)); ctx.lineTo(px(f.x2), px(f.y2)); ctx.stroke();
    ctx.strokeStyle = '#ffd86a'; ctx.lineWidth = 4 * a; ctx.stroke();
  } else if (f.k === 'curse') {
    ctx.fillStyle = COLOR.闇;
    for (let i = 0; i < 6; i++) { const an = i * 1.05 + p * 5, rd = 24 * (1 - p) + 4; ctx.beginPath(); ctx.arc(px(f.x) + Math.cos(an) * rd, px(f.y) + Math.sin(an) * rd, 3, 0, 7); ctx.fill(); }
  } else if (f.k === 'build') {
    ctx.strokeStyle = COLOR[f.el]; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(px(f.x), px(f.y), 20 + p * 34, 0, 7); ctx.stroke();
  } else if (f.k === 'die') {
    ctx.fillStyle = '#b78bdc';
    for (let i = 0; i < 7; i++) { const an = i * 0.9, rd = (f.boss ? 70 : 24) * p; ctx.beginPath(); ctx.arc(px(f.x) + Math.cos(an) * rd, px(f.y) + Math.sin(an) * rd, 4 * a + 1, 0, 7); ctx.fill(); }
  } else if (f.k === 'num') {
    ctx.font = `bold ${f.m > 1 ? 16 : 12}px sans-serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = f.m > 1 ? '#ffe033' : f.m < 1 ? '#9aa' : '#fff';
    const t = f.v + (f.m > 1 ? '!' : '');
    ctx.strokeText(t, px(f.x), px(f.y) - p * 22); ctx.fillText(t, px(f.x), px(f.y) - p * 22);
  } else if (f.k === 'coin') {
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffd54a';
    ctx.strokeText(`+${f.v}`, px(f.x), px(f.y) - 14 - p * 20); ctx.fillText(`+${f.v}`, px(f.x), px(f.y) - 14 - p * 20);
  }
  ctx.restore();
}
function drawRange(x, y, range, col) {
  ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px(x), px(y), px(range), 0, 7); ctx.fill(); ctx.stroke();
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (!g) return;
  drawBoard();
  if (selTower) {
    const s = towerStat(selTower);
    drawRange(selTower.x, selTower.y, s.range, COLOR[selTower.el]);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; rr(selTower.c * CELL + 3, selTower.r * CELL + 3, CELL - 6, CELL - 6, 12); ctx.stroke();
  }
  if (selCell) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.strokeRect(selCell.c * CELL + 3, selCell.r * CELL + 3, CELL - 6, CELL - 6); ctx.setLineDash([]);
  }
  g.towers.forEach(drawTower);
  [...g.enemies].sort((a, b) => a.y - b.y).forEach(drawEnemy);
  g.shots.forEach(drawShot);
  g.fx.forEach(drawFx);
  if (g.hitFlash > 0) { ctx.fillStyle = `rgba(255,40,60,${g.hitFlash * 0.5})`; ctx.fillRect(0, 0, SIZE, SIZE); }
}

// ---------- ループ ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now; clock += dt;
  if (g && !paused && !talk && !panelOpen) {
    acc += dt * speed;
    let n = 0;
    while (acc >= 1 / 60 && n++ < 400) { step(g, 1 / 60); acc -= 1 / 60; }
    if (n >= 400) acc = 0;
    for (const ev of g.events.splice(0)) onEvent(ev);
    refreshHud();
  }
  if (banner.text && clock > banner.until) { banner.text = ''; $('banner').textContent = ''; }
  draw();
  requestAnimationFrame(frame);
}

// ---------- 起動 ----------
async function loadFont() {
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(res.status);
    const buf = await res.arrayBuffer();
    font = opentype.parse(buf);
    try { const face = new FontFace('MojiBouei', buf.slice(0)); await face.load(); document.fonts.add(face); } catch { /* DOM 側は普通のフォントで代用 */ }
  } catch (e) {
    msg('フォントを読み込めなかったので、代わりの字体で表示します');
    console.warn(e);
  }
}
buildCycle(); buildShrines(); buildPalette();
await loadFont();
if (DEBUG) window.__bouei = {
  get g() { return g; }, tapCell, startMap, advanceTalk, onPalette, step: (n) => { for (let i = 0; i < n; i++) step(g, 1 / 60); for (const ev of g.events.splice(0)) onEvent(ev); refreshHud(); },
  setArmed: (el) => { armed = el; refreshHud(); },
};
requestAnimationFrame(frame);
showMaps();
