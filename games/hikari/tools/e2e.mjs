// ブラウザ（Playwright + Chromium）で実際にポインタ操作して、全10面をクリアできるか確かめる。
// 使い方：リポジトリのルートで `python3 -m http.server 8765` を起動してから
//   node games/hikari/tools/e2e.mjs [http://localhost:8765] [スクリーンショットの出力先]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://localhost:8765') + '/games/hikari/index.html?debug';
const OUT = process.argv[3] || '/tmp/hikari-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const watch = page => {
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|403/.test(m.text())) errors.push('console: ' + m.text()); });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = (page, fn, ...a) => page.evaluate(([f, args]) => window.__hikari[f](...args), [fn, a]);

async function clickThrough(page, until) { // 会話を読み飛ばす
  for (let i = 0; i < 60; i++) {
    const m = await H(page, 'mode');
    if (until.includes(m)) return m;
    if (m === 'dialog') await page.click('#dialog'); else await sleep(100);
  }
  throw new Error('モードが変わらない: ' + await H(page, 'mode'));
}

async function drag(page, a, b) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
  await page.mouse.up(); await sleep(30);
}
async function tap(page, c, n) { for (let i = 0; i < n; i++) { await page.mouse.click(c.x, c.y); await sleep(30); } }

// 正解の配置を、実際のドラッグとタップで再現する
async function playSolution(page, level, sol) {
  const pending = sol.map(s => ({ ...s }));
  for (let guard = 0; pending.length && guard < 30; guard++) {
    const st = await H(page, 'state');
    let progressed = false;
    for (const s of [...pending]) {
      const m = st.mirrors[s.i];
      if (!m.fixed && (m.x !== s.x || m.y !== s.y)) {
        if (st.mirrors.some((o, j) => j !== s.i && o.x === s.x && o.y === s.y)) continue; // 行き先がふさがっている
        await drag(page, await H(page, 'cell', m.x, m.y), await H(page, 'cell', s.x, s.y));
        const after = (await H(page, 'state')).mirrors[s.i];
        if (after.x !== s.x || after.y !== s.y) throw new Error(`面${level.id}: 鏡${s.i}を動かせない`);
      }
      const cur = (await H(page, 'state')).mirrors[s.i];
      await tap(page, await H(page, 'cell', cur.x, cur.y), (s.o - cur.o + 4) % 4);
      pending.splice(pending.indexOf(s), 1); progressed = true;
      break; // 状態が変わったので取り直す
    }
    if (!progressed) throw new Error(`面${level.id}: 鏡の入れ替えで詰まった`);
  }
}

const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
watch(page);
await page.goto(BASE);
await sleep(600);
await page.screenshot({ path: `${OUT}/00-title.png` });

await page.click('#btn-new');
const { SOLUTIONS } = await import('../solutions.js');
const levels = await H(page, 'levels');
const report = [];
for (const level of levels) {
  await clickThrough(page, ['play']);
  await sleep(200);
  await page.screenshot({ path: `${OUT}/L${String(level.id).padStart(2, '0')}-start.png` });
  const st0 = await H(page, 'state');
  if (st0.solved) throw new Error(`面${level.id}: 最初から解けている`);
  // 1 回まちがえた配置（鏡を1回タップ）→ やり直しボタンで元に戻るか
  if (level.id === 1) {
    const m0 = st0.mirrors[0];
    await tap(page, await H(page, 'cell', m0.x, m0.y), 1);
    if ((await H(page, 'state')).moves !== 1) throw new Error('タップで手数が増えない');
    await page.click('#btn-reset');
    if ((await H(page, 'state')).moves !== 0) throw new Error('やり直しで手数が戻らない');
    await page.click('#btn-hint'); await sleep(500);
    await page.screenshot({ path: `${OUT}/L01-hint.png` });
    await sleep(1600);
  }
  const sol = SOLUTIONS[level.id];
  await playSolution(page, level, sol.sol);
  const st = await H(page, 'state');
  if (!st.solved) throw new Error(`面${level.id}: 正解の配置にしても解けない`);
  await sleep(900);
  await page.screenshot({ path: `${OUT}/L${String(level.id).padStart(2, '0')}-clearing.png` });
  const m = await clickThrough(page, ['clear', 'ending']);
  await sleep(300);
  const sv = (await H(page, 'save'));
  report.push(`面${level.id} ${level.title}: 手数${st.moves}/最短${sol.par} 星${sv.cleared[level.id]}`);
  if (st.moves !== sol.par) throw new Error(`面${level.id}: 手数${st.moves} != 最短${sol.par}`);
  await page.screenshot({ path: `${OUT}/L${String(level.id).padStart(2, '0')}-${m}.png` });
  if (m === 'clear') await page.click('#btn-next');
}
await sleep(9000); // エンディングの演出
await page.screenshot({ path: `${OUT}/99-ending.png` });
console.log(report.join('\n'));

// 面セレクト・保存の確認：再読み込みしても進行状況が残る
await page.reload(); await sleep(500);
const sv = await H(page, 'save');
if (Object.keys(sv.cleared).length !== 10) throw new Error('進行状況が保存されていない');
await page.click('#btn-title-select'); await sleep(200);
await page.screenshot({ path: `${OUT}/98-select.png` });
console.log('保存済みの星:', JSON.stringify(sv.cleared));

// スマホ（タッチ）：面1をタップと回転で確認
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const mp = await ctx.newPage(); watch(mp);
await mp.goto(BASE + '&level=3'); await sleep(500);
await clickThrough(mp, ['play']); await sleep(300);
const mst = await H(mp, 'state');
const c = await H(mp, 'cell', mst.mirrors[0].x, mst.mirrors[0].y);
await mp.touchscreen.tap(c.x, c.y); await sleep(100);
if ((await H(mp, 'state')).moves !== 1) throw new Error('タッチのタップで回転しない');
const box = await mp.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
if (box[0] > box[1]) throw new Error('横スクロールが出ている');
await mp.screenshot({ path: `${OUT}/mobile-L03.png` });
await mp.goto(BASE + '&level=10'); await sleep(500); await clickThrough(mp, ['play']); await sleep(300);
await mp.screenshot({ path: `${OUT}/mobile-L10.png` });

await browser.close();
if (errors.length) { console.log('エラー:\n' + errors.join('\n')); process.exit(1); }
console.log('OK：全10面クリア、エラーなし');
