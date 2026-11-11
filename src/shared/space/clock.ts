// Data time for a stage that loops a slowed clip (pure). The audio clock alone sets it, never the scroll: while the
// clip plays, the data time being heard; in the gap after it, time runs on silently at the clip's speed so the
// picture keeps moving; before the clip has started (the previous stage's chirp still finishing), the clip's first
// moment. With sound off the transport runs the same schedule silently, so the picture moves the same way. `dip`
// (floor–1) follows the clip's own fade at the loop seam (seamGain), so sound and picture fade together.

import type { ChirpFrame } from '../../audio/schedule.ts';
import { seamGain, slowDuration, type SlowChirpSpec } from '../../script/slow.ts';

export interface ClipClock {
  t: number;
  /** 1 mid-clip, down to `floor` at the seam, in step with the sound's fade. */
  dip: number;
  /** True while our clip is audible or silently scheduled. */
  live: boolean;
  /** Audio seconds into the clip (0 before it starts; the duration in the gap). */
  pos: number;
}

/** Last values a scene's clock produced, for the clock probe (scripts/clock-check.ts). Written in place. */
export const clockProbe = { clip: '', t: 0, pos: 0, playing: false, instance: -1, frames: 0 };
if (typeof window !== 'undefined') (window as unknown as { __clockProbe?: typeof clockProbe }).__clockProbe = clockProbe;

export function clipClock(c: Readonly<ChirpFrame>, spec: SlowChirpSpec, out: ClipClock, floor = 0.25, probe = true): ClipClock {
  const duration = slowDuration(spec);
  if (c.clip !== spec.id || c.instance < 0) {
    out.t = spec.from;
    out.dip = floor;
    out.live = false;
    out.pos = 0;
  } else if (c.playing) {
    out.live = true;
    out.t = c.t;
    out.pos = c.pos;
    out.dip = floor + (1 - floor) * seamGain(c.pos, duration);
  } else {
    out.live = true;
    out.t = c.t + Math.min(c.sinceEnd, 5) / spec.slow;
    out.pos = duration;
    out.dip = floor;
  }
  if (probe) {
    clockProbe.clip = spec.id;
    clockProbe.t = out.t;
    clockProbe.pos = c.clip === spec.id ? c.pos : -1;
    clockProbe.playing = c.clip === spec.id && c.playing;
    clockProbe.instance = c.instance;
    clockProbe.frames++;
  }
  return out;
}

export const createClipClock = (): ClipClock => ({ t: 0, dip: 1, live: false, pos: 0 });
