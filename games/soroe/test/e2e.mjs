// ブラウザでの動作確認（Playwright + Chromium）。使い方：
//   node games/soroe/test/e2e.mjs <playwrightのパス> <three/opentypeを入れたnode_modules> <日本語フォント>
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

async function open(w, h, query = '') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/cdn\.jsdelivr\.net/, route => {
    const u = route.request().url();
    if (u.endsWith('.otf')) return route.fulfill({ body: fs.readFileSync(fontFile), contentType: 'font/ttf' });
    const m = u.match(/npm\/(three|opentype\.js)@[^/]+\/(.*)$/);
    const file = path.join(depsDir, 'node_modules', m[1], m[2]);
    return route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
  });
  await page.goto(`${base}/games/soroe/index.html${query}`);
  await page.waitForFunction(() => window.__soroe);
  return { page, errors, ctx };
}
const st = page => page.evaluate(() => { const s = window.__soroe.state; return { left: s.left, score: s.prog.score, goals: s.prog.goals, busy: s.busy, saved: s.saved, dbg: JSON.parse(JSON.stringify(window.__soroe.dbg)) }; });
const idle = page => page.waitForFunction(() => !window.__soroe.state.busy || document.getElementById('result').hidden === false, null, { timeout: 30000 });
// ふつうの字を ((行*2+列)%4) で並べると、どこにも3つそろわない
const FILL = '日月人口';
const base8 = () => Array.from({ length: 8 }, (_, r) => [...Array(8)].map((_, c) => FILL[(r * 2 + c) % 4]));
const setBoard = (page, rows) => page.evaluate(r => window.__soroe.setBoard(r.map(x => x.join(''))), rows);

// ---- PC幅：基本の遊び ----
{
  const { page, errors } = await open(1000, 800, '?fast');
  await page.waitForFunction(() => window.__soroe.fontLoaded(), null, { timeout: 15000 }).catch(() => {});
  check('フォント（glyph.js の輪郭）を読めた', await page.evaluate(() => window.__soroe.fontLoaded()));
  await page.screenshot({ path: path.join(outDir, '01-title.png') });
  await page.evaluate(() => window.__soroe.start(0));
  await page.waitForFunction(() => !window.__soroe.state.busy);

  // 森（木3つ）
  let rows = base8();
  rows[3][0] = rows[3][1] = '木'; rows[2][2] = '木';
  await setBoard(page, rows);
  let s0 = await st(page);
  await page.evaluate(() => window.__soroe.move([2, 2], [3, 2]));
  await idle(page);
  let s1 = await st(page);
  check('3つそろえて消え、森ができ、得点が入る', s1.dbg.made.includes('森') && s1.score > s0.score && s1.left === s0.left - 1, JSON.stringify(s1.goals));
  check('消えたあと上から落ちる・補充される', s1.dbg.fell > 0);
  check('漢字カードが保存された', s1.saved.cards['森'] === 1);

  // 明（日と月が隣り合う）
  rows = base8();
  rows[4][3] = '日'; rows[4][5] = '月'; rows[3][4] = '日';  // 日(3,4) を下の(4,4)と入れ替え→ 日(4,4) が 月(4,5) と隣り合う、日(4,3)ともそろう…
  rows[4][3] = '人';
  await setBoard(page, rows);
  s0 = await st(page);
  await page.evaluate(() => window.__soroe.move([3, 4], [4, 4]));
  await idle(page);
  s1 = await st(page);
  check('日と月で明が完成する', s1.dbg.made.includes('明'));

  // 爆（4つ）と 虹（5つ）
  rows = base8();
  rows[6][0] = rows[6][1] = rows[6][3] = '木'; rows[5][2] = '木';
  await setBoard(page, rows);
  await page.evaluate(() => window.__soroe.move([5, 2], [6, 2]));
  await idle(page);
  s1 = await st(page);
  check('4つそろえると「爆」ができる', s1.dbg.created.includes('bomb'));
  rows = base8();
  rows[6][0] = rows[6][1] = rows[6][3] = rows[6][4] = '木'; rows[5][2] = '木';
  await setBoard(page, rows);
  await page.evaluate(() => window.__soroe.move([5, 2], [6, 2]));
  await idle(page);
  s1 = await st(page);
  check('5つそろえると「虹」ができる', s1.dbg.created.includes('rainbow'));

  // 無効な手は元に戻る
  rows = base8();
  await setBoard(page, rows);
  s0 = await st(page);
  await page.evaluate(() => window.__soroe.move([0, 0], [0, 1]));
  await idle(page);
  s1 = await st(page);
  check('何も消えない手は元に戻り、手数も減らない', s1.left === s0.left && s1.score === s0.score);

  // ヒントとランダムプレイ（連鎖が起きるまで）
  await page.evaluate(() => window.__soroe.start(5));
  await page.waitForFunction(() => !window.__soroe.state.busy);
  await page.click('#btn-hint');
  for (let i = 0; i < 60; i++) {
    const done = await page.evaluate(() => !document.getElementById('result').hidden);
    if (done) break;
    await page.evaluate(() => { const m = window.__soroe.listMoves(); const [a, b] = m[Math.floor(Math.random() * m.length)]; return window.__soroe.move(a, b); });
    await idle(page);
  }
  s1 = await st(page);
  check('連鎖（2連鎖以上）が起きた', s1.dbg.maxChain >= 2, `maxChain=${s1.dbg.maxChain}`);
  check('エラーが出ていない', errors.length === 0, errors.join(' | '));
  await page.evaluate(() => document.getElementById('result').hidden = true);
  await page.click('#btn-book');
  await page.screenshot({ path: path.join(outDir, '04-book.png') });
}

// ---- スマホ幅：見た目とスワイプ ----
{
  const { page, errors } = await open(390, 780);
  await page.waitForFunction(() => window.__soroe.fontLoaded(), null, { timeout: 15000 }).catch(() => {});
  await page.click('.stage-btn[data-i="0"]');
  await page.waitForFunction(() => !window.__soroe.state.busy, null, { timeout: 15000 });
  await page.screenshot({ path: path.join(outDir, '02-play.png') });
  // 森をつくって、漢字が光っている瞬間を撮る
  const rows = base8();
  rows[3][0] = rows[3][1] = '木'; rows[2][2] = '木';
  await setBoard(page, rows);
  const box = await page.locator('#view').boundingBox();
  const cell = box.width / 8, cx = c => box.x + (c + 0.5) * cell, cy = r => box.y + (r + 0.5) * cell;
  // スワイプ（(2,2) から下へ）
  await page.mouse.move(cx(2), cy(2)); await page.mouse.down(); await page.mouse.move(cx(2), cy(2) + cell * 0.8, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, '03-kanji.png') });
  await idle(page);
  const s = await st(page);
  check('スワイプで入れ替えて森が完成した', s.dbg.made.includes('森'));
  // タップ→タップ
  await page.evaluate(() => window.__soroe.start(0));
  await page.waitForFunction(() => !window.__soroe.state.busy);
  const rows2 = base8(); rows2[3][0] = rows2[3][1] = '木'; rows2[2][2] = '木';
  await setBoard(page, rows2);
  await page.mouse.click(cx(2), cy(2)); await page.mouse.click(cx(2), cy(3));
  await idle(page);
  check('タップ→タップでも入れ替えられる', (await st(page)).dbg.made.length >= 2);
  check('スマホ幅でエラーなし', errors.length === 0, errors.join(' | '));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check('横にはみ出さない', !overflow);
}

// ---- CDN に届かない場合（three/opentype が読めない）でも遊べる ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/cdn\.jsdelivr\.net/, r => r.abort());
  await page.goto(`${base}/games/soroe/index.html?fast`);
  await page.waitForFunction(() => window.__soroe);
  await page.click('.stage-btn[data-i="0"]');
  await page.waitForFunction(() => !window.__soroe.state.busy, null, { timeout: 15000 });
  await page.evaluate(() => { const m = window.__soroe.listMoves(); return window.__soroe.move(...m[0]); });
  await idle(page);
  check('CDN に届かなくても（ふつうの文字描画で）遊べる', errors.length === 0 && (await st(page)).left === 19, errors.join('|'));
  await page.screenshot({ path: path.join(outDir, '05-nofont.png') });
}

await browser.close(); server.close();
console.log(fails ? `${fails} 件失敗` : '全部OK');
process.exit(fails ? 1 : 0);
