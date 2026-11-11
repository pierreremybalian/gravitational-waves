// Stage 8 · An interferometer. The L draws itself; the laser's light runs out along both arms and back; at the output
// the two returning waves are shown with their sum, dark when the arms are equal and bright when one mirror is
// nudged by a quarter wavelength; then GW150914's best-fit strain at Hanford (on the transport clock: ctx.chirp.t)
// stretches one arm while it shrinks the other, and light reaches the photodetector, its fringes running in and out.
// Exaggerations come from src/script/interferometer.ts and are stated on the stage card.

import { Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { createInterferometer, type Interferometer } from '../../shared/detector/interferometer.ts';
import { LabelTable, sampleSeries, sci } from '../../shared/detector/trace.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { $reducedMotion } from '../../state/store.ts';
import { track } from '../../time/tracks.ts';
import { armChange } from '../../gw/units.ts';
import { DISP_AT_PEAK, H_PEAK, IFO, LAMBDA_DRAWN, SLOW } from '../../script/interferometer.ts';

const params = {
  fov: 32,
  // Wide while it draws itself and the light runs; close on the output port for the interference; wide for the wave.
  az: track([
    [0, -0.75],
    [0.3, -0.55],
    [0.43, -0.45],
    [0.5, 1.45],
    [0.63, 1.5],
    [0.71, -0.5],
    [1, -0.4],
  ]),
  el: track([
    [0, 0.72],
    [0.3, 0.55],
    [0.43, 0.5],
    [0.5, 0.3],
    [0.63, 0.3],
    [0.71, 0.5],
    [1, 0.46],
  ]),
  dist: track([
    [0, 10.5],
    [0.3, 9.6],
    [0.43, 9.4],
    [0.5, 3.6],
    [0.63, 3.6],
    [0.71, 9.4],
    [1, 8.8],
  ]),
  tx: track([
    [0, 1.4],
    [0.43, 1.3],
    [0.5, 0],
    [0.63, 0],
    [0.71, 1.4],
  ]),
  ty: track([
    [0, -1.5],
    [0.43, -1.3],
    [0.5, 1.0],
    [0.63, 1.0],
    [0.71, -1.3],
  ]),
  tt: track([
    [0, -0.3],
    [0.43, -0.3],
    [0.5, 0.05],
    [0.63, 0.05],
    [0.71, -0.3],
  ]),
};

export default function interferometerScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  let ifo: Interferometer;
  let amp: Float32Array = new Float32Array(0);
  let phase: Float32Array = new Float32Array(0);
  const { t0, fs } = GW150914.window;
  const pose: RigPose = { az: 0, el: 0, dist: 9, tx: 0, tt: 0, ty: 0 };
  const v = new Vector3();
  const labels = new LabelSet([
    { id: 'laser', text: 'Laser', tone: 'light', side: 'left', size: 'sm' },
    { id: 'split', text: 'Beam splitter', tone: 'plain', side: 'below', size: 'sm' },
    { id: 'mx', text: 'Mirror · 4 km', tone: 'plain', side: 'right', size: 'sm' },
    { id: 'my', text: 'Mirror · 4 km', tone: 'plain', side: 'above', size: 'sm' },
    { id: 'pd', text: 'Photodetector', tone: 'plain', side: 'below', size: 'sm' },
    { id: 'wx', text: 'From the X arm', tone: 'light', side: 'left', size: 'sm' },
    { id: 'wy', text: 'From the Y arm', tone: 'light', side: 'left', size: 'sm' },
    { id: 'sum', text: 'Sum: dark', tone: 'both', side: 'left', size: 'sm' },
    { id: 'dx', text: '', tone: 'a', side: 'below', size: 'sm', keepCase: true },
    { id: 'dy', text: '', tone: 'a', side: 'right', size: 'sm', keepCase: true },
  ]);
  const L = {
    laser: labels.index('laser'),
    split: labels.index('split'),
    mx: labels.index('mx'),
    my: labels.index('my'),
    pd: labels.index('pd'),
    wx: labels.index('wx'),
    wy: labels.index('wy'),
    sum: labels.index('sum'),
    dx: labels.index('dx'),
    dy: labels.index('dy'),
  };
  // Live arm change in metres (real), pre-formatted: ±(drawn/peak) · armChange(peak).
  const real = armChange(H_PEAK);
  const plus = new LabelTable(-1, 1, 80, (u) => `${u >= 0 ? '+' : '−'}${sci(Math.abs(u) * real, 1, 'm')}`);
  const minus = new LabelTable(-1, 1, 80, (u) => `${u >= 0 ? '+' : '−'}${sci(Math.abs(u) * real, 1, 'm')}`);
  let ampPeak = 1;

  const self: BlockScene = {
    id: 'interferometer',
    status: 'established',
    statusNote: 'Established: how LIGO measures length. The mirror motion, the light’s wavelength and the speed of the swing are exaggerated as stated.',
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      ifo = createInterferometer({ resolution: c.globals.uResolution });
      scene.add(ifo.group);
      [amp, phase] = await Promise.all([loadSeries('template-amp'), loadSeries('template-phase')]);
      ampPeak = 0;
      for (let i = 0; i < amp.length; i++) ampPeak = Math.max(ampPeak, amp[i]!);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local: number, _dt: number, elapsed: number) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const st = ifo.state;
      st.reveal = IFO.reveal(local);
      st.light = IFO.light(local);
      st.waves = IFO.waves(local);
      st.sum = IFO.sum(local);
      st.fringes = IFO.fringes(local);
      st.frame = 1;
      // The wave: strain at Hanford from the best-fit template on the transport clock, slowed SLOW× for the eye.
      const on = IFO.wave(local);
      const ch = ctx.chirp;
      let u = 0;
      if (on > 0 && ch.instance >= 0 && amp.length) {
        const t = ch.t;
        u = (sampleSeries(amp, t0, fs, t) / ampPeak) * Math.cos(sampleSeries(phase, t0, fs, t) / SLOW) * on;
      }
      const d = u * DISP_AT_PEAK;
      const nudge = IFO.nudge(local);
      st.dx = d + nudge;
      st.dy = -d;
      // Round trip: each arm's light travels its change twice; drawn wavelength.
      st.phase = (2 * Math.PI * 2 * (st.dx - st.dy)) / LAMBDA_DRAWN;
      ifo.update(reduced ? 0 : elapsed);

      const portrait = rig.camera.aspect < 1;
      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local) * (portrait ? 1.55 : 1);
      pose.tx = params.tx(local);
      pose.tt = params.tt(local);
      pose.ty = params.ty(local);
      rig.apply(pose, reduced ? 0 : elapsed);
      rig.camera.updateMatrixWorld();

      // Labels.
      const base = Math.min(1, st.reveal * 1.5) * (local < 0.97 ? 1 : 0.6);
      const wide = base * (1 - IFO.sum(local));
      ifo.anchor('laser', v);
      labels.place(L.laser, v.x - 0.4, v.y, v.z, rig.camera, wide);
      ifo.anchor('splitter', v);
      labels.place(L.split, v.x, v.y - 0.15, v.z, rig.camera, wide * (on > 0.5 ? 0 : 1));
      ifo.anchor('mirrorX', v);
      labels.place(L.mx, v.x + 0.2, v.y, v.z, rig.camera, wide * (1 - on));
      labels.place(L.dx, v.x, v.y - 0.2, v.z, rig.camera, wide * on);
      ifo.anchor('mirrorY', v);
      labels.place(L.my, v.x, v.y + 0.2, v.z, rig.camera, wide * (1 - on));
      labels.place(L.dy, v.x + 0.2, v.y, v.z, rig.camera, wide * on);
      ifo.anchor('detector', v);
      labels.place(L.pd, v.x, v.y - 0.2, v.z + 0.12, rig.camera, base * (st.light > 0.9 ? 1 : 0));
      const s = st.sum;
      labels.place(L.wx, 0, 0.44, 1.06, rig.camera, s);
      labels.place(L.wy, 0, 0.22, 1.06, rig.camera, s);
      labels.place(L.sum, 0, 0.08, 1.06, rig.camera, s);
      labels.setText(L.sum, ifo.power > 0.5 ? 'Sum: bright' : 'Sum: dark');
      if (on > 0) {
        labels.setText(L.dx, plus.get(u));
        labels.setText(L.dy, minus.get(-u));
      }
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(width: number, height: number) {
      rig.resize(width, height);
    },
    dispose() {
      ifo.dispose();
    },
  };
  return self;
}
