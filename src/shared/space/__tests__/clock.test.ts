// Stages 4–6: the binary's time comes from the audio clock alone (owner fix: the scroll does not drive playback).
import { describe, expect, it } from 'vitest';
import { createChirpFrame } from '../../../audio/schedule.ts';
import { clipClock, createClipClock } from '../clock.ts';
import { SEAM_FADE, SLOW_BINARY, SLOW_INSPIRAL, SLOW_MERGER, seamGain, slowDuration, windowLabel } from '../../../script/slow.ts';

describe('clipClock', () => {
  for (const spec of [SLOW_BINARY, SLOW_INSPIRAL, SLOW_MERGER]) {
    it(`${spec.id}: time is the clip's data time, seam dip follows the sound's fade`, () => {
      const c = createChirpFrame();
      const out = createClipClock();
      // Nothing of ours yet: the clip's first moment, dimmed (no scroll input exists to depend on).
      clipClock(c, spec, out, 0.25, false);
      expect(out.t).toBe(spec.from);
      expect(out.live).toBe(false);
      const dur = slowDuration(spec);
      c.clip = spec.id;
      c.instance = 3;
      c.playing = true;
      for (const pos of [0, 0.1, dur / 2, dur - 0.05]) {
        c.pos = pos;
        c.t = spec.from + pos / spec.slow;
        clipClock(c, spec, out, 0.25, false);
        expect(out.t).toBe(c.t);
        expect(out.dip).toBeCloseTo(0.25 + 0.75 * seamGain(pos, dur), 12);
      }
      // In the gap: runs on at the clip's speed, dimmed.
      c.playing = false;
      c.pos = dur;
      c.t = spec.to;
      c.sinceEnd = 0.2;
      clipClock(c, spec, out, 0.25, false);
      expect(out.t).toBeCloseTo(spec.to + 0.2 / spec.slow, 12);
      expect(out.dip).toBe(0.25);
    });
  }
  it('seam fade is a raised cosine, silent at the ends and full inside', () => {
    expect(seamGain(0, 4)).toBe(0);
    expect(seamGain(4, 4)).toBe(0);
    expect(seamGain(SEAM_FADE, 4)).toBe(1);
    expect(seamGain(SEAM_FADE / 2, 4)).toBeCloseTo(0.5, 12);
  });
  it('window labels', () => {
    expect(windowLabel(SLOW_INSPIRAL, -0.6)).toBe('−0.60 s');
    expect(windowLabel(SLOW_MERGER, -0.035)).toBe('−35 ms');
    expect(windowLabel(SLOW_MERGER, 0.03)).toBe('+30 ms');
  });
});
