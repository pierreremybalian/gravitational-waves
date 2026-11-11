import { describe, expect, it } from 'vitest';
import { modelChirp } from '../model.ts';
import { alignModel, bandResponse, mixOverlay, MIX, placeModel, processModel } from '../overlay.ts';

/** Deterministic white noise, σ = 1 (Box–Muller on a small LCG). */
function noise(n: number, seed = 7): Float32Array {
  let s = seed;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return out;
}

describe('model over the data', () => {
  const m = modelChirp({ m1: 34.6, m2: 30.0, mFinal: 61.5, redshift: 0.09 });
  const p = processModel(m, 2048);

  it('processing keeps the merger at t = 0 and the band', () => {
    expect(p.fs).toBe(2048);
    expect(p.t0).toBeLessThan(m.t0);
    // GW150914-like: the whitened envelope peaks within a few ms of the merger.
    expect(Math.abs(p.tPeak)).toBeLessThan(0.012);
    expect(bandResponse(10)).toBeLessThan(0.01);
    expect(bandResponse(150)).toBeGreaterThan(0.99);
    expect(bandResponse(1000)).toBeLessThan(0.01);
  });

  it('recovers a known offset and phase from noisy data, and falls back on pure noise', () => {
    const fs = 2048;
    const t0 = -1.75;
    const n = 4096;
    const truth = { offset: 0.0237, phi: 1.1, snr: 0, network: 0, fallback: false };
    const sig = placeModel(n, t0, fs, p, truth);
    const d = noise(n);
    // Scale the signal to a matched-filter SNR of about 12.
    let nn = 0;
    for (const v of sig) nn += v * v;
    const k = 12 / Math.sqrt(nn);
    const data = d.map((v, i) => v + k * sig[i]!);
    const a = alignModel(data, t0, p);
    expect(a.fallback).toBe(false);
    expect(Math.abs(a.offset - truth.offset)).toBeLessThan(0.001);
    expect(a.snr).toBeGreaterThan(9);
    // Another detector 7 ms earlier, sign flipped: the network agrees.
    const other = noise(n, 3).map((v, i) => v - 0.8 * k * placeModel(n, t0, fs, p, { ...truth, offset: truth.offset - 0.007 })[i]!);
    const b = alignModel(data, t0, p, [{ data: other, travel: 0.01 }]);
    expect(Math.abs(b.offset - truth.offset)).toBeLessThan(0.001);
    expect(b.network).toBeGreaterThan(b.snr);
    const c = alignModel(noise(n, 11), t0, p);
    expect(c.fallback).toBe(true);
    expect(c.offset).toBe(0);
  });

  it('mixes sample for sample: model on top, data limited underneath', () => {
    const fs = 2048;
    const t0 = -1.75;
    const d = noise(4096, 5);
    d[100] = 400; // a glitch
    const a = { offset: 0.02, phi: 0, snr: 10, network: 10, fallback: false };
    const o = mixOverlay(d, t0, fs, p, a);
    expect(o.mix.length).toBe(d.length);
    expect(o.model.length).toBe(d.length);
    let peakModel = 0;
    let iPeak = 0;
    for (let i = 0; i < o.model.length; i++)
      if (Math.abs(o.model[i]!) > peakModel) {
        peakModel = Math.abs(o.model[i]!);
        iPeak = i;
      }
    expect(peakModel).toBeCloseTo(1, 5);
    // The model's peak sits at the offset plus the processed envelope's peak (within a cycle).
    expect(Math.abs(t0 + iPeak / fs - (a.offset + p.tPeak))).toBeLessThan(0.006);
    // The glitch does not set the level: the data layer is capped.
    expect(Math.abs(o.mix[100]! - o.model[100]! * MIX.model)).toBeLessThanOrEqual(MIX.dataCeil + 1e-6);
  });

  it('sounds different: heavier is lower and shorter, neutron stars are long', () => {
    const heavy = modelChirp({ m1: 137, m2: 103, mFinal: 222, redshift: 0.4 });
    const bns = modelChirp({ m1: 1.46, m2: 1.27, redshift: 0.01, bns: true });
    expect(heavy.fRing).toBeLessThan(m.fRing / 2);
    expect(-heavy.t0).toBeLessThan(-m.t0 / 3);
    expect(-bns.t0).toBeGreaterThan(-m.t0 * 5);
  });
});
