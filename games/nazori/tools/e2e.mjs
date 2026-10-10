// ブラウザ（Playwright + Chromium）で、お手本の内側を実際のマウス操作でなぞって全6面をクリアできるか確かめる。
// 使い方：リポジトリのルートで `python3 -m http.server 8765` を起動してから
//   node games/nazori/tools/e2e.mjs [http://localhost:8765] [スクリーンショットの出力先] [代替フォントのパス]
// CDN（フォント）に届かない環境では、代替フォントのパスを渡すとそれを FONT_URL の代わりに返す。
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8765';
const OUT = process.argv[3] || '/tmp/nazori-shots';
const FONT = process.argv[4] || '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf';
fs.mkdirSync(OUT, { recursive: true });
const RING = ['水', '火', '闇', '光', '雷'];
const counter = ch => RING[(RING.indexOf(ch) + 4) % 5];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: false });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|403/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/NotoSansJP-Bold.otf', r => fs.existsSync(FONT) ? r.fulfill({ body: fs.readFileSync(FONT), contentType: 'font/otf' }) : r.abort());
  return page;
}
const N = (page, expr) => page.evaluate(`(() => { const n = window.__nazori; return (${expr}); })()`);

async function trace(page, ch) { // お手本の内側を横線で塗るようになぞる
  const runs = await N(page, `n.runs(${JSON.stringify(ch)})`);
  const r = await N(page, 'n.padRect()'), R = await N(page, 'n.R');
  const X = x => r.left + x / R * r.width, Y = y => r.top + y / R * r.height;
  for (const run of runs) {
    await page.mouse.move(X(run.x0), Y(run.y)); await page.mouse.down();
    await page.mouse.move(X((run.x0 + run.x1) / 2), Y(run.y)); await page.mouse.move(X(run.x1), Y(run.y));
    await page.mouse.up();
  }
}

async function playStage(page, i, shots) {
  await page.goto(`${BASE}/games/nazori/index.html?skip=1&slow=0.5&stage=${i}`);
  await page.waitForFunction('window.__nazori && window.__nazori.mode === "play"', null, { timeout: 20000 });
  const log = { casts: 0, fizzle: 0, accs: [] };
  const t0 = Date.now(); let shot = false;
  while (Date.now() - t0 < 420000) {
    const st = await N(page, '({ mode: n.mode, state: n.game && n.game.state })');
    if (st.mode !== 'play') break;
    const ms = await N(page, 'n.game.monsters.filter(m => !m.dead).map(m => ({ e: m.elem, y: m.y, b: m.boss, lock: m.lock }))');
    if (!ms.length) { await sleep(100); continue; }
    const t = ms.reduce((a, b) => (b.b && !a.b) || (b.b === a.b && b.y > a.y) ? b : a);
    const ch = counter(t.e);
    await page.click(`#elems button[data-ch="${ch}"]`);
    await trace(page, ch);
    if (!shot && shots.includes(ch + i)) { await page.screenshot({ path: `${OUT}/stage${i + 1}-trace-${ch}.png` }); }
    const before = await N(page, 'n.game.castN');
    await page.click('#b-cast');
    log.casts++;
    const acc = await N(page, '(n.game.accSum)');
    log.accs.push(acc);
    if (shots.includes(ch + i)) { await sleep(180); await page.screenshot({ path: `${OUT}/stage${i + 1}-cast-${ch}.png` }); shots.splice(shots.indexOf(ch + i), 1); }
    await sleep(120);
  }
  await page.waitForFunction('window.__nazori.mode === "result"', null, { timeout: 10000 });
  const g = await N(page, '({ state: n.game.state, hearts: n.game.hearts, score: n.game.score, kills: n.game.kills, castN: n.game.castN, accSum: n.game.accSum, used: n.game.usedElems })');
  return { ...g, avg: g.accSum / g.castN };
}

// ---- 1. PC 画面：全面クリア ----
const page = await newPage({ width: 1100, height: 760 });
await page.goto(`${BASE}/games/nazori/index.html`);
await page.waitForFunction('window.__nazori', null, { timeout: 15000 });
await page.waitForFunction('!document.getElementById("start").disabled', null, { timeout: 15000 });
await page.screenshot({ path: `${OUT}/title.png` });
const shots = ['火0', '水0', '雷0', '光0', '闇0', '火5', '雷5', '闇5', '光5', '水5'];
let allOk = true;
for (let i = 0; i < 6; i++) {
  const r = await playStage(page, i, shots);
  const used = Object.keys(r.used).sort().join('');
  const ok = r.state === 'win' && used.length === 5;
  allOk &&= ok;
  console.log(`面${i + 1}: ${r.state} 撃破${r.kills} ハート${r.hearts} スコア${r.score} 平均精度${r.avg.toFixed(1)}% 使った字=${used}`);
  if (i === 5 || i === 0) await page.screenshot({ path: `${OUT}/result${i + 1}.png` });
}
const saved = await N(page, 'n.save');
console.log('保存:', JSON.stringify(saved));
if (!saved.cleared.every(Boolean)) allOk = false;

// ---- 2. スマホ画面（縦）の見た目とタッチ ----
const phone = await newPage({ width: 390, height: 800 });
await phone.goto(`${BASE}/games/nazori/index.html?skip=1&slow=0.5&stage=2`);
await phone.waitForFunction('window.__nazori && window.__nazori.mode === "play"');
await sleep(3000);
await phone.click('#elems button[data-ch="闇"]');
await trace(phone, '闇');
await phone.screenshot({ path: `${OUT}/phone-trace.png` });
await phone.click('#b-cast'); await sleep(250);
await phone.screenshot({ path: `${OUT}/phone-cast.png` });
const ow = await phone.evaluate('document.documentElement.scrollWidth > innerWidth');
console.log('スマホで横スクロール:', ow);

await browser.close();
console.log(errors.length ? 'エラー:\n' + errors.join('\n') : 'ブラウザのエラーなし');
process.exit(allOk && !errors.length && !ow ? 0 : 1);
