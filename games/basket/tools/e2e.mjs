// ブラウザ（Playwright + Chromium）で実際に遊んで、5ステージとも「入る投げ方」があり、実際にドラッグで投げて得点が入るか・字で弾みに差が出るかを確かめる。
// 使い方（リポジトリのルートで）：node games/basket/tools/e2e.mjs [スクリーンショットの出力先]
// CDN に届かない環境では、次の環境変数でローカルのファイルに差し替える：
//   LOCAL_THREE=…/three.module.js  LOCAL_RAPIER=…/rapier.mjs（rapier2d-deterministic-compat）
//   LOCAL_OPENTYPE=…/opentype.mjs  LOCAL_FONT=…/日本語フォント.otf（試す字が入っているもの）
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const OUT = process.argv[2] || '/tmp/basket-shots';
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, label) => { console.log((ok ? 'OK   ' : 'FAIL ') + label); if (!ok) failed++; };

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, ...opts });
  await ctx.route(/cdn\.jsdelivr\.net/, route => {
    const u = route.request().url();
    const local = /three@/.test(u) ? process.env.LOCAL_THREE && path.join(path.dirname(process.env.LOCAL_THREE), u.split('/').pop())
      : /rapier/.test(u) ? process.env.LOCAL_RAPIER : /opentype/.test(u) ? process.env.LOCAL_OPENTYPE : /\.otf$/.test(u) ? process.env.LOCAL_FONT : null;
    if (!local) return route.continue();
    route.fulfill({ body: fs.readFileSync(local), contentType: /otf|ttf/.test(local) ? 'font/ttf' : 'text/javascript' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${BASE}/games/basket/index.html?debug`);
  await page.waitForFunction(() => window.__basket && window.__basket.mode() === 'ready', null, { timeout: 30000 });
  return page;
}
const B = (page, fn, ...a) => page.evaluate(([f, args]) => window.__basket[f](...args), [fn, a]);

// 実際のポインタ操作で投げる：パワー・角度 → 字から逆向きにその長さだけ引っぱって離す
async function dragThrow(page, power, angle, { hold = false, shot } = {}) {
  const [bx, by] = await B(page, 'pxOf', 1.3, 1.25);
  const pull = await B(page, 'pullPx');
  const len = pull * power / 100, a = angle * Math.PI / 180;
  const ex = bx - Math.cos(a) * len, ey = by + Math.sin(a) * len;
  await page.mouse.move(bx + 3, by + 3); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(bx + (ex - bx) * i / 6, by + (ey - by) * i / 6);
  if (shot) await page.screenshot({ path: path.join(OUT, shot) });
  await page.evaluate(([x, y]) => { window.__lastMove = { x, y }; }, [ex, ey]);
  if (!hold) await page.mouse.up();
}
const waitReady = (page, ms = 15000) => page.waitForFunction(() => ['ready', 'over'].includes(window.__basket.mode()), null, { timeout: ms });

// 入る投げ方を探す（描画なしの計算）。swish を優先。動くリングは phase（時計）も探す
async function findShot(page, ch, st, moving) {
  const hits = [];
  const phases = moving ? [0, 60, 120, 180, 240, 300] : [0];
  for (const ph of phases) {
    const r = await page.evaluate(([ch, st, ph]) => {
      const out = [];
      for (let ang = 30; ang <= 75; ang += 3) for (let pw = 45; pw <= 100; pw += 3) {
        const o = window.__basket.simulate(ch, st, pw, ang, ph);
        if (o.scored) out.push([pw, ang, ph, o.scored.kind]);
      }
      return out;
    }, [ch, st, ph]);
    hits.push(...r);
    if (hits.some(h => h[3] === 'swish')) break;
  }
  return hits;
}

// ---------- 0. 起動・字の性格 ----------
const page = await open();
await page.screenshot({ path: path.join(OUT, '01-start.png') });
check(errors.length === 0, '起動時にエラーなし ' + errors.join('|'));
check((await page.textContent('#trait')).length > 10, '字の性格が表示される: ' + (await page.textContent('#trait')).slice(0, 60));
check(await page.evaluate(() => !!document.querySelector('a[href="../../"]')), '戻りリンクがある');

// ---------- 1. 字によって弾み方に差が出るか ----------
// 同じ高さから真上に近い角度で投げ、床に落ちて跳ね返る高さを比べる
const bounce = {};
for (const ch of ['〇', '田', 'ー', '口', '鬱']) {
  const r = await page.evaluate(ch => {
    const o = window.__basket.simulate(ch, 0, 20, 85, 0, true);
    const ys = o.path.map(p => p[1]);
    const iMin = ys.indexOf(Math.min(...ys.slice(Math.floor(ys.length / 3))));  // 最初の着地あたり
    let i0 = 0; while (i0 < ys.length - 1 && ys[i0 + 1] >= ys[i0]) i0++;       // 頂点
    let j = i0; while (j < ys.length - 1 && ys[j + 1] <= ys[j]) j++;            // 着地
    let k = j; while (k < ys.length - 1 && ys[k + 1] >= ys[k]) k++;             // 跳ね返りの頂点
    return { bounce: +(ys[k] - ys[j]).toFixed(2) };
  }, ch);
  bounce[ch] = r.bounce;
}
console.log('床での跳ね返りの高さ(m):', JSON.stringify(bounce));
const bv = Object.values(bounce);
check(Math.max(...bv) - Math.min(...bv) > 0.15, '字によって跳ね返りに差が出る');
const spread = {};
for (const ch of ['〇', '田', 'ー', '口', '鬱']) {
  spread[ch] = await page.evaluate(ch => { const o = window.__basket.simulate(ch, 0, 70, 50, 0); return { end: o.end, rim: o.rimHits, steps: o.steps }; }, ch);
}
console.log('同じ投げ方(パワー70/角度50)の結果:', JSON.stringify(spread));
check(new Set(Object.values(spread).map(v => v.end.join())).size >= 4, '同じ投げ方でも字で結果が変わる');
// 決定性：同じ投げ方を2回計算して同じか
const d1 = await page.evaluate(() => JSON.stringify(window.__basket.simulate('鬱', 1, 80, 55, 37, true)));
const d2 = await page.evaluate(() => JSON.stringify(window.__basket.simulate('鬱', 1, 80, 55, 37, true)));
check(d1 === d2, '同じ投げ方は同じ結果（決定的）');

// ---------- 2. 5ステージとも、探索で見つけた投げ方を実際のドラッグで投げて得点が入る ----------
const found = [];
for (let st = 0; st < 5; st++) {
  await B(page, 'setStage', st);
  await page.evaluate(() => window.__basket.clearRecords());
  const moving = st === 1;
  const hits = await findShot(page, '〇', st, moving);
  const kinds = {}; hits.forEach(h => kinds[h[3]] = (kinds[h[3]] || 0) + 1);
  check(hits.length > 0, `ステージ${st + 1}: 入る投げ方が存在 ${hits.length}件 ${JSON.stringify(kinds)}`);
  if (!hits.length) continue;
  const pick = hits.find(h => h[3] === 'swish') || hits[0];
  found.push({ st, pick });
  // 実際にドラッグ操作で投げる（動くリングは時計を合わせて離す）
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    const before = (await B(page, 'state')).score;
    await dragThrow(page, pick[0], pick[1], { hold: moving });
    if (moving) {
      // 時計がちょうど pick[2] になった瞬間に、ページの中から指を離す（外から離すと通信の遅れで時計がずれる）
      await page.evaluate(ph => new Promise(res => {
        const mv = window.__lastMove;
        const tick = () => {
          if (window.__basket.state().clock % 360 === ph) { document.getElementById('view').dispatchEvent(new PointerEvent('pointerup', { clientX: mv.x, clientY: mv.y, bubbles: true })); res(); }
          else requestAnimationFrame(tick);
        };
        tick();
      }), pick[2]);
      await page.mouse.up(); // ページ側で投げ済みなので、これは何も起きない
    }
    if (st === 0 && attempt === 0) await page.waitForTimeout(450).then(() => page.screenshot({ path: path.join(OUT, '02-flying.png') }));
    await page.waitForFunction(() => window.__basket.state().score > -1 && ['ready', 'over'].includes(window.__basket.mode()), null, { timeout: 15000 });
    ok = (await B(page, 'state')).score > before;
    if (!ok) { await sleep(100); }
  }
  const s = await B(page, 'state');
  check(ok, `ステージ${st + 1}: 実際のドラッグで投げてスコア加算 (${pick.join('/')}) → score=${s.score}`);
  if (st === 2 || st === 3 || st === 4) await page.screenshot({ path: path.join(OUT, `03-stage${st + 1}.png`) });
}

// ---------- 3. 20球を通して遊ぶ（ステージ1）→ 結果・ハイスコア保存 ----------
await B(page, 'setStage', 0);
await page.evaluate(() => window.__basket.clearRecords());
const s1 = found.find(f => f.st === 0)?.pick || [88, 44];
for (let i = 0; i < 20; i++) {
  await dragThrow(page, s1[0], s1[1], { hold: i === 3, shot: i === 3 ? '04-aiming.png' : undefined });
  if (i === 3) await page.mouse.up();
  await waitReady(page, 20000); await sleep(420);
  if (i === 6) await page.screenshot({ path: path.join(OUT, '05-combo.png') });
}
await sleep(300);
const fin = await B(page, 'state');
console.log('20球後:', JSON.stringify(fin));
check(fin.mode === 'over' && fin.ballsLeft === 0, '20球で終了し結果が出る');
check(fin.made >= 15 && fin.score >= 45, `決定的に入る投げ方を繰り返すと高得点 (made=${fin.made}, score=${fin.score})`);
check(await page.isVisible('#result'), '結果の表示');
await page.screenshot({ path: path.join(OUT, '06-result.png') });
const rec = await page.evaluate(() => localStorage.getItem('moji_basket.records'));
check(rec && JSON.parse(rec)['〇|1'] === fin.score, 'ハイスコアが localStorage に保存される ' + rec);
await page.click('#change'); await page.fill('#char', '田'); await page.press('#char', 'Enter'); await page.dispatchEvent('#char', 'change');
await sleep(200);
check((await B(page, 'state')).ch === '田' && (await B(page, 'state')).ballsLeft === 20, '別の字にするとやり直せる');
await page.click('#presets button[data-c="口"]');
check((await B(page, 'state')).ch === '口', 'プリセットで字を変えられる');
check(errors.length === 0, 'プレイ中もエラーなし ' + errors.join('|'));
await page.close();

// ---------- 4. スマホ（縦長・タッチ） ----------
const ph = await open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
await ph.screenshot({ path: path.join(OUT, '07-phone.png') });
{
  const [bx, by] = await B(ph, 'pxOf', 1.3, 1.25);
  const cdp = await ph.context().newCDPSession(ph);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', bx, by); await tp('touchMove', bx - 60, by + 50); await tp('touchMove', bx - 90, by + 70);
  await ph.screenshot({ path: path.join(OUT, '08-phone-aim.png') });
  await tp('touchEnd');
  await ph.waitForFunction(() => window.__basket.state().ballsLeft === 19, null, { timeout: 5000 }).then(() => check(true, 'スマホ（タッチ）で投げられる')).catch(() => check(false, 'スマホ（タッチ）で投げられる'));
}
check(errors.length === 0, 'スマホでもエラーなし ' + errors.join('|'));

await browser.close();
server.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
