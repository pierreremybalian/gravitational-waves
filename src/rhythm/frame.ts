// What the picture needs from the music at one instant: per-layer phase, step, time since the last hit, gain and
// rate, read from the committed score at the audible time. Preallocated, filled once per frame. Pure.

import { MAX_LAYERS } from './pattern.ts';
import type { Sequencer } from './sequencer.ts';
import type { Entry } from './timeline.ts';

export interface MusicFrame {
  /** Transport seconds at the listener's ear. */
  t: number;
  /** Musical position, master cycles. */
  pos: number;
  /** Master cycles per second. */
  rate: number;
  /** Bar phase 0–1 (relative to the section anchor). */
  phase: number;
  /** Whole bars since the section started. */
  bar: number;
  /** A section is playing. */
  running: boolean;
  /** Sound is actually coming out (set by the transport). */
  audible: boolean;
  /** Bumps whenever the committed score changes (reduced-motion redraws). */
  revision: number;
  entry: Entry | null;
  /** Layers in the current section. */
  layers: number;
  /** Layer cycle phase 0–1. */
  layerPhase: Float64Array;
  /** Whole layer cycles since the section started. */
  layerCycle: Float64Array;
  /** Current step within the layer cycle. */
  layerStep: Int32Array;
  /** Seconds since the layer's last hit (Infinity if none in this section). */
  onsetAge: Float64Array;
  /** Step of that last hit. */
  onsetStep: Int32Array;
  /** 0 off, 1 hit, 2 accent. */
  onsetAccent: Uint8Array;
  /** Layer is in the mask. */
  layerOn: Uint8Array;
  /** Gain envelope 0–1. */
  layerGain: Float32Array;
  /** Steps per second. */
  layerRate: Float64Array;
  /** 0–1 through the full realignment cycle. */
  realignPhase: number;
  /** Seconds since every layer last started together (Infinity if never). */
  realignAge: number;
}

export function createMusicFrame(): MusicFrame {
  return {
    t: 0,
    pos: 0,
    rate: 0,
    phase: 0,
    bar: 0,
    running: false,
    audible: false,
    revision: 0,
    entry: null,
    layers: 0,
    layerPhase: new Float64Array(MAX_LAYERS),
    layerCycle: new Float64Array(MAX_LAYERS),
    layerStep: new Int32Array(MAX_LAYERS),
    onsetAge: new Float64Array(MAX_LAYERS).fill(Infinity),
    onsetStep: new Int32Array(MAX_LAYERS),
    onsetAccent: new Uint8Array(MAX_LAYERS),
    layerOn: new Uint8Array(MAX_LAYERS),
    layerGain: new Float32Array(MAX_LAYERS),
    layerRate: new Float64Array(MAX_LAYERS),
    realignPhase: 0,
    realignAge: Infinity,
  };
}

const frac = (x: number) => x - Math.floor(x);

export function fillFrame(seq: Sequencer, T: number, out: MusicFrame): void {
  const tempo = seq.tempo;
  const pos = tempo.posAt(T);
  out.t = T;
  out.pos = pos;
  out.rate = tempo.rateAt(T);
  const e = seq.timeline.at(pos);
  if (e !== out.entry) out.revision++;
  out.entry = e;
  const c = e?.c ?? null;
  out.running = !!c;
  if (!e || !c) {
    out.layers = 0;
    out.phase = frac(pos);
    out.bar = Math.floor(pos);
    out.layerOn.fill(0);
    out.onsetAge.fill(Infinity);
    out.realignAge = Infinity;
    return;
  }
  const rel = pos - e.anchor;
  out.phase = frac(rel);
  out.bar = Math.floor(rel);
  const L = c.steps.length;
  out.layers = L;
  const relTick = rel * c.G;
  for (let i = 0; i < MAX_LAYERS; i++) {
    if (i >= L) {
      out.layerOn[i] = 0;
      out.onsetAge[i] = Infinity;
      continue;
    }
    const on = (e.mask >> i) & 1;
    out.layerOn[i] = on;
    const ts = c.tickStep[i]!;
    const n = c.steps[i]!;
    const cyc = relTick / c.cycleTicks[i]!;
    out.layerPhase[i] = frac(cyc);
    out.layerCycle[i] = Math.floor(cyc);
    const k = Math.floor(relTick / ts + 1e-9);
    const st = ((k % n) + n) % n;
    out.layerStep[i] = st;
    out.layerRate[i] = (out.rate * c.G) / ts;
    out.layerGain[i] = seq.gains.at(i, T);
    const prev = c.prevHit[i]![st]!;
    if (!on || prev < 0) {
      out.onsetAge[i] = Infinity;
      out.onsetAccent[i] = 0;
      continue;
    }
    const back = (st - prev + n) % n;
    const onsetPos = e.anchor + ((k - back) * ts) / c.G;
    if (k - back < 0 || onsetPos < e.atPos - 1e-9) {
      out.onsetAge[i] = Infinity;
      out.onsetAccent[i] = 0;
    } else {
      out.onsetAge[i] = Math.max(0, T - tempo.timeAt(onsetPos));
      out.onsetStep[i] = prev;
      out.onsetAccent[i] = c.section.layers[i]!.hits[prev]!;
    }
  }
  const rk = Math.floor(relTick / c.realignTicks + 1e-9);
  out.realignPhase = frac(relTick / c.realignTicks);
  const rPos = e.anchor + (rk * c.realignTicks) / c.G;
  out.realignAge = rk >= 0 && rPos >= e.atPos - 1e-9 ? Math.max(0, T - tempo.timeAt(rPos)) : Infinity;
}

/** A frozen frame for stills and reduced motion without sound: the section at phase 0, no hits lit. */
export function staticFrame(seq: Sequencer, out: MusicFrame): void {
  out.audible = false;
  out.onsetAge.fill(Infinity);
  out.realignAge = Infinity;
  void seq;
}
