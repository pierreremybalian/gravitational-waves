// Rewritable luminous polylines for the rhythm kit. Like src/shared/gfx/lines.ts (constant on-screen width, core +
// halo, additive), but the geometry can be rewritten in place at any time (a section change, or every frame for
// trails) without allocating or recompiling, and every point carries `u`: where it sits in time (0–1 through its
// cycle). A per-slot "sweep" lights the stretch of a line the hand has just passed, so rings, spokes and polygon sides
// glow exactly behind the playhead with no per-frame CPU work beyond one uniform.
//
// Each polyline belongs to a slot; a slot's uniforms place it and light it:
//   world = model · (x + scale·R(rot)·(px, py), y + …, z + pz·zScale)
//   colour = rgb·k · intensity · (core + halo) · (1 + sweepGain·e^(−sweepDecay·fract(sweepPhase − u))) · e^(−fade·u)
// for points with u ≤ uTo (k: an optional per-point brightness, for gradients along a line).

import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial, Vector4 } from 'three/webgpu';
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  Discard,
  exp,
  float,
  Fn,
  fract,
  If,
  max,
  modelWorldMatrix,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vec2Uniform } from '../../render/globals.ts';
import type { RGB } from '../gfx/palette.ts';

export interface LineSlot {
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Radians, counter-clockwise about the axle (z). */
  rot: number;
  /** 0 hides. */
  intensity: number;
  /** Cycle phase of the playhead for the sweep afterglow. */
  sweepPhase: number;
  /** 0 = no sweep. */
  sweepGain: number;
  /** Brightness × e^(−fade·u). */
  fade: number;
  /** Multiplies the data-space z (trails: depth per bar). */
  zScale: number;
  /** Multiplies the written width. */
  width: number;
  /** Points with u > uTo are hidden. */
  uTo: number;
  /** Sweep afterglow decay per turn of lag (default 12; larger = shorter glint). */
  sweepDecay: number;
}

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export interface RhythmLines {
  mesh: Mesh;
  readonly slots: LineSlot[];
  /** Global multiplier. */
  opacity: FloatU;
  /** Drop every line (then begin/point/end, then upload). */
  clear(): void;
  /** Start a polyline in `slot`. Width in reference pixels (≈ px on a 1000 px screen). */
  begin(slot: number, colour: RGB, width?: number, closed?: boolean): void;
  /** Append a point in the slot's data space; u = time position 0–1 (sweep, fade, uTo); k scales its colour. */
  point(x: number, y: number, z: number, u: number, k?: number): void;
  end(): void;
  /** Send the rewritten geometry to the GPU. */
  upload(): void;
  /** Write the slot state into the uniforms (once per frame). */
  commit(): void;
  /** Points written since clear(). */
  readonly used: number;
  dispose(): void;
}

export interface RhythmLinesOptions {
  resolution: Vec2Uniform;
  /** Points (default 4096). */
  capacity?: number;
  /** Slots (default 64). */
  slots?: number;
}

const EXTENT = 4;

export function defaultSlot(): LineSlot {
  return { x: 0, y: 0, z: 0, scale: 1, rot: 0, intensity: 1, sweepPhase: 0, sweepGain: 0, fade: 0, zScale: 1, width: 1, uTo: 1, sweepDecay: 12 };
}

export function createRhythmLines(opts: RhythmLinesOptions): RhythmLines {
  const cap = opts.capacity ?? 4096;
  const nSlots = opts.slots ?? 64;
  const V = cap * 2;
  const pos = new Float32Array(V * 3);
  const prev = new Float32Array(V * 4);
  const next = new Float32Array(V * 4);
  const style = new Float32Array(V * 4);
  const index = new Uint32Array(cap * 6);
  const geo = new BufferGeometry();
  const aPos = new BufferAttribute(pos, 3);
  const aPrevA = new BufferAttribute(prev, 4);
  const aNextA = new BufferAttribute(next, 4);
  const aStyleA = new BufferAttribute(style, 4);
  // BufferAttribute (the typed subclasses copy their input) so writes land in the arrays bound to the GPU.
  const aIndex = new BufferAttribute(index, 1);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aPrev', aPrevA);
  geo.setAttribute('aNext', aNextA);
  geo.setAttribute('aStyle', aStyleA);
  geo.setIndex(aIndex);
  const ATTRS = [aPos, aPrevA, aNextA, aStyleA];
  geo.setDrawRange(0, 0);

  const slots = Array.from({ length: nSlots }, defaultSlot);
  const S0 = slots.map(() => new Vector4(0, 0, 0, 1));
  const S1 = slots.map(() => new Vector4(1, 0, 0, 0));
  const S2 = slots.map(() => new Vector4(0, 1, 1, 1));
  const S3 = slots.map(() => new Vector4(12, 0, 0, 0));
  const uS0 = uniformArray(S0, 'vec4'); // x, y, z, scale
  const uS1 = uniformArray(S1, 'vec4'); // rot, intensity, sweepPhase, sweepGain
  const uS2 = uniformArray(S2, 'vec4'); // fade, zScale, width, uTo
  const uS3 = uniformArray(S3, 'vec4'); // sweepDecay, –, –, –
  const opacity = uniform(1);

  const p3 = attribute<'vec3'>('position', 'vec3');
  const pv = attribute<'vec4'>('aPrev', 'vec4');
  const nx = attribute<'vec4'>('aNext', 'vec4');
  const st = attribute<'vec4'>('aStyle', 'vec4');
  const sid = nx.w.toInt();
  const s0 = uS0.element(sid) as unknown as Node<'vec4'>;
  const s1 = uS1.element(sid) as unknown as Node<'vec4'>;
  const s2 = uS2.element(sid) as unknown as Node<'vec4'>;
  const s3 = uS3.element(sid) as unknown as Node<'vec4'>;
  const cr = cos(s1.x);
  const sr = sin(s1.x);
  const xf = (px: Node<'float'>, py: Node<'float'>, pz: Node<'float'>) => {
    const qx = px.mul(s0.w);
    const qy = py.mul(s0.w);
    return modelWorldMatrix.mul(vec4(s0.x.add(cr.mul(qx)).sub(sr.mul(qy)), s0.y.add(sr.mul(qx)).add(cr.mul(qy)), s0.z.add(pz.mul(s2.y)), 1));
  };
  const vp = cameraProjectionMatrix.mul(cameraViewMatrix);
  const cC = vp.mul(xf(p3.x, p3.y, p3.z));
  const cP = vp.mul(xf(pv.x, pv.y, pv.z));
  const cN = vp.mul(xf(nx.x, nx.y, nx.z));
  const res = opts.resolution;
  const aspect = res.x.div(res.y);
  const ndcDir = cN.xy.div(cN.w).sub(cP.xy.div(cP.w)).mul(vec2(aspect, 1));
  const dir = ndcDir.div(max(ndcDir.length(), 1e-6));
  const normal = vec2(dir.y.negate(), dir.x.div(aspect)).negate();
  const refPx = res.x.mul(res.y).sqrt().div(1000).mul(2).div(res.y);
  const side = st.w.sign();
  const half = st.w.abs().mul(0.5).mul(s2.z).mul(refPx).mul(EXTENT);
  const clip = vec4(cC.xy.add(normal.mul(side).mul(half).mul(cC.w)), cC.z, cC.w);

  const vSide = varying(side, 'vRlSide');
  const vU = varying(pv.w, 'vRlU');
  const vA = varying(vec4(s1.y, s1.z, s1.w, s2.x), 'vRlA');
  const vTo = varying(vec2(s2.w, s3.x), 'vRlTo');
  const vCol = varying(st.xyz, 'vRlCol');

  const d = vSide.abs().mul(EXTENT);
  const core = float(1).sub(smoothstep(0.55, 1.25, d));
  const halo = exp(d.mul(d).mul(-0.3)).mul(0.32);
  const lag = fract(vA.y.sub(vU));
  const sweep = float(1).add(vA.z.mul(exp(lag.mul(vTo.y).negate())));
  const fadeK = exp(vA.w.mul(vU).negate());
  const shown = step(vU, vTo.x.add(1e-5));
  const amount = core.add(halo).mul(vA.x).mul(sweep).mul(fadeK).mul(shown).mul(opacity);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  mat.vertexNode = clip;
  mat.colorNode = Fn(() => {
    If(amount.lessThan(0.002), () => {
      Discard();
    });
    return vec4(vCol.mul(amount), 1);
  })();
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  // ── Writer ──
  let n = 0; // points written
  let idx = 0; // indices written
  let lineStart = 0;
  let lineClosed = false;
  let lineSlot = 0;
  let lr = 1;
  let lg = 1;
  let lb = 1;
  let lw = 2;
  let open = false;
  let firstK = 1;

  const finish = () => {
    const a = lineStart;
    const count = n - a;
    if (count < 2) {
      n = a;
      return;
    }
    // A closed line repeats its first point so the seam is one more segment.
    if (lineClosed) {
      if (n >= cap) return;
      const s = a * 2 * 3;
      const s4 = a * 2 * 4;
      writeVerts(pos[s]!, pos[s + 1]!, pos[s + 2]!, prev[s4 + 3]! + 1, firstK);
    }
    const end = n;
    for (let i = a; i < end; i++) {
      const ip = i > a ? i - 1 : lineClosed ? end - 2 : a;
      const inx = i < end - 1 ? i + 1 : lineClosed ? a + 1 : end - 1;
      for (let k = 0; k < 2; k++) {
        const o4 = (i * 2 + k) * 4;
        const op = ip * 2 * 3;
        const on = inx * 2 * 3;
        prev[o4] = pos[op]!;
        prev[o4 + 1] = pos[op + 1]!;
        prev[o4 + 2] = pos[op + 2]!;
        next[o4] = pos[on]!;
        next[o4 + 1] = pos[on + 1]!;
        next[o4 + 2] = pos[on + 2]!;
        next[o4 + 3] = lineSlot;
      }
    }
    for (let i = a; i < end - 1; i++) {
      if (idx + 6 > index.length) break;
      const k = i * 2;
      index[idx++] = k;
      index[idx++] = k + 1;
      index[idx++] = k + 2;
      index[idx++] = k + 1;
      index[idx++] = k + 3;
      index[idx++] = k + 2;
    }
  };

  function writeVerts(x: number, y: number, z: number, u: number, kb: number) {
    if (n === lineStart) firstK = kb;
    for (let k = 0; k < 2; k++) {
      const v = n * 2 + k;
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      prev[v * 4 + 3] = u;
      style[v * 4] = lr * kb;
      style[v * 4 + 1] = lg * kb;
      style[v * 4 + 2] = lb * kb;
      style[v * 4 + 3] = k === 0 ? -lw : lw;
    }
    n++;
  }

  const api: RhythmLines = {
    mesh,
    slots,
    opacity,
    get used() {
      return n;
    },
    clear() {
      n = 0;
      idx = 0;
      open = false;
    },
    begin(slot, colour, width = 2, closed = false) {
      if (open) finish();
      open = true;
      lineStart = n;
      lineClosed = closed;
      lineSlot = Math.min(nSlots - 1, Math.max(0, slot));
      lr = colour[0];
      lg = colour[1];
      lb = colour[2];
      lw = Math.max(0.05, width);
    },
    point(x, y, z, u, k = 1) {
      if (!open || n >= cap - 1) return;
      writeVerts(x, y, z, u, k);
    },
    end() {
      if (!open) return;
      open = false;
      finish();
    },
    upload() {
      if (open) api.end();
      const verts = n * 2;
      for (let q = 0; q < ATTRS.length; q++) {
        const attr = ATTRS[q]!;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(attr.itemSize, verts * attr.itemSize));
        attr.needsUpdate = true;
      }
      aIndex.clearUpdateRanges();
      aIndex.addUpdateRange(0, Math.max(1, idx));
      aIndex.needsUpdate = true;
      geo.setDrawRange(0, idx);
    },
    commit() {
      for (let i = 0; i < nSlots; i++) {
        const s = slots[i]!;
        S0[i]!.set(s.x, s.y, s.z, s.scale);
        S1[i]!.set(s.rot, s.intensity, s.sweepPhase, s.sweepGain);
        S2[i]!.set(s.fade, s.zScale, s.width, s.uTo);
        S3[i]!.x = s.sweepDecay;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
  return api;
}
