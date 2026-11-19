// Procedural sound effects (no audio files): the swish of the ball through the net and a basketball bounce.
// Headless: plain maths that returns mono Float32Array samples in [-1, 1]. src/sfx.js plays them.
const TAU = Math.PI * 2;
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function finish(d, sr, peak = 0.9) {
  const fade = Math.round(sr * 0.02);                                              // no click at the end
  for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

/** The ball dropping through the net: a burst of band-passed noise whose band slides down as the ball falls, plus a little cord rustle. */
export function swishSamples(sr = 44100, seed = 7) {
  const n = Math.round(sr * 0.5), d = new Float32Array(n), rand = rng(seed);
  let low = 0, band = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = rand() * 2 - 1;
    const fc = 1500 + 2300 * Math.exp(-t / 0.16);                                  // 3.8 kHz sliding down to 1.5 kHz
    const f = 2 * Math.sin(Math.PI * fc / sr);                                     // state-variable band-pass, Q about 1.1
    low += f * band; const high = x - low - 0.91 * band; band += f * high;
    lp += 0.35 * (x - lp);                                                         // one-pole high-pass for the rustle
    d[i] = band * Math.min(1, t / 0.012) * Math.exp(-t / 0.12) + (x - lp) * 0.25 * Math.min(1, t / 0.004) * Math.exp(-t / 0.06);
  }
  return finish(d, sr);
}

/** A basketball bounce: a low thump that drops in pitch, plus the short slap of leather on a wooden floor. */
export function bounceSamples(sr = 44100, seed = 11) {
  const n = Math.round(sr * 0.45), d = new Float32Array(n), rand = rng(seed);
  let p1 = 0, p2 = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = 70 + 110 * Math.exp(-t / 0.035);                         // 180 Hz dropping to 70 Hz
    p1 += TAU * f / sr; p2 += TAU * f * 1.9 / sr;
    const body = Math.sin(p1) * Math.exp(-t / 0.085) + 0.35 * Math.sin(p2) * Math.exp(-t / 0.04);
    lp += 0.18 * ((rand() * 2 - 1) - lp);                                          // low-passed noise (about 1.3 kHz)
    d[i] = (body + lp * 2.2 * Math.exp(-t / 0.012)) * Math.min(1, t / 0.0015);
  }
  return finish(d, sr);
}
