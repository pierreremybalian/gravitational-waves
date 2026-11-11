import { describe, expect, it } from 'vitest';
import { deform, detectorStrain, ring, rodStrain, wave } from '../strain.ts';

describe('strain', () => {
  it('+ stretches x and squeezes y by h/2', () => {
    const o = [0, 0];
    deform(1, 0, 0.2, 0, o);
    expect(o[0]).toBeCloseTo(1.1, 12);
    deform(0, 1, 0.2, 0, o);
    expect(o[1]).toBeCloseTo(0.9, 12);
  });
  it('× is + turned by 45°', () => {
    const a = [0, 0];
    const d = Math.SQRT1_2;
    deform(d, d, 0, 0.2, a);
    expect(Math.hypot(a[0]!, a[1]!)).toBeCloseTo(1.1, 12);
    deform(d, -d, 0, 0.2, a);
    expect(Math.hypot(a[0]!, a[1]!)).toBeCloseTo(0.9, 12);
    expect(rodStrain(0, 0.2, Math.PI / 4)).toBeCloseTo(rodStrain(0.2, 0, 0), 12);
  });
  it('a ring keeps its area to first order (transverse-traceless)', () => {
    const n = 720;
    const h = 1e-3;
    const pts = ring(n, 1, h, 0.5 * h);
    let A = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      A += pts[2 * k]! * pts[2 * j + 1]! - pts[2 * j]! * pts[2 * k + 1]!;
    }
    A /= 2;
    const A0 = (n / 2) * Math.sin((2 * Math.PI) / n);
    expect(Math.abs(A - A0) / A0).toBeLessThan(1e-5);
  });
  it('a detector turned by 90° reads the opposite sign', () => {
    const w = wave(1, 35, 0.0123, 0.3, 1);
    const a = detectorStrain(w.plus, w.cross, 0.4);
    const b = detectorStrain(w.plus, w.cross, 0.4 + Math.PI / 2);
    expect(b).toBeCloseTo(-a, 12);
    expect(Math.abs(a)).toBeGreaterThan(0.1);
  });
  it('circular polarisation keeps a constant amplitude', () => {
    for (const t of [0, 0.003, 0.01, 0.02]) {
      const w = wave(2, 50, t, 0.7, 1);
      expect(Math.hypot(w.plus, w.cross)).toBeCloseTo(2, 12);
    }
  });
});
