// The one clock for the page, and the chirp player. Transport seconds T run continuously whether or not sound is on:
//  - silent: T = performance.now()/1000 + offS (paused while the tab is hidden);
//  - audio:  T = audible context time + offA, and a clip instance starting at T is started at context time T − offA,
//    so it reaches the ear exactly when the picture shows it.
// Switching between the two keeps T continuous. The ClipSchedule (pure) decides what plays when; this module feeds it
// a horizon, turns its instances into AudioBufferSourceNodes and fills the ChirpFrame scenes read every frame.

import gw150914 from '../data/gw150914.json';
import { $audible, $sound, $syncMs, storeSoundOn, storedSoundOn, storedSyncMs } from '../state/sound.ts';
import { AudibleClock } from './clock.ts';
import { audioContext, pauseShim, unlock } from './context.ts';
import { upsample } from './resample.ts';
import { ClipSchedule, createChirpFrame, type ChirpFrame, type ClipInfo, type Instance, type SoundRequest } from './schedule.ts';

const LOOKAHEAD = 0.15;
/** Fade at a cut, seconds (avoids a click). */
const CUT_FADE = 0.02;
/** Playback rate of samples handed over as arrays (catalogue snippets are upsampled to it). */
const SAMPLES_RATE = 16384;

type Source = { kind: 'url'; url: string } | { kind: 'samples'; data: Float32Array; fs: number };

interface Playing {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export interface SyncLog {
  /** Instances as scheduled: transport start/end and the context time the node was started at. */
  starts: { clip: string; T: number; end: number; ctxStart: number; offset: number }[];
  /** Per frame; `ear` = unsmoothed context time at the ear (audio mode, else null) and `offA` to map it to T. */
  frames: { perf: number; T: number; clip: string | null; playing: boolean; t: number; pos: number; ear: number | null; offA: number }[];
  late: number;
}

class Transport {
  readonly schedule = new ClipSchedule();
  private mode: 'silent' | 'audio' = 'silent';
  private offS = 0;
  private offA = 0;
  private pausedAt: number | null = null;
  private ctx: AudioContext | null = null;
  private clock: AudibleClock | null = null;
  private master: GainNode | null = null;
  private worker: Worker | null = null;
  private readonly sources = new Map<string, Source>();
  private readonly gains = new Map<string, number>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly playing = new Map<Instance, Playing>();
  private readonly pending = new Set<Instance>();
  private lastT = 0;
  private audibleAt = 0;
  readonly frameOut: ChirpFrame = createChirpFrame();
  log: SyncLog | null = null;
  /** Instances that could not start on time (buffer not ready); they start late, part-way in. */
  late = 0;

  constructor() {
    this.offS = typeof performance !== 'undefined' ? -performance.now() / 1000 : 0;
    for (const [id, c] of Object.entries(gw150914.clips)) this.define({ id, duration: c.duration, t0: c.t0, speed: c.speed }, { kind: 'url', url: c.url });
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('audiolog') === '1') {
      this.log = { starts: [], frames: [], late: 0 };
      (window as unknown as { __sync?: SyncLog; __transport?: Transport }).__sync = this.log;
      queueMicrotask(() => ((window as unknown as { __transport?: Transport }).__transport = this));
    }
    $syncMs.set(storedSyncMs());
    $syncMs.subscribe((ms) => {
      if (this.clock) this.clock.userOffsetS = ms / 1000;
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.onVisibility());
      if (storedSoundOn()) $sound.set('armed');
    }
  }

  // ── Clips ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Register a clip by URL (WAV/any decodable audio) or by samples. `gain` scales its level (default 1). */
  define(info: ClipInfo, src: Source, gain = 1): void {
    this.schedule.define(info);
    this.sources.set(info.id, src);
    this.gains.set(info.id, gain);
  }

  /**
   * Register samples (e.g. a catalogue snippet at 2048 Hz, any scale): normalised to a 0.89 peak and upsampled to
   * 16384 Hz for playback. `t0` = data time of the first sample.
   */
  defineSamples(id: string, data: Float32Array, fs: number, t0: number, gain = 1): ClipInfo {
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
    const factor = Math.max(1, Math.round(SAMPLES_RATE / fs));
    const up = upsample(data, factor);
    const k = peak > 0 ? 0.89 / peak : 1;
    for (let i = 0; i < up.length; i++) up[i]! *= k;
    const info: ClipInfo = { id, duration: up.length / (fs * factor), t0, speed: 1 };
    this.buffers.delete(id);
    this.define(info, { kind: 'samples', data: up, fs: fs * factor }, gain);
    if (this.ctx) void this.load(id);
    return info;
  }

  info(id: string): ClipInfo | undefined {
    return this.schedule.info(id);
  }

  private load(id: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id);
    if (have) return Promise.resolve(have);
    const busy = this.loading.get(id);
    if (busy) return busy;
    const ctx = this.ctx;
    const src = this.sources.get(id);
    if (!ctx || !src) return Promise.resolve(null);
    const p = (async () => {
      try {
        let buf: AudioBuffer;
        if (src.kind === 'url') {
          const res = await fetch(src.url);
          if (!res.ok) throw new Error(`${res.status} ${src.url}`);
          buf = await ctx.decodeAudioData(await res.arrayBuffer());
        } else {
          buf = ctx.createBuffer(1, src.data.length, src.fs);
          buf.copyToChannel(src.data as Float32Array<ArrayBuffer>, 0);
        }
        this.buffers.set(id, buf);
        return buf;
      } catch (err) {
        console.warn(`[audio] clip ${id} failed to load`, err);
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, p);
    return p;
  }

  // ── Requests ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Transport seconds at the ear. */
  now(perfMs: number = performance.now()): number {
    if (this.pausedAt !== null) return this.pausedAt;
    if (this.mode === 'audio' && this.clock) return this.clock.now(perfMs) + this.offA;
    return perfMs / 1000 + this.offS;
  }

  /** What should play (the conductor calls this as the scroll moves). Never cuts a playing clip. */
  request(r: SoundRequest | null): void {
    this.schedule.request(r, this.now());
    if (r && this.ctx) void this.load(r.clip);
  }

  /** Play a clip now, cutting whatever plays (dev pages, the catalogue). */
  play(clip: string, opts: Omit<SoundRequest, 'clip'> = {}): void {
    this.schedule.playNow({ clip, ...opts }, this.now(), this.cancel);
    if (this.ctx) void this.load(clip);
  }

  /** Stop now (fade of 20 ms). */
  stop(): void {
    this.schedule.cut(this.now(), this.cancel);
  }

  get current(): SoundRequest | null {
    return this.schedule.current;
  }

  // ── Frame ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Called by the renderer once per frame (or by any page that draws in sync). */
  frame(perfMs: number, out: ChirpFrame = this.frameOut): ChirpFrame {
    const T = this.now(perfMs);
    this.lastT = T;
    if (this.mode === 'silent' && this.pausedAt === null) this.schedule.advance(T + LOOKAHEAD, noop);
    this.schedule.at(T, out);
    out.audible = this.mode === 'audio' && this.ctx?.state === 'running';
    if (this.log) {
      const ear = this.mode === 'audio' && this.clock ? this.clock.raw(perfMs) : null;
      this.log.frames.push({ perf: perfMs, T, clip: out.clip, playing: out.playing, t: out.t, pos: out.pos, ear, offA: this.offA });
      if (this.log.frames.length > 20000) this.log.frames.splice(0, 10000);
    }
    return out;
  }

  // ── Audio scheduling ───────────────────────────────────────────────────────────────────────────────────────────

  private tick = () => {
    const ctx = this.ctx;
    if (this.mode !== 'audio' || !ctx || ctx.state !== 'running' || this.pausedAt !== null) return;
    const H = ctx.currentTime + LOOKAHEAD + this.offA;
    this.schedule.advance(H, this.emit);
    for (const inst of this.pending) this.tryStart(inst);
    const perf = performance.now();
    if (perf - this.audibleAt > 100) {
      this.audibleAt = perf;
      const f = this.frameOut;
      const a = $audible.get();
      if (a.clip !== f.clip || a.playing !== f.playing) $audible.set({ clip: f.clip, playing: f.playing });
    }
  };

  private readonly emit = (inst: Instance) => {
    void this.load(inst.clip.id);
    this.pending.add(inst);
    this.tryStart(inst);
  };

  private tryStart(inst: Instance): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const buf = this.buffers.get(inst.clip.id);
    const nowCtx = ctx.currentTime;
    const startCtx = inst.start - this.offA;
    const endCtx = inst.end - this.offA;
    if (endCtx <= nowCtx + 0.03) {
      // Too late to be worth starting (or cut meanwhile).
      this.pending.delete(inst);
      if (!buf) this.late++;
      return;
    }
    if (!buf) return; // still loading: retried on the next tick
    this.pending.delete(inst);
    let when = startCtx;
    let offset = 0;
    if (when < nowCtx + 0.005) {
      // Late (buffer arrived after the start): join part-way so the sound still matches the picture.
      offset = (nowCtx + 0.02 - startCtx) * 1; // audio seconds into the clip
      when = nowCtx + 0.02;
      this.late++;
      if (this.log) this.log.late++;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = this.gains.get(inst.clip.id) ?? 1;
    src.connect(g).connect(master);
    const dur = Math.max(0, endCtx - when);
    src.start(when, offset, dur);
    const p: Playing = { src, gain: g };
    this.playing.set(inst, p);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      this.playing.delete(inst);
    };
    if (this.log) this.log.starts.push({ clip: inst.clip.id, T: inst.start, end: inst.end, ctxStart: when, offset });
  }

  private readonly cancel = (inst: Instance, at: number) => {
    this.pending.delete(inst);
    const p = this.playing.get(inst);
    const ctx = this.ctx;
    if (!p || !ctx) return;
    const atCtx = Math.max(ctx.currentTime, at - this.offA);
    p.gain.gain.setTargetAtTime(0, atCtx, CUT_FADE / 3);
    try {
      p.src.stop(atCtx + CUT_FADE);
    } catch {
      /* already stopped */
    }
  };

  // ── Sound on / off ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Must be called from inside a user gesture handler. */
  enableSound(): void {
    const ctx = unlock();
    if (!ctx) {
      $sound.set('blocked');
      return;
    }
    $sound.set('starting');
    storeSoundOn(true);
    if (!this.master) this.build(ctx);
    const req = this.schedule.current;
    const first = req ? this.load(req.clip) : Promise.resolve(null);
    // The story's clips are small (≈ 64 KB each): fetch them all now so no chirp ever starts late.
    for (const [id, src] of this.sources) if (src.kind === 'url') void this.load(id);
    void Promise.all([first, ctx.state === 'running' ? Promise.resolve() : ctx.resume()]).then(() => {
      if (ctx.state !== 'running') {
        $sound.set('blocked');
        return;
      }
      this.switchTo('audio');
      this.master!.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
      $sound.set('on');
    });
  }

  disableSound(): void {
    storeSoundOn(false);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    // Nodes already started keep running silently and end by themselves; the schedule (and the picture) runs on.
    this.pending.clear();
    this.switchTo('silent');
    $sound.set('off');
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    this.clock = new AudibleClock(ctx);
    this.clock.userOffsetS = $syncMs.get() / 1000;
    const master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.clock?.snap();
      if (this.mode === 'audio' && (ctx.state as string) === 'interrupted') $sound.set('blocked');
    });
    try {
      this.worker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = this.tick;
      this.worker.postMessage('start');
    } catch {
      setInterval(this.tick, 25);
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.clock?.snap());
  }

  private switchTo(mode: 'silent' | 'audio'): void {
    const perf = performance.now();
    const T = this.now(perf);
    this.mode = mode;
    if (mode === 'audio') {
      this.clock!.snap();
      this.offA = T - this.clock!.now(perf);
      // Instances already under way (scheduled while silent) join part-way.
      for (const inst of this.schedule.instances) if (inst.end > T && !this.playing.has(inst)) this.emit(inst);
    } else this.offS = T - perf / 1000;
  }

  private onVisibility(): void {
    const hidden = document.hidden;
    const ctx = audioContext();
    if (hidden) {
      this.pausedAt = this.now(performance.now());
      if (this.mode === 'audio' && ctx && this.master) {
        this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        setTimeout(() => {
          if (document.hidden) void ctx.suspend();
        }, 60);
        pauseShim(true);
      }
      // A clip cut by hiding the tab is cut in the schedule too, so picture and sound agree on return.
      this.schedule.cut(this.pausedAt, this.cancel, true);
      return;
    }
    const T = this.pausedAt ?? this.lastT;
    this.pausedAt = null;
    if (this.mode === 'audio' && ctx && this.master) {
      pauseShim(false);
      void ctx.resume().then(() => {
        this.clock!.snap();
        this.offA = T - this.clock!.now(performance.now());
        this.master!.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
      });
      setTimeout(() => {
        if (ctx.state !== 'running' && this.mode === 'audio') $sound.set('blocked');
      }, 500);
    } else this.offS = T - performance.now() / 1000;
  }

  /** Context and graph for diagnostics (dev pages, audio-check). */
  diagnostics() {
    const c = this.ctx;
    return c
      ? { state: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency ?? 0, late: this.late, mode: this.mode, offA: this.offA, buffers: [...this.buffers.keys()] }
      : { state: 'none', mode: this.mode, late: this.late, offA: 0, buffers: [] as string[] };
  }
}

const noop = () => {};

export const transport = new Transport();
export type { ChirpFrame, ClipInfo, SoundRequest };
