// Slowed, pitch-kept chirps for the orbit stages (pure: the specs; src/shared/space/slowchirp.ts synthesises them from
// the best-fit template). `from`/`to`: data seconds (0 = merger); `slow`: how many times slower than real; `pitch`:
// every frequency multiplied by this so small speakers carry it.

export interface SlowChirpSpec {
  id: string;
  from: number;
  to: number;
  slow: number;
  pitch: number;
  gain: number;
}

/** Stage 4: early inspiral, gravitational-wave frequency 15 → 20 Hz (orbit 7 → 10 turns a second). */
export const SLOW_BINARY: SlowChirpSpec = { id: 'slow-binary', from: -1.5, to: -0.6, slow: 10, pitch: 8, gain: 0.55 };
/** Stage 5: the last 0.6 s, 20 Hz to the merger. */
export const SLOW_INSPIRAL: SlowChirpSpec = { id: 'slow-inspiral', from: -0.6, to: 0.03, slow: 12, pitch: 4, gain: 0.6 };
/** Stage 6: 30 ms either side of the merger. */
export const SLOW_MERGER: SlowChirpSpec = { id: 'slow-merger', from: -0.035, to: 0.03, slow: 60, pitch: 4, gain: 0.6 };

/** Audio seconds of a spec. */
export const slowDuration = (s: SlowChirpSpec): number => (s.to - s.from) * s.slow;

/** Seconds of silence between plays of a looping slowed clip. */
export const LOOP_GAP = 0.45;
/** Loop seam: the clip's sound fades in and out over this many audio seconds, and the picture dims with it. */
export const SEAM_FADE = 0.3;

/** Raised-cosine fade at both ends of a clip of `duration` audio seconds (0 at the ends, 1 inside), at `pos`. */
export function seamGain(pos: number, duration: number, fade = SEAM_FADE): number {
  const u = Math.min(1, Math.max(0, Math.min(pos, duration - pos) / fade));
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

/** The data window a stage's clip covers, for its timeline card: ms for windows shorter than 0.2 s. */
export function windowLabel(s: SlowChirpSpec, t: number): string {
  if (s.to - s.from < 0.2) {
    const ms = Math.round(t * 1000);
    return `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`;
  }
  const v = Math.round(t * 100) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} s`;
}

/** The note under the timeline: what the loop is. */
export const loopNote = (s: SlowChirpSpec): string => `looping · slowed ×${s.slow}, pitch ×${s.pitch}`;
