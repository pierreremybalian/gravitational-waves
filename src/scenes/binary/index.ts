// Stage 4 · Two black holes. The binary early in its inspiral (gravitational-wave frequency 15 → 20 Hz), slowed ×10:
// two horizons to scale on the template's own orbital phase, comet trails, a well under each, and the sheet carrying
// the outgoing two-armed spiral (height = strain, a picture). A probe on the sheet flashes with every crest: two per
// orbit, because the wave's frequency is twice the orbit's. Sound: the same stretch of the template, pitch ×8.

import { Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { createGlowPoints, type GlowPoints } from '../../shared/gfx/glow.ts';
import { PAL } from '../../shared/gfx/palette.ts';
import { $reducedMotion } from '../../state/store.ts';
import { createBinaryView, type BinaryView } from '../../shared/space/binaryview.ts';
import { clipClock, createClipClock } from '../../shared/space/clock.ts';
import { loadTemplateTrack, type TemplateTrack } from '../../shared/space/track.ts';
import { defineSlowChirp } from '../../shared/space/slowchirp.ts';
import { sampleAt } from '../../gw/binary.ts';
import { C } from '../../gw/units.ts';
import { binary, binaryField, binaryProbe, METRES_PER_UNIT, WAVE_SPEED_FRACTION } from '../../script/binary.ts';
import { SLOW_BINARY, slowDuration } from '../../script/slow.ts';
import { TM1, TM2, TM_FINAL } from '../../script/gw150914.ts';
import { track } from '../../time/tracks.ts';

const params = {
  fov: 32,
  az: track([
    [0, 0.2],
    [0.5, -0.15],
    [1, -0.35],
  ]),
  el: track([
    [0, 0.95],
    [0.35, 0.72],
    [0.65, 0.5],
    [1, 0.42],
  ]),
  dist: track([
    [0, 40],
    [0.3, 52],
    [0.6, 74],
    [1, 80],
  ]),
  extent: 62,
  spiral: 5.5,
  /** Probe radius on the sheet, world units. */
  probeR: 26,
  /** Probe angle on the sheet (toward the camera's side). */
  probeAngle: 1.9,
  gridColour: [0.2, 0.26, 0.55] as const,
  crestColour: [0.75, 0.6, 1.0] as const,
};

export default function binaryScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 40, tx: 0, tt: 0, ty: 0 };
  let tt: TemplateTrack;
  let view: BinaryView;
  let probe: GlowPoints;
  const clock = createClipClock();
  const labels = new LabelSet([
    { id: 'h1', text: 'Black hole', tone: 'a', side: 'right', size: 'sm' },
    { id: 'h2', text: 'Black hole', tone: 'b', side: 'left', size: 'sm' },
    { id: 'orbit', text: '', tone: 'plain', side: 'above', size: 'sm' },
    { id: 'probe', text: '', tone: 'light', side: 'right', size: 'sm' },
  ]);
  const L = { h1: labels.index('h1'), h2: labels.index('h2'), orbit: labels.index('orbit'), probe: labels.index('probe') };
  let shownOrbit = -1;
  let shownWave = -1;
  const speed = 1 / SLOW_BINARY.slow;
  const dur = slowDuration(SLOW_BINARY);

  const self: BlockScene = {
    id: 'binary',
    status: 'modelled',
    statusNote: binary.note,
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      tt = await loadTemplateTrack();
      defineSlowChirp(SLOW_BINARY, tt);
      view = createBinaryView({
        resolution: c.globals.uResolution,
        tt,
        m1: TM1,
        m2: TM2,
        mFinal: TM_FINAL,
        metresPerUnit: METRES_PER_UNIT,
        waveSpeed: (C * WAVE_SPEED_FRACTION) / METRES_PER_UNIT,
        extent: params.extent,
        gridColour: params.gridColour,
        crestColour: params.crestColour,
        colour1: PAL.a,
        colour2: PAL.b,
        remnantColour: PAL.both,
      });
      view.wellPerMass = 0.05;
      scene.add(view.group);
      probe = createGlowPoints(1, PAL.light, { radius: 0.5, intensity: 2.2 });
      scene.add(probe.mesh);
      view.update(SLOW_BINARY.from);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const fallback = SLOW_BINARY.from + (SLOW_BINARY.to - SLOW_BINARY.from) * local;
      clipClock(ctx.chirp, SLOW_BINARY.id, speed, dur, fallback, clock);
      const t = clock.t;
      const field = binaryField(local);
      view.grid.spiral.value = params.spiral * field * (0.4 + 0.6 * clock.dip);
      view.grid.opacity.value = 0.38;
      view.grid.crest.value = 1.1;
      view.grid.spiralInner.value = 6;
      view.grid.fade.value = 0.4;
      view.bodies = 0.35 + 0.65 * clock.dip;
      view.update(t);

      // Probe on the sheet at angle 0: brightens at each crest of the field passing it.
      const pr = binaryProbe(local);
      const tr = t - params.probeR / view.grid.spiralSpeed.value;
      const ph = sampleAt(tt.track.phase, tt.track.t0, tt.track.fs, tr);
      const crest = Math.max(0, Math.cos(2 * params.probeAngle - ph));
      const flash = crest ** 6;
      const px = params.probeR * Math.cos(params.probeAngle);
      const pz = params.probeR * Math.sin(params.probeAngle);
      probe.set(0, px, 0, pz, pr * (0.25 + 1.6 * flash) * field);
      probe.commit();

      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local);
      pose.tx = rig.camera.aspect > 1 ? -12 : 0;
      pose.tt = -2;
      pose.ty = 0;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      // Labels.
      const st = view.state;
      const lo = Math.min(1, local / 0.12);
      labels.place(L.h1, view.h1.group.position.x, 0, view.h1.group.position.z, rig.camera, lo * (1 - pr) * 0.9);
      labels.place(L.h2, view.h2.group.position.x, 0, view.h2.group.position.z, rig.camera, lo * (1 - pr) * 0.9);
      const forb = Math.round(st.f * 0.5 * 10);
      if (forb !== shownOrbit) {
        shownOrbit = forb;
        labels.setText(L.orbit, `Orbit ${(forb / 10).toFixed(1)} turns/s (real time)`);
      }
      labels.place(L.orbit, 0, 4, 0, rig.camera, lo * 0.85);
      const fw = Math.round(st.f * 10);
      if (fw !== shownWave) {
        shownWave = fw;
        labels.setText(L.probe, `Waves ${(fw / 10).toFixed(1)} Hz: two crests per orbit`);
      }
      labels.place(L.probe, px, 0, pz, rig.camera, pr);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(w, h) {
      rig.resize(w, h);
    },
    dispose() {
      view?.dispose();
      probe?.dispose();
      tt?.dispose();
    },
  };
  return self;
}
