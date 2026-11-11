// Clips the detector stages define from data at run time (browser): the raw Hanford recording (stage 9), on the same
// 2 s window and clock as the story's chirp clips (t0 = −1.5 s, 0 = the H1 merger). Played as recorded: mean removed,
// 80 ms fades, normalised to the transport's peak level; nothing filtered.

import { transport } from '../../audio/transport.ts';
import { GW150914, loadSeries } from '../gwdata.ts';
import { RAW_CLIP } from '../../script/noise.ts';

let defined: Promise<void> | null = null;

export function ensureRawClip(): Promise<void> {
  defined ??= loadSeries('raw-H1').then((raw) => {
    const { t0, fs } = GW150914.window;
    const from = GW150914.clips['chirp-H1'].t0;
    const i0 = Math.round((from - t0) * fs);
    const n = Math.round(2 * fs);
    const x = raw.slice(i0, i0 + n);
    let m = 0;
    for (let i = 0; i < n; i++) m += x[i]!;
    m /= n;
    const fade = Math.round(0.08 * fs);
    for (let i = 0; i < n; i++) {
      const w = i < fade ? i / fade : i > n - fade ? (n - i) / fade : 1;
      x[i] = (x[i]! - m) * w;
    }
    transport.defineSamples(RAW_CLIP, x, fs, from + (i0 / fs + t0 - from));
  });
  return defined;
}
