// Stage 12 · What it told us. The masses as beads, one per solar mass (rounded catalogue medians: 35 and 30): two
// clusters orbit with the best-fit template's phase on the chirp's clock (clip chirp-H1) and fuse at the merger into
// 62; the three left over leave on an expanding ring, the energy radiated. Then the distance: a line to Earth drawn
// to scale along itself (470 Mpc, its 90% range, the 2016 estimate of 410 Mpc), a pulse travelling it with the scroll;
// then GW170817 on the same scale (40 Mpc), its gravitational wave and gamma-ray flash travelling together.

import { Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { createBeads, type Beads } from '../../shared/detector/beads.ts';
import { createLines, type LineSpec, type Lines } from '../../shared/gfx/lines.ts';
import { createGlowLine, type GlowLine } from '../../shared/gfx/glow.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { PAL } from '../../shared/gfx/palette.ts';
import { GW150914, loadSeries } from '../../shared/gwdata.ts';
import { binaryAt, createBinaryState, type Track } from '../../gw/binary.ts';
import { $reducedMotion } from '../../state/store.ts';
import { track } from '../../time/tracks.ts';
import { smoothstep } from '../../shared/math.ts';
import results from '../../data/results.json';
import { BEADS, BNS, CAT, PRL, RES, lyOf } from '../../script/results.ts';

const params = {
  fov: 32,
  /** Scene units per Mpc on the distance lines. */
  perMpc: 12 / 470,
  bnsY: -2.2,
  beadR: 0.055,
  /** Bead cluster radius per cube-root solar mass. */
  cluster: 0.12,
  /** Separation at the start of the clip (scene units). */
  sep0: 2.6,
  ringSpeed: 7,
  az: track([
    [0, -0.3],
    [0.46, -0.18],
    [0.58, -0.05],
    [1, -0.05],
  ]),
  el: track([
    [0, 0.85],
    [0.46, 0.8],
    [0.58, 0.18],
    [1, 0.2],
  ]),
  dist: track([
    [0, 7.2],
    [0.46, 7.0],
    [0.58, 15],
    [0.72, 15],
    [0.8, 12],
  ]),
  tx: track([
    [0, 0],
    [0.46, 0],
    [0.58, 6.0],
    [0.72, 6.0],
    [0.8, 7.4],
  ]),
  tt: track([
    [0, 0],
    [0.46, 0],
    [0.58, -0.4],
    [0.72, -0.5],
    [0.8, -1.0],
  ]),
};

/** Fibonacci-sphere point k of n (unit radius). */
function fib(k: number, n: number, out: Vector3): Vector3 {
  const y = 1 - (2 * (k + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const a = k * Math.PI * (3 - Math.sqrt(5));
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

type Iv = number | number[] | null;
const lo = (v: Iv) => (Array.isArray(v) ? v[1]! : NaN);
const hi = (v: Iv) => (Array.isArray(v) ? v[2]! : NaN);

export default function resultsScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const N1 = BEADS.m1;
  const N2 = BEADS.m2;
  const NF = BEADS.mf;
  const NB = N1 + N2;
  const PULSES = 3;
  let beads: Beads;
  let ring: GlowLine;
  let lines: Lines;
  let trackT: Track | null = null;
  const bs = createBinaryState();
  const pose: RigPose = { az: 0, el: 0, dist: 8, tx: 0, tt: 0, ty: 0 };
  // Rest offsets of each bead in its cluster and in the remnant.
  const off1 = Array.from({ length: NB }, () => new Vector3());
  const offF = Array.from({ length: NB }, () => new Vector3());
  const radDir = Array.from({ length: NB - NF }, (_, i) => new Vector3(Math.cos((i / (NB - NF)) * Math.PI * 2 + 0.4), 0, Math.sin((i / (NB - NF)) * Math.PI * 2 + 0.4)));
  const r1 = params.cluster * Math.cbrt(CAT.m1);
  const r2 = params.cluster * Math.cbrt(CAT.m2);
  const rf = params.cluster * Math.cbrt(CAT.mf);
  let a0 = 1;
  const D = (mpc: number) => mpc * params.perMpc;
  const dist = CAT.d;
  const E = results.GW150914;
  const labels = new LabelSet([
    { id: 'm1', text: `${CAT.m1} M☉`, tone: 'warm', side: 'above', size: 'md' },
    { id: 'm2', text: `${CAT.m2} M☉`, tone: 'warm', side: 'above', size: 'md' },
    { id: 'mf', text: `${CAT.mf} M☉`, tone: 'warm', side: 'above', size: 'md' },
    { id: 'rad', text: `${(CAT.m1 + CAT.m2 - CAT.mf).toFixed(1)} M☉ radiated as gravitational waves`, tone: 'both', side: 'right', size: 'sm' },
    { id: 'bead', text: 'One bead = one solar mass', tone: 'mute', side: 'below', size: 'sm' },
    { id: 'src', text: 'GW150914', tone: 'warm', side: 'left', size: 'md' },
    { id: 'earth', text: 'Earth', tone: 'b', side: 'right', size: 'md' },
    { id: 'range', text: `${lo(E.distance)}–${hi(E.distance)} Mpc (90%)`, tone: 'mute', side: 'below', size: 'sm' },
    { id: 'prl', text: `2016: ${PRL.d} Mpc`, tone: 'mute', side: 'above', size: 'sm' },
    { id: 'cat', text: `${dist} Mpc · ${(lyOf(dist) / 1e9).toFixed(1)} billion ly`, tone: 'a', side: 'above', size: 'sm' },
    { id: 'bns', text: `GW170817 · ${BNS.d} Mpc · ${Math.round(lyOf(BNS.d) / 1e6)} million ly`, tone: 'light', side: 'left', size: 'md' },
    { id: 'race', text: `Gravitational wave and gamma rays: ${BNS.delay} s apart at the end`, tone: 'light', side: 'below', size: 'sm' },
    { id: 'scale', text: 'Distances to scale along each line', tone: 'mute', side: 'below', size: 'sm' },
  ]);
  const ix = (id: string) => labels.index(id);
  const L = Object.fromEntries(['m1', 'm2', 'mf', 'rad', 'bead', 'src', 'earth', 'range', 'prl', 'cat', 'bns', 'race', 'scale'].map((k) => [k, ix(k)])) as Record<string, number>;

  const self: BlockScene = {
    id: 'results',
    status: 'measured',
    statusNote: 'Measured: masses, energy and distance from the published fits (catalogue medians; the 2016 values beside them). One bead is one solar mass; the orbit is the fitted model on the chirp’s clock.',
    labels,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      const [f, ph, amp] = await Promise.all([loadSeries('template-freq'), loadSeries('template-phase'), loadSeries('template-amp')]);
      trackT = { t0: GW150914.window.t0, fs: GW150914.window.fs, f, phase: ph, amp };
      binaryAt(trackT, { m1: GW150914.template.m1, m2: GW150914.template.m2 }, GW150914.clips['chirp-H1'].t0, bs);
      a0 = bs.a;
      for (let i = 0; i < NB; i++) {
        if (i < N1) fib(i, N1, off1[i]!).multiplyScalar(r1 * Math.cbrt((i + 1) / N1));
        else fib(i - N1, N2, off1[i]!).multiplyScalar(r2 * Math.cbrt((i - N1 + 1) / N2));
        if (i < NF) fib(i, NF, offF[i]!).multiplyScalar(rf * Math.cbrt((i + 1) / NF));
      }
      beads = createBeads(NB + PULSES * 2 + 2, { intensity: 0.75, minSize: 0.003 });
      for (let i = 0; i < NB; i++) beads.colour(i, PAL.bowl[0], PAL.bowl[1], PAL.bowl[2]);
      for (let i = NB; i < NB + PULSES; i++) beads.colour(i, PAL.both[0], PAL.both[1], PAL.both[2]);
      for (let i = NB + PULSES; i < NB + 2 * PULSES; i++) beads.colour(i, PAL.light[0], PAL.light[1], PAL.light[2]);
      beads.colour(NB + 2 * PULSES, PAL.earth[0], PAL.earth[1], PAL.earth[2]);
      beads.colour(NB + 2 * PULSES + 1, PAL.light[0], PAL.light[1], PAL.light[2]);
      scene.add(beads.mesh);
      ring = createGlowLine(129, PAL.both, { width: 0.012, intensity: 0 });
      scene.add(ring.mesh);
      // Distance lines (x along the line, to scale), ticks every 100 Mpc, the 90% range, the 2016 estimate.
      const specs: LineSpec[] = [
        { points: Float32Array.from([0, 0, D(dist), 0]), colour: PAL.edge, width: 1.4, intensity: 0.7 },
        { points: Float32Array.from([D(lo(E.distance)), 0, D(hi(E.distance)), 0]), colour: PAL.a, width: 4, intensity: 0.5 },
        { points: Float32Array.from([D(PRL.d), -0.25, D(PRL.d), 0.25]), colour: PAL.cool, width: 1.6, intensity: 0.8 },
        { points: Float32Array.from([D(dist) - D(BNS.d), params.bnsY, D(dist), params.bnsY]), colour: PAL.light, width: 1.6, intensity: 0.8 },
        { points: Float32Array.from([D(dist), 0, D(dist), params.bnsY]), colour: PAL.earth, width: 1.0, intensity: 0.5, dash: 0.12 },
      ];
      for (let m = 100; m < hi(E.distance); m += 100) specs.push({ points: Float32Array.from([D(m), -0.12, D(m), 0.12]), colour: PAL.edge, width: 1.2, intensity: 0.6 });
      lines = createLines(specs, { resolution: c.globals.uResolution });
      scene.add(lines.mesh);
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local: number, _dt: number, elapsed: number) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const ch = ctx.chirp;
      const ms = RES.masses(local);
      const tv = RES.travel(local);
      const bn = RES.bns(local);
      // ── Masses on the chirp's clock ──
      const t = ch.instance >= 0 ? ch.t : GW150914.clips['chirp-H1'].t0;
      binaryAt(trackT!, { m1: GW150914.template.m1, m2: GW150914.template.m2 }, Math.min(t, 0), bs);
      // Separation drawn ∝ a^(1/2) of Kepler's (the inspiral would otherwise sit still until the last instant).
      const sep = params.sep0 * Math.sqrt(bs.a / a0);
      const c = Math.cos(bs.orbitPhase);
      const s = Math.sin(bs.orbitPhase);
      const M = CAT.m1 + CAT.m2;
      const x1 = (sep * CAT.m2) / M;
      const x2 = (-sep * CAT.m1) / M;
      const merge = smoothstep(-0.006, 0.03, t);
      const spin = bs.orbitPhase;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const rr = t > 0 ? 0.25 + t * params.ringSpeed : 0;
      for (let i = 0; i < NB; i++) {
        const o = off1[i]!;
        const ox = o.x * cs - o.z * sn;
        const oz = o.x * sn + o.z * cs;
        const cx = i < N1 ? x1 : x2;
        let px = cx * c + ox;
        let py = o.y;
        let pz = cx * s + oz;
        let b = 1;
        if (i < NF) {
          const f = offF[i]!;
          const fx = f.x * cs - f.z * sn;
          const fz = f.x * sn + f.z * cs;
          px += (fx - px) * merge;
          py += (f.y - py) * merge;
          pz += (fz - pz) * merge;
        } else {
          const d = radDir[i - NF]!;
          const r = rr * merge;
          px += (d.x * r - px) * merge;
          pz += (d.z * r - pz) * merge;
          py *= 1 - merge;
          b = 1 + 1.6 * merge;
        }
        beads.set(i, px, py, pz, params.beadR, b * ms);
      }
      // The radiated ring.
      const ringOn = t > 0 ? ms * Math.max(0, 1 - t * 1.6) : 0;
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * Math.PI * 2;
        ring.set(k, Math.cos(a) * rr, 0, Math.sin(a) * rr);
      }
      ring.commit(ringOn > 0.001 ? 129 : 0);
      ring.intensity.value = 2.2 * ringOn;

      // ── Distances ──
      const travel = Math.min(1, Math.max(0, (local - 0.5) / 0.2));
      for (let p = 0; p < PULSES; p++) beads.set(NB + p, D(dist) * travel - p * 0.12, 0, 0, 0.07 - p * 0.015, tv * (1 - 0.3 * p) * (travel > 0 && travel < 1 ? 1.4 : 0.6));
      const race = RES.race(local);
      for (let p = 0; p < PULSES; p++) {
        // Gamma rays and the gravitational wave: drawn together (1.74 s in 130 million years is 4 × 10⁻¹⁶ of the trip).
        beads.set(NB + PULSES + p, D(dist) - D(BNS.d) * (1 - race) - p * 0.06, params.bnsY, 0, 0.05 - p * 0.012, bn * (1 - 0.3 * p));
      }
      beads.set(NB + 2 * PULSES, D(dist), 0, 0, 0.12, tv + bn);
      beads.set(NB + 2 * PULSES + 1, D(dist), params.bnsY, 0, 0.09, bn);
      beads.commit();
      const S = lines.state;
      S[0]!.intensity = tv + bn * 0.6;
      S[1]!.intensity = tv;
      S[2]!.intensity = tv;
      S[3]!.intensity = bn;
      S[3]!.to = Math.max(0.0001, race);
      S[4]!.intensity = bn;
      for (let i = 5; i < S.length; i++) S[i]!.intensity = tv + bn * 0.5;
      lines.commit();

      const portrait = rig.camera.aspect < 1;
      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local) * (portrait ? 1.6 : 1);
      pose.tx = params.tx(local);
      pose.tt = params.tt(local);
      pose.ty = 0;
      rig.apply(pose, reduced ? 0 : elapsed);
      rig.camera.updateMatrixWorld();

      // ── Labels ──
      const pre = 1 - merge;
      labels.place(L.m1!, x1 * c, r1 + 0.1, x1 * s, rig.camera, ms * pre);
      labels.place(L.m2!, x2 * c, r2 + 0.1, x2 * s, rig.camera, ms * pre);
      labels.place(L.mf!, 0, rf + 0.12, 0, rig.camera, ms * merge);
      labels.place(L.rad!, rr * 0.75, 0, rr * 0.66, rig.camera, ringOn > 0.05 ? ms : 0);
      labels.place(L.bead!, 0, -1.2, 0, rig.camera, ms);
      labels.place(L.src!, -0.3, 0, 0, rig.camera, tv);
      labels.place(L.earth!, D(dist) + 0.2, 0, 0, rig.camera, tv + bn);
      labels.place(L.range!, D((lo(E.distance) + hi(E.distance)) / 2), -0.15, 0, rig.camera, tv);
      labels.place(L.prl!, D(PRL.d), 0.3, 0, rig.camera, tv);
      labels.place(L.cat!, D(dist) * 0.45, 0.25, 0, rig.camera, tv);
      labels.place(L.bns!, D(dist) - D(BNS.d) - 0.2, params.bnsY, 0, rig.camera, bn);
      labels.place(L.race!, D(dist) - D(BNS.d) * 0.5, params.bnsY - 0.2, 0, rig.camera, bn * smoothstep(0.85, 0.95, race));
      labels.place(L.scale!, D(dist) * 0.5, params.bnsY - 1.2, 0, rig.camera, tv * 0.8 + bn * 0.8);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(width: number, height: number) {
      rig.resize(width, height);
    },
    dispose() {
      beads?.dispose();
      ring?.dispose();
      lines?.dispose();
    },
  };
  return self;
}
