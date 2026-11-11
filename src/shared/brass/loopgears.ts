// Loop gears (stages 8–9, the finale's Gears view): a gear with one tooth per pulse of its loop, so a loop of n is an
// n-tooth gear, and gears that mesh share the tooth rate, the pulse. Few-tooth gears need care: an involute profile
// with a 25° pressure angle, stub teeth and a little backlash, checked to clear its mate through the whole roll for
// every pair from 3 to 8 teeth. Each gear rests with a tooth at 12 o'clock; meshDirection() finds where to put a
// neighbour so that it rests the same way. step-wise drive: see gearTurn().

import { Matrix4 } from 'three/webgpu';
import { cylinder, extrude, GeoBuilder, revolve, type V2 } from './geometry.ts';

export interface LoopProfileOptions {
  /** Pressure angle, radians (default 25°). */
  pressure?: number;
  /** Addendum and dedendum in modules (defaults 0.8 and 0.95: stub teeth). */
  addendum?: number;
  dedendum?: number;
  /** Fraction of the circular pitch removed from each tooth (default 0.05). */
  backlash?: number;
  /** Points per flank. */
  flank?: number;
}

const inv = (a: number) => Math.tan(a) - a;

/** Pitch radius of an n-tooth gear. */
export const pitchR = (teeth: number, module: number) => (teeth * module) / 2;

/** Tip and root radii for the default profile. */
export function radii(teeth: number, module: number, o: LoopProfileOptions = {}) {
  const rp = pitchR(teeth, module);
  return { pitch: rp, tip: rp + (o.addendum ?? 0.8) * module, root: Math.max(rp - (o.dedendum ?? 0.95) * module, module * 0.45) };
}

/** Tooth outline, counter-clockwise, tooth 0 centred on +y (12 o'clock). */
export function loopProfile(teeth: number, module: number, o: LoopProfileOptions = {}): V2[] {
  const pa = o.pressure ?? (25 * Math.PI) / 180;
  const { pitch: rp, tip: ra, root: rf } = radii(teeth, module, o);
  const rb = rp * Math.cos(pa);
  const bl = ((o.backlash ?? 0.05) * Math.PI * module) / 2 / rp;
  const half = (r: number) => Math.PI / (2 * teeth) + inv(pa) - (r > rb ? inv(Math.acos(rb / r)) : 0) - bl;
  const N = o.flank ?? 8;
  const r0 = Math.max(rb, rf);
  const step = (2 * Math.PI) / teeth;
  const out: V2[] = [];
  const P = (r: number, a: number) => out.push([r * Math.cos(a + Math.PI / 2), r * Math.sin(a + Math.PI / 2)]);
  const nf = 4;
  for (let t = 0; t < teeth; t++) {
    const c = t * step;
    const hr = half(r0);
    const gap = step / 2;
    // Root land from the gap's centre to the fillet, the fillet up to the base circle, the flank, the tip land, back.
    const rootTo = c - hr - 0.14 * (gap - hr);
    for (let i = 0; i <= 5; i++) P(rf, c - gap + ((rootTo - (c - gap)) * i) / 5);
    for (let i = 1; i < nf; i++) {
      const f = i / nf;
      P(rf + (r0 - rf) * (1 - Math.cos((f * Math.PI) / 2)), rootTo + (c - hr - rootTo) * Math.sin((f * Math.PI) / 2));
    }
    for (let i = 0; i <= N; i++) {
      const r = r0 + ((ra - r0) * i) / N;
      P(r, c - Math.max(half(r), 0.02));
    }
    for (let i = N; i >= 0; i--) {
      const r = r0 + ((ra - r0) * i) / N;
      P(r, c + Math.max(half(r), 0.02));
    }
    const rootFrom = c + hr + 0.14 * (gap - hr);
    for (let i = nf - 1; i >= 1; i--) {
      const f = i / nf;
      P(rf + (r0 - rf) * (1 - Math.cos((f * Math.PI) / 2)), rootFrom + (c + hr - rootFrom) * Math.sin((f * Math.PI) / 2));
    }
    for (let i = 0; i < 5; i++) P(rf, rootFrom + ((c + gap - rootFrom) * i) / 5);
  }
  return out;
}

/**
 * Direction (radians, from gear a's centre to gear b's) nearest `approx` at which an na-tooth gear and an nb-tooth
 * gear, both resting with a tooth at 12 o'clock, mesh. The tooth phases at the line of centres must sum to ½:
 * φ·(na + nb)/2π + (nb − na)/4 ≡ ½ (mod 1).
 */
export function meshDirection(na: number, nb: number, approx: number): number {
  const period = (2 * Math.PI) / (na + nb);
  const base = ((0.5 - (nb - na) / 4) * 2 * Math.PI) / (na + nb);
  const k = Math.round((approx - base) / period);
  return base + k * period;
}

/**
 * Rotation (radians, about +z) of an n-tooth gear after `progress` teeth (see stepProgress): dir −1 turns clockwise.
 * Tooth j sits at 12 o'clock after j steps, so a clockwise gear numbers its teeth counter-clockwise from the top.
 */
export const gearTurn = (progress: number, n: number, dir: 1 | -1) => (dir * progress * 2 * Math.PI) / n;

/** Angle (radians from +x) of tooth j of a gear with rotation `rot` (tooth 0 at 12 o'clock at rest). */
export const toothAngle = (j: number, n: number, dir: 1 | -1, rot: number) => Math.PI / 2 - (dir * j * 2 * Math.PI) / n + rot;

export interface LoopGearSpec {
  teeth: number;
  module: number;
  /** Face width; the gear spans z ∈ [−width/2, width/2]. */
  width: number;
  part: number;
  /** Part id for the hub boss and the turned ring (default: part). */
  hubPart?: number;
  profile?: LoopProfileOptions;
}

/** A loop gear about z: toothed plate, a turned boss each side and a sunk ring on the face. */
export function buildLoopGear(s: LoopGearSpec): GeoBuilder {
  const prof = loopProfile(s.teeth, s.module, s.profile);
  const { root } = radii(s.teeth, s.module, s.profile);
  const half = s.width / 2;
  const g = extrude(prof, [], -half, half, s.part);
  const hp = s.hubPart ?? s.part;
  const boss = Math.min(root * 0.62, s.module * 0.7);
  const lip = s.width * 0.28;
  // A stepped boss, front and back (revolved so its shoulders crease).
  const bossProfile = (sgn: number): V2[] => [
    [0, sgn * (half + lip)],
    [boss * 0.55, sgn * (half + lip)],
    [boss * 0.62, sgn * (half + lip * 0.6)],
    [boss, sgn * (half + lip * 0.45)],
    [boss, sgn * half],
  ];
  const front = revolve(bossProfile(1), 28, hp);
  const back = revolve(bossProfile(-1).reverse(), 28, hp);
  g.append(front).append(back);
  return g;
}

/** An arbor (axle) along z with a collet at the front. */
export function buildArbor(radius: number, z0: number, z1: number, part: number): GeoBuilder {
  const b = cylinder(radius, z0, z1, 16, part);
  b.append(cylinder(radius * 1.9, z1 - radius * 1.2, z1, 20, part));
  return b;
}

/** Translate a builder (returns a new one). */
export function moved(b: GeoBuilder, x: number, y: number, z: number): GeoBuilder {
  return new GeoBuilder().append(b, new Matrix4().makeTranslation(x, y, z));
}
