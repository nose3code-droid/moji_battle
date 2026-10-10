// 五属性リズム：火・水・雷・光・闇の5レーンで遊ぶリズムゲーム（Canvas 2D + WebAudio）
import { FONT_URL } from '../../config.js';
import { LANES, SONGS, LEAD_BEATS, buildChart } from './chart.js';
import { createAudio } from './audio.js';

const W = 600, H = 900;            // 内部解像度
const LANE_X0 = 20, LW = 112;      // レーンの左端と幅（5本で 560）
const JY = 730, TOP = 90;          // 判定ラインと出現位置の y
const PERFECT_W = 0.07, GOOD_W = 0.14, TAIL_W = 0.15;
const HOLD_RETRIG = 0.2;
const FONT = '"NotoJPRhythm","Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo","WenQuanYi Zen Hei",sans-serif';
const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d');
const SCALE = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * SCALE; canvas.height = H * SCALE;
ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

const laneCx = l => LANE_X0 + LW * l + LW / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- セーブ ----------
const SAVE_KEY = 'moji_rhythm.save';
function loadSave() {
  const base = { best: {}, calib: 0 };
  try { return { ...base, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch { return base; }
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } }
const save = loadSave();

// ---------- フォント（取得できなければ端末のフォントで代用） ----------
let fontReady = false;
(async () => {
  try {
    const f = new FontFace('NotoJPRhythm', `url(${FONT_URL})`, { weight: '700' });
    await Promise.race([f.load(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    document.fonts.add(f);
    fontReady = true;
  } catch (e) { console.warn('フォントを取得できませんでした。代用フォントで表示します', e.message); }
})();

// ---------- 状態 ----------
const G = {
  mode: 'menu',         // menu | talk | play | result | calib
  song: null, songIdx: 0, chart: null, byLane: [], ptr: [0, 0, 0, 0, 0],
  t0: 0, down: [false, false, false, false, false], hold: [null, null, null, null, null],
  score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, judged: 0,
  lane: LANES.map(() => ({ p: 0, g: 0, m: 0 })),
  pops: [], fx: [], flash: [0, 0, 0, 0, 0], lastDiff: 0, backIdx: 0, back: [], ended: false,
};
let audio = null;
const calib = () => save.calib / 1000;
const songTime = () => (performance.now() - G.t0) / 1000;

function ensureAudio() {
  if (!audio) {
    try { audio = createAudio(); } catch (e) { console.warn('音声を初期化できませんでした', e); audio = { dummy: true }; }
  }
  if (audio.resume) audio.resume().catch(() => {});
}

// ---------- 楽器の鳴らし分け ----------
// 曲時間 st に鳴らす（now のときは即時）。戻り値は長押しの停止ハンドル
function laneSound(lane, pitchIdx, vol = 1) {
  if (!audio || audio.dummy) return null;
  const t = Math.max(0, audio.now) + 0.005, sc = G.song ? G.song.scale : [261.63, 293.66, 329.63, 392, 440];
  const f = sc[pitchIdx % sc.length];
  const I = audio.inst;
  switch (lane) {
    case 0: return I.fire(t, vol);
    case 1: return I.water(t, f, vol);
    case 2: return I.thunder(t, f * 2, vol);
    case 3: return I.light(t, f * 2, vol);
    default: return I.dark(t, f / 2, vol);
  }
}

// ---------- 伴奏の予定表 ----------
function buildBacking(song, chart) {
  const ev = [], spb = chart.spb;
  for (let h = 0; h <= chart.endBeat * 2; h++) {
    const beat = h / 2, t = beat * spb;
    if (beat < LEAD_BEATS) { if (h % 2 === 0) ev.push({ t, k: 'tick', f: beat === 0 ? 1600 : 1100 }); continue; }
    const b = beat - LEAD_BEATS, bar = Math.floor(b / 4);
    if (h % 2 === 0) {
      ev.push({ t, k: 'kick', v: b % 4 === 0 ? 1 : 0.7 });
      if (b % 2 === 0) ev.push({ t, k: 'bass', f: song.bass[Math.floor(bar / 2) % song.bass.length] });
    } else ev.push({ t, k: 'hat', v: 0.7 });
    if (b % 4 === 3.5) ev.push({ t, k: 'bass', f: song.bass[Math.floor(bar / 2) % song.bass.length] * 1.5, d: 0.2 });
  }
  return ev;
}
setInterval(() => {
  if (G.mode !== 'play' || !audio || audio.dummy) return;
  const st = songTime(), until = st + 0.25;
  while (G.backIdx < G.back.length && G.back[G.backIdx].t <= until) {
    const e = G.back[G.backIdx++];
    if (e.t < st - 0.05) continue;
    const at = Math.max(audio.now, audio.now + (e.t - st)), B = audio.back;
    if (e.k === 'kick') B.kick(at, e.v); else if (e.k === 'hat') B.hat(at, e.v);
    else if (e.k === 'bass') B.bass(at, e.f, e.d || 0.4); else B.tick(at, e.f);
  }
}, 30);

// ---------- 画面切り替え ----------
function show(mode) {
  G.mode = mode;
  $('menu').hidden = mode !== 'menu';
  $('talk').hidden = mode !== 'talk';
  $('result').hidden = mode !== 'result';
  $('calib-box').hidden = mode !== 'calib';
  $('btn-quit').hidden = mode !== 'play';
}

// ---------- メニュー ----------
function renderMenu() {
  $('songs').innerHTML = '';
  SONGS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'song';
    const best = save.best[s.id];
    b.innerHTML = `<span class="lv">${s.level}</span><span class="nm">${s.name}</span><span class="bs">BPM ${s.bpm}<br>${best ? `${best.score}<b>${best.rank}</b>` : '未プレイ'}</span>`;
    b.onclick = () => { ensureAudio(); G.retry = false; startSong(i, true); };
    $('songs').appendChild(b);
  });
  $('calib').value = save.calib;
  $('calib-val').textContent = save.calib;
  show('menu');
}
$('calib').oninput = e => { save.calib = Number(e.target.value); $('calib-val').textContent = save.calib; writeSave(); };

// ---------- 会話 ----------
let talkLines = [], talkDone = null;
function startTalk(lines, done) {
  talkLines = lines.slice(); talkDone = done; nextTalk(); show('talk');
}
function nextTalk() {
  const l = talkLines.shift();
  if (!l) { const d = talkDone; talkDone = null; d && d(); return; }
  const lane = LANES.find(x => x.ch === l.who);
  $('talk-ch').textContent = l.who;
  $('talk-ch').style.color = lane ? lane.color : '#fff';
  $('talk-name').textContent = l.name;
  $('talk-text').textContent = l.text;
}
$('talk').addEventListener('pointerdown', e => { e.preventDefault(); nextTalk(); });

// ---------- 曲の開始・終了 ----------
function startSong(i, withTalk) {
  const song = SONGS[i];
  if (withTalk) startTalk(song.talkBefore, () => beginPlay(i));
  else beginPlay(i);
}
function beginPlay(i) {
  ensureAudio();
  const song = SONGS[i], chart = buildChart(song);
  Object.assign(G, {
    song, songIdx: i, chart, ptr: [0, 0, 0, 0, 0], down: [false, false, false, false, false], hold: [null, null, null, null, null],
    score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, judged: 0, lane: LANES.map(() => ({ p: 0, g: 0, m: 0 })),
    pops: [], fx: [], flash: [0, 0, 0, 0, 0], lastDiff: 0, backIdx: 0, ended: false, talkAfterShown: false,
  });
  G.byLane = LANES.map((_, l) => chart.notes.filter(n => n.lane === l));
  G.back = buildBacking(song, chart);
  G.t0 = performance.now();
  document.querySelectorAll('.pad').forEach(p => p.classList.remove('down'));
  show('play');
}
function quitToMenu() {
  releaseAll();
  renderMenu();
}
$('btn-quit').onclick = quitToMenu;

function finish() {
  if (G.ended) return; G.ended = true;
  releaseAll();
  const acc = accuracy(), rank = rankOf(acc);
  const prev = save.best[G.song.id];
  const isNew = !prev || G.score > prev.score;
  if (isNew) save.best[G.song.id] = { score: G.score, rank, acc };
  writeSave();
  const showResult = () => {
    $('res-song').textContent = `${G.song.level}　${G.song.name}`;
    const r = $('res-rank'); r.textContent = rank; r.style.color = { S: '#ffe14d', A: '#ff8a4a', B: '#6fb0ff', C: '#b0a0d0' }[rank];
    $('res-new').hidden = !isNew;
    $('res-stats').innerHTML = `精度 <b>${(acc * 100).toFixed(1)}%</b>　最大コンボ <b>${G.maxCombo}</b><br>スコア <b>${G.score}</b>　PERFECT ${G.perfect} / GOOD ${G.good} / MISS ${G.miss}`;
    $('res-lanes').innerHTML = LANES.map((L, l) => {
      const s = G.lane[l], tot = s.p + s.g + s.m, a = tot ? (s.p + s.g * 0.6) / tot : 0;
      return `<div class="lrow"><i style="color:${L.color}">${L.ch}</i><div class="bar"><span style="width:${a * 100}%;background:${L.color}"></span></div><span>${(a * 100).toFixed(0)}%　${s.p}/${s.g}/${s.m}</span></div>`;
    }).join('');
    $('btn-next').hidden = G.songIdx >= SONGS.length - 1;
    show('result');
  };
  if (G.retry) showResult(); else startTalk(G.song.talkAfter, showResult);
}
function accuracy() { return G.chart.total ? (G.perfect + G.good * 0.6) / G.chart.total : 0; }
const rankOf = a => (a >= 0.95 ? 'S' : a >= 0.85 ? 'A' : a >= 0.7 ? 'B' : 'C');

$('btn-retry').onclick = () => { G.retry = true; beginPlay(G.songIdx); };
$('btn-next').onclick = () => { G.retry = false; startSong(G.songIdx + 1, true); };
$('btn-menu').onclick = () => { G.retry = false; renderMenu(); };

// ---------- 判定 ----------
function judge(lane, kind, diff) {
  const s = G.lane[lane];
  if (kind === 'MISS') { G.combo = 0; G.miss++; s.m++; }
  else {
    G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
    if (kind === 'PERFECT') { G.perfect++; s.p++; G.score += 1000; } else { G.good++; s.g++; G.score += 600; }
    G.score += Math.min(G.combo, 50) * 10;
  }
  G.judged++;
  G.pops.push({ lane, kind, diff, age: 0 });
  if (kind !== 'MISS') { spawnFx(lane, kind === 'PERFECT'); G.flash[lane] = 1; }
  if (kind !== 'MISS' && diff !== null) G.lastDiff = diff;
}

function press(lane, stamp) {
  if (G.mode === 'calib') return calibTap(stamp);
  if (G.mode !== 'play' || G.down[lane]) return;
  G.down[lane] = true;
  document.querySelector(`.pad[data-lane="${lane}"]`).classList.add('down');
  const j = songTime() - calib();
  const arr = G.byLane[lane], n = arr[G.ptr[lane]];
  const hit = n && n.t - j <= GOOD_W;
  const handle = laneSound(lane, hit ? n.idx : (n ? n.idx : 0));   // 空打ちでも音は鳴る
  if (!hit) return;
  G.ptr[lane]++;
  const d = j - n.t, kind = Math.abs(d) <= PERFECT_W ? 'PERFECT' : 'GOOD';
  judge(lane, kind, d);
  if (n.hold) { n.state = 1; G.hold[lane] = { note: n, voice: handle, fx: 0 }; } else n.state = 2;
}
function release(lane) {
  if (!G.down[lane]) return;
  G.down[lane] = false;
  const p = document.querySelector(`.pad[data-lane="${lane}"]`); if (p) p.classList.remove('down');
  const h = G.hold[lane];
  if (G.mode !== 'play' || !h) return;
  const j = songTime() - calib();
  G.hold[lane] = null;
  h.note.state = 2;
  if (h.voice) h.voice.stop();
  judge(lane, j >= h.note.end - TAIL_W ? 'PERFECT' : 'MISS', null);
}
function releaseAll() {
  for (let l = 0; l < 5; l++) {
    const h = G.hold[l];
    if (h && h.voice) h.voice.stop();
    G.hold[l] = null; G.down[l] = false;
  }
  document.querySelectorAll('.pad').forEach(p => p.classList.remove('down'));
}

function update() {
  if (G.mode !== 'play') return;
  const t = songTime(), j = t - calib();
  for (let l = 0; l < 5; l++) {
    const arr = G.byLane[l];
    while (G.ptr[l] < arr.length && j - arr[G.ptr[l]].t > GOOD_W) {
      const n = arr[G.ptr[l]++]; n.state = 2;
      judge(l, 'MISS', null);
      if (n.hold) judge(l, 'MISS', null);   // 頭を逃したロングは尻尾も失敗
    }
    const h = G.hold[l];
    if (h) {
      if (j >= h.note.end) {       // 最後まで押し続けた
        G.hold[l] = null; h.note.state = 2;
        if (h.voice) h.voice.stop(audio.now + 0.02);
        judge(l, 'PERFECT', null);
      } else if (t - h.fx > HOLD_RETRIG) { h.fx = t; G.fx.push({ type: 'water', lane: l, age: 0, life: 0.6, big: false }); }
    }
  }
  if (t > G.chart.endTime) finish();
}

// ---------- 入力 ----------
const KEYS = Object.fromEntries(LANES.map((L, i) => [L.code, i]));
addEventListener('keydown', e => {
  if (e.code === 'Escape' && G.mode === 'play') return quitToMenu();
  if ((e.code === 'Space' || e.code === 'Enter') && G.mode === 'talk') { e.preventDefault(); return nextTalk(); }
  const l = KEYS[e.code];
  if (l === undefined || e.repeat) return;
  e.preventDefault();
  if (G.mode === 'calib') return calibTap(performance.now());
  press(l);
});
addEventListener('keyup', e => { const l = KEYS[e.code]; if (l !== undefined) release(l); });
document.querySelectorAll('.pad').forEach(p => {
  const l = Number(p.dataset.lane);
  p.addEventListener('pointerdown', e => { e.preventDefault(); p.setPointerCapture(e.pointerId); press(l); });
  const up = e => { e.preventDefault(); release(l); };
  p.addEventListener('pointerup', up); p.addEventListener('pointercancel', up);
  p.addEventListener('contextmenu', e => e.preventDefault());
});
// キャンバスのレーンを直接タップしてもよい（マルチタッチ対応）
const touchLane = new Map();
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
  const l = clamp(Math.floor((x - LANE_X0) / LW), 0, 4);
  touchLane.set(e.pointerId, l); press(l);
});
const cup = e => { const l = touchLane.get(e.pointerId); touchLane.delete(e.pointerId); if (l !== undefined) release(l); };
canvas.addEventListener('pointerup', cup); canvas.addEventListener('pointercancel', cup);
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play') quitToMenu(); });

// ---------- 自動調整（キャリブレーション） ----------
const CAL = { on: false, start: 0, taps: [], timer: 0 };
$('btn-auto').onclick = () => {
  ensureAudio();
  CAL.on = true; CAL.taps = []; show('calib');
  $('calib-msg').textContent = 'カチッという音に合わせて、タップ（キー・画面）を8回。';
  CAL.start = performance.now() + 1200;
  for (let k = 0; k < 8; k++) if (audio && !audio.dummy) audio.back.tick(audio.now + 1.2 + k * 0.6, 1400);
  CAL.timer = setTimeout(calibEnd, 1200 + 8 * 600 + 400);
};
function calibTap(stamp) {
  if (!CAL.on) return;
  const now = stamp || performance.now();
  const k = Math.round((now - CAL.start) / 600);
  if (k < 0 || k > 7) return;
  CAL.taps.push(now - CAL.start - k * 600);
  if (audio && !audio.dummy) audio.inst.light(audio.now, 1318, 0.5);
}
function calibEnd() {
  CAL.on = false;
  if (CAL.taps.length >= 3) {
    const s = CAL.taps.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
    save.calib = clamp(Math.round(med / 5) * 5, -200, 200); writeSave();
  }
  renderMenu();
}
$('calib-cancel').onclick = () => { clearTimeout(CAL.timer); CAL.on = false; renderMenu(); };

// ---------- エフェクト ----------
function spawnFx(lane, big) {
  const x = laneCx(lane);
  switch (lane) {
    case 0: for (let i = 0; i < (big ? 14 : 8); i++) G.fx.push({ type: 'spark', lane, x, y: JY, vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 260, age: 0, life: 0.5 + Math.random() * 0.3 }); break;
    case 1: G.fx.push({ type: 'water', lane, age: 0, life: 0.65, big }); break;
    case 2: { const pts = []; let px = x + (Math.random() - 0.5) * 30; for (let y = 0; y <= JY; y += 40) { pts.push([px, y]); px += (Math.random() - 0.5) * 50; } pts[pts.length - 1][0] = x; G.fx.push({ type: 'bolt', lane, pts, age: 0, life: 0.22 }); break; }
    case 3: G.fx.push({ type: 'star', lane, age: 0, life: 0.55, rot: Math.random() * 3 }); break;
    default: G.fx.push({ type: 'void', lane, age: 0, life: 0.65 });
  }
}

// ---------- 描画 ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function glyph(ch, x, y, size, color, stroke) {
  ctx.font = `bold ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = 4; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(ch, x, y); }
  ctx.fillStyle = color; ctx.fillText(ch, x, y);
}
const yOf = (nt, st, lane) => JY - (nt - st) / LANES[lane].fall * (JY - TOP);

function drawBackground(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0c1c'); g.addColorStop(1, '#171233');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const beat = G.chart ? t / G.chart.spb : 0, pulse = G.mode === 'play' ? 1 - (beat % 1) : 0;
  for (let l = 0; l < 5; l++) {
    const L = LANES[l], x = LANE_X0 + l * LW;
    const lg = ctx.createLinearGradient(0, TOP, 0, JY);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, hexA(L.color, 0.10 + pulse * 0.05));
    ctx.fillStyle = lg; ctx.fillRect(x, TOP, LW, JY - TOP);
    ctx.strokeStyle = hexA(L.color, 0.28); ctx.lineWidth = 2; ctx.strokeRect(x, TOP, LW, JY - TOP + 160);
    if (G.down[l]) { const pg = ctx.createLinearGradient(0, JY - 300, 0, JY); pg.addColorStop(0, 'rgba(0,0,0,0)'); pg.addColorStop(1, hexA(L.color, 0.45)); ctx.fillStyle = pg; ctx.fillRect(x, JY - 300, LW, 300); }
  }
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawJudgeLine(t) {
  for (let l = 0; l < 5; l++) {
    const L = LANES[l], x = laneCx(l);
    const f = G.flash[l]; G.flash[l] = Math.max(0, f - 0.06);
    // 判定ライン
    ctx.strokeStyle = hexA(L.color, 0.9); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(LANE_X0 + l * LW + 4, JY); ctx.lineTo(LANE_X0 + (l + 1) * LW - 4, JY); ctx.stroke();
    // ラベル（5つの漢字）
    ctx.save();
    ctx.shadowColor = L.color; ctx.shadowBlur = 10 + f * 30;
    glyph(L.ch, x, JY + 70, 64 + f * 10, G.down[l] ? '#fff' : L.color, '#0b0d18');
    ctx.restore();
    ctx.font = `12px ${FONT}`; ctx.fillStyle = '#99a'; ctx.textAlign = 'center';
    ctx.fillText(`${L.key}　${L.gimmick}`, x, JY + 124);
    // 光のガイド：近づくと判定ラインが先に光る
    if (l === 3 && G.mode === 'play') {
      const n = G.byLane[3][G.ptr[3]];
      if (n && n.t - t < 2.7 && n.t - t > -0.1) {
        const k = 1 - Math.abs(n.t - t) / 2.7;
        ctx.save(); ctx.globalAlpha = 0.3 + 0.5 * k; ctx.shadowColor = '#fff'; ctx.shadowBlur = 18;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 + k * 4;
        ctx.beginPath(); ctx.arc(x, JY, 30 + (1 - k) * 18, 0, 6.3); ctx.stroke(); ctx.restore();
      }
    }
  }
}

function drawTile(n, y, alpha, lane, held) {
  const L = LANES[lane], x = laneCx(lane), w = 96, h = 62;
  ctx.save(); ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  g.addColorStop(0, L.light); g.addColorStop(1, L.color);
  ctx.shadowColor = L.color; ctx.shadowBlur = lane === 4 ? 16 : 12;
  ctx.fillStyle = g; roundRect(x - w / 2, y - h / 2, w, h, 14); ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = held ? '#fff' : 'rgba(255,255,255,.7)'; ctx.stroke();
  glyph(L.ch, x, y + 2, 44, lane === 2 || lane === 3 ? '#3a2a00' : '#fff', lane === 2 || lane === 3 ? '#fffbe0' : 'rgba(0,0,0,.55)');
  ctx.restore();
}

function drawNotes(t) {
  for (let l = 0; l < 5; l++) {
    const L = LANES[l], x = laneCx(l), arr = G.byLane[l];
    for (let i = Math.max(0, G.ptr[l] - 1); i < arr.length; i++) {
      const n = arr[i];
      if (n.t - t > L.fall + 0.05) break;
      if (n.state === 2) continue;
      const holding = n.state === 1;
      const yHead = holding ? JY : yOf(n.t, t, l);
      // 水：ロングの帯
      if (n.hold) {
        const yTail = yOf(n.end, t, l);
        const top = Math.max(TOP - 40, yTail);
        ctx.save(); ctx.globalAlpha = holding ? 0.95 : 0.65;
        const g = ctx.createLinearGradient(0, top, 0, yHead); g.addColorStop(0, hexA(L.color, 0.3)); g.addColorStop(1, hexA(L.light, 0.9));
        ctx.fillStyle = g; roundRect(x - 22, top, 44, Math.max(8, yHead - top), 16); ctx.fill();
        ctx.strokeStyle = '#d9ecff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
      // 火：連打のつながり
      if (l === 0 && n.grp && n.gi < n.gn - 1) {
        const nx = arr[i + 1];
        if (nx && nx.grp === n.grp) {
          ctx.save(); ctx.strokeStyle = hexA('#ff9a40', 0.6); ctx.lineWidth = 16; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x, yHead); ctx.lineTo(x, yOf(nx.t, t, 0)); ctx.stroke(); ctx.restore();
        }
      }
      // 光：ガイド線（判定ラインまで光の筋）
      if (l === 3) {
        const k = clamp(1 - (n.t - t) / L.fall, 0, 1);
        ctx.save(); ctx.globalAlpha = 0.35 + 0.4 * k; ctx.shadowColor = '#fff'; ctx.shadowBlur = 12;
        ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(x, yHead); ctx.lineTo(x, JY); ctx.stroke(); ctx.restore();
      }
      // 闇：直前まで見えにくい
      let alpha = 1;
      if (l === 4) {
        const r = n.t - t;
        alpha = clamp((0.62 - r) / 0.25, 0.05, 1);
      }
      if (yHead > TOP - 40 && yHead < H) drawTile(n, yHead, alpha, l, holding);
      // 火の連打：残り回数
      if (l === 0 && n.grp && n.gi === 0) {
        glyph(`×${n.gn}`, x + 38, yHead - 30, 16, '#fff', '#7a1a05');
      }
    }
  }
}

function drawFx(dt) {
  for (const f of G.fx) {
    f.age += dt; const p = f.age / f.life; if (p >= 1) continue;
    const L = LANES[f.lane], x = laneCx(f.lane);
    ctx.save();
    switch (f.type) {
      case 'spark': {
        f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 520 * dt;
        ctx.globalAlpha = 1 - p; ctx.fillStyle = p < 0.5 ? '#ffd27a' : '#ff4a1a';
        ctx.beginPath(); ctx.arc(f.x, f.y, 6 * (1 - p) + 1, 0, 6.3); ctx.fill(); break;
      }
      case 'water': {
        ctx.globalAlpha = (1 - p) * 0.9; ctx.strokeStyle = '#9cc8ff'; ctx.lineWidth = 5 * (1 - p) + 1;
        for (let k = 0; k < (f.big ? 3 : 2); k++) { const q = clamp(p * 1.4 - k * 0.2, 0, 1); ctx.beginPath(); ctx.ellipse(x, JY, 20 + q * 70, 8 + q * 22, 0, 0, 6.3); ctx.stroke(); }
        break;
      }
      case 'bolt': {
        ctx.globalAlpha = 1 - p; ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 24; ctx.strokeStyle = '#fffbd0'; ctx.lineWidth = 6 * (1 - p) + 2;
        ctx.beginPath(); f.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
        ctx.fillStyle = hexA('#ffe14d', 0.25 * (1 - p)); ctx.fillRect(LANE_X0 + f.lane * LW, TOP, LW, JY - TOP);
        break;
      }
      case 'star': {
        ctx.globalAlpha = 1 - p; ctx.translate(x, JY); ctx.rotate(f.rot + p);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 90); rg.addColorStop(0, 'rgba(255,255,255,.9)'); rg.addColorStop(1, 'rgba(255,231,160,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 90 * (0.4 + p), 0, 6.3); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        for (let k = 0; k < 8; k++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(30 + p * 90, 0); ctx.stroke(); }
        break;
      }
      default: { // void：紫の輪が内側に吸い込まれる
        ctx.globalAlpha = 1 - p * 0.6; ctx.shadowColor = '#a24bff'; ctx.shadowBlur = 20; ctx.strokeStyle = '#d7a8ff';
        for (let k = 0; k < 2; k++) { const q = clamp(p + k * 0.25, 0, 1); ctx.lineWidth = 6 * (1 - q) + 1; ctx.beginPath(); ctx.arc(x, JY, 80 * (1 - q), 0, 6.3); ctx.stroke(); }
        ctx.fillStyle = hexA('#2a0050', 0.7 * (1 - p)); ctx.beginPath(); ctx.arc(x, JY, 40 * (1 - p) + 6, 0, 6.3); ctx.fill();
      }
    }
    ctx.restore();
  }
  G.fx = G.fx.filter(f => f.age < f.life);
}

function drawHud(t) {
  ctx.textAlign = 'left'; ctx.font = `bold 22px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(String(G.score).padStart(7, '0'), 22, 30);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffe7a0';
  ctx.fillText(`${(G.judged ? (G.perfect + G.good * 0.6) / G.judged * 100 : 100).toFixed(1)}%`, W - 22, 30);
  if (G.combo >= 2) { ctx.textAlign = 'center'; glyph(String(G.combo), W / 2, 40, 46, '#fff', '#3a2a70'); glyph('COMBO', W / 2, 74, 14, '#cbbcff'); }
  // 判定の文字
  const cols = { PERFECT: '#ffe14d', GOOD: '#7fe3ff', MISS: '#ff5a7a' };
  for (const p of G.pops) {
    p.age += 1 / 60; const k = p.age / 0.5; if (k >= 1) continue;
    ctx.save(); ctx.globalAlpha = 1 - k; ctx.textAlign = 'center';
    const lab = p.kind + (p.diff !== null && p.kind !== 'PERFECT' ? (p.diff < 0 ? ' 早' : ' 遅') : '');
    glyph(lab, laneCx(p.lane), JY - 50 - k * 26, p.kind === 'MISS' ? 17 : 19, cols[p.kind], '#0b0d18');
    ctx.restore();
  }
  G.pops = G.pops.filter(p => p.age < 0.5);
  // カウントイン
  if (t < G.chart.spb * LEAD_BEATS) {
    const left = LEAD_BEATS - Math.floor(t / G.chart.spb);
    glyph(String(left), W / 2, 330, 120, 'rgba(255,255,255,.85)', '#3a2a70');
    glyph(`${G.song.level}　${G.song.name}`, W / 2, 420, 22, '#ffe7a0', '#0b0d18');
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update();
  const t = G.mode === 'play' ? songTime() : 0;
  drawBackground(t);
  if (G.chart && G.mode === 'play') {
    drawNotes(t); drawJudgeLine(t); drawFx(dt); drawHud(t);
  } else {
    drawJudgeLine(0); drawFx(dt);
  }
  requestAnimationFrame(frame);
}

renderMenu();
requestAnimationFrame(frame);

if (params.has('test')) window.__rhythm = { G, press, release, songTime, startSong: i => { ensureAudio(); G.retry = true; beginPlay(i); }, LANES, SONGS };
