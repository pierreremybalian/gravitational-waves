// Shapes view of a polymeter (HANDOFF "Shapes"): one regular polygon per loop, all with the same side, rolling along
// one floor. Each landing is one pulse, so every polygon advances one side per pulse and they stay abreast; a loop of
// n is an n-gon, and its marked vertex (the loop's first beat) lands every n pulses. Where the marked vertices land
// together (every lcm pulses) the floor lights a white rung across the lanes. Geometry from rollPolygon /
// polygonVertices (src/rhythm/analysis.ts; vertex j lands at pulses j, j + n, …).
//
// Motion is read from the music frame: a polygon rests on its side, tips over during the last part of the pulse and
// lands exactly on the next one (when its hit sounds). The floor slides at the steady pulse rate, so the polygons
// stay near the middle of the view and the floor reads as the pulse going by. Ticks mark every pulse; footprints
// mark where each marked vertex has landed (bright) and will land (faint).
//
// Luminous lines and glow points only: add `group` to an additively drawn overlay. update() allocates nothing.

import { Group } from 'three/webgpu';
import { createLines, type LineSpec, type Lines } from '../gfx/lines.ts';
import { createGlowPoints, type GlowPoints } from '../brass/lines.ts';
import { layerColour, PAL, type RGB } from '../gfx/palette.ts';
import { polygonVertices, rollPolygon, type Rolled } from '../../rhythm/analysis.ts';
import { lcm } from '../../rhythm/rational.ts';
import type { MusicFrame } from '../../rhythm/frame.ts';
import type { Vec2Uniform } from '../../render/globals.ts';

// ── Pure helpers (tested) ─────────────────────────────────────────────────────────────────────────────────────────

/** Pulses since the section anchor for a loop layer (one step per pulse), continuous. */
export function layerPulses(m: Readonly<MusicFrame>, layer: number): number {
  const n = m.entry?.c?.steps[layer] ?? 0;
  if (!n) return 0;
  return (m.layerCycle[layer]! + m.layerPhase[layer]!) * n;
}

/**
 * Step-wise progress: rests on the integer, moves during the last `tip` fraction of each pulse and arrives exactly
 * on the next integer (accelerating, like something falling into place). P = continuous pulses.
 */
export function stepProgress(P: number, tip: number, power = 2.4): number {
  const k = Math.floor(P + 1e-7);
  const f = Math.max(0, P - k);
  const t = tip <= 0 ? 0 : Math.min(1, Math.max(0, (f - (1 - tip)) / tip));
  return k + Math.pow(t, power);
}

/** Pulse indices p in [from, to] where every loop in `loops` has its marked vertex down (multiples of their lcm). */
export function sharedLandings(loops: readonly number[], from: number, to: number, out: number[] = []): number[] {
  out.length = 0;
  const L = loops.reduce((a, b) => lcm(a, b), 1);
  if (!L) return out;
  for (let p = Math.ceil(from / L) * L + 0; p <= to; p += L) out.push(p);
  return out;
}

/** The vertex of an n-gon that is on the floor after k landings (the one that sounded on pulse k). */
export const vertexDown = (n: number, k: number) => ((k % n) + n) % n;

// ── Renderer ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RollingSpec {
  /** Loop lengths, one polygon per loop (lanes front to back in this order). */
  loops: readonly number[];
  /** Music layer of each loop (default 0, 1, 2 …); its colour is layerColour(layer). */
  layers?: readonly number[];
  /** Side length (world units, before scale). */
  side?: number;
  /** Lane spacing along z (world units, before scale). */
  laneGap?: number;
  /** Pulses of floor drawn ahead of and behind the polygons. */
  ahead?: number;
  behind?: number;
  /** Seconds a polygon takes to tip over onto its next side (capped to most of a pulse). */
  tipS?: number;
  resolution: Vec2Uniform;
}

export interface RollingState {
  /** Placement: world position of the lanes' common origin and a uniform scale. */
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Overall brightness 0–1. */
  opacity: number;
  /** Per loop: 0–1 presence (fades a polygon and its lane in and out). */
  presence: Float32Array;
  /** Per loop: 1 while its layer is sounding (lit footprints and flashes), 0 for a silent ghost. */
  live: Float32Array;
  /** 0–1 brightness of the white rungs where all present loops land together. */
  rungs: number;
}

export interface Rolling {
  group: Group;
  state: RollingState;
  /** Move everything from the music (null: rest at pulse 0, no flashes). */
  update(m: Readonly<MusicFrame> | null): void;
  /** World position of loop i's polygon centre after the last update (for labels). */
  centre(i: number, out: { x: number; y: number; z: number }): void;
  /** Front end of the latest bright rung (all sounding loops landed together); returns its visibility 0–1. */
  sharedMark(out: { x: number; y: number; z: number }): number;
  /** The floor window in the polygons' frame (before placement): pulses behind and ahead, lane z, tallest polygon. */
  readonly extent: { x0: number; x1: number; zFront: number; zBack: number; height: number };
  dispose(): void;
}

const RUNG: RGB = PAL.both;

export function createRolling(spec: RollingSpec): Rolling {
  const loops = spec.loops;
  const N = loops.length;
  const layers = spec.layers ?? loops.map((_, i) => i);
  const L = spec.side ?? 1;
  const gap = spec.laneGap ?? 1.1;
  const ahead = spec.ahead ?? 6;
  const behind = spec.behind ?? 13;
  const tipS = spec.tipS ?? 0.16;
  const span = ahead + behind + 2;
  const colours = layers.map((l) => layerColour(l));
  const laneZ = loops.map((_, i) => (i - (N - 1) / 2) * gap);
  const zMin = laneZ[0]! - 0.32 * gap;
  const zMax = laneZ[N - 1]! + 0.32 * gap;

  // ── Lines: per loop a polygon, a spoke to its marked vertex and its rail; one rung per pulse across every lane
  // (the shared pulse), brighter where all the loops sounding land their marked vertices together. ──
  const specs: LineSpec[] = [];
  const iPoly: number[] = [];
  const iSpoke: number[] = [];
  const iRail: number[] = [];
  const iRung: number[] = [];
  const rest: Rolled = { cx: 0, cy: 0, angle: 0, pivot: 0 };
  loops.forEach((n, i) => {
    const v = polygonVertices(n, L, rest);
    iPoly.push(specs.length);
    specs.push({ points: v, colour: colours[i]!, width: 3, intensity: 1.25, closed: true });
    iSpoke.push(specs.length);
    specs.push({ points: [0, 0, v[0]!, v[1]!], colour: colours[i]!, width: 1.4, intensity: 0.75 });
    iRail.push(specs.length);
    specs.push({ points: [-(behind + 1) * L, 0, 0, (ahead + 1) * L, 0, 0], dims: 3, colour: colours[i]!, width: 1.2, intensity: 0.3 });
  });
  for (let r = 0; r < span; r++) {
    iRung.push(specs.length);
    specs.push({ points: [0, 0, zMin, 0, 0, zMax], dims: 3, colour: RUNG, width: 1.1, intensity: 0.5 });
  }
  const lines: Lines = createLines(specs, { resolution: spec.resolution });

  // ── Points: per loop its vertices, the marked vertex (a jewel) and its footprints on the floor. ──
  const maxPrints = loops.map((n) => Math.ceil(span / n) + 1);
  const verts: GlowPoints[] = loops.map((n, i) => createGlowPoints(n, colours[i]!, { radius: 0.03, intensity: 1.1 }));
  const marks: GlowPoints[] = loops.map((_, i) => createGlowPoints(1, colours[i]!, { radius: 0.07, intensity: 1.6 }));
  const prints: GlowPoints[] = loops.map((_, i) => createGlowPoints(maxPrints[i]!, colours[i]!, { radius: 0.05, intensity: 1.4 }));

  const group = new Group();
  group.add(lines.mesh);
  for (const g of [...prints, ...verts, ...marks]) group.add(g.mesh);

  const state: RollingState = {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    opacity: 1,
    presence: new Float32Array(N).fill(1),
    live: new Float32Array(N).fill(1),
    rungs: 1,
  };
  const rolled: Rolled[] = loops.map(() => ({ cx: 0, cy: 0, angle: 0, pivot: 0 }));
  const vbuf = loops.map((n) => new Float32Array(n * 2));
  const present: number[] = [];
  const centres = new Float32Array(N * 3);
  let height = 0;
  for (const n of loops) height = Math.max(height, (L / (2 * Math.sin(Math.PI / n))) * 2);
  const extent = { x0: -behind * L, x1: ahead * L, zFront: zMax, zBack: zMin, height };

  let markX = 0;
  let markO = 0;
  const flash = (age: number, tau: number) => (Number.isFinite(age) ? Math.exp(-age / tau) : 0);
  /** 1 inside the window, fading over the last pulses at each end (more slowly into the past). */
  const edgeFade = (d: number) => Math.min(1, Math.max(0, (d + behind) / 5)) * Math.min(1, Math.max(0, (ahead - d) / 2));

  function update(m: Readonly<MusicFrame> | null) {
    const s = state;
    const k = s.scale;
    const op = s.opacity;
    const running = !!m && m.running;
    // The floor's clock: continuous pulses of the first loop (every loop shares the pulse).
    const P = running ? layerPulses(m, layers[0]!) : 0;
    const rate = running ? Math.max(1e-3, m.layerRate[layers[0]!]!) : 1;
    const tip = Math.min(0.85, tipS * rate);
    const now = Math.floor(P + 1e-7);
    present.length = 0;
    for (let i = 0; i < N; i++) if (s.presence[i]! > 0.5 && s.live[i]! > 0.5) present.push(loops[i]!);
    let shared = 0;
    if (present.length >= 2) {
      shared = 1;
      for (let q = 0; q < present.length; q++) shared = lcm(shared, present[q]!);
    }

    for (let i = 0; i < N; i++) {
      const n = loops[i]!;
      const lay = layers[i]!;
      const pr = s.presence[i]! * op;
      const live = s.live[i]!;
      const u = running ? stepProgress(layerPulses(m, lay), tip) : 0;
      const r = rollPolygon(n, L, u, rolled[i]!);
      const zl = s.z + laneZ[i]! * k;
      const cx = s.x + (r.cx - P * L) * k;
      const cy = s.y + r.cy * k;
      centres[i * 3] = cx;
      centres[i * 3 + 1] = cy;
      centres[i * 3 + 2] = zl;
      // Hits as heard: the vertex that just landed flashes; the marked one flashes harder.
      const age = running && live > 0.5 ? m.onsetAge[lay]! : Infinity;
      const landed = running ? m.onsetStep[lay]! : -1;
      const fl = flash(age, 0.16);
      const markFl = landed === 0 ? fl : 0;
      const poly = lines.state[iPoly[i]!]!;
      poly.x = cx;
      poly.y = cy;
      poly.z = zl;
      poly.sx = k;
      poly.sy = k;
      poly.rot = r.angle;
      poly.intensity = pr * (0.4 + 0.6 * live + 0.7 * fl);
      poly.highlight = markFl;
      const spoke = lines.state[iSpoke[i]!]!;
      spoke.x = cx;
      spoke.y = cy;
      spoke.z = zl;
      spoke.sx = k;
      spoke.sy = k;
      spoke.rot = r.angle;
      spoke.intensity = pr * (0.5 + 0.6 * live + 1.5 * markFl);
      const rail = lines.state[iRail[i]!]!;
      rail.x = s.x;
      rail.y = s.y;
      rail.z = zl;
      rail.sx = k;
      rail.sy = k;
      rail.intensity = pr * (0.5 + 0.5 * live);

      const v = polygonVertices(n, L, r, vbuf[i]);
      for (let j = 0; j < n; j++) {
        const b = j === landed ? fl : 0;
        verts[i]!.set(j, s.x + (v[2 * j]! - P * L) * k, s.y + v[2 * j + 1]! * k, zl, j === 0 ? 0 : pr * (0.35 + 0.25 * live + 2.5 * b));
      }
      verts[i]!.commit();
      marks[i]!.set(0, s.x + (v[0]! - P * L) * k, s.y + v[1]! * k, zl, pr * (0.7 + 0.6 * live + 3.5 * markFl));
      marks[i]!.commit();

      // Footprints: where the marked vertex lands (pulses ≡ 0 mod n). Past ones stay lit; the next ones are faint.
      const first = Math.ceil((now - behind - 1) / n) * n;
      for (let q = 0; q < maxPrints[i]!; q++) {
        const p = first + q * n;
        const fade = edgeFade(p - P);
        const past = p <= now;
        const hit = p === now ? fl : 0;
        prints[i]!.set(q, s.x + (p - P) * L * k, s.y, zl, pr * fade * (past ? 0.3 + 0.7 * live : 0.22) * (1 + 3 * hit));
      }
      prints[i]!.commit();
    }

    // Rungs: one per pulse; where every loop sounding lands its marked vertex, a bright rung (flashing on arrival).
    const realFl = running && shared ? flash(m.realignAge, 0.25) : 0;
    const p0 = now - behind;
    markX = 0;
    markO = 0;
    for (let r = 0; r < span; r++) {
      const p = p0 + r;
      const st = lines.state[iRung[r]!]!;
      const together = shared > 0 && p % shared === 0;
      const fade = edgeFade(p - P);
      st.x = s.x + (p - P) * L * k;
      st.y = s.y;
      st.z = s.z;
      st.sx = k;
      st.sy = k;
      const base = p <= now ? 0.55 : 0.3;
      const tog = together ? s.rungs * (p <= now ? 2.2 : 0.9) * (1 + (p === now ? 2 * realFl : 0)) : 0;
      st.intensity = op * fade * Math.max(base, tog);
      st.highlight = together ? s.rungs : 0;
      if (together && p <= now) {
        markX = st.x;
        markO = op * fade * s.rungs;
      }
    }
    lines.commit();
  }

  update(null);

  return {
    group,
    state,
    update,
    extent,
    sharedMark(out) {
      out.x = markX;
      out.y = state.y;
      out.z = state.z + zMax * state.scale;
      return markO;
    },
    centre(i, out) {
      out.x = centres[i * 3]!;
      out.y = centres[i * 3 + 1]!;
      out.z = centres[i * 3 + 2]!;
    },
    dispose() {
      lines.dispose();
      for (const g of [...verts, ...marks, ...prints]) g.dispose();
      group.clear();
    },
  };
}
