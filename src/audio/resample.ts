// Integer-factor upsampling by windowed-sinc interpolation (pure). The catalogue snippets are stored at 2048 Hz; an
// AudioBuffer needs ≥ 8000 Hz everywhere (spec minimum), so they are upsampled ×8 to 16384 Hz before playback. Linear
// interpolation would leave audible images near 2 kHz; a Blackman-windowed sinc of ±16 input samples puts them more
// than 70 dB down.

/** Upsample x by an integer factor; output length x.length · factor. */
export function upsample(x: ArrayLike<number>, factor: number, halfWidth = 16): Float32Array {
  const L = Math.round(factor);
  if (L < 1) throw new Error('factor must be ≥ 1');
  const n = x.length;
  const out = new Float32Array(n * L);
  if (L === 1) {
    for (let i = 0; i < n; i++) out[i] = x[i]!;
    return out;
  }
  // Polyphase kernels: for output phase p (0…L−1), taps at input offsets k = −halfWidth+1 … halfWidth.
  const taps = 2 * halfWidth;
  const kern = new Float32Array(L * taps);
  for (let p = 0; p < L; p++) {
    const frac = p / L;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const k = j - halfWidth + 1; // input sample index offset
      const u = k - frac; // distance in input samples
      const s = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const w = blackman((u + halfWidth) / (2 * halfWidth));
      const v = s * w;
      kern[p * taps + j] = v;
      sum += v;
    }
    // Normalise each phase to unity DC gain.
    for (let j = 0; j < taps; j++) kern[p * taps + j]! /= sum;
  }
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < L; p++) {
      let acc = 0;
      const base = p * taps;
      for (let j = 0; j < taps; j++) {
        const idx = i + j - halfWidth + 1;
        if (idx < 0 || idx >= n) continue;
        acc += x[idx]! * kern[base + j]!;
      }
      out[i * L + p] = acc;
    }
  }
  return out;
}

function blackman(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
}
