// ブラウザでの動作確認（Playwright + Chromium）。使い方：
//   node games/tenbin/test/e2e.mjs <playwrightのindex.mjsがあるフォルダ> [画像の出力先]
// 全30面を、解のとおりに「実際にドラッグ」してクリアできることを確かめる。CDN のフォントは使わない（ふつうの文字で表示）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STAGES } from '../stages.js';
import { allSolutions, usedCount } from '../logic.js';

const [, , pwPath, outDir = '.'] = process.argv;
const { chromium } = await import(pathToFileURL(path.join(pwPath, 'index.mjs')).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

async function open(w, h, query = '?fast') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route(/cdn\.jsdelivr\.net/, r => r.abort());
  await page.goto(`${base}/games/tenbin/index.html${query}`);
  await page.waitForFunction(() => window.__tenbin);
  return { page, errors };
}
const st = page => page.evaluate(() => window.__tenbin.state);
// 手元の k 番目のカードを、p 番目の皿へドラッグ
async function drag(page, k, p) {
  const from = await page.evaluate(k => { const r = document.querySelectorAll('#hand .slot')[k].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, k);
  const to = await page.evaluate(p => window.__tenbin.panScreen(p), p);
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
}

// ---- PC幅：全30面を解のとおりにドラッグ ----
{
  const { page, errors } = await open(900, 760);
  await page.screenshot({ path: path.join(outDir, 'title.png') });
  let shot = false;
  for (let i = 0; i < STAGES.length; i++) {
    await page.evaluate(i => window.__tenbin.startStage(i), i);
    const sols = allSolutions(STAGES[i]);
    const sol = sols.reduce((a, b) => (usedCount(b) < usedCount(a) ? b : a));
    const before = await st(page);
    check(`面${i + 1} 最初は未クリア`, !before.solved && !before.won);
    for (let k = 0; k < sol.length; k++) if (sol[k] >= 0) await drag(page, k, sol[k]);
    await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 15000 }).catch(() => {});
    const s = await st(page);
    const stars = await page.evaluate(i => window.__tenbin.save.stars[i], i);
    check(`面${i + 1} ${STAGES[i].name} 解のとおりに置くとクリア`, s.won && s.solved && stars === 3, `使用${usedCount(s.assign)}枚 星${stars}`);
    if ([0, 8, 14, 20, 29].includes(i)) await page.screenshot({ path: path.join(outDir, `clear-${i + 1}.png`) });
  }
  check('エラーなし(PC)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---- スマホ幅：タップ・ヒント・やり直し・保存・見た目 ----
{
  const { page, errors } = await open(390, 740);
  await page.click('[data-stage="0"]');
  await page.waitForTimeout(100);
  await page.click('#btn-hint');
  let s = await st(page);
  check('ヒントで回数が増える', s.hints === 1);
  await page.screenshot({ path: path.join(outDir, 'mobile-hint.png') });
  await page.click('#btn-reset');
  // 間違った置き方 → かたむく
  await page.evaluate(() => window.__tenbin.startStage(5));
  await page.mouse.click(0, 0);
  await drag(page, 2, 0);
  await page.waitForTimeout(1200);
  s = await st(page);
  check('置くとかたむく（ゆれ後）', Math.abs(s.th) > 0.05 && !s.won, `th=${s.th.toFixed(2)}`);
  await page.screenshot({ path: path.join(outDir, 'mobile-tilt.png') });
  // タップで皿に載り、もう一度タップで戻る
  await page.click('#btn-reset');
  await page.click('#hand .slot >> nth=0 >> .tcard');
  s = await st(page);
  check('タップで皿にのる', s.assign[0] >= 0, JSON.stringify(s.assign));
  await page.click('.tcard.onpan:not(.fixed)');
  s = await st(page);
  check('皿の字をタップで手元にもどる', s.assign[0] === -1);
  // 三つ皿の見た目
  await page.evaluate(() => window.__tenbin.startStage(29));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'mobile-three.png') });
  await page.evaluate(() => window.__tenbin.startStage(10));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'mobile-exact.png') });
  // 保存の読み込み
  await page.reload(); await page.waitForFunction(() => window.__tenbin);
  check('エラーなし(スマホ)', errors.length === 0, errors.join(' | '));
  await page.close();
}
await browser.close(); server.close();
console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
