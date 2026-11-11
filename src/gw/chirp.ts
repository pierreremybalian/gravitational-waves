// The leading-order (Newtonian, quadrupole) chirp and Kepler's law for the orbit (pure, SI; masses in M☉ where named).
//
//   df/dt = (96/5) π^(8/3) (G𝓜/c³)^(5/3) f^(11/3)                 (f = gravitational-wave frequency = 2 × orbital)
//   ⇒ 𝓜 = (c³/G) [ (5/96) π^(−8/3) f^(−11/3) ḟ ]^(3/5)            (chirp mass from f and its rate of change)
//   ⇒ f(τ) = (1/π) (5 / (256 τ))^(3/8) (G𝓜/c³)^(−5/8)            (τ = time left to coalescence)
//   Kepler: ω_orb = π f, a = (G M / ω²)^(1/3), relative speed v = (π G M f)^(1/3).
//
// 𝓜 = (m1 m2)^(3/5) / (m1 + m2)^(1/5). Masses here are as the detector sees them (redshifted by 1 + z); divide by
// 1 + z for the source frame. Valid while the bodies are far apart (v ≪ c); near merger it underestimates df/dt.

import { C, G, GM_SUN, M_SUN, T_SUN } from './units.ts';

export const chirpMass = (m1: number, m2: number): number => Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);

/** Chirp mass (M☉) from a frequency f (Hz) and its rate of change ḟ (Hz/s). */
export function chirpMassFromFdot(f: number, fdot: number): number {
  const x = (5 / 96) * Math.pow(Math.PI, -8 / 3) * Math.pow(f, -11 / 3) * fdot;
  return ((C ** 3 / G) * Math.pow(x, 3 / 5)) / M_SUN;
}

/** ḟ (Hz/s) at frequency f for chirp mass 𝓜 (M☉). */
export function fdot(f: number, mc: number): number {
  return (96 / 5) * Math.pow(Math.PI, 8 / 3) * Math.pow(mc * T_SUN, 5 / 3) * Math.pow(f, 11 / 3);
}

/** Gravitational-wave frequency (Hz) a time τ (s) before coalescence. */
export function frequencyAt(tau: number, mc: number): number {
  return (1 / Math.PI) * Math.pow(5 / (256 * tau), 3 / 8) * Math.pow(mc * T_SUN, -5 / 8);
}

/** Time to coalescence (s) from frequency f (Hz). */
export function timeToCoalescence(f: number, mc: number): number {
  return (5 / 256) * Math.pow(mc * T_SUN, -5 / 3) * Math.pow(Math.PI * f, -8 / 3);
}

/**
 * Chirp mass (M☉) from a frequency track: f^(−8/3) falls linearly with time, f^(−8/3) = (256/5) π^(8/3)
 * (G𝓜/c³)^(5/3) (t_c − t). A least-squares line through (t, f^(−8/3)) gives the slope, and so 𝓜, and t_c.
 */
export function chirpMassFromTrack(t: ArrayLike<number>, f: ArrayLike<number>): { mc: number; tc: number } {
  const n = Math.min(t.length, f.length);
  let st = 0;
  let sy = 0;
  let stt = 0;
  let sty = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const fi = f[i]!;
    if (!(fi > 0)) continue;
    const y = Math.pow(fi, -8 / 3);
    const ti = t[i]!;
    st += ti;
    sy += y;
    stt += ti * ti;
    sty += ti * y;
    m++;
  }
  if (m < 2) throw new Error('need at least two points');
  const slope = (m * sty - st * sy) / (m * stt - st * st);
  const icpt = (sy - slope * st) / m;
  const A = -slope; // (256/5) π^(8/3) (G𝓜/c³)^(5/3)
  const gmc = Math.pow((5 * A) / (256 * Math.pow(Math.PI, 8 / 3)), 3 / 5); // G𝓜/c³, s
  return { mc: gmc / T_SUN, tc: icpt / A };
}

// ── Kepler ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Orbital separation (m) for total mass M (M☉) at gravitational-wave frequency f (Hz). */
export function separation(M: number, f: number): number {
  const w = Math.PI * f; // orbital angular frequency
  return Math.cbrt((M * GM_SUN) / (w * w));
}

/** Relative orbital speed (m/s) of the two bodies: (π G M f)^(1/3). Each moves at v · m_other / M about the centre. */
export function relativeSpeed(M: number, f: number): number {
  return Math.cbrt(Math.PI * M * GM_SUN * f);
}

/** Schwarzschild radius (m) of a mass M (M☉): 2GM/c². */
export const schwarzschildRadius = (M: number): number => (2 * M * GM_SUN) / (C * C);
