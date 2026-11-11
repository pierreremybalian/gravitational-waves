// Stage 12 · What it told us (measured). The masses: two black holes of 35 and 30 suns became one of 62; three
// suns' worth of mass left as gravitational waves. Drawn as beads, one per solar mass (rounded medians), that fuse
// on the merger of the chirp heard (clip chirp-H1). Then the distance (the wave travelled about 1.3 billion years),
// then GW170817: two neutron stars 40 Mpc away whose gravitational waves and gamma-ray flash arrived 1.74 s apart
// after 130 million years, so gravity travels at the speed of light to within a few parts in 10¹⁵.
//
// Numbers: the catalogue's current values (GWOSC event API, GWTC-2.1 for GW150914; src/data/results.json) beside
// the 2016 announcement (PRL 116, 061102, Table I); GW170817's delay and speed bound from Abbott et al. 2017,
// ApJL 848, L13.

import results from '../data/results.json';
import { mpcToLy, radiatedEnergy } from '../gw/units.ts';
import { ramp, windowed } from '../time/tracks.ts';
import { registerStage, type Readout } from './index.ts';
import { exp10 } from './detfmt.ts';

type Iv = number | number[] | null;
const med = (v: Iv): number => (v === null ? NaN : typeof v === 'number' ? v : v[0]!);

const E = results.GW150914;
const N = results.GW170817;
export const CAT = { m1: med(E.m1), m2: med(E.m2), mf: med(E.mFinal), d: med(E.distance), z: med(E.redshift), version: `${E.catalog} v${E.version}` };
export const RADIATED = CAT.m1 + CAT.m2 - CAT.mf;
export const ENERGY_J = radiatedEnergy(CAT.m1, CAT.m2, CAT.mf);
/** PRL 116, 061102 (2016), Table I: source-frame medians. */
export const PRL = { m1: 36, m2: 29, mf: 62, erad: 3.0, d: 410, z: 0.09 };
/** One bead per solar mass: rounded medians. */
export const BEADS = { m1: Math.round(CAT.m1), m2: Math.round(CAT.m2), mf: Math.round(CAT.mf) };
export const BNS = {
  d: med(N.distance),
  /** GRB 170817A followed the merger by 1.74 ± 0.05 s (ApJL 848 L13). */
  delay: 1.74,
  /** −3 × 10⁻¹⁵ ≤ (v_gw − c)/c ≤ +7 × 10⁻¹⁶ (same paper). */
  lo: -3e-15,
  hi: 7e-16,
};
export const lyOf = (mpc: number) => mpcToLy(mpc);

export const RES = {
  masses: (l: number) => windowed(l, 0.02, 0.5, 0.05, 0.06),
  travel: (l: number) => windowed(l, 0.44, 0.74, 0.06, 0.06),
  bns: (l: number) => ramp(l, 0.7, 0.78),
  /** GW170817 race: 0–1 along the path. */
  race: (l: number) => ramp(l, 0.76, 0.94, (s) => s),
};

const bly = (mpc: number) => `${(lyOf(mpc) / 1e9).toFixed(2)} billion ly`;

registerStage('results', {
  note: 'Measured: masses, distance and energy from the published fits to the data (medians with 90% ranges in the text); one bead is one solar mass. Distances are not to scale.',
  readouts(l): Readout[] {
    if (l < 0.46)
      return [
        { label: 'Catalogue', value: `${CAT.m1} + ${CAT.m2} → ${CAT.mf} M☉`, tone: 'a' },
        { label: '2016 paper', value: `${PRL.m1} + ${PRL.m2} → ${PRL.mf} M☉`, tone: 'mute' },
        { label: 'Radiated', value: `${RADIATED.toFixed(1)} M☉ = ${exp10(ENERGY_J)} J`, tone: 'warm' },
      ];
    if (l < 0.72)
      return [
        { label: 'Distance (catalogue)', value: `${CAT.d} Mpc, ${bly(CAT.d)}`, tone: 'a' },
        { label: '2016 paper', value: `${PRL.d} Mpc, ${bly(PRL.d)}`, tone: 'mute' },
        { label: 'Redshift', value: `${CAT.z}`, tone: 'mute' },
      ];
    return [
      { label: 'GW170817', value: `${BNS.d} Mpc, ${(lyOf(BNS.d) / 1e6).toFixed(0)} million ly`, tone: 'light' },
      { label: 'Flash after the wave', value: `${BNS.delay} s`, tone: 'light' },
      { label: 'Speed of gravity − c', value: `−3 × 10⁻¹⁵ … +7 × 10⁻¹⁶ of c`, tone: 'both' },
    ];
  },
  sound(l) {
    return l >= 0.05 && l < 0.46 ? { clip: 'chirp-H1', loop: true, gap: 1.6 } : null;
  },
});

