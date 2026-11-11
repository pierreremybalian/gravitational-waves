// Stage 9 · Noise. Hanford's raw strain around GW150914 (3 s) as a luminous trace, and under it the signal at the
// same scale: a flat line, until it is magnified (stated) to show its chirp. Then the same seconds as a landscape
// (time toward you, frequency across, amplitude up) built from the raw data and the noise curve, with the ASD as the
// bright ridge at the back; a playhead row rides the field at the moment heard (clip raw-H1, the raw recording).

import { Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { buildLandscape, type Landscape } from '../../shared/detector/landscape.ts';
import { createNoiseField, type NoiseField } from '../../shared/detector/noisefield.ts';
import { sampleSeries, tracePoints } from '../../shared/detector/trace.ts';
import { ensureRawClip } from '../../shared/detector/clips.ts';
import { createLines, type Lines } from '../../shared/gfx/lines.ts';
import { createGlowPoints, type GlowPoints } from '../../shared/gfx/glow.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { DET, PAL } from '../../shared/gfx/palette.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { $reducedMotion } from '../../state/store.ts';
import { track } from '../../time/tracks.ts';
import stats from '../../data/detector-stats.json';
import { NOISE, SIGNAL_ZOOM } from '../../script/noise.ts';

const params = {
  fov: 30,
  /** Trace: seconds → world x, and its half-height (world) at the raw peak. */
  traceSx: 2.0,
  traceHalf: 1.0,
  traceY: 0.9,
  traceZ: 2.9,
  traceX: 1.0,
  height: 1.0,
  az: track([
    [0, 0],
    [0.44, 0],
    [0.58, -0.38],
    [1, -0.5],
  ]),
  el: track([
    [0, 0.06],
    [0.44, 0.06],
    [0.6, 0.5],
    [1, 0.42],
  ]),
  dist: track([
    [0, 8.4],
    [0.44, 8.2],
    [0.6, 9.4],
    [1, 8.8],
  ]),
  tt: track([
    [0, 0.9],
    [0.44, 0.85],
    [0.6, 0.55],
  ]),
  ty: track([
    [0, 2.9],
    [0.44, 2.9],
    [0.6, 0.2],
  ]),
};

export default function noiseScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  let land: Landscape;
  let nf: NoiseField;
  let traces: Lines;
  let heads: GlowPoints;
  let raw: Float32Array = new Float32Array(0);
  let sig: Float32Array = new Float32Array(0);
  const { t0, fs } = GW150914.window;
  const pose: RigPose = { az: 0, el: 0, dist: 8, tx: 0, tt: 0, ty: 0 };
  const v = new Vector3();
  const labels = new LabelSet([
    { id: 'raw', text: 'Raw strain, Hanford', tone: 'a', side: 'above', size: 'sm' },
    { id: 'sig', text: 'The signal, same scale', tone: 'both', side: 'below', size: 'sm' },
    { id: 'seis', text: 'Ground motion and controls', tone: 'b', side: 'above', size: 'sm' },
    { id: 'therm', text: 'Thermal and technical noise', tone: 'b', side: 'above', size: 'sm' },
    { id: 'shot', text: 'Quantum (shot) noise', tone: 'b', side: 'above', size: 'sm' },
    { id: 'mains', text: `${Math.round(stats.asd.mainsFreq)} Hz mains`, tone: 'mute', side: 'right', size: 'sm' },
    { id: 'violin', text: 'Violin modes', tone: 'mute', side: 'right', size: 'sm' },
    { id: 'quiet', text: `Quietest, near ${Math.round(stats.asd.minFreq)} Hz`, tone: 'plain', side: 'below', size: 'sm' },
    { id: 'f', text: 'Frequency →', tone: 'mute', side: 'right', size: 'sm' },
    { id: 't', text: 'Time →', tone: 'mute', side: 'right', size: 'sm' },
  ]);
  const ix = (id: string) => labels.index(id);
  const L = { raw: ix('raw'), sig: ix('sig'), seis: ix('seis'), therm: ix('therm'), shot: ix('shot'), mains: ix('mains'), violin: ix('violin'), quiet: ix('quiet'), f: ix('f'), t: ix('t') };
  const zoomText = `The signal ×${Math.round(SIGNAL_ZOOM)}`;
  let zoomShown = false;

  const self: BlockScene = {
    id: 'noise',
    status: 'measured',
    statusNote: 'Measured: Hanford’s raw strain and its noise spectrum around GW150914; the signal’s magnification is stated where it is used.',
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      void ensureRawClip();
      const [r, s, asd] = await Promise.all([loadSeries('raw-H1'), loadSeries('template-strain-H1'), loadSeries('asd-H1')]);
      raw = r;
      sig = s;
      const A = { f0: GW150914.asd.f0, df: GW150914.asd.df, data: asd };
      land = buildLandscape(raw, fs, t0, A);
      nf = createNoiseField(land, A);
      nf.setHeight(params.height);
      scene.add(nf.group);
      // Raw strain (normalised to its peak) and the template at the same scale (×1e-21 / raw peak).
      const g = 1 / stats.rawPeakH1;
      traces = createLines(
        [
          { points: tracePoints(raw, t0, fs, -2, 1, g, 2), colour: DET.H1!, width: 1.2, intensity: 0.42 },
          { points: tracePoints(sig, t0, fs, -2, 1, 1e-21 * g, 1), colour: PAL.both, width: 1.4, intensity: 0.8 },
        ],
        { resolution: c.globals.uResolution },
      );
      scene.add(traces.mesh);
      heads = createGlowPoints(2, PAL.both, { radius: 0.03, intensity: 2.4 });
      scene.add(heads.mesh);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local: number, _dt: number, elapsed: number) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const tr = NOISE.trace(local);
      const sOn = NOISE.signal(local);
      const zoom = 1 + (SIGNAL_ZOOM - 1) * NOISE.zoom(local);
      for (let i = 0; i < 2; i++) {
        const s = traces.state[i]!;
        s.x = params.traceX;
        s.sx = params.traceSx;
        s.y = params.traceY - (i === 1 ? 0 : 0);
        s.z = params.traceZ;
        s.sy = params.traceHalf * (i === 1 ? zoom : 1);
        s.intensity = i === 0 ? tr * (1 - 0.65 * NOISE.zoom(local)) : tr * sOn;
      }
      traces.commit();
      // Landscape: rows appear from the front (now) backwards; the wall last.
      const ld = NOISE.land(local);
      const zFront = land.z[land.rows - 1]!;
      const zBack = land.z[0]!;
      nf.field.zFrom.value = zFront - (zFront - zBack + 0.1) * ld;
      nf.field.zSoft.value = 0.4;
      nf.field.intensity.value = ld > 0 ? 0.55 : 0;
      nf.wall.intensity.value = 2.2 * NOISE.wall(local);
      nf.setMorph(0);
      // Playheads: on the raw trace and across the landscape, at the moment heard.
      const ch = ctx.chirp;
      const live = ch.instance >= 0 && ch.clip !== null && ch.playing ? 1 : 0;
      const t = ch.t;
      heads.set(0, params.traceX + params.traceSx * t, params.traceY + params.traceHalf * sampleSeries(raw, t0, fs, t) / stats.rawPeakH1, params.traceZ, live * tr * 1.0);
      heads.set(1, 0, 0, 0, 0);
      heads.commit();
      nf.playhead(t, live * ld);

      const portrait = rig.camera.aspect < 1;
      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local) * (portrait ? 1.1 : 1);
      pose.tx = 0;
      pose.tt = params.tt(local);
      pose.ty = params.ty(local);
      rig.apply(pose, reduced ? 0 : elapsed);
      rig.camera.updateMatrixWorld();

      // Labels.
      labels.place(L.raw, -1.2, params.traceY + params.traceHalf * 0.85, params.traceZ, rig.camera, tr * (1 - NOISE.land(local)));
      if (NOISE.zoom(local) > 0.5 !== zoomShown) {
        zoomShown = !zoomShown;
        labels.setText(L.sig, zoomShown ? zoomText : 'The signal, same scale');
      }
      labels.place(L.sig, 2.2, params.traceY - 0.15, params.traceZ, rig.camera, tr * sOn * (1 - NOISE.land(local)));
      const nm = NOISE.names(local);
      const H = params.height;
      const wz = nf.wallZ;
      const at = (f: number, a: number, i: number, lift = 0.08) => {
        v.set(land.xOf(f), land.heightOfAsd(a) * H + lift, wz);
        labels.place(i, v.x, v.y, v.z, rig.camera, nm);
      };
      at(19, stats.asd.at15 * 0.12, L.seis, 0.12);
      at(48, stats.asd.at100 * 2.2, L.therm, 0.12);
      at(780, stats.asd.at1000, L.shot, 0.12);
      at(stats.asd.mainsFreq, stats.asd.mainsValue, L.mains, 0.0);
      at(stats.asd.violinFreq, stats.asd.violinValue, L.violin, 0.0);
      v.set(land.xOf(stats.asd.minFreq), land.heightOfAsd(stats.asd.minValue) * H, wz);
      labels.place(L.quiet, v.x, v.y - 0.05, v.z, rig.camera, nm);
      labels.place(L.f, land.x[land.cols - 1]! + 0.1, 0, land.z[land.rows - 1]! + 0.1, rig.camera, NOISE.wall(local) * 0.9);
      labels.place(L.t, land.x[land.cols - 1]! + 0.1, 0, 0, rig.camera, 0);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(width: number, height: number) {
      rig.resize(width, height);
    },
    dispose() {
      nf?.dispose();
      traces?.dispose();
      heads?.dispose();
    },
  };
  return self;
}
