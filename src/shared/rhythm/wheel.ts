// The wheel: concentric rings on one axle, one per layer, swept by one hand, every bead flashing as its hit is heard.
// The same object draws the Shapes view (each layer a polygon whose corners are its hits, inscribed in one circle,
// with a dot running its perimeter) and crossfades between the two (`mode`), with the beads sliding between their
// ring and the shared circle. See ./index.ts for the documented API.
//
// Geometry: local frame, rings in the x–y plane facing +z, the axle along z. Step j of n sits at angle
// θ = π/2 − 2π·j/n: the downbeat at 12 o'clock, clockwise as seen from +z, which is how the audio pans each hit
// (src/rhythm/sequencer.ts `spread`): right half of the ring = right ear. Keep the camera on the +z side.
// Time runs back along −z: a hit `a` bars ago sits a·barDepth behind its ring, so the trail is literally the past.

import { Group, Vector3 } from 'three/webgpu';
import type { MusicFrame } from '../../rhythm/frame.ts';
import { compile, MAX_LAYERS, type Compiled, type Section } from '../../rhythm/pattern.ts';
import { layerColour, PAL, type RGB } from '../gfx/palette.ts';
import type { Vec2Uniform } from '../../render/globals.ts';
import { createRhythmLines } from './lines.ts';
import { BEAD_FILLED, BEAD_HOLLOW, BEAD_PLAYHEAD, createBeads } from './beads.ts';

export type DrawMode = 'rings' | 'shapes';

/** Opacity of each part, 0–1. Values are smoothed (≈0.2 s), so scenes may set them abruptly or every frame. */
export interface WheelShow {
  /** Layer rings (and, in Shapes mode, layer polygons). */
  rings: number;
  /** Hit beads. */
  beads: number;
  /** Rests as hollow beads (Euclidean patterns). */
  rests: number;
  /** The hand. */
  hand: number;
  /** Spokes from the hub to each hit (rings mode). */
  spokes: number;
  /** Faint lines from each hit out to the composite/grid ring, showing which grid step it lands on (rings mode). */
  reach: number;
  /** Composite ring (union of hits on the LCM grid; Shapes: composite polygon). Polyrhythms only. */
  composite: number;
  /** Faint grid ring with lcm ticks (the composite's grid). */
  grid: number;
  /** Past bars receding along the axle: their hits as beads, each downbeat as a faint ring. */
  trail: number;
  /** The hand's path through the past: a helix per ring (rings mode, with the trail). */
  helix: number;
  /** The axle and hub. */
  axle: number;
  /** Per-layer playhead dots. */
  playheads: number;
}

export interface WheelOptions {
  /** ctx.globals.uResolution (line widths are in screen pixels). */
  resolution: Vec2Uniform;
  /** Rings the wheel can draw (default 8, at most 16). */
  maxLayers?: number;
  /** Radius of the first (outermost) layer ring (default 0.78). */
  firstRadius?: number;
  /** Radial gap between layer rings (default 0.2). */
  gap?: number;
  /** Explicit ring radii per layer (overrides firstRadius/gap). */
  radii?: readonly number[];
  /** Composite and grid ring radius (default 1). */
  compositeRadius?: number;
  /** Shapes mode: radius of the shared circle (default = compositeRadius). */
  shapeRadius?: number;
  /** Rings mode: each ring this much further back along the axle than the previous (default 0). */
  ringDz?: number;
  /** Shapes mode: each polygon this much further back (default 0.24); the composite polygon sits one step in front. */
  shapeDz?: number;
  /** Rings mode: z of the composite ring (default 0). */
  compositeZ?: number;
  /** Layer drawn as dots on the grid ring rather than as its own ring (e.g. a shaker on the LCM grid). Default −1. */
  gridLayer?: number;
  /** Bars kept in the trail (default 4, at most 8). */
  trailBars?: number;
  /** Distance along the axle per bar of trail (default 0.5). */
  barDepth?: number;
  /** Flash decay, seconds (default 0.17). */
  tau?: number;
  /** Bead size multiplier (default 1). */
  beadScale?: number;
  /** Line width multiplier (default 1). */
  lineScale?: number;
  /** Drawn (static, no flashes) when nothing playing is accepted. */
  fallback?: Section;
  /** Which playing sections this wheel draws (default: any). Others show the fallback with the live hand. */
  accept?: (c: Compiled) => boolean;
  /** Ring colours (default layerColour). */
  colour?: (layer: number) => RGB;
}

export interface WheelInfo {
  /** Bumps when the drawn structure changes (labels re-read). */
  revision: number;
  /** Layers in the drawn section. */
  layers: number;
  /** Steps per layer. */
  steps: Int32Array;
  /** Hits per layer. */
  hitCount: Int32Array;
  /** Composite grid (lcm of the ring layers' steps); 0 when not a polyrhythm. */
  grid: number;
  /** Composite hits: grid indices (first `compositeCount` entries). */
  composite: Int32Array;
  /** Grid steps from each composite hit to the next. */
  gaps: Int32Array;
  /** Layer bitmask per composite hit. */
  compositeMask: Int32Array;
  compositeCount: number;
}

export interface Wheel {
  /** Add to your scene; place and orient it freely (keep its +z towards the camera). */
  group: Group;
  /** Target draw mode; crossfades over ≈0.4 s. */
  mode: DrawMode;
  /** Target opacities (smoothed). */
  show: WheelShow;
  /** Per layer 0–1: brighter, bigger beads (e.g. "this one is the beat"). */
  emphasis: Float32Array;
  /** Per layer brightness multiplier (default 1). */
  dim: Float32Array;
  /** Per layer extra z (bring a ring forward, push one back). */
  lift: Float32Array;
  /** Reduced motion with sound: colour and opacity only, no scale pulses. */
  still: boolean;
  readonly info: WheelInfo;
  /** 0 = rings … 1 = shapes (eased), after the last update. */
  readonly modeMix: number;
  /** Call once per frame with ctx.music. */
  update(music: Readonly<MusicFrame>, dt: number): void;
  /** Replace the fallback section (e.g. follow the script when no music plays). Compiles are memoized. */
  setFallback(s: Section | null): void;
  /** Jump every smoothed value to its target (first frame, stills). */
  snap(): void;
  /** Smoothed visibility of layer i (0–1). */
  layerVisibility(i: number): number;
  /** World point on layer i's ring or shape circle at cycle phase, pushed out radially by dr. */
  layerPoint(i: number, phase: number, dr: number, out: Vector3): Vector3;
  /** World point on the composite ring at bar phase, pushed out by dr. */
  compositePoint(phase: number, dr: number, out: Vector3): Vector3;
  /** World point of layer i's playhead (on its ring, or on its polygon in Shapes mode). */
  playheadPoint(i: number, out: Vector3): Vector3;
  /** World point of the hub (axle centre at z), e.g. for a label. */
  axlePoint(z: number, out: Vector3): Vector3;
  dispose(): void;
}

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const MAX_STEPS = 128;
const REC = 8;
const WHITE: RGB = PAL.both;
const COMP: RGB = [1.0, 0.9, 0.78];
const GRID: RGB = [0.5, 0.56, 0.78];
const AXLE: RGB = [0.62, 0.66, 0.9];
const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const sstep = (a: number, b: number, x: number) => smooth01((x - a) / (b - a));
const angleOf = (phase: number) => HALF_PI - TAU * phase;

export function createWheel(o: WheelOptions): Wheel {
  const ML = Math.min(MAX_LAYERS, Math.max(1, o.maxLayers ?? 8));
  const N = Math.min(8, Math.max(1, o.trailBars ?? 4));
  const firstR = o.firstRadius ?? 0.78;
  const gap = o.gap ?? 0.2;
  const compR = o.compositeRadius ?? 1;
  const shapeR = o.shapeRadius ?? compR;
  const ringDz = o.ringDz ?? 0;
  const shapeDz = o.shapeDz ?? 0.24;
  const compZ = o.compositeZ ?? 0;
  const gridLayer = o.gridLayer ?? -1;
  const barDepth = o.barDepth ?? 0.5;
  const tau = o.tau ?? 0.17;
  const beadK = o.beadScale ?? 1;
  const lineK = o.lineScale ?? 1;
  const colourOf = o.colour ?? layerColour;
  const ringR = (i: number) => o.radii?.[i] ?? firstR - i * gap;
  let fallbackC = o.fallback ? compile(o.fallback) : null;

  const group = new Group();
  // Slots of the static batch.
  const S_RING = 0;
  const S_POLY = ML;
  const S_SPOKE = 2 * ML;
  const S_HELIX = 3 * ML;
  const S_HAND = 4 * ML;
  const S_AXLE = S_HAND + 1;
  const S_GRID = S_HAND + 2;
  const S_ARCS = S_HAND + 3;
  const S_CPOLY = S_HAND + 4;
  const S_CRING = S_HAND + 5;
  const S_HUB = S_HAND + 6;
  const S_BAR = S_HAND + 8;
  const S_REACH = S_BAR + N;
  const lines = createRhythmLines({ resolution: o.resolution, capacity: 2048 + ML * 900, slots: S_REACH + ML + 1 });
  const trails = createRhythmLines({ resolution: o.resolution, capacity: 64 + ML * (N * 40 + 4), slots: ML + 2 });
  const beads = createBeads(64 + ML * (MAX_STEPS / 2) * (N + 2));
  group.add(lines.mesh, trails.mesh, beads.mesh);
  lines.mesh.renderOrder = 10;
  trails.mesh.renderOrder = 10;

  const show: WheelShow = { rings: 1, beads: 1, rests: 1, hand: 1, spokes: 0.6, reach: 0, composite: 0, grid: 0, trail: 0, helix: 0, axle: 1, playheads: 1 };
  const cur: WheelShow = { ...show };
  const keys = Object.keys(show) as (keyof WheelShow)[];
  const emphasis = new Float32Array(ML);
  const dim = new Float32Array(ML).fill(1);
  const lift = new Float32Array(ML);
  const vis = new Float32Array(ML);
  const emph = new Float32Array(ML);
  const ringFlash = new Float32Array(ML);

  // ── Structure of the drawn section ──
  let C: Compiled | null = null;
  let L = 0;
  const steps = new Int32Array(ML);
  const hitCount = new Int32Array(ML);
  const hitList: Int16Array[] = Array.from({ length: ML }, () => new Int16Array(MAX_STEPS));
  const span1 = new Uint8Array(ML);
  let polyOK = false;
  let G = 0;
  const comp = new Int32Array(MAX_STEPS * 2);
  const compMask = new Int32Array(MAX_STEPS * 2);
  const gaps = new Int32Array(MAX_STEPS * 2);
  let compN = 0;
  const gridMark = new Uint8Array(MAX_STEPS * 2);
  const info: WheelInfo = { revision: 0, layers: 0, steps, hitCount, grid: 0, composite: comp, gaps, compositeMask: compMask, compositeCount: 0 };

  const isRing = (i: number) => i !== gridLayer && i < ML;

  const rebuild = (c: Compiled | null) => {
    C = c;
    L = c ? Math.min(ML, c.steps.length) : 0;
    polyOK = !!c;
    G = 1;
    for (let i = 0; i < ML; i++) {
      steps[i] = 0;
      hitCount[i] = 0;
      span1[i] = 0;
      if (!c || i >= L) continue;
      const n = Math.min(MAX_STEPS, c.steps[i]!);
      steps[i] = n;
      span1[i] = c.cycleTicks[i] === c.G ? 1 : 0;
      const h = c.section.layers[i]!.hits;
      let k = 0;
      for (let j = 0; j < n; j++) if (h[j]) hitList[i]![k++] = j;
      hitCount[i] = k;
      if (isRing(i)) {
        if (!span1[i]) polyOK = false;
        else G = lcmInt(G, n);
      }
    }
    if (G > MAX_STEPS * 2) polyOK = false;
    // Composite: the union of the ring layers' hits on the lcm grid.
    compN = 0;
    if (polyOK && c) {
      for (let g = 0; g < G; g++) {
        let m = 0;
        for (let i = 0; i < L; i++) {
          if (!isRing(i)) continue;
          const n = steps[i]!;
          if ((g * n) % G !== 0) continue;
          if (c.section.layers[i]!.hits[(g * n) / G]) m |= 1 << i;
        }
        gridMark[g] = m ? 1 : 0;
        if (m) {
          comp[compN] = g;
          compMask[compN] = m;
          compN++;
        }
      }
      for (let k = 0; k < compN; k++) gaps[k] = (k + 1 < compN ? comp[k + 1]! : comp[0]! + G) - comp[k]!;
    }
    info.layers = L;
    info.grid = polyOK ? G : 0;
    info.compositeCount = compN;
    info.revision++;
    writeStatic();
  };

  const circle = (slot: number, colour: RGB, width: number, segs = 160) => {
    lines.begin(slot, colour, width * lineK, true);
    for (let s = 0; s < segs; s++) {
      const u = s / segs;
      const a = angleOf(u);
      lines.point(Math.cos(a), Math.sin(a), 0, u);
    }
    lines.end();
  };

  /** Polygon through the given step positions (fractions of the cycle), sides subdivided so u follows time. */
  const polygon = (slot: number, colour: RGB, width: number, at: (k: number) => number, count: number) => {
    if (count < 2) return;
    lines.begin(slot, colour, width * lineK, true);
    for (let k = 0; k < count; k++) {
      const u0 = at(k);
      let u1 = k + 1 < count ? at(k + 1) : at(0) + 1;
      if (u1 <= u0) u1 += 1;
      const a0 = angleOf(u0);
      const a1 = angleOf(u1);
      const x0 = Math.cos(a0);
      const y0 = Math.sin(a0);
      const x1 = Math.cos(a1);
      const y1 = Math.sin(a1);
      const sub = 10;
      for (let s = 0; s < sub; s++) {
        const f = s / sub;
        lines.point(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, 0, u0 + (u1 - u0) * f);
      }
    }
    lines.end();
  };

  const writeStatic = () => {
    lines.clear();
    const c = C;
    for (let i = 0; i < L && c; i++) {
      if (!isRing(i)) continue;
      const col = colourOf(i);
      const n = steps[i]!;
      circle(S_RING + i, col, 2.2);
      const hl = hitList[i]!;
      polygon(S_POLY + i, col, 2.6, (k) => hl[k]! / n, hitCount[i]!);
      // Spokes from the hub to each hit (inner end at 0.12 of the ring radius).
      for (let k = 0; k < hitCount[i]!; k++) {
        const u = hl[k]! / n;
        const a = angleOf(u);
        lines.begin(S_SPOKE + i, col, 1.3 * lineK);
        lines.point(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0, u);
        lines.point(Math.cos(a) * 0.93, Math.sin(a) * 0.93, 0, u);
        lines.end();
      }
      // The trail helix: the hand's path through the past, one turn per layer cycle, u = turns ago / N.
      lines.begin(S_HELIX + i, col, 1.5 * lineK);
      const segs = 120 * N;
      for (let s = 0; s <= segs; s++) {
        const t = (s / segs) * N;
        const a = HALF_PI + TAU * t;
        lines.point(Math.cos(a), Math.sin(a), -t, t / N);
      }
      lines.end();
    }
    // Hand: along +y from the hub, rotated by −2π·phase.
    lines.begin(S_HAND, [1, 0.96, 0.9], 2.4 * lineK);
    lines.point(0, 0.04, 0, 0);
    lines.point(0, 1, 0, 1);
    lines.end();
    // Axle: from just in front of the rings back through the trail (data z in bars).
    lines.begin(S_AXLE, AXLE, 1.4 * lineK);
    lines.point(0, 0, 0.6, 0);
    lines.point(0, 0, -N, 1);
    lines.end();
    circle(S_HUB, AXLE, 1.6, 48);
    if (polyOK && compN > 0) {
      // Grid: a faint ring with a tick per grid step.
      circle(S_GRID, GRID, 1.2);
      for (let g = 0; g < G; g++) {
        const u = g / G;
        const a = angleOf(u);
        lines.begin(S_GRID, GRID, 1.2 * lineK);
        lines.point(Math.cos(a) * 1.035, Math.sin(a) * 1.035, 0, u);
        lines.point(Math.cos(a) * 1.075, Math.sin(a) * 1.075, 0, u);
        lines.end();
      }
      // Composite: arcs from hit to hit, leaving room for the beads, so each gap reads as a length.
      for (let k = 0; k < compN; k++) {
        const u0 = comp[k]! / G;
        const u1 = u0 + gaps[k]! / G;
        const pad = Math.min(0.035, (u1 - u0) * 0.22);
        const a0 = u0 + pad;
        const a1 = u1 - pad;
        const segs = Math.max(4, Math.ceil((a1 - a0) * 140));
        lines.begin(S_ARCS, COMP, 2.0 * lineK);
        for (let s = 0; s <= segs; s++) {
          const u = a0 + ((a1 - a0) * s) / segs;
          const a = angleOf(u);
          lines.point(Math.cos(a), Math.sin(a), 0, u);
        }
        lines.end();
      }
      polygon(S_CPOLY, COMP, 2.4, (k) => comp[k]! / G, compN);
      circle(S_CRING, GRID, 1.2);
    }
    for (let m = 0; m < N; m++) circle(S_BAR + m, AXLE, 1.1, 120);
    // Reach lines: from just outside each hit of ring i to the composite ring (unit = composite radius).
    if (polyOK && compN > 0 && c) {
      for (let i = 0; i < L; i++) {
        if (!isRing(i)) continue;
        const n = steps[i]!;
        const r0 = (ringR(i) + 0.06) / compR;
        if (r0 >= 0.97) continue;
        for (let k = 0; k < hitCount[i]!; k++) {
          const u = hitList[i]![k]! / n;
          const a = angleOf(u);
          lines.begin(S_REACH + i, colourOf(i), 1.1 * lineK);
          const seg = 14;
          for (let q = 0; q <= seg; q++) {
            const r = r0 + ((0.97 - r0) * q) / seg;
            lines.point(Math.cos(a) * r, Math.sin(a) * r, 0, u, 0.35 + 0.65 * (q / seg));
          }
          lines.end();
        }
      }
    }
    lines.upload();
  };

  let first = true;
  let mode: DrawMode = 'rings';
  let mT = 0; // linear 0–1 towards shapes
  let mE = 0; // eased
  let phase = 0;
  let pos = 0;

  // History of what played (entries copied by value: the timeline recycles its objects).
  const recAt = new Float64Array(REC);
  const recEnd = new Float64Array(REC);
  const recAnchor = new Float64Array(REC);
  const recMask = new Int32Array(REC);
  const recC: (Compiled | null)[] = new Array<Compiled | null>(REC).fill(null);
  let recN = 0;
  let recHead = -1;

  const pushRecord = (atPos: number, anchor: number, c: Compiled, mask: number) => {
    if (recN > 0) recEnd[recHead] = atPos;
    recHead = (recHead + 1) % REC;
    recAt[recHead] = atPos;
    recAnchor[recHead] = anchor;
    recEnd[recHead] = Infinity;
    recMask[recHead] = mask;
    recC[recHead] = c;
    recN = Math.min(REC, recN + 1);
  };

  // Per-frame music view (either the frame or the fallback).
  const mOn = new Uint8Array(ML);
  const mPhase = new Float64Array(ML);
  const mAge = new Float64Array(ML).fill(Infinity);
  const mStep = new Int32Array(ML);
  const mRate = new Float64Array(ML);
  let entryAt = 0;
  let live = false;

  const rho = (i: number) => ringR(i) + (shapeR - ringR(i)) * mE;
  const zOf = (i: number) => -i * ringDz + (ringDz - shapeDz) * i * mE + lift[i]!;
  const compRho = () => compR + (shapeR - compR) * mE;
  const compZOf = () => compZ + (shapeDz - compZ) * mE;

  /** Seconds since layer i last hit step j (Infinity if not in this section). */
  const ageOf = (i: number, j: number): number => {
    const a0 = mAge[i]!;
    if (!live || !Number.isFinite(a0) || !mOn[i]) return Infinity;
    if (j === mStep[i]) return a0;
    const n = steps[i]!;
    const sp = mPhase[i]! * n;
    let d = sp - j;
    if (d < 0) d += n;
    const age = d / Math.max(1e-6, mRate[i]!);
    if (age < a0) return Infinity;
    // Before this section started?
    if (C && pos - (d * C.tickStep[i]!) / C.G < entryAt - 1e-9) return Infinity;
    return age;
  };

  /** Playhead of layer i on its polygon (unit circle), written to px/py. */
  let px = 0;
  let py = 0;
  const polyPoint = (hl: Int16Array, count: number, n: number, ph: number) => {
    if (count === 0) {
      const a = angleOf(ph);
      px = Math.cos(a);
      py = Math.sin(a);
      return;
    }
    const sp = ph * n;
    // Last hit at or before sp (cyclic).
    let k = count - 1;
    for (let q = 0; q < count; q++) if (hl[q]! <= sp + 1e-9) k = q;
    const h0 = hl[k]!;
    const h1 = k + 1 < count ? hl[k + 1]! : hl[0]! + n;
    let d = sp - h0;
    if (d < 0) d += n;
    const f = Math.min(1, d / Math.max(1e-9, h1 - h0));
    const a0 = angleOf(h0 / n);
    const a1 = angleOf(h1 / n);
    px = Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * f;
    py = Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * f;
  };

  const toWorld = (x: number, y: number, z: number, out: Vector3) => {
    group.updateWorldMatrix(true, false);
    return out.set(x, y, z).applyMatrix4(group.matrixWorld);
  };

  const self: Wheel = {
    group,
    get mode() {
      return mode;
    },
    set mode(m: DrawMode) {
      mode = m;
    },
    show,
    emphasis,
    dim,
    lift,
    still: false,
    info,
    get modeMix() {
      return mE;
    },
    snap() {
      for (let q = 0; q < keys.length; q++) cur[keys[q]!] = show[keys[q]!];
      mT = mode === 'shapes' ? 1 : 0;
      mE = smooth01(mT);
      for (let i = 0; i < ML; i++) {
        emph[i] = emphasis[i]!;
        vis[i] = i < L && (mOn[i] || !live) ? 1 : 0;
      }
    },
    layerVisibility: (i) => vis[i] ?? 0,
    setFallback(s) {
      fallbackC = s ? compile(s) : null;
    },
    layerPoint(i, ph, dr, out) {
      const a = angleOf(ph);
      const r = rho(i) + dr;
      return toWorld(Math.cos(a) * r, Math.sin(a) * r, zOf(i), out);
    },
    compositePoint(ph, dr, out) {
      const a = angleOf(ph);
      const r = compRho() + dr;
      return toWorld(Math.cos(a) * r, Math.sin(a) * r, compZOf(), out);
    },
    playheadPoint(i, out) {
      const a = angleOf(mPhase[i]!);
      polyPoint(hitList[i]!, hitCount[i]!, Math.max(1, steps[i]!), mPhase[i]!);
      const r = rho(i);
      const x = Math.cos(a) + (px - Math.cos(a)) * mE;
      const y = Math.sin(a) + (py - Math.sin(a)) * mE;
      return toWorld(x * r, y * r, zOf(i), out);
    },
    axlePoint(z, out) {
      return toWorld(0, 0, z, out);
    },

    update(music, dt) {
      // ── What to draw ──
      const e = music.entry;
      const ec = e?.c ?? null;
      const ok = !!ec && music.running && (!o.accept || o.accept(ec));
      const c = ok ? ec : fallbackC;
      live = ok;
      if (c !== C) rebuild(c);
      pos = music.pos;
      phase = live ? music.phase : music.running ? music.phase : 0;
      entryAt = e?.atPos ?? 0;
      for (let i = 0; i < ML; i++) {
        if (live && i < music.layers) {
          mOn[i] = music.layerOn[i]!;
          mPhase[i] = music.layerPhase[i]!;
          mAge[i] = music.onsetAge[i]!;
          mStep[i] = music.onsetStep[i]!;
          mRate[i] = music.layerRate[i]!;
        } else {
          mOn[i] = i < L ? 1 : 0;
          mPhase[i] = phase;
          mAge[i] = Infinity;
          mStep[i] = -1;
          mRate[i] = 0;
        }
      }
      if (live && e && ec) {
        const h = recHead;
        if (recN === 0 || e.atPos < recAt[h]! - 1e-9) {
          recN = 0;
          recHead = -1;
          pushRecord(e.atPos, e.anchor, ec, e.mask);
        } else if (Math.abs(e.atPos - recAt[h]!) > 1e-9 || recC[h] !== ec || recMask[h] !== e.mask) {
          if (Math.abs(e.atPos - recAt[h]!) <= 1e-9) {
            recC[h] = ec;
            recMask[h] = e.mask;
            recAnchor[h] = e.anchor;
          } else pushRecord(e.atPos, e.anchor, ec, e.mask);
        }
      }

      // ── Smoothing ──
      // First frame, and held frames (reduced motion, dt = 0): show the targets at once.
      if (first || dt <= 0) {
        first = false;
        self.snap();
      }
      const kS = 1 - Math.exp(-dt / 0.2);
      for (let q = 0; q < keys.length; q++) {
        const k = keys[q]!;
        cur[k] += (show[k] - cur[k]) * kS;
      }
      const target = mode === 'shapes' ? 1 : 0;
      const stepM = dt / 0.4;
      mT = target > mT ? Math.min(target, mT + stepM) : Math.max(target, mT - stepM);
      mE = smooth01(mT);
      const kV = 1 - Math.exp(-dt / 0.15);
      for (let i = 0; i < ML; i++) {
        const want = i < L && isRing(i) ? (mOn[i] ? (live ? Math.max(0.2, music.layerGain[i]!) : 1) : 0) : 0;
        vis[i] = vis[i]! + (want - vis[i]!) * kV;
        emph[i] = emph[i]! + (emphasis[i]! - emph[i]!) * kS;
      }

      // ── Lines ──
      const sl = lines.slots;
      const mR = 1 - mE;
      for (let i = 0; i < ML; i++) {
        const ring = sl[S_RING + i]!;
        const poly = sl[S_POLY + i]!;
        const spoke = sl[S_SPOKE + i]!;
        const helix = sl[S_HELIX + i]!;
        const v = vis[i]! * dim[i]!;
        if (i >= L || !isRing(i) || v < 0.002) {
          ring.intensity = poly.intensity = spoke.intensity = helix.intensity = 0;
          continue;
        }
        const r = rho(i);
        const z = zOf(i);
        const fast = sstep(7, 12, mRate[i]!);
        const fl = Math.exp(-mAge[i]! / tau) * (1 - fast);
        ringFlash[i] = fl;
        const em = 1 + emph[i]! * 0.9;
        ring.scale = r;
        ring.z = z;
        ring.intensity = cur.rings * v * (0.36 * mR + 0.12 * mE) * (1 + emph[i]! * 0.45) * (1 + fl * 0.6);
        // Afterglow lasts ≈0.2 s whatever the tempo: a glint when slow, a continuous blur when fast.
        const cyc = mRate[i]! / Math.max(1, steps[i]!);
        const decay = cyc > 0 ? Math.min(40, Math.max(2.5, 1 / (cyc * 0.2))) : 12;
        ring.sweepPhase = mPhase[i]!;
        ring.sweepGain = 1.8 * mR + 0.5 * mE;
        ring.sweepDecay = decay;
        poly.scale = r;
        poly.z = z;
        poly.intensity = cur.rings * v * mE * (hitCount[i] === 2 ? 0.45 : 0.68) * em * (1 + fl * 0.4);
        poly.sweepPhase = mPhase[i]!;
        poly.sweepGain = (hitCount[i] === 2 ? 1.2 : 2.4) * (1 - fast);
        poly.sweepDecay = decay;
        spoke.scale = r;
        spoke.z = z;
        spoke.intensity = cur.spokes * v * mR * 0.16 * em;
        spoke.sweepPhase = mPhase[i]!;
        spoke.sweepGain = 5 * (1 - fast);
        spoke.sweepDecay = decay;
        helix.scale = r;
        helix.z = z;
        helix.rot = -TAU * mPhase[i]!;
        helix.zScale = barDepth * (C && i < L ? C.cycleTicks[i]! / C.G : 1);
        helix.intensity = cur.trail * cur.helix * v * mR * 0.2;
        helix.fade = 3.2;
      }
      const hand = sl[S_HAND]!;
      hand.rot = -TAU * phase;
      let outer = 0.2;
      for (let i = 0; i < L; i++) if (isRing(i) && vis[i]! > 0.05) outer = Math.max(outer, rho(i));
      if (polyOK && compN > 0) outer += (Math.max(outer, compRho()) - outer) * Math.max(cur.composite, cur.grid);
      hand.scale = outer + 0.09;
      hand.z = Math.max(compZOf(), zOf(0)) + 0.002;
      hand.intensity = cur.hand * (0.95 - 0.45 * mE);
      hand.fade = -0.6;
      const axle = sl[S_AXLE]!;
      axle.zScale = barDepth * Math.max(0.15, cur.trail);
      axle.intensity = cur.axle * 0.28;
      axle.fade = 1.8;
      const hub = sl[S_HUB]!;
      hub.scale = 0.045;
      hub.z = 0;
      hub.intensity = cur.axle * 0.5;
      const showComp = polyOK && compN > 0 ? 1 : 0;
      const grid = sl[S_GRID]!;
      grid.scale = compRho();
      grid.z = compZOf();
      grid.intensity = showComp * cur.grid * 0.32 * (1 - 0.5 * mE);
      grid.sweepPhase = phase;
      grid.sweepGain = 2;
      const arcs = sl[S_ARCS]!;
      arcs.scale = compRho();
      arcs.z = compZOf();
      arcs.intensity = showComp * cur.composite * 0.42 * mR;
      arcs.sweepPhase = phase;
      arcs.sweepGain = 2.2;
      const cpoly = sl[S_CPOLY]!;
      cpoly.scale = compRho();
      cpoly.z = compZOf();
      cpoly.intensity = showComp * cur.composite * 0.62 * mE;
      cpoly.sweepPhase = phase;
      cpoly.sweepGain = 2.4;
      const cring = sl[S_CRING]!;
      cring.scale = compRho();
      cring.z = compZOf();
      cring.intensity = showComp * cur.composite * 0.14 * mE;
      for (let m = 0; m < N; m++) {
        const b = sl[S_BAR + m]!;
        const ago = m + phase;
        b.scale = showComp && (cur.composite > 0.01 || cur.grid > 0.01) ? compRho() : rho(0);
        b.z = -ago * barDepth;
        b.intensity = cur.trail * 0.16 * Math.exp(-ago * 0.5) * sstep(0, 0.12, ago) * (1 - 0.55 * mE);
      }
      for (let i = 0; i < ML; i++) {
        const rs = sl[S_REACH + i]!;
        rs.scale = compRho();
        rs.z = compZOf();
        rs.intensity = i < L && isRing(i) ? showComp * cur.reach * vis[i]! * dim[i]! * mR * 0.32 : 0;
        rs.sweepPhase = mPhase[i]!;
        rs.sweepGain = 3;
      }
      lines.commit();

      // ── Beads ──
      let b = 0;
      const still = self.still;
      for (let i = 0; i < L && C; i++) {
        if (!isRing(i)) continue;
        const v = vis[i]! * dim[i]!;
        if (v < 0.003) continue;
        const col = colourOf(i);
        const n = steps[i]!;
        const r = rho(i);
        const z = zOf(i);
        const fast = sstep(7, 12, mRate[i]!);
        const em = emph[i]!;
        const h = C.section.layers[i]!.hits;
        const lastStep = mStep[i]!;
        // A coincident hit flashes white: another layer's latest hit landed at the same instant.
        let together = 0;
        const a0 = mAge[i]!;
        if (Number.isFinite(a0)) {
          for (let k = 0; k < L; k++) {
            if (k === i || k === gridLayer || !mOn[k]) continue;
            if (Math.abs(mAge[k]! - a0) < 0.002) together = 1;
          }
        }
        for (let j = 0; j < n; j++) {
          const a = angleOf(j / n);
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (h[j]) {
            const acc = h[j] === 2;
            const age = ageOf(i, j);
            const f = Number.isFinite(age) ? Math.exp(-age / tau) * (1 - fast) : 0;
            const w = j === lastStep ? together * f : 0;
            const base = (acc ? 0.72 : 0.58) * (1 + fast * 0.8) * (1 + em * 0.8);
            const br = cur.beads * (v * base + f * (acc ? 5 : 3.6) * (mOn[i] ? 1 : v) * (1 + em * 0.4));
            const rad = beadK * (acc ? 0.064 : 0.056) * (1 + em * 0.25) * (still ? 1 : 1 + 0.45 * f);
            b = beads.set(b, x, y, z, rad, col[0] + (WHITE[0] - col[0]) * w, col[1] + (WHITE[1] - col[1]) * w, col[2] + (WHITE[2] - col[2]) * w, br, BEAD_FILLED);
          } else if (cur.rests > 0.003) {
            b = beads.set(b, x, y, z, beadK * 0.045, col[0], col[1], col[2], cur.rests * v * 0.55, BEAD_HOLLOW);
          }
        }
        // Ripple: a halo spreading from the latest hit (scale motion: off with reduced motion).
        if (!still && cur.beads > 0.003 && lastStep >= 0 && lastStep < n && Number.isFinite(a0) && a0 < 0.5) {
          const a = angleOf(lastStep / n);
          const amp = Math.exp(-a0 / 0.16) * (1 - a0 / 0.5) * (1 - fast) * (h[lastStep] === 2 ? 1.25 : 1);
          const w = together;
          b = beads.set(
            b,
            Math.cos(a) * r,
            Math.sin(a) * r,
            z,
            beadK * (0.07 + a0 * 0.5),
            col[0] + (WHITE[0] - col[0]) * w,
            col[1] + (WHITE[1] - col[1]) * w,
            col[2] + (WHITE[2] - col[2]) * w,
            cur.beads * (mOn[i] ? 1 : v) * 1.3 * amp,
            BEAD_HOLLOW,
          );
        }
        // Playhead: where the hand crosses the ring; in Shapes mode the dot running the perimeter.
        if (cur.playheads > 0.003) {
          const ph = mPhase[i]!;
          const a = angleOf(ph);
          polyPoint(hitList[i]!, hitCount[i]!, n, ph);
          const x = (Math.cos(a) + (px - Math.cos(a)) * mE) * r;
          const y = (Math.sin(a) + (py - Math.sin(a)) * mE) * r;
          const br = cur.playheads * v * (0.45 + 1.1 * mE) * (1 + em * 0.5) * (1 - fast * 0.7);
          b = beads.set(b, x, y, z, beadK * (0.04 + 0.016 * mE), 0.5 + col[0] * 0.5, 0.5 + col[1] * 0.5, 0.5 + col[2] * 0.5, br, BEAD_PLAYHEAD);
        }
      }
      // Composite beads and the grid's dots.
      if (polyOK && compN > 0 && C && (cur.composite > 0.003 || cur.grid > 0.003)) {
        const r = compRho();
        const z = compZOf();
        if (cur.grid > 0.003) {
          for (let g = 0; g < G; g++) {
            if (gridMark[g] && cur.composite > 0.5) continue;
            const a = angleOf(g / G);
            let f = 0;
            if (gridLayer >= 0 && gridLayer < L && steps[gridLayer]! > 0) {
              const ng = steps[gridLayer]!;
              if ((g * ng) % G === 0) {
                const age = ageOf(gridLayer, (g * ng) / G);
                if (Number.isFinite(age)) f = Math.exp(-age / (tau * 0.8));
              }
            }
            b = beads.set(b, Math.cos(a) * r, Math.sin(a) * r, z, beadK * 0.026 * (still ? 1 : 1 + 0.4 * f), GRID[0], GRID[1], GRID[2], cur.grid * (0.4 + f * 2.2), BEAD_FILLED);
          }
        }
        if (cur.composite > 0.003) {
          for (let k = 0; k < compN; k++) {
            const g = comp[k]!;
            const m = compMask[k]!;
            const a = angleOf(g / G);
            let f = 0;
            let cr = 0;
            let cg = 0;
            let cb = 0;
            let nl = 0;
            for (let i = 0; i < L; i++) {
              if (!(m & (1 << i)) || !mOn[i]) continue;
              const ci = colourOf(i);
              cr += ci[0];
              cg += ci[1];
              cb += ci[2];
              nl++;
              const age = ageOf(i, (g * steps[i]!) / G);
              if (Number.isFinite(age)) f = Math.max(f, Math.exp(-age / tau));
            }
            if (nl === 0) continue;
            if (nl > 1) {
              cr = WHITE[0];
              cg = WHITE[1];
              cb = WHITE[2];
            } else {
              cr /= nl;
              cg /= nl;
              cb /= nl;
            }
            const br = cur.composite * (0.62 + f * 4);
            b = beads.set(b, Math.cos(a) * r, Math.sin(a) * r, z, beadK * (nl > 1 ? 0.062 : 0.054) * (still ? 1 : 1 + 0.45 * f), cr, cg, cb, br, BEAD_FILLED);
          }
          if (mE > 0.01 && cur.playheads > 0.003) {
            const ph = phase;
            // Composite dot on the composite polygon.
            const sp = ph * G;
            let k = compN - 1;
            for (let q = 0; q < compN; q++) if (comp[q]! <= sp + 1e-9) k = q;
            const g0 = comp[k]!;
            const g1 = k + 1 < compN ? comp[k + 1]! : comp[0]! + G;
            let d = sp - g0;
            if (d < 0) d += G;
            const f = Math.min(1, d / Math.max(1e-9, g1 - g0));
            const a0 = angleOf(g0 / G);
            const a1 = angleOf(g1 / G);
            const x = (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * f) * r;
            const y = (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * f) * r;
            b = beads.set(b, x, y, z, beadK * 0.056, 1, 0.97, 0.92, cur.composite * cur.playheads * mE * 1.5, BEAD_PLAYHEAD);
          }
        }
      }
      // ── Trail: hits of the last N bars. Rings mode: each `ago` bars behind its ring (time runs down the axle).
      // Shapes mode: each finished bar's polygon peels off the live one at the downbeat and recedes, one plane per bar,
      // with its corners on it.
      trails.clear();
      if (cur.trail > 0.003 && live && recN > 0) {
        const barNow = pos - phase;
        for (let i = 0; i < ML; i++) {
          if (!isRing(i) || i >= L) continue;
          const v = vis[i]! * dim[i]!;
          if (v < 0.003) continue;
          const col = colourOf(i);
          const r = rho(i);
          const z0 = zOf(i);
          for (let q = recN - 1; q >= 0; q--) {
            const ri = (recHead - q + REC * 2) % REC;
            const rc = recC[ri];
            if (!rc || i >= rc.steps.length || !((recMask[ri]! >> i) & 1)) continue;
            const lo = Math.max(recAt[ri]!, pos - N);
            const hi = Math.min(recEnd[ri]!, pos);
            if (hi <= lo) continue;
            const ts = rc.tickStep[i]!;
            const Gc = rc.G;
            const n = rc.steps[i]!;
            const anchor = recAnchor[ri]!;
            const hits = rc.section.layers[i]!.hits;
            const kLo = Math.ceil(((lo - anchor) * Gc) / ts - 1e-9);
            const kHi = Math.ceil(((hi - anchor) * Gc) / ts - 1e-9) - 1;
            for (let k = kLo; k <= kHi; k++) {
              const j = ((k % n) + n) % n;
              if (!hits[j]) continue;
              const hp = anchor + (k * ts) / Gc;
              const ago = pos - hp;
              if (ago <= 0) continue;
              // The bar this hit belongs to ended `endAgo` bars ago (negative: the bar now playing).
              const endAgo = pos - (anchor + Math.floor(hp - anchor + 1e-9) + 1);
              const a = angleOf(j / n);
              const x = Math.cos(a) * r;
              const y = Math.sin(a) * r;
              const zr = -ago * barDepth;
              const zs = -Math.max(0, endAgo) * barDepth;
              const zz = z0 + zr + (zs - zr) * mE;
              const fr = Math.exp((-ago / N) * 2.6) * sstep(0, 0.04, ago);
              const fs = endAgo >= 0 ? Math.exp((-endAgo / N) * 2.6) * sstep(0, 0.06, endAgo) : 0;
              const fadeK = fr + (fs - fr) * mE;
              if (fadeK < 0.004) continue;
              // Coincidence in that bar: another ring layer of the same record hits the same tick.
              let tg = 0;
              const tick = k * ts;
              for (let l = 0; l < rc.steps.length && l < ML; l++) {
                if (l === i || !isRing(l) || !((recMask[ri]! >> l) & 1)) continue;
                const tl = rc.tickStep[l]!;
                if (tick % tl === 0 && rc.section.layers[l]!.hits[((tick / tl) % rc.steps[l]!) | 0]) tg = 1;
              }
              const cr = col[0] + (WHITE[0] - col[0]) * tg * 0.7;
              const cg = col[1] + (WHITE[1] - col[1]) * tg * 0.7;
              const cb = col[2] + (WHITE[2] - col[2]) * tg * 0.7;
              b = beads.set(b, x, y, zz, beadK * 0.04, cr, cg, cb, cur.trail * v * 0.62 * fadeK, BEAD_FILLED);
            }
          }
          // Shapes: one ghost polygon per finished bar, from the pattern that bar played.
          if (mE > 0.01) {
            for (let m = 1; m <= N; m++) {
              const bs = barNow - m;
              const endAgo = phase + m - 1;
              let ri = -1;
              for (let q = 0; q < recN; q++) {
                const rq = (recHead - q + REC * 2) % REC;
                if (bs >= recAt[rq]! - 1e-9 && bs < recEnd[rq]! - 1e-9) {
                  ri = rq;
                  break;
                }
              }
              if (ri < 0) continue;
              const rc = recC[ri];
              if (!rc || i >= rc.steps.length || !((recMask[ri]! >> i) & 1) || rc.cycleTicks[i] !== rc.G) continue;
              const n = rc.steps[i]!;
              const hits = rc.section.layers[i]!.hits;
              const kb = Math.exp((-endAgo / N) * 2.6) * sstep(0, 0.06, endAgo);
              if (kb < 0.01) continue;
              const zz = z0 - endAgo * barDepth;
              let count = 0;
              for (let j = 0; j < n; j++) if (hits[j]) count++;
              if (count < 2) continue;
              trails.begin(i, col, 1.6 * lineK, true);
              for (let j = 0; j < n; j++) {
                if (!hits[j]) continue;
                const a = angleOf(j / n);
                trails.point(Math.cos(a) * r, Math.sin(a) * r, zz, j / n, kb);
              }
              trails.end();
            }
          }
          const tsl = trails.slots[i]!;
          tsl.intensity = cur.trail * v * mE * 0.42;
          tsl.fade = 0;
        }
      }
      trails.upload();
      trails.commit();
      beads.commit(b);
    },
    dispose() {
      lines.dispose();
      trails.dispose();
      beads.dispose();
      group.removeFromParent();
    },
  };
  return self;
}

function lcmInt(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return (a / x) * b;
}
