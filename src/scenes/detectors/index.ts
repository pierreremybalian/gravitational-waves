// Stage 11 · Two detectors. The Earth with LIGO Hanford and Livingston (Virgo and KAGRA dimmer: they joined later),
// arms along their surveyed azimuths; the straight chord between the two sites (10.01 ms of light); a plane wavefront
// sweeping through at the pace of the scroll (stated), lighting Livingston 7.09 ms before Hanford; the ring of sky
// directions that delay allows (cos θ = 7.09 / 10.01 about the Hanford → Livingston axis) and its southern arc,
// where the published sky map lies; then the two whitened recordings, Livingston shifted by 7.09 ms and turned upside
// down onto Hanford's. Sound: chirp-L1, then chirp-H1, with playheads on the traces.

import { Group, PerspectiveCamera, Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { createDetectorGlobe, latLonToScene, type DetectorGlobe } from '../../shared/detector/globe.ts';
import { sampleSeries, tracePoints } from '../../shared/detector/trace.ts';
import { createLines, type Lines } from '../../shared/gfx/lines.ts';
import { createGlowPoints, type GlowPoints } from '../../shared/gfx/glow.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { DET, PAL } from '../../shared/gfx/palette.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { C } from '../../gw/units.ts';
import { EARTH_RADIUS } from '../../shared/detector/globe.ts';
import { $reducedMotion } from '../../state/store.ts';
import { track } from '../../time/tracks.ts';
import { bump } from '../../shared/math.ts';
import { BASELINE_KM, DET as STEPS, DT, LIGHT, RING_COS } from '../../script/detectors.ts';

const SITES = ['H1', 'L1', 'V1', 'K1'] as const;

const params = {
  fov: 30,
  /** Camera: the point under it (degrees) and distance (globe radii from the centre). */
  lat: track([
    [0, 24],
    [0.16, 34],
    [0.5, 30],
    [0.6, 4],
    [0.72, 8],
    [1, 22],
  ]),
  lon: track([
    [0, -60],
    [0.16, -100],
    [0.5, -104],
    [0.6, -80],
    [0.72, -86],
    [1, -100],
  ]),
  dist: track([
    [0, 5.2],
    [0.16, 3.4],
    [0.5, 3.6],
    [0.6, 7.6],
    [0.72, 7.4],
    [0.8, 6.0],
  ]),
  /** Screen lift of the globe when the traces show (fraction of the view height). */
  lift: track([
    [0.72, 0],
    [0.8, 0.2],
  ]),
  ringRadius: 2.2,
  traceSx: 12,
  traceGain: 0.045,
  traceFrom: -0.2,
  traceTo: 0.05,
};

export default function detectorsScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const camera = new PerspectiveCamera(params.fov, 16 / 9, 0.05, 100);
  scene.add(camera);
  let globe: DetectorGlobe;
  const traceGroup = new Group();
  camera.add(traceGroup);
  let traces: Lines;
  let heads: GlowPoints;
  let wH: Float32Array = new Float32Array(0);
  let wL: Float32Array = new Float32Array(0);
  const { t0, fs } = GW150914.window;
  const v = new Vector3();
  const w = new Vector3();
  const nH = new Vector3();
  let bandFrom = 0;
  let bandTo = 0;
  let sH = 0;
  const cPerR = C / EARTH_RADIUS;
  let aspect = 16 / 9;
  const labels = new LabelSet([
    { id: 'H1', text: 'Hanford', tone: 'a', side: 'right', size: 'md' },
    { id: 'L1', text: 'Livingston', tone: 'b', side: 'right', size: 'md' },
    { id: 'V1', text: 'Virgo (from 2017)', tone: 'light', side: 'right', size: 'sm' },
    { id: 'K1', text: 'KAGRA (from 2020)', tone: 'mute', side: 'right', size: 'sm' },
    { id: 'chord', text: `${Math.round(BASELINE_KM).toLocaleString('en-US')} km · ${(LIGHT * 1000).toFixed(2)} ms of light`, tone: 'plain', side: 'below', size: 'sm' },
    { id: 'front', text: 'Wavefront (slowed to your scroll)', tone: 'mute', side: 'right', size: 'sm' },
    { id: 'ring', text: `Every direction ${(DT * 1000).toFixed(2)} ms allows`, tone: 'plain', side: 'right', size: 'sm' },
    { id: 'band', text: 'The published sky map lies mostly on this southern arc', tone: 'warm', side: 'left', size: 'sm' },
    { id: 'tH', text: 'Hanford, whitened', tone: 'a', side: 'above', size: 'sm' },
    { id: 'tL', text: 'Livingston, whitened', tone: 'b', side: 'below', size: 'sm' },
  ]);
  const ix = (id: string) => labels.index(id);
  const L = { H1: ix('H1'), L1: ix('L1'), V1: ix('V1'), K1: ix('K1'), chord: ix('chord'), front: ix('front'), ring: ix('ring'), band: ix('band'), tH: ix('tH'), tL: ix('tL') };
  let lText = '';

  const self: BlockScene = {
    id: 'detectors',
    status: 'measured',
    statusNote: 'Measured: site positions, arm directions, the 7.09 ms delay and the sign flip. The wavefront moves at the pace of your scroll; the arms are drawn hundreds of kilometres long.',
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      const [coast, h, l] = await Promise.all([
        fetch('/data/geo/coastlines-110m.json').then((r) => (r.ok ? (r.json() as Promise<number[][][]>) : [])),
        loadSeries('white-H1'),
        loadSeries('white-L1'),
      ]);
      wH = h;
      wL = l;
      globe = createDetectorGlobe({ resolution: c.globals.uResolution, coast, ring: { from: 'H1', to: 'L1', cos: RING_COS, radius: params.ringRadius }, armLength: 0.1 });
      scene.add(globe.group);
      // The ring's southern arc (directions more than 14° below the equator) and its southernmost point.
      let best = 0;
      let minY = 2;
      let inArc = false;
      for (let i = 0; i <= 720; i++) {
        const u = i / 720;
        globe.ringDirection(u, v);
        if (v.y < minY) {
          minY = v.y;
          best = u;
        }
        const south = v.y < -0.25;
        if (south && !inArc) bandFrom = u;
        if (!south && inArc) bandTo = u;
        inArc = south;
      }
      if (bandTo <= bandFrom) bandTo = 1;
      globe.ringDirection(best, globe.front.n);
      globe.sitePosition('H1', nH);
      sH = globe.front.n.dot(nH);
      // Traces: Hanford above, Livingston below (later shifted and flipped onto it).
      traces = createLines(
        [
          { points: tracePoints(wH, t0, fs, params.traceFrom, params.traceTo, 1), colour: DET.H1!, width: 1.6, intensity: 1 },
          { points: tracePoints(wL, t0, fs, params.traceFrom - 0.01, params.traceTo + 0.01, 1), colour: DET.L1!, width: 1.6, intensity: 1 },
        ],
        { resolution: c.globals.uResolution },
      );
      traceGroup.add(traces.mesh);
      heads = createGlowPoints(2, PAL.both, { radius: 0.02, intensity: 2.4 });
      traceGroup.add(heads.mesh);
      traceGroup.position.set(0, 0, -5);
      await renderer.compileAsync(scene, camera);
    },
    update(local: number, _dt: number, elapsed: number) {
      const reduced = $reducedMotion.get();
      const ch = ctx.chirp;
      // ── Globe ──
      const g = globe;
      const sites = STEPS.sites(local);
      g.show.coast = 0.9;
      g.show.grid = 0.8;
      g.show.sites = sites;
      g.show.arms = sites;
      g.show.chord = STEPS.chord(local);
      g.show.ring = STEPS.ring(local) * (1 - 0.85 * STEPS.traces(local));
      g.band.on = STEPS.band(local);
      g.band.from = bandFrom;
      g.band.to = bandTo;
      g.show.front = STEPS.front(local);
      const tau = STEPS.sweep(local);
      g.front.s = sH - tau * cPerR;
      const dtL = GW150914.offset.dtL1;
      g.site.H1 = 1 + 4 * bump(tau, 0, 0.0016) * g.show.front;
      g.site.L1 = 1 + 4 * bump(tau, dtL, 0.0016) * g.show.front;
      g.site.V1 = 0.35;
      g.site.K1 = 0.35;
      g.update();

      // ── Camera ──
      const drift = reduced ? 0 : Math.sin(elapsed * 0.05) * 1.5;
      latLonToScene(params.lat(local), params.lon(local) + drift, v, 1);
      const portrait = aspect < 1;
      const dist = params.dist(local) * (portrait ? 1.75 : 1);
      camera.position.copy(v).multiplyScalar(dist);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      // Lift the globe up the screen when the traces take the lower part.
      const lift = params.lift(local);
      camera.setViewOffset(1000, 1000, 0, lift * 1000 * (portrait ? 1.1 : 1), 1000, 1000);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      // ── Traces (camera-fixed, lower part of the view) ──
      const tr = STEPS.traces(local);
      const shift = STEPS.shift(local);
      const flip = STEPS.flip(local);
      const sx = params.traceSx * (portrait ? 0.45 : 1);
      const tx = -sx * ((params.traceFrom + params.traceTo) / 2);
      const ty = -0.62 * (portrait ? 1.5 : 1);
      const sH0 = traces.state[0]!;
      sH0.x = tx;
      sH0.y = ty + 0.26 * (1 - flip);
      sH0.sx = sx;
      sH0.sy = params.traceGain;
      sH0.intensity = tr;
      const sL = traces.state[1]!;
      // L1 on H1's clock: shifted later by the delay, then inverted.
      sL.x = tx + sx * DT * shift;
      sL.y = ty - 0.26 * (1 - flip);
      sL.sx = sx;
      sL.sy = params.traceGain * (1 - 2 * flip);
      sL.intensity = tr * 0.9;
      sL.from = 0.04;
      sL.to = 0.96;
      traces.commit();
      const live = ch.instance >= 0 && ch.playing && ch.t >= params.traceFrom && ch.t <= params.traceTo ? tr : 0;
      const t = ch.t;
      const isL = ch.clip === 'chirp-L1';
      heads.set(0, tx + sx * t, sH0.y + params.traceGain * sampleSeries(wH, t0, fs, t), 0, isL ? 0 : live);
      heads.set(1, tx + sx * (t + DT * shift), sL.y + sL.sy * sampleSeries(wL, t0, fs, t), 0, isL ? live : 0);
      heads.commit();

      // ── Labels ──
      for (let si = 0; si < SITES.length; si++) {
        const id = SITES[si]!;
        g.sitePosition(id, v).normalize();
        w.copy(camera.position).normalize();
        const facing = v.dot(w) > 0.15 ? 1 : 0;
        const o = id === 'H1' || id === 'L1' ? sites : sites * 0.8 * (local < 0.3 ? 1 : 0);
        labels.place(L[id], v.x * 1.02, v.y * 1.02, v.z * 1.02, camera, o * facing * (1 - tr * 0.6));
      }
      g.sitePosition('H1', v);
      g.sitePosition('L1', w);
      v.add(w).multiplyScalar(0.5);
      labels.place(L.chord, v.x, v.y, v.z, camera, g.show.chord * (1 - g.show.ring) * (1 - tr));
      v.copy(g.front.n).multiplyScalar(g.front.s);
      labels.place(L.front, v.x + 0.2, v.y + 0.6, v.z, camera, g.show.front);
      g.ringPoint(bandFrom > 0.25 ? bandFrom - 0.2 : bandTo + 0.2, v);
      labels.place(L.ring, v.x, v.y, v.z, camera, g.show.ring * (1 - tr));
      g.ringPoint((bandFrom + bandTo) / 2, v);
      labels.place(L.band, v.x, v.y, v.z, camera, g.band.on * g.show.ring * (1 - tr));
      traceGroup.updateMatrixWorld();
      v.set(tx + sx * (params.traceFrom + 0.05), sH0.y + 0.3, 0);
      traceGroup.localToWorld(v);
      labels.place(L.tH, v.x, v.y, v.z, camera, tr);
      v.set(tx + sx * (params.traceFrom + 0.05), sL.y - 0.3, 0);
      traceGroup.localToWorld(v);
      labels.place(L.tL, v.x, v.y, v.z, camera, tr);
      const want = flip > 0.5 ? 'Livingston, shifted 7.09 ms and inverted' : shift > 0.5 ? 'Livingston, shifted 7.09 ms' : 'Livingston, whitened';
      if (want !== lText) {
        lText = want;
        labels.setText(L.tL, want);
      }
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    resize(width: number, height: number) {
      aspect = width / height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    dispose() {
      globe?.dispose();
      traces?.dispose();
      heads?.dispose();
    },
  };
  return self;
}
