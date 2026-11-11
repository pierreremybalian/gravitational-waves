// The noise landscape as drawn (stages 9–10): the ridge field from landscape.ts, the ASD as a bright ridge along the
// back (peak-held on a fine log grid so the narrow lines show; it flattens to the noise level when whitened), and a
// playhead row: the spectrum at the moment being heard, interpolated between rows, riding the field. All parts draw
// in world space with the group at the identity (their camera-facing width assumes it).

import { Group } from 'three/webgpu';
import { createGlowLine, type GlowLine } from '../gfx/glow.ts';
import type { RGB } from '../gfx/palette.ts';
import { createRidges, type Ridges } from './ridges.ts';
import type { Landscape } from './landscape.ts';
import { asdBandPeak, logFreqs, type Asd } from './spectro.ts';

export interface NoiseField {
  group: Group;
  field: Ridges;
  wall: Ridges;
  /** Height scale (world y per data unit) shared by field, wall and playhead. */
  setHeight(h: number): void;
  setMorph(m: number): void;
  /** Draw the playhead row at data time t with brightness b (0 hides). */
  playhead(t: number, b: number): void;
  /** Whitened noise level (data units) the wall flattens to. */
  level: number;
  /** World z of the wall. */
  wallZ: number;
  dispose(): void;
}

const COOL: RGB = [0.22, 0.42, 0.95];
const HOT: RGB = [1.0, 0.86, 0.6];
const WALL: RGB = [0.5, 0.85, 1.0];
const HEAD: RGB = [1.0, 0.9, 0.75];

export function createNoiseField(land: Landscape, asd: Asd, o: { fine?: number; perPow?: number } = {}): NoiseField {
  const group = new Group();
  const field = createRidges({ rows: land.rows, cols: land.cols, x: land.x, z: land.z, h0: land.hRaw, h1: land.hWhite, hot1: land.hotWhite, cool: COOL, hot: HOT, width: 0.004, minPx: 0.0011 });
  group.add(field.mesh);
  // The ASD on a fine log grid (peak hold), one row behind the field.
  const fine = o.fine ?? 900;
  const fLo = land.freqs[0]!;
  const fHi = land.freqs[land.cols - 1]!;
  const ff = logFreqs(fLo, fHi, fine);
  const r = Math.pow(fHi / fLo, 1 / (fine - 1));
  const wx = new Float32Array(fine);
  const w0 = new Float32Array(fine);
  const w1 = new Float32Array(fine);
  // Whitened noise level: power normalised to its median, so the mean is about 1.44 (exponential distribution).
  const level = (o.perPow ?? 0.035) * 1.44;
  for (let i = 0; i < fine; i++) {
    wx[i] = land.xOf(ff[i]!);
    w0[i] = land.heightOfAsd(asdBandPeak(asd, ff[i]! / Math.sqrt(r), ff[i]! * Math.sqrt(r)));
    w1[i] = level;
  }
  const wallZ = land.z[0]! - 0.35;
  const wall = createRidges({ rows: 1, cols: fine, x: wx, z: [wallZ], h0: w0, h1: w1, cool: WALL, hot: HOT, width: 0.009, minPx: 0.0019 });
  wall.intensity.value = 2.2;
  group.add(wall.mesh);

  const head: GlowLine = createGlowLine(land.cols, HEAD, { width: 0.008, intensity: 0, minPx: 0.0016 });
  group.add(head.mesh);
  let hScale = 1;
  let morph = 0;

  return {
    group,
    field,
    wall,
    level,
    wallZ,
    setHeight(h) {
      hScale = h;
      field.scale.value.set(1, h, 1);
      wall.scale.value.set(1, h, 1);
    },
    setMorph(m) {
      morph = m;
      field.morph.value = m;
      wall.morph.value = m;
    },
    playhead(t, b) {
      const tr = land.times;
      if (b <= 0.001 || t < tr[0]! || t > tr[land.rows - 1]!) {
        head.commit(0);
        head.intensity.value = 0;
        return;
      }
      const x = ((t - tr[0]!) / (tr[land.rows - 1]! - tr[0]!)) * (land.rows - 1);
      const i0 = Math.min(land.rows - 2, Math.floor(x));
      const u = x - i0;
      const z = land.z[i0]! * (1 - u) + land.z[i0 + 1]! * u;
      for (let c = 0; c < land.cols; c++) {
        const k0 = i0 * land.cols + c;
        const k1 = k0 + land.cols;
        const h0 = land.hRaw[k0]! * (1 - u) + land.hRaw[k1]! * u;
        const h1 = land.hWhite[k0]! * (1 - u) + land.hWhite[k1]! * u;
        head.set(c, land.x[c]!, (h0 + (h1 - h0) * morph) * hScale + 0.004, z);
      }
      head.commit(land.cols);
      head.intensity.value = 2.2 * b;
    },
    dispose() {
      field.dispose();
      wall.dispose();
      head.dispose();
    },
  };
}
