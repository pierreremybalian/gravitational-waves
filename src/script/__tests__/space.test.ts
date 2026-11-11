// Numbers shown in stages 1–7 agree with the data and the physics core.
import { describe, expect, it } from 'vitest';
import { json } from '../../gw/__tests__/data.ts';
import { M1, M2, M_FINAL, Z, DISTANCE_MPC, RADIATED_MSUN, CHIRP_MASS_DET } from '../gw150914.ts';
import { KEPLER_MAX_F, keplerSeparationKm, keplerSpeedC } from '../inspiral.ts';
import { ARM_CHANGE, PROTON_RATIO, scaleZoom, SIZES } from '../scale.ts';
import { SUN_DEFLECTION_ARCSEC } from '../fabric.ts';
import { SLOW_BINARY, SLOW_INSPIRAL, SLOW_MERGER, slowDuration } from '../slow.ts';
import { ripplePart } from '../ripples.ts';
import { soundAt } from '../sound.ts';
import { sci } from '../fmt.ts';

type Ev = { name: string; m1: number[]; m2: number[]; mFinal: number[]; redshift: number[]; distance: number[] };

describe('GW150914 constants', () => {
  const ev = json<{ events: Ev[] }>('public/data/events.json').events.find((e) => e.name === 'GW150914')!;
  it('match the catalogue medians', () => {
    expect(M1).toBe(ev.m1[0]);
    expect(M2).toBe(ev.m2[0]);
    expect(M_FINAL).toBe(ev.mFinal[0]);
    expect(Z).toBe(ev.redshift[0]);
    expect(DISTANCE_MPC).toBe(ev.distance[0]);
  });
  it('radiate about three solar masses', () => {
    expect(RADIATED_MSUN).toBeCloseTo(3.1, 5);
  });
  it('chirp mass of the template ≈ 30 M☉ (detector frame)', () => {
    expect(CHIRP_MASS_DET).toBeGreaterThan(29.5);
    expect(CHIRP_MASS_DET).toBeLessThan(31);
  });
});

describe('stage numbers', () => {
  it('Kepler at 150 Hz: ~350 km apart at ~0.55 c', () => {
    expect(keplerSeparationKm(KEPLER_MAX_F)).toBeGreaterThan(330);
    expect(keplerSeparationKm(KEPLER_MAX_F)).toBeLessThan(370);
    expect(keplerSpeedC(KEPLER_MAX_F)).toBeCloseTo(0.55, 1);
    expect(keplerSeparationKm(400)).toBe(keplerSeparationKm(KEPLER_MAX_F));
  });
  it('arm change 2.0e-18 m, 1/840 of a proton', () => {
    expect(ARM_CHANGE).toBeCloseTo(2.0e-18, 19);
    expect(Math.round(PROTON_RATIO)).toBeGreaterThan(830);
    expect(Math.round(PROTON_RATIO)).toBeLessThan(850);
    expect(scaleZoom(1)).toBeLessThan(Math.log10(SIZES.shift) + 0.5);
  });
  it('starlight at the Sun bends 1.75″', () => {
    expect(SUN_DEFLECTION_ARCSEC).toBeCloseTo(1.75, 2);
  });
  it('slowed clips are a few seconds long and end after the merger', () => {
    for (const s of [SLOW_BINARY, SLOW_INSPIRAL, SLOW_MERGER]) {
      expect(slowDuration(s)).toBeGreaterThan(3);
      expect(slowDuration(s)).toBeLessThan(12);
    }
    expect(SLOW_INSPIRAL.to).toBeGreaterThan(0);
    expect(SLOW_MERGER.from).toBeLessThan(0);
  });
  it('stage parts and sounds', () => {
    expect(ripplePart(0.05)).toBe('calm');
    expect(ripplePart(0.95)).toBe('real');
    expect(soundAt(0).clip).toBe('chirp-H1');
    expect(soundAt(0.5).clip).toBe('chirp-L1');
    expect(soundAt(0.9).clip).toBe('chirp-H1-x4');
    expect(sci(2.0e-18)).toBe('2.0 × 10⁻¹⁸');
  });
});
