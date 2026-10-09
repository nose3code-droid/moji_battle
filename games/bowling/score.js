// ボウリングの点数計算（10フレーム制・ストライクとスペアのボーナスあり）
// rolls は倒した本数を投げた順に並べた配列

// フレームごとに投球を分ける（10フレーム目は最大3投）
export function splitFrames(rolls) {
  const frames = [];
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (rolls[i] === 10) { frames.push([10]); i++; }
    else { frames.push(rolls.slice(i, i + 2)); i += 2; }
  }
  frames.push(rolls.slice(i, i + 3));
  return frames;
}

function frameDone(fr, f) {
  if (f < 9) return fr[0] === 10 || fr.length === 2;
  return fr.length === 3 || (fr.length === 2 && fr[0] + fr[1] < 10);
}

// 今投げるのは何フレーム目の何投目か。ゲームが終わっていれば null
// full：ピンを10本並べ直してから投げるか（false なら前の投球の残りピンを狙う）
export function nextRoll(rolls) {
  const frames = splitFrames(rolls);
  const f = frames.findIndex((fr, i) => !frameDone(fr, i));
  if (f < 0) return null;
  const fr = frames[f], n = fr.length;
  let full = n === 0;
  if (f === 9 && n === 1) full = fr[0] === 10;
  if (f === 9 && n === 2) full = fr[0] === 10 ? fr[1] === 10 : fr[0] + fr[1] === 10;
  return { frame: f, roll: n, full };
}

// 各フレームの累計点（まだ決まらないフレームは null）
export function frameTotals(rolls) {
  const frames = splitFrames(rolls);
  const out = [];
  let i = 0, total = 0;
  for (let f = 0; f < 10; f++) {
    const fr = frames[f];
    let s = null;
    if (f < 9) {
      if (fr[0] === 10) { if (rolls.length > i + 2) s = 10 + rolls[i + 1] + rolls[i + 2]; i += 1; }
      else if (fr.length === 2) {
        if (fr[0] + fr[1] === 10) { if (rolls.length > i + 2) s = 10 + rolls[i + 2]; }
        else s = fr[0] + fr[1];
        i += 2;
      } else i += 2;
    } else if (frameDone(fr, 9)) s = fr.reduce((a, b) => a + b, 0);
    if (s == null || (out.length && out[out.length - 1] == null)) { out.push(null); continue; }
    total += s;
    out.push(total);
  }
  return out;
}

export function totalScore(rolls) {
  const t = frameTotals(rolls).filter(v => v != null);
  return t.length ? t[t.length - 1] : 0;
}

// スコア表に書く印（X ストライク、/ スペア、- ガター）
export function frameMarks(rolls) {
  const num = n => (n === 0 ? '-' : String(n));
  return splitFrames(rolls).map((fr, f) => {
    if (f < 9) {
      if (fr[0] === 10) return ['', 'X'];
      return [fr[0] == null ? '' : num(fr[0]), fr[1] == null ? '' : (fr[0] + fr[1] === 10 ? '/' : num(fr[1]))];
    }
    const [a, b, c] = fr;
    const m = ['', '', ''];
    if (a != null) m[0] = a === 10 ? 'X' : num(a);
    if (b != null) m[1] = a === 10 ? (b === 10 ? 'X' : num(b)) : (a + b === 10 ? '/' : num(b));
    if (c != null) {
      const fresh = a === 10 ? b === 10 : a + b === 10; // 3投目が新しい10本か
      m[2] = fresh ? (c === 10 ? 'X' : num(c)) : (b + c === 10 ? '/' : num(c));
    }
    return m;
  });
}
