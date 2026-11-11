// The binary on its sheet (stages 4–6): two horizons orbiting on the template's own phase (src/gw/binary.ts), comet
// trails of where they were, a well under each, the polar spacetime grid carrying the outgoing quadrupole field, and
// the remnant that appears at the merger and rings with the template's ringdown. One call per frame: update(t) with
// the data time being heard (ctx.chirp.t). Orbits and horizons are to scale at `metresPerUnit`.

import { Group } from 'three/webgpu';
import { binaryAt, createBinaryState, sampleAt, type BinaryState } from '../../gw/binary.ts';
import { createGlowPoints, type GlowPoints } from '../gfx/glow.ts';
import type { RGB } from '../gfx/palette.ts';
import type { Vec2Uniform } from '../../render/globals.ts';
import { createSpaceGrid, type SpaceGrid } from './grid.ts';
import { createHorizon, type Horizon } from './horizon.ts';
import type { TemplateTrack } from './track.ts';

export interface BinaryViewOptions {
  resolution: Vec2Uniform;
  tt: TemplateTrack;
  /** Detector-frame masses, M☉ (consistent with the template's frequencies). */
  m1: number;
  m2: number;
  mFinal: number;
  metresPerUnit: number;
  /** Display wave speed, world units per data second. */
  waveSpeed: number;
  /** Grid radius, world units. */
  extent: number;
  gridColour: RGB;
  crestColour?: RGB;
  colour1: RGB;
  colour2: RGB;
  remnantColour: RGB;
  /** Beads per trail. */
  trail?: number;
  rings?: number;
  spokes?: number;
}

export interface BinaryView {
  group: Group;
  grid: SpaceGrid;
  h1: Horizon;
  h2: Horizon;
  remnant: Horizon;
  trail1: GlowPoints;
  trail2: GlowPoints;
  state: BinaryState;
  /** Trail length in orbits. */
  trailOrbits: number;
  /** Well depth per M☉, world units (0 = flat sheet). */
  wellPerMass: number;
  /** Bar-mode amplitude of the remnant at the merger peak. */
  ringEps: number;
  /** Visibility of the bodies, trails and remnant (0–1). */
  bodies: number;
  /** Place everything for data time t. */
  update(t: number): void;
  dispose(): void;
}

export function createBinaryView(o: BinaryViewOptions): BinaryView {
  const group = new Group();
  const grid = createSpaceGrid({
    resolution: o.resolution,
    layout: 'polar',
    extent: o.extent,
    lines: o.rings ?? 34,
    spokes: o.spokes ?? 48,
    segments: 360,
    inner: o.extent * 0.004,
    spokeInner: o.extent * 0.06,
    colour: o.gridColour,
    crestColour: o.crestColour,
    width: 1.15,
    wave: o.tt,
  });
  grid.spiralSpeed.value = o.waveSpeed;
  const h1 = createHorizon(o.colour1);
  const h2 = createHorizon(o.colour2);
  const remnant = createHorizon(o.remnantColour);
  const N = o.trail ?? 56;
  const trail1 = createGlowPoints(N, o.colour1, { radius: 0.05, intensity: 1.2 });
  const trail2 = createGlowPoints(N, o.colour2, { radius: 0.05, intensity: 1.2 });
  group.add(grid.mesh, h1.group, h2.group, remnant.group, trail1.mesh, trail2.mesh);
  const st = createBinaryState();
  const tmp = createBinaryState();
  const tr = o.tt.track;
  const k = 1 / o.metresPerUnit;
  const params = { m1: o.m1, m2: o.m2, mFinal: o.mFinal };

  const self: BinaryView = {
    group,
    grid,
    h1,
    h2,
    remnant,
    trail1,
    trail2,
    state: st,
    trailOrbits: 0.9,
    wellPerMass: 0.02,
    ringEps: 0.3,
    bodies: 1,
    update(t) {
      binaryAt(tr, params, t, st);
      const vis = self.bodies;
      const merged = st.merged;
      // Bodies.
      const show = vis > 0.002 && !merged;
      h1.group.visible = show;
      h2.group.visible = show;
      h1.group.position.set(st.x1 * k, 0, st.y1 * k);
      h2.group.position.set(st.x2 * k, 0, st.y2 * k);
      h1.group.scale.setScalar(st.r1 * k);
      h2.group.scale.setScalar(st.r2 * k);
      h1.opacity.value = vis;
      h2.opacity.value = vis;
      // Remnant: rings in the l = m = 2 mode with the template's amplitude, turning with half its phase.
      remnant.group.visible = vis > 0.002 && merged;
      remnant.group.scale.setScalar(st.rf * k);
      remnant.opacity.value = vis;
      if (merged) {
        const a = sampleAt(tr.amp!, tr.t0, tr.fs, t) / o.tt.ampPeak;
        remnant.eps.value = self.ringEps * a;
        remnant.psi.value = 0.5 * sampleAt(tr.phase, tr.t0, tr.fs, t);
        remnant.glow.value = 0.42 + 0.55 * a;
      }
      // Wells under each body (or the remnant).
      const w = grid.wells;
      const dm = self.wellPerMass;
      if (merged) {
        w[0]!.set(0, 0, dm * o.mFinal, Math.max(st.rf * k * 1.6, 1e-3));
        w[1]!.set(0, 0, 0, 1);
      } else {
        w[0]!.set(st.x1 * k, st.y1 * k, dm * o.m1, Math.max(st.r1 * k * 1.6, 1e-3));
        w[1]!.set(st.x2 * k, st.y2 * k, dm * o.m2, Math.max(st.r2 * k * 1.6, 1e-3));
      }
      w[2]!.set(0, 0, 0, 1);
      grid.spiralT.value = t;
      // Comet trails: where each body was over the last `trailOrbits` orbits.
      // Trails go out within a few ms of the merger (they would otherwise draw over the remnant).
      const afterglow = t <= 0 ? 1 : Math.max(0, 1 - t / 0.003);
      const forb = Math.max(1, st.f * 0.5);
      const span = self.trailOrbits / forb;
      for (let i = 0; i < N; i++) {
        const ti = t - (span * i) / (N - 1);
        binaryAt(tr, params, ti, tmp);
        const fade = (1 - i / N) * (1 - i / N) * vis * (tmp.merged ? 0 : 1) * afterglow;
        trail1.set(i, tmp.x1 * k, 0, tmp.y1 * k, fade);
        trail2.set(i, tmp.x2 * k, 0, tmp.y2 * k, fade);
      }
      trail1.commit();
      trail2.commit();
    },
    dispose() {
      grid.dispose();
      h1.dispose();
      h2.dispose();
      remnant.dispose();
      trail1.dispose();
      trail2.dispose();
    },
  };
  return self;
}
