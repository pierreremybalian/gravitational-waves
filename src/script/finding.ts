// Stage 10 · Finding it (measured). The landscape of stage 9 is whitened (each frequency divided by the noise curve,
// so the noise lies flat) and band-passed (35–350 Hz kept); the chirp rises out of it as a ridge in the last 0.2 s.
// Then the matched filter: the best-fit template slides along the whitened data; at each offset the network
// signal-to-noise ratio (snr-net, from scripts/fetch-gwosc.py) is read out and drawn by a pen; at zero offset it
// locks at 23.85. Sound: the whitened Hanford data (clip chirp-H1), real speed and pitch.

import gw from '../data/gw150914.json';
import stats from '../data/detector-stats.json';
import { ramp, track, windowed } from '../time/tracks.ts';
import { registerStage, type Readout } from './index.ts';

export const BAND = gw.bandpass as [number, number];
/** Template offset range (s): it enters this far before the merger. */
export const SLIDE_FROM = -0.42;

export const FIND = {
  whiten: track([
    [0.12, 0],
    [0.3, 1],
  ]),
  band: track([
    [0.3, 0],
    [0.4, 1],
  ]),
  land: (l: number) => 1 - ramp(l, 0.46, 0.56),
  tape: (l: number) => ramp(l, 0.48, 0.56),
  /** 0–1 through the slide: offset = SLIDE_FROM · (1 − s)³ (slows into the lock). */
  slide: track(
    [
      [0.58, 0],
      [0.88, 1],
    ],
    (s) => s,
  ),
  lock: (l: number) => ramp(l, 0.87, 0.9),
  pen: (l: number) => windowed(l, 0.56, 1.01, 0.03, 0.01),
};

export const offsetAt = (l: number): number => SLIDE_FROM * Math.pow(1 - FIND.slide(l), 3);

registerStage('finding', {
  note: 'Measured: the whitened Hanford data, the best-fit template and the matched-filter signal-to-noise ratio computed from them. The template is a model fitted to the data.',
  readouts(l): Readout[] {
    if (l < 0.46)
      return [
        { label: 'Whitened', value: 'each frequency ÷ its noise', tone: 'b' },
        { label: 'Band kept', value: `${BAND[0]}–${BAND[1]} Hz`, tone: 'mute' },
        { label: 'Peak', value: `${stats.whitePeakH1.toFixed(1)} σ`, tone: 'a' },
      ];
    const locked = FIND.lock(l) > 0.5;
    const off = offsetAt(l);
    return [
      { label: 'Template offset', value: locked ? '0 ms' : `${(off * 1000).toFixed(0)} ms`, tone: 'both' },
      { label: 'Network SNR, peak', value: locked ? stats.snr.net.toFixed(2) : '…', tone: 'warm' },
      { label: 'Hanford · Livingston', value: `${stats.snr.h1.toFixed(1)} · ${stats.snr.l1.toFixed(1)}`, tone: 'mute' },
    ];
  },
  sound(l) {
    return l >= 0.1 ? { clip: 'chirp-H1', loop: true, gap: 1.2 } : null;
  },
});
