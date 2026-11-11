// Stage 3 · Ripples. A ring of free particles floating in a patch of space, and a wave arriving straight down through
// it (its wavefronts drawn as faint passing rings). The patch and the ring deform by the exact quadrupole formula
// (src/gw/strain.ts): + polarisation, then ×, then both a quarter cycle apart (the squeeze rotates: what a binary sends
// along its axis), then GW150914's best-fit waveform at real speed, locked to the chirp you hear.
// Strain drawn 0.32 (real ~10⁻²¹); the drawn waves are slowed; both stated.

import { Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { circlePoints, createLines, type LineSpec, type Lines } from '../../shared/gfx/lines.ts';
import { PAL } from '../../shared/gfx/palette.ts';
import { $reducedMotion } from '../../state/store.ts';
import { createSpaceGrid, type SpaceGrid } from '../../shared/space/grid.ts';
import { createParticleRing, type ParticleRing } from '../../shared/space/ring.ts';
import { loadTemplateTrack, type TemplateTrack } from '../../shared/space/track.ts';
import { sampleAt } from '../../gw/binary.ts';
import { wave, type Polarisation } from '../../gw/strain.ts';
import { DRAWN_PERIOD, H_DRAWN, RIPPLE_PARTS, ripplePart, ripples } from '../../script/ripples.ts';
import { windowed, track } from '../../time/tracks.ts';

const params = {
  fov: 32,
  az: track([
    [0, 0.5],
    [0.5, 0.15],
    [1, -0.15],
  ]),
  el: track([
    [0, 0.62],
    [0.6, 0.72],
    [1, 0.8],
  ]),
  dist: track([
    [0, 12.5],
    [1, 11.5],
  ]),
  radius: 1.7,
  particles: 20,
  patch: 3.4,
  /** Wavefront squares: spacing (world units) along the wave's path; they move at spacing / DRAWN_PERIOD. */
  fronts: 4,
  frontGap: 1.5,
};

export default function ripplesScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 11, tx: 0, tt: 0, ty: 0 };
  let grid: SpaceGrid;
  let ring: ParticleRing;
  let fronts: Lines;
  let axes: Lines;
  let tt: TemplateTrack;
  const pol: Polarisation = { plus: 0, cross: 0 };
  const labels = new LabelSet([
    { id: 'title', text: '', tone: 'light', side: 'center', size: 'md' },
    { id: 'stretch', text: 'Stretched', tone: 'warm', side: 'right', size: 'sm' },
    { id: 'squeeze', text: 'Squeezed', tone: 'b', side: 'above', size: 'sm' },
    { id: 'dir', text: 'Wave travels down, through the ring', tone: 'mute', side: 'right', size: 'sm' },
  ]);
  const L = { title: labels.index('title'), stretch: labels.index('stretch'), squeeze: labels.index('squeeze'), dir: labels.index('dir') };
  let shownPart = '';

  const self: BlockScene = {
    id: 'ripples',
    status: 'established',
    statusNote: ripples.note,
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      tt = await loadTemplateTrack();
      grid = createSpaceGrid({
        resolution: c.globals.uResolution,
        layout: 'square',
        extent: params.patch,
        lines: 21,
        segments: 60,
        colour: [0.3, 0.38, 0.8],
        width: 1.1,
      });
      grid.fade.value = 0.55;
      grid.mesh.position.y = -0.02;
      scene.add(grid.mesh);
      ring = createParticleRing(params.particles, params.radius, PAL.both, c.globals.uResolution, { beadRadius: 0.07 });
      scene.add(ring.group);
      const sq = circlePoints(96, 1);
      const specs: LineSpec[] = [];
      for (let i = 0; i < params.fronts; i++) specs.push({ points: sq, colour: PAL.light, width: 1.2, intensity: 0.7, closed: true });
      fronts = createLines(specs, { resolution: c.globals.uResolution });
      // Fronts lie in x–z (rotate the line plane), stacked along y.
      fronts.mesh.rotation.x = -Math.PI / 2;
      scene.add(fronts.mesh);
      axes = createLines(
        [
          { points: [-1, 0, 1, 0], colour: PAL.edge, width: 1, intensity: 0.4, dash: 0.1 },
          { points: [0, -1, 0, 1], colour: PAL.edge, width: 1, intensity: 0.4, dash: 0.1 },
          { points: [0, 0, 0, 1], dims: 2, colour: PAL.light, width: 1.4, intensity: 0.8 },
        ],
        { resolution: c.globals.uResolution },
      );
      axes.mesh.rotation.x = -Math.PI / 2;
      scene.add(axes.mesh);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get() && !ctx.chirp.audible;
      rig.drift = reduced ? 0 : 1;
      const part = ripplePart(local);
      // Smooth hand-overs between parts: the amplitude dips to zero at each boundary.
      const amp =
        windowed(local, RIPPLE_PARTS.plus, RIPPLE_PARTS.cross, 0.05) +
        windowed(local, RIPPLE_PARTS.cross, RIPPLE_PARTS.both, 0.05) +
        windowed(local, RIPPLE_PARTS.both, RIPPLE_PARTS.real, 0.05) +
        windowed(local, RIPPLE_PARTS.real, 1.01, 0.04, 0.0001);
      const phaseT = reduced ? DRAWN_PERIOD * 0.125 : elapsed;
      let hp = 0;
      let hc = 0;
      let travel = phaseT / DRAWN_PERIOD;
      if (part === 'plus') {
        wave(H_DRAWN * amp, 1 / DRAWN_PERIOD, phaseT, 0, 0, pol);
        hp = pol.plus;
        hc = pol.cross;
      } else if (part === 'cross') {
        wave(H_DRAWN * amp, 1 / DRAWN_PERIOD, phaseT, Math.PI / 4, 0, pol);
        hp = pol.plus;
        hc = pol.cross;
      } else if (part === 'both') {
        wave(H_DRAWN * amp, 1 / DRAWN_PERIOD, phaseT, 0, 1, pol);
        hp = pol.plus;
        hc = pol.cross;
      } else if (part === 'real') {
        // Locked to the chirp: the template's h+ and h× (face-on) at the data time being heard.
        const ch = ctx.chirp;
        const t = ch.clip === 'chirp-template' && ch.instance >= 0 ? ch.t : -0.02;
        const tr = tt.track;
        const a = (sampleAt(tr.amp!, tr.t0, tr.fs, t) / tt.ampPeak) * H_DRAWN * amp;
        const ph = sampleAt(tr.phase, tr.t0, tr.fs, t);
        hp = a * Math.cos(ph);
        hc = a * Math.sin(ph);
        travel = ph / (2 * Math.PI);
      }
      ring.set(hp, hc, 1);
      grid.hp.value = hp;
      grid.hc.value = hc;
      grid.opacity.value = 0.7;

      // Wavefronts pass down through the ring, one per cycle; brighter at a crest.
      const lo = Math.min(1, local / 0.1);
      const span = params.fronts * params.frontGap;
      for (let i = 0; i < params.fronts; i++) {
        const s = fronts.state[i]!;
        let y = ((((i - travel) * params.frontGap) % span) + span) % span;
        y = span / 2 - y;
        s.z = y;
        s.sx = params.radius * 1.35;
        s.sy = params.radius * 1.35;
        const edge = 1 - Math.abs(y) / (span / 2);
        s.intensity = amp * edge * edge * 0.45 * lo;
      }
      fronts.commit();
      const ax = axes.state;
      ax[0]!.sx = params.patch;
      ax[1]!.sy = params.patch;
      ax[0]!.intensity = lo;
      ax[1]!.intensity = lo;
      ax[2]!.intensity = 0;
      axes.commit();

      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local);
      pose.tx = 0;
      pose.tt = 0;
      pose.ty = 0;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      if (part !== shownPart) {
        shownPart = part;
        labels.setText(
          L.title,
          {
            calm: 'Free particles in a ring, at rest',
            plus: '+ polarisation',
            cross: '× polarisation: the same, turned 45°',
            both: '+ and × a quarter cycle apart: the squeeze turns',
            real: 'GW150914 at real speed (best-fit model)',
          }[part],
        );
      }
      labels.place(L.title, 0, 0, -params.radius * 1.9, rig.camera, lo);
      // Stretch / squeeze tags on the + pattern's axes.
      const plusOnly = part === 'plus' ? amp : 0;
      const stretchX = hp > 0;
      const kx = 0;
      const kz = params.particles / 4;
      const a = stretchX ? kx : kz;
      const b = stretchX ? kz : kx;
      labels.place(L.stretch, ring.x(a), 0, ring.z(a), rig.camera, plusOnly * Math.min(1, Math.abs(hp) / (H_DRAWN * 0.4)));
      labels.place(L.squeeze, ring.x(b), 0, ring.z(b), rig.camera, plusOnly * Math.min(1, Math.abs(hp) / (H_DRAWN * 0.4)));
      labels.place(L.dir, params.patch * 0.9, 0, params.patch * 0.9, rig.camera, lo * 0.7 * (part === 'calm' || part === 'plus' ? 1 : 0.4));
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(w, h) {
      rig.resize(w, h);
    },
    dispose() {
      grid?.dispose();
      ring?.dispose();
      fronts?.dispose();
      axes?.dispose();
      tt?.dispose();
    },
  };
  return self;
}
