// The one musical clock for the page. Transport seconds T run continuously whether or not sound is on:
//  - silent: T = performance.now()/1000 + offS (paused while the tab is hidden);
//  - audio:  T = audible context time + offA, and an onset at T is started at context time T − offA, so it reaches
//    the ear exactly when the picture shows it.
// Switching between the two keeps T (and so the musical position) continuous. The Sequencer (pure) owns tempo,
// score and onsets; this module only feeds it a horizon and routes its onsets to Web Audio.

import { Sequencer, SILENCE, type MusicTarget, type Engine } from '../rhythm/sequencer.ts';
import { createMusicFrame, fillFrame, type MusicFrame } from '../rhythm/frame.ts';
import { MAX_LAYERS } from '../rhythm/pattern.ts';
import type { Entry } from '../rhythm/timeline.ts';
import { $audible, $sound, $syncMs, storeSoundOn, storedSoundOn, storedSyncMs } from '../state/sound.ts';
import { $sceneStatus } from '../state/store.ts';
import { AudibleClock } from './clock.ts';
import { audioContext, pauseShim, unlock } from './context.ts';
import { loadBank, type Bank } from './bank.ts';
import { createStream, type Stream } from './stream.ts';

const LOOKAHEAD = 0.12;
const LOOKAHEAD_BUSY = 0.35;

interface Graph {
  master: GainNode;
  limiter: DynamicsCompressorNode;
  roomSend: GainNode;
  scale: GainNode[];
  env: GainNode[];
  pan: StereoPannerNode[];
}

export interface OnsetLog {
  onsets: { T: number; layer: number }[];
  frames: { perf: number; T: number; age: number[] }[];
  late: number;
}

class Transport {
  readonly seq = new Sequencer(0, 0, 0.5);
  private mode: 'silent' | 'audio' = 'silent';
  private offS = 0;
  private offA = 0;
  private pausedAt: number | null = null;
  private ctx: AudioContext | null = null;
  private clock: AudibleClock | null = null;
  private graph: Graph | null = null;
  private bank: Bank | null = null;
  private stream: Stream | null = null;
  private worker: Worker | null = null;
  private rr = 0;
  private lastEntry: Entry | null = null;
  private lastT = 0;
  private busyUntil = 0;
  private audibleAt = 0;
  private frozenPos: number | null = null;
  private envTarget = new Float32Array(MAX_LAYERS).fill(-1);
  readonly frameOut: MusicFrame = createMusicFrame();
  log: OnsetLog | null = null;
  /** Hits dropped because they would have started late. */
  late = 0;

  constructor() {
    this.offS = -performance.now() / 1000;
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('audiolog') === '1') {
      this.log = { onsets: [], frames: [], late: 0 };
      (window as unknown as { __sync?: OnsetLog; __transport?: Transport }).__sync = this.log;
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

  /** Transport seconds at the ear. */
  now(perfMs: number): number {
    if (this.pausedAt !== null) return this.pausedAt;
    if (this.mode === 'audio' && this.clock) return this.clock.now(perfMs) + this.offA;
    return perfMs / 1000 + this.offS;
  }

  request(t: MusicTarget): void {
    this.seq.request(t);
  }

  get target(): MusicTarget {
    return this.seq.current;
  }

  /** Dev and stills: hold the music at a fixed musical position (the section restarts at position 0). */
  freezeAt(pos: number | null): void {
    this.frozenPos = pos;
    if (pos !== null) this.seq.reset(0, 0, Math.max(1e-3, this.seq.current.rate));
  }

  /** Called by the renderer once per frame. */
  frame(perfMs: number, out: MusicFrame = this.frameOut): MusicFrame {
    if (this.frozenPos !== null) {
      // Advance the score far enough to cover the frozen position, then read it.
      const T = this.seq.tempo.timeAt(this.frozenPos);
      if (this.seq.horizonTime < T + LOOKAHEAD) this.seq.advance(T + LOOKAHEAD, noop);
      fillFrame(this.seq, T, out);
      out.audible = false;
      return out;
    }
    const T = this.now(perfMs);
    this.lastT = T;
    if (this.mode === 'silent' && this.pausedAt === null) this.seq.advance(T + LOOKAHEAD, this.silentEmit);
    fillFrame(this.seq, T, out);
    out.audible = this.mode === 'audio' && this.ctx?.state === 'running';
    if (this.log && out.running) {
      const age: number[] = [];
      for (let i = 0; i < out.layers; i++) age.push(out.onsetAge[i]!);
      this.log.frames.push({ perf: perfMs, T, age });
      if (this.log.frames.length > 20000) this.log.frames.splice(0, 10000);
    }
    return out;
  }

  private readonly silentEmit = (time: number, layer: number) => {
    if (this.log) this.log.onsets.push({ T: time, layer });
  };

  private tick = () => {
    const ctx = this.ctx;
    if (this.mode !== 'audio' || !ctx || ctx.state !== 'running' || this.frozenPos !== null) return;
    const perf = performance.now();
    const statuses = $sceneStatus.get();
    if (Object.values(statuses).includes('loading')) this.busyUntil = perf + 2000;
    const la = perf < this.busyUntil ? LOOKAHEAD_BUSY : LOOKAHEAD;
    const H = ctx.currentTime + la + this.offA;
    this.seq.advance(H, this.emit);
    this.stream?.flush();
    this.syncEnvelopes(H);
    if (perf - this.audibleAt > 100) {
      this.audibleAt = perf;
      const t = this.seq.current;
      const a = $audible.get();
      const key = t.section?.key ?? null;
      if (a.key !== key || Math.abs(a.rate - t.rate) / Math.max(1e-6, a.rate) > 0.01 || a.running !== !!t.section)
        $audible.set({ running: !!t.section, rate: t.rate, key });
    }
  };

  private readonly emit = (time: number, layer: number, step: number, accent: number, _together: number, entry: Entry) => {
    const ctx = this.ctx!;
    const g = this.graph!;
    const when = time - this.offA;
    if (entry !== this.lastEntry) this.onEntry(entry);
    if (this.log) this.log.onsets.push({ T: time, layer });
    const engine: Engine = this.seq.engines.get(entry) ?? 'hits';
    const c = entry.c!;
    const spec = c.section.layers[layer]!;
    if (when < ctx.currentTime + 0.002 || !this.bank) {
      this.late++;
      if (this.log) this.log.late++;
      return;
    }
    const rate = spec.pitch ? Math.pow(2, spec.pitch / 12) : 1;
    if (engine === 'stream') {
      // Overlapping periodic hits add up coherently: tame the level as the hit rate climbs into the audio range.
      const hz = (this.seq.tempo.rateAt(time) * c.G) / c.tickStep[layer]!;
      if (this.stream) {
        this.stream.push(when, layer, spec.voice, accent, this.rr++, rate, Math.min(1, Math.pow(8 / hz, 0.8)));
        return;
      }
      // No AudioWorklet: scheduled nodes cope up to a few dozen hits a second per layer; above that, thin them out.
      if (hz > 60 && this.rr++ % Math.ceil(hz / 60) !== 0) return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.bank.get(spec.voice, accent, this.rr++);
    if (rate !== 1) src.playbackRate.value = rate;
    // Sound follows the picture: a hit sits in the stereo field where its step sits on the layer's ring.
    const spread = this.seq.current.spread ?? 0.45;
    const steps = c.steps[layer]!;
    const pan = Math.max(-1, Math.min(1, spec.pan + (steps > 1 ? spread * Math.sin((2 * Math.PI * step) / steps) : 0)));
    if (Math.abs(pan) > 1e-3) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(p).connect(g.scale[layer]!);
    } else src.connect(g.scale[layer]!);
    src.start(when);
  };

  /** A new score entry starts: set each layer bus's level and pan at its start time. */
  private onEntry(e: Entry): void {
    this.lastEntry = e;
    const g = this.graph!;
    const at = Math.max(this.ctx!.currentTime, this.seq.tempo.timeAt(e.atPos) - this.offA);
    const layers = e.c?.section.layers ?? [];
    const stream = (this.seq.engines.get(e) ?? 'hits') === 'stream' && !!this.stream;
    for (let i = 0; i < MAX_LAYERS; i++) {
      const spec = layers[i];
      g.scale[i]!.gain.setValueAtTime(spec ? spec.gain : 0, at);
      // Scheduled hits carry their own pan; the worklet's mono outputs are panned per layer here.
      g.pan[i]!.pan.setValueAtTime(spec && stream ? spec.pan : 0, at);
    }
  }

  private roomLevel = -1;

  private syncEnvelopes(H: number): void {
    const g = this.graph!;
    const room = this.seq.current.room ?? 0.16;
    if (room !== this.roomLevel) {
      this.roomLevel = room;
      g.roomSend.gain.setTargetAtTime(room, Math.max(this.ctx!.currentTime, H - this.offA), 0.15);
    }
    for (let i = 0; i < MAX_LAYERS; i++) {
      const v = this.seq.gains.targetOf(i);
      if (v === this.envTarget[i]) continue;
      this.envTarget[i] = v;
      g.env[i]!.gain.setTargetAtTime(v, Math.max(this.ctx!.currentTime, H - this.offA), 0.08 / 3);
    }
  }

  /** Must be called from inside a user gesture handler. */
  enableSound(): void {
    const ctx = unlock();
    if (!ctx) {
      $sound.set('blocked');
      return;
    }
    $sound.set('starting');
    storeSoundOn(true);
    if (!this.graph) this.build(ctx);
    void Promise.all([loadBank(), ctx.state === 'running' ? Promise.resolve() : ctx.resume()]).then(async ([bank]) => {
      this.bank = bank;
      this.stream ??= await createStream(ctx, bank, this.graph!.scale).catch((err) => {
        console.warn('[audio] stream engine unavailable; using scheduled hits', err);
        return null;
      });
      if (ctx.state !== 'running') {
        $sound.set('blocked');
        return;
      }
      this.switchTo('audio');
      this.graph!.master.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
      $sound.set('on');
    });
  }

  disableSound(): void {
    storeSoundOn(false);
    if (this.ctx && this.graph) this.graph.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
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
    // A small stereo room: decorrelated decaying noise in each ear, sent from the mix and limited with it.
    const roomSend = ctx.createGain();
    roomSend.gain.value = 0;
    const room = ctx.createConvolver();
    room.normalize = true;
    room.buffer = roomImpulse(ctx);
    master.connect(roomSend).connect(room).connect(limiter);
    const scale: GainNode[] = [];
    const env: GainNode[] = [];
    const pan: StereoPannerNode[] = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      const s = ctx.createGain();
      const e = ctx.createGain();
      const p = ctx.createStereoPanner();
      s.connect(e).connect(p).connect(master);
      scale.push(s);
      env.push(e);
      pan.push(p);
    }
    this.graph = { master, limiter, roomSend, scale, env, pan };
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
      this.lastEntry = null;
      this.envTarget.fill(-1);
    } else this.offS = T - perf / 1000;
  }

  private onVisibility(): void {
    const hidden = document.hidden;
    const ctx = audioContext();
    if (hidden) {
      const perf = performance.now();
      this.pausedAt = this.now(perf);
      if (this.mode === 'audio' && ctx && this.graph) {
        this.graph.master.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        setTimeout(() => {
          if (document.hidden) void ctx.suspend();
        }, 60);
        pauseShim(true);
      }
      return;
    }
    const T = this.pausedAt ?? this.lastT;
    this.pausedAt = null;
    if (this.mode === 'audio' && ctx && this.graph) {
      pauseShim(false);
      void ctx.resume().then(() => {
        this.clock!.snap();
        this.offA = T - this.clock!.now(performance.now());
        this.graph!.master.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
      });
      setTimeout(() => {
        if (ctx.state !== 'running' && this.mode === 'audio') $sound.set('blocked');
      }, 500);
    } else this.offS = T - performance.now() / 1000;
  }

  /** Context and graph for diagnostics (dev/sync). */
  diagnostics() {
    const c = this.ctx;
    return c
      ? { state: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency ?? 0, late: this.late, mode: this.mode, stream: !!this.stream }
      : { state: 'none', mode: this.mode, late: this.late };
  }
}

const noop = () => {};

/** 1.4 s stereo impulse: 11 ms pre-delay, exponential decay, gently darkened, different noise in each ear. */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.ceil(1.4 * sr);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let seed = ch ? 0x9e3779b9 : 0x85ebca6b;
    let lp = 0;
    const pre = Math.round(0.011 * sr);
    for (let i = pre; i < len; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const n = ((seed >>> 0) / 4294967296) * 2 - 1;
      const t = (i - pre) / sr;
      const k = 0.35 + 0.5 * Math.min(1, t / 0.8);
      lp += (n - lp) * (1 - k);
      d[i] = lp * Math.exp(-t / 0.32);
    }
  }
  return b;
}

export const transport = new Transport();
export { SILENCE };
