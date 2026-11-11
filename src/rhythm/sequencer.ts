// The sequencer: turns targets (what a stage or the instrument wants to hear) into a committed score and a stream
// of timed onsets. Pure and clock-agnostic: the browser scheduler calls advance(H) with the horizon in transport
// seconds; tests call it with a simulated clock.
//
// Rules (DECISIONS.md, "Sound and timing"):
//  - Tempo and score are only changed at or after the previous horizon, so already-scheduled onsets never move.
//  - A new section lands on the next master-cycle boundary (or the next full realignment if it is close); a layer
//    entering or leaving lands on its own cycle boundary, so the other layers keep their phase.
//  - Onsets are scanned with a persistent integer tick cursor: no gaps, no doubles.

import { compile, allLayers, type Compiled, type Section } from './pattern.ts';
import { onsetsInTicks, tickAtPos, posOfTick, createOnsetBuffer, type OnsetBuffer } from './events.ts';
import { TempoMap, slewLog } from './tempo.ts';
import { Timeline, GainTrack, type Entry } from './timeline.ts';

export type Engine = 'hits' | 'stream';

export interface MusicTarget {
  /** null = silence. */
  section: Section | null;
  /** Layers playing (default all). */
  mask?: number;
  /** Master cycles per second. */
  rate: number;
  /** 'slew' glides in log-rate (default); 'step' jumps (still phase-continuous). */
  tempo?: 'slew' | 'step';
  /** Slew time constant, s (default 0.35). */
  tau?: number;
  /**
   * Where a new section lands: next bar (default), next full realignment if within 1.5 s, at once (restarting the
   * bar), or 'keep': at once AND in phase when the new section has the same grid (same steps and cycle per layer;
   * only hits, voices, pitch, pan or level differ), otherwise at the next bar. The instrument's edits use 'keep'.
   */
  quantum?: 'cycle' | 'realign' | 'now' | 'keep';
  /** Per-layer gain 0–1 (default 1). */
  gains?: readonly number[];
  engine?: Engine;
  /**
   * Stereo spread 0–1 (default 0.45): each hit is panned by where its step sits on the layer's ring, sin(2π·step/steps)
   * (top of the ring = centre, right half = right ear), on top of the layer's own pan. 0 for fused tones.
   */
  spread?: number;
  /** Stereo room send 0–1 (default 0.16). */
  room?: number;
}

export const SILENCE: MusicTarget = { section: null, rate: 0.5 };

export type EmitFn = (time: number, layer: number, step: number, accent: number, together: number, entry: Entry) => void;

/** Smallest anchor + k·period ≥ pos. */
export function nextBoundary(pos: number, anchor: number, period: number): number {
  const k = Math.ceil((pos - anchor) / period - 1e-9);
  return anchor + Math.max(0, k) * period;
}

/** Same tick grid and layer cycles: one can replace the other mid-bar without moving any layer's phase. */
export function sameGrid(a: Compiled, b: Compiled): boolean {
  if (a.G !== b.G || a.steps.length !== b.steps.length) return false;
  for (let i = 0; i < a.steps.length; i++) if (a.steps[i] !== b.steps[i] || a.tickStep[i] !== b.tickStep[i]) return false;
  return true;
}

export interface Plan {
  kind: 'none' | 'section' | 'mask';
  atPos: number;
  anchor: number;
  c: Compiled | null;
  mask: number;
}

/**
 * What to commit next for target t, given the entry in force at the end of the scanned region (cur), the scanned
 * position (from), and the current rate (to bound waits for a realignment).
 */
export function planChange(cur: Entry | null, t: MusicTarget, from: number, rate: number, out: Plan, maxWaitS = 1.5): Plan {
  out.kind = 'none';
  const c = t.section ? compile(t.section) : null;
  const mask = c ? (t.mask ?? allLayers(c.steps.length)) & allLayers(c.steps.length) : 0;
  const curKey = cur?.c?.key ?? null;
  const key = c?.key ?? null;
  if (!cur || (curKey === null && key === null)) {
    if (!cur && c) Object.assign(out, { kind: 'section', atPos: from, anchor: from, c, mask });
    return out;
  }
  if (key !== curKey) {
    if (t.quantum === 'keep' && c && cur.c && sameGrid(c, cur.c)) {
      Object.assign(out, { kind: 'section', atPos: from, anchor: cur.anchor, c, mask });
      return out;
    }
    let at: number;
    if (t.quantum === 'now' || !cur.c) at = from;
    else {
      at = nextBoundary(from, cur.anchor, 1);
      if (t.quantum === 'realign') {
        const realign = cur.c.realignTicks / cur.c.G;
        const r = nextBoundary(from, cur.anchor, realign);
        if ((r - from) / Math.max(1e-6, rate) <= maxWaitS) at = r;
      }
    }
    Object.assign(out, { kind: 'section', atPos: at, anchor: at, c, mask });
    return out;
  }
  if (mask !== cur.mask && c) {
    // Earliest boundary among the changed layers; later changes follow on later advances.
    let best = Infinity;
    let bestMask = cur.mask;
    const changed = mask ^ cur.mask;
    for (let i = 0; i < c.steps.length; i++) {
      if (!(changed & (1 << i))) continue;
      const b = nextBoundary(from, cur.anchor, c.cycleTicks[i]! / c.G);
      if (b < best - 1e-12) {
        best = b;
        bestMask = (cur.mask & ~(1 << i)) | (mask & (1 << i));
      } else if (Math.abs(b - best) <= 1e-12) bestMask = (bestMask & ~(1 << i)) | (mask & (1 << i));
    }
    Object.assign(out, { kind: 'mask', atPos: best, anchor: cur.anchor, c: cur.c, mask: bestMask });
  }
  return out;
}

export class Sequencer {
  readonly tempo: TempoMap;
  readonly timeline = new Timeline(32);
  readonly gains = new GainTrack(1);
  /** Engine for each committed entry, by identity. */
  readonly engines = new WeakMap<Entry, Engine>();
  private target: MusicTarget = SILENCE;
  private prevH: number;
  private scanPos: number;
  private cursorEntry: Entry | null = null;
  private cursorTick = 0;
  private readonly plan: Plan = { kind: 'none', atPos: 0, anchor: 0, c: null, mask: 0 };
  private readonly buf: OnsetBuffer = createOnsetBuffer(2048);
  /** Onsets dropped because the buffer filled (diagnostics). */
  overflow = 0;

  constructor(t = 0, p = 0, rate = 0.5) {
    this.tempo = new TempoMap(256, t, p, rate);
    this.prevH = t;
    this.scanPos = p;
  }

  request(t: MusicTarget): void {
    this.target = t;
  }

  get current(): MusicTarget {
    return this.target;
  }

  /** Scanned position (everything before it has been emitted). */
  get scanned(): number {
    return this.scanPos;
  }

  get horizonTime(): number {
    return this.prevH;
  }

  /** Advance the horizon to H (transport seconds), committing changes and emitting onsets in [previous, H). */
  advance(H: number, emit: EmitFn): void {
    if (H <= this.prevH) return;
    const t = this.target;
    const dt = H - this.prevH;
    // 1. Tempo, from the previous horizon on.
    const f = this.tempo.rateAt(this.prevH);
    if (Math.abs(t.rate - f) / f > 1e-9) {
      if (t.tempo === 'step') this.tempo.step(Math.max(this.prevH, this.tempo.tailTime), t.rate);
      else this.tempo.rampTo(Math.max(this.prevH, this.tempo.tailTime), H, slewLog(f, t.rate, dt, t.tau ?? 0.35));
    }
    const endPos = this.tempo.posAt(H);
    // 2. Score: commit changes due before the new horizon (possibly several, e.g. two layers entering).
    for (let guard = 0; guard < 8; guard++) {
      const cur = this.timeline.last();
      const p = planChange(cur, t, this.scanPos, this.tempo.rateAt(H), this.plan);
      if (p.kind === 'none' || p.atPos > endPos) break;
      const e = this.timeline.commit(p.atPos, p.anchor, p.c, p.mask);
      this.engines.set(e, t.engine ?? 'hits');
      if (!this.cursorEntry) {
        this.cursorEntry = e;
        this.cursorTick = e.c ? tickAtPos(e.c, e.anchor, e.atPos) : 0;
      }
    }
    // 3. Gains.
    const n = t.section?.layers.length ?? 0;
    for (let i = 0; i < n; i++) {
      const g = t.gains?.[i] ?? 1;
      if (Math.abs(this.gains.targetOf(i) - g) > 1e-6) this.gains.set(i, g, H, 0.08);
    }
    // 4. Onsets in [scanPos, endPos).
    this.scan(endPos, emit);
    this.scanPos = endPos;
    this.prevH = H;
  }

  private scan(endPos: number, emit: EmitFn): void {
    let e = this.cursorEntry;
    while (e) {
      const next = this.timeline.next(e);
      const segEnd = next && next.atPos < endPos ? next.atPos : endPos;
      if (e.c) {
        const endTick = tickAtPos(e.c, e.anchor, segEnd);
        if (endTick > this.cursorTick) {
          this.buf.n = 0;
          onsetsInTicks(e.c, e.mask, this.cursorTick, endTick, this.buf);
          if (this.buf.n === this.buf.tick.length) this.overflow++;
          for (let j = 0; j < this.buf.n; j++) {
            const pos = posOfTick(e.c, e.anchor, this.buf.tick[j]!);
            emit(this.tempo.timeAt(pos), this.buf.layer[j]!, this.buf.step[j]!, this.buf.accent[j]!, this.buf.together[j]!, e);
          }
          this.cursorTick = endTick;
        }
      }
      if (next && next.atPos <= endPos) {
        e = next;
        this.cursorEntry = e;
        this.cursorTick = e.c ? tickAtPos(e.c, e.anchor, e.atPos) : 0;
        continue;
      }
      break;
    }
  }

  /** Restart from scratch at (t, p): used when the clock source jumps (never during playback). */
  reset(t: number, p: number, rate: number): void {
    this.tempo.reset(t, p, rate);
    this.timeline.clear();
    this.gains.reset(1);
    this.cursorEntry = null;
    this.cursorTick = 0;
    this.prevH = t;
    this.scanPos = p;
  }
}
