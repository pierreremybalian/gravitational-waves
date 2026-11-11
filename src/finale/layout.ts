// Where each catalogue event sits in the finale's 3D view (pure). Two arrangements, the same height for mass:
//  - 'time': a spiral of discovery, from GW150914 at the centre outward to the latest event (angle and radius by
//    detection time), height = log mass, so each event is a vertical stem from its lighter to its heavier body with
//    the remnant on top (the "graveyard" read in 3D);
//  - 'distance': mass against luminosity distance (log), with depth by date.
// Events without published parameters ("candidates") sit on the floor, below the mass scale, in date order.

import { median, type CatalogEvent, type Interval } from '../shared/gwdata.ts';

export type View = 'time' | 'distance';

export const MASS_MIN = 1;
export const MASS_MAX = 300;
export const MASS_HEIGHT = 2.6;
export const FLOOR = -0.32;
export const DIST_MIN = 30;
export const DIST_MAX = 15000;
export const DIST_WIDTH = 6.4;
export const SPIRAL_TURNS = 2.25;
export const SPIRAL_R0 = 0.55;
export const SPIRAL_R1 = 3.2;

/** Height of a mass (M☉) on the shared log scale. */
export const massY = (m: number): number => (Math.log10(Math.max(MASS_MIN, m) / MASS_MIN) / Math.log10(MASS_MAX / MASS_MIN)) * MASS_HEIGHT;
/** x of a luminosity distance (Mpc) in the distance view. */
export const distX = (d: number): number => (Math.log10(Math.max(DIST_MIN, d) / DIST_MIN) / Math.log10(DIST_MAX / DIST_MIN) - 0.5) * DIST_WIDTH;

export interface Placed {
  /** Position in the time spiral and in the distance view (x, z), the masses' heights. */
  time: [number, number];
  dist: [number, number];
  y1: number;
  y2: number;
  yf: number;
  hasMass: boolean;
  /** 0–1 by detection time. */
  u: number;
}

const med = (v: Interval | null): number | null => median(v);

export function spiralAt(u: number): [number, number] {
  const a = u * SPIRAL_TURNS * Math.PI * 2;
  const r = SPIRAL_R0 + (SPIRAL_R1 - SPIRAL_R0) * Math.sqrt(u);
  return [r * Math.cos(a), r * Math.sin(a)];
}

export function placeEvents(events: readonly CatalogEvent[]): Placed[] {
  const g0 = events.reduce((m, e) => Math.min(m, e.gps), Infinity);
  const g1 = events.reduce((m, e) => Math.max(m, e.gps), -Infinity);
  return events.map((e) => {
    const u = g1 > g0 ? (e.gps - g0) / (g1 - g0) : 0;
    const m1 = med(e.m1);
    const m2 = med(e.m2);
    const hasMass = m1 !== null && m2 !== null;
    const mf = med(e.mFinal) ?? (hasMass ? m1! + m2! : null);
    const d = med(e.distance);
    const time = spiralAt(u);
    const z = (u - 0.5) * 2.6;
    const dist: [number, number] = hasMass && d !== null ? [distX(d), z] : [DIST_WIDTH / 2 + 0.7, z];
    return {
      time,
      dist,
      y1: hasMass ? massY(m1!) : FLOOR,
      y2: hasMass ? massY(m2!) : FLOOR,
      yf: mf !== null ? massY(mf) : FLOOR,
      hasMass,
      u,
    };
  });
}

/** The events the quick picks point at. */
export function picks(events: readonly CatalogEvent[]): { first: string; loudest: string; heaviest: string; bns: string } {
  const withSnr = events.filter((e) => med(e.snr) !== null);
  const loudest = withSnr.reduce((a, b) => (med(b.snr)! > med(a.snr)! ? b : a));
  const withMass = events.filter((e) => med(e.mTotal) !== null);
  const heaviest = withMass.reduce((a, b) => (med(b.mTotal)! > med(a.mTotal)! ? b : a));
  return { first: events[0]!.name, loudest: loudest.name, heaviest: heaviest.name, bns: 'GW170817' };
}
