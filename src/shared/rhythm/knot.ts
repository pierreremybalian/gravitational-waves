// Luminous lines on a torus, computed on the GPU from angle space. Every line is straight in (θ, φ):
//   θ(t) = th0 + th1·t (around the ring),  φ(t) = ph0 + ph1·t (around the tube),  t ∈ [0, 1]
// so the (p, q) knot (th1 = 2πp/g, ph1 = 2πq/g), a meridian hoop (th1 = 0), the outer equator (ph1 = 0) and the
// wireframe are all the same primitive, and changing the ratio is a uniform write. The point is placed exactly as
// torusPoint() places it (src/rhythm/analysis.ts):
//   x = (R + r cos φ) cos θ,   y = r sin φ,   z = (R + r cos φ) sin θ
// `morph` flattens the torus edge-on into the plane z = 0 while the tube's offset vanishes and its height grows to
// flatY, so the knot becomes the Lissajous figure (R cos 2πps, flatY sin 2πqs) and the hoop and equator become the
// figure's right edge and midline.
//
// Lines have a constant on-screen width, a comet trail behind a head parameter (Δ = fract(head − t), so the trail
// wraps round closed curves), a reveal window, and depth cueing (the far side of the torus dims). With `mask`, a
// wider black ribbon writes depth first, so where two strands cross in the picture the farther one is cut: the
// over/under of a knot diagram.
//
// Used by the knot and harmony stages and the instrument's Knot view.

import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial, NormalBlending, Vector4 } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  exp,
  float,
  fract,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalize,
  sin,
  smoothstep,
  step,
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

const _f = () => uniform(0);
export type FloatU = ReturnType<typeof _f>;

/** The torus every line of a scene lives on (shared uniforms). */
export interface TorusFrame {
  R: FloatU;
  r: FloatU;
  /** 0 = torus, 1 = flattened edge-on into the Lissajous plane. */
  morph: FloatU;
  /** Half-height of the flattened figure. */
  flatY: FloatU;
  /** Brightness of the nearest and farthest points of the torus (depth cue). */
  near: FloatU;
  far: FloatU;
}

export function createTorusFrame(R: number, r: number): TorusFrame {
  return { R: uniform(R), r: uniform(r), morph: uniform(0), flatY: uniform(R), near: uniform(1.15), far: uniform(0.4) };
}

/** CPU twin of the shader's placement (beads, labels). */
export function torusXYZ(R: number, r: number, morph: number, flatY: number, th: number, ph: number, lift: number, out: [number, number, number]): [number, number, number] {
  const im = 1 - morph;
  const ring = R + r * lift * im * Math.cos(ph);
  out[0] = ring * Math.cos(th);
  out[1] = (r * lift + (flatY - r * lift) * morph) * Math.sin(ph);
  out[2] = ring * Math.sin(th) * im;
  return out;
}

export interface TorusLineSpec {
  segments: number;
  colour: RGB;
  /** Core width in reference pixels (≈ px on a 1000 px screen). */
  width?: number;
  intensity?: number;
  /** Radius above the tube's axis in tube radii (1 = on the surface). */
  lift?: number;
  /** Brightness away from the trail (0–1). */
  base?: number;
}

export interface TorusLineState {
  th0: number;
  th1: number;
  ph0: number;
  ph1: number;
  colour: [number, number, number];
  intensity: number;
  width: number;
  /** 0–1: brighter and a little wider. */
  highlight: number;
  lift: number;
  base: number;
  /** t of the comet head. */
  head: number;
  /** Trail length in t (e-folding); negative = a symmetric spot of that half-width around the head. */
  trail: number;
  trailGain: number;
  /** Visible for t ≤ reveal. */
  reveal: number;
}

export interface TorusLines {
  mesh: Mesh;
  /** Depth-writing black ribbons (render before everything luminous), when created with mask. */
  maskMesh: Mesh | null;
  state: TorusLineState[];
  opacity: FloatU;
  commit(): void;
  dispose(): void;
}

const EXTENT = 4;
/** Mask ribbon half-width in core half-widths. */
const MASK = 3.2;
/** Luminous pass nudged toward the camera (world units) so it wins the depth test against its own mask. */
const BIAS = 0.025;

export function createTorusLines(specs: readonly TorusLineSpec[], frame: TorusFrame, opts: { resolution: Vec2Uniform; mask?: boolean; depthTest?: boolean }): TorusLines {
  const pos: number[] = [];
  const index: number[] = [];
  let base = 0;
  specs.forEach((sp, li) => {
    const n = sp.segments + 1;
    for (let i = 0; i < n; i++) {
      const t = i / sp.segments;
      pos.push(t, -1, li, t, 1, li);
    }
    for (let i = 0; i < n - 1; i++) {
      const k = base + i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    base += n * 2;
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(index);

  const state: TorusLineState[] = specs.map((sp) => ({
    th0: 0,
    th1: 0,
    ph0: 0,
    ph1: 0,
    colour: [sp.colour[0], sp.colour[1], sp.colour[2]],
    intensity: sp.intensity ?? 1,
    width: sp.width ?? 1.5,
    highlight: 0,
    lift: sp.lift ?? 1,
    base: sp.base ?? 1,
    head: 0,
    trail: 0,
    trailGain: 0,
    reveal: 1,
  }));
  const A = specs.map(() => new Vector4());
  const B = specs.map(() => new Vector4());
  const C = specs.map(() => new Vector4());
  const D = specs.map(() => new Vector4());
  const uA = uniformArray(A, 'vec4');
  const uB = uniformArray(B, 'vec4');
  const uC = uniformArray(C, 'vec4');
  const uD = uniformArray(D, 'vec4');
  const opacity = uniform(1);

  const a = attribute<'vec3'>('position', 'vec3');
  const t = a.x;
  const side = a.y;
  const lid = a.z.toInt();
  const ang = uA.element(lid) as unknown as Node<'vec4'>; // th0, th1, ph0, ph1
  const col = uB.element(lid) as unknown as Node<'vec4'>; // r, g, b, intensity
  const sty = uC.element(lid) as unknown as Node<'vec4'>; // width, highlight, lift, base
  const trl = uD.element(lid) as unknown as Node<'vec4'>; // head, trail, trailGain, reveal
  const { R, r, morph, flatY } = frame;
  const im = float(1).sub(morph);
  const lift = sty.z;
  const yAmp = mix(r.mul(lift), flatY, morph);
  const at = (tt: Node<'float'>) => {
    const th = ang.x.add(ang.y.mul(tt));
    const ph = ang.z.add(ang.w.mul(tt));
    const ring = R.add(r.mul(lift).mul(im).mul(cos(ph)));
    return vec3(ring.mul(cos(th)), yAmp.mul(sin(ph)), ring.mul(sin(th)).mul(im));
  };
  const eps = 1 / 4096;
  const wOf = (p: Node<'vec3'>) => modelWorldMatrix.mul(vec4(p, 1)).xyz;
  const wC0 = wOf(at(t));
  const wP0 = wOf(at(t.sub(eps)));
  const wN0 = wOf(at(t.add(eps)));
  const vp = cameraProjectionMatrix.mul(cameraViewMatrix);
  const res = opts.resolution;
  const aspect = res.x.div(res.y);
  const refPx = res.x.mul(res.y).sqrt().div(1000).mul(2).div(res.y);

  const ribbon = (bias: number, halfMul: Node<'float'>) => {
    const nudge = (w: Node<'vec3'>) => (bias ? w.add(normalize(cameraPosition.sub(w)).mul(bias)) : w);
    const cC = vp.mul(vec4(nudge(wC0), 1));
    const cP = vp.mul(vec4(nudge(wP0), 1));
    const cN = vp.mul(vec4(nudge(wN0), 1));
    const ndcDir = cN.xy.div(cN.w).sub(cP.xy.div(cP.w)).mul(vec2(aspect, 1));
    const dir = ndcDir.div(max(ndcDir.length(), 1e-6));
    const normal = vec2(dir.y.negate(), dir.x.div(aspect)).negate();
    const half = sty.x.mul(0.5).mul(refPx).mul(halfMul);
    return vec4(cC.xy.add(normal.mul(side).mul(half).mul(cC.w)), cC.z, cC.w);
  };

  // Depth cue: −1 at the near side of the torus, +1 at the far side.
  const viewZ = (w: Node<'vec3'>) => cameraViewMatrix.mul(vec4(w, 1)).z;
  const centreZ = viewZ(modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz);
  const cue = clamp(centreZ.sub(viewZ(wC0)).div(R.add(r)), -1, 1);
  const vCue = varying(mix(frame.near, frame.far, cue.mul(0.5).add(0.5)), 'vCue');

  const vT = varying(t, 'vT');
  const vSide = varying(side, 'vSide');
  const vCol = varying(col, 'vCol');
  const vSty = varying(vec2(sty.y, sty.w), 'vSty');
  const vTrl = varying(trl, 'vTrl');

  const d = vSide.abs().mul(EXTENT);
  const core = float(1).sub(smoothstep(0.55, 1.25, d));
  const halo = exp(d.mul(d).mul(-0.3)).mul(0.32);
  const hl = vSty.x;
  // trail > 0: a comet tail behind the head; trail < 0: a symmetric spot around it (a flash at a crossing).
  const behind = fract(vTrl.x.sub(vT));
  const ahead = fract(vT.sub(vTrl.x));
  const delta = mix(behind, min(behind, ahead), step(vTrl.y, 0));
  const tr = vTrl.z.mul(exp(delta.div(max(vTrl.y.abs(), 1e-4)).negate()));
  const shown = step(vT, vTrl.w.add(1e-5));
  const lum = core.mul(float(1).add(hl.mul(0.8))).add(halo.mul(float(1).add(hl)));
  const hot = clamp(tr.mul(0.18), 0, 0.85);
  const rgb = mix(vCol.xyz, vec3(1, 0.97, 0.92), hot.mul(core));
  const colour = rgb.mul(vCol.w).mul(vSty.y.add(tr)).mul(lum).mul(vCue).mul(shown).mul(opacity);

  // Lines that must be cut by a mask (their own or another set's) depth-test, nudged toward the camera.
  const tested = opts.depthTest ?? !!opts.mask;
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: tested, blending: AdditiveBlending });
  mat.vertexNode = ribbon(tested ? BIAS : 0, float(EXTENT).mul(float(1).add(sty.y.mul(0.6))));
  mat.colorNode = vec4(colour, 1);
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  let maskMesh: Mesh | null = null;
  let maskMat: MeshBasicNodeMaterial | null = null;
  if (opts.mask) {
    maskMat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true, blending: NormalBlending });
    maskMat.vertexNode = ribbon(0, float(MASK));
    // Hidden parts of the line (unrevealed) must not cut anything.
    const mShown = step(vT, vTrl.w.add(1e-5)).mul(step(0.01, opacity));
    maskMat.colorNode = vec4(0, 0, 0, 1);
    maskMat.opacityNode = mShown;
    maskMat.alphaTest = 0.5;
    maskMesh = new Mesh(geo, maskMat);
    maskMesh.frustumCulled = false;
    maskMesh.renderOrder = -10;
  }

  return {
    mesh,
    maskMesh,
    state,
    opacity,
    commit() {
      for (let i = 0; i < state.length; i++) {
        const s = state[i]!;
        A[i]!.set(s.th0, s.th1, s.ph0, s.ph1);
        B[i]!.set(s.colour[0], s.colour[1], s.colour[2], s.intensity);
        C[i]!.set(s.width, s.highlight, s.lift, s.base);
        D[i]!.set(s.head, s.trail, s.trailGain, s.reveal);
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      maskMat?.dispose();
    },
  };
}
