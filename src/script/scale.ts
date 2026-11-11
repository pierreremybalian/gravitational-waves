// Stage 7 · How small. A dive from LIGO's 4 km arm down past the proton to the length change the wave made, while the
// Hanford recording plays and the arm's end moves with it (the real band-passed strain, scaled to metres).
import { registerStage } from './index.ts';
import type { SoundRequest } from '../audio/schedule.ts';
import { armChange, LIGO_ARM, PROTON_DIAMETER } from '../gw/units.ts';
import { sci } from './fmt.ts';
import { track } from '../time/tracks.ts';
import gw from '../data/gw150914.json';

export const H_PEAK = gw.validation['best-fit template peak |h| at H1 (1e-21)'] * 1e-21;
/** Each arm changes by hL/2 at h = 10⁻²¹. */
export const ARM_CHANGE = armChange(1e-21);
export const PROTON_RATIO = PROTON_DIAMETER / ARM_CHANGE;

/** log10 of the frame size in metres. */
export const scaleZoom = track([
  [0.0, 3.9],
  [0.08, 3.9],
  [0.18, -0.25],
  [0.24, -0.25],
  [0.33, -3.8],
  [0.37, -3.8],
  [0.45, -5.8],
  [0.49, -5.8],
  [0.58, -9.55],
  [0.63, -9.55],
  [0.7, -14.0],
  [0.73, -14.0],
  [0.77, -14.95],
  [0.81, -14.95],
  [0.9, -17.5],
  [1.0, -17.5],
]);

const REQ: SoundRequest = { clip: 'chirp-H1', loop: true, gap: 1.2 };

export const scale = registerStage('scale', {
  note: 'Measured: the strain Hanford recorded (band-passed), turned into metres on its 3 995 m arm; every size in the dive is real. The arm’s motion is drawn at its true size: you only see it at the bottom of the dive.',
  readouts: (local) => [
    { label: 'Arm', value: `${LIGO_ARM.toLocaleString('en-US').replace(',', ' ')} m`, tone: 'a' },
    { label: 'Strain h', value: '10⁻²¹', tone: 'warm' },
    { label: 'Each arm changes', value: `${sci(ARM_CHANGE)} m`, tone: 'light' },
    { label: 'Proton', value: `${sci(PROTON_DIAMETER, 2)} m (${Math.round(PROTON_RATIO)}×)`, tone: local > 0.7 ? 'both' : 'mute' },
  ],
  sound: () => REQ,
});

/** Objects passed on the way down (metres; illustrative sizes say "about"). */
export const SIZES = {
  /** LIGO test mass: fused silica, 34 cm across, 40 kg (LIGO). */
  mirror: 0.34,
  /** A human hair, about 0.1 mm thick. */
  hair: 1e-4,
  /** LIGO's laser light: 1064 nm (Nd:YAG). */
  laser: 1.064e-6,
  /** A silicon atom, about 0.2 nm across. */
  atom: 2.2e-10,
  /** A silicon nucleus, about 7 fm across (1.2 fm × 28^(1/3), radius). */
  nucleus: 2 * 1.2e-15 * Math.cbrt(28),
  proton: PROTON_DIAMETER,
  shift: ARM_CHANGE,
} as const;
