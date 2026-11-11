// Stage 6 · Merger and ringdown. 35 ms either side of the merger, slowed ×60: the horizons (to scale) plunge together,
// one larger horizon forms, rings in its l = m = 2 mode with the template's ringdown (amplitude and frequency), and
// settles; the burst of waves leaves across the sheet. Above, the template's waveform around the merger is lit by the
// playhead you hear (pitch ×4). Labels: the remnant's mass and what was radiated (GWTC-2.1 medians).

import { Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { PAL } from '../../shared/gfx/palette.ts';
import { $reducedMotion } from '../../state/store.ts';
import { createBinaryView, type BinaryView } from '../../shared/space/binaryview.ts';
import { clipClock, createClipClock } from '../../shared/space/clock.ts';
import { loadTemplateTrack, type TemplateTrack } from '../../shared/space/track.ts';
import { defineSlowChirp } from '../../shared/space/slowchirp.ts';
import { createRibbon, type Ribbon } from '../../shared/space/ribbon.ts';
import { C } from '../../gw/units.ts';
import { merger } from '../../script/merger.ts';
import { METRES_PER_UNIT, WAVE_SPEED_FRACTION } from '../../script/binary.ts';
import { SLOW_MERGER } from '../../script/slow.ts';
import { M_FINAL, RADIATED_MSUN, TM1, TM2, TM_FINAL } from '../../script/gw150914.ts';
import { GW150914 } from '../../shared/gwdata.ts';
import { track } from '../../time/tracks.ts';

const params = {
  fov: 32,
  az: track([
    [0, 0.35],
    [1, -0.2],
  ]),
  el: track([
    [0, 0.62],
    [0.6, 0.5],
    [1, 0.58],
  ]),
  dist: track([
    [0, 22],
    [0.5, 19],
    [1, 26],
  ]),
  extent: 26,
  spiral: 1.5,
  gridColour: [0.2, 0.26, 0.55] as const,
  crestColour: [0.8, 0.66, 1.0] as const,
  ribbon: { x: 0, y: 1.6, z: -13, width: 18, height: 1.3 },
};

export default function mergerScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 20, tx: 0, tt: 0, ty: 0 };
  let tt: TemplateTrack;
  let view: BinaryView;
  let wave: Ribbon;
  const clock = createClipClock();
  const labels = new LabelSet([
    { id: 'remnant', text: `One black hole: ${M_FINAL} M☉`, tone: 'both', side: 'right', size: 'sm' },
    { id: 'burst', text: `${RADIATED_MSUN.toFixed(1)} M☉ leaves as waves`, tone: 'light', side: 'right', size: 'sm' },
    { id: 'ring', text: '', tone: 'warm', side: 'above', size: 'sm' },
    { id: 'merge', text: 'Merger', tone: 'plain', side: 'above', size: 'sm' },
  ]);
  const L = { remnant: labels.index('remnant'), burst: labels.index('burst'), ring: labels.index('ring'), merge: labels.index('merge') };
  let shownF = -1;
  const span = SLOW_MERGER.to - SLOW_MERGER.from;

  const self: BlockScene = {
    id: 'merger',
    status: 'modelled',
    statusNote: merger.note,
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      tt = await loadTemplateTrack();
      defineSlowChirp(SLOW_MERGER, tt);
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
        remnantColour: [1.0, 0.9, 0.78],
        trail: 64,
        rings: 40,
        spokes: 56,
      });
      view.wellPerMass = 0.03;
      view.trailOrbits = 1.0;
      view.ringEps = 0.32;
      view.grid.spiralInner.value = 1.4;
      view.grid.fade.value = 0.5;
      view.grid.crest.value = 1.4;
      scene.add(view.group);
      const w = GW150914.window;
      wave = createRibbon({
        data: tt.strain,
        t0: w.t0,
        fs: w.fs,
        from: SLOW_MERGER.from,
        to: SLOW_MERGER.to,
        colour: PAL.light,
        resolution: c.globals.uResolution,
        width: 1.6,
        sheet: 0.14,
      });
      const R = params.ribbon;
      wave.mesh.position.set(R.x, R.y, R.z);
      wave.centre.value = (SLOW_MERGER.from + SLOW_MERGER.to) / 2;
      wave.xScale.value = R.width / span;
      wave.yScale.value = R.height / tt.ampPeak;
      wave.half.value = R.width / 2 + 0.3;
      wave.headWidth.value = 0.0006;
      wave.active.value = 1;
      scene.add(wave.mesh);
      view.update(SLOW_MERGER.from);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      // The audio clock alone sets the binary's time; the scroll only frames the camera and the beats.
      clipClock(ctx.chirp, SLOW_MERGER, clock);
      const t = clock.t;
      const intro = Math.min(1, local / 0.1);
      view.grid.spiral.value = params.spiral * (0.5 + 0.5 * clock.dip) * intro;
      view.grid.opacity.value = 0.42;
      view.bodies = 0.35 + 0.65 * clock.dip;
      view.update(t);
      wave.play.value = t;
      wave.intensity.value = intro * (0.5 + 0.5 * clock.dip);

      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local);
      pose.tx = rig.camera.aspect > 1 ? -4 : 0;
      pose.tt = 1.2;
      pose.ty = -2;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      const st = view.state;
      const after = st.merged ? 1 : 0;
      const ringing = after * Math.min(1, view.remnant.eps.value / (view.ringEps * 0.15));
      const fk = Math.round(st.f);
      if (fk !== shownF) {
        shownF = fk;
        labels.setText(L.ring, st.merged ? `Ringing at ${fk} Hz` : `${fk} Hz`);
      }
      const rr = view.remnant.group.scale.x;
      labels.place(L.remnant, rr * 1.2, 0, rr * 0.5, rig.camera, intro * after * clock.dip);
      labels.place(L.ring, 0, rr * 2.2, 0, rig.camera, intro * clock.dip * (st.merged ? ringing : 0.8));
      // The burst: the crest that left at the merger is at r = speed · t.
      const rb = t > 0 ? t * view.grid.spiralSpeed.value : 0;
      const showBurst = t > 0.004 && rb < params.extent * 0.8 ? 1 : 0;
      labels.place(L.burst, rb * 0.7, 0, rb * 0.7, rig.camera, intro * showBurst * clock.dip);
      const R = params.ribbon;
      labels.place(L.merge, R.x + (0 - wave.centre.value) * wave.xScale.value, R.y + R.height * 1.1, R.z, rig.camera, intro * 0.8);
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
      wave?.dispose();
      tt?.dispose();
    },
  };
  return self;
}
