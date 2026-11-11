// A waveform ribbon: a data series (strain against data time) drawn as a luminous line with a faint sheet hanging
// from it to its baseline, lit by a playhead. Its points stay in data units (t, value); the shader places them, so
// zooming the time axis or rescaling the value is a uniform change. The part already heard stays brighter while a
// clip plays; the playhead is a hot spot on the curve. Local frame: x = (t − centre) · xScale, y = value · yScale.

import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
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
  modelWorldMatrix,
  smoothstep,
  step,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vec2Uniform } from '../../render/globals.ts';
import type { RGB } from '../gfx/palette.ts';

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export interface RibbonOptions {
  /** Series on a uniform axis: value i at data time t0 + i / fs. */
  data: ArrayLike<number>;
  t0: number;
  fs: number;
  /** Data-time span to build (s). */
  from: number;
  to: number;
  /** Keep every n-th sample (default 1). */
  stride?: number;
  colour: RGB;
  resolution: Vec2Uniform;
  /** Core width, reference pixels. */
  width?: number;
  /** Sheet brightness (0 = no sheet). */
  sheet?: number;
}

export interface Ribbon {
  mesh: Mesh;
  sheet: Mesh | null;
  /** Data time at local x = 0. */
  centre: FloatU;
  xScale: FloatU;
  yScale: FloatU;
  /** Visible half-width in local x (fades at the ends). */
  half: FloatU;
  /** Playhead data time. */
  play: FloatU;
  /** 1 while a clip of this ribbon plays: heard part brighter, playhead hot. */
  active: FloatU;
  /** Playhead glow half-width, data seconds. */
  headWidth: FloatU;
  /** Overall brightness. */
  intensity: FloatU;
  dispose(): void;
}

const EXTENT = 4;

export function createRibbon(o: RibbonOptions): Ribbon {
  const stride = o.stride ?? 1;
  const i0 = Math.max(0, Math.floor((o.from - o.t0) * o.fs));
  const i1 = Math.min(o.data.length - 1, Math.ceil((o.to - o.t0) * o.fs));
  const idx: number[] = [];
  for (let i = i0; i <= i1; i += stride) idx.push(i);
  const n = idx.length;
  const T = (k: number) => o.t0 + idx[Math.min(n - 1, Math.max(0, k))]! / o.fs;
  const V = (k: number) => o.data[idx[Math.min(n - 1, Math.max(0, k))]!]!;

  const centre = uniform(0);
  const xScale = uniform(1);
  const yScale = uniform(1);
  const half = uniform(10);
  const play = uniform(-100);
  const active = uniform(0);
  const headWidth = uniform(0.004);
  const intensity = uniform(1);
  const col = vec3(o.colour[0], o.colour[1], o.colour[2]);

  const place = (t: Node<'float'>, v: Node<'float'>) => modelWorldMatrix.mul(vec4(t.sub(centre).mul(xScale), v.mul(yScale), 0, 1));
  const shade = (t: Node<'float'>) => {
    const x = t.sub(centre).mul(xScale);
    const ends = float(1).sub(smoothstep(half.mul(0.9), half, x.abs()));
    const heard = step(t, play).mul(active);
    const dh = t.sub(play).div(headWidth);
    const head = exp(dh.mul(dh).negate()).mul(active);
    return { ends, heard, head };
  };

  // ── Line ──
  const pos: number[] = [];
  const nb: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < n; k++) {
    for (const side of [-1, 1]) {
      pos.push(T(k), V(k), side);
      nb.push(T(k - 1), V(k - 1), T(k + 1), V(k + 1));
    }
  }
  for (let k = 0; k < n - 1; k++) {
    const b = k * 2;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aNb', new Float32BufferAttribute(nb, 4));
  geo.setIndex(index);
  const p = attribute<'vec3'>('position', 'vec3');
  const q = attribute<'vec4'>('aNb', 'vec4');
  const vp = cameraProjectionMatrix.mul(cameraViewMatrix);
  const cC = vp.mul(place(p.x, p.y));
  const cP = vp.mul(place(q.x, q.y));
  const cN = vp.mul(place(q.z, q.w));
  const res = o.resolution;
  const aspect = res.x.div(res.y);
  const ndcDir = cN.xy.div(cN.w).sub(cP.xy.div(cP.w)).mul(vec2(aspect, 1));
  const dir = ndcDir.div(max(ndcDir.length(), 1e-6));
  const normal = vec2(dir.y.negate(), dir.x.div(aspect)).negate();
  const refPx = res.x.mul(res.y).sqrt().div(1000).mul(2).div(res.y);
  const vT = varying(p.x, 'rbT');
  const sh0 = shade(p.x);
  const headWide = varying(sh0.head, 'rbHw');
  const halfW = float((o.width ?? 1.6) * 0.5 * EXTENT)
    .mul(refPx)
    .mul(float(1).add(headWide.mul(1.2)));
  const clip = vec4(cC.xy.add(normal.mul(p.z).mul(halfW).mul(cC.w)), cC.z, cC.w);
  const vSide = varying(p.z, 'rbSide');
  const d = vSide.abs().mul(EXTENT);
  const core = float(1).sub(smoothstep(0.55, 1.25, d));
  const halo = exp(d.mul(d).mul(-0.3)).mul(0.35);
  const sh = shade(vT);
  const lum = core
    .add(halo)
    .mul(float(0.45).add(active.mul(0.25)).add(sh.heard.mul(0.6)).add(sh.head.mul(4)))
    .mul(sh.ends)
    .mul(intensity);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  mat.vertexNode = clip;
  mat.colorNode = Fn(() => {
    If(lum.lessThan(0.003), () => {
      Discard();
    });
    return vec4(col.mul(lum), 1);
  })();
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;

  // ── Sheet: the curve to its baseline ──
  let sheet: Mesh | null = null;
  let sgeo: BufferGeometry | null = null;
  let smat: MeshBasicNodeMaterial | null = null;
  const sheetGain = o.sheet ?? 0.1;
  if (sheetGain > 0) {
    const sp: number[] = [];
    const si: number[] = [];
    for (let k = 0; k < n; k++) {
      sp.push(T(k), V(k), 1, T(k), 0, 0);
    }
    for (let k = 0; k < n - 1; k++) {
      const b = k * 2;
      si.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    sgeo = new BufferGeometry();
    sgeo.setAttribute('position', new Float32BufferAttribute(sp, 3));
    sgeo.setIndex(si);
    const s = attribute<'vec3'>('position', 'vec3');
    smat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide });
    smat.positionNode = vec3(s.x.sub(centre).mul(xScale), s.y.mul(yScale), 0);
    const vk = varying(s.z, 'rbK');
    const st = shade(s.x);
    const vSh = varying(vec3(st.ends, st.heard, st.head), 'rbSh');
    const a = vk
      .mul(vk)
      .mul(sheetGain)
      .mul(float(0.5).add(vSh.y.mul(0.8)).add(vSh.z.mul(3)))
      .mul(vSh.x)
      .mul(intensity);
    smat.colorNode = Fn(() => {
      If(a.lessThan(0.002), () => {
        Discard();
      });
      return vec4(col.mul(a), 1);
    })();
    sheet = new Mesh(sgeo, smat);
    sheet.frustumCulled = false;
    sheet.renderOrder = 7;
    mesh.add(sheet);
  }

  return {
    mesh,
    sheet,
    centre,
    xScale,
    yScale,
    half,
    play,
    active,
    headWidth,
    intensity,
    dispose() {
      geo.dispose();
      mat.dispose();
      sgeo?.dispose();
      smat?.dispose();
    },
  };
}

/** Value of a uniformly sampled series at data time t (linear; 0 outside). */
export function seriesAt(data: ArrayLike<number>, t0: number, fs: number, t: number): number {
  const x = (t - t0) * fs;
  if (x < 0 || x > data.length - 1) return 0;
  const i = Math.floor(x);
  const u = x - i;
  return data[i]! * (1 - u) + (data[Math.min(data.length - 1, i + 1)] ?? 0) * u;
}
