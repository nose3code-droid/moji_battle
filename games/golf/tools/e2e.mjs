// ブラウザ（Playwright + Chromium）で実際に遊んで、全9ホールでカップインできるか・字ごとに差が出るかを確かめる。
// 使い方（リポジトリのルートで）：node games/golf/tools/e2e.mjs [スクリーンショットの出力先]
// CDN に届かない環境では、次の環境変数でローカルのファイルに差し替える：
//   LOCAL_THREE=…/three.module.js  LOCAL_OPENTYPE=…/opentype.mjs  LOCAL_FONT=…/日本語フォント.ttf
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const OUT = process.argv[2] || '/tmp/golf-shots';
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
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 820 }, ...opts });
  await ctx.route(/cdn\.jsdelivr\.net/, route => {
    const u = route.request().url();
    // three は three.module.js が同じフォルダの three.core.js を読むので、フォルダごと差し替える
    const local = /three@/.test(u) ? process.env.LOCAL_THREE && path.join(path.dirname(process.env.LOCAL_THREE), u.split('/').pop())
      : /opentype/.test(u) ? process.env.LOCAL_OPENTYPE : /\.otf$/.test(u) ? process.env.LOCAL_FONT : null;
    if (!local) return route.continue();
    route.fulfill({ body: fs.readFileSync(local), contentType: /otf|ttf/.test(local) ? 'font/ttf' : 'text/javascript' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${BASE}/games/golf/index.html?debug`);
  await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 30000 });
  return page;
}
const G = (page, fn, ...a) => page.evaluate(([f, args]) => window.__golf[f](...args), [fn, a]);
const waitMode = async (page, m, ms = 20000) => { await page.waitForFunction(m2 => window.__golf.mode() === m2, m, { timeout: ms }); };

// 実際のポインタ操作で打つ：弾く向き angle・強さ power → 逆方向へ power×最大長だけ引っぱる
async function dragShot(page, pos, shot) {
  const [px, py] = await G(page, 'pxOf', pos.x, pos.y);
  const pull = await G(page, 'pullPx');
  const sx = Math.max(60, Math.min(900, px)), sy = Math.max(200, Math.min(700, py));
  const ex = sx - Math.cos(shot.angle) * pull * shot.power, ey = sy - Math.sin(shot.angle) * pull * shot.power;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(sx + (ex - sx) * i / 6, sy + (ey - sy) * i / 6);
  return { release: () => page.mouse.up(), shot: () => page.screenshot({ path: path.join(OUT, 'aim.png') }) };
}

// ---------- 1. 字によって差が出るか（同じ打ち方を複数の字で比べる） ----------
const page = await open();
await page.screenshot({ path: path.join(OUT, '01-select.png') });
const CHARS = ['〇', 'O', 'あ', '鬱', '口', '人', '一'];
console.log('\n[字ごとの性格と、同じ打ち方（まっすぐ・強さ50%）の結果]');
const rows = {};
for (const c of CHARS) {
  const t = await G(page, 'traits', c);
  const r = await page.evaluate(([c2]) => {
    const g = window.__golf, h = g.holes[0];
    const a = g.simulate(c2, 0, { x: 120, y: 570, t: 0 }, { angle: -Math.PI / 2, power: 0.5 });
    // 壁の反発：まっすぐ壁へ全力
    const b = g.simulate(c2, 0, { x: 120, y: 570, t: 0 }, { angle: -Math.PI / 2, power: 1 });
    // 砂（4番）: 砂場を通る
    const s = g.simulate(c2, 3, { x: 160, y: 580, t: 0 }, { angle: -Math.PI / 2, power: 0.6 });
    return { dist: 570 - a.end.y, ticks: a.ticks, full: b.ticks, afterSand: s.end.y, sandResult: s.result };
  }, [c]);
  rows[c] = { ...r, t };
  console.log(`${c}  転がり${t.roll} 重さ${t.heavy} 平たさ${t.flat} mu=${t.mu} vStop=${t.vStop} 反発${t.bounce}  → 50%の移動距離 ${r.dist.toFixed(0)}  全力の滞在 ${r.full}刻み  砂越え後のy ${r.afterSand.toFixed(0)}(${r.sandResult})`);
}
check(rows['〇'].dist > rows['口'].dist * 1.3 && rows['〇'].dist > rows['人'].dist * 1.3, '丸い「〇」は角ばった「口」「人」より遠くまで転がる');
check(rows['一'].dist > rows['口'].dist * 1.2, '平たい「一」は滑って「口」より遠くへ行く');
check(rows['鬱'].t.bounce < rows['〇'].t.bounce && rows['鬱'].t.bounce < rows['一'].t.bounce, '重い「鬱」は壁で跳ね返りにくい');
check(rows['人'].t.mu > rows['〇'].t.mu && rows['人'].t.vStop > rows['〇'].t.vStop, '角ばった字は転がりにくく止まりやすい');
check(new Set(CHARS.map(c => JSON.stringify(rows[c].t))).size === CHARS.length, '字ごとに性格が全部ちがう');
// 決定的か：同じ字・同じ打ち方で2回
const d1 = await page.evaluate(() => { const g = window.__golf; return JSON.stringify([...g.simulate('あ', 5, { x: 160, y: 580, t: 0 }, { angle: -1.3, power: 0.7 }).frames]); });
const d2 = await page.evaluate(() => { const g = window.__golf; return JSON.stringify([...g.simulate('あ', 5, { x: 160, y: 580, t: 0 }, { angle: -1.3, power: 0.7 }).frames]); });
check(d1 === d2, '同じ字・同じ打ち方なら、経路が完全に一致する（決定的）');

// ---------- 2. 全9ホールをカップインする（字ごと） ----------
async function playAll(page, ch, { useDrag = false, shots = false } = {}) {
  const sol = await page.evaluate(async c => {
    const { solveHole } = await window.__golf.solverModule();
    const g = window.__golf, t = g.traits(c);
    return g.holes.map(h => solveHole(h, t, 4));
  }, ch);
  check(sol.every(Boolean), `「${ch}」：9ホールすべてに解がある（打数 ${sol.map(s => s && s.length).join(' ')}）`);
  if (!sol.every(Boolean)) return null;
  await G(page, 'start', ch);
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < sol[i].length; k++) {
      await waitMode(page, 'aim');
      const st = await G(page, 'state');
      const sh = sol[i][k];
      if (useDrag && i === 0) {
        const d = await dragShot(page, st.pos, sh);
        if (shots) await d.shot();
        await d.release();
      } else await G(page, 'shoot', sh.angle, sh.power);
      if (shots && k === 0 && [1, 4, 6, 7].includes(i)) { await sleep(150); await page.screenshot({ path: path.join(OUT, `play-${ch}-hole${i + 1}.png`) }); }
      await page.waitForFunction(() => window.__golf.mode() !== 'roll', null, { timeout: 30000 });
    }
    await waitMode(page, 'banner');
    const st = await G(page, 'state');
    if (shots && (i === 0 || i === 8)) await page.screenshot({ path: path.join(OUT, `banner-${ch}-hole${i + 1}.png`) });
    check(st.strokes[i] === sol[i].length, `「${ch}」${i + 1}番「${(await G(page, 'holeList'))[i].name}」：${st.strokes[i]}打でカップイン`);
    await G(page, 'next');
  }
  await waitMode(page, 'result');
  const st = await G(page, 'state');
  return st.strokes;
}

console.log('\n[実際にドラッグで1番を打ち、全ホールをプレイ]');
const sc = {};
sc['〇'] = await playAll(page, '〇', { useDrag: true, shots: true });
await page.screenshot({ path: path.join(OUT, '09-result.png') });
check(await page.isVisible('#result'), '結果画面が出る（ランク・スコア）');
const resultText = await page.innerText('#result');
console.log(resultText.split('\n').slice(0, 4).join(' / '));
const best = await page.evaluate(() => JSON.parse(localStorage.getItem('moji_golf.best')));
check(best && Object.values(best)[0]['〇'].total === sc['〇'].reduce((a, b) => a + b, 0), 'ベストスコアが localStorage に保存される');
// もう一度／別の文字
await page.click('#retry');
await waitMode(page, 'aim');
check((await G(page, 'state')).hole === 0 && (await G(page, 'state')).ch === '〇', '「もう一度」で1番から始まる');
await G(page, 'shoot', -Math.PI / 2, 0.3); await sleep(500);
await G(page, 'start', '〇');
await waitMode(page, 'aim');
for (const c of ['鬱', '一', '人', 'あ']) sc[c] = await playAll(page, c);
console.log('\n[字ごとの解の打数（その字の最短手）]');
for (const [c, s] of Object.entries(sc)) if (s) console.log(`${c}: ${s.join(' ')}  合計${s.reduce((a, b) => a + b, 0)}`);
await page.screenshot({ path: path.join(OUT, '10-after.png') });

// 別の文字ボタン
await page.click('#change').catch(() => {});
const st0 = await G(page, 'state');
if (st0.mode === 'result') { await page.click('#change'); }
await sleep(100);
check(await page.isVisible('#panel'), '「別の文字」で文字選びに戻れる');

// ---------- 3. スマホ（タッチ）でも打てる ----------
console.log('\n[スマホ（タッチ操作）]');
const mp = await open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await mp.screenshot({ path: path.join(OUT, 'm1-select.png') });
await mp.fill('#char', '鬱');
await mp.waitForTimeout(100);
await mp.screenshot({ path: path.join(OUT, 'm2-select-utsu.png') });
await mp.click('#go');
await waitMode(mp, 'aim');
const cdp = await mp.context().newCDPSession(mp);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
{
  const st = await G(mp, 'state'), [px, py] = await G(mp, 'pxOf', st.pos.x, st.pos.y), pull = await G(mp, 'pullPx');
  await touch('touchStart', px, py);
  for (let i = 1; i <= 6; i++) await touch('touchMove', px, py + pull * 0.6 * i / 6);
  await mp.screenshot({ path: path.join(OUT, 'm3-aim.png') });
  await touch('touchEnd');
  await mp.waitForFunction(() => window.__golf.state().cur === 1, null, { timeout: 5000 }).then(() => check(true, 'タッチのドラッグで打てた（1打目）'), () => check(false, 'タッチのドラッグで打てた'));
  await waitMode(mp, 'aim');
  const st2 = await G(mp, 'state');
  check(st2.pos.y < st.pos.y - 20, `タッチで打ったボールが奥へ進んだ（y ${st.pos.y} → ${st2.pos.y.toFixed(0)}）`);
}
await mp.screenshot({ path: path.join(OUT, 'm4-after.png') });
await G(mp, 'start', 'あ');
for (let i = 0; i < 9; i++) { await G(mp, 'goto', i); await mp.waitForTimeout(80); await mp.screenshot({ path: path.join(OUT, `m-hole${i + 1}.png`) }); }

console.log('\n[エラー]');
const real = errors.filter(e => !/Failed to load resource|ERR_/.test(e));
console.log(real.length ? real.join('\n') : 'なし');
check(real.length === 0, 'ページエラー・コンソールエラーなし');
await browser.close(); server.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
