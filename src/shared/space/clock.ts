// Data time for a stage that loops a clip (pure): while the clip plays, the data time being heard; in the gap after
// it, time runs on silently at the clip's speed so the picture keeps moving; with no clip of ours yet (sound off and
// the dev harness), a scroll-driven fallback so a still frame is still meaningful. `dip` (0–1) eases the picture
// down around the loop seam, where the data time jumps back to the clip's start.

import type { ChirpFrame } from '../../audio/schedule.ts';

export interface ClipClock {
  t: number;
  /** 1 mid-clip, falling toward `floor` within `edge` audio seconds of the seam. */
  dip: number;
  /** True while our clip is audible or silently scheduled. */
  live: boolean;
}

export function clipClock(
  c: Readonly<ChirpFrame>,
  clip: string,
  speed: number,
  duration: number,
  fallbackT: number,
  out: ClipClock,
  edge = 0.35,
  floor = 0.25,
): ClipClock {
  if (c.clip !== clip || c.instance < 0) {
    out.t = fallbackT;
    out.dip = 1;
    out.live = false;
    return out;
  }
  out.live = true;
  if (c.playing) {
    out.t = c.t;
    const d = Math.min(c.pos, duration - c.pos) / edge;
    out.dip = floor + (1 - floor) * Math.min(1, Math.max(0, d));
  } else {
    out.t = c.t + Math.min(c.sinceEnd, 5) * speed;
    out.dip = floor;
  }
  return out;
}

export const createClipClock = (): ClipClock => ({ t: 0, dip: 1, live: false });
