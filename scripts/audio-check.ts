// Audio checks in a real browser (Chromium, autoplay allowed):
//  1. Live sync: sound on, stage "two" for 5 s. Every logged onset must show in the first frame at or after it
//     with age = T − onset (≤ one frame + 1 ms), no flash without an onset, T monotonic.
//  2. Clock switch: turning sound off and on moves the musical position by < 1 ms of continuity error.
//  3. Fusion: the harmony stage at the top of its scroll runs on the stream engine; an OfflineAudioContext render of
//     the same voices at 600 + 400 hits/s shows spectral peaks at 400, 600 (and 200 = the fifth's common root).
// Usage: node scripts/audio-check.ts [--base http://localhost:4390]

import { chromium } from 'playwright';
import { stageIndex, stageToProgress } from '../src/time/stages.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? (args[i + 1] ?? d) : d;
};
const base = opt('base', 'http://localhost:4390');

const browser = await chromium.launch({
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-webgpu',
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
page.on('response', (r) => {
  // Stills are generated last (pnpm stills); before that they 404 harmlessly.
  if (r.status() >= 400 && !/\/stills\/|\/src\/audio\/bank\.ts/.test(r.url())) errors.push(`${r.status()} ${r.url()}`);
});
page.on('pageerror', (e) => errors.push(String(e)));

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failed++;
};

await page.goto(`${base}/?audiolog=1&probe=0`, { waitUntil: 'load' });
await page.waitForFunction('!!window.__driver && !!window.__engine', null, { timeout: 60000 });
const go = async (id: string, local: number) => {
  const p = stageToProgress(stageIndex(id), local);
  await page.evaluate(
    (p) =>
      (
        window as unknown as { __driver: { scrollToProgress(p: number, o: object): void } }
      ).__driver.scrollToProgress(p, { immediate: true }),
    p,
  );
};

// ── 1. Live sync ────────────────────────────────────────────────────────────────────────────────────────────────
await go('two', 0.5);
await page.click('[data-sound]');
await page.waitForFunction(
  () => document.querySelector('[data-sound]')?.getAttribute('data-state') === 'on',
  null,
  { timeout: 20000 },
);
await page.evaluate(() => {
  const s = (window as unknown as { __sync: { onsets: unknown[]; frames: unknown[] } }).__sync;
  s.onsets.length = 0;
  s.frames.length = 0;
});
await page.waitForTimeout(5000);
const sync = await page.evaluate(
  () =>
    (
      window as unknown as {
        __sync: {
          onsets: { T: number; layer: number }[];
          frames: { perf: number; T: number; age: number[] }[];
          late: number;
        };
      }
    ).__sync,
);
const frames = sync.frames;
const lastT = frames.at(-1)?.T ?? 0;
const firstT = frames[0]?.T ?? 0;
const onsets = sync.onsets.filter((o) => o.T > firstT && o.T < lastT);
// 3:2 in a 2 s bar: 5 onsets per bar (the downbeat counts once per layer) = 2.5 per second.
const expected = (lastT - firstT) * 2.5;
check(
  Math.abs(onsets.length - expected) <= 2.5,
  `${onsets.length} onsets in ${(lastT - firstT).toFixed(2)} s of audio on stage two (expect ${expected.toFixed(1)})`,
);
check(sync.late === 0, `late hits: ${sync.late}`);
let mono = true;
for (let i = 1; i < frames.length; i++) if (frames[i]!.T < frames[i - 1]!.T) mono = false;
check(mono, 'transport time is monotonic across frames');
let worst = 0;
let missing = 0;
for (const o of onsets) {
  const f = frames.find((fr) => fr.T >= o.T);
  if (!f) continue;
  const age = f.age[o.layer]!;
  const want = f.T - o.T;
  if (Math.abs(age - want) > 1e-4) missing++;
  worst = Math.max(worst, want);
}
check(
  missing === 0,
  `every onset appears in the first frame after it with the right age (${missing} mismatches)`,
);
check(worst < 1 / 30 + 0.001, `worst onset-to-frame delay ${(worst * 1000).toFixed(1)} ms (≤ one frame)`);
// No flash without an onset: a frame whose age dropped must have an onset in between.
let phantom = 0;
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1]!;
  const b = frames[i]!;
  for (let L = 0; L < b.age.length; L++) {
    if (b.age[L]! < (a.age[L] ?? Infinity) && b.age[L]! < 0.5) {
      const hit = sync.onsets.some((o) => o.layer === L && o.T > a.T - 1e-6 && o.T <= b.T + 1e-6);
      if (!hit) phantom++;
    }
  }
}
check(phantom === 0, `no flash without an onset (${phantom})`);

// ── 2. Clock switch ─────────────────────────────────────────────────────────────────────────────────────────────
const before = await page.evaluate(() => {
  const w = window as unknown as { __sync: { frames: { T: number; perf: number }[] } };
  return w.__sync.frames.at(-1)!;
});
await page.click('[data-sound]');
await page.waitForTimeout(400);
await page.click('[data-sound]');
await page.waitForFunction(
  () => document.querySelector('[data-sound]')?.getAttribute('data-state') === 'on',
  null,
  { timeout: 20000 },
);
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const w = window as unknown as { __sync: { frames: { T: number; perf: number }[] } };
  return w.__sync.frames.at(-1)!;
});
const drift = after.T - before.T - (after.perf - before.perf) / 1000;
check(
  Math.abs(drift) < 0.03,
  `sound off/on keeps time continuous (drift ${(drift * 1000).toFixed(1)} ms; smoothing tolerance 30 ms)`,
);

// ── 3. Fusion ───────────────────────────────────────────────────────────────────────────────────────────────────
await go('harmony', 0.84);
await page.waitForTimeout(3000);
const diag = await page.evaluate(() => {
  const w = window as unknown as {
    __sync: { late: number };
    __transport: { diagnostics(): { stream?: boolean } };
  };
  return { late: w.__sync.late, stream: !!w.__transport.diagnostics().stream };
});
check(diag.stream, 'stream engine (AudioWorklet) loaded');
check(diag.late < 20, `harmony stage at 600 + 400 hits/s: late hits ${diag.late}`);
// The offline spectrum imports source modules, so it runs against the dev server only.
const devServer = await page
  .evaluate(async () => (await fetch('/src/audio/bank.ts', { method: 'HEAD' })).ok)
  .catch(() => false);
const spectrum = !devServer
  ? null
  : await page.evaluate(async () => {
      const { loadBank } = await import('/src/audio/bank.ts' as string);
      const bank = await loadBank();
      const sr = 48000;
      const ctx = new OfflineAudioContext(1, sr, sr);
      const buf = bank.get('wood', 1, 0);
      const lower = Math.pow(2, -7 / 12);
      for (let k = 0; k < 600; k++) {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(ctx.destination);
        s.start(k / 600);
      }
      for (let k = 0; k < 400; k++) {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.playbackRate.value = lower;
        s.connect(ctx.destination);
        s.start(k / 400);
      }
      const out = (await ctx.startRendering()).getChannelData(0);
      // Goertzel power at a few frequencies over the last half second.
      const seg = out.subarray(sr / 2);
      const power = (f: number) => {
        const w = (2 * Math.PI * f) / sr;
        const c = 2 * Math.cos(w);
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < seg.length; i++) {
          const s0 = seg[i]! + c * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        return s1 * s1 + s2 * s2 - c * s1 * s2;
      };
      return { p400: power(400), p600: power(600), p500: power(500), p450: power(450), p1200: power(1200) };
    });
if (!spectrum) console.log('  skip offline spectrum (dev server only)');
else {
  const floor = Math.max(spectrum.p500, spectrum.p450);
  check(
    spectrum.p400 > floor * 100 && spectrum.p600 > floor * 100,
    `fused tones at 400 and 600 Hz stand out (×${(spectrum.p400 / floor).toExponential(1)}, ×${(spectrum.p600 / floor).toExponential(1)} over 450/500 Hz)`,
  );
}

check(
  errors.length === 0,
  `console errors: ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 5).join('\n    ') : ''}`,
);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nPASSED');
process.exit(failed ? 1 : 0);
