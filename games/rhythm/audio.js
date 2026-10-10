// WebAudio で5つの楽器と伴奏を合成する（外部の音声ファイルは使わない）
export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);

  // ノイズ（太鼓・ハット用）
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const gainEnv = (t, attack, peak, decay) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(master);
    return g;
  };
  const osc = (type, f, t, dur, dest) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.connect(dest); o.start(t); o.stop(t + dur);
    return o;
  };
  const noise = (t, dur, dest, filterType, freq, q = 1) => {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(dest); s.start(t, Math.random() * 0.5, dur); s.stop(t + dur);
  };

  const inst = {
    // 火：太鼓（ノイズ＋ピッチの落ちる胴鳴り）
    fire(t, v = 1) {
      const g = gainEnv(t, 0.002, 0.9 * v, 0.22);
      noise(t, 0.25, g, 'bandpass', 900, 0.8);
      const g2 = gainEnv(t, 0.002, 0.8 * v, 0.3);
      const o = osc('sine', 170, t, 0.35, g2);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.18);
      return { stop() {} };
    },
    // 水：やわらかい正弦波（長押しの間のびる）
    water(t, f, v = 1) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.03);
      g.gain.setTargetAtTime(0.32 * v, t + 0.03, 0.4);
      g.connect(master);
      const a = osc('sine', f, t, 30, g), b = osc('sine', f * 2, t, 30, g);
      b.detune.value = 4;
      let done = false;
      const stop = (when = ctx.currentTime) => {
        if (done) return; done = true;
        const w = Math.max(when, ctx.currentTime);
        g.gain.cancelScheduledValues(w);
        g.gain.setTargetAtTime(0.0001, w, 0.12);
        a.stop(w + 0.7); b.stop(w + 0.7);
      };
      return { stop };
    },
    // 雷：鋭いのこぎり波（フィルターが一気に閉じる）
    thunder(t, f, v = 1) {
      const g = gainEnv(t, 0.003, 0.5 * v, 0.28);
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 6;
      flt.frequency.setValueAtTime(5000, t);
      flt.frequency.exponentialRampToValueAtTime(500, t + 0.25);
      flt.connect(g);
      osc('sawtooth', f, t, 0.4, flt);
      osc('sawtooth', f * 1.005, t, 0.4, flt);
      return { stop() {} };
    },
    // 光：高い澄んだ音（倍音つきで長く響く）
    light(t, f, v = 1) {
      const g = gainEnv(t, 0.005, 0.4 * v, 1.0);
      osc('sine', f * 2, t, 1.2, g);
      const g2 = gainEnv(t, 0.005, 0.15 * v, 0.7);
      osc('triangle', f * 4, t, 1.0, g2);
      return { stop() {} };
    },
    // 闇：低いベース音
    dark(t, f, v = 1) {
      const g = gainEnv(t, 0.01, 0.9 * v, 0.55);
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 320;
      flt.connect(g);
      osc('sine', f / 2, t, 0.7, flt);
      osc('square', f / 2, t, 0.7, flt);
      return { stop() {} };
    },
  };

  // 伴奏
  const back = {
    kick(t, v = 1) {
      const g = gainEnv(t, 0.002, 0.55 * v, 0.2);
      const o = osc('sine', 120, t, 0.25, g);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    },
    hat(t, v = 1) {
      const g = gainEnv(t, 0.001, 0.12 * v, 0.05);
      noise(t, 0.08, g, 'highpass', 7000);
    },
    bass(t, f, dur = 0.4) {
      const g = gainEnv(t, 0.01, 0.3, dur);
      osc('triangle', f, t, dur + 0.1, g);
    },
    tick(t, f = 1200) {
      const g = gainEnv(t, 0.001, 0.3, 0.06);
      osc('sine', f, t, 0.1, g);
    },
  };

  return {
    ctx, inst, back,
    resume() { return ctx.state === 'running' ? Promise.resolve() : ctx.resume(); },
    get now() { return ctx.currentTime; },
  };
}
