import { describe, expect, it } from 'vitest';
import gw from '../../data/gw150914.json';
import { chirpMass, chirpMassFromFdot, chirpMassFromTrack, fdot, frequencyAt, relativeSpeed, schwarzschildRadius, separation, timeToCoalescence } from '../chirp.ts';
import { C } from '../units.ts';
import { f32 } from './data.ts';

describe('Newtonian chirp', () => {
  it('chirp mass of 36 + 29 M☉ is about 28', () => {
    expect(chirpMass(36, 29)).toBeCloseTo(28.1, 1);
  });
  it('ḟ ↔ chirp mass round-trips', () => {
    for (const mc of [1.2, 8, 30, 60]) for (const f of [20, 50, 120]) expect(chirpMassFromFdot(f, fdot(f, mc))).toBeCloseTo(mc, 9);
  });
  it('f(τ) and τ(f) are inverses', () => {
    for (const tau of [0.01, 0.2, 3]) expect(timeToCoalescence(frequencyAt(tau, 30), 30)).toBeCloseTo(tau, 9);
  });
  it('a synthetic Newtonian track gives back its chirp mass and coalescence time', () => {
    const t: number[] = [];
    const f: number[] = [];
    for (let i = 0; i < 200; i++) {
      const ti = -1 + i * 0.004;
      t.push(ti);
      f.push(frequencyAt(0.05 - ti, 25));
    }
    const r = chirpMassFromTrack(t, f);
    expect(r.mc).toBeCloseTo(25, 6);
    expect(r.tc).toBeCloseTo(0.05, 6);
  });
  it('GW150914: chirp mass ≈ 30 M☉ from the measured frequency evolution', () => {
    // The frequency track of the template fitted to the data (detector frame), over the inspiral 1 s to 0.2 s
    // before the merger, where the Newtonian law holds best in band.
    const fr = f32('gw150914/template-freq.f32');
    const w = gw.window;
    const t: number[] = [];
    const f: number[] = [];
    for (let i = 0; i < fr.length; i++) {
      const ti = w.t0 + i / w.fs;
      if (ti >= -1 && ti <= -0.2) {
        t.push(ti);
        f.push(fr[i]!);
      }
    }
    const { mc } = chirpMassFromTrack(t, f);
    expect(mc).toBeGreaterThan(28);
    expect(mc).toBeLessThan(33);
    // Agrees with the published source-frame chirp mass, redshifted to the detector frame: 28.6 × (1 + 0.09).
    expect(Math.abs(mc - 28.6 * 1.09)).toBeLessThan(2.5);
  });
});

describe('Kepler', () => {
  it('two 35 M☉ black holes are ~350 km apart at a 150 Hz wave (75 orbits a second)', () => {
    expect(separation(70, 150) / 1e3).toBeGreaterThan(340);
    expect(separation(70, 150) / 1e3).toBeLessThan(355);
  });
  it('they move at about half the speed of light relative to each other', () => {
    const v = relativeSpeed(70, 150) / C;
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.6);
  });
  it('Schwarzschild radius of the Sun is 2.95 km', () => {
    expect(schwarzschildRadius(1) / 1e3).toBeCloseTo(2.953, 3);
  });
});
