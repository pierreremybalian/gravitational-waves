// Audio checks in a real browser (Chromium, autoplay allowed), against the dev server's /dev/listen/ bench:
//  1. Clip alignment: each GW150914 clip, decoded, is loudest where its metadata puts the merger (t = 0): the clip's
//     t0 is what scenes use to place the playhead on the waveform.
//  2. Playhead = what is heard: sound on, play chirp-H1. For every frame while it plays, the scene-facing playhead
//     (frame.pos) equals the position in the buffer at the listener's ear, computed independently from the context's
//     unsmoothed output timestamp: |Δ| ≤ one frame. One start, no late start, T monotonic, data time t = t0 + pos.
//  3. Clock switch: sound off and on keeps transport time continuous.
//  4. A catalogue snippet plays through the same path.
// Usage: node scripts/audio-check.ts [--base http://localhost:4390]

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? (args[i + 1] ?? d) : d;
};
const base = opt('base', 'http://localhost:4390');
const FRAME = 1 / 60;

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
page.on('pageerror', (e) => errors.push(String(e)));

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failed++;
};

type Frame = { perf: number; T: number; clip: string | null; playing: boolean; t: number; pos: number; ear: number | null; offA: number };
type Sync = { starts: { clip: string; T: number; end: number; ctxStart: number; offset: number }[]; frames: Frame[]; late: number };
const getSync = () => page.evaluate(() => (window as unknown as { __sync: Sync }).__sync);
const resetSync = () =>
  page.evaluate(() => {
    const s = (window as unknown as { __sync: Sync }).__sync;
    s.starts.length = 0;
    s.frames.length = 0;
    s.late = 0;
  });

await page.goto(`${base}/dev/listen/?audiolog=1`, { waitUntil: 'load' });
await page.waitForFunction('!!window.__ready && !!window.__transport', null, { timeout: 60000 });
// A cold dev server may re-optimise dependencies and reload the page once: settle, then wait again.
await page.waitForTimeout(1500);
await page.waitForFunction('!!window.__ready && !!window.__transport', null, { timeout: 60000 });

// ── 1. Clip alignment ───────────────────────────────────────────────────────────────────────────────────────────
const clips = await page.evaluate(async () => {
  const meta = (await (await fetch('/data/gw150914/meta.json')).json()) as {
    clips: Record<string, { url: string; t0: number; duration: number; speed: number; pitch: number }>;
  };
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const out: { id: string; peakAt: number; mergerAt: number; duration: number; bufDuration: number }[] = [];
  for (const [id, c] of Object.entries(meta.clips)) {
    const buf = await ctx.decodeAudioData(await (await fetch(c.url)).arrayBuffer());
    const x = buf.getChannelData(0);
    const sr = buf.sampleRate;
    // Envelope: RMS over 8 ms.
    const win = Math.round(0.008 * sr);
    let acc = 0;
    let best = 0;
    let bestI = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i]! * x[i]!;
      if (i >= win) acc -= x[i - win]! * x[i - win]!;
      if (acc > best) {
        best = acc;
        bestI = i - win / 2;
      }
    }
    out.push({ id, peakAt: bestI / sr, mergerAt: -c.t0 / c.speed, duration: c.duration, bufDuration: buf.duration });
  }
  return out;
});
for (const c of clips) {
  const d = c.peakAt - c.mergerAt;
  check(Math.abs(d) < 0.02, `${c.id}: loudest ${(d * 1e3).toFixed(1)} ms from where the metadata puts the merger (≤ 20 ms)`);
  check(Math.abs(c.bufDuration - c.duration) < 0.002, `${c.id}: decoded length ${c.bufDuration.toFixed(3)} s = metadata ${c.duration.toFixed(3)} s`);
}

// ── 2. Playhead = what is heard ─────────────────────────────────────────────────────────────────────────────────
await page.click('[data-sound]');
await page.waitForFunction(() => document.querySelector('[data-sound]')?.getAttribute('data-state') === 'on', null, { timeout: 20000 });
await resetSync();
await page.click('[data-clip="chirp-H1"]');
await page.waitForTimeout(3000);
const s1 = await getSync();
const st = s1.starts.filter((s) => s.clip === 'chirp-H1');
check(st.length === 1, `one start of chirp-H1 (${st.length})`);
check(s1.late === 0, `late starts: ${s1.late}`);
const start = st[0];
const fr = s1.frames.filter((f) => f.clip === 'chirp-H1' && f.playing);
check(fr.length > 60, `${fr.length} frames while playing`);
let mono = true;
for (let i = 1; i < s1.frames.length; i++) if (s1.frames[i]!.T < s1.frames[i - 1]!.T) mono = false;
check(mono, 'transport time is monotonic across frames');
if (start) {
  let worst = 0;
  let n = 0;
  for (const f of fr) {
    if (f.ear === null) continue;
    // Heard now: buffer position = ear context time − context start + start offset.
    const heard = f.ear - start.ctxStart + start.offset;
    worst = Math.max(worst, Math.abs(heard - f.pos));
    n++;
  }
  check(n > 60 && worst <= FRAME, `playhead vs heard position over ${n} frames: worst ${(worst * 1e3).toFixed(2)} ms (≤ one frame, ${(FRAME * 1e3).toFixed(1)} ms)`);
  const t0 = clips.find((c) => c.id === 'chirp-H1')!.mergerAt;
  const badT = fr.filter((f) => Math.abs(f.t - (f.pos - t0)) > 1e-6).length;
  check(badT === 0, `data time t = t0 + pos on every frame (${badT} mismatches)`);
}

// ── 3. Clock switch ─────────────────────────────────────────────────────────────────────────────────────────────
const before = (await getSync()).frames.at(-1)!;
await page.click('[data-sound]');
await page.waitForTimeout(400);
await page.click('[data-sound]');
await page.waitForFunction(() => document.querySelector('[data-sound]')?.getAttribute('data-state') === 'on', null, { timeout: 20000 });
await page.waitForTimeout(300);
const after = (await getSync()).frames.at(-1)!;
const drift = after.T - before.T - (after.perf - before.perf) / 1000;
check(Math.abs(drift) < 0.03, `sound off/on keeps time continuous (drift ${(drift * 1000).toFixed(1)} ms; smoothing tolerance 30 ms)`);

// ── 4. A catalogue snippet ──────────────────────────────────────────────────────────────────────────────────────
await page.waitForSelector('[data-event]', { timeout: 20000 });
await resetSync();
const evName = await page.evaluate(() => {
  const b = document.querySelector<HTMLButtonElement>('[data-event]')!;
  b.click();
  return `event:${b.dataset.event}:${b.textContent}`;
});
await page.waitForTimeout(2800);
const s4 = await getSync();
check(s4.starts.some((s) => s.clip === evName), `catalogue snippet ${evName} started`);
check(s4.frames.some((f) => f.clip === evName && f.playing), 'its frames report it playing');
check(s4.late === 0, `late starts: ${s4.late}`);

check(errors.length === 0, `console errors: ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 5).join('\n    ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nPASSED');
process.exit(failed ? 1 : 0);
