// Stage 3 · Ripples. A ring of free particles as a wave passes straight through it: + polarisation, then ×, then both
// together (what a binary seen face-on sends), then the real GW150914 waveform at its real speed. Exact quadrupole
// pattern (src/gw/strain.ts); strain hugely exaggerated, the drawn wave slowed; both stated.
import { registerStage, type Readout } from './index.ts';
import type { SoundRequest } from '../audio/schedule.ts';
import { sci } from './fmt.ts';
import gw from '../data/gw150914.json';

/** Strain drawn on screen (the real one is ~10⁻²¹). */
export const H_DRAWN = 0.32;
/** Seconds per cycle of the drawn (slowed) wave. */
export const DRAWN_PERIOD = 2.4;
/** Peak strain of the best-fit template at Hanford. */
export const H_PEAK = gw.validation['best-fit template peak |h| at H1 (1e-21)'] * 1e-21;

export const RIPPLE_PARTS = { plus: 0.12, cross: 0.4, both: 0.62, real: 0.82 } as const;
export type RipplePart = 'calm' | 'plus' | 'cross' | 'both' | 'real';
export function ripplePart(local: number): RipplePart {
  if (local < RIPPLE_PARTS.plus) return 'calm';
  if (local < RIPPLE_PARTS.cross) return 'plus';
  if (local < RIPPLE_PARTS.both) return 'cross';
  if (local < RIPPLE_PARTS.real) return 'both';
  return 'real';
}

const REAL: SoundRequest = { clip: 'chirp-template', loop: true, gap: 1.2 };

export const ripples = registerStage('ripples', {
  note: `Established: the exact pattern a passing wave makes on free particles. The strain is drawn as ${H_DRAWN} (a real one is about 10⁻²¹, so ×3 × 10²⁰) and the drawn wave is slowed to one cycle every ${DRAWN_PERIOD} s; the last part plays the best-fit model at real speed.`,
  readouts: (local): Readout[] => {
    const p = ripplePart(local);
    const name = { calm: 'none yet', plus: 'plus (+)', cross: 'cross (×)', both: '+ and × together', real: 'GW150914 model' }[p];
    return [
      { label: 'Polarisation', value: name, tone: p === 'calm' ? 'mute' : 'light' },
      { label: 'Strain drawn', value: p === 'real' ? `${H_DRAWN} × envelope` : `${H_DRAWN}`, tone: 'warm' },
      { label: 'Real strain', value: `${sci(H_PEAK)} at its peak`, tone: 'plain' },
      { label: 'Speed', value: p === 'real' ? 'real (35–250 cycles/s)' : `slowed: ${DRAWN_PERIOD} s per cycle`, tone: 'mute' },
    ];
  },
  sound: (local) => (ripplePart(local) === 'real' ? REAL : null),
});
