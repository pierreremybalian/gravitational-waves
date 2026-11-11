// Stage 4 · Two black holes. The binary early in its inspiral, its orbit driven by the best-fit template's phase
// (orbital phase = half the wave's), radiating a two-armed spiral of waves; time slowed, pitch raised, both stated.
import { registerStage } from './index.ts';
import type { SoundRequest } from '../audio/schedule.ts';
import { LOOP_GAP, SLOW_BINARY } from './slow.ts';
import { TM1, TM2 } from './gw150914.ts';
import { ramp } from '../time/tracks.ts';

/** Picture: waves travel outward at this fraction of light speed, so several arms fit in the frame. */
export const WAVE_SPEED_FRACTION = 0.25;
/** Display metres per world unit (orbits and horizons to scale). */
export const METRES_PER_UNIT = 200e3;

export const binaryField = (local: number) => ramp(local, 0.26, 0.5);
/** The "twice per orbit" probe: a point on the sheet that flashes with each crest. */
export const binaryProbe = (local: number) => ramp(local, 0.6, 0.72);

const REQ: SoundRequest = { clip: SLOW_BINARY.id, loop: true, gap: LOOP_GAP };

export const binary = registerStage('binary', {
  note: `Modelled: the orbit turns with the best-fit template’s own phase, at half the wave’s frequency, with sizes from Kepler’s law and the horizons to scale. Time is slowed ×${SLOW_BINARY.slow} and the tone raised ×${SLOW_BINARY.pitch} (three octaves) so you can follow it; the waves’ height pictures strain, and they are drawn at ${WAVE_SPEED_FRACTION} of light speed so the spiral fits.`,
  readouts: () => [
    { label: 'Masses (as seen)', value: `${TM1.toFixed(1)} + ${TM2.toFixed(1)} M☉`, tone: 'warm' },
    { label: 'Wave frequency', value: '2 × orbit frequency', tone: 'light' },
    { label: 'Time', value: `slowed ×${SLOW_BINARY.slow}`, tone: 'mute' },
    { label: 'Tone', value: `pitch ×${SLOW_BINARY.pitch}`, tone: 'mute' },
  ],
  sound: () => REQ,
});
