// Stage 1 · A sound from space. The two detectors' whitened recordings of GW150914 as luminous ribbons over a dim sheet
// of spacetime, lit by the playhead of the chirp you hear: Hanford (amber), then Livingston (cyan), then Hanford two
// octaves up. The time axis zooms from the whole 2 s clip onto the last third of a second where the chirp is; the
// best-fit model is laid over Hanford's trace; the sheet shivers with the model's strain at the playhead.

import { Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { createLines, type Lines } from '../../shared/gfx/lines.ts';
import { createGlowPoints, type GlowPoints } from '../../shared/gfx/glow.ts';
import { DET, PAL } from '../../shared/gfx/palette.ts';
import { $reducedMotion } from '../../state/store.ts';
import { createRibbon, seriesAt, type Ribbon } from '../../shared/space/ribbon.ts';
import { createSpaceGrid, type SpaceGrid } from '../../shared/space/grid.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { sound, soundModel, soundZoom } from '../../script/sound.ts';
import { track } from '../../time/tracks.ts';

const CLIP = GW150914.clips['chirp-H1'];
const T_FROM = CLIP.t0;
const T_TO = CLIP.t0 + CLIP.duration;

const params = {
  fov: 30,
  az: track([
    [0, -0.42],
    [0.5, -0.3],
    [1, -0.22],
  ]),
  el: track([
    [0, 0.2],
    [1, 0.16],
  ]),
  dist: track([
    [0, 19],
    [0.3, 17.5],
    [1, 18.5],
  ]),
  /** Ribbon width on screen, world units. */
  width: 12,
  /** World units per σ of whitened strain. */
  yPerSigma: 0.2,
  gap: 1.45,
  /** Zoomed window (data seconds). */
  zoom: [-0.3, 0.06] as const,
};

export default function soundScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 18, tx: 0, tt: 0, ty: 0 };
  let h1: Ribbon;
  let l1: Ribbon;
  let model: Ribbon;
  let marks: Lines;
  let heads: GlowPoints;
  let floor: SpaceGrid;
  let dH1: Float32Array;
  let dL1: Float32Array;
  let strain: Float32Array;
  const w = GW150914.window;
  const labels = new LabelSet([
    { id: 'h1', text: 'Hanford, Washington', tone: 'a', side: 'right', size: 'sm' },
    { id: 'l1', text: 'Livingston, Louisiana', tone: 'b', side: 'right', size: 'sm' },
    { id: 'merger', text: 'Merger', tone: 'plain', side: 'above', size: 'sm' },
    { id: 'chirp', text: 'The chirp: 0.2 s', tone: 'warm', side: 'below', size: 'sm' },
    { id: 'model', text: 'Best-fit model (white)', tone: 'both', side: 'right', size: 'sm' },
  ]);
  const L = {
    h1: labels.index('h1'),
    l1: labels.index('l1'),
    merger: labels.index('merger'),
    chirp: labels.index('chirp'),
    model: labels.index('model'),
  };
  // Mark lines: 0 playhead, 1 merger tick, 2 chirp bracket, 3 time axis.
  const PLAYHEAD = 0;
  const MERGE = 1;
  const BRACKET = 2;
  const AXIS = 3;

  const xOf = (t: number) => (t - h1.centre.value) * h1.xScale.value;

  const self: BlockScene = {
    id: 'sound',
    status: 'measured',
    statusNote: sound.note,
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      [dH1, dL1, strain] = await Promise.all([loadSeries('white-H1'), loadSeries('white-L1'), loadSeries('template-strain-H1')]);
      const fit = await loadSeries('fit-white-H1');
      const mk = (data: Float32Array, colour: readonly [number, number, number], width: number, sheet: number) =>
        createRibbon({ data, t0: w.t0, fs: w.fs, from: T_FROM, to: T_TO, colour, resolution: c.globals.uResolution, width, sheet });
      h1 = mk(dH1, DET.H1!, 1.4, 0.05);
      l1 = mk(dL1, DET.L1!, 1.4, 0.06);
      model = mk(fit, PAL.both, 1.2, 0);
      h1.mesh.position.y = params.gap / 2;
      model.mesh.position.set(0, params.gap / 2, 0.02);
      l1.mesh.position.y = -params.gap / 2;
      for (const r of [h1, l1, model]) {
        r.yScale.value = params.yPerSigma;
        r.headWidth.value = 0.006;
        scene.add(r.mesh);
      }
      marks = createLines(
        [
          { points: [0, -1, 0, 1], colour: PAL.both, width: 1.2, intensity: 0.9 },
          { points: [0, -1, 0, 1], colour: PAL.line, width: 1, intensity: 0.5, dash: 0.12 },
          { points: [0, 0.12, 0, 0, 1, 0, 1, 0.12], colour: PAL.sun, width: 1.4, intensity: 0.9 },
          { points: [-1, 0, 1, 0], colour: PAL.edge, width: 1, intensity: 0.35 },
        ],
        { resolution: c.globals.uResolution },
      );
      scene.add(marks.mesh);
      heads = createGlowPoints(2, PAL.both, { radius: 0.09, intensity: 1.6 });
      scene.add(heads.mesh);
      floor = createSpaceGrid({
        resolution: c.globals.uResolution,
        layout: 'square',
        extent: 12,
        lines: 33,
        segments: 120,
        colour: [0.18, 0.22, 0.45],
        width: 1,
      });
      floor.mesh.position.y = -2.6;
      floor.fade.value = 0.35;
      scene.add(floor.mesh);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const ch = ctx.chirp;
      const ours = ch.clip === 'chirp-H1' || ch.clip === 'chirp-L1' || ch.clip === 'chirp-H1-x4';
      const t = ours && ch.instance >= 0 ? ch.t : -0.015;
      const playing = ours && ch.playing;
      const onL1 = ch.clip === 'chirp-L1';

      // Time axis: whole clip → the last third of a second.
      const z = soundZoom(local);
      const t0 = T_FROM + (params.zoom[0] - T_FROM) * z;
      const t1 = T_TO + (params.zoom[1] - T_TO) * z;
      const centre = (t0 + t1) / 2;
      const width = rig.camera.aspect < 1 ? params.width * 0.55 : params.width;
      const xs = width / (t1 - t0);
      const intro = Math.min(1, local / 0.1);
      for (const r of [h1, l1, model]) {
        r.centre.value = centre;
        r.xScale.value = xs;
        r.half.value = width / 2;
        r.play.value = t;
        r.headWidth.value = 0.0035 + 0.006 * (1 - z);
      }
      const heard = playing || !ours ? 1 : 0.6;
      h1.active.value = (onL1 ? 0.25 : 1) * heard;
      l1.active.value = (onL1 ? 1 : 0.25) * heard;
      h1.intensity.value = intro * (onL1 ? 0.45 : 0.75);
      l1.intensity.value = intro * (onL1 ? 1 : 0.55);
      const m = soundModel(local);
      model.intensity.value = 0.75 * m * intro;
      model.active.value = h1.active.value;

      // Playhead line across both ribbons, a bead on each trace (brightness follows loudness).
      const x = xOf(t);
      const inView = Math.abs(x) <= width / 2 ? 1 : 0;
      const ph = marks.state[PLAYHEAD]!;
      ph.x = x;
      ph.sy = params.gap / 2 + 1.1;
      ph.intensity = inView * intro * (playing ? 1 : 0.35);
      const vH = seriesAt(dH1, w.t0, w.fs, t);
      const vL = seriesAt(dL1, w.t0, w.fs, t);
      heads.set(0, x, params.gap / 2 + vH * params.yPerSigma, 0, inView * intro * (onL1 ? 0.3 : 0.6 + Math.min(2, Math.abs(vH) * 0.35)));
      heads.set(1, x, -params.gap / 2 + vL * params.yPerSigma, 0, inView * intro * (onL1 ? 0.6 + Math.min(2, Math.abs(vL) * 0.35) : 0.3));
      heads.commit();
      const mg = marks.state[MERGE]!;
      mg.x = xOf(0);
      mg.sy = params.gap / 2 + 1.0;
      mg.intensity = intro;
      const br = marks.state[BRACKET]!;
      br.x = xOf(-0.2);
      br.y = -params.gap / 2 - 1.05;
      br.sx = 0.2 * xs;
      br.sy = -1.5;
      br.intensity = intro * Math.min(1, z * 1.5);
      const ax = marks.state[AXIS]!;
      ax.sx = width / 2;
      ax.y = -params.gap / 2 - 1.3;
      ax.intensity = intro;
      marks.commit();

      // The sheet shivers with the model's strain at the playhead (×10²¹ and more: a picture of what is heard).
      const hs = seriesAt(strain, w.t0, w.fs, t) * (playing ? 1 : 0);
      floor.hp.value = 0.06 * hs;
      floor.opacity.value = 0.55 * intro;

      const hero = 1 - Math.min(1, Math.max(0, (local - 0.06) / 0.14));
      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local);
      // Desktop: captions sit bottom-left, so the instrument sits right of centre (more so under the hero title).
      pose.tx = rig.camera.aspect > 1 ? -2.6 - 1.4 * hero : 0;
      pose.tt = 0;
      pose.ty = 0;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      const lo = intro;
      labels.place(L.h1, -width / 2, params.gap / 2 + 0.75, 0, rig.camera, lo * (onL1 ? 0.6 : 1));
      labels.place(L.l1, -width / 2, -params.gap / 2 + 0.6, 0, rig.camera, lo * (onL1 ? 1 : 0.6));
      labels.place(L.merger, xOf(0), params.gap / 2 + 1.0, 0, rig.camera, lo * 0.85);
      labels.place(L.chirp, xOf(-0.1), -params.gap / 2 - 1.15, 0, rig.camera, lo * br.intensity);
      labels.place(L.model, width / 2, params.gap / 2 + 0.3, 0, rig.camera, m * lo);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(w2, h2) {
      rig.resize(w2, h2);
    },
    dispose() {
      h1?.dispose();
      l1?.dispose();
      model?.dispose();
      marks?.dispose();
      heads?.dispose();
      floor?.dispose();
    },
  };
  return self;
}
