// A plane gravitational wave travelling along z, in the transverse-traceless gauge, acting on free particles in the
// x–y plane (pure). To first order in h (exact for any real wave: h ~ 10⁻²¹), a particle at (x, y) from the centre
// is displaced by ½ h_ij x_j with h = [[h+, h×], [h×, −h+]]:
//   δx = ½ (h+ x + h× y),   δy = ½ (h× x − h+ y).
// The picture exaggerates h (×10²¹ or so); the formula is the same, so the shape is right even if the size is not.

export interface Polarisation {
  plus: number;
  cross: number;
}

/** Displace one particle; writes into out[o], out[o + 1]. */
export function deform(x: number, y: number, hp: number, hc: number, out: Float32Array | number[], o = 0): void {
  out[o] = x + 0.5 * (hp * x + hc * y);
  out[o + 1] = y + 0.5 * (hc * x - hp * y);
}

/**
 * A ring of n particles of radius R, deformed by (h+, h×). Writes x, y pairs into out (length ≥ 2n); returns out.
 * Particle k sits at angle 2πk/n at rest.
 */
export function ring(n: number, R: number, hp: number, hc: number, out: Float32Array = new Float32Array(2 * n)): Float32Array {
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    deform(R * Math.cos(a), R * Math.sin(a), hp, hc, out, 2 * k);
  }
  return out;
}

/**
 * A monochromatic wave of amplitude h, frequency f, at time t, with polarisation angle ψ (rotating the pattern by ψ)
 * and ellipticity: `mix` = 0 linear (+ only, rotated by ψ), 1 circular (+ and × a quarter cycle apart, face-on binary).
 */
export function wave(h: number, f: number, t: number, psi = 0, mix = 0, out: Polarisation = { plus: 0, cross: 0 }): Polarisation {
  const ph = 2 * Math.PI * f * t;
  const p = h * Math.cos(ph);
  const c = h * mix * Math.sin(ph);
  // Rotating the polarisation frame by ψ mixes + and × by 2ψ (spin-2).
  const c2 = Math.cos(2 * psi);
  const s2 = Math.sin(2 * psi);
  out.plus = p * c2 - c * s2;
  out.cross = p * s2 + c * c2;
  return out;
}

/**
 * Strain an L-shaped detector reads for a wave arriving from overhead (along its local vertical): arms along unit
 * vectors u, v at angle α and α + 90° in the wave's x–y frame. h_det = (L_u − L_v)/L = ½uᵀhu − ½vᵀhv
 * = h+ cos 2α + h× sin 2α.
 * A detector turned by 90° reads exactly the opposite sign.
 */
export function detectorStrain(hp: number, hc: number, alpha: number): number {
  return hp * Math.cos(2 * alpha) + hc * Math.sin(2 * alpha);
}

/** Fractional length change of a rod at angle θ in the x–y plane: ½ (h+ cos 2θ + h× sin 2θ). */
export function rodStrain(hp: number, hc: number, theta: number): number {
  return 0.5 * (hp * Math.cos(2 * theta) + hc * Math.sin(2 * theta));
}
