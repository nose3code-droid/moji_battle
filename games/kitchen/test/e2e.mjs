// ブラウザでの動作確認（Playwright + Chromium）。使い方：
//   node games/kitchen/test/e2e.mjs <playwrightのパス> <three/opentypeを入れたディレクトリ> <日本語フォント(otf)> [出力先] [nocdn]
// CDN に届かない環境でも動くよう、CDN へのリクエストは手元のファイルに差し替える。
// 「nocdn」を付けると CDN をすべて失敗させ、ふつうの文字描画で遊べることを確かめる
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , pwPath, depsDir, fontFile, outDir = '.', mode = ''] = process.argv;
const NOCDN = mode === 'nocdn';
const { chromium } = await import(pathToFileURL(path.join(pwPath, 'index.mjs')).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { RECIPES, RANKS, PARTS } = await import(pathToFileURL(path.join(root, 'games/kitchen/logic.js')).href);
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

async function open(w, h, query = '?fast&debug') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !(NOCDN && /Failed to load resource|ERR_FAILED/.test(m.text()))) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route(/cdn\.jsdelivr\.net/, route => {
    if (NOCDN) return route.abort();
    const u = route.request().url();
    if (u.endsWith('.otf')) return route.fulfill({ body: fs.readFileSync(fontFile), contentType: 'font/otf' });
    const m = u.match(/npm\/(three|opentype\.js)@[^/]+\/(.*)$/);
    return route.fulfill({ body: fs.readFileSync(path.join(depsDir, 'node_modules', m[1], m[2])), contentType: 'text/javascript' });
  });
  await page.goto(`${base}/games/kitchen/index.html${query}`);
  await page.waitForFunction(() => window.__kitchen);
  return { page, errors, ctx };
}
const skipSay = async page => {
  for (let i = 0; i < 40 && await page.locator('#dialog').isVisible(); i++) await page.click('#say-next');
};
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `kitchen-${name}.png`) });
const book = page => page.evaluate(() => Object.keys(window.__kitchen.save.book));
const money = page => page.evaluate(() => window.__kitchen.save.money);

// 材料をタップで鍋に入れて「つくる」。足りない材料（作った字）は先に作る
async function cookRecipe(page, r, parts = r.parts) {
  for (const p of parts) {
    if (!PARTS[p] && !(await book(page)).includes(p)) await cookRecipe(page, RECIPES.find(x => x.ch === p));
  }
  for (const p of parts) await page.click(`#shelf [data-ch="${p}"]`);
  await page.click('#btn-cook');
  await page.waitForFunction(() => !window.__kitchen.busy || !document.getElementById('found').hidden, null, { timeout: 8000 });
  if (await page.locator('#found').isVisible()) await page.click('#found-ok');
  await page.waitForFunction(() => !window.__kitchen.busy || !document.getElementById('dialog').hidden, null, { timeout: 8000 }); // 最後の1つはエンディングの会話に入る
}

// ───── 1. 遊びはじめ（スマホ縦）─────
{
  const { page, errors } = await open(390, 844);
  check('導入の会話が出る', await page.locator('#dialog').isVisible());
  await shot(page, '1-intro');
  await skipSay(page);
  check('ランク1の棚に13個の部品', await page.locator('#shelf .card-part').count() === 13);
  check('戻りリンクがある', await page.locator('a.back[href="../../"]').first().isVisible());

  // こげる（罰は軽い）
  await page.evaluate(() => window.__kitchen.cheat({ money: 100 }));
  await page.click('#shelf [data-ch="日"]'); await page.click('#shelf [data-ch="石"]');
  await page.click('#btn-cook');
  await page.waitForFunction(() => !window.__kitchen.busy);
  check('まちがうとこげて材料代がかかる', await money(page) === 80, `money=${await money(page)}`);
  check('こげても図鑑には入らない', (await book(page)).length === 0);

  // ドラッグで鍋へ（マウス）
  const card = await page.locator('#shelf [data-ch="日"]').boundingBox(), pot = await page.locator('#pot').boundingBox();
  await page.mouse.move(card.x + 20, card.y + 20); await page.mouse.down();
  await page.mouse.move(pot.x + 90, pot.y + 40, { steps: 8 }); await page.mouse.up();
  check('ドラッグで鍋に入る', (await page.evaluate(() => window.__kitchen.pot)).join('') === '日');
  await page.click('#shelf [data-ch="月"]');
  await page.click('#btn-cook');
  await page.waitForTimeout(400);
  await shot(page, '2-cooking');
  await page.waitForSelector('#found:not([hidden])');
  await shot(page, '3-found');
  await page.click('#found-ok');
  check('明ができて図鑑に入る', (await book(page)).join('') === '明');

  // 注文を受けて渡す（タップ）
  await page.waitForFunction(() => window.__kitchen.custs.length > 0, null, { timeout: 15000 });
  let c = await page.evaluate(() => ({ ch: window.__kitchen.custs[0].r.ch, id: window.__kitchen.custs[0].id }));
  await cookRecipe(page, RECIPES.find(r => r.ch === c.ch));
  const before = await money(page);
  await page.click('#tray .dish:last-child');
  await page.click(`.cust[data-id="${c.id}"]`);
  await skipSay(page);
  check('渡すと売上が入る', await money(page) > before, `${before} → ${await money(page)}`);
  await shot(page, '4-served');

  // ドラッグで渡す
  await page.waitForFunction(() => window.__kitchen.custs.length > 0 && !document.querySelector('.cust.leaving'), null, { timeout: 15000 });
  c = await page.evaluate(() => ({ ch: window.__kitchen.custs[0].r.ch, id: window.__kitchen.custs[0].id }));
  await cookRecipe(page, RECIPES.find(r => r.ch === c.ch));
  const b2 = await money(page);
  const dish = await page.locator('#tray .dish').last().boundingBox(), face = await page.locator(`.cust[data-id="${c.id}"] .face`).boundingBox();
  await page.mouse.move(dish.x + 20, dish.y + 20); await page.mouse.down();
  await page.mouse.move(face.x + 25, face.y + 25, { steps: 8 }); await page.mouse.up();
  await skipSay(page);
  check('ドラッグで渡しても売上が入る', await money(page) > b2);

  // 保存と再読み込み
  const saved = await page.evaluate(() => JSON.stringify(window.__kitchen.save.book));
  await page.reload(); await page.waitForFunction(() => window.__kitchen);
  check('再読み込みで図鑑が残る', await page.evaluate(() => JSON.stringify(window.__kitchen.save.book)) === saved);
  check('導入は2回目は出ない', !(await page.locator('#dialog').isVisible()));
  check('エラーなし(1)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ───── 2. 全ランクを進めて、全レシピを作ってエンディング ─────
{
  const { page, errors } = await open(390, 844);
  await skipSay(page);
  for (let rank = 2; rank <= RANKS.length; rank++) {
    await page.evaluate(m => window.__kitchen.cheat({ money: m }), RANKS[rank - 1].cost);
    await page.click('#btn-expand');
    await skipSay(page);
    check(`ランク${rank}に広がる`, await page.evaluate(() => window.__kitchen.save.rank) === rank);
    check(`ランク${rank}の棚が増える`, await page.locator('#shelf .card-part').count() > 13);
    if (rank === 3) { await page.click('#btn-recipe'); await shot(page, '5-recipe-book'); await page.click('#recipe-close'); }
  }
  check('お金が引かれる', await money(page) === 0);
  await page.evaluate(() => window.__kitchen.cheat({ money: 0, rank: 5 }));
  let n = 0;
  for (const r of RECIPES) {
    // 材料の順番を変えても作れることも見る（逆順）
    await cookRecipe(page, r, r.parts.slice().reverse());
    if (!(await book(page)).includes(r.ch)) { check(`${r.ch} が作れる`, false, r.parts.join('+')); break; }
    n++;
    if (await page.locator('#dialog').isVisible()) await skipSay(page); // 最後はエンディングの会話
  }
  check(`全${RECIPES.length}レシピで漢字が完成`, n === RECIPES.length, `n=${n}`);
  await page.waitForSelector('#ending:not([hidden])', { timeout: 8000 });
  check('エンディングが見られる', await page.locator('#ending').isVisible());
  await shot(page, '6-ending');
  await page.click('#ending-keep');
  // 森の別レシピ
  for (let i = 0; i < 3; i++) await page.click('#shelf [data-ch="木"]');
  await page.click('#btn-cook'); await page.waitForFunction(() => !window.__kitchen.busy);
  check('木+木+木でも森', (await page.evaluate(() => window.__kitchen.save.tray)).slice(-1)[0] === '森');
  await page.click('#btn-zukan'); await page.click('#zukan-grid button.z >> nth=0');
  check('図鑑が全部そろう', (await page.locator('#zukan-count').textContent()).includes(`${RECIPES.length}/${RECIPES.length}`));
  await shot(page, '7-zukan');
  await page.click('#tab-guests'); await shot(page, '8-guests');
  await page.click('#zukan-close');
  await shot(page, '9-rank5');
  // 最初から
  await page.click('#btn-reset');
  await page.waitForFunction(() => window.__kitchen && window.__kitchen.save.rank === 1 && Object.keys(window.__kitchen.save.book).length === 0);
  check('最初からやり直せる', true);
  check('エラーなし(2)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ───── 3. パソコン幅 ─────
{
  const { page, errors } = await open(1100, 760);
  await skipSay(page);
  await page.waitForFunction(() => window.__kitchen.custs.length > 0, null, { timeout: 15000 });
  await shot(page, '10-desktop');
  check('エラーなし(3)', errors.length === 0, errors.join(' | '));
  await page.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} 件 FAIL` : 'ぜんぶ OK');
process.exit(fails ? 1 : 0);
