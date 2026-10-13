// ブラウザでの自動テスト：Playwright + Chromium。実際にカードをクリックして、CPU 対戦を最後まで進める
// 実行例: NODE_PATH=$(npm root -g) だとESMでは解決されないので、playwright/index.mjs への絶対パスに置き換えて実行した
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(new URL('../../../', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
await new Promise(r => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}/games/torampu/index.html`;
const out = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let bad = 0;
const errors = [];
async function play(count, level, seed, shot) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}?fast&seed=${seed}`);
  await page.click(`#opt-count [data-v="${count}"]`); await page.click(`#opt-level [data-v="${level}"]`);
  if (shot) await page.screenshot({ path: `${out}/title.png` });
  await page.click('#btn-start');
  let shots = 0, turns = 0;
  while (await page.locator('#result').isHidden()) {
    const info = await page.evaluate(() => {
      const t = window.__torampu, st = t.st; if (!st || st.over || st.cur !== 0) return null;
      if (document.getElementById('btn-make').disabled && document.getElementById('hand').classList.contains('disabled')) return null;
      const m = t.bestMove(st.players[0].hand);
      return { ids: m ? m.cards.map(c => c.id) : null };
    });
    if (!info) { await page.waitForTimeout(40); continue; }
    turns++;
    if (info.ids) {
      for (const id of info.ids) await page.click(`#hand [data-id="${id}"]`);
      if (shot && shots === 0) { await page.screenshot({ path: `${out}/selected.png` }); shots++; }
      await page.click('#btn-make');
      if (shot && shots === 1) { await page.waitForTimeout(120); await page.screenshot({ path: `${out}/made.png` }); shots++; }
    } else await page.click('#btn-draw');
    await page.waitForTimeout(60);
    if (turns > 200) { bad++; console.log('NG: 決着しない'); break; }
  }
  const res = await page.evaluate(() => ({ title: document.getElementById('result-title').textContent, scores: document.getElementById('result-scores').textContent }));
  console.log(`${count}人/${level}/seed${seed}: ${res.title} ${res.scores} (人間の手番 ${turns})`);
  if (shot) await page.screenshot({ path: `${out}/result.png` });
  await page.close();
}
await play(2, 'normal', 11, true);
await play(3, 'easy', 12, false);
await play(4, 'hard', 13, false);
// 誤った組み合わせ・ヒント・特別カードの動作
{
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${base}?fast&seed=21`);
  await page.click('#btn-start');
  await page.waitForFunction(() => !document.getElementById('btn-hint').disabled);
  // 失敗しても手札にもどる
  const before = await page.evaluate(() => window.__torampu.st.players[0].hand.length);
  const ids = await page.evaluate(() => { const h = window.__torampu.st.players[0].hand; const bad = []; for (const a of h) for (const b of h) if (a !== b && a.kind === 'part' && b.kind === 'part' && !window.__torampu.bestMove([a, b])) { return [a.id, b.id]; } return null; });
  if (ids) { for (const id of ids) await page.click(`#hand [data-id="${id}"]`); await page.click('#btn-make'); await page.waitForTimeout(100);
    const after = await page.evaluate(() => window.__torampu.st.players[0].hand.length);
    console.log('失敗時の手札', before, '→', after); if (before !== after) { bad++; console.log('NG: 手札が変わった'); } }
  await page.click('#btn-hint'); await page.waitForTimeout(80);
  const hl = await page.locator('#hand .hint').count(); console.log('ヒントで光ったカード', hl); if (hl < 2) { bad++; console.log('NG: ヒント'); }
  await page.screenshot({ path: `${out}/hint.png` });
  await page.click('#btn-book'); await page.screenshot({ path: `${out}/book.png` });
  await page.close();
}
console.log('ページのエラー:', errors.length ? errors : 'なし');
await browser.close(); srv.close();
process.exit(bad || errors.length ? 1 : 0);
