// Global TSL uniforms shared by every scene, updated once per frame. The chirp uniforms mirror the ChirpFrame so
// shaders can follow the sound (playhead, envelope, flashes) with no per-frame CPU work.

import { Vector2 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { ChirpFrame } from '../audio/schedule.ts';

const _mkFloat = () => uniform(0);
const _mkVec2 = () => uniform(new Vector2());
export type FloatUniform = ReturnType<typeof _mkFloat>;
export type Vec2Uniform = ReturnType<typeof _mkVec2>;

export interface GlobalUniforms {
  /** Wall-clock seconds (idle motion); stops under reduced motion. */
  uElapsed: FloatUniform;
  /** Active stage progress 0–1. */
  uLocal: FloatUniform;
  /** Render-target pixels. */
  uResolution: Vec2Uniform;
  /** Data time of the playhead in the clip (s, 0 = merger); holds after the clip ends. */
  uChirpT: FloatUniform;
  /** 0–1 through the clip playing (1 after it ends). */
  uChirpProgress: FloatUniform;
  /** 1 while a clip plays. */
  uChirpPlaying: FloatUniform;
  /** Seconds since the last clip ended (0 while playing, large before any). */
  uChirpSinceEnd: FloatUniform;
  /** 1 while sound is audible. */
  uAudible: FloatUniform;
  update(local: number, elapsed: number): void;
  updateChirp(c: ChirpFrame): void;
  setResolution(w: number, h: number): void;
  dispose(): void;
}

const NEVER = 1e4;

export function createGlobalUniforms(): GlobalUniforms {
  const u: GlobalUniforms = {
    uElapsed: uniform(0),
    uLocal: uniform(0),
    uResolution: uniform(new Vector2(1, 1)),
    uChirpT: uniform(0),
    uChirpProgress: uniform(0),
    uChirpPlaying: uniform(0),
    uChirpSinceEnd: uniform(NEVER),
    uAudible: uniform(0),
    update(local, elapsed) {
      u.uElapsed.value = elapsed;
      u.uLocal.value = local;
    },
    updateChirp(c) {
      u.uChirpT.value = c.t;
      u.uChirpProgress.value = c.progress;
      u.uChirpPlaying.value = c.playing ? 1 : 0;
      u.uChirpSinceEnd.value = Math.min(NEVER, c.sinceEnd);
      u.uAudible.value = c.audible ? 1 : 0;
    },
    setResolution(w, h) {
      u.uResolution.value.set(w, h);
    },
    dispose() {},
  };
  return u;
}
