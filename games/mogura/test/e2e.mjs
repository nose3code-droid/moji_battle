// ブラウザでの動作確認（Playwright + Chromium）。使い方：
//   node games/mogura/test/e2e.mjs <playwrightのパス> [スクリーンショットの出力先]
// 正解の字だけを実際に画面タップして、全10ラウンドを最後まで進める（時間は ?fast=3 で3倍速）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

async function open(w, h, fast, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/games/mogura/index.html?fast=${fast}`);
  await page.waitForFunction(() => window.__mogura);
  return { page, errors };
}
const st = page => page.evaluate(() => window.__mogura.state());

// ---- スマホ幅：全10ラウンドを正解だけ叩いて通す ----
{
  const { page, errors } = await open(390, 780, 3, true);
  await page.screenshot({ path: path.join(outDir, '01-title.png') });
  await page.click('#go-all');
  for (let r = 0; r < 10; r++) {
    await page.screenshot({ path: path.join(outDir, `intro-${r + 1}.png`) }).catch(() => {});
    await page.click('#intro-go');
    let shot = false, hits = 0;
    while (true) {
      const s = await st(page);
      if (s.done) break;
      for (let i = 0; i < s.holes.length; i++) {
        const h = s.holes[i];
        if (h && h.target) {
          const p = await page.evaluate(i => window.__mogura.holeCenter(i), i);
          await page.touchscreen.tap(p.x, p.y); hits++;
        }
      }
      if (!shot && hits >= 4 && (r === 0 || r === 6)) { await page.screenshot({ path: path.join(outDir, `play-${r + 1}.png`) }); shot = true; }
      await page.waitForTimeout(20);
    }
    await page.waitForSelector('#rresult:not([hidden])');
    const sc = await page.textContent('#rr-score');
    check(`ラウンド${r + 1} 終了`, hits > 5 && parseInt(sc) > 0, `(${sc}, hits=${hits})`);
    if (r === 9) await page.screenshot({ path: path.join(outDir, '08-round-result.png') });
    await page.click('#rr-next');
  }
  await page.waitForSelector('#final:not([hidden])');
  await page.screenshot({ path: path.join(outDir, '09-final.png') });
  const rank = await page.textContent('#fin-rank');
  check('結果画面にランクが出る', /^[SABC]$/.test(rank), `(${rank} ${await page.textContent('#fin-total')})`);
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('moji_mogura.v1')).best);
  check('ハイスコアが保存された', best > 0, `(${best})`);
  check('エラーなし', errors.length === 0, errors.join(' | '));
  // もう一度・ラウンド選択
  await page.click('#fin-select');
  check('ラウンド選択が開く', (await page.locator('.sel-btn').count()) === 10);
  await page.screenshot({ path: path.join(outDir, '10-select.png') });
  await page.locator('.sel-btn').nth(3).click();
  check('選んだラウンドのお題が出る', (await page.textContent('#intro-title')).includes('日'));
}

// ---- お題に合わない字を叩く：ライフが減る・0で終わる ----
{
  const { page, errors } = await open(1000, 760, 1, false);
  await page.click('#go-all');
  await page.click('#intro-go');
  let wrong = 0, shot = false;
  while (wrong < 3) {
    const s = await st(page);
    const i = s.holes.findIndex(h => h && !h.target);
    if (i >= 0) {
      const p = await page.evaluate(i => window.__mogura.holeCenter(i), i);
      await page.mouse.click(p.x, p.y); wrong++;
      const s2 = await st(page);
      check(`まちがい${wrong}回目でライフ${3 - wrong}`, s2.life === 3 - wrong);
      if (!shot) { await page.screenshot({ path: path.join(outDir, '11-wrong-pc.png') }); shot = true; }
    }
    await page.waitForTimeout(30);
  }
  await page.waitForSelector('#rresult:not([hidden])', { timeout: 5000 });
  check('ライフ0でラウンド終了', (await page.textContent('#rr-title')).includes('ライフ'));
  check('エラーなし(2)', errors.length === 0, errors.join(' | '));
}
await browser.close();
server.close();
console.log(fails ? 'NG' : 'OK');
process.exit(fails ? 1 : 0);
