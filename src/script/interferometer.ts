// Stage 8 · An interferometer (established). LIGO drawn: the laser, the splitter, two 4 km arms with their mirrors;
// the light goes out and back, and at the output the two returning beams cancel (the dark port). Then the
// gravitational wave arrives: one arm stretches as the other shrinks, driven by the best-fit template's strain at
// Hanford on the transport clock (clip chirp-template), and light leaks out to the photodetector.
//
// Exaggerations (stated on screen): the mirrors' motion is drawn MIRROR_EXAG times larger than the real arm change,
// the light's wavelength is drawn 0.32 scene units (about 10¹⁴ times longer than 1064 nm on this scale), and the swing
// is drawn SLOW times slower than it happened so it can be followed (the sound is at real speed).

import gw from '../data/gw150914.json';
import { armChange, armDifference, LIGO_ARM } from '../gw/units.ts';
import { ramp, track, windowed } from '../time/tracks.ts';
import { registerStage, type Readout } from './index.ts';
import { exp10 } from './detfmt.ts';

export const ARM_UNITS = 4;
/** Drawn mirror displacement (scene units) at the template's peak strain. */
export const DISP_AT_PEAK = 0.18;
export const H_PEAK = gw.validation['best-fit template peak |h| at H1 (1e-21)'] * 1e-21;
/** Drawn fractional change per arm ÷ real fractional change per arm (h/2). */
export const MIRROR_EXAG = DISP_AT_PEAK / ARM_UNITS / (H_PEAK / 2);
/** Drawn light wavelength (scene units); the interference phase uses it, consistent with the drawing. */
export const LAMBDA_DRAWN = 0.32;
/** The swing is drawn this many times slower (phase ÷ SLOW). */
export const SLOW = 12;
export const LASER_NM = 1064;

export const IFO = {
  reveal: track([
    [0.02, 0.0],
    [0.3, 1],
  ]),
  light: track([
    [0.27, 0],
    [0.45, 1],
  ]),
  waves: (l: number) => windowed(l, 0.3, 0.72, 0.06, 0.08),
  sum: (l: number) => windowed(l, 0.44, 0.7, 0.04, 0.06),
  /** A static nudge of the X mirror by a quarter of the drawn wavelength: dark → bright → dark. */
  nudge: (l: number) => (LAMBDA_DRAWN / 4) * windowed(l, 0.5, 0.64, 0.035, 0.035),
  wave: (l: number) => ramp(l, 0.64, 0.7),
  fringes: (l: number) => ramp(l, 0.6, 0.68),
};

const fmtExp = exp10;

export const NUMBERS = {
  arm: `${LIGO_ARM.toLocaleString('en-US')} m`,
  laser: `${LASER_NM} nm infrared`,
  perArm: `${fmtExp(armChange(H_PEAK))} m`,
  difference: `${fmtExp(armDifference(H_PEAK))} m`,
  exag: `×${fmtExp(MIRROR_EXAG)}`,
  slow: `${SLOW}× slower`,
};

registerStage('interferometer', {
  note: `Established: how LIGO measures length. Exaggerated: the mirrors move ${fmtExp(MIRROR_EXAG)} times more than the real arm change, the light's wavelength is drawn enormous, and the swing is slowed ${SLOW}× (the sound is real speed).`,
  readouts(l): Readout[] {
    const rows: Readout[] = [{ label: 'Arm', value: NUMBERS.arm, tone: 'plain' }];
    if (l < 0.62) rows.push({ label: 'Laser', value: NUMBERS.laser, tone: 'light' });
    if (l >= 0.44 && l < 0.64) rows.push({ label: 'Output', value: IFO.nudge(l) > LAMBDA_DRAWN / 8 ? 'light: the beams add' : 'dark: the beams cancel', tone: 'both' });
    if (l >= 0.62) {
      rows.push({ label: 'Each arm, at peak', value: `± ${NUMBERS.perArm}`, tone: 'a' });
      rows.push({ label: 'Drawn', value: `${NUMBERS.exag}, ${NUMBERS.slow}`, tone: 'mute' });
    }
    return rows;
  },
  sound(l) {
    return l >= 0.64 ? { clip: 'chirp-template', loop: true, gap: 1.4 } : null;
  },
});
