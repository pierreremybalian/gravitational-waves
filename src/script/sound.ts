// Stage 1 · A sound from space. The real chirp plays from the first moment: Hanford, then Livingston, then Hanford
// raised two octaves for small speakers. The scene draws both recordings as ribbons lit by the playhead.
import { registerStage, type Readout } from './index.ts';
import type { SoundRequest } from '../audio/schedule.ts';
import { track } from '../time/tracks.ts';

/** Which recording plays at each part of the stage. */
export const SOUND_PARTS = { l1: 0.4, x4: 0.68 } as const;

const H1: SoundRequest = { clip: 'chirp-H1', loop: true, gap: 1.4 };
const L1: SoundRequest = { clip: 'chirp-L1', loop: true, gap: 1.4 };
const X4: SoundRequest = { clip: 'chirp-H1-x4', loop: true, gap: 1.4 };

export function soundAt(local: number): SoundRequest {
  return local < SOUND_PARTS.l1 ? H1 : local < SOUND_PARTS.x4 ? L1 : X4;
}

/** Time-axis zoom: 0 = the whole 2 s clip, 1 = the last 0.35 s around the merger. */
export const soundZoom = track([
  [0.0, 0],
  [0.2, 0],
  [0.34, 1],
  [0.86, 1],
  [1.0, 0.35],
]);
/** The best-fit model drawn over the data. */
export const soundModel = track([
  [0.5, 0],
  [0.58, 1],
]);

export const sound = registerStage('sound', {
  note: 'Measured: the two detectors’ own recordings, whitened and band-passed to 35–350 Hz, played at their real speed. The last part plays Hanford two octaves higher (×4 pitch, same timing) so small speakers carry it.',
  readouts: (local): Readout[] => {
    const part = local < SOUND_PARTS.l1 ? 'H1' : local < SOUND_PARTS.x4 ? 'L1' : 'x4';
    return [
      { label: 'Event', value: 'GW150914 · 14 Sep 2015', tone: 'both' },
      part === 'L1'
        ? { label: 'Playing', value: 'Livingston (L1)', tone: 'b' }
        : { label: 'Playing', value: 'Hanford (H1)', tone: 'a' },
      { label: 'Pitch', value: part === 'x4' ? '×4 (two octaves up)' : 'real', tone: part === 'x4' ? 'warm' : 'plain' },
      { label: 'Band', value: '35–350 Hz, whitened', tone: 'mute' },
    ];
  },
  sound: soundAt,
});
