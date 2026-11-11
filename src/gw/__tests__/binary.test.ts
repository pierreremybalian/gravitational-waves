import { describe, expect, it } from 'vitest';
import gw from '../../data/gw150914.json';
import { PLUNGE, binaryAt, createBinaryState, sampleAt, type Track } from '../binary.ts';
import { f32 } from './data.ts';

const track: Track = {
  t0: gw.window.t0,
  fs: gw.window.fs,
  f: f32('gw150914/template-freq.f32'),
  phase: f32('gw150914/template-phase.f32'),
  amp: f32('gw150914/template-amp.f32'),
};
const p = { m1: gw.template.m1, m2: gw.template.m2, mFinal: 67 };

describe('binary from the GW150914 template', () => {
  it('keeps the centre of mass at the origin and the bodies a apart', () => {
    const s = createBinaryState();
    for (const t of [-1.5, -0.5, -0.1, -0.03]) {
      binaryAt(track, p, t, s);
      expect(s.x1 * p.m1 + s.x2 * p.m2).toBeCloseTo(0, 3);
      expect(s.y1 * p.m1 + s.y2 * p.m2).toBeCloseTo(0, 3);
      expect(Math.hypot(s.x1 - s.x2, s.y1 - s.y2)).toBeCloseTo(s.a, 3);
    }
  });
  it('orbits at half the wave frequency', () => {
    const s = createBinaryState();
    const t = -0.3;
    const dt = 1 / 4096;
    binaryAt(track, p, t, s);
    const a = s.orbitPhase;
    const f = s.f;
    binaryAt(track, p, t + dt, s);
    const forb = Math.abs(s.orbitPhase - a) / (2 * Math.PI * dt);
    expect(forb).toBeCloseTo(f / 2, 0);
  });
  it('spirals in, speeds up, and merges at t = 0', () => {
    const s = createBinaryState();
    binaryAt(track, p, -1, s);
    const a0 = s.a;
    const v0 = s.v;
    binaryAt(track, p, -0.05, s);
    expect(s.a).toBeLessThan(a0);
    expect(s.v).toBeGreaterThan(v0);
    expect(s.a / 1e3).toBeGreaterThan(300);
    binaryAt(track, p, -PLUNGE / 2, s);
    expect(s.plunge).toBeGreaterThan(0);
    binaryAt(track, p, 0.001, s);
    expect(s.merged).toBe(true);
    expect(s.a).toBe(0);
  });
  it('the template peaks at the merger (t = 0)', () => {
    const amp = track.amp!;
    let k = 0;
    for (let i = 1; i < amp.length; i++) if (amp[i]! > amp[k]!) k = i;
    expect(Math.abs(track.t0 + k / track.fs)).toBeLessThan(2 / track.fs);
    expect(sampleAt(amp, track.t0, track.fs, 0)).toBeGreaterThan(0.9);
  });
});
