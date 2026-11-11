// The L-shaped interferometer, line-drawn (stage 8; reusable). Laser → beam splitter → two arms (vacuum tubes, input
// and end test masses) → back to the splitter → the output port and its photodetector, with a ring of fringes around
// the detector's window. The light is drawn three ways: the beams (glow lines whose reach can be animated), the light
// wave itself along each arm (a sinusoid moving at a drawn speed: a picture of the wave, wavelength hugely
// exaggerated) and, at the output, the two returning waves and their sum, which is what the photodetector measures.
//
// Frame: splitter at the origin, the X arm along +x, the Y arm along −z, the output port toward +z, y up. One scene unit
// is arbitrary: the arms are `armLength` long (default 4); the end mirrors move along their arm by dx, dy (scene
// units, exaggerated by whatever the caller states).

import { Group, Vector3 } from 'three/webgpu';
import type { Vec2Uniform } from '../../render/globals.ts';
import { createLines, type LineSpec, type Lines } from '../gfx/lines.ts';
import { createGlowLine, createGlowPoints, type GlowLine, type GlowPoints } from '../gfx/glow.ts';
import type { RGB } from '../gfx/palette.ts';

export interface IfoOptions {
  resolution: Vec2Uniform;
  armLength?: number;
  /** Outline colour (steel), laser colour, output colour. */
  frame?: RGB;
  laser?: RGB;
  output?: RGB;
  /** Points per drawn light wave. */
  wavePoints?: number;
}

export interface IfoState {
  /** 0–1: the instrument draws itself (outward from the splitter). */
  reveal: number;
  /** 0–1: the light's reach: 0–⅓ laser to splitter, ⅓–⅔ out along both arms, ⅔–1 back and out to the detector. */
  light: number;
  /** End-mirror displacements along their arms (scene units; + = arm longer). */
  dx: number;
  dy: number;
  /** Phase difference of the two returning beams (rad); output power = sin²(Δφ/2), dark at 0. */
  phase: number;
  /** 0–1: the light drawn as waves along the arms. */
  waves: number;
  /** 0–1: the two returning waves and their sum at the output. */
  sum: number;
  /** 0–1: fringe rings around the detector. */
  fringes: number;
  /** Overall brightness of the frame. */
  frame: number;
}

export interface Interferometer {
  group: Group;
  state: IfoState;
  /** Power at the output port (0–1) for the current state. */
  readonly power: number;
  /** Named anchor in the group's frame: laser, splitter, mirrorX, mirrorY, itmX, itmY, detector, armX, armY. */
  anchor(name: AnchorName, out: Vector3): Vector3;
  /** Write the state into the drawing; `time` drives the drawn light waves (idle motion, never the chirp). */
  update(time: number): void;
  dispose(): void;
}

export type AnchorName = 'laser' | 'splitter' | 'mirrorX' | 'mirrorY' | 'itmX' | 'itmY' | 'detector' | 'armX' | 'armY' | 'output';

const FRAME: RGB = [0.55, 0.62, 0.82];
const LASER: RGB = [1.0, 0.36, 0.3];
const OUT: RGB = [1.0, 0.95, 0.88];

/** Points of a circle of radius r about c in the plane spanned by unit vectors u, v (flat xyz). */
function ring3(c: readonly number[], u: readonly number[], v: readonly number[], r: number, n = 40): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a) * r;
    const sa = Math.sin(a) * r;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = c[k]! + u[k]! * ca + v[k]! * sa;
  }
  return out;
}

function seg(a: readonly number[], b: readonly number[]): Float32Array {
  return Float32Array.from([...a, ...b]);
}

/** Wire box: two end squares and four long edges, centred at c with half sizes hx, hy, hz. */
function box(c: readonly number[], hx: number, hy: number, hz: number): Float32Array[] {
  const P = (sx: number, sy: number, sz: number) => [c[0]! + sx * hx, c[1]! + sy * hy, c[2]! + sz * hz];
  const sq = (sx: number) => Float32Array.from([...P(sx, -1, -1), ...P(sx, 1, -1), ...P(sx, 1, 1), ...P(sx, -1, 1)]);
  return [sq(-1), sq(1), seg(P(-1, -1, -1), P(1, -1, -1)), seg(P(-1, 1, -1), P(1, 1, -1)), seg(P(-1, 1, 1), P(1, 1, 1)), seg(P(-1, -1, 1), P(1, -1, 1))];
}

export function createInterferometer(o: IfoOptions): Interferometer {
  const L = o.armLength ?? 4;
  const frameC = o.frame ?? FRAME;
  const laserC = o.laser ?? LASER;
  const outC = o.output ?? OUT;
  const group = new Group();
  const P = {
    laser: [-1.35, 0, 0],
    splitter: [0, 0, 0],
    itmX: [0.55, 0, 0],
    itmY: [0, 0, -0.55],
    mirrorX: [L, 0, 0],
    mirrorY: [0, 0, -L],
    detector: [0, 0, 1.15],
  } as const;
  const tubeR = 0.09;
  const mirrorR = 0.15;
  const mirrorT = 0.07;

  // ── Frame lines ──
  const specs: LineSpec[] = [];
  const starts: number[] = [];
  const kinds: ('frame' | 'etmX' | 'etmY' | 'fringe')[] = [];
  const add = (pts: Float32Array, at: number, kind: (typeof kinds)[number] = 'frame', extra: Partial<LineSpec> = {}) => {
    specs.push({ points: pts, dims: 3, colour: frameC, width: 1.6, intensity: 0.7, ...extra });
    starts.push(at);
    kinds.push(kind);
  };
  const X = [1, 0, 0];
  const Y = [0, 1, 0];
  const Z = [0, 0, 1];
  // Laser head.
  for (const l of box([P.laser[0] - 0.05, 0, 0], 0.3, 0.12, 0.12)) add(l, 0.05);
  add(ring3([P.laser[0] + 0.25, 0, 0], Y, Z, 0.05, 24), 0.05, 'frame', { colour: laserC, intensity: 0.8 });
  // Beam splitter: a plate at 45° (plane spanned by y and (1, 0, −1)/√2).
  {
    const s = Math.SQRT1_2 * 0.2;
    const h = 0.2;
    add(Float32Array.from([-s, -h, s, s, -h, -s, s, h, -s, -s, h, s]), 0, 'frame', { closed: true, intensity: 0.9 });
  }
  // Tubes and test masses, per arm.
  for (const arm of ['X', 'Y'] as const) {
    const dir = arm === 'X' ? X : [0, 0, -1];
    const u = Y;
    const v = arm === 'X' ? Z : X;
    const at = (s: number) => [dir[0]! * s, dir[1]! * s, dir[2]! * s];
    const t0 = 0.75;
    const t1 = L + 0.25;
    for (const [a, b] of [
      [tubeR, 0],
      [-tubeR, 0],
      [0, tubeR],
      [0, -tubeR],
    ] as const) {
      const off = [u[0]! * a + v[0]! * b, u[1]! * a + v[1]! * b, u[2]! * a + v[2]! * b];
      const p0 = at(t0);
      const p1 = at(t1);
      add(seg([p0[0]! + off[0]!, p0[1]! + off[1]!, p0[2]! + off[2]!], [p1[0]! + off[0]!, p1[1]! + off[1]!, p1[2]! + off[2]!]), 0.25, 'frame', { intensity: 0.32, width: 1.1 });
    }
    for (let s = t0; s <= t1 + 1e-6; s += (t1 - t0) / 9) add(ring3(at(s), u, v, tubeR, 28), 0.25 + (0.5 * s) / L, 'frame', { intensity: 0.38, width: 1.1 });
    // Input test mass (fixed) and end test mass (moves along the arm).
    const itm = at(0.55);
    add(ring3(itm, u, v, mirrorR * 0.8, 36), 0.15, 'frame', { intensity: 0.8 });
    const kind = arm === 'X' ? 'etmX' : 'etmY';
    const e0 = at(L - mirrorT / 2);
    const e1 = at(L + mirrorT / 2);
    add(ring3(e0, u, v, mirrorR, 40), 0.7, kind, { intensity: 1.0, width: 1.6 });
    add(ring3(e1, u, v, mirrorR, 40), 0.7, kind, { intensity: 0.7 });
    for (const [a, b] of [
      [mirrorR, 0],
      [-mirrorR, 0],
      [0, mirrorR],
      [0, -mirrorR],
    ] as const) {
      const off = [u[0]! * a + v[0]! * b, u[1]! * a + v[1]! * b, u[2]! * a + v[2]! * b];
      add(seg([e0[0]! + off[0]!, e0[1]! + off[1]!, e0[2]! + off[2]!], [e1[0]! + off[0]!, e1[1]! + off[1]!, e1[2]! + off[2]!]), 0.7, kind, { intensity: 0.7 });
    }
  }
  // Photodetector: a small box with its window facing the splitter.
  for (const l of box([0, 0, P.detector[2] + 0.12], 0.12, 0.12, 0.12)) add(l, 0.6);
  add(ring3([0, 0, P.detector[2]], X, Y, 0.06, 24), 0.6, 'frame', { colour: outC, intensity: 0.9 });
  // Fringe rings around the window, in the plane facing the splitter.
  const FRINGES = 9;
  const fringe0 = specs.length;
  for (let k = 1; k <= FRINGES; k++) add(ring3([0, 0, P.detector[2] - 0.02], X, Y, 0.1 + 0.42 * Math.sqrt(k / FRINGES), 64), 0.6, 'fringe', { colour: outC, intensity: 1, width: 1.8 });

  const lines: Lines = createLines(specs, { resolution: o.resolution });
  group.add(lines.mesh);

  // ── Light ──
  const beamIn = createGlowLine(2, laserC, { width: 0.012, intensity: 2.2 });
  const beamX = createGlowLine(2, laserC, { width: 0.012, intensity: 2.0 });
  const beamY = createGlowLine(2, laserC, { width: 0.012, intensity: 2.0 });
  const beamOut = createGlowLine(2, outC, { width: 0.016, intensity: 0 });
  const WP = o.wavePoints ?? 220;
  const waveX = createGlowLine(WP, laserC, { width: 0.006, intensity: 1.4 });
  const waveY = createGlowLine(WP, laserC, { width: 0.006, intensity: 1.4 });
  const SP = 90;
  const retX = createGlowLine(SP, laserC, { width: 0.006, intensity: 1.2 });
  const retY = createGlowLine(SP, laserC, { width: 0.006, intensity: 1.2 });
  const retSum = createGlowLine(SP, outC, { width: 0.009, intensity: 2.2 });
  const spot: GlowPoints = createGlowPoints(2, outC, { radius: 0.05, intensity: 3 });
  const glows: GlowLine[] = [beamIn, beamX, beamY, beamOut, waveX, waveY, retX, retY, retSum];
  for (const g of glows) group.add(g.mesh);
  group.add(spot.mesh);

  const state: IfoState = { reveal: 1, light: 1, dx: 0, dy: 0, phase: 0, waves: 0, sum: 0, fringes: 0, frame: 1 };
  let power = 0;
  const base = specs.map((s) => s.intensity ?? 1);
  const s01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

  /** A drawn light wave along a segment (a → b), amplitude amp, wavelength lam, phase ph (rad), reach 0–1. */
  function drawWave(g: GlowLine, n: number, ax: number, az: number, bx: number, bz: number, amp: number, lam: number, ph: number, reach: number, lift = 0) {
    const len = Math.hypot(bx - ax, bz - az);
    const cnt = Math.max(2, Math.round(n * reach));
    for (let i = 0; i < cnt; i++) {
      const u = (i / (n - 1)) * 1;
      const s = u * len;
      const y = lift + amp * Math.sin((2 * Math.PI * s) / lam - ph);
      g.set(i, ax + (bx - ax) * u, y, az + (bz - az) * u);
    }
    g.commit(reach > 0.001 ? cnt : 0);
  }

  const self: Interferometer = {
    group,
    state,
    get power() {
      return power;
    },
    anchor(name, out) {
      switch (name) {
        case 'mirrorX':
          return out.set(L + state.dx, 0, 0);
        case 'mirrorY':
          return out.set(0, 0, -L - state.dy);
        case 'armX':
          return out.set(L * 0.5, 0, 0);
        case 'armY':
          return out.set(0, 0, -L * 0.5);
        case 'output':
          return out.set(0, 0, P.detector[2] * 0.5);
        default: {
          const p = P[name];
          return out.set(p[0], p[1], p[2]);
        }
      }
    },
    update(time) {
      const st = state;
      power = Math.sin(st.phase / 2) ** 2;
      // Frame: reveal outward from the splitter.
      for (let i = 0; i < specs.length; i++) {
        const ls = lines.state[i]!;
        const r = s01((st.reveal - starts[i]! * 0.8) / 0.25);
        ls.to = r;
        ls.head = r > 0 && r < 1 ? 1 : 0;
        ls.intensity = st.frame;
        ls.x = 0;
        ls.z = 0;
        if (kinds[i] === 'etmX') ls.x = st.dx;
        if (kinds[i] === 'etmY') ls.z = -st.dy;
        if (kinds[i] === 'fringe') {
          const k = i - fringe0 + 1;
          // Each ring is a further half-wave of path mismatch across the beam (circular fringes); its brightness
          // follows the same Δφ as the centre, so the rings run in and out as the arms change.
          const ph = st.phase + (Math.PI * k) / 2.2;
          ls.intensity = st.fringes * (0.08 + 1.2 * Math.sin(ph / 2) ** 2) * (1 - k / (FRINGES + 3));
          ls.to = st.fringes > 0 ? 1 : 0;
        } else ls.intensity = st.frame * (base[i]! > 0 ? 1 : 0);
      }
      lines.commit();
      // Beams: in, out along both arms, back to the splitter and on to the detector.
      const l = st.light;
      const a = s01(l * 3);
      beamIn.set(0, P.laser[0] + 0.25, 0, 0);
      beamIn.set(1, P.laser[0] + 0.25 + (0 - P.laser[0] - 0.25) * a, 0, 0);
      beamIn.commit(a > 0 ? 2 : 0);
      const b = s01(l * 3 - 1);
      const ex = L + st.dx - mirrorT / 2;
      const ey = L + st.dy - mirrorT / 2;
      beamX.set(0, 0, 0, 0);
      beamX.set(1, ex * b, 0, 0);
      beamX.commit(b > 0 ? 2 : 0);
      beamY.set(0, 0, 0, 0);
      beamY.set(1, 0, 0, -ey * b);
      beamY.commit(b > 0 ? 2 : 0);
      const c = s01(l * 3 - 2);
      beamOut.set(0, 0, 0, 0);
      beamOut.set(1, 0, 0, P.detector[2] * c);
      beamOut.commit(c > 0 ? 2 : 0);
      // Only the light that does not cancel reaches the detector.
      beamOut.intensity.value = c * (0.04 + 2.6 * power);
      spot.set(0, 0, 0, P.detector[2] - 0.01, c * (0.05 + power) * 1.0);
      spot.set(1, 0, 0, 0, s01(l * 3 - 0.9) * 0.6);
      spot.commit();
      // Drawn light waves (time = idle seconds; the speed is a picture, not light's).
      const w = st.waves;
      const lam = 0.32;
      const ph = time * 5;
      const amp = 0.05 * w;
      waveX.intensity.value = 1.4 * w;
      waveY.intensity.value = 1.4 * w;
      drawWave(waveX, WP, 0.08, 0, ex, 0, amp, lam, ph, w > 0.01 ? b : 0);
      drawWave(waveY, WP, 0, -0.08, 0, -ey, amp, lam, ph, w > 0.01 ? b : 0);
      // Returning waves at the output, side by side, and their sum on the beam: the Y-arm wave is shifted by Δφ.
      const sm = st.sum * c;
      retX.intensity.value = 1.2 * sm;
      retY.intensity.value = 1.2 * sm;
      retSum.intensity.value = 2.4 * sm;
      const z0 = 0.18;
      const z1 = P.detector[2] - 0.12;
      const ra = 0.06;
      const lift = 0.22;
      drawWave(retX, SP, 0, z0, 0, z1, ra, lam, ph, sm > 0.01 ? 1 : 0, lift * 2);
      drawWave(retY, SP, 0, z0, 0, z1, ra, lam, ph + Math.PI + st.phase, sm > 0.01 ? 1 : 0, lift);
      // Sum: the two waves added (a cos (k s − ωt) + a cos (k s − ωt − π − Δφ)); the π is the dark-port convention.
      const len = z1 - z0;
      for (let i = 0; i < SP; i++) {
        const u = i / (SP - 1);
        const s = u * len;
        const k = (2 * Math.PI * s) / lam;
        const y = ra * (Math.sin(k - ph) + Math.sin(k - ph - Math.PI - st.phase));
        retSum.set(i, 0, y, z0 + s);
      }
      retSum.commit(sm > 0.01 ? SP : 0);
    },
    dispose() {
      lines.dispose();
      for (const g of glows) g.dispose();
      spot.dispose();
    },
  };
  self.update(0);
  return self;
}
