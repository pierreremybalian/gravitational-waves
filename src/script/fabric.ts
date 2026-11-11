// Stage 2 · Spacetime is a fabric. A sheet of spacetime; a star dimples it; light bends around the dimple; a planet
// rolls round it. The sheet is a picture of curvature (metaphor); the bending figure is computed.
import { registerStage } from './index.ts';
import { GM_SUN, C } from '../gw/units.ts';
import { ramp, track } from '../time/tracks.ts';

/** Nominal solar radius, m (IAU 2015 B3). */
const R_SUN = 6.957e8;
/** Deflection of starlight grazing the Sun: 4GM/(c²R) (general relativity; twice the Newtonian value). */
export const SUN_DEFLECTION_ARCSEC = ((4 * GM_SUN) / (C * C * R_SUN)) * (180 / Math.PI) * 3600;

/** Well depth 0–1 (the star settles in). */
export const fabricMass = track([
  [0.14, 0],
  [0.36, 1],
]);
/** Light rays drawn 0–1. */
export const fabricLight = (local: number) => ramp(local, 0.4, 0.62);
/** The planet's orbit 0–1. */
export const fabricOrbit = (local: number) => ramp(local, 0.66, 0.8);
/** A first ripple runs out across the sheet at the very end (setting up stage 3). */
export const fabricRipple = (local: number) => ramp(local, 0.88, 1.0);

export const fabric = registerStage('fabric', {
  note: 'Established physics, drawn as a metaphor: the dimpled sheet is a two-dimensional picture of curved spacetime with its depth exaggerated, and the light paths are bent far more than any real star could bend them.',
  readouts: (local) => [
    { label: 'Mass', value: 'curves spacetime', tone: 'warm' },
    { label: 'Light', value: 'follows the curve', tone: local > 0.4 ? 'light' : 'mute' },
    { label: 'Starlight at the Sun’s edge', value: `bent ${SUN_DEFLECTION_ARCSEC.toFixed(2)}″`, tone: 'plain' },
    { label: 'First measured', value: '1919 eclipse', tone: 'mute' },
  ],
  sound: () => null,
});
