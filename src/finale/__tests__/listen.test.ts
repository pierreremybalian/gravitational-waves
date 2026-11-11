// The finale's default sound: the model chirp alone, trimmed to its audible part, loudness matched, pitch ×4 for
// heavy binaries (src/finale/listen.ts).
import { describe, expect, it } from 'vitest';
import { json } from '../../gw/__tests__/data.ts';
import { autoPitch, LISTEN, listenClip, listenModel, listenWindow, loudestRms, peakFrequency, trimTo } from '../listen.ts';
import type { Catalog, CatalogEvent, Interval } from '../../shared/gwdata.ts';

const cat = json<Catalog>('public/data/events.json');
const med = (v: Interval | null) => (v === null ? null : typeof v === 'number' ? v : v[0]);
const withMass = cat.events.filter((e) => med(e.m1) !== null);
const heaviest = withMass.reduce((a, b) => (med(b.mTotal)! > med(a.mTotal)! ? b : a));
const ns = (e: CatalogEvent) => e.type === 'BNS' || e.type === 'NSBH';
const lm = (e: CatalogEvent) => listenModel({ m1: med(e.m1)!, m2: med(e.m2)!, mFinal: med(e.mFinal), redshift: med(e.redshift), bns: e.type === 'BNS' }, ns(e));
const ev = (n: string) => cat.events.find((e) => e.name === n)!;

describe('listening clip', () => {
  it('GW150914: from 20 Hz (under 1.5 s before the merger) through the ringdown + 0.3 s, true pitch', () => {
    const m = lm(ev('GW150914'));
    const w = listenWindow(m);
    expect(m.f[0]).toBeCloseTo(20, 0);
    expect(w.from).toBeGreaterThan(-1.5);
    expect(w.from).toBeLessThan(-0.4);
    expect(w.to).toBeGreaterThan(0.3);
    expect(w.to).toBeLessThan(0.45);
    expect(autoPitch(m)).toBe(1);
  });
  it('GW170817: the neutron-star chirp capped at 4 s, true pitch', () => {
    const m = lm(ev('GW170817'));
    const w = listenWindow(m);
    expect(w.from).toBeCloseTo(-4, 2);
    expect(autoPitch(m)).toBe(1);
  });
  it(`heaviest (${heaviest.name}): short and low, so pitch ×4 by default`, () => {
    const m = lm(heaviest);
    expect(peakFrequency(m)).toBeLessThan(LISTEN.shiftBelow);
    expect(autoPitch(m)).toBe(4);
    const w = listenWindow(m);
    expect(w.to - w.from).toBeLessThan(1);
    // ×4 keeps the timing: same length, envelope peak at the same time.
    const a = listenClip(m, w, 1);
    const b = listenClip(m, w, 4);
    expect(b.length).toBe(a.length);
  });
  it('same loudness (loudest 50 ms RMS) for every event, peak capped, silent ends', () => {
    for (const e of [ev('GW150914'), ev('GW170817'), heaviest, ev('GW190521')]) {
      const m = lm(e);
      const w = listenWindow(m);
      const x = listenClip(m, w, autoPitch(m));
      const peak = x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
      expect(peak).toBeLessThanOrEqual(LISTEN.peak + 1e-6);
      expect(Math.abs(loudestRms(x, LISTEN.fs) - LISTEN.rms)).toBeLessThan(0.01);
      expect(Math.abs(x[0]!)).toBeLessThan(1e-9);
      expect(Math.abs(x[x.length - 1]!)).toBeLessThan(1e-6);
      expect(x.length).toBe(Math.round((w.to - w.from) * LISTEN.fs));
    }
  });
  it('trimTo cuts a snippet to a window on its clock', () => {
    const fs = 2048;
    const x = Float32Array.from({ length: fs * 2 }, () => 1);
    const r = trimTo(x, -1.75, fs, -0.5, 0.2);
    expect(r.t0).toBeCloseTo(-0.5, 3);
    expect(r.data.length / fs).toBeCloseTo(0.7, 2);
    expect(r.data[0]).toBe(0);
    expect(r.data[Math.floor(r.data.length / 2)]).toBe(1);
  });
});
