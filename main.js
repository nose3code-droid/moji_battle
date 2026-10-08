import * as THREE from 'three';
import RAPIER from 'rapier';
import * as opentype from 'opentype';
import { buildMesh } from './glyph.js';
import { buildCourse } from './course.js';
import { FONT_URL, NAME_MAX } from './config.js';
import { createRacer, createGhost, startRecording, launch, stepRacer, progress, resultText, compareRacers, disposeRacer, DEPTH, DT } from './racer.js';

const RECORD_KEY = 'moji_battle.records';
const GHOST_KEY = 'moji_battle.ghosts';   // 文字ごとの自己ベストの走り { ch: { t: タイム, d: [x, y, 角度, ...] } }
const MODE_KEY = 'moji_battle.mode';
const NAME_KEY = 'moji_battle.name';
const GHOST_MAX = 20;                     // 保存するゴーストの数（遅いものから捨てる）
const CPU_POOL = Array.from('〇のあ木山龍田S@Oろるぬめ米水火風日月永花ゆ');
const CPU_COUNT = 3;
const LANES = [1.05, 0.25, -0.55, -1.35]; // 奥行き方向の見た目上のレーン（先頭がプレイヤー）

const $ = id => document.getElementById(id);
const msg = t => { $('msg').textContent = t; };

// ---------- 描画 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe8f7);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa88, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-5, 10, 12);
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

await RAPIER.init();
const visualWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
buildCourse(RAPIER, visualWorld, scene); // 見た目を作るためだけのワールド
visualWorld.free();

// ---------- 記録（この端末のブラウザだけに保存） ----------
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORD_KEY)) || {}; } catch { return {}; }
}
function saveRecord(ch, time) {
  const rec = loadRecords();
  const isBest = !(ch in rec) || time < rec[ch];
  if (isBest) {
    rec[ch] = time;
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(rec)); } catch { /* 保存できなくても遊べる */ }
  }
  return isBest;
}
function loadGhosts() {
  try { return JSON.parse(localStorage.getItem(GHOST_KEY)) || {}; } catch { return {}; }
}
function saveGhost(ch, t, d) {
  const g = loadGhosts();
  g[ch] = { t, d };
  const keep = Object.entries(g).sort((a, b) => a[1].t - b[1].t).slice(0, GHOST_MAX);
  try { localStorage.setItem(GHOST_KEY, JSON.stringify(Object.fromEntries(keep))); } catch { /* 容量不足なら諦める */ }
}
function renderRanking() {
  const list = Object.entries(loadRecords()).sort((a, b) => a[1] - b[1]).slice(0, 10);
  $('ranking').innerHTML = list.length
    ? list.map(([ch, t], i) => `<li><span>${i + 1}.</span> <b>${ch}</b> ${t.toFixed(2)} 秒</li>`).join('')
    : '<li>まだ記録がありません</li>';
}

// ---------- 世界ランキング（server.js） ----------
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
let raceId = 0; // 走り直したら古い通信結果を捨てるため
let worldAvailable = false; // サーバーが無い場所（GitHub Pages など静的な公開先）ではランキングを隠す

async function api(path, opts) {
  try {
    const res = await fetch(new URL('api' + path, document.baseURI), opts); // サブフォルダに置いても動くよう相対で
    const data = await res.json();
    return data;
  } catch { return null; }   // サーバーが無い（python の簡易サーバー等）・通信失敗
}

function renderWorld(el, data, ch) {
  if (!data || !data.top) { el.innerHTML = '<li class="none">世界ランキングに接続できません</li>'; return; }
  const row = (e, rank) => `<li class="${e.ch === ch ? 'me' : ''}"><span>${rank}.</span><b>${esc(e.ch)}</b><i>${esc(e.name)}</i>${e.time.toFixed(2)} 秒</li>`;
  const rows = data.top.map((e, i) => row(e, i + 1));
  if (data.entry && data.entry.rank > data.top.length) rows.push(row(data.entry, data.entry.rank));
  el.innerHTML = rows.join('') || '<li class="none">まだ誰も登録していません</li>';
}

async function refreshWorldPanel() {
  $('world').innerHTML = '<li class="none">読み込み中…</li>';
  renderWorld($('world'), await api(`/ranking?ch=${encodeURIComponent(currentChar())}`), currentChar());
}

// ゴールしたら、その文字がもう登録されているかを調べて登録フォームを出す
async function showSubmit(p) {
  if (!worldAvailable) return;
  const id = raceId;
  $('submit-box').hidden = false;
  $('submit-form').hidden = true;
  $('world-result').innerHTML = '';
  $('submit-info').textContent = '世界ランキングを確認中…';
  const data = await api(`/ranking?ch=${encodeURIComponent(p.ch)}`);
  if (id !== raceId) return;
  if (!data || !data.top) { $('submit-info').textContent = '世界ランキングに接続できません'; return; }
  if (data.entry) {
    $('submit-info').textContent = `「${p.ch}」は ${data.entry.name} さんが発見済み（世界 ${data.entry.rank} 位・公式 ${data.entry.time.toFixed(2)} 秒）`;
  } else {
    $('submit-info').textContent = `「${p.ch}」はまだ誰も登録していません。最初の発見者になれます！`;
    $('submit-form').hidden = false;
    $('submit').disabled = false;
  }
  renderWorld($('world-result'), data, p.ch);
}

async function submitWorld() {
  const p = racers[0];
  if (!p?.goal) return;
  const id = raceId;
  const name = $('name').value.trim();
  try { localStorage.setItem(NAME_KEY, name); } catch { /* 保存できなくてもよい */ }
  $('submit').disabled = true;
  $('submit-info').textContent = 'サーバーで走らせて確認しています…';
  const data = await api('/submit', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ch: p.ch, name }),
  });
  if (id !== raceId) return;
  const official = data?.result?.time;
  const note = official != null && official.toFixed(2) !== p.elapsed.toFixed(2) ? `（この端末では ${p.elapsed.toFixed(2)} 秒）` : '';
  const text = {
    new: () => `登録しました！ 世界 ${data.entry.rank} 位・公式 ${official.toFixed(2)} 秒${note}`,
    taken: () => `ひと足遅く、${data.entry.name} さんが先に登録しました（世界 ${data.entry.rank} 位）`,
    nogoal: () => 'サーバーで走らせ直すとゴールできませんでした（登録できません）',
    busy: () => '送信が多すぎます。少し待ってからもう一度押してください',
    invalid: () => 'この文字は登録できません',
    limit: () => '今日登録できる数の上限に達しました。また明日どうぞ',
    banned: () => 'この接続元からは登録できません',
  }[data?.status];
  $('submit-info').textContent = text ? text() : '登録に失敗しました（サーバーに接続できません）';
  if (data?.status === 'busy' || !text) $('submit').disabled = false;
  else $('submit-form').hidden = true;
  if (data?.top) renderWorld($('world-result'), data, p.ch);
}

// ---------- 走者 ----------
const camTarget = new THREE.Vector3(6, -1, 0);
let font = null;
let racers = [];          // [0] がプレイヤー
let opponents = [];       // CPU対戦の相手
let mode = 'cpu';         // cpu | ghost
try { if (localStorage.getItem(MODE_KEY) === 'ghost') mode = 'ghost'; } catch { /* 既定のまま */ }
let state = 'idle';       // idle | countdown | running | done
let countdown = 0;
let playerSub = '';

function hashColor(ch) {
  let h = 0;
  for (const c of ch) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.7, 0.55);
}

function clearRacers() {
  for (const r of racers) {
    disposeRacer(r);
    if (r.mesh) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
  }
  racers = [];
}

function addRacer(ch, lane, isPlayer, ghost = null) {
  const r = ghost ? createGhost(font, ch, ghost) : createRacer(RAPIER, font, ch);
  if (!r) return null;
  r.isPlayer = isPlayer;
  r.lane = LANES[lane];
  const color = ghost ? new THREE.Color(0xeef4ff) : hashColor(ch);
  if (!isPlayer && !ghost) color.lerp(new THREE.Color(0xffffff), 0.45); // CPU は淡い色
  r.mesh = buildMesh(r.polys, DEPTH, color);
  if (!isPlayer) {
    r.mesh.material.transparent = true;
    r.mesh.material.opacity = ghost ? 0.45 : 0.8;   // ゴーストは半透明の白
    if (ghost) r.mesh.material.depthWrite = false;
  }
  scene.add(r.mesh);
  racers.push(r);
  return r;
}

function syncMeshes() {
  for (const r of racers) {
    const t = r.body.translation(), q = r.body.rotation();
    r.mesh.position.set(t.x, t.y, r.lane);
    r.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }
}

// ---------- 性能表示 ----------
function bar(label, value, text) {
  const w = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="stat"><span>${label}</span><i><b style="width:${w}%"></b></i><em>${text}</em></div>`;
}
function renderStats(r) {
  const s = r.stats;
  const best = loadRecords()[r.ch];
  // 丸さは 78%（正方形）〜100%（円）の範囲で差が出るので、その範囲を広げて見せる
  $('stats').innerHTML =
    `<div class="stat-head"><b>「${r.ch}」の性能</b><span>自己ベスト ${best != null ? best.toFixed(2) + ' 秒' : '―'}</span></div>` +
    bar('丸さ', (s.roundness - 0.75) / 0.25, `${(s.roundness * 100).toFixed(0)}%`) +
    bar('重さ', s.mass / 1.2, `${s.mass.toFixed(2)} kg`) +
    bar('回りにくさ', (s.spin - 0.5) / 0.5, `${(s.spin * 100).toFixed(0)}%`) +
    bar('重心のずれ', s.offset / 0.2, `${(s.offset * 100).toFixed(0)}%`);
}

// ゴースト対戦の相手：今の文字以外で、記録が速い順に3つ（同じ文字のゴーストは自分と全く同じ動きになるため除く）
function ghostOpponents() {
  const player = currentChar();
  return Object.entries(loadGhosts()).filter(([c]) => c !== player)
    .sort((a, b) => a[1].t - b[1].t).slice(0, CPU_COUNT);
}
function renderOpponents() {
  for (const b of document.querySelectorAll('.mode button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('shuffle').hidden = mode !== 'cpu';
  if (mode === 'cpu') {
    $('opponents').innerHTML = opponents.map(c => `<span class="chip">${c}</span>`).join('');
  } else {
    const g = ghostOpponents();
    $('opponents').innerHTML = g.length
      ? g.map(([c, v]) => `<span class="chip ghost">${c}<small>${v.t.toFixed(1)}</small></span>`).join('')
      : '<span class="none">記録なし（ゴールすると残ります）</span>';
  }
}
function shuffleOpponents() {
  const player = currentChar();
  const pool = CPU_POOL.filter(c => c !== player);
  opponents = [];
  while (opponents.length < CPU_COUNT && pool.length) opponents.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  renderOpponents();
}

// ---------- レース進行 ----------
function currentChar() {
  return Array.from($('char').value.trim())[0] || '';
}

// 走者を並べ直してスタート前の状態にする
function prepare() {
  const ch = currentChar();
  if (!ch || !font) return false;
  clearRacers();
  raceId++;
  $('submit-box').hidden = true;
  state = 'idle';
  $('time').textContent = '0.00';
  $('result').hidden = true;
  $('count').textContent = '';
  msg('');
  const p = addRacer(ch, 0, true);
  if (!p) { msg(`「${ch}」は形が取れませんでした`); return false; }
  if (mode === 'cpu') opponents.forEach((c, i) => addRacer(c, i + 1, false));
  else ghostOpponents().forEach(([c, g], i) => addRacer(c, i + 1, false, g));
  startRecording(p);
  renderOpponents();
  renderStats(p);
  renderDots();
  syncMeshes();
  const t = p.body.translation();
  camTarget.set(t.x + 2, t.y + 0.5, 0); // 前の走りの位置からカメラを戻す
  return true;
}

function renderDots() {
  $('track').innerHTML = racers.map((r, i) =>
    `<div class="dot${r.isPlayer ? ' me' : ''}${r.isGhost ? ' ghost' : ''}" id="dot${i}" title="${r.ch}">${r.isPlayer ? '' : r.ch}</div>`).join('');
}
function updateDots() {
  racers.forEach((r, i) => { $(`dot${i}`).style.left = `${progress(r) * 100}%`; });
}

function startRace() {
  for (const r of racers) launch(r);
  state = 'running';
}

function onPlayerDone(p) {
  playerSub = '';
  if (p.goal) {
    const t = +p.elapsed.toFixed(2);
    const prev = loadRecords()[p.ch];
    const best = saveRecord(p.ch, t);
    // ゴーストが未保存の古い記録も、同タイムなら走りを保存し直す
    if (best || (t === prev && !loadGhosts()[p.ch])) saveGhost(p.ch, t, p.traj);
    playerSub = best
      ? (prev != null ? `自己ベスト更新！（前回 ${prev.toFixed(2)} 秒）` : '初記録！ ゴーストに保存しました')
      : `自己ベスト ${prev.toFixed(2)} 秒`;
    renderRanking();
  }
  $('time').textContent = p.elapsed.toFixed(2);
  $('result').hidden = false;
  renderResult();
  if (p.goal) showSubmit(p);
}

// 結果表：CPU がまだ走っていれば走行中として表示し、毎フレーム更新する
function renderResult() {
  const p = racers[0];
  const order = racers.slice().sort(compareRacers);
  const allDone = racers.every(r => r.done);
  // 同タイム（0.01秒単位）・同距離は同じ順位にする
  const key = r => r.goal ? `g${r.elapsed.toFixed(2)}` : `d${r.left.toFixed(1)}`;
  const rankOf = r => order.findIndex(o => key(o) === key(r)) + 1;
  const rank = rankOf(p);
  $('result-title').textContent = allDone && racers.length > 1
    ? `${rank} 位！ ${p.goal ? p.elapsed.toFixed(2) + ' 秒' : ''}`
    : (p.goal ? `ゴール！ ${p.elapsed.toFixed(2)} 秒` : resultText(p));
  $('result-sub').textContent = playerSub;
  $('standings').innerHTML = racers.length > 1 ? order.map(r =>
    `<li class="${r.isPlayer ? 'me' : ''}"><span>${r.done ? rankOf(r) : '-'}</span><b>${r.ch}</b>${r.isGhost ? '<small>ゴースト</small>' : ''}<em>${resultText(r)}</em></li>`).join('') : '';
}

$('go').addEventListener('click', () => {
  if (!prepare()) return;
  state = 'countdown';
  countdown = 3;
});
$('retry').addEventListener('click', () => $('go').click());
$('change').addEventListener('click', () => { prepare(); $('char').select(); });
$('shuffle').addEventListener('click', () => { shuffleOpponents(); prepare(); });
for (const b of document.querySelectorAll('.mode button')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* 保存できなくてもよい */ }
    prepare();
    renderOpponents();
  });
}
$('char').addEventListener('input', () => { if (currentChar()) prepare(); });
for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => { $('char').value = b.dataset.c; prepare(); });
}
$('rank-toggle').addEventListener('click', () => {
  const r = $('rank-box');
  r.hidden = !r.hidden;
  $('rank-toggle').textContent = r.hidden ? '自己ベスト一覧 ▼' : '自己ベスト一覧 ▲';
});
$('reset').addEventListener('click', () => {
  if (state === 'countdown' || state === 'running') return;
  if (!confirm('自己ベストとゴーストをすべて消します。元に戻せません。よろしいですか？')) return;
  try { localStorage.removeItem(RECORD_KEY); localStorage.removeItem(GHOST_KEY); } catch { /* 消せなくても続行 */ }
  renderRanking();
  prepare(); // 性能表示の自己ベストとゴースト相手を更新
  msg('記録を消しました');
  setTimeout(() => { if ($('msg').textContent === '記録を消しました') msg(''); }, 2000);
});
$('world-toggle').addEventListener('click', () => {
  const b = $('world-box');
  b.hidden = !b.hidden;
  $('world-toggle').textContent = b.hidden ? '世界ランキング ▼' : '世界ランキング ▲';
  if (!b.hidden) refreshWorldPanel();
});
$('submit').addEventListener('click', submitWorld);
$('world-toggle').hidden = true;
api('/ranking').then(d => { worldAvailable = !!d?.top; $('world-toggle').hidden = !worldAvailable; });
$('name').maxLength = NAME_MAX;
try { $('name').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* 空のまま */ }
renderRanking();

// ---------- ループ ----------
let acc = 0, last = performance.now();

function stepAll() {
  const p = racers[0];
  const wasDone = p.done;
  for (const r of racers) stepRacer(r);
  if (!wasDone && p.done) onPlayerDone(p);
  if (racers.every(r => r.done)) state = 'done';
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state === 'countdown') {
    countdown -= dt;
    $('count').textContent = countdown > 0 ? Math.ceil(countdown) : 'GO!';
    if (countdown <= 0) { startRace(); setTimeout(() => { if ($('count').textContent === 'GO!') $('count').textContent = ''; }, 600); }
  }
  if (state === 'running') {
    acc += dt;
    while (acc >= DT && state === 'running') { stepAll(); acc -= DT; }
    if (!racers[0].done) $('time').textContent = racers[0].elapsed.toFixed(2);
    if (racers[0].done) renderResult();
    updateDots();
  } else acc = 0;
  syncMeshes();

  if (racers.length) {
    const t = racers[0].body.translation();
    camTarget.lerp(new THREE.Vector3(t.x + 2, t.y + 0.5, 0), 0.08);
  }
  const dist = camera.aspect < 1 ? 20 : 13; // 縦長画面は引きで映す
  camera.position.set(camTarget.x - 1, camTarget.y + 5, dist); // 少し上から見下ろしてレーンを分けて見せる
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 調整用：描画せずに1文字だけ走らせて結果を返す（コンソールで simulate('あ') ）。記録には残さない
window.simulate = (ch) => {
  const r = createRacer(RAPIER, font, ch);
  if (!r) return null;
  launch(r);
  while (!r.done) stepRacer(r);
  const out = { ch, goal: r.goal, time: +r.elapsed.toFixed(2), text: resultText(r), stats: r.stats };
  disposeRacer(r);
  return out;
};

// ---------- フォント読み込み ----------
msg('フォント読み込み中…');
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  font = opentype.parse(await res.arrayBuffer());
  $('go').disabled = false;
  shuffleOpponents();
  prepare();
} catch (e) {
  console.error(e);
  msg('フォントの読み込みに失敗しました');
}
