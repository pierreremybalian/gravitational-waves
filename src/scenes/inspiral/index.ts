// Stage 5 · The inspiral. The last 0.6 s before the merger, slowed ×12, from the measured frequency and phase track:
// the horizons (to scale) spiral in on their own comet trails, the sheet's two-armed spiral tightens and brightens,
// and behind them the template's waveform is written out by the same playhead you hear (pitch ×4). Live labels give
// the frequency and Kepler's separation and speed for it (src/script/inspiral.ts).

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
import { inspiral, keplerSeparationKm, keplerSpeedC } from '../../script/inspiral.ts';
import { METRES_PER_UNIT, WAVE_SPEED_FRACTION } from '../../script/binary.ts';
import { SLOW_INSPIRAL } from '../../script/slow.ts';
import { TM1, TM2, TM_FINAL } from '../../script/gw150914.ts';
import { GW150914 } from '../../shared/gwdata.ts';
import { track } from '../../time/tracks.ts';
import { group } from '../../script/fmt.ts';

const params = {
  fov: 32,
  az: track([
    [0, -0.25],
    [1, 0.25],
  ]),
  el: track([
    [0, 0.62],
    [0.5, 0.5],
    [1, 0.46],
  ]),
  dist: track([
    [0, 46],
    [0.5, 40],
    [1, 36],
  ]),
  extent: 48,
  spiral: 2.2,
  gridColour: [0.2, 0.26, 0.55] as const,
  crestColour: [0.75, 0.6, 1.0] as const,
  /** Waveform wall behind the binary. */
  ribbon: { x: 0, y: 0.8, z: -30, width: 44, height: 2.6 },
};

export default function inspiralScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 40, tx: 0, tt: 0, ty: 0 };
  let tt: TemplateTrack;
  let view: BinaryView;
  let wave: Ribbon;
  const clock = createClipClock();
  const labels = new LabelSet([
    { id: 'sep', text: '', tone: 'plain', side: 'above', size: 'sm' },
    { id: 'freq', text: '', tone: 'light', side: 'above', size: 'sm' },
    { id: 'wave', text: 'Best-fit waveform at Hanford: what you hear', tone: 'mute', side: 'right', size: 'sm' },
  ]);
  const L = { sep: labels.index('sep'), freq: labels.index('freq'), wave: labels.index('wave') };
  let shownSep = -1;
  let shownF = -1;
  const span = SLOW_INSPIRAL.to - SLOW_INSPIRAL.from;

  const self: BlockScene = {
    id: 'inspiral',
    status: 'measured',
    statusNote: inspiral.note,
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      tt = await loadTemplateTrack();
      defineSlowChirp(SLOW_INSPIRAL, tt);
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
        trail: 72,
      });
      view.wellPerMass = 0.04;
      view.trailOrbits = 1.4;
      view.grid.spiralInner.value = 3.2;
      view.grid.fade.value = 0.45;
      view.grid.crest.value = 1.1;
      scene.add(view.group);
      const w = GW150914.window;
      wave = createRibbon({
        data: tt.strain,
        t0: w.t0,
        fs: w.fs,
        from: SLOW_INSPIRAL.from,
        to: SLOW_INSPIRAL.to,
        colour: PAL.light,
        resolution: c.globals.uResolution,
        width: 1.5,
        sheet: 0.12,
      });
      const R = params.ribbon;
      wave.mesh.position.set(R.x, R.y, R.z);
      wave.centre.value = (SLOW_INSPIRAL.from + SLOW_INSPIRAL.to) / 2;
      wave.xScale.value = R.width / span;
      wave.yScale.value = R.height / tt.ampPeak;
      wave.half.value = R.width / 2 + 0.5;
      wave.headWidth.value = 0.004;
      scene.add(wave.mesh);
      view.update(SLOW_INSPIRAL.from);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      // The audio clock alone sets the binary's time; the scroll only frames the camera and the beats.
      clipClock(ctx.chirp, SLOW_INSPIRAL, clock);
      const t = clock.t;
      const intro = Math.min(1, local / 0.1);
      view.grid.spiral.value = params.spiral * (0.5 + 0.5 * clock.dip) * intro;
      view.grid.opacity.value = 0.4;
      view.bodies = 0.35 + 0.65 * clock.dip;
      view.update(t);
      wave.play.value = t;
      wave.active.value = 1;
      wave.intensity.value = intro * (0.5 + 0.5 * clock.dip);

      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local);
      pose.tx = rig.camera.aspect > 1 ? -8 : 0;
      pose.tt = 1;
      pose.ty = -4;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      // Live Kepler readout from the frequency being heard (held from 150 Hz; hidden once merged).
      const st = view.state;
      const sep = Math.round(keplerSeparationKm(st.f) / 10) * 10;
      const vc = Math.round(keplerSpeedC(st.f) * 100);
      const key = sep * 1000 + vc;
      if (key !== shownSep) {
        shownSep = key;
        labels.setText(L.sep, `${group(sep)} km apart · ${(vc / 100).toFixed(2)} c`);
      }
      const fk = Math.round(st.f);
      if (fk !== shownF) {
        shownF = fk;
        labels.setText(L.freq, `${fk} Hz · orbit ${Math.round(st.f / 2)} turns/s`);
      }
      const lab = intro * (st.merged ? 0.3 : 0.9);
      labels.place(L.sep, 0, 3.2, 0, rig.camera, lab);
      const R = params.ribbon;
      const px = (t - wave.centre.value) * wave.xScale.value;
      labels.place(L.freq, R.x + Math.max(-R.width / 2, Math.min(R.width / 2, px)), R.y + R.height * 1.15, R.z, rig.camera, intro * 0.9);
      labels.place(L.wave, R.x + R.width / 2 + 1, R.y, R.z, rig.camera, intro * 0.7);
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
