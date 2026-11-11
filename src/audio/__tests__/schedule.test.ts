import { describe, expect, it } from 'vitest';
import { ClipSchedule, START_LEAD, createChirpFrame, type Instance } from '../schedule.ts';

const mk = () => {
  const s = new ClipSchedule();
  s.define({ id: 'a', duration: 2, t0: -1.5, speed: 1 });
  s.define({ id: 'b', duration: 1, t0: 0, speed: 0.5 });
  return s;
};
const run = (s: ClipSchedule, until: number) => {
  const out: Instance[] = [];
  s.advance(until, (i) => out.push(i));
  return out;
};

describe('clip schedule', () => {
  it('starts a requested clip after the lead and maps the playhead to data time', () => {
    const s = mk();
    s.request({ clip: 'a' }, 10);
    const e = run(s, 20);
    expect(e).toHaveLength(1);
    expect(e[0]!.start).toBeCloseTo(10 + START_LEAD, 12);
    const f = createChirpFrame();
    s.at(10 + START_LEAD + 1.5, f);
    expect(f.playing).toBe(true);
    expect(f.clip).toBe('a');
    expect(f.t).toBeCloseTo(0, 12);
    expect(f.progress).toBeCloseTo(0.75, 12);
    s.at(10 + START_LEAD + 3, f);
    expect(f.playing).toBe(false);
    expect(f.sinceEnd).toBeCloseTo(1, 12);
    expect(f.t).toBeCloseTo(0.5, 12);
    expect(f.progress).toBe(1);
  });
  it('plays a non-looping request once, a looping one with gaps', () => {
    const s = mk();
    s.request({ clip: 'a' }, 0);
    expect(run(s, 100)).toHaveLength(1);
    s.request({ clip: 'b', loop: true, gap: 0.5 }, 0);
    const e = run(s, 6);
    expect(e[0]!.start).toBeCloseTo(2 + START_LEAD + 0.5, 12);
    for (let i = 1; i < e.length; i++) expect(e[i]!.start - e[i - 1]!.end).toBeCloseTo(0.5, 12);
  });
  it('never cuts a playing clip on a new request; data time follows speed', () => {
    const s = mk();
    s.request({ clip: 'a' }, 0);
    run(s, 1);
    s.request({ clip: 'b' }, 1);
    const e = run(s, 10);
    expect(e[0]!.clip.id).toBe('b');
    expect(e[0]!.start).toBeGreaterThanOrEqual(2 + START_LEAD);
    const f = createChirpFrame();
    s.at(e[0]!.start + 0.5, f);
    expect(f.t).toBeCloseTo(0.25, 12);
  });
  it('playNow cuts and cancels', () => {
    const s = mk();
    s.request({ clip: 'a', loop: true }, 0);
    run(s, 5);
    const cancelled: number[] = [];
    s.playNow({ clip: 'b' }, 1, (i) => cancelled.push(i.n));
    expect(cancelled.length).toBeGreaterThan(0);
    const e = run(s, 10);
    expect(e).toHaveLength(1);
    expect(e[0]!.clip.id).toBe('b');
    expect(e[0]!.start).toBeCloseTo(1 + START_LEAD, 12);
    const f = createChirpFrame();
    s.at(1.05, f);
    expect(f.playing).toBe(false);
    expect(f.untilNext).toBeCloseTo(START_LEAD - 0.05, 12);
  });
  it('waits for a clip to be defined', () => {
    const s = new ClipSchedule();
    s.request({ clip: 'x' }, 0);
    expect(run(s, 5)).toHaveLength(0);
    s.define({ id: 'x', duration: 1, t0: 0, speed: 1 });
    expect(run(s, 5)).toHaveLength(1);
  });
  it('revision changes on start and end only', () => {
    const s = mk();
    s.request({ clip: 'b' }, 0);
    run(s, 5);
    const f = createChirpFrame();
    s.at(0, f);
    const r0 = f.revision;
    s.at(0.5, f);
    const r1 = f.revision;
    s.at(0.6, f);
    expect(f.revision).toBe(r1);
    s.at(2, f);
    expect(r1).not.toBe(r0);
    expect(f.revision).not.toBe(r1);
  });
});
