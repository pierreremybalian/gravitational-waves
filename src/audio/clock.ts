// When is "now" at the listener's ear? Context time of the sample currently leaving the speaker, from
// getOutputTimestamp() (falls back to currentTime − latencies), minus the limiter's fixed delay and the visitor's
// sync offset, smoothed against performance.now() so it is steady frame to frame and never runs backwards.

/** DynamicsCompressor look-ahead (Chromium/WebKit: 6 ms). Measured by scripts/audio-check.ts. */
export const GRAPH_LATENCY = 0.006;

export class AudibleClock {
  private offset = NaN;
  private last = -Infinity;
  private lastPerf = 0;
  userOffsetS = 0;

  constructor(private readonly ctx: AudioContext) {}

  /** Raw estimate of the context time now audible. */
  raw(perfMs: number): number {
    const c = this.ctx;
    const ts = typeof c.getOutputTimestamp === 'function' ? c.getOutputTimestamp() : null;
    let t: number;
    if (ts && ts.contextTime && ts.performanceTime && perfMs - ts.performanceTime < 200)
      t = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    else t = c.currentTime - (c.baseLatency || 0) - (c.outputLatency || 0);
    return t - GRAPH_LATENCY - this.userOffsetS;
  }

  /** Smoothed audible context time. */
  now(perfMs: number): number {
    const raw = this.raw(perfMs);
    const d = raw - perfMs / 1000;
    const dt = Math.max(0, (perfMs - this.lastPerf) / 1000);
    this.lastPerf = perfMs;
    if (!Number.isFinite(this.offset) || Math.abs(d - this.offset) > 0.03 || this.ctx.state !== 'running') this.offset = d;
    else this.offset += (d - this.offset) * (1 - Math.exp(-dt / 0.3));
    const t = Math.max(this.last, perfMs / 1000 + this.offset);
    this.last = t;
    return t;
  }

  /** Forget smoothing (after suspend/resume or a device change). */
  snap(): void {
    this.offset = NaN;
    this.last = -Infinity;
  }
}
