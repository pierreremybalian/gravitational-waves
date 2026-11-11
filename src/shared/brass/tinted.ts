// The brass outline look with a colour per part (stages 8–9 and the finale's Gears view). Same technique as
// outline.ts (a G-buffer of dark fill, view normal and an ident vector, then edges from depth, normal creases and
// part-id changes), but every part id indexes a shared palette, so each loop gear is drawn in its layer's colour and
// can flash on its own hits while the frame stays brass. Palette entry i: rgb = line colour (HDR, includes its gain),
// w = fill gain. Scenes write the entries every frame (no allocation); the material and the composite read them.

import { FrontSide, MeshBasicNodeMaterial, NearestFilter, NodeMaterial, QuadMesh, Vector2, Vector4, type Camera, type RenderTarget, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  dot,
  float,
  Fn,
  length,
  max,
  mix,
  mrt,
  normalView,
  normalize,
  output,
  pass,
  perspectiveDepthToViewZ,
  pow,
  select,
  smoothstep,
  step,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { RGB } from '../gfx/palette.ts';
import type { FloatU } from './material.ts';

export const PALETTE_SIZE = 48;

export interface PartPalette {
  readonly entries: Vector4[];
  readonly node: ReturnType<typeof uniformArray>;
  /** Line colour (HDR) and fill gain of part i. */
  set(i: number, c: RGB, gain: number, fill: number): void;
}

export function createPartPalette(): PartPalette {
  const entries = Array.from({ length: PALETTE_SIZE }, () => new Vector4(0.79, 0.48, 0.13, 1));
  const node = uniformArray(entries, 'vec4');
  return {
    entries,
    node,
    set(i, c, gain, fill) {
      entries[i]!.set(c[0] * gain, c[1] * gain, c[2] * gain, fill);
    },
  };
}

const entryOf = (p: PartPalette, id: Node<'float'>) => p.node.element(clamp(id.add(0.5), 0, PALETTE_SIZE - 1).toInt()) as unknown as Node<'vec4'>;

/** The dark solid fill, tinted by the part's palette colour; writes the ident the composite reads. */
export function createTintedMaterial(p: PartPalette): MeshBasicNodeMaterial {
  const part = attribute<'float'>('aPart', 'float');
  const e = entryOf(p, part);
  const n = normalize(normalView);
  const key = normalize(vec3(-0.45, 0.65, 0.6));
  const diffuse = max(dot(n, key), 0);
  const rim = pow(float(1).sub(abs(n.z)), 3);
  const hue = e.xyz.div(max(max(e.x, e.y), max(e.z, 1e-3)));
  const shade = float(0.016).add(diffuse.mul(0.05)).add(rim.mul(0.05)).mul(e.w);
  const m = new MeshBasicNodeMaterial({ side: FrontSide });
  m.colorNode = vec4(hue.mul(shade), 1);
  m.mrtNode = mrt({ ident: vec4(part, 1, 0, e.w) as unknown as Node<'vec4'> });
  return m;
}

export interface TintedOutlineOptions {
  linePx?: number;
  bgTop?: RGB;
  bgBottom?: RGB;
  resolutionScale?: number;
}

export interface TintedOutline {
  render(target: RenderTarget | null, overlay?: Scene | null): void;
  setSize(width: number, height: number, dpr: number): void;
  compile(overlay?: Scene | null): Promise<void>;
  /** Global line multiplier (fades the whole machine). */
  readonly gain: FloatU;
  dispose(): void;
}

export function createTintedOutline(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera & { near: number; far: number },
  palette: PartPalette,
  o: TintedOutlineOptions = {},
): TintedOutline {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: vec4(normalize(normalView), 1), ident: vec4(0) }));
  scenePass.setResolutionScale(o.resolutionScale ?? 1);
  const tOut = scenePass.getTextureNode('output');
  const tNormal = scenePass.getTextureNode('normal');
  const tIdent = scenePass.getTextureNode('ident');
  // Part ids are categories: never blend two ids into a third (a hammer next to the bridge must not read as a gear).
  const identTex = scenePass.getTexture('ident');
  identTex.minFilter = NearestFilter;
  identTex.magFilter = NearestFilter;
  const tDepth = scenePass.getTextureNode('depth');

  const uTexel = uniform(new Vector2(1 / 1280, 1 / 720));
  const uLinePx = uniform(o.linePx ?? 1.2);
  const uNear = uniform(0.02);
  const uFar = uniform(400);
  const gain = uniform(1);
  const top = o.bgTop ?? [0.007, 0.008, 0.014];
  const bottom = o.bgBottom ?? [0.002, 0.002, 0.004];

  type V2 = Node<'vec2'>;
  const linZ = (q: V2) => perspectiveDepthToViewZ(tDepth.sample(q).x, uNear, uFar).negate();
  const cover = (q: V2) => step(tDepth.sample(q).x, 0.99999);
  const nrm = (q: V2) => tNormal.sample(q).xyz;

  const composite = Fn(() => {
    const p = uv();
    const px = uTexel.mul(uLinePx.mul(0.5));
    const cov = cover(p);
    const d0 = linZ(p);
    const n0 = nrm(p);
    const id0 = tIdent.sample(p);
    const o1 = vec2(px.x, px.y);
    const o2 = vec2(px.x, px.y.negate());
    const g = length(vec2(linZ(p.sub(o1)).sub(linZ(p.add(o1))), linZ(p.sub(o2)).sub(linZ(p.add(o2)))));
    const ndv = abs(n0.z).mul(cov);
    const tD = float(0.0025).mul(float(1).add(float(3).mul(float(1).sub(ndv))));
    const eD = smoothstep(tD, tD.mul(2.2), g.div(max(d0, 1e-3)));
    const eN = float(0).toVar();
    const eI = float(0).toVar();
    // The line takes the colour of the nearest covered sample in the kernel (the front part at a silhouette).
    const bestZ = select(cov.greaterThan(0.5), d0, float(1e9)).toVar();
    const bestId = id0.x.toVar();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const q = p.add(vec2(px.x.mul(dx), px.y.mul(dy)));
      const c1 = cover(q);
      const id1 = tIdent.sample(q);
      const z1 = select(c1.greaterThan(0.5), linZ(q), float(1e9));
      eN.assign(max(eN, float(1).sub(dot(n0, nrm(q))).mul(c1).mul(cov)));
      eI.assign(max(eI, step(0.5, abs(id0.x.sub(id1.x))).mul(c1).mul(cov)));
      const nearer = z1.lessThan(bestZ.sub(1e-4));
      bestId.assign(select(nearer, id1.x, bestId));
      bestZ.assign(select(nearer, z1, bestZ));
    }
    const crease = float(1 - Math.cos((30 * Math.PI) / 180));
    const e = max(max(eD, smoothstep(crease, crease.mul(1.8), eN)), eI);
    const bg = mix(vec3(bottom[0], bottom[1], bottom[2]), vec3(top[0], top[1], top[2]), p.y);
    const fill = tOut.sample(p).rgb;
    const any = step(bestZ, 1e8);
    const lineC = entryOf(palette, bestId).xyz.mul(e).mul(any).mul(gain);
    return vec4(mix(bg, fill, cov).add(lineC), 1);
  })();

  const mat = new NodeMaterial();
  mat.fragmentNode = composite;
  mat.depthTest = false;
  mat.depthWrite = false;
  const quad = new QuadMesh(mat);

  return {
    gain,
    render(target, overlay) {
      uNear.value = camera.near;
      uFar.value = camera.far;
      renderer.setRenderTarget(target);
      quad.render(renderer);
      if (overlay) {
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(overlay, camera);
        renderer.autoClear = auto;
      }
    },
    async compile(overlay) {
      // PassNode.compileAsync (r186) builds the solids' pipelines without the MRT outputs; they compile on first use.
      if (overlay) await renderer.compileAsync(overlay, camera);
    },
    setSize(width, height, dpr) {
      uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      uLinePx.value = (o.linePx ?? 1.2) * Math.max(1, dpr);
    },
    dispose() {
      scenePass.dispose();
      mat.dispose();
    },
  };
}
