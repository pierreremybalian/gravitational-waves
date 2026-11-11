import { describe, expect, it } from 'vitest';
import { upsample } from '../resample.ts';

describe('upsample', () => {
  it('keeps DC and the original samples', () => {
    const x = new Float32Array(64).fill(0.5);
    const y = upsample(x, 8);
    expect(y.length).toBe(512);
    expect(y[256]).toBeCloseTo(0.5, 5);
    const r = new Float32Array(64).map((_, i) => Math.sin(i * 0.37));
    const z = upsample(r, 8);
    for (let i = 20; i < 40; i++) expect(z[i * 8]).toBeCloseTo(r[i]!, 5);
  });
  it('interpolates a 300 Hz tone at 2048 Hz cleanly to 16384 Hz', () => {
    const fs = 2048;
    const f = 300;
    const n = 2048;
    const x = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * f * i) / fs));
    const y = upsample(x, 8);
    let err = 0;
    for (let j = 8 * 100; j < 8 * (n - 100); j++) err = Math.max(err, Math.abs(y[j]! - Math.sin((2 * Math.PI * f * j) / (fs * 8))));
    expect(err).toBeLessThan(2e-3);
  });
});
