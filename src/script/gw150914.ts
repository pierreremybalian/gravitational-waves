// GW150914 parameters used by stages 1–7 (pure). Source-frame values: GWOSC event API, GWTC-2.1-confident v4
// (public/data/events.json; a test checks they agree). Detector-frame template masses: src/data/gw150914.json.

import gw from '../data/gw150914.json';
import { chirpMass } from '../gw/chirp.ts';
import { radiatedEnergy, M_SUN, C } from '../gw/units.ts';

/** Source-frame medians, M☉ (GWTC-2.1). */
export const M1 = 34.6;
export const M2 = 30.0;
export const M_FINAL = 61.5;
/** Redshift median (GWTC-2.1). */
export const Z = 0.1;
/** Luminosity distance median, Mpc (GWTC-2.1). */
export const DISTANCE_MPC = 470;

/** Best-fit template, detector frame (what the orbit is computed with, consistently with its frequency track). */
export const TM1 = gw.template.m1;
export const TM2 = gw.template.m2;
export const TM = TM1 + TM2;
/** Remnant in the detector frame (for its horizon radius on the same scale as the template's bodies). */
export const TM_FINAL = M_FINAL * (1 + Z);

/** Energy radiated, in solar masses (× c²) and joules. */
export const RADIATED_MSUN = M1 + M2 - M_FINAL;
export const RADIATED_J = radiatedEnergy(M1, M2, M_FINAL);
export const CHIRP_MASS_DET = chirpMass(TM1, TM2);

/** Joules in one solar mass × c². */
export const MSUN_C2 = M_SUN * C * C;
