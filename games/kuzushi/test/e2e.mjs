// ブラウザ（Playwright + Chromium）で実際に開いて確かめる：エラーなく動く／輪郭で跳ね返る／全12面クリア／
// 通り抜け・張りつきが起きない／アイテム6種が効く／保存／見た目（スクリーンショット）。
// 使い方（リポジトリのルートで）：node games/kuzushi/test/e2e.mjs [スクリーンショットの出力先]
// CDN に届かない環境では、次の環境変数でローカルのファイルに差し替える：
//   LOCAL_THREE=…/three.module.js  LOCAL_OPENTYPE=…/opentype.mjs  LOCAL_FONT=…/日本語フォント.ttf
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const OUT = process.argv[2] || '/tmp/kuzushi-shots';
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
}).listen(0);
const BASE = `http://localhost:${server.address().port}/games/kuzushi/index.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, label, extra = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + label + (extra ? '  ' + extra : '')); if (!ok) failed++; };

async function open(query = '?debug', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 820 }, ...opts });
  await ctx.route(/cdn\.jsdelivr\.net/, route => {
    const u = route.request().url();
    const local = /three@/.test(u) ? process.env.LOCAL_THREE && path.join(path.dirname(process.env.LOCAL_THREE), u.split('/').pop())
      : /opentype/.test(u) ? process.env.LOCAL_OPENTYPE : /\.otf$/.test(u) ? process.env.LOCAL_FONT : null;
    if (!local) return route.continue();
    route.fulfill({ body: fs.readFileSync(local), contentType: /otf|ttf/.test(local) ? 'font/ttf' : 'text/javascript' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => { const b = document.getElementById('new'); return b && !b.disabled; }, null, { timeout: 30000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

// ---------- ページ内で走らせる検証用の関数 ----------
const IN_PAGE = `
window.__t = {
  async mods() { const s = await import('./shapes.js'); const m = await import('./sim.js'); return { s, m }; },
  // 自動操縦で 1 面をクリアまで進め、通り抜け・張りつきを毎ティック検査する
  async runStage(i, seed, apSeed, maxSec) {
    const { s, m } = await this.mods();
    const k = window.__kuzushi;
    const stage = k.buildStage(k.font, i);
    const sim = new k.Sim({ stage, seed });
    sim.keepEvents = false;
    const ap = k.makeAutopilot(apSeed);
    const r = { stage: i + 1, tunnel: 0, minVyRatio: 1, minVxRatio: 1, speedMin: 1e9, speedMax: 0, maxNoContact: 0, ticks: 0 };
    let lastContact = 0, lastHits = 0, lastPaddle = 0, lastBlocks = sim.blocks.length;
    const limit = Math.floor(maxSec * 120);
    while (sim.state !== 'clear' && sim.state !== 'over' && sim.tick < limit) {
      sim.step(ap(sim));
      for (const b of sim.balls) {
        if (b.attached) continue;
        const sp = Math.hypot(b.vx, b.vy);
        r.minVyRatio = Math.min(r.minVyRatio, Math.abs(b.vy) / sp);
        r.minVxRatio = Math.min(r.minVxRatio, Math.abs(b.vx) / sp);
        r.speedMin = Math.min(r.speedMin, sp); r.speedMax = Math.max(r.speedMax, sp);
        if (sim.eff.fire <= 0) for (const bl of sim.blocks) {   // 中心が字の中にいたら通り抜け
          if (bl.invuln > 0) continue;
          const lx = b.x - bl.g.x, ly = b.y - bl.g.y, bb = bl.c.bbox;
          if (lx > bb[0] && lx < bb[2] && ly > bb[1] && ly < bb[3] && s.insideComp(bl.c, lx, ly)) r.tunnel++;
        }
      }
      if (sim.stats.hits !== lastHits || sim.stats.paddleHits !== lastPaddle || sim.blocks.length !== lastBlocks) { lastContact = sim.tick; lastHits = sim.stats.hits; lastPaddle = sim.stats.paddleHits; lastBlocks = sim.blocks.length; }
      r.maxNoContact = Math.max(r.maxNoContact, (sim.tick - lastContact) / 120);
    }
    r.state = sim.state; r.sec = sim.tick / 120; r.score = sim.score; r.lives = sim.lives; r.lost = sim.stats.lost;
    r.hits = sim.stats.hits; r.breaks = sim.stats.breaks; r.caught = sim.stats.caught; r.dropped = sim.stats.dropped; r.maxBalls = sim.stats.maxBalls;
    r.hpTotal = stage.glyphs.reduce((a, g) => a + g.forms.reduce((b, f) => b + f.hp.reduce((c, d) => c + d, 0), 0), 0);
    r.digest = sim.digest();
    return r;
  },
};
`;

// ---------- 1. 起動・見た目 ----------
let page = await open('?debug');
await page.evaluate(IN_PAGE);
check(errors.length === 0, 'ページがエラーなく開く', errors.join(' | '));
check(await page.evaluate(() => !!document.querySelector('a[href="../../"]')), '戻りリンク（← メインページへ）がある');
await shot(page, '01-menu');

// 使われている字がフォントにあるか
const missing = await page.evaluate(async () => {
  const { s } = await window.__t.mods(); const k = window.__kuzushi;
  const out = [];
  for (const st of k.STAGES) for (const g of st.glyphs) for (const f of (g.forms || [g])) if (!s.hasGlyph(k.font, f.ch)) out.push(f.ch);
  for (const ch of '大小速分火命') if (!s.hasGlyph(k.font, ch)) out.push(ch);
  return out;
});
check(missing.length === 0, '面とアイテムの字がフォントにそろっている', missing.join(''));

// ---------- 2. 輪郭で跳ね返る ----------
const bounce = await page.evaluate(async () => {
  const k = window.__kuzushi;
  const res = {};
  const mk = (i) => { const st = k.buildStage(k.font, i); const sim = new k.Sim({ stage: st, seed: 1 }); sim.keepEvents = false; sim.state = 'play'; sim.balls[0].attached = false; return sim; };
  const place = (sim, x, y, vx, vy) => { const b = sim.balls[0]; Object.assign(b, { x, y, px: x, py: y, vx, vy }); return b; };
  // (a) 口の下の横棒に下から当てる：vy が反転し、vx はほぼ保たれ、hp が 1 減る
  {
    const sim = mk(0); const g = sim.glyphs[0], bl = sim.blocks[0], bb = bl.c.bbox;
    const sp = sim.stage.speed, ang = 0.4;
    const b = place(sim, g.x + bb[0] + 12, g.y + bb[3] + 40, sp * Math.sin(ang), -sp * Math.cos(ang));
    const vx0 = b.vx; let n = 0; while (b.vy < 0 && n++ < 600) sim.step({ tx: 0 });
    res.flatBottom = { vyFlipped: b.vy > 0, vxKept: Math.abs(b.vx - vx0) < 25, hp: bl.hp, maxHp: bl.maxHp, y: b.y - g.y, bottom: bb[3] };
  }
  // (b) 口の穴を下から通り抜ける：穴の中の x を、まっすぐ上へ。上の棒に当たるまで穴の中を進む
  {
    const sim = mk(0); const g = sim.glyphs[0], bl = sim.blocks[0];
    const hole = bl.c.loops[1]; let hx0 = 1e9, hx1 = -1e9, hy0 = 1e9, hy1 = -1e9;
    for (let i = 0; i < hole.length; i += 2) { hx0 = Math.min(hx0, hole[i]); hx1 = Math.max(hx1, hole[i]); hy0 = Math.min(hy0, hole[i + 1]); hy1 = Math.max(hy1, hole[i + 1]); }
    // 下の棒の下から穴の真ん中を通って上へ撃つと下の棒に当たってしまうので、穴の中から撃つ
    const sp = sim.stage.speed, cx = (hx0 + hx1) / 2, cy = (hy0 + hy1) / 2;
    const b = place(sim, g.x + cx, g.y + cy, sp * Math.sin(0.25), -sp * Math.cos(0.25));
    let n = 0, inside = true, minY = 1e9;
    while (n++ < 240) { sim.step({ tx: 0 }); const lx = b.x - g.x, ly = b.y - g.y; if (lx < hx0 || lx > hx1 || ly < hy0 || ly > hy1) { inside = false; break; } minY = Math.min(minY, ly); }
    res.hole = { stayedInHole: inside, hp: bl.hp, holeW: hx1 - hx0, holeH: hy1 - hy0, hit: bl.hp < bl.maxHp };
  }
  // (c) ◎ の外周（曲線）に下から当てる：右にずれて当たれば、右へ反れる（法線に従う）
  {
    const out = [];
    for (const dx of [-14, 14]) {
      const sim = mk(7); const g = sim.glyphs[0], bl = sim.blocks[0], bb = bl.c.bbox;
      const sp = sim.stage.speed;
      const b = place(sim, g.x + (bb[0] + bb[2]) / 2 + dx, g.y + bb[3] + 40, 0.0001, -sp);
      let n = 0; while (b.vy < 0 && n++ < 600) sim.step({ tx: 0 });
      out.push({ dx, vx: b.vx, vy: b.vy, hp: bl.hp });
    }
    res.curve = out;
  }
  // (d) 動くブロックでも、ボールが字の中に入り込まない（雨電を高速で撃ち込む）
  {
    const sim = mk(8); let tun = 0; const { insideComp } = await import('./shapes.js');
    for (let t = 0; t < 120 * 40; t++) {
      const b = sim.balls[0]; if (b.vy > 0 && b.y > 330 || b.y > 500) place(sim, 60 + (t * 37) % 240, 340, (((t * 13) % 200) - 100) * 3, -sim.stage.speed);
      sim.step({ tx: 0 });
      for (const bl of sim.blocks) { const lx = b.x - bl.g.x, ly = b.y - bl.g.y; if (insideComp(bl.c, lx, ly)) tun++; }
      if (sim.state !== 'play') break;
    }
    res.moving = { tun };
  }
  return res;
});
check(bounce.flatBottom.vyFlipped && bounce.flatBottom.vxKept && bounce.flatBottom.hp === bounce.flatBottom.maxHp - 1, '平らな輪郭：下から当たると反転・横速度は保たれ、1回で体力が1減る', JSON.stringify(bounce.flatBottom));
check(bounce.hole.stayedInHole && bounce.hole.holeW > 20, '「口」の穴の中をボールが通れる（穴の幅 ' + bounce.hole.holeW.toFixed(1) + 'px）', JSON.stringify(bounce.hole));
check(bounce.curve[0].vx < 0 && bounce.curve[1].vx > 0 && bounce.curve.every(c => c.vy > 0 && c.hp === 0 || c.vy > 0), '曲線の輪郭：当たった位置の法線にそって左右に反れる', JSON.stringify(bounce.curve));
check(bounce.moving.tun === 0, '動くブロック（雨電）に高速で撃ち込んでも字の中に入り込まない', JSON.stringify(bounce.moving));

// ---------- 3. 全12面クリア（自動操縦）・通り抜け・張りつき・決定性 ----------
let allOk = true, tunnels = 0, minVy = 1, minVx = 1, noContact = 0;
const caughtAll = {};
const results = [];
for (let i = 0; i < 12; i++) {
  const r = await page.evaluate(([i]) => window.__t.runStage(i, 1, 3, 900), [i]);
  results.push(r);
  tunnels += r.tunnel; minVy = Math.min(minVy, r.minVyRatio); minVx = Math.min(minVx, r.minVxRatio); noContact = Math.max(noContact, r.maxNoContact);
  for (const [k, v] of Object.entries(r.caught)) caughtAll[k] = (caughtAll[k] || 0) + v;
  const ok = r.state === 'clear' && r.hits >= r.hpTotal;
  allOk &&= ok;
  console.log(`     面${String(r.stage).padStart(2)} ${r.state} ${r.sec.toFixed(0)}秒 命中${r.hits}/${r.hpTotal}画 破壊${r.breaks} 残機${r.lives} ミス${r.lost} 最長無接触${r.maxNoContact.toFixed(1)}秒 取得${JSON.stringify(r.caught)}`);
}
check(allOk, '全12面を自動操縦でクリアできる（命中数 ≧ 画数の合計）');
check(tunnels === 0, '全面で、ボールの中心が字の内側に入り込む（通り抜け）が 0 回', `tunnel=${tunnels}`);
check(minVy >= Math.sin(14 * Math.PI / 180) - 1e-6, '水平方向への張りつきなし（|vy|/速さ の最小 ' + minVy.toFixed(3) + '）');
check(minVx >= Math.sin(6 * Math.PI / 180) - 1e-6, '垂直方向への張りつきなし（|vx|/速さ の最小 ' + minVx.toFixed(3) + '）');
check(noContact < 12, '何にも当たらず飛び続ける時間が 12 秒未満（最長 ' + noContact.toFixed(1) + '秒）');
// 別の自動操縦の癖・別の seed でも全面クリアできるか
let multiOk = true; const lostSum = [];
for (const [seed, ap] of [[2, 11], [3, 29]]) for (let i = 0; i < 12; i++) {
  const r = await page.evaluate(([i, s, a]) => window.__t.runStage(i, s, a, 900), [i, seed, ap]);
  if (r.state !== 'clear' || r.tunnel) { multiOk = false; console.log('     NG', seed, ap, JSON.stringify(r)); }
  for (const [k, v] of Object.entries(r.caught)) caughtAll[k] = (caughtAll[k] || 0) + v;
}
check(multiOk, '別の乱数・別の操縦でも全12面クリア（さらに 24 回）');
// 決定性
const d1 = await page.evaluate(() => window.__t.runStage(9, 5, 4, 900)), d2 = await page.evaluate(() => window.__t.runStage(9, 5, 4, 900));
check(d1.digest === d2.digest && d1.score === d2.score && d1.sec === d2.sec, '同じ入力なら同じ結果（決定性）', `digest ${d1.digest}=${d2.digest}`);
check(Object.keys(caughtAll).length >= 5, '通常プレイ中にも落ちた字を拾える（取得 ' + JSON.stringify(caughtAll) + '）');

// ---------- 4. アイテム 6 種 ----------
const items = await page.evaluate(async () => {
  const k = window.__kuzushi, out = {};
  const mk = (i) => { const sim = new k.Sim({ stage: k.buildStage(k.font, i), seed: 1 }); sim.keepEvents = false; return sim; };
  const catchItem = (sim, kind) => { sim.dropItem(sim.px, 520, kind); for (let t = 0; t < 120 && sim.items.length; t++) sim.step({ tx: sim.px }); return !sim.items.length; };
  const run = (sim, n) => { for (let t = 0; t < n; t++) sim.step({ tx: sim.px }); };
  // 大・小
  { const sim = mk(0); sim.step({ launch: true }); const w0 = sim.pw; catchItem(sim, 'big'); run(sim, 120); const wb = sim.pw; run(sim, 120 * 13); out.big = { w0, wb, after: sim.pw };
    const s2 = mk(0); s2.step({ launch: true }); s2.score = 0; catchItem(s2, 'small'); run(s2, 120); const ws = s2.pw; const sc0 = s2.score; s2.hit(s2.blocks[0], 0, 0); out.small = { ws, gain: s2.score - sc0, mult: s2.mult() }; }
  // 速：ボール速度 ×1.3、得点倍率
  { const sim = mk(0); sim.step({ launch: true }); run(sim, 60); const v0 = Math.hypot(sim.balls[0].vx, sim.balls[0].vy); catchItem(sim, 'fast'); run(sim, 240); const v1 = Math.hypot(sim.balls[0].vx, sim.balls[0].vy); out.fast = { v0, v1, mult: sim.mult() }; }
  // 分：1 → 3 つ
  { const sim = mk(0); sim.step({ launch: true }); run(sim, 30); const n0 = sim.balls.length; catchItem(sim, 'split'); out.split = { n0, n1: sim.balls.length, distinct: new Set(sim.balls.map(b => Math.round(Math.atan2(b.vy, b.vx) * 20))).size }; }
  // 火：字を貫通して、触れている間ダメージが続く
  { const sim = mk(2); sim.step({ launch: true }); catchItem(sim, 'fire');
    const g = sim.glyphs[0], bl = sim.blocks[0], b = sim.balls[0];
    Object.assign(b, { x: g.x, y: g.y + 90, px: g.x, py: g.y + 90, vx: 1, vy: -sim.stage.speed });
    const hp0 = bl.hp; let bounced = false, minY = 1e9; const vy0 = b.vy;
    for (let t = 0; t < 120 * 2 && sim.state === 'play' && sim.eff.fire > 0 && b.y > g.y - 100; t++) { sim.step({ tx: 0 }); minY = Math.min(minY, b.y - g.y); if (b.vy > 0) { bounced = true; break; } }
    out.fire = { hp0, hp1: bl.hp, passed: minY < -20, bounced, fireLeft: sim.eff.fire > 0 };
    // 火が切れたら元どおり反射する
    const sim2 = mk(0); sim2.eff.fire = 1; sim2.step({}); out.fireEnds = sim2.eff.fire === 0; }
  // 命
  { const sim = mk(0); sim.step({ launch: true }); const l0 = sim.lives; catchItem(sim, 'life'); out.life = { l0, l1: sim.lives }; }
  // 取り逃がしたら効果なし
  { const sim = mk(0); sim.step({ launch: true }); sim.dropItem(30, 520, 'life'); for (let t = 0; t < 400; t++) sim.step({ tx: 330 }); out.miss = { lives: sim.lives, items: sim.items.length }; }
  return out;
});
check(items.big.wb > items.big.w0 + 40 && items.big.after === items.big.w0, '大：パドルが大きくなり、時間が来ると元に戻る', JSON.stringify(items.big));
check(items.small.ws < 50 && items.small.mult === 2 && items.small.gain === 20, '小：パドルが小さくなり、得点が2倍', JSON.stringify(items.small));
check(items.fast.v1 > items.fast.v0 * 1.2 && items.fast.mult === 1.5, '速：ボールが速くなり、得点アップ', JSON.stringify(items.fast));
check(items.split.n0 === 1 && items.split.n1 === 3 && items.split.distinct === 3, '分：ボールが3つに分裂', JSON.stringify(items.split));
check(items.fire.passed && !items.fire.bounced && items.fire.hp1 < items.fire.hp0 && items.fireEnds, '火：字を貫通し、触れている間ダメージ。時間切れで元に戻る', JSON.stringify(items.fire));
check(items.life.l1 === items.life.l0 + 1, '命：残機＋1', JSON.stringify(items.life));
check(items.miss.lives === 3 && items.miss.items === 0, '受け損ねた字は効果なし', JSON.stringify(items.miss));

// ---------- 5. 画面操作・演出・保存 ----------
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForFunction(() => { const b = document.getElementById('new'); return b && !b.disabled; });
await page.evaluate(IN_PAGE);
await page.click('#new');
await sleep(300);
check(await page.evaluate(() => window.__kuzushi.scene === 'play' && window.__kuzushi.sim.state === 'ready'), '「はじめから」で面1が始まる（ボールを持った状態）');
await sleep(2400);
await shot(page, '02-ready');
// マウスでパドルが動く
const [mx, my] = await page.evaluate(() => window.__kuzushi.pxOf(300, 400));
await page.mouse.move(mx, my); await sleep(500);
const px1 = await page.evaluate(() => window.__kuzushi.sim.px);
check(Math.abs(px1 - 300) < 3, 'マウスでパドルが動く', 'px=' + px1.toFixed(1));
// 矢印キー
await page.keyboard.down('ArrowLeft'); await sleep(300); await page.keyboard.up('ArrowLeft');
check(await page.evaluate(() => window.__kuzushi.sim.px) < px1 - 60, '矢印キーでパドルが動く');
// クリックで発射
await page.mouse.click(mx, my); await sleep(200);
check(await page.evaluate(() => window.__kuzushi.sim.state) === 'play', 'クリックでボールが発射される');
// 自動操縦に切り替えて遊ばせ、演出を撮る
await page.evaluate(() => window.__kuzushi.setAuto(true));
let shotN = 0;
for (let t = 0; t < 200 && shotN < 2; t++) {
  await sleep(100);
  const s = await page.evaluate(() => { const k = window.__kuzushi; return { hits: k.sim.stats.hits, br: k.sim.stats.breaks, scene: k.scene }; });
  if (shotN === 0 && s.hits >= 1) { await shot(page, '03-hit'); shotN = 1; }
  if (shotN === 1 && s.br >= 1) { await sleep(180); await shot(page, '04-shatter'); shotN = 2; }
  if (s.scene !== 'play') break;
}
await page.waitForFunction(() => window.__kuzushi.scene === 'banner', null, { timeout: 60000 });
check(true, '面1をブラウザ上のリアルタイムでクリア（バナー表示）');
await shot(page, '05-clear');
let sv = await page.evaluate(() => JSON.parse(localStorage.getItem('moji_kuzushi.save')));
check(sv.hi > 0 && sv.reached === 2 && sv.run && sv.run.stage === 1 && sv.run.lives === 3, 'localStorage にハイスコア・到達面・残機を保存', JSON.stringify(sv));
// 再読み込み → つづきから／面セレクト
await page.reload();
await page.waitForFunction(() => { const b = document.getElementById('new'); return b && !b.disabled; });
const menu = await page.evaluate(() => ({ cont: document.getElementById('cont').textContent, hidden: document.getElementById('cont').hidden, dis: [...document.querySelectorAll('#stages button')].map(b => b.disabled), rec: document.getElementById('record').textContent }));
check(!menu.hidden && menu.cont.includes('面2') && menu.dis.filter(d => !d).length === 2 && menu.dis.slice(2).every(Boolean), '再読み込み後：つづきから（面2）・到達済みの面（1,2）だけ選べる', JSON.stringify(menu));
await shot(page, '06-menu-after');
await page.click('#stages button[data-i="1"]'); await sleep(2600);
check(await page.evaluate(() => window.__kuzushi.stage.index) === 1, '面セレクトから面2を始められる');
await shot(page, '07-stage2');

// 一時停止
await page.keyboard.press('p'); await sleep(100);
const frozen = await page.evaluate(() => window.__kuzushi.sim.tick); await sleep(300);
check(await page.evaluate(() => window.__kuzushi.sim.tick) === frozen && await page.evaluate(() => window.__kuzushi.scene) === 'pause', '一時停止（P）で止まる');
await page.click('#b-main'); await sleep(100);

// ゲームオーバー：ボールを落とし続けて残機 0 に
await page.evaluate(() => { window.__kuzushi.setAuto(false); });
await page.evaluate(() => { const s = window.__kuzushi.sim; s.lives = 1; });
await page.mouse.click(mx, my); await sleep(200);
await page.evaluate(() => { const s = window.__kuzushi.sim; for (const b of s.balls) { b.y = 590; b.vy = 300; } });
await page.waitForFunction(() => window.__kuzushi.scene === 'banner', null, { timeout: 15000 });
check(await page.evaluate(() => window.__kuzushi.sim.state) === 'over' && (await page.textContent('#banner-title')).includes('GAME OVER'), 'ボールを落とし続けるとゲームオーバー');
sv = await page.evaluate(() => JSON.parse(localStorage.getItem('moji_kuzushi.save')));
check(sv.run === null && sv.reached === 2, 'ゲームオーバー後も到達面は残る', JSON.stringify(sv));
await shot(page, '08-gameover');
await page.click('#b-main'); await sleep(2500);
check(await page.evaluate(() => window.__kuzushi.scene === 'play' && window.__kuzushi.sim.lives === 3 && window.__kuzushi.stage.index === 1), '「もう一度」で同じ面を残機3で再開');

// ---------- 6. 見た目：ボス面・アイテム・スマホ縦画面 ----------
await page.evaluate(() => { window.__kuzushi.start(10, 3, 0); window.__kuzushi.setAuto(true); }); await sleep(7000);
await shot(page, '09-boss-utsu');
await page.evaluate(() => { window.__kuzushi.start(11, 3, 0); window.__kuzushi.setAuto(true); }); await sleep(2800);
await shot(page, '10-boss-ryu-a');
await page.evaluate(() => { const s = window.__kuzushi.sim; for (const k of ['big', 'fire', 'split', 'fast', 'small', 'life']) s.dropItem(40 + 'big fire split fast small life'.split(' ').indexOf(k) * 56, 330, k); });
await sleep(800);
await shot(page, '11-items');
// ボスの変身：最初の姿をたおす
await page.evaluate(() => { const s = window.__kuzushi.sim; s.eff.fire = 99999; s.eff.fast = 99999; });
await page.waitForFunction(() => window.__kuzushi.sim.glyphs[0].form >= 1 || window.__kuzushi.scene !== 'play', null, { timeout: 90000 });
await sleep(1500);
check(await page.evaluate(() => window.__kuzushi.sim.glyphs[0].form) >= 1 || await page.evaluate(() => window.__kuzushi.scene) !== 'play', 'ボス「龍」は、たおすと別の姿（竜）に変身する');
await shot(page, '12-boss-ryu-b');

// スマホ縦画面
const ph = await open('?debug&auto&stage=5', { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await sleep(7000);
const box = await ph.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { w: r.width, h: r.height, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }; });
check(box.sw <= box.cw && box.sh <= box.ch, 'スマホ縦画面（390×780）で、はみ出しなく収まる', JSON.stringify(box));
await shot(ph, '13-mobile-play');
// タッチ操作：ドラッグでパドルが動く／タップで発射
await ph.evaluate(() => { window.__kuzushi.setAuto(false); window.__kuzushi.start(0, 3, 0); });
await sleep(2500);
const cdp = await ph.context().newCDPSession(ph);
const [tx0, ty0] = await ph.evaluate(() => window.__kuzushi.pxOf(180, 400));
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const p0 = await ph.evaluate(() => window.__kuzushi.sim.px);
await touch('touchStart', tx0, ty0);
for (let i = 1; i <= 8; i++) { await touch('touchMove', tx0 + i * 12, ty0); await sleep(30); }
await touch('touchEnd'); await sleep(200);
const p1 = await ph.evaluate(() => ({ px: window.__kuzushi.sim.px, st: window.__kuzushi.sim.state }));
check(p1.px > p0 + 40 && p1.st === 'ready', '指のドラッグでパドルが動く（ドラッグでは発射しない）', `px ${p0.toFixed(0)}→${p1.px.toFixed(0)}`);
await touch('touchStart', tx0, ty0); await touch('touchEnd'); await sleep(200);
check(await ph.evaluate(() => window.__kuzushi.sim.state) === 'play', 'タップでボールが発射される');
await shot(ph, '14-mobile-menu-skip');

check(errors.length === 0, '実行中にコンソールエラー・例外なし', errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
