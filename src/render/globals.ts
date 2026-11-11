// Global TSL uniforms shared by every scene, updated once per frame. Music uniforms mirror the MusicFrame so shaders
// can flash on hits with no per-frame CPU work: per layer i, uLayerAge[i >> 2][i & 3] is seconds since its last hit.

import { Vector2, Vector4 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { MusicFrame } from '../rhythm/frame.ts';
import { MAX_LAYERS } from '../rhythm/pattern.ts';

const _mkFloat = () => uniform(0);
const _mkVec2 = () => uniform(new Vector2());
const _mkVec4 = () => uniform(new Vector4());
export type FloatUniform = ReturnType<typeof _mkFloat>;
export type Vec2Uniform = ReturnType<typeof _mkVec2>;
export type Vec4Uniform = ReturnType<typeof _mkVec4>;

const QUADS = MAX_LAYERS / 4;

export interface GlobalUniforms {
  /** Wall-clock seconds (idle motion); stops under reduced motion. */
  uElapsed: FloatUniform;
  /** Active stage progress 0–1. */
  uLocal: FloatUniform;
  /** Render-target pixels. */
  uResolution: Vec2Uniform;
  /** Bar phase 0–1. */
  uMusicPhase: FloatUniform;
  /** Master cycles per second. */
  uMusicRate: FloatUniform;
  /** 1 while sound is audible. */
  uAudible: FloatUniform;
  /** Per-layer cycle phase, 4 layers per vec4. */
  uLayerPhase: Vec4Uniform[];
  /** Per-layer seconds since the last hit (large when none). */
  uLayerAge: Vec4Uniform[];
  /** Per-layer gain × on. */
  uLayerGain: Vec4Uniform[];
  update(local: number, elapsed: number): void;
  updateMusic(m: MusicFrame): void;
  setResolution(w: number, h: number): void;
  dispose(): void;
}

const NEVER = 1e4;

export function createGlobalUniforms(): GlobalUniforms {
  const quad = () => Array.from({ length: QUADS }, () => uniform(new Vector4()));
  const u: GlobalUniforms = {
    uElapsed: uniform(0),
    uLocal: uniform(0),
    uResolution: uniform(new Vector2(1, 1)),
    uMusicPhase: uniform(0),
    uMusicRate: uniform(0),
    uAudible: uniform(0),
    uLayerPhase: quad(),
    uLayerAge: quad(),
    uLayerGain: quad(),
    update(local, elapsed) {
      u.uElapsed.value = elapsed;
      u.uLocal.value = local;
    },
    updateMusic(m) {
      u.uMusicPhase.value = m.phase;
      u.uMusicRate.value = m.rate;
      u.uAudible.value = m.audible ? 1 : 0;
      for (let q = 0; q < QUADS; q++) {
        const ph = u.uLayerPhase[q]!.value;
        const ag = u.uLayerAge[q]!.value;
        const gn = u.uLayerGain[q]!.value;
        for (let c = 0; c < 4; c++) {
          const i = q * 4 + c;
          const on = i < m.layers && m.layerOn[i];
          ph.setComponent(c, m.layerPhase[i]!);
          ag.setComponent(c, on ? Math.min(NEVER, m.onsetAge[i]!) : NEVER);
          gn.setComponent(c, on ? m.layerGain[i]! : 0);
        }
      }
    },
    setResolution(w, h) {
      u.uResolution.value.set(w, h);
    },
    dispose() {},
  };
  return u;
}
