// Coloured glowing beads (the catalogue, mass beads): camera-facing quads, one colour, radius and brightness per
// bead, updated in place. Radius is in world units with a screen-space floor; a bead can also carry a ring (hollow
// bead: a candidate without parameters, or the selection marker).

import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial, Uint32BufferAttribute } from 'three/webgpu';
import { attribute, cameraPosition, cross, Discard, exp, float, Fn, If, max, mix, normalize, smoothstep, uniform, vec3, vec4, vertexStage } from 'three/tsl';
import type { Node } from 'three/webgpu';

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export interface Beads {
  mesh: Mesh;
  count: number;
  /** Place bead i (world): radius r (world units), brightness b (0 hides), ring 0 = filled … 1 = hollow ring. */
  set(i: number, x: number, y: number, z: number, r: number, b: number, ring?: number): void;
  colour(i: number, red: number, green: number, blue: number): void;
  commit(): void;
  intensity: FloatU;
  /** Smallest radius as a fraction of the camera distance. */
  minSize: FloatU;
  dispose(): void;
}

export function createBeads(count: number, opts: { intensity?: number; minSize?: number } = {}): Beads {
  const centre = new Float32Array(count * 4 * 4);
  const look = new Float32Array(count * 4 * 4);
  const corner = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geo = new BufferGeometry();
  const aCentre = new BufferAttribute(centre, 4);
  const aLook = new BufferAttribute(look, 4);
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 4 * 3), 3));
  geo.setAttribute('aCentre', aCentre);
  geo.setAttribute('aLook', aLook);
  geo.setAttribute('aCorner', new Float32BufferAttribute(corner, 2));
  geo.setIndex(new Uint32BufferAttribute(index, 1));
  const intensity = uniform(opts.intensity ?? 1.2);
  const minSize = uniform(opts.minSize ?? 0.004);
  const c4 = attribute<'vec4'>('aCentre', 'vec4');
  const l4 = attribute<'vec4'>('aLook', 'vec4');
  const c = c4.xyz;
  const k = attribute<'vec2'>('aCorner', 'vec2');
  const toCam = normalize(cameraPosition.sub(c));
  const right = normalize(cross(vec3(0, 1, 0), toCam).add(vec3(1e-6, 0, 0)));
  const up = cross(toCam, right);
  // aCentre.w = radius; aLook = colour + packed brightness and ring (see set()).
  const rad = max(c4.w, cameraPosition.sub(c).length().mul(minSize));
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide });
  // The quad reaches 2.2 radii so the halo has room.
  mat.positionNode = c.add(right.mul(k.x).mul(rad).mul(2.2)).add(up.mul(k.y).mul(rad).mul(2.2));
  const kf = vertexStage(k.mul(2.2)) as unknown as Node<'vec2'>;
  const col = vertexStage(l4.xyz) as unknown as Node<'vec3'>;
  const b = vertexStage(l4.w) as unknown as Node<'float'>;
  const bright = b.floor().div(64);
  const ring = b.fract().mul(2).clamp(0, 1);
  const d2 = kf.dot(kf);
  const d = d2.sqrt();
  const disc = exp(d2.mul(-2.2)).add(exp(d2.mul(-0.5)).mul(0.18));
  const rr = d.sub(0.85).div(0.16);
  const hollow = exp(rr.mul(rr).negate()).add(exp(d2.mul(-0.5)).mul(0.1));
  const glow = mix(disc, hollow, ring).mul(float(1).sub(smoothstep(4.0, 4.8, d2)));
  mat.colorNode = Fn(() => {
    const a = glow.mul(bright);
    If(a.lessThan(0.003), () => {
      Discard();
    });
    return vec4(col.mul(a).mul(intensity), 1);
  })();
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  return {
    mesh,
    count,
    intensity,
    minSize,
    set(i, x, y, z, r, br, ringAmt = 0) {
      // Brightness quantised to 1/64 in the integer part, ring 0–1 in [0, 0.5) of the fraction.
      const packed = Math.round(Math.max(0, Math.min(1023, br * 64))) + Math.max(0, Math.min(0.499, ringAmt * 0.5));
      for (let v = 0; v < 4; v++) {
        const o = (i * 4 + v) * 4;
        centre[o] = x;
        centre[o + 1] = y;
        centre[o + 2] = z;
        centre[o + 3] = r;
        look[o + 3] = packed;
      }
    },
    colour(i, red, green, blue) {
      for (let v = 0; v < 4; v++) {
        const o = (i * 4 + v) * 4;
        look[o] = red;
        look[o + 1] = green;
        look[o + 2] = blue;
      }
    },
    commit() {
      aCentre.needsUpdate = true;
      aLook.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
