// The pattern model. A Section is a set of layers sharing one master cycle (the bar):
//  - a polyrhythm layer divides the bar: span 1, n steps;
//  - a polymeter layer loops its own length over a shared pulse: span = steps / pulsesPerBar.
// compile() puts every layer on one integer tick grid, so onsets are exact integers and nothing drifts. Pure.

import { gcd, lcm, lcmAll, ratio, ONE, type Ratio } from './rational.ts';
import { bjorklund, rotate } from './euclid.ts';

export type VoiceId = 'wood' | 'clave' | 'drum' | 'bell' | 'shaker' | 'tone';
export const VOICES: readonly VoiceId[] = ['wood', 'clave', 'drum', 'bell', 'shaker', 'tone'];

/** Sixteen layers covers the Rhythmicon (rates 1–16). */
export const MAX_LAYERS = 16;

export interface LayerSpec {
  /** Steps in one layer cycle. */
  steps: number;
  /** Layer cycle length in master cycles. */
  span: Ratio;
  /** Per step: 0 rest, 1 hit, 2 accented hit. */
  hits: Uint8Array;
  voice: VoiceId;
  /** Semitones above the voice's base pitch. */
  pitch: number;
  /** −1 (left) … 1 (right). */
  pan: number;
  /** 0–1. */
  gain: number;
}

export interface Section {
  /** Structural identity: two sections with the same key have the same grid, hits and voices. */
  key: string;
  layers: readonly LayerSpec[];
}

export interface Compiled {
  key: string;
  section: Section;
  /** Ticks per master cycle. */
  G: number;
  /** Ticks per step, per layer. */
  tickStep: Int32Array;
  steps: Int32Array;
  /** Ticks per layer cycle. */
  cycleTicks: Float64Array;
  /** Ticks until every layer is back at its start together. */
  realignTicks: number;
  /** prevHit[i][s] = most recent hit step ≤ s (cyclic), or −1 if the layer has no hits. */
  prevHit: readonly Int16Array[];
}

export interface LayerOptions {
  voice?: VoiceId;
  pitch?: number;
  pan?: number;
  gain?: number;
  /** Accent the first step of each layer cycle (default true). */
  accentFirst?: boolean;
}

function hitsAll(n: number, accentFirst: boolean): Uint8Array {
  const h = new Uint8Array(n).fill(1);
  if (accentFirst && n) h[0] = 2;
  return h;
}

export function layer(steps: number, span: Ratio = ONE, o: LayerOptions & { hits?: ArrayLike<number> } = {}): LayerSpec {
  if (!Number.isInteger(steps) || steps < 1 || steps > 4096) throw new Error(`layer: steps ${steps}`);
  const hits = o.hits ? Uint8Array.from(o.hits) : hitsAll(steps, o.accentFirst ?? true);
  if (hits.length !== steps) throw new Error('layer: hits length must equal steps');
  if (o.hits && (o.accentFirst ?? false) && hits[0]) hits[0] = 2;
  return { steps, span, hits, voice: o.voice ?? 'wood', pitch: o.pitch ?? 0, pan: o.pan ?? 0, gain: o.gain ?? 1 };
}

/** k onsets spread over n steps (Toussaint's E(k, n)), rotated by r. */
export function euclidLayer(k: number, n: number, r = 0, span: Ratio = ONE, o: LayerOptions = {}): LayerSpec {
  const hits = rotate(bjorklund(k, n), r);
  return layer(n, span, { ...o, hits, accentFirst: o.accentFirst ?? false });
}

const keyOf = (layers: readonly LayerSpec[]) =>
  layers.map((l) => `${l.steps}/${l.span.n}:${l.span.d}/${Array.from(l.hits).join('')}/${l.voice}${l.pitch}`).join('|');

export function section(layers: readonly LayerSpec[], key?: string): Section {
  if (!layers.length || layers.length > MAX_LAYERS) throw new Error(`section: 1–${MAX_LAYERS} layers`);
  return { key: key ?? keyOf(layers), layers };
}

/** n₁ : n₂ : … — every layer divides the same bar. Voices default to higher for faster layers. */
export function polyrhythm(counts: readonly number[], opts: readonly LayerOptions[] = []): Section {
  return section(counts.map((n, i) => layer(n, ONE, opts[i] ?? {})));
}

/** Loops of the given lengths over one pulse; the bar is `pulsesPerBar` pulses (default: the first loop). */
export function polymeter(lengths: readonly number[], pulsesPerBar = lengths[0]!, opts: readonly LayerOptions[] = []): Section {
  return section(lengths.map((n, i) => layer(n, ratio(n, pulsesPerBar), opts[i] ?? {})));
}

const cache = new Map<string, Compiled>();

export function compile(s: Section): Compiled {
  const hit = cache.get(s.key);
  if (hit && hit.section === s) return hit;
  const L = s.layers.length;
  // Step length of layer i in master cycles: span / steps = a/b reduced; G = lcm of the b's.
  const stepLen = s.layers.map((l) => {
    const num = l.span.n;
    const den = l.span.d * l.steps;
    const g = gcd(num, den);
    return [num / g, den / g] as const;
  });
  const G = lcmAll(stepLen.map(([, b]) => b));
  if (!Number.isSafeInteger(G) || G > 2 ** 40) throw new Error(`compile: grid too fine (${G})`);
  const tickStep = new Int32Array(L);
  const steps = new Int32Array(L);
  const cycleTicks = new Float64Array(L);
  const prevHit: Int16Array[] = [];
  let realign = 1;
  s.layers.forEach((l, i) => {
    const [a, b] = stepLen[i]!;
    tickStep[i] = (a * G) / b;
    steps[i] = l.steps;
    cycleTicks[i] = tickStep[i]! * l.steps;
    realign = lcm(realign, cycleTicks[i]!);
    const ph = new Int16Array(l.steps).fill(-1);
    let last = -1;
    for (let k = 0; k < 2 * l.steps; k++) {
      const st = k % l.steps;
      if (l.hits[st]) last = st;
      if (k >= l.steps) ph[st] = last;
    }
    prevHit.push(ph);
  });
  const c: Compiled = { key: s.key, section: s, G, tickStep, steps, cycleTicks, realignTicks: realign, prevHit };
  if (cache.size > 64) cache.clear();
  cache.set(s.key, c);
  return c;
}

/** Bitmask with the first n layers on. */
export const allLayers = (n: number) => (n >= 31 ? 0x7fffffff : (1 << n) - 1);
