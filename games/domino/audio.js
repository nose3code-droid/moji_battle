// 音：外部の音声ファイルは使わず、WebAudio で鐘とコトンという音を合成する
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('moji_domino.mute') === '1'; } catch { /* 既定のまま */ }

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('moji_domino.mute', m ? '1' : '0'); } catch { /* 保存できなくても遊べる */ }
}
// ブラウザの決まりで、音は最初のタップ操作のあとでないと出せない
export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

// 鐘：基音とずれた倍音をいくつか重ね、高い音ほど早く消える
export function bell() {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime, base = 784;
  for (const [mul, gain, dec] of [[1, 0.5, 2.6], [2.01, 0.28, 1.8], [2.76, 0.22, 1.3], [5.4, 0.12, 0.8], [8.93, 0.06, 0.5]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = base * mul;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dec);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dec + 0.05);
  }
}

// 字がぶつかる音：短い低めのコトン。強いほど少し大きく、字ごとに高さを変える
export function tick(power = 1, pitch = 1) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220 * pitch, t0);
  o.frequency.exponentialRampToValueAtTime(90 * pitch, t0 + 0.09);
  g.gain.setValueAtTime(Math.min(0.28, 0.05 + 0.04 * power), t0);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + 0.14);
}

// 置いたとき・失敗したとき
export function pop() { tick(2, 1.8); }
export function buzz() {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t0); o.frequency.linearRampToValueAtTime(90, t0 + 0.25);
  g.gain.setValueAtTime(0.08, t0); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.3);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.32);
}
