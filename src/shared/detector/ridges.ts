// A field of luminous ridge lines (the noise landscape): rows of polylines over a grid (x across, z along the rows),
// each vertex with two heights, h0 and h1, morphed on the GPU by one uniform (raw spectrum → whitened spectrum). The
// ribbons face the camera with a world width floored in screen space, like the glow lines. Rows can be revealed
// along z, columns faded outside a band (the band-pass), and each vertex carries a "hot" weight per height set
// (excess over the noise) that brightens it.
//
// World position of vertex (x, h, z) = offset + (x · sx, mix(h0, h1, morph) · sy, z · sz). The mesh itself stays at the
// identity transform.

import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { attribute, cameraPosition, cross, Discard, exp, float, Fn, If, max, mix, normalize, smoothstep, uniform, vec3, vec4, vertexStage } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { RGB } from '../gfx/palette.ts';

export interface RidgeInput {
  rows: number;
  cols: number;
  /** Column x (data units), length cols. */
  x: ArrayLike<number>;
  /** Row z (data units), length rows. */
  z: ArrayLike<number>;
  /** Heights rows × cols, row-major (data units). */
  h0: ArrayLike<number>;
  h1: ArrayLike<number>;
  /** 0–1 brightness boosts per height set (rows × cols), optional. */
  hot0?: ArrayLike<number>;
  hot1?: ArrayLike<number>;
  cool: RGB;
  hot: RGB;
  /** World half-width of a ribbon and its screen-space floor (fraction of distance). */
  width?: number;
  minPx?: number;
}

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export interface Ridges {
  mesh: Mesh;
  /** 0 → h0, 1 → h1. */
  morph: FloatU;
  /** Overall brightness. */
  intensity: FloatU;
  /** Rows with z in [zFrom, zTo] (data units) are drawn; soft edge `zSoft`. */
  zFrom: FloatU;
  zTo: FloatU;
  zSoft: FloatU;
  /** Columns outside [xLo, xHi] fade to `outside` (the band-pass); soft edge `xSoft`. */
  xLo: FloatU;
  xHi: FloatU;
  xSoft: FloatU;
  outside: FloatU;
  /** Scale of the hot weights. */
  hotGain: FloatU;
  /** World = offset + (x, h, z) · scale. */
  scale: { value: Vector3 };
  offset: { value: Vector3 };
  dispose(): void;
}

export function createRidges(r: RidgeInput): Ridges {
  const { rows, cols } = r;
  const nV = rows * cols * 2;
  const pos = new Float32Array(nV * 3);
  const nb = new Float32Array(nV * 4);
  const alt = new Float32Array(nV * 4);
  const meta = new Float32Array(nV * 4);
  const index: number[] = [];
  for (let ro = 0; ro < rows; ro++) {
    for (let c = 0; c < cols; c++) {
      const k = ro * cols + c;
      const kp = ro * cols + Math.max(0, c - 1);
      const kn = ro * cols + Math.min(cols - 1, c + 1);
      for (let s = 0; s < 2; s++) {
        const v = k * 2 + s;
        pos[v * 3] = r.x[c]!;
        pos[v * 3 + 1] = r.h0[k]!;
        pos[v * 3 + 2] = r.z[ro]!;
        nb[v * 4] = r.x[Math.max(0, c - 1)]!;
        nb[v * 4 + 1] = r.h0[kp]!;
        nb[v * 4 + 2] = r.x[Math.min(cols - 1, c + 1)]!;
        nb[v * 4 + 3] = r.h0[kn]!;
        alt[v * 4] = r.h1[k]!;
        alt[v * 4 + 1] = r.h1[kp]!;
        alt[v * 4 + 2] = r.h1[kn]!;
        alt[v * 4 + 3] = s ? 1 : -1;
        meta[v * 4] = r.hot0?.[k] ?? 0;
        meta[v * 4 + 1] = r.hot1?.[k] ?? 0;
        meta[v * 4 + 2] = c / (cols - 1);
        meta[v * 4 + 3] = ro / Math.max(1, rows - 1);
      }
    }
    for (let c = 0; c < cols - 1; c++) {
      const a = (ro * cols + c) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aNb', new Float32BufferAttribute(nb, 4));
  geo.setAttribute('aAlt', new Float32BufferAttribute(alt, 4));
  geo.setAttribute('aMeta', new Float32BufferAttribute(meta, 4));
  geo.setIndex(index);

  const morph = uniform(0);
  const intensity = uniform(1);
  const zFrom = uniform(-1e9);
  const zTo = uniform(1e9);
  const zSoft = uniform(0.05);
  const xLo = uniform(-1e9);
  const xHi = uniform(1e9);
  const xSoft = uniform(0.05);
  const outside = uniform(1);
  const hotGain = uniform(1);
  const scale = uniform(new Vector3(1, 1, 1));
  const offset = uniform(new Vector3(0, 0, 0));

  const p = attribute<'vec3'>('position', 'vec3');
  const n4 = attribute<'vec4'>('aNb', 'vec4');
  const a4 = attribute<'vec4'>('aAlt', 'vec4');
  const m4 = attribute<'vec4'>('aMeta', 'vec4');
  const toWorld = (x: Node<'float'>, h0: Node<'float'>, h1: Node<'float'>, z: Node<'float'>) => vec3(x, mix(h0, h1, morph), z).mul(scale).add(offset);
  const c = toWorld(p.x, p.y, a4.x, p.z);
  const prev = toWorld(n4.x, n4.y, a4.y, p.z);
  const next = toWorld(n4.z, n4.w, a4.z, p.z);
  const tan = normalize(next.sub(prev).add(vec3(1e-6, 0, 0)));
  const toCam = normalize(cameraPosition.sub(c));
  const sideDir = normalize(cross(tan, toCam).add(vec3(0, 1e-6, 0)));
  const halfW = max(float(r.width ?? 0.006), cameraPosition.sub(c).length().mul(r.minPx ?? 0.0012));
  const side = a4.w;
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide });
  mat.positionNode = c.add(sideDir.mul(side).mul(halfW));

  const vSide = vertexStage(side) as unknown as Node<'float'>;
  const vX = vertexStage(p.x) as unknown as Node<'float'>;
  const vZ = vertexStage(p.z) as unknown as Node<'float'>;
  const vHot = vertexStage(mix(m4.x, m4.y, morph)) as unknown as Node<'float'>;
  const vC = vertexStage(m4.z) as unknown as Node<'float'>;
  const sq = vSide.div(0.35);
  const core = exp(sq.mul(sq).negate());
  const halo = exp(vSide.mul(vSide).mul(2.2).negate()).mul(0.22);
  const rowsOn = smoothstep(zFrom.sub(zSoft), zFrom, vZ).mul(float(1).sub(smoothstep(zTo, zTo.add(zSoft), vZ)));
  const inBand = smoothstep(xLo.sub(xSoft), xLo, vX).mul(float(1).sub(smoothstep(xHi, xHi.add(xSoft), vX)));
  const band = mix(outside, float(1), inBand);
  const hot = vHot.mul(hotGain).clamp(0, 3);
  const col = mix(vec3(...r.cool), vec3(...r.hot), hot.clamp(0, 1)).mul(float(1).add(hot.mul(1.4)));
  // Faint edge columns so the field does not end in a hard wall.
  const edge = smoothstep(0, 0.04, vC).mul(smoothstep(0, 0.04, float(1).sub(vC)));
  const lum = core.add(halo).mul(rowsOn).mul(band).mul(edge).mul(intensity);
  mat.colorNode = Fn(() => {
    If(lum.lessThan(0.003), () => {
      Discard();
    });
    return vec4(col.mul(lum), 1);
  })();
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return {
    mesh,
    morph,
    intensity,
    zFrom,
    zTo,
    zSoft,
    xLo,
    xHi,
    xSoft,
    outside,
    hotGain,
    scale: scale as unknown as { value: Vector3 },
    offset: offset as unknown as { value: Vector3 },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
