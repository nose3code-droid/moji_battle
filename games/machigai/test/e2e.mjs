// ブラウザでの動作確認（Playwright + Chromium）。使い方：
//   node games/machigai/test/e2e.mjs <playwrightのパス> <three/opentypeを入れたディレクトリ> <日本語フォント> [スクリーンショットの出力先]
// CDN に届かない環境でも動くよう、CDN へのリクエストは手元のファイルに差し替える
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , pwPath, depsDir, fontFile, outDir = '.'] = process.argv;
const { chromium } = await import(pathToFileURL(path.join(pwPath, 'index.mjs')).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

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

async function open(w, h, { cdn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && cdn) errors.push(m.text()); });
  await page.route(/cdn\.jsdelivr\.net/, route => {
    const u = route.request().url();
    if (!cdn) return route.abort();
    if (u.endsWith('.otf')) return route.fulfill({ body: fs.readFileSync(fontFile), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } });
    const m = u.match(/npm\/(three|opentype\.js)@[^/]+\/(.*)$/);
    return route.fulfill({ body: fs.readFileSync(path.join(depsDir, 'node_modules', m[1], m[2])), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(`${base}/games/machigai/index.html?test`);
  await page.waitForFunction(() => window.__machigai);
  return { page, errors };
}
const st = page => page.evaluate(() => window.__machigai.state());
// 正解のマスを、実際に画面をタップして押す
async function tapCell(page, i) {
  const p = await page.evaluate(i => window.__machigai.cellCenter(i), i);
  await page.mouse.click(p.x, p.y);
}
async function tapOdd(page) { const s = await st(page); await tapCell(page, s.odd); return s; }
async function tapWrong(page) { const s = await st(page); await tapCell(page, (s.odd + 1) % (s.n * s.n)); return s; }
// 見つけた直後（450ms）の切りかえを待つ
const settle = page => page.waitForFunction(() => { const s = window.__machigai.state(); return s && !s.locked; });

// ---- PC幅：タイムアタック ----
{
  const { page, errors } = await open(1000, 800);
  await page.waitForFunction(() => window.__machigai.fontLoaded(), null, { timeout: 15000 }).catch(() => {});
  check('フォント（glyph.js の輪郭）を読めた', await page.evaluate(() => window.__machigai.fontLoaded()));
  await page.screenshot({ path: path.join(outDir, '01-title.png') });
  await page.click('#go-ta');
  let s = await st(page);
  check('3×3 から始まる', s.n === 3 && s.mode === 'ta');
  const sizes = [];
  for (let k = 0; k < 14; k++) {
    s = await st(page); sizes.push(s.n);
    if (k === 0) await page.screenshot({ path: path.join(outDir, '02-ta-3x3.png') });
    if (k === 3) {
      // まちがいタップ：時間が減る・点は変わらない
      const t0 = (await st(page)).time;
      await tapWrong(page);
      const t1 = (await st(page)).time;
      check('まちがえると時間が約5秒減る', t0 - t1 > 4.5 && t0 - t1 < 5.6, `(${t0.toFixed(1)}→${t1.toFixed(1)})`);
      // ヒント：点が減る
      const sc0 = (await st(page)).score;
      await page.click('#btn-hint');
      check('ヒントで50点減る', sc0 - (await st(page)).score === Math.min(50, sc0));
      check('ヒントは1盤1回', await page.evaluate(() => document.getElementById('btn-hint').disabled));
      await page.screenshot({ path: path.join(outDir, '03-ta-hint.png') });
    }
    if (k === 7) await page.screenshot({ path: path.join(outDir, '04-ta-10x10.png') });
    const before = (await st(page)).k;
    await tapOdd(page);
    await settle(page);
    const a = await st(page);
    if (a.k !== before + 1) { check(`第${k + 1}問で正解を押せた`, false); break; }
  }
  check('盤が 3→4→…→10 と広がり、10で止まる', sizes.join() === '3,4,5,6,7,8,9,10,10,10,10,10,10,10', sizes.join());
  check('見つけた解説が出る', (await page.textContent('#tipbar')).includes('≠'));
  // タイムアップ
  await page.evaluate(() => window.__machigai.setTime(0.4));
  await page.waitForSelector('#result:not([hidden])', { timeout: 5000 });
  check('タイムアップで結果が出る', (await page.textContent('#result-title')).includes('タイムアップ'));
  check('結果に問数が出る', (await page.textContent('#result-sub')).includes('14問'));
  const sv = await page.evaluate(() => window.__machigai.save());
  check('ハイスコア・ずかんが保存された', sv.best && sv.best.found === 14 && Object.keys(sv.dex).length >= 5, JSON.stringify(sv.best));
  await page.screenshot({ path: path.join(outDir, '05-ta-result.png') });
  // もう一度 → 新しいゲーム
  await page.click('#result-retry');
  s = await st(page);
  check('もう一度で3×3から再開', s.n === 3 && s.k === 0 && s.time > 55);
  // 時間が回復する
  const t0 = (await st(page)).time; await tapOdd(page);
  check('見つけると約3秒回復', (await st(page)).time - t0 > 2.5);
  // ずかん
  await page.click('#btn-book');
  await page.screenshot({ path: path.join(outDir, '06-book.png') });
  check('ずかんが開く', (await page.textContent('#book-count')).includes('/'));
  await page.click('#book-close');
  await page.click('#btn-quit');
  check('やめるでタイトルへ（ハイスコア表示）', (await page.textContent('#best-ta')).includes('点'));
  check('エラーなし', errors.length === 0, errors.join(' | '));
}

// ---- スマホ幅：ステージ全20面 ----
{
  const { page, errors } = await open(390, 780);
  await page.waitForFunction(() => window.__machigai.fontLoaded(), null, { timeout: 15000 }).catch(() => {});
  await page.click('#go-stage');
  check('最初は1面だけ選べる', await page.evaluate(() => [...document.querySelectorAll('.stage-btn')].filter(b => !b.disabled).length === 1));
  await page.screenshot({ path: path.join(outDir, '07-stages.png') });
  const sizes = [];
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => 0);
    if (i === 0) await page.click('.stage-btn[data-stage="0"]');
    let s = await st(page);
    sizes.push(s.n);
    for (let r = 0; r < 3; r++) {
      if (i === 1 && r === 0) { await tapWrong(page); await tapWrong(page); await tapWrong(page); } // 3ミス → ★1
      if (i === 2 && r === 0) { await tapWrong(page); }                                              // 1ミス → ★2
      if (i === 19 && r === 0) await page.screenshot({ path: path.join(outDir, '08-stage20-10x10-phone.png') });
      await tapOdd(page);
      if (r < 2) await settle(page);
    }
    await page.waitForSelector('#result:not([hidden])', { timeout: 5000 });
    const sv = await page.evaluate(() => window.__machigai.save());
    const want = i === 1 ? 1 : i === 2 ? 2 : 3;
    if (sv.stars[i] !== want) check(`ステージ${i + 1} の星`, false, `got ${sv.stars[i]} want ${want}`);
    if (i === 0) await page.screenshot({ path: path.join(outDir, '09-stage-result.png') });
    if (i < 19) await page.click('#result-next');
  }
  check('全20面を自動タップでクリア', true);
  check('面ごとに盤が広がる（3→10）', sizes[0] === 3 && sizes[19] === 10 && sizes.every((v, k) => k === 0 || v >= sizes[k - 1]), sizes.join());
  check('最終面は「つぎの面」なし', await page.evaluate(() => document.getElementById('result-next').hidden));
  const sv = await page.evaluate(() => window.__machigai.save());
  check('星がミスの数で決まる（0→3, 1→2, 3→1）', sv.stars[0] === 3 && sv.stars[1] === 1 && sv.stars[2] === 2);
  check('ずかんに多くのペアが載った', Object.keys(sv.dex).length >= 25, `${Object.keys(sv.dex).length}組`);
  check('スマホ幅で横スクロールなし', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const box = await page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return [r.width, innerWidth]; });
  check('盤が画面幅いっぱい', box[0] >= box[1] - 24, box.join('/'));
  check('エラーなし', errors.length === 0, errors.join(' | '));
}

// ---- CDN に届かないとき（ふつうの文字で遊べる） ----
{
  const { page, errors } = await open(390, 780, { cdn: false });
  await page.waitForFunction(() => document.getElementById('load-state').textContent.includes('ふつうの文字'), null, { timeout: 15000 });
  await page.click('#go-ta');
  await tapOdd(page); await settle(page);
  check('フォントなしでも遊べる', (await st(page)).k === 1);
  await page.screenshot({ path: path.join(outDir, '10-fallback.png') });
  check('例外なし', errors.length === 0, errors.join(' | '));
}

await browser.close();
server.close();
console.log(fails ? `${fails} 件失敗` : '全部OK');
process.exit(fails ? 1 : 0);
