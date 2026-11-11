// Stage 11 · Two detectors (measured). Hanford and Livingston on the Earth: 3,002 km apart in a straight line, so a
// wave moving at light speed reaches them at most 10.01 ms apart. GW150914 reached Livingston first, 7.09 ms before
// Hanford (matched-filter peaks), and Livingston's signal is upside down: its arms are turned about 90° from
// Hanford's once the Earth's curvature is taken into account. The delay alone puts the source on a ring of the sky
// (cos θ = 7.09 / 10.01 around the Hanford → Livingston direction); the published sky map is a part of it, which
// the two detectors' sensitivity patterns pick out.
// The wavefront's sweep is scroll-driven (the real crossing takes 7 ms); sound: Livingston, then Hanford.

import gw from '../data/gw150914.json';
import { baseline, DETECTORS, lightTravel } from '../gw/units.ts';
import { ramp, track, windowed } from '../time/tracks.ts';
import { registerStage, type Readout } from './index.ts';

export const DT = -gw.offset.dtL1; // s, Hanford after Livingston (positive)
export const LIGHT = lightTravel(DETECTORS.H1, DETECTORS.L1);
export const RING_COS = DT / LIGHT;
export const BASELINE_KM = baseline(DETECTORS.H1, DETECTORS.L1) / 1000;
/** Angle between the two sites' X arms (degrees, as surveyed, before the Earth's curvature). */
export const ARM_ANGLE = Math.abs((DETECTORS.H1.xArmAzimuth ?? 0) - (DETECTORS.L1.xArmAzimuth ?? 0));

export const DET = {
  sites: track([
    [0.04, 0],
    [0.16, 1],
  ]),
  chord: (l: number) => windowed(l, 0.2, 1.01, 0.05, 0.01),
  /** Wavefront time relative to the H1 merger (s), scroll-driven: sweeps from −14 ms to +5 ms. */
  sweep: track(
    [
      [0.3, -0.016],
      [0.52, 0.006],
    ],
    (s) => s,
  ),
  front: (l: number) => windowed(l, 0.28, 0.56, 0.03, 0.04),
  ring: (l: number) => ramp(l, 0.56, 0.64),
  band: (l: number) => ramp(l, 0.62, 0.7),
  traces: (l: number) => ramp(l, 0.72, 0.78),
  /** L1 trace: shifted later by DT, then flipped. */
  shift: track([
    [0.8, 0],
    [0.87, 1],
  ]),
  flip: track([
    [0.89, 0],
    [0.96, 1],
  ]),
};

const ms = (s: number) => `${(s * 1000).toFixed(2)} ms`;

registerStage('detectors', {
  note: 'Measured: detector positions and arm directions as surveyed, the 7.09 ms delay and the sign flip from the matched filter. The wavefront’s sweep is slowed to the pace of your scroll; the arms are drawn hundreds of kilometres long.',
  readouts(l): Readout[] {
    const rows: Readout[] = [
      { label: 'Apart', value: `${Math.round(BASELINE_KM).toLocaleString('en-US')} km`, tone: 'plain' },
      { label: 'Light limit', value: ms(LIGHT), tone: 'mute' },
    ];
    if (l >= 0.3) rows.push({ label: 'Livingston first by', value: ms(DT), tone: 'b' });
    if (l >= 0.56) rows.push({ label: 'Ring of directions', value: `${((Math.acos(RING_COS) * 180) / Math.PI).toFixed(1)}° from the baseline`, tone: 'both' });
    if (l >= 0.88) rows.push({ label: 'Livingston', value: 'shifted 7.09 ms, inverted', tone: 'b' });
    return rows;
  },
  sound(l) {
    if (l < 0.1) return null;
    return l < 0.6 ? { clip: 'chirp-L1', loop: true, gap: 1.2 } : { clip: 'chirp-H1', loop: true, gap: 1.2 };
  },
});
