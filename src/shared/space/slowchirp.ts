// Slowed chirps for the orbit stages (4–6). At real speed the orbit turns 7–85 times a second: too fast to see. These
// clips stretch a stretch of the best-fit template in time by `slow` while keeping its pitch (the tone at each moment
// is the template's own gravitational-wave frequency, times `pitch` for small speakers) and its loudness envelope:
//   s(τ) = A(t) · sin(2π · pitch · ∫ f(t(τ')) dτ'),   t = from + τ / slow.
// The clip is registered on the transport with speed = 1 / slow, so ctx.chirp.t is the data time being heard and the
// orbit, the spiral and the sound share one clock. Modelled (template, no noise) and stated in each stage note.

import { transport } from '../../audio/transport.ts';
import { sampleAt } from '../../gw/binary.ts';
import type { SlowChirpSpec } from '../../script/slow.ts';
import type { TemplateTrack } from './track.ts';

const FS = 16384;
const FADE = 0.06;

/** Register the clip once (idempotent). */
export function defineSlowChirp(spec: SlowChirpSpec, tt: TemplateTrack): void {
  if (transport.info(spec.id)) return;
  const { f, amp, t0, fs } = tt.track;
  const dur = (spec.to - spec.from) * spec.slow;
  const n = Math.round(dur * FS);
  const data = new Float32Array(n);
  let ph = 0;
  let peak = 0;
  for (let j = 0; j < n; j++) {
    const t = spec.from + j / FS / spec.slow;
    const fj = sampleAt(f, t0, fs, t);
    ph += (2 * Math.PI * spec.pitch * fj) / FS;
    if (ph > 1e4) ph -= 2 * Math.PI * Math.floor(ph / (2 * Math.PI));
    const a = sampleAt(amp!, t0, fs, t);
    const tau = j / FS;
    const env = Math.min(1, tau / FADE, (dur - tau) / FADE);
    const v = a * Math.sin(ph) * Math.max(0, env);
    data[j] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const k = peak > 0 ? 0.89 / peak : 1;
  for (let j = 0; j < n; j++) data[j]! *= k;
  transport.define({ id: spec.id, duration: dur, t0: spec.from, speed: 1 / spec.slow }, { kind: 'samples', data, fs: FS }, spec.gain);
}
