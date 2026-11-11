// Glowing beads for the rhythm kit: camera-facing dots with their own colour, size, brightness and shape, rewritten
// in place every frame (no allocation). Shape 0 is a filled bead (a hit), 1 a hollow ring (a rest), 2 a soft disc
// with a bright rim (a playhead). The radius is in world units with a floor in screen space, so far beads stay visible.

import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  Discard,
  exp,
  float,
  Fn,
  If,
  max,
  mix,
  modelWorldMatrix,
  smoothstep,
  step,
  uniform,
  varying,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export const BEAD_FILLED = 0;
export const BEAD_HOLLOW = 1;
export const BEAD_PLAYHEAD = 2;

export interface Beads {
  mesh: Mesh;
  /** Global multiplier. */
  opacity: FloatU;
  /**
   * Write bead i: centre (mesh space), radius (world units), colour (linear HDR), brightness, shape (BEAD_*).
   * Returns i + 1 so callers can chain a cursor.
   */
  set(i: number, x: number, y: number, z: number, radius: number, r: number, g: number, b: number, brightness: number, shape?: number): number;
  /** Draw beads 0 … count−1. */
  commit(count: number): void;
  readonly capacity: number;
  dispose(): void;
}

export interface BeadsOptions {
  /** Smallest on-screen radius as a fraction of the distance to the camera (default 0.0045). */
  minScreen?: number;
}

export function createBeads(capacity: number, opts: BeadsOptions = {}): Beads {
  const V = capacity * 4;
  const centre = new Float32Array(V * 3);
  const corner = new Float32Array(V * 4);
  const colour = new Float32Array(V * 4);
  const index = new Uint32Array(capacity * 6);
  const CX = [-1, 1, 1, -1];
  const CY = [-1, -1, 1, 1];
  for (let i = 0; i < capacity; i++) {
    for (let v = 0; v < 4; v++) {
      corner[(i * 4 + v) * 4] = CX[v]!;
      corner[(i * 4 + v) * 4 + 1] = CY[v]!;
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geo = new BufferGeometry();
  const aCentre = new BufferAttribute(centre, 3);
  const aCorner = new BufferAttribute(corner, 4);
  const aColour = new BufferAttribute(colour, 4);
  geo.setAttribute('position', aCentre);
  geo.setAttribute('aCorner', aCorner);
  geo.setAttribute('aColour', aColour);
  geo.setIndex(new BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const ATTRS = [aCentre, aCorner, aColour];

  const opacity = uniform(1);
  const minK = opts.minScreen ?? 0.0045;
  const c = attribute<'vec3'>('position', 'vec3');
  const k = attribute<'vec4'>('aCorner', 'vec4');
  const col = attribute<'vec4'>('aColour', 'vec4');
  const view = cameraViewMatrix.mul(modelWorldMatrix).mul(vec4(c, 1));
  const rad = max(k.z, view.z.negate().mul(minK));
  const clip = cameraProjectionMatrix.mul(vec4(view.xy.add(k.xy.mul(rad)), view.z, 1));
  const vK = varying(k.xy, 'vBdK') as unknown as Node<'vec2'>;
  const vShape = varying(k.w, 'vBdShape') as unknown as Node<'float'>;
  const vCol = varying(col, 'vBdCol') as unknown as Node<'vec4'>;
  const d2 = vK.dot(vK);
  const d = d2.sqrt();
  const filled = exp(d2.mul(-9)).mul(1.15).add(exp(d2.mul(-2.6)).mul(0.28));
  const rr = d.sub(0.5).div(0.11);
  const hollow = exp(rr.mul(rr).negate()).mul(0.85).add(exp(d2.mul(-3)).mul(0.07));
  const pr = d.sub(0.42).div(0.14);
  const play = exp(pr.mul(pr).negate()).mul(0.9).add(exp(d2.mul(-6)).mul(0.9)).add(exp(d2.mul(-2)).mul(0.2));
  const isHollow = step(0.5, vShape).mul(step(vShape, 1.5));
  const isPlay = step(1.5, vShape);
  const shape = mix(mix(filled, hollow, isHollow), play, isPlay).mul(float(1).sub(smoothstep(0.82, 1, d2)));
  const amount = shape.mul(vCol.w).mul(opacity);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide });
  mat.vertexNode = clip;
  mat.colorNode = Fn(() => {
    If(amount.lessThan(0.003), () => {
      Discard();
    });
    return vec4(vCol.xyz.mul(amount), 1);
  })();
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;

  return {
    mesh,
    opacity,
    capacity,
    set(i, x, y, z, radius, r, g, b, brightness, shape = 0) {
      if (i >= capacity) return i;
      for (let v = 0; v < 4; v++) {
        const o = i * 4 + v;
        centre[o * 3] = x;
        centre[o * 3 + 1] = y;
        centre[o * 3 + 2] = z;
        corner[o * 4 + 2] = radius;
        corner[o * 4 + 3] = shape;
        colour[o * 4] = r;
        colour[o * 4 + 1] = g;
        colour[o * 4 + 2] = b;
        colour[o * 4 + 3] = brightness;
      }
      return i + 1;
    },
    commit(count) {
      const n = Math.min(count, capacity);
      for (let q = 0; q < ATTRS.length; q++) {
        const attr = ATTRS[q]!;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(attr.itemSize, n * 4 * attr.itemSize));
        attr.needsUpdate = true;
      }
      geo.setDrawRange(0, n * 6);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
