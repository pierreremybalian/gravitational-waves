// The spacetime grid: luminous constant-width lines on the x–z plane, displaced in the vertex shader by
//   · wells: up to MAX_WELLS masses dimpling the sheet (y = −depth / √(1 + r²/soft²); a picture of curvature, not a
//     literal shape: the "rubber sheet" metaphor),
//   · a plane wave arriving along y in the transverse-traceless gauge: δx = ½(h+ x + h× z), δz = ½(h× x − h+ z)
//     (the same formula as src/gw/strain.ts deform(), with its y → our z),
//   · the outgoing quadrupole field of a binary, drawn as height: amp(t_r) · cos(2φ − Φ(t_r)), t_r = t − r / speed,
//     read from the template's phase and amplitude (src/shared/space/track.ts). Height stands in for strain.
// No per-frame CPU work beyond uniforms. Additive, depthWrite off.

import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial, Vector4 } from 'three/webgpu';
import {
  atan,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  Discard,
  exp,
  float,
  Fn,
  If,
  max,
  modelWorldMatrix,
  min,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vec2Uniform } from '../../render/globals.ts';
import type { RGB } from '../gfx/palette.ts';
import type { TemplateTrack } from './track.ts';

export const MAX_WELLS = 3;

export interface SpaceGridOptions {
  resolution: Vec2Uniform;
  layout: 'square' | 'polar';
  /** Half-size (square) or outer radius (polar), world units. */
  extent: number;
  /** Square: lines per direction. Polar: rings. */
  lines?: number;
  /** Polar: radial spokes. */
  spokes?: number;
  /** Points per line. */
  segments?: number;
  /** Polar: innermost ring radius. */
  inner?: number;
  /** Polar: where the spokes start (default: inner). */
  spokeInner?: number;
  colour: RGB;
  /** Colour crests of the wave lean toward. */
  crestColour?: RGB;
  /** Core width, reference pixels. */
  width?: number;
  depthTest?: boolean;
  /** Enables the outgoing binary field. */
  wave?: TemplateTrack;
}

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export interface SpaceGrid {
  mesh: Mesh;
  opacity: FloatU;
  /** Wells: x, z, depth, softening radius. Edit, then commitWells(). */
  wells: Vector4[];
  commitWells(): void;
  /** In-plane strain of a wave arriving along y (exaggerated by the caller). */
  hp: FloatU;
  hc: FloatU;
  /** Height of the binary field at its reference radius (0 = off). */
  spiral: FloatU;
  /** Data time of the field (s, 0 = merger). */
  spiralT: FloatU;
  /** Display wave speed, world units per data second. */
  spiralSpeed: FloatU;
  /** Radius inside which the field is not drawn (the near zone, around the bodies). */
  spiralInner: FloatU;
  /** Brightening of wave crests (per unit of wave height). */
  crest: FloatU;
  /** Lines fade out from this fraction of the extent to the edge. */
  fade: FloatU;
  /** Above this wave frequency (Hz) the drawn height falls as 1/f (brightness keeps the full amplitude). */
  fRef: FloatU;
  dispose(): void;
}

const EXTENT = 4;

export function createSpaceGrid(o: SpaceGridOptions): SpaceGrid {
  const pos: number[] = [];
  const nb: number[] = [];
  const index: number[] = [];
  const segs = o.segments ?? 160;
  const R = o.extent;
  let base = 0;
  const addLine = (pts: [number, number][], closed: boolean) => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const a = pts[i > 0 ? i - 1 : closed ? n - 2 : 0]!;
      const b = pts[i < n - 1 ? i + 1 : closed ? 1 : n - 1]!;
      for (const side of [-1, 1]) {
        pos.push(p[0], side, p[1]);
        nb.push(a[0], a[1], b[0], b[1]);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const k = base + i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    base += n * 2;
  };
  if (o.layout === 'square') {
    const L = o.lines ?? 31;
    for (let dir = 0; dir < 2; dir++)
      for (let j = 0; j < L; j++) {
        const c = -R + (2 * R * j) / (L - 1);
        const pts: [number, number][] = [];
        for (let i = 0; i <= segs; i++) {
          const s = -R + (2 * R * i) / segs;
          pts.push(dir === 0 ? [s, c] : [c, s]);
        }
        addLine(pts, false);
      }
  } else {
    const rings = o.lines ?? 24;
    const r0 = o.inner ?? R * 0.04;
    for (let j = 0; j < rings; j++) {
      const r = r0 + ((R - r0) * j) / (rings - 1);
      const pts: [number, number][] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      addLine(pts, true);
    }
    const spokes = o.spokes ?? 48;
    for (let j = 0; j < spokes; j++) {
      const a = (j / spokes) * Math.PI * 2;
      const pts: [number, number][] = [];
      const n = Math.round(segs * 0.6);
      const s0 = o.spokeInner ?? r0;
      for (let i = 0; i <= n; i++) {
        const r = s0 + ((R - s0) * i) / n;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      addLine(pts, false);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aNb', new Float32BufferAttribute(nb, 4));
  geo.setIndex(index);

  const opacity = uniform(1);
  const hp = uniform(0);
  const hc = uniform(0);
  const spiral = uniform(0);
  const spiralT = uniform(-1);
  const spiralSpeed = uniform(10);
  const spiralInner = uniform(0.5);
  const crest = uniform(0.6);
  const fade = uniform(0.72);
  const fRef = uniform(32);
  const wells = Array.from({ length: MAX_WELLS }, () => new Vector4(0, 0, 0, 1));
  const uWells = uniformArray(wells, 'vec4');
  const wave = o.wave;

  /** Displaced local position of plane point q = (x, z); w = height used for brightness. */
  const displace = (q: Node<'vec2'>) => {
    const x = q.x.add(hp.mul(q.x).add(hc.mul(q.y)).mul(0.5));
    const z = q.y.add(hc.mul(q.x).sub(hp.mul(q.y)).mul(0.5));
    let y: Node<'float'> = float(0);
    let h: Node<'float'> = float(0);
    for (let k = 0; k < MAX_WELLS; k++) {
      const wv = uWells.element(k) as unknown as Node<'vec4'>;
      const d = q.sub(wv.xy);
      y = y.sub(wv.z.div(sqrt(float(1).add(d.dot(d).div(wv.w.mul(wv.w))))));
    }
    if (wave) {
      const r = q.length();
      const phi = atan(q.y, q.x);
      const s = wave.sample(spiralT.sub(r.div(spiralSpeed)));
      const ref = spiralInner.mul(2);
      const env = smoothstep(spiralInner, spiralInner.mul(1.8), r).mul(sqrt(ref.div(max(r, ref))));
      h = spiral.mul(s.y).mul(env).mul(cos(phi.mul(2).sub(s.x)));
      // Height (not brightness) eases off above fRef so short wavelengths do not turn the sheet into spikes.
      y = y.add(h.mul(min(float(1), fRef.div(max(s.z, 1)))));
    }
    return vec4(x, y, z, h);
  };

  const p3 = attribute<'vec3'>('position', 'vec3');
  const aNb = attribute<'vec4'>('aNb', 'vec4');
  const dC = displace(p3.xz);
  const dP = displace(aNb.xy);
  const dN = displace(aNb.zw);
  const toWorld = (d: Node<'vec4'>) => modelWorldMatrix.mul(vec4(d.xyz, 1));
  const vp = cameraProjectionMatrix.mul(cameraViewMatrix);
  const cC = vp.mul(toWorld(dC));
  const cP = vp.mul(toWorld(dP));
  const cN = vp.mul(toWorld(dN));
  const res = o.resolution;
  const aspect = res.x.div(res.y);
  const ndcDir = cN.xy.div(cN.w).sub(cP.xy.div(cP.w)).mul(vec2(aspect, 1));
  const dir = ndcDir.div(max(ndcDir.length(), 1e-6));
  const normal = vec2(dir.y.negate(), dir.x.div(aspect)).negate();
  const refPx = res.x.mul(res.y).sqrt().div(1000).mul(2).div(res.y);
  const half = float((o.width ?? 1.3) * 0.5 * EXTENT).mul(refPx);
  const side = p3.y;
  const clip = vec4(cC.xy.add(normal.mul(side).mul(half).mul(cC.w)), cC.z, cC.w);

  const vSide = varying(side, 'gSide');
  const vR = varying(p3.xz.length(), 'gR');
  const vH = varying(dC.w, 'gH');
  const d = vSide.abs().mul(EXTENT);
  const core = float(1).sub(smoothstep(0.55, 1.25, d));
  const halo = exp(d.mul(d).mul(-0.3)).mul(0.3);
  const edge = float(1).sub(smoothstep(fade.mul(R), float(R), vR));
  // Crests of the wave light up (tinted), troughs dim: the field reads from above, where height cannot.
  const up = max(vH, 0).mul(crest);
  const down = max(vH.negate(), 0).mul(crest).mul(0.5);
  const lum = core
    .add(halo)
    .mul(edge)
    .mul(max(float(1).add(up).sub(down), 0.12))
    .mul(opacity);
  const tint = o.crestColour ?? o.colour;
  const k = up.div(up.add(1));
  const colour = vec3(o.colour[0], o.colour[1], o.colour[2]).mul(float(1).sub(k)).add(vec3(tint[0], tint[1], tint[2]).mul(k)).mul(lum);
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    blending: AdditiveBlending,
  });
  mat.vertexNode = clip;
  mat.colorNode = Fn(() => {
    If(lum.lessThan(0.003), () => {
      Discard();
    });
    return vec4(colour, 1);
  })();
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;

  return {
    mesh,
    opacity,
    wells,
    commitWells() {
      // uniformArray holds the same Vector4 objects: nothing to copy.
    },
    hp,
    hc,
    spiral,
    spiralT,
    spiralSpeed,
    spiralInner,
    crest,
    fade,
    fRef,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Height of a single well at distance r (CPU mirror of the shader, for placing bodies on the sheet). */
export function wellHeight(depth: number, soft: number, r: number): number {
  return -depth / Math.sqrt(1 + (r * r) / (soft * soft));
}
