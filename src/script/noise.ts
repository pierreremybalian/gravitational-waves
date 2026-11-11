// Stage 9 · Noise (measured). What Hanford actually recorded around GW150914: the raw strain wobbles hundreds of
// times more than the signal (mostly slow ground motion), so the chirp is invisible in it. Then the same three
// seconds as a landscape of time × frequency × amplitude, with the noise curve (ASD over the full 32 s) as the far
// ridge: a wall of seismic and control noise at low frequency, a valley around 100–300 Hz, quantum (shot) noise
// rising at high frequency, and narrow lines (60 Hz mains, the mirror suspensions' violin modes near 500 Hz).
// Sound: the raw recording itself (clip raw-H1, defined by the scene from raw-H1.f32).

import stats from '../data/detector-stats.json';
import { ramp, track, windowed } from '../time/tracks.ts';
import { registerStage, type Readout } from './index.ts';
import { exp10 } from './detfmt.ts';

export const RAW_CLIP = 'raw-H1';

export const NOISE = {
  /** Raw trace on, then the signal drawn at the same scale, then magnified. */
  trace: (l: number) => windowed(l, 0.02, 0.74, 0.08, 0.12),
  signal: (l: number) => ramp(l, 0.2, 0.27),
  /** Signal magnification: 1 → rawOverSignalPeak / 2 (so it fills half the raw trace's height). */
  zoom: track([
    [0.32, 0],
    [0.44, 1],
  ]),
  /** Landscape: rows grow from the front (latest) to the back, then the ASD ridge. */
  land: track([
    [0.5, 0],
    [0.7, 1],
  ]),
  wall: (l: number) => ramp(l, 0.62, 0.72),
  names: (l: number) => ramp(l, 0.74, 0.8),
};

export const SIGNAL_ZOOM = stats.rawOverSignalPeak / 2;

registerStage('noise', {
  note: 'Measured: Hanford’s raw strain and its noise spectrum around GW150914. Nothing is exaggerated except where a magnification is stated.',
  readouts(l): Readout[] {
    if (l < 0.48)
      return [
        { label: 'Raw wobble (rms)', value: exp10(stats.rawRmsH1), tone: 'a' },
        { label: 'Signal, peak', value: exp10(stats.signalPeak), tone: 'both' },
        { label: 'Ratio', value: `${Math.round(stats.rawOverSignalRms)} : 1`, tone: 'mute' },
      ];
    return [
      { label: 'Quietest', value: `${exp10(stats.asd.minValue)} /√Hz near ${Math.round(stats.asd.minFreq)} Hz`, tone: 'b' },
      { label: 'At 15 Hz', value: `${exp10(stats.asd.at15)} /√Hz`, tone: 'a' },
      { label: 'Mains line', value: `${Math.round(stats.asd.mainsFreq)} Hz`, tone: 'mute' },
    ];
  },
  sound(l) {
    return l >= 0.08 ? { clip: RAW_CLIP, loop: true, gap: 0.8 } : null;
  },
});
