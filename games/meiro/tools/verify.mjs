// 迷路の自動検証：ブラウザ（Playwright）でゲームを開き、たくさんの字・3つのむずかしさ・複数のシードで
//  - 使えるマスが全部つながっている／スタートからゴールまで最短経路がある／かべが左右対称
//  - 同じ入力なら同じ迷路になる
//  - 最短経路のとおりに実際に操作（step）するとゴールできる
// を確かめる。使い方：node verify.mjs [--deps <three と opentype.js を npm install したフォルダ>] [--font <フォントファイル>] [--fallback]
//   --deps / --font：CDN に届かない環境で、同じ名前のローカルファイルに差し替える　--fallback：フォント無し（canvas マスク）の経路を試す
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

const deps = arg('--deps'), fontFile = arg('--font'), fallback = !!arg('--fallback');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !(fallback && /ERR_FAILED/.test(m.text()))) errors.push('console: ' + m.text()); }); // --fallback では CDN をわざと止めるので、その読み込み失敗は数えない
await page.route(/cdn\.jsdelivr\.net/, route => {
  const url = route.request().url();
  if (fallback) return route.abort();
  if (/three@/.test(url) && deps) return route.fulfill({ path: path.join(deps, 'node_modules/three', url.split('three@0.186.1/')[1]) });
  if (/opentype\.js@/.test(url) && deps) return route.fulfill({ path: path.join(deps, 'node_modules/opentype.js', url.split('opentype.js@2.0.0/')[1]) });
  if (/\.otf$/.test(url) && fontFile) return route.fulfill({ path: fontFile, contentType: 'font/ttf' });
  return route.continue();
});
await page.goto(`http://localhost:${port}/games/meiro/index.html?ch=龍&lv=1&seed=1`);
await page.waitForFunction(() => window.__meiro && window.__meiro.maze, null, { timeout: 30000 });
console.log('輪郭モード：', await page.evaluate(() => __meiro.usingOutline()) ? 'glyph.js（フォントの輪郭）' : 'canvas マスク（代用）');

const TEXTS = ['龍', '口', '一', 'ハ', '川', '三', 'あ', 'S', '森', '愛', '鬱', '回', '田', '日', 'い', 'i', 'ぬ', '亀', '文字', '一二', 'ハハ', 'AB', '雷', '門', '米', '.'];
const SEEDS = [1, 2, 3, 12345];
const report = await page.evaluate(({ TEXTS, SEEDS }) => {
  const rows = [], fails = [];
  const hash = a => { let h = 0; for (const v of a) h = (Math.imul(h, 31) + v) | 0; return h; };
  for (const t of TEXTS) for (let lv = 0; lv < 3; lv++) for (const seed of SEEDS) {
    let g;
    try { g = __meiro.generate(t, lv, seed); } catch (e) { fails.push(`${t} lv${lv} #${seed}: 生成エラー ${e.message}`); continue; }
    const m = g.maze, { cols, open, usable, DIRS = __meiro.DIRS } = { ...m };
    const D = __meiro.DIRS;
    const bad = msg => fails.push(`${t} lv${lv} #${seed}: ${msg}`);
    // かべの対称性・使えるマスの中だけで開いている
    for (let i = 0; i < open.length; i++) for (let d = 0; d < 4; d++) {
      if (!(open[i] & D[d].bit)) continue;
      const j = i + D[d].dy * cols + D[d].dx;
      if (!usable[i] || !usable[j] || !(open[j] & D[(d + 2) % 4].bit)) bad('かべが対称でない／使えないマスにつながっている');
    }
    // 到達できるマス（スタートから）
    const seen = new Uint8Array(open.length), q = [m.start]; seen[m.start] = 1;
    for (let k = 0; k < q.length; k++) for (let d = 0; d < 4; d++) {
      if (!(open[q[k]] & D[d].bit)) continue;
      const j = q[k] + D[d].dy * cols + D[d].dx;
      if (!seen[j]) { seen[j] = 1; q.push(j); }
    }
    let cells = 0; for (let i = 0; i < usable.length; i++) if (usable[i]) cells++;
    if (q.length !== cells) bad(`全部のマスにたどり着けない ${q.length}/${cells}`);
    if (!seen[m.goal] || m.start === m.goal) bad('ゴールにたどり着けない');
    const p = __meiro.shortestPath(m, m.start, m.goal);
    if (!p || p.length - 1 !== m.shortest) bad(`最短経路が合わない ${p && p.length - 1} / ${m.shortest}`);
    // 同じ入力 → 同じ迷路
    const g2 = __meiro.generate(t, lv, seed).maze;
    if (hash(g2.open) !== hash(open) || g2.start !== m.start || g2.goal !== m.goal) bad('同じ入力なのに違う迷路になった');
    rows.push({ t, lv, seed, cols, rows: m.rows, cells, parts: m.parts, bridges: m.bridges, junctions: m.junctions, shortest: m.shortest });
  }
  return { rows, fails };
}, { TEXTS, SEEDS });

// 一覧（シード1だけ）
for (const r of report.rows.filter(r => r.seed === 1)) console.log(`「${r.t}」 lv${r.lv} ${r.cols}×${r.rows} 使えるマス${r.cells} パーツ${r.parts} 橋${r.bridges} 分かれ道${r.junctions} 最短${r.shortest}歩`);
console.log(`生成した迷路：${report.rows.length}個、失敗：${report.fails.length}個`);
report.fails.forEach(f => console.log('  NG', f));

// 実際に操作してゴールできるか（最短経路どおりに step を呼ぶ）
let played = 0, playFails = 0;
for (const t of ['龍', '口', '一', 'ハ', '川', '三', 'あ', 'S']) for (let lv = 0; lv < 3; lv++) {
  await page.goto(`http://localhost:${port}/games/meiro/index.html?ch=${encodeURIComponent(t)}&lv=${lv}&seed=7`);
  await page.waitForFunction(() => window.__meiro && window.__meiro.maze, null, { timeout: 30000 });
  const r = await page.evaluate(() => {
    const m = __meiro.maze, D = __meiro.DIRS, p = __meiro.shortestPath(m, m.start, m.goal);
    for (let k = 1; k < p.length; k++) {
      const diff = p[k] - p[k - 1];
      const d = D.findIndex(x => x.dy * m.cols + x.dx === diff);
      if (!__meiro.step(d)) return { ok: false, why: `${k}歩目で壁` };
    }
    const s = __meiro.state;
    return { ok: s.mode === 'done' && s.steps === m.shortest, steps: s.steps, shortest: m.shortest, mode: s.mode };
  });
  played++;
  if (!r.ok) { playFails++; console.log('  NG 操作でゴールできない', t, lv, JSON.stringify(r)); }
}
console.log(`実操作でゴール：${played - playFails}/${played}`);
console.log('ブラウザのエラー：', errors.length ? errors : 'なし');
await browser.close(); server.close();
process.exit(report.fails.length || playFails || errors.length ? 1 : 0);
