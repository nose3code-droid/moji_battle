// CDN に届かない環境で検証するための、ローカル用フォントを作る。
// @fontsource/noto-sans-jp（Noto Sans JP Bold の静的版。輪郭が重ならない）は字ごとに別ファイルへ分かれているので、
// 使う字だけを1つの OTF にまとめる。使い方：npm i @fontsource/noto-sans-jp opentype.js してから
//   node games/domino/tools/mkfont.mjs 出力.otf
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as opentype from 'opentype.js/dist/opentype.mjs';

const dir = path.dirname(createRequire(import.meta.url).resolve('@fontsource/noto-sans-jp/package.json'));
const css = fs.readFileSync(path.join(dir, '700.css'), 'utf8');
const faces = [...css.matchAll(/url\(\.\/files\/([^)]*?\.woff)\)[^;]*;[\s\S]*?unicode-range:([^;]*);/g)]
  .map(m => ({ file: m[1], ranges: m[2].split(',').map(s => s.trim().replace('U+', '').split('-').map(h => parseInt(h, 16))) }));
const fileFor = ch => { const c = ch.codePointAt(0); return faces.find(f => f.ranges.some(([a, b]) => c >= a && c <= (b ?? a)))?.file; };
const fonts = new Map();
const fontOf = file => {
  if (!fonts.has(file)) { const b = fs.readFileSync(path.join(dir, 'files', file)); fonts.set(file, opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); }
  return fonts.get(file);
};

// 使う可能性のある字（面の定義・画面の文字）。足りない字は追加して作り直す
export const CHARSET = Array.from(
  'IlJi1|｜ーO0o一二三十丁人入大小山川口日月田目回四工王土木水火石中上下力刀万干千牛' +
  'ハ八〇いのへくしうあろぬめゑトミロエコウカキタ文字倒鐘的棒板風船球化学ドミノ←→↑↓。、 ' +
  'ABCDEFGHKLMNPQRSTUVWXYZ' + '0123456789');

const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 1000, path: new opentype.Path() })];
const seen = new Set();
for (const ch of CHARSET) {
  if (seen.has(ch)) continue;
  seen.add(ch);
  const file = fileFor(ch);
  if (!file) { console.error('見つからない字:', ch); continue; }
  const g = fontOf(file).charToGlyph(ch);
  if (!g || g.index === 0) { console.error('字形なし:', ch); continue; }
  glyphs.push(new opentype.Glyph({ name: 'u' + ch.codePointAt(0).toString(16), unicode: ch.codePointAt(0), advanceWidth: g.advanceWidth, path: g.path }));
}
const font = new opentype.Font({ familyName: 'NotoSansJPTest', styleName: 'Bold', unitsPerEm: 1000, ascender: 880, descender: -120, glyphs });
fs.writeFileSync(process.argv[2] || 'NotoSansJP-Bold-test.otf', Buffer.from(font.toArrayBuffer()));
console.log('字数', glyphs.length);
