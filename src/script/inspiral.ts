// Stage 5 · The inspiral. The last 0.6 s before the merger from the measured frequency track (the best-fit template
// that matches the data): the orbit shrinks and speeds up, the chirp rises, and Kepler's law turns the frequency into
// a separation and a speed (Newtonian estimate, held from 150 Hz where it stops being meaningful).
import { registerStage } from './index.ts';
import type { SoundRequest } from '../audio/schedule.ts';
import { SLOW_INSPIRAL } from './slow.ts';
import { CHIRP_MASS_DET, TM } from './gw150914.ts';
import { relativeSpeed, separation } from '../gw/chirp.ts';
import { C } from '../gw/units.ts';
import { group } from './fmt.ts';

/** Kepler's estimate is shown up to this gravitational-wave frequency (orbit 75 Hz), then held. */
export const KEPLER_MAX_F = 150;
export const keplerSeparationKm = (f: number) => separation(TM, Math.min(f, KEPLER_MAX_F)) / 1e3;
export const keplerSpeedC = (f: number) => relativeSpeed(TM, Math.min(f, KEPLER_MAX_F)) / C;

const REQ: SoundRequest = { clip: SLOW_INSPIRAL.id, loop: true, gap: 1.0 };

export const inspiral = registerStage('inspiral', {
  note: `Measured frequency, modelled orbit: the gravitational-wave frequency and phase are the best-fit template that matches the data; separation and speed follow from Kepler’s law with the template’s masses (a Newtonian estimate, shown up to ${KEPLER_MAX_F} Hz). Time slowed ×${SLOW_INSPIRAL.slow}, pitch ×${SLOW_INSPIRAL.pitch}.`,
  readouts: () => [
    { label: 'Total mass (as seen)', value: `${TM.toFixed(1)} M☉`, tone: 'warm' },
    { label: 'Chirp mass', value: `${CHIRP_MASS_DET.toFixed(1)} M☉`, tone: 'warm' },
    { label: `At ${KEPLER_MAX_F} Hz`, value: `${group(keplerSeparationKm(KEPLER_MAX_F))} km apart, ${keplerSpeedC(KEPLER_MAX_F).toFixed(2)} c`, tone: 'light' },
    { label: 'Time · tone', value: `slowed ×${SLOW_INSPIRAL.slow} · pitch ×${SLOW_INSPIRAL.pitch}`, tone: 'mute' },
  ],
  sound: () => REQ,
});
