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
