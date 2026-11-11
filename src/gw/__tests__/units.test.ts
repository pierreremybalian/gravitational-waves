import { describe, expect, it } from 'vitest';
import gw from '../../data/gw150914.json';
import { DETECTORS, LIGO_ARM, M_SUN, PROTON_DIAMETER, armChange, armDifference, lightTravel, lyToMpc, mpcToLy, radiatedEnergy, C } from '../units.ts';

describe('units', () => {
  it('solar mass from the IAU nominal GM☉ and CODATA G', () => {
    expect(M_SUN).toBeCloseTo(1.98841e30, -26);
  });
  it('Hanford–Livingston light travel time is 10.0 ms', () => {
    const t = lightTravel(DETECTORS.H1, DETECTORS.L1);
    expect(t * 1e3).toBeGreaterThan(9.95);
    expect(t * 1e3).toBeLessThan(10.05);
  });
  it('the measured GW150914 offset fits inside the light travel limit', () => {
    const lim = lightTravel(DETECTORS.H1, DETECTORS.L1);
    expect(Math.abs(gw.offset.dtL1)).toBeLessThan(lim);
    expect(gw.offset.dtL1 * 1e3).toBeGreaterThan(-7.6);
    expect(gw.offset.dtL1 * 1e3).toBeLessThan(-6.6);
    expect(gw.offset.sign).toBe(-1);
  });
  it('Mpc ↔ light years', () => {
    expect(mpcToLy(1)).toBeCloseTo(3.2616e6, -2);
    expect(mpcToLy(410) / 1e9).toBeCloseTo(1.337, 2);
    expect(lyToMpc(mpcToLy(123))).toBeCloseTo(123, 9);
  });
  it('a 10⁻²¹ strain moves each 4 km arm by about a thousandth of a proton', () => {
    expect(LIGO_ARM).toBe(3995);
    const dL = armChange(1e-21);
    expect(dL).toBeCloseTo(2.0e-18, 19);
    const frac = dL / PROTON_DIAMETER;
    expect(frac).toBeGreaterThan(1 / 1000);
    expect(frac).toBeLessThan(1 / 700);
    expect(armDifference(1e-21)).toBeCloseTo(2 * dL, 30);
  });
  it('GW150914 radiated about three solar masses', () => {
    const E = radiatedEnergy(35.6, 30.6, 63.1);
    expect(E / (M_SUN * C * C)).toBeCloseTo(3.1, 6);
    expect(E).toBeGreaterThan(5e47);
  });
});
