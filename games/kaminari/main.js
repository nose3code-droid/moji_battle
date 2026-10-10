// 雷よけ：横スクロールの走りアクション（Canvas 2D）。外部ライブラリなし、静的ファイルだけで動く
import { WHO, STAGES, ENDING } from './story.js';

const W = 960, H = 540;       // 内部解像度
const PX = 40;                // 1m = 40px
const GROUND = 430;           // 地面の y
const SX = 230;               // 主人公の画面上の x
const GRAVITY = 1800, JUMP_V = 720;
const STAND_H = 44, DUCK_H = 24, HALF_W = 12;
const BRAKE = 0.3;            // 伏せている間の速度の割合
const STRIKE_TIME = 0.28;     // 落雷が当たり判定を持つ秒数
const COL_HALF = 24;          // 落雷の半幅
const SHIELD_MAX = 2;
const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo","WenQuanYi Zen Hei",sans-serif';

const params = new URLSearchParams(location.search);
const GOD = params.has('god');      // テスト用：やられない
const SHORT = params.has('short');  // テスト用：全面を短くする
const $ = id => document.getElementById(id);
const canvas = $('view'), ctx = canvas.getContext('2d');

// ---------- セーブ ----------
const SAVE_KEY = 'moji_kaminari.save';
function loadSave() {
  const base = { cleared: 0, best: 0, stageBest: [] };
  try { return { ...base, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch { return base; }
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 保存できなくても遊べる */ } }
let save = loadSave();

const stageLen = i => (SHORT ? Math.round(STAGES[i].length * 0.25) : STAGES[i].length);
const offsetOf = i => { let s = 0; for (let k = 0; k < i; k++) s += stageLen(k); return s; };

// ---------- 乱数 ----------
function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- 面の生成（面番号ごとに毎回同じ配置） ----------
function build(idx) {
  const S = STAGES[idx], rnd = mulberry32(idx * 977 + 13);
  const len = stageLen(idx) * PX;
  const events = [], plats = [], items = [];
  const first = SHORT ? 8 : S.first;
  let i = 0;
  for (let m = first; m < stageLen(idx) - 10; m += SHORT ? 12 : S.gap * (S.boss ? 1 : 0.85 + rnd() * 0.3)) {
    const kind = S.boss ? S.kinds[i % S.kinds.length] : S.kinds[Math.floor(rnd() * S.kinds.length)];
    events.push({ x: m * PX, kind, d: Math.round(-10 + rnd() * 80) });
    i++;
  }
  for (let m = 12; m < stageLen(idx) - 8; m += 13 + rnd() * 8) {
    const p = { x: m * PX, y: GROUND - (rnd() < 0.5 ? 90 : 130), w: rnd() < 0.5 ? 110 : 80, glyph: rnd() < 0.5 ? '雲' : '雨' };
    plats.push(p);
    if (rnd() < 0.45) items.push({ x: p.x + p.w / 2, y: p.y - 28, got: false });
  }
  for (let m = 18; m < stageLen(idx) - 8; m += 24 + rnd() * 10) items.push({ x: m * PX, y: GROUND - 26, got: false });
  return { events, plats, items, len, seed: rnd };
}

// ---------- 状態 ----------
let mode = 'menu';       // menu / talk / play / dead / result / end
let g = null;            // 今の1回ぶんのプレイ状態
let shake = 0, flash = 0, boom = 0, time = 0;
let afterTalk = null;

function startPlay(idx) {
  const b = build(idx);
  g = {
    idx, S: STAGES[idx], ...b, x: 0, feet: GROUND, vy: 0, onGround: true, coyote: 0, jumpBuf: 0,
    shields: 0, invuln: 0, hz: [], ev: 0, ready: 0.6, hitFx: [], texts: [], done: false, deadT: 0,
    goalReached: false, drum: null, total: 0,
  };
  mode = 'play';
  hide('panel'); hide('talk');
}

// ---------- 入力 ----------
let keyDuck = false, ptrDuck = false, ptr = null;
const isDuck = () => keyDuck || ptrDuck;
function pressJump() {
  if (mode === 'play' && g) g.jumpBuf = 0.12;
}
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.code)) e.preventDefault();
  if (mode === 'talk' && ['Space', 'Enter', 'ArrowUp', 'ArrowDown'].includes(e.code)) return advanceTalk();
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) pressJump();
  if (e.code === 'ArrowDown' || e.code === 'KeyS') keyDuck = true;
});
addEventListener('keyup', e => { if (e.code === 'ArrowDown' || e.code === 'KeyS') keyDuck = false; });
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptr = { x: e.clientX, y: e.clientY, swiped: false };
});
canvas.addEventListener('pointermove', e => {
  if (!ptr) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  if (dy > 24 && dy > Math.abs(dx)) { ptr.swiped = true; ptrDuck = true; }
});
const ptrEnd = () => { if (ptr && !ptr.swiped) pressJump(); ptr = null; ptrDuck = false; };
canvas.addEventListener('pointerup', ptrEnd);
canvas.addEventListener('pointercancel', () => { ptr = null; ptrDuck = false; });
$('talk').addEventListener('click', () => advanceTalk());
$('menu-btn').addEventListener('click', () => openMenu());

// ---------- DOM の画面 ----------
function hide(id) { $(id).hidden = true; }
function show(id) { $(id).hidden = false; }
function panel({ ch = '', title = '', sub = '', body = '', btns = [] }) {
  $('panel-ch').textContent = ch;
  $('panel-title').textContent = title;
  $('panel-sub').textContent = sub;
  const bodyEl = $('panel-body');
  bodyEl.textContent = '';
  if (typeof body === 'string') bodyEl.textContent = body; else bodyEl.append(body);
  const box = $('panel-btns');
  box.textContent = '';
  for (const [label, fn, cls] of btns) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    box.append(b);
  }
  show('panel');
}

function openMenu() {
  mode = 'menu'; g = null; hide('talk');
  const grid = document.createElement('div');
  grid.className = 'stages';
  STAGES.forEach((S, i) => {
    const b = document.createElement('button');
    const best = save.stageBest[i];
    b.innerHTML = `<b>${S.boss ? '雷' : '第' + '一二三四五'[i] + '面'}</b><span></span><span></span>`;
    b.children[1].textContent = S.name;
    b.children[2].textContent = best ? `最長 ${best}m` : '―';
    b.disabled = i > save.cleared;
    if (i < save.cleared) b.className = 'done';
    b.addEventListener('click', () => startTalk(S.intro, () => startPlay(i)));
    grid.append(b);
  });
  const wrap = document.createElement('div');
  wrap.append('雷の神様「雷」が町に稲妻を落とし続けている。見張り番「避」となって、針で身を守りながら雷のもとへ走ろう。');
  wrap.append(grid);
  const next = Math.min(save.cleared, STAGES.length - 1);
  panel({
    ch: '雷', title: '雷よけ',
    sub: `最長距離 ${save.best}m ／ クリア ${save.cleared}/${STAGES.length} 面`,
    body: wrap,
    btns: [
      [save.cleared ? '続きから' : 'はじめから', () => startTalk(STAGES[next].intro, () => startPlay(next))],
      ['記録を消す', () => { if (confirm('記録をすべて消しますか？')) { save = { cleared: 0, best: 0, stageBest: [] }; writeSave(); openMenu(); } }, 'sub'],
    ],
  });
}

// 会話
let talkLines = [], talkAt = 0;
function startTalk(lines, then) {
  mode = 'talk'; hide('panel');
  talkLines = lines; talkAt = 0; afterTalk = then;
  showLine();
  show('talk');
}
function showLine() {
  const [who, text] = talkLines[talkAt];
  $('talk-ch').textContent = who === '語' ? '…' : who;
  $('talk-ch').style.color = WHO[who].color;
  $('talk-name').textContent = WHO[who].name;
  $('talk-text').textContent = text;
}
function advanceTalk() {
  if (mode !== 'talk') return;
  if (++talkAt < talkLines.length) return showLine();
  hide('talk');
  const f = afterTalk; afterTalk = null;
  if (f) f();
}

// ---------- 結果 ----------
function die() {
  g.done = true; g.deadT = 0; mode = 'dead';
  shake = 22; flash = 1;
  const total = Math.floor(offsetOf(g.idx) + g.x / PX);
  record(total, false);
}
function record(total, cleared) {
  const here = Math.floor(g.x / PX);
  if (total > save.best) save.best = total;
  if (here > (save.stageBest[g.idx] || 0)) save.stageBest[g.idx] = here;
  if (cleared && save.cleared < g.idx + 1) save.cleared = g.idx + 1;
  writeSave();
}
function showDead() {
  const total = Math.floor(offsetOf(g.idx) + g.x / PX);
  panel({
    ch: '避', title: `${total}m でやられた！`,
    sub: total >= save.best ? '最長記録を更新！' : `最長距離 ${save.best}m`,
    body: `${g.S.boss ? 'ボスの稲妻の型を覚えよう' : '予告マークをよく見て、伏せて待つかジャンプでよけよう'}。針があれば1回守ってくれる。`,
    btns: [['もう一度', () => startPlay(g.idx)], ['面セレクト', openMenu, 'sub']],
  });
}
function clearStage() {
  g.done = true;
  const total = offsetOf(g.idx) + stageLen(g.idx);
  record(total, true);
  flash = 0.6;
  const idx = g.idx, last = idx === STAGES.length - 1;
  mode = 'talk';
  startTalk(g.S.outro, () => {
    if (last) return startTalk(ENDING, () => { mode = 'end'; endT = 0; showEnd(); });
    mode = 'result';
    panel({
      ch: '門', title: `第${'一二三四五'[idx]}面 クリア！`, sub: `最長距離 ${save.best}m`, body: STAGES[idx + 1].name + ' へ進もう。',
      btns: [['つぎの面へ', () => startTalk(STAGES[idx + 1].intro, () => startPlay(idx + 1))], ['面セレクト', openMenu, 'sub']],
    });
  });
}
let endT = 0;
function showEnd() {
  panel({
    ch: '雨', title: '雷よけ 完',
    sub: `最長距離 ${save.best}m ／ 全${STAGES.length}面クリア！`,
    body: '鼓を取り戻した雷は雨を降らせ、町の畑はすっかりうるおいました。ありがとう、避！',
    btns: [['面セレクトへ', openMenu], ['最初から遊ぶ', () => startTalk(STAGES[0].intro, () => startPlay(0)), 'sub']],
  });
}

// ---------- 更新 ----------
function popText(s, x, y, color = '#fff') { g.texts.push({ s, x, y, t: 0, color }); }

function spawnHazard(ev) {
  const S = g.S, v0 = S.speed * PX, id = g.hz.length;
  const delay = S.delay;
  if (ev.kind === 'col' || ev.kind === 'col2') {
    const tx = g.x + v0 * delay + ev.d;
    g.hz.push({ type: 'col', tx, age: 0, delay, seed: g.ev * 7 + 1 });
    if (ev.kind === 'col2') g.hz.push({ type: 'col', tx: tx + 150, age: 0, delay: delay + 0.15, seed: g.ev * 7 + 5 });
  } else {
    // 横走りの稲妻：low は地面すれすれ、high は頭の高さ。画面の右端に予告が出る
    g.hz.push({ type: 'beam', band: ev.kind, age: 0, delay: delay + 0.1, seed: g.ev * 7 + 3 });
  }
}

function hit(x, y) {
  if (g.invuln > 0 || g.done) return;
  if (g.shields > 0) {
    g.shields--; g.invuln = 1.3; shake = 12; flash = 0.5;
    popText('針がまもった！', SX, y - 60, '#7fe7ff');
  } else if (!GOD) {
    die();
  } else {
    g.invuln = 1.0; popText('（無敵モード）', SX, y - 60, '#aaa');
  }
}

function playerBox() {
  const h = isDuck() ? DUCK_H : STAND_H;
  return { l: g.x - HALF_W, r: g.x + HALF_W, t: g.feet - h, b: g.feet };
}

function update(dt) {
  time += dt;
  shake = Math.max(0, shake - dt * 30);
  flash = Math.max(0, flash - dt * 2.4);
  boom = Math.max(0, boom - dt * 1.6);
  endT += dt;
  if (!g) return;
  for (const t of g.texts) t.t += dt;
  g.texts = g.texts.filter(t => t.t < 1.2);
  if (mode === 'dead') { g.deadT += dt; if (g.deadT > 0.9 && $('panel').hidden) showDead(); return; }
  if (mode !== 'play') return;
  if (g.ready > 0) { g.ready -= dt; return; }

  const S = g.S, ducking = isDuck();
  g.jumpBuf = Math.max(0, g.jumpBuf - dt);
  g.invuln = Math.max(0, g.invuln - dt);

  // 前へ進む（伏せている間はゆっくり）
  g.x += S.speed * PX * (ducking ? BRAKE : 1) * dt;

  // ジャンプと重力、足場への着地
  g.coyote = g.onGround ? 0.08 : g.coyote - dt;
  if (g.jumpBuf > 0 && (g.onGround || g.coyote > 0)) {
    g.vy = -JUMP_V; g.onGround = false; g.coyote = 0; g.jumpBuf = 0;
  }
  const prev = g.feet;
  g.vy += GRAVITY * dt;
  g.feet += g.vy * dt;
  g.onGround = false;
  if (g.feet >= GROUND) { g.feet = GROUND; g.vy = 0; g.onGround = true; }
  if (g.vy >= 0) {
    for (const p of g.plats) {
      if (g.x + HALF_W > p.x && g.x - HALF_W < p.x + p.w && prev <= p.y + 2 && g.feet >= p.y) {
        g.feet = p.y; g.vy = 0; g.onGround = true; break;
      }
    }
  }

  // 落雷の予告を出す
  while (g.ev < g.events.length && g.x >= g.events[g.ev].x) { spawnHazard(g.events[g.ev]); g.ev++; }

  // 落雷の経過と当たり判定
  const box = playerBox();
  for (const h of g.hz) {
    const before = h.age;
    h.age += dt;
    if (before < h.delay && h.age >= h.delay) { shake = 16; flash = 0.85; boom = 1; }
    if (h.age >= h.delay && h.age < h.delay + STRIKE_TIME) {
      if (h.type === 'col') {
        if (Math.abs(g.x - h.tx) < COL_HALF + HALF_W) hit(g.x, g.feet);
      } else {
        const y0 = h.band === 'low' ? GROUND - 26 : GROUND - 72, y1 = h.band === 'low' ? GROUND : GROUND - 42;
        if (box.b > y0 && box.t < y1) hit(g.x, g.feet);
      }
    }
  }
  g.hz = g.hz.filter(h => h.age < h.delay + STRIKE_TIME + 0.35);

  // 針を拾う
  for (const it of g.items) {
    if (it.got) continue;
    if (Math.abs(it.x - g.x) < 30 && Math.abs(it.y - (g.feet - 22)) < 40) {
      if (g.shields < SHIELD_MAX) { it.got = true; g.shields++; popText('針ゲット！', SX, g.feet - 70, '#7fe7ff'); }
    }
  }

  // ゴール：通常の面は門、ボス面は雷の鼓
  if (!g.goalReached && g.x >= g.len) {
    g.goalReached = true;
    if (S.boss) g.drum = { x: g.len + 120 };
    else return clearStage();
  }
  if (g.drum) {
    g.x = Math.min(g.x, g.drum.x + 400);
    if (g.x >= g.drum.x - 20) return clearStage();
  }
}

// ---------- 描画 ----------
function glyph(ch, x, y, size, color, { stroke, glow, alpha = 1, sx = 1, sy = 1, rot = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(sx, sy);
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * 0.5; }
  if (stroke) { ctx.lineWidth = Math.max(2, size * 0.1); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(ch, 0, 0); }
  ctx.fillStyle = color;
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

function sxOf(wx) { return SX + (wx - (g ? g.x : 0)); }

function drawBackground() {
  const S = g ? g.S : STAGES[Math.min(save.cleared, STAGES.length - 1)];
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND);
  grad.addColorStop(0, S.sky[0]); grad.addColorStop(1, S.sky[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  const cam = g ? g.x : time * 60;
  // 遠くの雲（ゆっくり流れる）
  for (let i = -1; i < 6; i++) {
    const x = ((i * 240 - cam * 0.12) % 1440 + 1440) % 1440 - 240;
    glyph('雲', x, 70 + (i % 3) * 46, 120, 'rgba(255,255,255,.09)');
  }
  // 遠くの町と畑
  const town = ['家', '田', '木', '家', '田', '畑'];
  for (let i = -1; i < 12; i++) {
    const x = ((i * 120 - cam * 0.5) % 1440 + 1440) % 1440 - 120;
    glyph(town[((i % 6) + 6) % 6], x, GROUND - 38, 64, 'rgba(10,14,30,.55)');
  }
  // 地面
  ctx.fillStyle = '#1c2434'; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = '#2f3b52'; ctx.fillRect(0, GROUND, W, 5);
  if (g) {
    ctx.fillStyle = '#56668a'; ctx.font = `12px ${FONT}`; ctx.textAlign = 'center';
    for (let m = Math.floor((g.x - SX) / PX / 5) * 5; m < (g.x + W) / PX; m += 5) {
      if (m < 0) continue;
      const x = sxOf(m * PX);
      ctx.fillRect(x - 1, GROUND + 5, 2, m % 10 ? 8 : 16);
      if (m % 10 === 0) ctx.fillText(`${m}m`, x, GROUND + 34);
    }
  }
}

function boltPath(x0, y0, x1, y1, seed, n = 9) {
  const rnd = mulberry32(seed * 131 + 7);
  const pts = [[x0, y0]];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t + (rnd() - 0.5) * 60, y0 + (y1 - y0) * t]);
  }
  pts.push([x1, y1]);
  return pts;
}
function strokePts(pts, color, w) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.stroke();
}

function drawHazards() {
  for (const h of g.hz) {
    const warning = h.age < h.delay;
    const blink = Math.floor(h.age * 10) % 2 === 0;
    if (h.type === 'col') {
      const x = sxOf(h.tx);
      if (warning) {
        ctx.fillStyle = `rgba(255,225,77,${0.08 + 0.1 * (h.age / h.delay)})`;
        ctx.fillRect(x - COL_HALF, 0, COL_HALF * 2, GROUND);
        warnMark(x, 54, blink); warnMark(x, GROUND - 26, blink);
      } else if (h.age < h.delay + STRIKE_TIME) {
        const pts = boltPath(x, -10, x, GROUND, h.seed);
        ctx.save(); ctx.shadowColor = '#fff27a'; ctx.shadowBlur = 30;
        strokePts(pts, '#fff27a', 16); strokePts(pts, '#fff', 6);
        ctx.restore();
        // 「雷」の字を縦に積んだ稲妻
        for (let y = 24, i = 0; y < GROUND; y += 48, i++) {
          const p = pts[Math.min(pts.length - 1, Math.round((y / GROUND) * (pts.length - 1)))];
          glyph('雷', p[0], y, 52, '#fff27a', { stroke: '#a86a00', glow: '#ffb300', rot: (i % 2 ? 0.08 : -0.08) });
        }
        ctx.fillStyle = 'rgba(255,240,150,.45)'; ctx.beginPath(); ctx.ellipse(x, GROUND, 70, 12, 0, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = `rgba(255,240,150,${0.5 * (1 - (h.age - h.delay - STRIKE_TIME) / 0.35)})`;
        ctx.fillRect(x - 4, 0, 8, GROUND);
      }
    } else {
      const y0 = h.band === 'low' ? GROUND - 26 : GROUND - 72, y1 = h.band === 'low' ? GROUND : GROUND - 42, yc = (y0 + y1) / 2;
      if (warning) {
        ctx.fillStyle = `rgba(255,225,77,${0.1 + 0.12 * (h.age / h.delay)})`;
        ctx.fillRect(0, y0, W, y1 - y0);
        warnMark(W - 50, yc - 4, blink);
        warnMark(60, yc - 4, blink);
      } else if (h.age < h.delay + STRIKE_TIME) {
        const pts = boltPath(0, yc, W, yc, h.seed, 14).map(([x, y]) => [x, y + (y === yc ? 0 : (Math.sin(x) * 8))]);
        ctx.save(); ctx.shadowColor = '#fff27a'; ctx.shadowBlur = 26;
        strokePts(pts, '#fff27a', 20); strokePts(pts, '#fff', 7);
        ctx.restore();
        for (let x = 30; x < W; x += 64) glyph('雷', x, yc, 40, '#fff27a', { stroke: '#a86a00', glow: '#ffb300', rot: Math.PI / 2 * ((x / 64) % 2 ? 0 : 0.0) });
      } else {
        ctx.fillStyle = `rgba(255,240,150,${0.5 * (1 - (h.age - h.delay - STRIKE_TIME) / 0.35)})`;
        ctx.fillRect(0, yc - 3, W, 6);
      }
    }
  }
}
function warnMark(x, y, on) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = on ? '#ffe14d' : '#ff9a1a';
  ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(26, 20); ctx.lineTo(-26, 20); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.fillStyle = '#3a2a00'; ctx.font = `bold 30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 6);
  ctx.restore();
}

function drawWorld() {
  // 足場
  for (const p of g.plats) {
    const x = sxOf(p.x);
    if (x < -150 || x > W + 150) continue;
    ctx.fillStyle = 'rgba(180,200,235,.35)';
    ctx.beginPath(); ctx.roundRect(x, p.y, p.w, 12, 6); ctx.fill();
    glyph(p.glyph, x + p.w / 2, p.y + 6, p.w * 0.85, '#e4ecff', { alpha: 0.9, stroke: '#46517c' });
  }
  // 針
  for (const it of g.items) {
    if (it.got) continue;
    const x = sxOf(it.x);
    if (x < -50 || x > W + 50) continue;
    glyph('針', x, it.y + Math.sin(time * 4 + it.x) * 4, 40, '#7fe7ff', { stroke: '#124', glow: '#3cf' });
  }
  // ゴール
  const gx = sxOf(g.len);
  if (gx > -150 && gx < W + 150) {
    glyph(g.S.boss ? '雲' : '門', gx + 40, GROUND - 60, 120, g.S.boss ? '#d8e0ff' : '#ffd77a', { stroke: '#321' });
  }
  if (g.drum) glyph('鼓', sxOf(g.drum.x), GROUND - 40 + Math.sin(time * 5) * 5, 76, '#ffcf6a', { stroke: '#421', glow: '#ff0' });
  // 雷本人（進むほど近づいて大きくなる。ボス面は大きく居座る）
  const prog = Math.min(1, g.x / g.len);
  if (g.S.boss) {
    const charging = g.hz.some(h => h.age < h.delay);
    glyph('雷', 760 + (charging ? Math.sin(time * 60) * 4 : 0), 150 + Math.sin(time * 2) * 8, 250, '#ffe14d', { stroke: '#7a4a00', glow: '#ff9a00', alpha: g.goalReached ? 0.25 : 1 });
    if (g.goalReached) glyph('…', 760, 150, 80, '#fff');
  } else {
    glyph('雷', 840, 110 + (1 - prog) * 30, 50 + prog * 90, '#ffe14d', { alpha: 0.18 + prog * 0.4, stroke: '#7a4a00' });
  }
}

function drawPlayer() {
  const ducking = isDuck(), x = SX, y = g.feet;
  if (g.invuln > 0 && Math.floor(g.invuln * 14) % 2) return;
  const sy = ducking ? 0.55 : 1;
  const bob = g.onGround && mode === 'play' ? Math.abs(Math.sin(time * (ducking ? 5 : 14))) * 3 : 0;
  ctx.save();
  ctx.translate(x, y - bob);
  ctx.scale(1, sy);
  glyph('避', 0, -26, 54, '#ffe9b8', { stroke: '#2a1a08' });
  ctx.restore();
  // 針が周りを回る
  for (let i = 0; i < g.shields; i++) {
    const a = time * 3 + i * Math.PI;
    glyph('針', x + Math.cos(a) * 34, y - 30 + Math.sin(a) * 14 - (ducking ? 10 : 18), 22, '#7fe7ff', { stroke: '#124', glow: '#3cf' });
  }
}

function drawHud() {
  const total = Math.floor(offsetOf(g.idx) + g.x / PX);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, 44);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#ffe14d'; ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(`${total}m`, 16, 23);
  ctx.fillStyle = '#cdd'; ctx.font = `14px ${FONT}`;
  ctx.fillText(`${g.S.boss ? 'ボス' : '第' + '一二三四五'[g.idx] + '面'}「${g.S.name}」　最長 ${Math.max(save.best, total)}m`, 120, 23);
  // 進みぐあい
  const bw = 200, bx = W - bw - 130, prog = Math.min(1, g.x / g.len);
  ctx.fillStyle = '#334'; ctx.fillRect(bx, 18, bw, 10);
  ctx.fillStyle = '#ffe14d'; ctx.fillRect(bx, 18, bw * prog, 10);
  glyph('避', bx + bw * prog, 23, 18, '#fff');
  // 針
  for (let i = 0; i < SHIELD_MAX; i++) glyph('針', W - 90 + i * 34, 23, 28, i < g.shields ? '#7fe7ff' : 'rgba(255,255,255,.18)', { stroke: i < g.shields ? '#124' : null });
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBackground();
  if (g) {
    drawWorld(); drawHazards(); drawPlayer();
    for (const t of g.texts) glyph(t.s, t.x, t.y - t.t * 40, 22, t.color, { stroke: '#000', alpha: 1 - t.t / 1.2 });
  }
  if (mode === 'end') drawRain();
  ctx.restore();
  if (g && !['menu', 'end'].includes(mode)) drawHud();
  if (g && g.ready > 0 && mode === 'play') glyph('用意', W / 2, 200, 70, '#fff', { stroke: '#123' });
  // 雷鳴：稲光のフラッシュと「轟」
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,235,${Math.min(1, flash) * 0.75})`; ctx.fillRect(0, 0, W, H); }
  if (boom > 0) glyph('轟', W / 2, 250, 260, '#fff6b0', { alpha: boom * 0.45, stroke: '#a86a00', sx: 1 + (1 - boom) * 0.4, sy: 1 + (1 - boom) * 0.4 });
}

// エンディングの雨
function drawRain() {
  ctx.fillStyle = `rgba(120,160,210,${Math.min(0.35, endT * 0.1)})`; ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(5);
  ctx.strokeStyle = 'rgba(200,225,255,.7)'; ctx.lineWidth = 2;
  for (let i = 0; i < 110; i++) {
    const x = rnd() * W, sp = 500 + rnd() * 400, y = ((rnd() * H + endT * sp) % (H + 40)) - 20;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 22); ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const y = GROUND - 38;
    glyph('田', 100 + i * 150, y, 64, `hsl(${100 + Math.min(40, endT * 6)},45%,${25 + Math.min(20, endT * 3)}%)`);
  }
}

// ---------- ループ ----------
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= 1 / 60) { update(1 / 60); acc -= 1 / 60; }
  draw();
  requestAnimationFrame(frame);
}

// 外部から状態を覗く用（テスト用）
window.__kaminari = { get mode() { return mode; }, get g() { return g; }, get save() { return save; } };

openMenu();
const startStage = parseInt(params.get('stage'), 10);
if (startStage >= 1 && startStage <= STAGES.length) {
  save.cleared = Math.max(save.cleared, startStage - 1);
  startTalk(STAGES[startStage - 1].intro, () => startPlay(startStage - 1));
}
requestAnimationFrame(frame);
