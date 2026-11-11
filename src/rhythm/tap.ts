// Tap scoring against the committed score (the instrument's "Tap along"). A tap is timed in transport seconds at the
// ear (the transport's clock at the input event's timeStamp), and scored against the nearest onset of one layer as it
// was committed (the timeline and tempo map the sequencer actually played), so a tempo glide or a section change is
// scored exactly as heard. Pure: no DOM, no Web Audio.

import type { TempoMap } from './tempo.ts';
import type { Entry, Timeline } from './timeline.ts';

/** The parts of a Sequencer the scorer reads. */
export interface ScoreSource {
  readonly tempo: TempoMap;
  readonly timeline: Timeline;
}

export interface NearestOnset {
  /** Transport seconds of the onset. */
  time: number;
  /** Musical position (master cycles) of the onset. */
  pos: number;
  /** Step of the onset within the layer cycle. */
  step: number;
  /** Steps in the layer cycle. */
  steps: number;
  /** Signed error of the tap, seconds (positive = late: the tap came after the onset). */
  error: number;
  /** Layer-cycle phase (0–1) of the tap itself, for drawing it on the layer's ring. */
  tapPhase: number;
  /** Section key the onset belongs to. */
  key: string;
}

const frac = (x: number) => x - Math.floor(x);

/**
 * Nearest onset of `layer` to transport time T in the committed score, or null when the layer is not playing there.
 * Looks up to one layer cycle back and forward from T. A layer keeps its index across committed changes (the
 * instrument's edits), so the search continues into the entry before or after the one in force.
 */
export function nearestOnset(src: ScoreSource, layer: number, T: number, out?: NearestOnset): NearestOnset | null {
  const pos = src.tempo.posAt(T);
  const e = src.timeline.at(pos);
  if (!e) return null;
  best.dt = Infinity;
  best.e = null;
  scan(src, e, layer, pos, T, -1);
  scan(src, e, layer, pos, T, 1);
  // The nearest hit may lie across a committed boundary (an edit just landed, or is about to).
  const prev = src.timeline.at(e.atPos - 1e-9);
  if (prev && prev !== e) scan(src, prev, layer, e.atPos - 1e-9, T, -1);
  const next = src.timeline.next(e);
  if (next) scan(src, next, layer, next.atPos - 1e-9, T, 1);
  const be = best.e as Entry | null;
  const c = be?.c;
  if (!be || !c) return null;
  const n = c.steps[layer]!;
  const o = out ?? ({} as NearestOnset);
  o.time = best.t;
  o.pos = best.pos;
  o.step = ((best.k % n) + n) % n;
  o.steps = n;
  o.error = T - best.t;
  // Phase of the tap on the ring of the entry in force (or the onset's entry when the layer is silent at T).
  const ec = e.c && layer < e.c.steps.length ? e : be;
  o.tapPhase = frac(((pos - ec.anchor) * ec.c!.G) / ec.c!.cycleTicks[layer]!);
  o.key = c.key;
  return o;
}

const best: { dt: number; t: number; pos: number; k: number; e: Entry | null } = { dt: Infinity, t: 0, pos: 0, k: 0, e: null };

/** The first hit of `layer` in entry e from position `from`, going back (dir −1, at or before) or forward (+1, after). */
function scan(src: ScoreSource, e: Entry, layer: number, from: number, T: number, dir: 1 | -1): void {
  const c = e.c;
  if (!c || layer >= c.steps.length || !((e.mask >> layer) & 1)) return;
  const ts = c.tickStep[layer]!;
  const n = c.steps[layer]!;
  const hits = c.section.layers[layer]!.hits;
  const next = src.timeline.next(e);
  const end = next ? next.atPos : Infinity;
  const k0 = Math.floor(((from - e.anchor) * c.G) / ts + 1e-9) + (dir > 0 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const k = k0 + dir * i;
    const p = e.anchor + (k * ts) / c.G;
    if (p < e.atPos - 1e-9 || p >= end - 1e-9) return;
    if (!hits[((k % n) + n) % n]) continue;
    const t = src.tempo.timeAt(p);
    const dt = Math.abs(T - t);
    if (dt < best.dt) {
      best.dt = dt;
      best.t = t;
      best.pos = p;
      best.k = k;
      best.e = e;
    }
    return;
  }
}

/** Running scores over the most recent taps (a fixed window, so old habits age out). */
export class TapScore {
  private readonly errs: Float64Array;
  private head = 0;
  private n = 0;
  /** Taps since the last reset (the window holds the last `capacity`). */
  count = 0;

  constructor(readonly capacity = 32) {
    this.errs = new Float64Array(capacity);
  }

  add(errorS: number): void {
    this.errs[this.head] = errorS;
    this.head = (this.head + 1) % this.capacity;
    this.n = Math.min(this.capacity, this.n + 1);
    this.count++;
  }

  reset(): void {
    this.head = 0;
    this.n = 0;
    this.count = 0;
  }

  /** Taps in the window. */
  get size(): number {
    return this.n;
  }

  /** Mean signed error over the window, ms (positive = late). */
  get meanMs(): number {
    if (!this.n) return 0;
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.errs[i]!;
    return (s / this.n) * 1000;
  }

  /** Spread (standard deviation) over the window, ms. */
  get spreadMs(): number {
    if (this.n < 2) return 0;
    const m = this.meanMs / 1000;
    let v = 0;
    for (let i = 0; i < this.n; i++) v += (this.errs[i]! - m) ** 2;
    return Math.sqrt(v / this.n) * 1000;
  }
}
