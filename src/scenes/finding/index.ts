// Stage 10 · Finding it. The noise landscape of stage 9 is whitened (each frequency divided by the noise curve: the
// terrain lies flat and the wall drops to the noise level) and band-passed (35–350 Hz kept); the chirp stands up in
// the last rows, and the playhead row crosses it as the whitened recording plays (clip chirp-H1). Then the matched
// filter: the whitened data as a tape; the best-fit template (whitened the same way) slides along it; a pen under the
// template's merger draws the network SNR at each offset (snr-net) and the needle locks at 23.85 at zero offset.

import { Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { buildLandscape, type Landscape } from '../../shared/detector/landscape.ts';
import { createNoiseField, type NoiseField } from '../../shared/detector/noisefield.ts';
import { LabelTable, sampleSeries, tracePoints } from '../../shared/detector/trace.ts';
import { createLines, type Lines } from '../../shared/gfx/lines.ts';
import { createGlowPoints, type GlowPoints } from '../../shared/gfx/glow.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { DET, PAL } from '../../shared/gfx/palette.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { $reducedMotion } from '../../state/store.ts';
import { track, windowed } from '../../time/tracks.ts';
import { BAND, FIND, SLIDE_FROM, offsetAt } from '../../script/finding.ts';

const params = {
  fov: 30,
  /** Tape: seconds → world x; whitened σ → world y; where the merger sits. */
  tsx: 10.5,
  gain: 0.1,
  mergerX: 1.7,
  tapeY: 0.55,
  tapeZ: 3.4,
  tFrom: -0.5,
  tTo: 0.12,
  /** Pen: SNR → world y, baseline. */
  penK: 1.45 / 24,
  penY: -1.15,
  az: track([
    [0, -0.5],
    [0.3, -0.42],
    [0.44, -0.3],
    [0.56, 0],
  ]),
  el: track([
    [0, 0.42],
    [0.3, 0.48],
    [0.44, 0.5],
    [0.56, 0.04],
  ]),
  dist: track([
    [0, 8.8],
    [0.3, 9.6],
    [0.44, 9.4],
    [0.56, 7.4],
  ]),
  tt: track([
    [0, 0.55],
    [0.44, 0.35],
    [0.56, -0.15],
  ]),
  ty: track([
    [0, 0.2],
    [0.44, 0.6],
    [0.56, 3.4],
  ]),
  tx: track([
    [0, 0],
    [0.44, 0],
    [0.56, -0.6],
  ]),
};

export default function findingScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  let land: Landscape;
  let nf: NoiseField;
  let tape: Lines;
  let dots: GlowPoints;
  let white: Float32Array = new Float32Array(0);
  let fit: Float32Array = new Float32Array(0);
  let snr: Float32Array = new Float32Array(0);
  const { t0, fs } = GW150914.window;
  const pose: RigPose = { az: 0, el: 0, dist: 8, tx: 0, tt: 0, ty: 0 };
  const v = new Vector3();
  const labels = new LabelSet([
    { id: 'lo', text: `${BAND[0]} Hz`, tone: 'mute', side: 'below', size: 'sm' },
    { id: 'hi', text: `${BAND[1]} Hz`, tone: 'mute', side: 'below', size: 'sm' },
    { id: 'chirp', text: 'The chirp', tone: 'warm', side: 'right', size: 'md' },
    { id: 'data', text: 'Whitened data, Hanford', tone: 'a', side: 'above', size: 'sm' },
    { id: 'tmpl', text: 'Best-fit template', tone: 'both', side: 'above', size: 'sm' },
    { id: 'snr', text: '', tone: 'warm', side: 'right', size: 'md' },
    { id: 'pen', text: 'Network SNR at each offset', tone: 'mute', side: 'left', size: 'sm' },
  ]);
  const ix = (id: string) => labels.index(id);
  const L = { lo: ix('lo'), hi: ix('hi'), chirp: ix('chirp'), data: ix('data'), tmpl: ix('tmpl'), snr: ix('snr'), pen: ix('pen') };
  const snrText = new LabelTable(0, 25, 2500, (x) => `SNR ${x.toFixed(2)}`);
  const span = params.tTo - params.tFrom;

  const self: BlockScene = {
    id: 'finding',
    status: 'measured',
    statusNote: 'Measured: the whitened Hanford data and the matched-filter signal-to-noise ratio; the template slid along it is the model fitted to the data.',
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      const [raw, asd, w, f, s] = await Promise.all([loadSeries('raw-H1'), loadSeries('asd-H1'), loadSeries('white-H1'), loadSeries('fit-white-H1'), loadSeries('snr-net')]);
      white = w;
      fit = f;
      snr = s;
      const A = { f0: GW150914.asd.f0, df: GW150914.asd.df, data: asd };
      land = buildLandscape(raw, fs, t0, A);
      nf = createNoiseField(land, A);
      scene.add(nf.group);
      tape = createLines(
        [
          { points: tracePoints(white, t0, fs, params.tFrom, params.tTo, 1), colour: DET.H1!, width: 1.5, intensity: 0.75 },
          { points: tracePoints(fit, t0, fs, params.tFrom, params.tTo, 1), colour: PAL.both, width: 1.8, intensity: 1.1 },
          { points: tracePoints(snr, t0, fs, SLIDE_FROM, 0.02, 1), colour: PAL.bowl, width: 2.0, intensity: 1.0 },
          { points: Float32Array.from([0, 0, 0, 1]), colour: PAL.bowl, width: 2.6, intensity: 1.2 },
          { points: Float32Array.from([-6, 0, 6, 0]), colour: PAL.edge, width: 1.0, intensity: 0.35 },
        ],
        { resolution: c.globals.uResolution },
      );
      scene.add(tape.mesh);
      dots = createGlowPoints(3, PAL.both, { radius: 0.035, intensity: 2.6 });
      scene.add(dots.mesh);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local: number, _dt: number, elapsed: number) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      // ── Landscape: whiten, band-pass ──
      const wh = FIND.whiten(local);
      const bp = FIND.band(local);
      const ld = FIND.land(local);
      nf.setMorph(wh);
      nf.setHeight(1);
      const f = nf.field;
      f.intensity.value = 0.55 * ld;
      f.hotGain.value = wh * (1 + bp);
      nf.wall.intensity.value = 2.2 * ld;
      const xLo = land.xOf(BAND[0]);
      const xHi = land.xOf(BAND[1]);
      const xMin = land.x[0]! - 1;
      const xMax = land.x[land.cols - 1]! + 1;
      f.xLo.value = xMin + (xLo - xMin) * bp;
      f.xHi.value = xMax + (xHi - xMax) * bp;
      f.xSoft.value = 0.12;
      f.outside.value = 1 - 0.85 * bp;
      nf.wall.xLo.value = f.xLo.value;
      nf.wall.xHi.value = f.xHi.value;
      nf.wall.xSoft.value = 0.12;
      nf.wall.outside.value = f.outside.value;
      const ch = ctx.chirp;
      const live = ch.instance >= 0 && ch.playing ? 1 : 0;
      const t = ch.t;
      nf.playhead(t, live * ld);

      // ── Tape, template, pen ──
      const tp = FIND.tape(local);
      const off = offsetAt(local);
      const lock = FIND.lock(local);
      const flash = windowed(local, 0.87, 0.95, 0.01, 0.06);
      const pen = FIND.pen(local);
      const S = tape.state;
      const place = (i: number, x: number, y: number, sx: number, sy: number) => {
        const s = S[i]!;
        s.x = x;
        s.y = y;
        s.z = params.tapeZ;
        s.sx = sx;
        s.sy = sy;
      };
      place(0, params.mergerX, params.tapeY, params.tsx, params.gain);
      S[0]!.intensity = tp;
      place(1, params.mergerX + params.tsx * off, params.tapeY, params.tsx, params.gain);
      S[1]!.intensity = local > 0.57 ? tp * (0.8 + 0.8 * lock) : 0;
      S[1]!.from = Math.min(1, Math.max(0, -off / span));
      place(2, params.mergerX, params.penY, params.tsx, params.penK);
      const snrNow = sampleSeries(snr, t0, fs, off);
      S[2]!.intensity = pen * tp;
      S[2]!.to = Math.min(1, Math.max(0, (off - SLIDE_FROM) / (0.02 - SLIDE_FROM)));
      place(3, params.mergerX + params.tsx * off, params.penY, 1, snrNow * params.penK);
      S[3]!.intensity = pen * tp * (1 + 3 * flash);
      place(4, 0, params.penY, 1, 1);
      S[4]!.intensity = pen * tp;
      tape.commit();
      // Playheads at the moment heard: on the data, and on the template once it is locked; the pen's tip.
      const tIn = t >= params.tFrom && t <= params.tTo ? 1 : 0;
      dots.set(0, params.mergerX + params.tsx * t, params.tapeY + params.gain * sampleSeries(white, t0, fs, t), params.tapeZ, live * tp * tIn);
      dots.set(1, params.mergerX + params.tsx * t, params.tapeY + params.gain * sampleSeries(fit, t0, fs, t), params.tapeZ, live * tp * tIn * lock);
      dots.set(2, params.mergerX + params.tsx * off, params.penY + snrNow * params.penK, params.tapeZ, pen * tp * (1 + 4 * flash));
      dots.commit();

      const portrait = rig.camera.aspect < 1;
      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local) * (portrait ? 1.12 : 1);
      pose.tx = params.tx(local) * (portrait ? 0 : 1);
      pose.tt = params.tt(local);
      pose.ty = params.ty(local);
      rig.apply(pose, reduced ? 0 : elapsed);
      rig.camera.updateMatrixWorld();

      // ── Labels ──
      const zf = land.z[land.rows - 1]! + 0.15;
      labels.place(L.lo, xLo, 0, zf, rig.camera, bp * ld);
      labels.place(L.hi, xHi, 0, zf, rig.camera, bp * ld);
      v.set(land.xOf(150), 2.6 * wh, land.zOf(0));
      labels.place(L.chirp, v.x, v.y, v.z, rig.camera, Math.min(wh, ld) * (local > 0.2 ? 1 : 0));
      labels.place(L.data, params.mergerX + params.tsx * -0.46, params.tapeY + 0.42, params.tapeZ, rig.camera, tp);
      labels.place(L.tmpl, params.mergerX + params.tsx * (off - 0.08), params.tapeY + 0.62, params.tapeZ, rig.camera, tp * (local > 0.57 ? 1 : 0) * (1 - lock));
      labels.setText(L.snr, snrText.get(snrNow));
      labels.place(L.snr, params.mergerX + params.tsx * off + 0.12, params.penY + snrNow * params.penK, params.tapeZ, rig.camera, pen * tp);
      labels.place(L.pen, params.mergerX + params.tsx * SLIDE_FROM - 0.1, params.penY + 0.08, params.tapeZ, rig.camera, pen * tp * (1 - lock));
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
      tape?.dispose();
      dots?.dispose();
    },
  };
  return self;
}
