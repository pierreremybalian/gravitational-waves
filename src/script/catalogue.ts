// Stage 13 · The catalogue (finale, measured). Every confirmed event GWOSC lists (GWTC-1 … GWTC-5.0) as beads: the
// intro scroll lays them out in order of discovery, then the tool takes over (src/finale/ui): filters, picking an
// event, hearing its data or a model chirp. The readouts follow the selection (set by the finale UI through
// setCatalogueReadouts; this module stays pure).

import results from '../data/results.json';
import { ramp, track } from '../time/tracks.ts';
import { registerStage, type Readout } from './index.ts';

export const SUMMARY = results.summary;
/** Local at which the tool takes over (panel live, captions step aside on engagement). */
export const TOOL_AT = 0.3;

export const CAT = {
  /** 0–1 through the events in date order as they appear. */
  appear: track(
    [
      [0.04, 0],
      [0.24, 1],
    ],
    (s) => s,
  ),
  axes: (l: number) => ramp(l, 0.14, 0.24),
};

let live: Readout[] | null = null;
let liveStatus: 'measured' | 'modelled' = 'measured';

/** The finale UI publishes the selected event's rows here (null = the default summary). */
export function setCatalogueReadouts(rows: Readout[] | null, status: 'measured' | 'modelled' = 'measured'): void {
  live = rows;
  liveStatus = status;
}

export const catalogueStatus = () => liveStatus;

registerStage('catalogue', {
  note: 'Measured: GWOSC’s catalogue of confident detections and candidates, with published medians; model chirps are labelled modelled.',
  readouts(l): Readout[] {
    if (live && l >= TOOL_AT) return live;
    return [
      { label: 'Events', value: `${SUMMARY.total}`, tone: 'plain' },
      { label: 'Black-hole pairs', value: `${SUMMARY.BBH}`, tone: 'warm' },
      { label: 'With neutron stars', value: `${SUMMARY.NSBH + SUMMARY.BNS}`, tone: 'light' },
      { label: 'No parameters yet', value: `${SUMMARY.candidates}`, tone: 'mute' },
    ];
  },
  sound() {
    return null;
  },
});
