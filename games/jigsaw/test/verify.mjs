// 字のジグソーの自動検証：ブラウザ（Playwright）でゲームを開き、
//  1) いろいろな字×3つのむずかしさ×複数のシードで、ピースが正しく作られる（空・かけ・重なりがない／個数／同じ入力なら同じ形）
//  2) 実際にマウスでピースをドラッグして全部正しい位置に置くと完成する（むずかしいは、ダブルタップで回転も）
//  3) 遠くで離しても吸いつかない
//  4) スクリーンショットを撮る
// 使い方：node verify.mjs [--deps <opentype.js を npm install したフォルダ>] [--font <フォントファイル>] [--fallback] [--shots <保存先>] [--quick]
//   --deps / --font：CDN に届かない環境で、同じ名前のローカルファイルに差し替える　--fallback：フォント無し（canvas で代用）の経路を試す
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1] ?? true; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(process.env.PW_FROM || import.meta.url);
const { chromium } = require('playwright');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
}).listen(0);
const port = server.address().port;

const deps = arg('--deps'), fontFile = arg('--font'), fallback = !!arg('--fallback'), shots = arg('--shots'), quick = !!arg('--quick');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  ✗ ' + msg); } return cond; };

async function open(query, viewport = { width: 420, height: 800 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: false });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !(fallback && /ERR_FAILED/.test(m.text()))) errors.push('console: ' + m.text()); });
  await page.route(/cdn\.jsdelivr\.net/, route => {
    const url = route.request().url();
    if (fallback) return route.abort();
    if (/opentype\.js@/.test(url) && deps) return route.fulfill({ path: path.join(deps, 'node_modules/opentype.js', url.split('opentype.js@2.0.0/')[1]) });
    if (/\.otf$/.test(url) && fontFile) return route.fulfill({ path: fontFile, contentType: 'font/ttf' });
    return route.continue();
  });
  await page.goto(`http://localhost:${port}/games/jigsaw/index.html?${query}`);
  await page.waitForFunction(() => window.__jigsaw && window.__jigsaw.puz, null, { timeout: 30000 });
  return page;
}

// ---- 1) ピースの検査 ----
const page0 = await open('ch=龍&lv=1&seed=1');
console.log('輪郭モード：', await page0.evaluate(() => __jigsaw.usingOutline()) ? 'opentype.js（フォントの輪郭）' : 'canvas で代用');
const TEXTS = quick ? ['龍', '口', '一', 'ハ', 'S'] : ['龍', '口', '一', 'ハ', '川', 'あ', 'S', '鬱', '森', '愛', '春', '三', '回', 'i', '.', '亀'];
const SEEDS = quick ? [1, 2] : [1, 2, 3, 12345];
const report = await page0.evaluate(({ TEXTS, SEEDS }) => {
  const rows = [], fails = [];
  for (const t of TEXTS) for (let lv = 0; lv < 3; lv++) for (const sd of SEEDS) {
    const r = __jigsaw.check(t, lv, sd);
    const sig = __jigsaw.signature(t, lv, sd), again = __jigsaw.signature(t, lv, sd);
    const tag = `${t} lv${lv} seed${sd}`;
    if (sig !== again) fails.push(`${tag}：同じ入力なのにピースが違う`);
    if (r.empty) fails.push(`${tag}：空のピースが ${r.empty} 個`);
    if (!r.unique) fails.push(`${tag}：同じ位置のピースがある`);
    if (r.lost > Math.max(6, r.ink * 0.002)) fails.push(`${tag}：字がかけている（${r.lost}/${r.ink} px）`);
    if (r.extra > Math.max(6, r.ink * 0.002)) fails.push(`${tag}：字にない部分がある（${r.extra} px）`);
    if (r.overlap > 6) fails.push(`${tag}：ピースが重なっている（${r.overlap} px）`);
    rows.push({ t, lv, sd, n: r.pieces });
  }
  return { rows, fails };
}, { TEXTS, SEEDS });
const summary = {};
for (const r of report.rows) (summary[`${r.t}`] ??= [[], [], []])[r.lv].push(r.n);
console.log('ピース数（字: やさしい / ふつう / むずかしい）');
for (const [t, v] of Object.entries(summary)) console.log(`  ${t}: ${v.map(a => [...new Set(a)].join(',')).join(' / ')}`);
report.fails.forEach(f => ok(false, f));
ok(report.fails.length === 0, '検査の失敗なし');
// 画数の多い字ほど細かい部分が入り込む（龍・鬱で かけ なし）は上で確認済み
// 個数の目安
for (const r of report.rows) {
  if (['龍', '鬱', '愛', '森', '春'].includes(r.t)) {
    if (r.lv === 0) ok(r.n >= 5 && r.n <= 10, `${r.t} やさしい ${r.n}個（6〜9のはず）`);
    if (r.lv === 1) ok(r.n >= 12 && r.n <= 20, `${r.t} ふつう ${r.n}個（約16のはず）`);
    if (r.lv === 2) ok(r.n >= 28, `${r.t} むずかしい ${r.n}個（30以上のはず）`);
  }
}
await page0.context().close();

// ---- 2) 実際に遊ぶ ----
const PLAY = quick ? [['龍', 0], ['口', 1], ['一', 2]] : [['龍', 0], ['龍', 1], ['龍', 2], ['口', 0], ['口', 1], ['口', 2], ['一', 0], ['一', 2], ['ハ', 1], ['川', 2], ['あ', 1], ['S', 2], ['鬱', 2], ['愛', 1]];
for (const [ch, lv] of PLAY) {
  const page = await open(`ch=${encodeURIComponent(ch)}&lv=${lv}&seed=7`);
  const box = await page.locator('#view').boundingBox();
  const info = () => page.evaluate(() => ({
    mode: __jigsaw.mode, moves: __jigsaw.moves,
    pcs: __jigsaw.pcs.map(p => ({ id: p.g.id, z: p.z, placed: p.placed, rot: p.rot, pos: __jigsaw.posOf(p), tgt: __jigsaw.target(p) })),
  }));
  let st = await info();
  const n = st.pcs.length;
  // 遠くで離しても吸いつかない：1個目を正解から離れた場所へ
  {
    const p = st.pcs.slice().sort((a, b) => b.z - a.z)[0];
    const fx = p.tgt.x > 200 ? p.tgt.x - 120 : p.tgt.x + 120, fy = p.tgt.y;
    await page.mouse.move(box.x + p.pos.x, box.y + p.pos.y); await page.mouse.down();
    await page.mouse.move(box.x + fx, box.y + fy, { steps: 4 }); await page.mouse.up();
    st = await info();
    ok(!st.pcs[p.id].placed, `${ch} lv${lv}：遠くで離したのに吸いついた`);
  }
  if (shots && ch === '龍') await page.screenshot({ path: path.join(shots, `play-${lv}-start.png`) });
  let half = false;
  for (let k = 0; k < n; k++) {
    st = await info();
    // いちばん上のピースから取る（重なっていても、上のピースの真ん中は必ずそのピースに当たる）
    const p = st.pcs.filter(q => !q.placed).sort((a, b) => b.z - a.z)[0];
    if (!p) break;
    const i = p.id;
    let rot = p.rot;
    for (let t = 0; t < 4 && rot !== 0; t++) {   // 回転を直す（ダブルタップ）
      await page.mouse.click(box.x + p.pos.x, box.y + p.pos.y); await page.mouse.click(box.x + p.pos.x, box.y + p.pos.y);
      rot = (await info()).pcs[i].rot;
    }
    ok(rot === 0, `${ch} lv${lv}：ピース${i} が回転で直らない`);
    // 正解位置から少しずれた場所で離す
    await page.mouse.move(box.x + p.pos.x, box.y + p.pos.y); await page.mouse.down();
    await page.mouse.move(box.x + p.tgt.x + 3, box.y + p.tgt.y - 3, { steps: 6 }); await page.mouse.up();
    if (!half && k >= n / 2) {
      half = true;
      if (shots && ch === '龍') await page.screenshot({ path: path.join(shots, `play-${lv}-half.png`) });
    }
  }
  st = await info();
  ok(st.pcs.every(p => p.placed), `${ch} lv${lv}：全部置けなかった（${st.pcs.filter(p => p.placed).length}/${n}）`);
  ok(st.mode === 'done', `${ch} lv${lv}：完成にならない`);
  // 完成後の字が元の字と一致するか（ピースの正解位置で描いた画面を見る）は selfCheck で済み
  await page.waitForSelector('#result:not([hidden])', { timeout: 5000 }).catch(() => ok(false, `${ch} lv${lv}：結果が出ない`));
  if (shots && ['龍', '口', '一'].includes(ch)) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, `clear-${ch}-${lv}.png`) }); }
  console.log(`  ${ch} ${['やさしい', 'ふつう', 'むずかしい'][lv]}：${n}ピース → 完成 (${st.moves}手)`);
  await page.context().close();
}

// ---- 3) 画面まわり（ヒント・整列・枠・記録・字えらび） ----
{
  const page = await open('ch=森&lv=1&seed=3');
  await page.click('#btn-hint');
  ok(await page.evaluate(() => !!document.querySelector('#toast.show')), 'ヒントのメッセージが出ない');
  await page.click('#btn-sort');
  await page.click('#btn-ghost');
  await page.click('#btn-ghost');
  if (shots) await page.screenshot({ path: path.join(shots, 'sorted.png') });
  await page.click('#btn-char');
  await page.fill('#char', '春'); await page.click('#form button[type=submit]');
  ok(await page.evaluate(() => __jigsaw.puz.pieces.length > 4), '入力した字でパズルにならない');
  await page.click('#btn-auto');
  await page.click('#levels button:nth-child(3)');
  const stored = await page.evaluate(() => localStorage.getItem('moji_jigsaw.best'));
  console.log('  ヒント・整列・枠・字えらび・むずかしさ切替：操作できた', stored ? '' : '(記録はまだ無し)');
  // ベスト記録：1手で終わらせて localStorage を見る
  await page.goto(`http://localhost:${port}/games/jigsaw/index.html?ch=%E4%B8%80&lv=0&seed=1`);
  await page.waitForFunction(() => window.__jigsaw && window.__jigsaw.puz);
  const box = await page.locator('#view').boundingBox();
  for (let k = 0; k < 12; k++) {
    const st = await page.evaluate(() => __jigsaw.pcs.filter(p => !p.placed).sort((a, b) => b.z - a.z).map(p => ({ pos: __jigsaw.posOf(p), tgt: __jigsaw.target(p) })));
    if (!st[0]) break;
    await page.mouse.move(box.x + st[0].pos.x, box.y + st[0].pos.y); await page.mouse.down();
    await page.mouse.move(box.x + st[0].tgt.x, box.y + st[0].tgt.y, { steps: 5 }); await page.mouse.up();
  }
  const rec = await page.evaluate(() => localStorage.getItem('moji_jigsaw.best'));
  ok(!!rec, 'ベスト記録が保存されない');
  console.log('  保存された記録：', rec);
  await page.context().close();
}

// ---- 4) 横長の画面 ----
{
  const page = await open('ch=龍&lv=1&seed=1', { width: 1000, height: 640 });
  if (shots) await page.screenshot({ path: path.join(shots, 'landscape.png') });
  await page.context().close();
}

await browser.close();
server.close();
if (errors.length) { console.log('ブラウザのエラー：'); errors.slice(0, 10).forEach(e => console.log('  ' + e)); }
ok(errors.length === 0, 'ブラウザにエラーが出ていない');
console.log(failed ? `失敗 ${failed} 件` : 'すべて合格');
process.exit(failed ? 1 : 0);
