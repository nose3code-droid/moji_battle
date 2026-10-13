// ブラウザ（Playwright + Chromium）で実際に遊んで、エラーが出ないか・全15面が解の配置でクリアできるか・
// 字によって倒れ方に差が出るか・物理が決定的かを確かめ、スクリーンショットも撮る。
// 使い方（リポジトリのルートで）：node games/domino/tools/e2e.mjs [スクリーンショットの出力先]
// CDN に届かない環境では、次の環境変数でローカルのファイルに差し替える：
//   LOCAL_RAPIER=…/rapier.mjs  LOCAL_OPENTYPE=…/opentype.mjs  LOCAL_THREE=…/three.module.js  LOCAL_FONT=…/日本語フォント.otf
//   （フォントは tools/mkfont.mjs で作れる）
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const OUT = process.argv[2] || '/tmp/domino-shots';
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

async function open(opts = {}, query = '?debug') {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, ...opts });
  await ctx.route(/cdn\.jsdelivr\.net/, route => {
    const u = route.request().url();
    const local = /three@/.test(u) ? process.env.LOCAL_THREE && path.join(path.dirname(process.env.LOCAL_THREE), u.split('/').pop())
      : /opentype/.test(u) ? process.env.LOCAL_OPENTYPE : /rapier/.test(u) ? process.env.LOCAL_RAPIER : /\.otf$/.test(u) ? process.env.LOCAL_FONT : null;
    if (!local) return route.continue();
    route.fulfill({ body: fs.readFileSync(local), contentType: /otf|ttf/.test(local) ? 'font/otf' : 'text/javascript' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${BASE}/games/domino/index.html${query}`);
  await page.waitForFunction(() => window.__domino && !document.getElementById('go').disabled, null, { timeout: 30000 });
  return { page, ctx };
}
const D = (page, fn, ...a) => page.evaluate(([f, args]) => window.__domino[f](...args), [fn, a]);

// ---------- 1. 字の性格と、字による倒れ方の差 ----------
let { page, ctx } = await open();
await page.screenshot({ path: path.join(OUT, '01-start.png') });
console.log('\n[字の性格]');
const traitRows = {};
for (const c of ['｜', 'I', '口', '日', '人', 'ハ', '〇', 'O']) {
  const t = await D(page, 'traits', c);
  traitRows[c] = t;
  console.log(`${c}  ${t.label}  倒れやすさ${t.tip} 重さ${t.heavy} 高さ${t.reach.toFixed(2)}m  限界角${(t.tipAngle * 57.3).toFixed(0)}°`);
}
check(traitRows['｜'].tip >= 4 && traitRows['I'].tip >= 4 && traitRows['口'].tip <= 2, '細長い字は倒れやすく、四角い字は倒れにくい');
check(traitRows['口'].heavy > traitRows['｜'].heavy && traitRows['口'].heavy > traitRows['I'].heavy, '四角い字は重い');
check(traitRows['〇'].roll && !traitRows['口'].roll, '丸い字だけが転がる');
check(traitRows['人'].stance < 0.95 && traitRows['ハ'].stance < 0.95, '「人」「ハ」は足が開いている');
// 同じ並び（4つ、間隔1.0m）で字だけ替えて、最初の1つを棒で押した結果
const diff = await page.evaluate(() => {
  const g = window.__domino, out = {};
  g.load(0);   // 平らな面1。3つの置き場に同じ字を並べ、棒で最初の1つを押す
  for (const c of ['｜', 'I', '口', '日', '人', 'ハ', '〇']) {
    const r = g.simulate([c, c, c], 2400);
    out[c] = r.fell.map(f => (Math.abs(f.a) > 0.9 ? 'F' : '.')).join('') + '/' + (r.result === 'clear' ? '鳴る' : '鳴らず');
  }
  return out;
});
console.log('\n[面1の3つ並びを同じ字で埋めたとき（F=倒れた、鐘が鳴るか）]', diff);
check(new Set(Object.values(diff)).size >= 3, '字によって倒れ方が3通り以上に変わる');
check(diff['｜'].startsWith('FF') && diff['｜'].endsWith('鳴る'), '背の高い「｜」は連鎖して倒れ、鐘まで届く');
check(diff['I'].startsWith('FF') && diff['I'].endsWith('鳴らず'), '同じ細長い字でも、短い「I」は届かない（倒れて届く長さが字の高さで決まる）');
check(['口', '日', '人', 'ハ'].every(c => diff[c].startsWith('...')), '四角い字・足の開いた字は倒れず、滑って押すだけ');
check(diff['〇'].startsWith('FFF'), '丸い「〇」は転がって全部を倒す（でも鐘は鳴らせない）');
// 決定的か
const s1 = await page.evaluate(() => JSON.stringify(window.__domino.simulate(['｜', 'I', '口'], 2400)));
const s2 = await page.evaluate(() => JSON.stringify(window.__domino.simulate(['｜', 'I', '口'], 2400)));
check(s1 === s2, '同じ配置なら結果（回転・位置）が完全に一致する（決定的）');
await ctx.close();

// ---------- 2. 全15面を解の配置で実際にクリア（画面の操作と同じ経路） ----------
({ page, ctx } = await open());
const n = await page.evaluate(() => window.__domino.levels.length);
check(n === 15, `面の数は 15（${n}）`);
await D(page, 'setSpeed', 6);
for (let i = 0; i < n; i++) {
  await D(page, 'load', i);
  await D(page, 'placeSolution', i);
  const placed = await D(page, 'glyphCount');
  if (i === 0) await page.screenshot({ path: path.join(OUT, '02-level1-placed.png') });
  await page.click('#go');
  let shot = false;
  try {
    await page.waitForFunction(() => window.__domino.mode() === 'cleared', null, { timeout: 40000 });
    if (!shot && [0, 2, 8].includes(i)) { await sleep(300); await page.screenshot({ path: path.join(OUT, `03-clear-${i + 1}.png`) }); }
  } catch { /* 下で失敗として数える */ }
  const mode = await D(page, 'mode');
  const par = await page.evaluate(k => window.__domino.solutions[k].par, i);
  check(mode === 'cleared', `面${i + 1}「${await page.evaluate(k => window.__domino.levels[k].name, i)}」：解（${placed}字、星3は${par}字）で鐘が鳴る`);
  if (mode === 'cleared') { await page.waitForSelector('#result:not([hidden])', { timeout: 5000 }).catch(() => {}); }
}
const st = await D(page, 'stars');
check(st.every(s => s === 3), `全面★3（${st.join('')}）`);
const saved = await page.evaluate(() => localStorage.getItem('moji_domino.stars'));
check(saved === JSON.stringify(st), '星が localStorage に保存される');
await ctx.close();

// ---------- 3. 失敗と戻し、保存の読み込み、選択画面 ----------
({ page, ctx } = await open());
await D(page, 'load', 0);
await D(page, 'setSpeed', 8);
await D(page, 'place', 0, 2);   // 面1の最初の置き場に「口」だけ
await page.click('#go');
await page.waitForFunction(() => window.__domino.mode() === 'failed', null, { timeout: 30000 });
const banner = await page.textContent('#banner');
check(/止ま|時間/.test(banner), `止まったままだと失敗になる（「${banner}」）`);
await page.waitForFunction(() => window.__domino.mode() === 'edit', null, { timeout: 10000 });
check((await D(page, 'slotHand'))[0] === 2, '失敗したら置いた状態のまま編集に戻る');
await ctx.close();

// ---------- 4. 実際のポインタ操作（スマホ想定の縦長）で面1をドラッグ＆タップで置いてクリア ----------
({ page, ctx } = await open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true }));
await D(page, 'load', 0);
await page.screenshot({ path: path.join(OUT, '04-mobile-edit.png') });
await D(page, 'setSpeed', 4);
const sol = await page.evaluate(() => window.__domino.solutions[0].placement);
const hand = await D(page, 'hand');
const usedH = new Set();
for (let si = 0; si < sol.length; si++) {
  if (!sol[si]) continue;
  const hi = hand.findIndex((c, k) => c === sol[si] && !usedH.has(k)); usedH.add(hi);
  const slots = await D(page, 'slotsPx');
  const [tx, ty] = await D(page, 'trayPx', hi);
  if (si === 0) {   // 1つ目はドラッグ
    await page.mouse.move(tx, ty); await page.mouse.down();
    await page.mouse.move((tx + slots[si][0]) / 2, (ty + slots[si][1]) / 2, { steps: 4 });
    await page.screenshot({ path: path.join(OUT, '05-mobile-dragging.png') });
    await page.mouse.move(slots[si][0], slots[si][1], { steps: 4 }); await page.mouse.up();
  } else {          // 残りは「札をタップ → 置き場をタップ」
    await page.mouse.click(tx, ty);
    await page.mouse.click(slots[si][0], slots[si][1]);
  }
}
const sh = await D(page, 'slotHand');
check(sh.filter(h => h >= 0).length === sol.filter(Boolean).length, `ドラッグとタップで札が置ける（${sh.join(',')}）`);
await page.screenshot({ path: path.join(OUT, '06-mobile-placed.png') });
await page.click('#go');
await sleep(900);
await page.screenshot({ path: path.join(OUT, '07-mobile-running.png') });
await page.waitForFunction(() => window.__domino.mode() === 'cleared', null, { timeout: 30000 });
await sleep(1900);
await page.screenshot({ path: path.join(OUT, '08-mobile-result.png') });
check(await page.isVisible('#result'), 'クリアすると結果（星）が出る');
await page.click('#to-select');
await page.screenshot({ path: path.join(OUT, '09-mobile-select.png') });
await ctx.close();

// ---------- 5. ヒント・やり直し・選択画面 ----------
({ page, ctx } = await open({}, '?debug'));
await D(page, 'load', 4);
await page.click('#hint'); await sleep(500);
await page.screenshot({ path: path.join(OUT, '10-hint.png') });
await page.click('#reset');
check((await D(page, 'slotHand')).every(h => h < 0), 'やり直しで置いた札が戻る');
await ctx.close();

console.log(errors.length ? '\nエラー：\n' + errors.join('\n') : '\nコンソールエラーなし');
check(errors.length === 0, 'ページにエラーが出ない');
await browser.close(); server.close();
console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
