// A ring of free-floating test particles in the x–z plane, deformed by a wave arriving along y with strain (h+, h×)
// through src/gw/strain.ts ring() (exact to first order in h; the caller exaggerates h and says so). Drawn as glowing
// beads, a luminous outline through them, and the dashed circle they rest on.

import { Group } from 'three/webgpu';
import { ring as ringPositions } from '../../gw/strain.ts';
import { createGlowLine, createGlowPoints, type GlowLine, type GlowPoints } from '../gfx/glow.ts';
import { circlePoints, createLines, type Lines } from '../gfx/lines.ts';
import type { RGB } from '../gfx/palette.ts';
import type { Vec2Uniform } from '../../render/globals.ts';

export interface ParticleRing {
  group: Group;
  beads: GlowPoints;
  outline: GlowLine;
  rest: Lines;
  /** Deform by (h+, h×) and write the GPU buffers (no allocation). `bright` scales bead brightness. */
  set(hp: number, hc: number, bright?: number): void;
  /** Current position of particle k (x, z) after set(). */
  x(k: number): number;
  z(k: number): number;
  dispose(): void;
}

export function createParticleRing(
  n: number,
  radius: number,
  colour: RGB,
  resolution: Vec2Uniform,
  opts: { beadRadius?: number; restColour?: RGB } = {},
): ParticleRing {
  const group = new Group();
  const xy = new Float32Array(2 * n);
  const beads = createGlowPoints(n, colour, { radius: opts.beadRadius ?? 0.045, intensity: 1.6 });
  const outline = createGlowLine(n + 1, colour, { width: 0.006, intensity: 0.9 });
  const rest = createLines(
    [{ points: circlePoints(128, radius), colour: opts.restColour ?? [0.5, 0.55, 0.75], width: 1, intensity: 0.45, dash: 0.08, closed: true }],
    { resolution },
  );
  // The rest circle lies in x–z.
  rest.mesh.rotation.x = Math.PI / 2;
  group.add(rest.mesh, outline.mesh, beads.mesh);
  const self: ParticleRing = {
    group,
    beads,
    outline,
    rest,
    set(hp, hc, bright = 1) {
      ringPositions(n, radius, hp, hc, xy);
      for (let k = 0; k < n; k++) {
        beads.set(k, xy[2 * k]!, 0, xy[2 * k + 1]!, bright);
        outline.set(k, xy[2 * k]!, 0, xy[2 * k + 1]!);
      }
      outline.set(n, xy[0]!, 0, xy[1]!);
      beads.commit();
      outline.commit(n + 1);
    },
    x: (k) => xy[2 * k]!,
    z: (k) => xy[2 * k + 1]!,
    dispose() {
      beads.dispose();
      outline.dispose();
      rest.dispose();
    },
  };
  self.set(0, 0);
  return self;
}
