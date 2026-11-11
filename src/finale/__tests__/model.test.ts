import { describe, expect, it } from 'vitest';
import { fIsco, modelChirp, ringdown } from '../model.ts';
import { frequencyAt, timeToCoalescence } from '../../gw/chirp.ts';

describe('model chirp', () => {
  it('GW150914-like: inspiral follows the Newtonian f(τ) up to the innermost orbit, then rings', () => {
    const m = modelChirp({ m1: 34.6, m2: 30.0, mFinal: 61.5, redshift: 0.1 });
    expect(m.mDet).toBeCloseTo(64.6 * 1.1, 6);
    // ISCO of ~71 M☉: ~62 Hz; ringdown of ~68 M☉ at spin 0.69: ~250 Hz.
    expect(m.fIsco).toBeGreaterThan(55);
    expect(m.fIsco).toBeLessThan(70);
    expect(m.fRing).toBeGreaterThan(220);
    expect(m.fRing).toBeLessThan(290);
    const tauI = timeToCoalescence(m.fIsco, m.mcDet);
    const i = Math.round((-0.2 - m.t0) * m.fs);
    const ti = m.t0 + i / m.fs;
    expect(m.f[i]!).toBeCloseTo(frequencyAt(tauI - ti, m.mcDet), 2);
    // Starts at 25 Hz (well under 3 s), peak normalised, no NaN.
    expect(m.fStart).toBeCloseTo(25, 6);
    let peak = 0;
    for (const v of m.h) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.9);
    // Phase 0 at the merger.
    expect(Math.abs(m.phase[Math.round(-m.t0 * m.fs)]!)).toBeLessThan(0.2);
  });

  it('two neutron stars: capped at 3 s, starting higher, no ringdown', () => {
    const m = modelChirp({ m1: 1.46, m2: 1.27, redshift: 0.01, bns: true });
    expect(-m.t0).toBeLessThanOrEqual(3.0001);
    expect(m.fStart).toBeGreaterThan(25);
    expect(m.fRing).toBe(0);
    expect(m.fIsco).toBeGreaterThan(1400);
  });

  it('ISCO and ringdown scale as 1/M', () => {
    expect(fIsco(10) / fIsco(20)).toBeCloseTo(2, 9);
    expect(ringdown(10, 0.69).f / ringdown(20, 0.69).f).toBeCloseTo(2, 9);
  });
});
