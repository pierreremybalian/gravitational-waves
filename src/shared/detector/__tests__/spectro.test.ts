import { describe, expect, it } from 'vitest';
import { fft, logFreqs, spectrogram, whiten } from '../spectro.ts';

describe('spectral tools', () => {
  it('fft of a pure tone peaks at its bin and inverts', () => {
    const n = 256;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n);
    const orig = Float64Array.from(re);
    fft(re, im);
    expect(Math.hypot(re[10]!, im[10]!)).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[11]!, im[11]!)).toBeLessThan(1e-9);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]! / n).toBeCloseTo(orig[i]!, 9);
  });

  it('whitening a coloured noise by its own ASD gives unit σ; the spectrogram of unit noise reads about 1', () => {
    const fs = 1024;
    const n = 8192;
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = rnd() * 3;
    const flat = { f0: 0, df: 1, data: new Float64Array(600).fill(3) };
    const w = whiten(x, fs, flat, 20, 400);
    let s2 = 0;
    for (let i = 1000; i < 7000; i++) s2 += w[i]! * w[i]!;
    expect(Math.sqrt(s2 / 6000)).toBeGreaterThan(0.9);
    expect(Math.sqrt(s2 / 6000)).toBeLessThan(1.1);
    const sp = spectrogram(w, fs, 0, [2, 3, 4, 5], logFreqs(40, 300, 32), 256, 512);
    let m = 0;
    for (const v of sp.mag) m += v * v;
    // Band-limited to 20–400 of 512 Hz: about 0.75 of the power is left in band, spread evenly.
    expect(Math.sqrt(m / sp.mag.length)).toBeGreaterThan(0.5);
    expect(Math.sqrt(m / sp.mag.length)).toBeLessThan(1.6);
  });
});
