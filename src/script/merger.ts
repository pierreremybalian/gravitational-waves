// Stage 6 · Merger and ringdown. The horizons touch and become one; the remnant rings like a bell, its tone the
// template's ringdown, and settles. About three suns' worth of mass leaves as gravitational waves.
import { registerStage } from './index.ts';
import type { SoundRequest } from '../audio/schedule.ts';
import { LOOP_GAP, SLOW_MERGER } from './slow.ts';
import { M1, M2, M_FINAL, RADIATED_J, RADIATED_MSUN } from './gw150914.ts';
import { sci } from './fmt.ts';

const REQ: SoundRequest = { clip: SLOW_MERGER.id, loop: true, gap: LOOP_GAP };

export const merger = registerStage('merger', {
  note: `Modelled: the best-fit template’s merger and ringdown, slowed ×${SLOW_MERGER.slow} with pitch ×${SLOW_MERGER.pitch}. Horizon sizes are to scale (Schwarzschild radii); how they join and the remnant’s ringing shape are a drawing of what simulations show.`,
  readouts: () => [
    { label: 'Before → after', value: `${M1} + ${M2} → ${M_FINAL} M☉`, tone: 'warm' },
    { label: 'Radiated', value: `${RADIATED_MSUN.toFixed(1)} M☉ × c² = ${sci(RADIATED_J)} J`, tone: 'light' },
    { label: 'Time · tone', value: `slowed ×${SLOW_MERGER.slow} · pitch ×${SLOW_MERGER.pitch}`, tone: 'mute' },
  ],
  sound: () => REQ,
});
