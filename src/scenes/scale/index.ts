// Stage 7 · How small. A loupe dives through powers of ten from LIGO's 4 km arms to the mirror at the end of one,
// past a hair, a wavelength of the laser light, an atom, a nucleus and a proton, to the distance the wave moved the
// mirror: 2 × 10⁻¹⁸ m. At the bottom the mirror's surface (amber) moves against its rest position with the strain
// Hanford recorded, at its true size, locked to the chirp you hear. Every size is real (src/script/scale.ts).

import { Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { LabelSet, type LabelSpec } from '../../shared/gfx/labels.ts';
import { arcPoints, circlePoints, createLines, type Lines } from '../../shared/gfx/lines.ts';
import { DET, PAL } from '../../shared/gfx/palette.ts';
import { $reducedMotion } from '../../state/store.ts';
import { createScaleStack, type ScaleItem, type ScaleStack } from '../../shared/space/loupe.ts';
import { seriesAt } from '../../shared/space/ribbon.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { LIGO_ARM } from '../../gw/units.ts';
import { SIZES, scale, scaleZoom } from '../../script/scale.ts';
import { sci } from '../../script/fmt.ts';
import { supHtml } from '../../lib/sup.ts';
import { track } from '../../time/tracks.ts';

const params = {
  fov: 30,
  /** World units per 10^zoom metres. */
  unit: 2.2,
  az: track([
    [0, 0.3],
    [1, -0.15],
  ]),
  el: track([
    [0, 0.35],
    [1, 0.12],
  ]),
  dist: 12.5,
};

const sine = (() => {
  const n = 96;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out[i * 2] = x;
    out[i * 2 + 1] = 0.22 * Math.sin(2 * Math.PI * x);
  }
  return out;
})();

const ITEMS: ScaleItem[] = [
  { id: 'arms', metres: LIGO_ARM, points: [0, 1, 0, 0, 1, 0], colour: DET.H1!, width: 2.2, intensity: 1.2, ox: 1, oy: 0 },
  { id: 'mirror', metres: SIZES.mirror, points: circlePoints(96, 0.5), colour: PAL.cool, width: 1.8, closed: true },
  { id: 'hair', metres: SIZES.hair, points: circlePoints(72, 0.5), colour: PAL.line, width: 1.6, closed: true },
  { id: 'laser', metres: SIZES.laser, points: sine, colour: PAL.red, width: 1.8, ox: 0.5 },
  { id: 'atom', metres: SIZES.atom, points: circlePoints(96, 0.5), colour: PAL.light, width: 1.4, closed: true, dash: 0.06 },
  { id: 'nucleus', metres: SIZES.nucleus, points: circlePoints(72, 0.5), colour: PAL.andromeda, width: 1.6, closed: true },
  { id: 'proton', metres: SIZES.proton, points: circlePoints(72, 0.5), colour: PAL.sun, width: 2, intensity: 1.3, closed: true },
  // The mirror's rest position and its surface as the wave moves it (1 unit = the 2 × 10⁻¹⁸ m of h = 10⁻²¹).
  { id: 'rest', metres: SIZES.shift, points: [0, -0.6, 0, 0.6], colour: PAL.cool, width: 1.4, intensity: 0.7, dash: 0.06, maxLog: 1.6 },
  { id: 'surface', metres: SIZES.shift, points: [0, -0.6, 0, 0.6], colour: DET.H1!, width: 2.6, intensity: 1.6, maxLog: 1.6 },
  // Decade rings: one faint circle per power of ten, so the dive always has something passing.
  ...Array.from({ length: 23 }, (_, k): ScaleItem => ({
    id: `d${k}`,
    metres: Math.pow(10, 4 - k),
    points: circlePoints(96, 0.5),
    colour: PAL.edge,
    width: 1,
    intensity: 0.32,
    closed: true,
    minLog: -1.2,
    maxLog: 1.2,
  })),
];

const NAMES: Record<string, string> = {
  ...Object.fromEntries(Array.from({ length: 23 }, (_, k) => [`d${k}`, ''])),
  arms: `LIGO Hanford: two arms, ${(LIGO_ARM / 1000).toFixed(1)} km`,
  mirror: `The mirror at the arm’s end: ${(SIZES.mirror * 100).toFixed(0)} cm`,
  hair: 'A human hair: about 0.1 mm',
  laser: `One wavelength of the laser light: ${(SIZES.laser * 1e9).toFixed(0)} nm`,
  atom: 'An atom of the mirror: about 0.2 nm',
  nucleus: `Its nucleus: about ${(SIZES.nucleus * 1e15).toFixed(0)} fm`,
  proton: `A proton: ${(SIZES.proton * 1e15).toFixed(2)} fm`,
  rest: 'Mirror at rest',
  surface: supHtml(`Moved by the wave: ${sci(SIZES.shift)} m at h = 10⁻²¹`),
};

/** Where each label sits, in the item's own units (before its origin offset). */
const ANCHOR: Record<string, [number, number]> = {
  ...Object.fromEntries(Array.from({ length: 23 }, (_, k) => [`d${k}`, [0, 0] as [number, number]])),
  arms: [0, 1],
  mirror: [0.36, 0.36],
  hair: [0.36, 0.36],
  laser: [0.75, -0.22],
  atom: [0.36, 0.36],
  nucleus: [0.36, 0.36],
  proton: [0.36, 0.36],
  rest: [0, -0.6],
  surface: [0, 0.6],
};

const DECADES: [number, string][] = [
  [3, '1 km'],
  [0, '1 m'],
  [-3, '1 mm'],
  [-6, '1 µm'],
  [-9, '1 nm'],
  [-12, '1 pm'],
  [-15, '1 fm'],
  [-18, '1 am'],
];

export default function scaleScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 8, tx: 0, tt: 0, ty: 0 };
  let stack: ScaleStack;
  let frame: Lines;
  let strain: Float32Array;
  const w = GW150914.window;
  const specs: LabelSpec[] = ITEMS.map((it) => ({
    id: it.id,
    text: NAMES[it.id]!,
    tone: it.id === 'surface' || it.id === 'arms' ? 'a' : 'plain',
    side: it.id === 'rest' ? 'below' : it.id === 'surface' ? 'above' : 'right',
    size: 'sm',
    keepCase: it.id === 'surface' ? true : undefined,
  }));
  specs.push({ id: 'frame', text: '', tone: 'mute', side: 'below', size: 'sm' });
  const labels = new LabelSet(specs);
  const LFRAME = labels.index('frame');
  let shownDecade = 99;
  const surfaceIdx = ITEMS.findIndex((i) => i.id === 'surface');

  const self: BlockScene = {
    id: 'scale',
    status: 'measured',
    statusNote: scale.note,
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      strain = await loadSeries('bandpass-H1');
      stack = createScaleStack(ITEMS, c.globals.uResolution, params.unit);
      scene.add(stack.lines.mesh);
      // The loupe: a fixed ring and a scale bar one unit (10^zoom m) long.
      frame = createLines(
        [
          { points: circlePoints(160, params.unit * 1.25), colour: PAL.edge, width: 1.3, intensity: 0.55, closed: true },
          { points: arcPoints(Math.PI * 0.62, Math.PI * 0.88, 40, params.unit * 1.32), colour: PAL.edge, width: 1, intensity: 0.4 },
          { points: [-params.unit / 2, -params.unit * 1.08, params.unit / 2, -params.unit * 1.08], colour: PAL.line, width: 1.4, intensity: 0.7 },
        ],
        { resolution: c.globals.uResolution },
      );
      scene.add(frame.mesh);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const z = scaleZoom(local);
      // The mirror's surface follows Hanford's band-passed strain at the playhead (×10²¹ → units of 2 × 10⁻¹⁸ m).
      const ch = ctx.chirp;
      const ours = ch.clip === 'chirp-H1' && ch.instance >= 0;
      const t = ours ? ch.t : -0.01;
      const h21 = ours && !ch.playing ? 0 : seriesAt(strain, w.t0, w.fs, t);
      ITEMS[surfaceIdx]!.ox = -h21;
      const lo = Math.min(1, local / 0.1);
      stack.update(z, lo);

      // Scale bar under the frame: one unit = 10^z m.
      const d = Math.round(z * 2);
      if (d !== shownDecade) {
        shownDecade = d;
        let dec = DECADES[0]!;
        for (const cur of DECADES) if (cur[0] <= z + 0.5 && cur[0] > z - 2.5) dec = cur;
        const p = Math.pow(10, z - dec[0]);
        labels.setText(LFRAME, `Scale bar: ${p >= 10 ? Math.round(p) : p.toFixed(1)} × ${dec[1]}`);
      }
      for (let i = 0; i < 3; i++) frame.state[i]!.intensity = lo;
      frame.commit();

      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist * (rig.camera.aspect < 1 ? 1.15 : 1);
      pose.tx = rig.camera.aspect > 1 ? -2.4 : 0;
      pose.tt = 0;
      pose.ty = 0;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      for (let i = 0; i < ITEMS.length; i++) {
        const it = ITEMS[i]!;
        const s = stack.screen(i);
        const v = stack.vis(i);
        const [ax, ay] = ANCHOR[it.id]!;
        const x = (ax - (it.ox ?? 0)) * s;
        const y = (ay - (it.oy ?? 0)) * s;
        const fits = s > params.unit * 2.6 ? 0 : 1;
        labels.place(i, x, y, 0, rig.camera, v > 0.6 && NAMES[it.id] ? v * lo * fits : 0);
      }
      labels.place(LFRAME, 0, -params.unit * 1.08, 0, rig.camera, lo * 0.8);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(w2, h2) {
      rig.resize(w2, h2);
    },
    dispose() {
      stack?.dispose();
      frame?.dispose();
    },
  };
  return self;
}
