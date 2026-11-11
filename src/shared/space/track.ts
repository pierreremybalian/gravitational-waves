// The GW150914 best-fit template as a GPU lookup: phase, normalised amplitude and frequency against data time, so a
// shader can ask "what was the wave doing at the retarded time t − r/c" (the outgoing spiral) with no per-frame CPU
// work. Also the CPU-side Track for binaryAt (src/gw/binary.ts). Loaded once per scene in init().

import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three/webgpu';
import { float, floor, ivec2, max, min, mix, textureLoad, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Track } from '../../gw/binary.ts';
import { GW150914, loadSeries } from '../gwdata.ts';

export interface TemplateTrack {
  /** CPU track for binaryAt (template-freq / template-phase / template-amp, 4096 Hz). */
  track: Track;
  /** Peak of template-amp (strain ×1e21). */
  ampPeak: number;
  /** Strain at H1 (×1e21), same axis. */
  strain: Float32Array;
  /** RGBA float texture: phase (rad), amp / peak, frequency (Hz), 0; TEX_FS samples per second from TEX_T0. */
  texture: DataTexture;
  /** TSL: sample (phase, amp, f, 0) at data time t (linear interpolation, clamped to the window). */
  sample(t: Node<'float'>): Node<'vec4'>;
  dispose(): void;
}

const TEX_W = 512;
/** Texture samples per data second (the template is decimated from 4096 Hz). */
export const TEX_FS = 2048;

let cached: Promise<{ f: Float32Array; phase: Float32Array; amp: Float32Array; strain: Float32Array }> | null = null;

function loadRaw() {
  cached ??= Promise.all([
    loadSeries('template-freq'),
    loadSeries('template-phase'),
    loadSeries('template-amp'),
    loadSeries('template-strain-H1'),
  ]).then(([f, phase, amp, strain]) => ({ f, phase, amp, strain }));
  cached.catch(() => (cached = null));
  return cached;
}

/** Build the template track (CPU arrays shared; the texture is per call: dispose it with the scene). */
export async function loadTemplateTrack(): Promise<TemplateTrack> {
  const { f, phase, amp, strain } = await loadRaw();
  const w = GW150914.window;
  let ampPeak = 0;
  for (let i = 0; i < amp.length; i++) ampPeak = Math.max(ampPeak, amp[i]!);
  const step = Math.round(w.fs / TEX_FS);
  const n = Math.floor(amp.length / step);
  const rows = Math.ceil(n / TEX_W);
  const data = new Float32Array(TEX_W * rows * 4);
  for (let i = 0; i < n; i++) {
    const j = i * step;
    data[i * 4] = phase[j]!;
    data[i * 4 + 1] = amp[j]! / ampPeak;
    data[i * 4 + 2] = f[j]!;
  }
  const texture = new DataTexture(data, TEX_W, rows, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  const t0 = w.t0;
  const last = n - 2;
  const fetch = (i: Node<'float'>) => {
    const y = floor(i.div(TEX_W));
    const x = i.sub(y.mul(TEX_W));
    return textureLoad(texture, ivec2(x.toInt(), y.toInt())) as unknown as Node<'vec4'>;
  };
  const sample = (t: Node<'float'>): Node<'vec4'> => {
    const x = min(max(t.sub(t0).mul(TEX_FS), float(0)), float(last));
    const i0 = floor(x);
    const a = fetch(i0);
    const b = fetch(i0.add(1));
    return vec4(mix(a, b, x.sub(i0)));
  };
  return {
    track: { t0, fs: w.fs, f, phase, amp },
    ampPeak,
    strain,
    texture,
    sample,
    dispose() {
      texture.dispose();
    },
  };
}
