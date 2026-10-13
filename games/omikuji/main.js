import * as opentype from 'opentype';
import { FONT_URL } from '../../config.js';
import { glyphPolygons, centerPolygons } from '../../glyph.js';
import { KANJI, RANKS, RANK_NOTE } from './kanji.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'moji_omikuji.v1';
const SERIF = '"MojiUI", "Hiragino Mincho ProN", "Noto Serif JP", "Yu Mincho", serif';

// ---------- 日付 ----------
// 端末の日付。テスト用に ?date=2026-01-01 で差し替えられる（通常は使われない）
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}
const override = parseYmd(new URLSearchParams(location.search).get('date'));
const today = () => (override ? ymd(override) : ymd(new Date()));
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// ---------- 今日の字を決める（日付 + 好きな言葉 → 固定の計算） ----------
// FNV-1a ハッシュ。同じ日・同じ言葉なら必ず同じ結果になる
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function pickFor(date, wish) {
  const h = hash(`${date}|${wish.trim()}`);
  return { idx: h % KANJI.length, no: (h >>> 8) % 100 + 1 };
}

// ---------- 保存（localStorage）：引いた日 → 字 ----------
function loadLog() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    const log = {};
    for (const [d, v] of Object.entries((s && s.log) || {})) {
      if (parseYmd(d) && KANJI.some(k => k.c === v.c)) log[d] = { c: v.c, no: v.no | 0 };
    }
    return log;
  } catch { return {}; }
}
let log = loadLog();
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ log })); } catch { /* 保存できない環境でも遊べる */ }
}
const kanjiOf = c => KANJI.find(k => k.c === c);

// 連続日数：今日（まだなら昨日）から過去へ、引いた日が続く数
function streak() {
  const d = parseYmd(today());
  if (!log[ymd(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (log[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---------- フォント ----------
let font = null;
async function loadFont() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  font = opentype.parse(buf.slice(0));
  try { document.fonts.add(await new FontFace('MojiUI', buf).load()); } catch { /* 無くても system のフォントで表示される */ }
}
const polyCache = new Map();
function polysOf(ch) {
  if (!font) return null;
  if (!polyCache.has(ch)) {
    const polys = glyphPolygons(font, ch, 100);
    const size = centerPolygons(polys);
    polyCache.set(ch, { polys, size });
  }
  return polyCache.get(ch);
}

// 字を ctx の (cx, cy) を中心に、高さ・幅が box に収まるよう描く。輪郭が取れなければ文字として描く
function drawGlyph(ctx, ch, cx, cy, box, color) {
  ctx.fillStyle = color;
  const g = polysOf(ch);
  if (!g) {
    ctx.font = `900 ${box * 0.9}px ${SERIF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy);
    return;
  }
  const sc = box / Math.max(g.size.x, g.size.y, 1);
  const p = new Path2D();
  for (const { outer, holes } of g.polys) {
    for (const ring of [outer, ...holes]) {
      ring.forEach((q, i) => {
        const x = cx + q.x * sc, y = cy - q.y * sc; // 輪郭は y 上向き
        if (i) p.lineTo(x, y); else p.moveTo(x, y);
      });
      p.closePath();
    }
  }
  ctx.fill(p, 'evenodd');
}

// ---------- 墨で書かれるように現れる演出 ----------
let inkRaf = 0;
function inkReveal(canvas, ch) {
  cancelAnimationFrame(inkRaf);
  const W = canvas.width, H = canvas.height;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  drawGlyph(off.getContext('2d'), ch, W / 2, H / 2, W * 0.82, '#1f1b18');
  const ctx = canvas.getContext('2d');
  const t0 = performance.now(), DUR = 1800;
  const soft = H * 0.35;
  const frame = now => {
    const p = Math.min(1, (now - t0) / DUR);
    const e = 1 - Math.pow(1 - p, 2);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if ('filter' in ctx) ctx.filter = `blur(${((1 - e) * 5).toFixed(1)}px)`; // にじみ：だんだんくっきり
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    // 上から下へ筆が走るようにマスクする
    const edge = e * (H + soft) - soft;
    const grad = ctx.createLinearGradient(0, edge, 0, edge + soft);
    grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    if (p < 1) inkRaf = requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); ctx.drawImage(off, 0, 0); }
  };
  inkRaf = requestAnimationFrame(frame);
}

// ---------- 結果の表示 ----------
let current = null; // { k, no, date, practice }
function showResult(k, no, date, practice) {
  current = { k, no, date, practice };
  $('r-no').textContent = `第 ${no} 番　${date}`;
  $('r-fortune').textContent = RANKS[k.rank];
  $('r-note').textContent = RANK_NOTE[k.rank];
  $('r-yomi').textContent = k.yomi;
  $('r-strokes').textContent = `${k.strokes}画`;
  $('r-imi').textContent = k.imi;
  $('r-word').textContent = k.word;
  $('r-item').textContent = k.item;
  $('r-swatch').style.background = k.color;
  $('r-cname').textContent = k.colorName;
  $('r-practice').hidden = !practice;
  $('shrine').hidden = true;
  const r = $('result');
  r.hidden = false;
  // アニメを最初からやり直す
  const sc = r.querySelector('.scroll');
  sc.style.animation = 'none'; void sc.offsetWidth; sc.style.animation = '';
  inkReveal($('r-canvas'), k.c);
  renderStreak();
}
function backToShrine() {
  cancelAnimationFrame(inkRaf);
  $('result').hidden = true;
  $('shrine').hidden = false;
  $('stick').classList.remove('out');
  renderDrawButton();
}

// ---------- 筒をふる ----------
let busy = false;
function doDraw(practice) {
  if (busy) return;
  busy = true;
  const wish = $('wish').value;
  const date = today();
  let k, no;
  if (practice) {
    // 練習用：その場の乱数（日付で決まる字とは関係ない）
    const arr = new Uint32Array(2); crypto.getRandomValues(arr);
    k = KANJI[arr[0] % KANJI.length]; no = arr[1] % 100 + 1;
  } else {
    const p = pickFor(date, wish);
    k = KANJI[p.idx]; no = p.no;
  }
  $('stick-no').textContent = `第${no}番`;
  const tube = $('tube');
  tube.classList.remove('shake'); void tube.offsetWidth; tube.classList.add('shake');
  setTimeout(() => $('stick').classList.add('out'), 700);
  setTimeout(() => {
    if (!practice) {
      log[date] = { c: k.c, no };
      persist();
    }
    busy = false;
    showResult(k, no, date, practice);
  }, 1900);
}
function renderDrawButton() {
  const done = !!log[today()];
  $('btn-draw').textContent = done ? '今日の一字をもう一度見る' : 'おみくじをひく';
  $('draw-hint').textContent = done
    ? '今日はもう引いています。同じ日は同じ字が出ます'
    : '筒をドラッグしてふる・スマホをふる・ボタンをおす';
}
// 引いた日でも「見る」ときは、その日の記録を出す（好きな言葉を変えても記録は変わらない）
function onDrawPressed() {
  const rec = log[today()];
  if (rec) { doView(rec); return; }
  doDraw(false);
}
function doView(rec) {
  if (busy) return;
  const k = kanjiOf(rec.c);
  $('stick-no').textContent = `第${rec.no}番`;
  showResult(k, rec.no, today(), false);
}

// ドラッグでふる
(() => {
  const area = $('tube-area');
  let last = null, dist = 0;
  area.addEventListener('pointerdown', e => { last = [e.clientX, e.clientY]; dist = 0; area.setPointerCapture(e.pointerId); });
  area.addEventListener('pointermove', e => {
    if (!last) return;
    dist += Math.hypot(e.clientX - last[0], e.clientY - last[1]);
    last = [e.clientX, e.clientY];
    $('tube').style.transform = `rotate(${Math.sin(dist / 18) * 10}deg)`;
    if (dist > 500) { last = null; $('tube').style.transform = ''; onDrawPressed(); }
  });
  const end = () => { last = null; $('tube').style.transform = ''; };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
})();
// スマホをふる（iOS は許可が必要なので、最初のボタン操作で聞く）
let motionOn = false;
function enableMotion() {
  if (motionOn || typeof DeviceMotionEvent === 'undefined') return;
  const start = () => {
    motionOn = true;
    let lastShake = 0;
    addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      const now = Date.now();
      if (m > 28 && now - lastShake > 1500 && !$('shrine').hidden && !busy) { lastShake = now; onDrawPressed(); }
    });
  };
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then(r => { if (r === 'granted') start(); }).catch(() => {});
  } else start();
}
$('btn-draw').addEventListener('click', () => { enableMotion(); onDrawPressed(); });
$('btn-again').addEventListener('click', () => { backToShrine(); doDraw(true); });
$('btn-back').addEventListener('click', backToShrine);

// ---------- 画像で保存（canvas → PNG。どこにも送らない） ----------
function makeCardCanvas() {
  const { k, no, date, practice } = current;
  const W = 720, H = 1100;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#f7efdc'; x.fillRect(0, 0, W, H);
  // 和紙のざらざら
  for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(120,90,50,${Math.random() * 0.06})`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  x.strokeStyle = '#8d2a10'; x.lineWidth = 6; x.strokeRect(24, 24, W - 48, H - 48);
  x.lineWidth = 1.5; x.strokeRect(36, 36, W - 72, H - 72);
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#8d2a10'; x.font = `700 28px ${SERIF}`;
  x.fillText(`第 ${no} 番　　${date}`, W / 2, 96);
  drawGlyph(x, k.c, W / 2, 360, 400, '#1f1b18');
  x.fillStyle = '#c8451f'; x.font = `900 76px ${SERIF}`;
  x.fillText(RANKS[k.rank].split('').join(' '), W / 2, 640);
  x.fillStyle = '#2a2420'; x.font = `700 28px ${SERIF}`;
  x.fillText(`${k.yomi}　${k.strokes}画`, W / 2, 700);
  wrapText(x, k.word, W / 2, 770, 540, 44);
  x.font = `700 26px ${SERIF}`; x.textAlign = 'left';
  x.fillStyle = '#8d2a10'; x.fillText('ラッキーアイテム', 90, 930);
  x.fillStyle = '#2a2420'; x.fillText(k.item, 340, 930);
  x.fillStyle = '#8d2a10'; x.fillText('ラッキーカラー', 90, 984);
  x.fillStyle = k.color; x.beginPath(); x.arc(350, 976, 15, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#0003'; x.lineWidth = 1; x.stroke();
  x.fillStyle = '#2a2420'; x.fillText(k.colorName, 376, 984);
  x.textAlign = 'center'; x.fillStyle = '#7a6e60'; x.font = `500 20px ${SERIF}`;
  x.fillText(practice ? '今日の一字（練習）' : '文字バトル　今日の一字', W / 2, 1048);
  return c;
}
function wrapText(x, text, cx, y, maxW, lh) {
  x.font = `700 32px ${SERIF}`; x.textAlign = 'center'; x.fillStyle = '#2a2420';
  let line = '';
  for (const ch of text) {
    if (x.measureText(line + ch).width > maxW) { x.fillText(line, cx, y); y += lh; line = ch; } else line += ch;
  }
  if (line) x.fillText(line, cx, y);
}
$('btn-save').addEventListener('click', () => {
  if (!current) return;
  makeCardCanvas().toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ichiji-${current.date}-${current.k.c}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
});

// ---------- 連続日数 ----------
function renderStreak() {
  const n = streak(), el = $('streak');
  el.hidden = n < 1;
  el.textContent = n >= 2 ? `${n}日れんぞく！` : '1日め！';
}

// ---------- 図鑑 ----------
function renderDex() {
  const stat = {}; // 字 → { count, first, last }
  for (const [d, v] of Object.entries(log).sort()) {
    const s = stat[v.c] || (stat[v.c] = { count: 0, first: d, last: d });
    s.count++; s.last = d;
  }
  const got = Object.keys(stat).length;
  $('dex-count').textContent = `集めた字：${got} / ${KANJI.length}　（引いた日：${Object.keys(log).length}日）`;
  const grid = $('dex-grid'); grid.textContent = '';
  const mk = (k, s) => {
    const b = document.createElement('button');
    b.className = 'cell' + (s ? '' : ' empty');
    if (s) {
      b.innerHTML = `<span class="ch"></span><div class="rk"></div><div class="meta"></div>${s.count > 1 ? '<span class="cnt"></span>' : ''}`;
      b.querySelector('.ch').textContent = k.c;
      b.querySelector('.rk').textContent = RANKS[k.rank];
      b.querySelector('.meta').textContent = s.first.slice(5).replace('-', '/');
      if (s.count > 1) b.querySelector('.cnt').textContent = `×${s.count}`;
      b.addEventListener('click', () => showDetail(k, s.first));
    } else {
      b.innerHTML = '<span class="ch">？</span>'; b.disabled = true;
    }
    return b;
  };
  // 引いた字（新しい順）→ まだの字
  const have = KANJI.filter(k => stat[k.c]).sort((a, b) => stat[b.c].last.localeCompare(stat[a.c].last));
  for (const k of have) grid.appendChild(mk(k, stat[k.c]));
  for (const k of KANJI) if (!stat[k.c]) grid.appendChild(mk(k, null));
}
function showDetail(k, date) {
  const body = $('detail-body'); body.textContent = '';
  const add = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = txt; body.appendChild(e); return e; };
  add('div', 'big', k.c);
  add('div', '', `${RANKS[k.rank]}　${date ? date + ' に引いた' : ''}`).style.color = '#c8451f';
  add('p', '', `読み：${k.yomi}　／　${k.strokes}画`);
  add('p', '', `意味：${k.imi}`);
  add('p', '', k.word);
  add('p', '', `ラッキーアイテム：${k.item}　／　ラッキーカラー：${k.colorName}`);
  $('detail').hidden = false;
}
$('detail-close').addEventListener('click', () => { $('detail').hidden = true; });
$('detail').addEventListener('click', e => { if (e.target === $('detail')) $('detail').hidden = true; });

// ---------- こよみ ----------
let calY, calM;
function renderCal() {
  $('cal-title').textContent = `${calY}年 ${calM + 1}月`;
  const g = $('cal-grid'); g.textContent = '';
  for (const w of WEEK) { const d = document.createElement('div'); d.className = 'dow'; d.textContent = w; g.appendChild(d); }
  const first = new Date(calY, calM, 1).getDay();
  const days = new Date(calY, calM + 1, 0).getDate();
  for (let i = 0; i < first; i++) { const d = document.createElement('div'); d.className = 'day blank'; g.appendChild(d); }
  for (let n = 1; n <= days; n++) {
    const date = `${calY}-${pad(calM + 1)}-${pad(n)}`;
    const rec = log[date];
    const b = document.createElement('button');
    b.className = 'day' + (rec ? ' got' : '') + (date === today() ? ' today' : '');
    b.innerHTML = '<span class="d"></span><span class="c"></span>';
    b.querySelector('.d').textContent = n;
    if (rec) {
      const k = kanjiOf(rec.c);
      b.querySelector('.c').textContent = k.c;
      b.title = `${date} ${k.c} ${RANKS[k.rank]}`;
      b.addEventListener('click', () => showDetail(k, date));
    } else b.disabled = true;
    g.appendChild(b);
  }
}
$('cal-prev').addEventListener('click', () => { if (--calM < 0) { calM = 11; calY--; } renderCal(); });
$('cal-next').addEventListener('click', () => { if (++calM > 11) { calM = 0; calY++; } renderCal(); });

// ---------- タブ ----------
function setTab(name) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of ['draw', 'dex', 'cal']) $('tab-' + t).hidden = t !== name;
  if (name === 'dex') renderDex();
  if (name === 'cal') renderCal();
}
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

// ---------- 起動 ----------
function init() {
  const t = parseYmd(today());
  calY = t.getFullYear(); calM = t.getMonth();
  $('date-label').textContent = `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日（${WEEK[t.getDay()]}）` + (override ? ' ※日付を差し替え中' : '');
  renderDrawButton();
  renderStreak();
}
init();
loadFont().catch(e => {
  console.warn('フォントを読み込めませんでした', e);
  const w = $('font-warn');
  w.hidden = false;
  w.textContent = 'フォントを読み込めなかったので、ふつうの文字で表示します（ネットにつながると墨の字になります）。';
});
