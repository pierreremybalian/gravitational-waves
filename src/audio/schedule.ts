// The chirp schedule (pure: no Web Audio, no DOM). Clips are placed on the transport's timeline as instances
// [start, end) in transport seconds; the transport turns instances into AudioBufferSourceNodes (sound on) or just
// lets time run over them (sound off), and every frame reads the same schedule, so the picture shows exactly what
// is heard (or would be). Requests never cut a playing clip unless asked: a new clip starts when the current one
// ends (plus its gap), a stop lets the current one finish.

/** What a clip is, independent of its audio buffer. */
export interface ClipInfo {
  id: string;
  /** Audio seconds. */
  duration: number;
  /** Data time (seconds; 0 = the merger) of the clip's first sample. */
  t0: number;
  /** Data seconds per audio second (1 = real time; 0.25 = slowed four times). */
  speed: number;
}

/** What a stage (or a dev page) wants to hear. */
export interface SoundRequest {
  clip: string;
  /** Repeat with `gap` seconds of silence between plays. */
  loop?: boolean;
  /** Seconds of silence after each play before the next (default 1.2). */
  gap?: number;
}

export interface Instance {
  clip: ClipInfo;
  start: number;
  end: number;
  /** Serial number, increasing. */
  n: number;
  /** Set when the instance was cut short or cancelled (end moved). */
  cut: boolean;
}

/** What scenes read every frame (ctx.chirp). Filled in place; never allocate one per frame. */
export interface ChirpFrame {
  /** Transport seconds at the listener's ear. */
  T: number;
  /** Clip of the instance playing now, else of the last one played (null if none yet). */
  clip: string | null;
  /** True while T is inside an instance. */
  playing: boolean;
  /** Data seconds within the clip (0 = merger): clip.t0 + pos · speed; holds the end value after the clip ends. */
  t: number;
  /** Audio seconds since the instance started (0 before any). */
  pos: number;
  /** 0–1 through the instance (1 after it ends). */
  progress: number;
  /** Transport time the current / last instance started. */
  start: number;
  /** Seconds since the last instance ended (0 while playing, Infinity before any). */
  sinceEnd: number;
  /** Seconds until the next scheduled instance starts (Infinity if none is scheduled yet). */
  untilNext: number;
  /** Serial of the current / last instance (−1 before any): changes on every new play. */
  instance: number;
  /** True when sound is on and the context is running. */
  audible: boolean;
  /** Changes whenever playing state or instance changes (held frames under reduced motion). */
  revision: number;
}

export function createChirpFrame(): ChirpFrame {
  return {
    T: 0,
    clip: null,
    playing: false,
    t: 0,
    pos: 0,
    progress: 0,
    start: 0,
    sinceEnd: Infinity,
    untilNext: Infinity,
    instance: -1,
    audible: false,
    revision: 0,
  };
}

/** Lead time between a request and the first start, so audio can be scheduled ahead of the ear (same in both modes). */
export const START_LEAD = 0.15;
const DEFAULT_GAP = 1.2;
const KEEP = 6;

export type Emit = (inst: Instance) => void;
export type Cancel = (inst: Instance, at: number) => void;

export class ClipSchedule {
  private readonly clips = new Map<string, ClipInfo>();
  private req: SoundRequest | null = null;
  /** Transport time the current request was made (first start no earlier than this + START_LEAD). */
  private reqAt = 0;
  /** Request already played once (non-looping requests play once). */
  private reqPlayed = false;
  readonly instances: Instance[] = [];
  private serial = 0;

  define(c: ClipInfo): void {
    if (!(c.duration > 0)) throw new Error(`clip ${c.id}: duration must be > 0`);
    this.clips.set(c.id, c);
  }

  info(id: string): ClipInfo | undefined {
    return this.clips.get(id);
  }

  get current(): SoundRequest | null {
    return this.req;
  }

  /** Ask for a clip (or silence). Same request again is a no-op. */
  request(r: SoundRequest | null, now: number): void {
    if (sameRequest(r, this.req)) return;
    this.req = r ? { ...r } : null;
    this.reqAt = now;
    this.reqPlayed = false;
  }

  /**
   * Stop now: instances still to start are cancelled, the playing one ends at `at`. `cancel` is called for each
   * affected instance so the audio layer can stop its node. The request is cleared unless `keepRequest`.
   */
  cut(at: number, cancel: Cancel, keepRequest = false): void {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i]!;
      if (inst.end <= at) continue;
      inst.cut = true;
      if (inst.start >= at) {
        inst.end = inst.start;
        cancel(inst, at);
        this.instances.splice(i, 1);
      } else {
        inst.end = at;
        cancel(inst, at);
      }
    }
    if (!keepRequest) this.req = null;
    this.reqAt = at;
  }

  /** Play a clip now, cutting whatever plays (dev pages, the catalogue's "play" button). */
  playNow(r: SoundRequest, now: number, cancel: Cancel): void {
    this.cut(now, cancel);
    this.req = { ...r };
    this.reqAt = now;
    this.reqPlayed = false;
  }

  /** Commit instances that start before `horizon`, calling emit for each new one. */
  advance(horizon: number, emit: Emit): void {
    for (let guard = 0; guard < 64; guard++) {
      const r = this.req;
      if (!r || (this.reqPlayed && !r.loop)) return;
      const clip = this.clips.get(r.clip);
      if (!clip) return; // not defined yet: wait
      const last = this.instances.at(-1);
      const gap = r.gap ?? DEFAULT_GAP;
      let start = this.reqAt + START_LEAD;
      if (last) start = Math.max(start, last.end + (last.cut ? 0.05 : gap));
      if (start >= horizon) return;
      const inst: Instance = { clip, start, end: start + clip.duration, n: this.serial++, cut: false };
      this.instances.push(inst);
      if (this.instances.length > KEEP) this.instances.splice(0, this.instances.length - KEEP);
      this.reqPlayed = true;
      emit(inst);
    }
  }

  /** Fill `out` for transport time T (no allocation). */
  at(T: number, out: ChirpFrame): ChirpFrame {
    out.T = T;
    let cur: Instance | null = null;
    let next: Instance | null = null;
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i]!;
      if (inst.start <= T) {
        cur = inst;
        break;
      }
      next = inst;
    }
    const wasPlaying = out.playing;
    const wasInstance = out.instance;
    if (!cur) {
      out.clip = null;
      out.playing = false;
      out.t = 0;
      out.pos = 0;
      out.progress = 0;
      out.start = 0;
      out.sinceEnd = Infinity;
      out.instance = -1;
    } else {
      const c = cur.clip;
      const dur = cur.end - cur.start;
      out.clip = c.id;
      out.start = cur.start;
      out.instance = cur.n;
      out.playing = T < cur.end;
      out.pos = Math.min(T - cur.start, dur);
      out.progress = dur > 0 ? out.pos / dur : 1;
      if (!out.playing) out.progress = 1;
      out.t = c.t0 + out.pos * c.speed;
      out.sinceEnd = out.playing ? 0 : T - cur.end;
    }
    out.untilNext = next ? next.start - T : Infinity;
    if (out.playing !== wasPlaying || out.instance !== wasInstance) out.revision++;
    return out;
  }
}

function sameRequest(a: SoundRequest | null, b: SoundRequest | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.clip === b.clip && !!a.loop === !!b.loop && (a.gap ?? DEFAULT_GAP) === (b.gap ?? DEFAULT_GAP);
}
