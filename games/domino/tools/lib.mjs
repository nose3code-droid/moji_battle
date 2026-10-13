// Node から物理を動かすための共通の準備（解探索 solve.mjs と検証用）
// フォントは環境変数 LOCAL_FONT（ttf/otf）で指定する。CDN の Noto Sans JP Bold と同じ字形のものを使うこと
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import * as opentype from 'opentype.js/dist/opentype.mjs';
import { makeShape } from '../physics.js';

export async function setup() {
  await RAPIER.init();
  const file = process.env.LOCAL_FONT;
  if (!file) throw new Error('LOCAL_FONT にフォントのパスを指定してください');
  const buf = fs.readFileSync(file);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const cache = new Map();
  const shapes = {
    get(ch) { if (!cache.has(ch)) cache.set(ch, makeShape(font, ch)); return cache.get(ch); },
  };
  return { R: RAPIER, shapes };
}
