// Clock check (owner fix: the scroll does not control playback). For stages 4–6, on the full page with sound off
// (the transport runs the same schedule silently), scroll to several positions inside the stage and, at each, sample
// what the scene's clock produced (window.__clockProbe, written by clipClock) against the transport frame:
//  - while the stage's clip plays, the scene's data time is exactly from + pos / slow (the audio position alone);
//  - the same audio position gives the same time at every scroll position;
//  - scrolling within the stage while it plays neither restarts the clip (same instance) nor moves the time off the
//    audio clock.
// Usage: node scripts/clock-check.ts [--base http://localhost:4390]
import { chromium, type Page } from 'playwright';
import { stageIndex, stageToProgress } from '../src/time/stages.ts';
import { SLOW_BINARY, SLOW_INSPIRAL, SLOW_MERGER, type SlowChirpSpec } from '../src/script/slow.ts';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1]! : 'http://localhost:4390';
let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ok ' : '  FAIL'} ${msg}`);
  if (!cond) failures++;
};

interface Sample {
  clip: string;
  t: number;
  pos: number;
  playing: boolean;
  instance: number;
  frames: number;
}

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}/?tier=low&probe=0`, { waitUntil: 'load' });
await page.waitForFunction('!!window.__driver && !!window.__engine && !!window.__clockProbe', null, { timeout: 90000 });

const scrollTo = (p: Page, id: string, local: number) =>
  p.evaluate((pp) => (window as unknown as { __driver: { scrollToProgress(p: number, o: object): void } }).__driver.scrollToProgress(pp, { immediate: true }), stageToProgress(stageIndex(id), local));

/** Samples over `ms`, one per animation frame (the probe is written by the scene's update). */
const sample = (p: Page, ms: number) =>
  p.evaluate(
    (dur) =>
      new Promise<Sample[]>((res) => {
        const out: Sample[] = [];
        const t0 = performance.now();
        let last = -1;
        const tick = () => {
          const c = (window as unknown as { __clockProbe: Sample }).__clockProbe;
          if (c.frames !== last) {
            last = c.frames;
            out.push({ ...c });
          }
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else res(out);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

const STAGES: [string, SlowChirpSpec][] = [
  ['binary', SLOW_BINARY],
  ['inspiral', SLOW_INSPIRAL],
  ['merger', SLOW_MERGER],
];

for (const [id, spec] of STAGES) {
  // Enter the stage and let its clip start (a chirp still playing from the previous stage finishes first).
  await scrollTo(page, id, 0.3);
  await page.waitForFunction((clip) => {
    const c = (window as unknown as { __clockProbe: Sample }).__clockProbe;
    return c.clip === clip && c.playing;
  }, spec.id, { timeout: 30000 });
  const all: (Sample & { local: number })[] = [];
  let maxErr = 0;
  const instances = new Set<number>();
  for (const local of [0.3, 0.5, 0.75, 0.2, 0.9]) {
    await scrollTo(page, id, local);
    const s = (await sample(page, 700)).filter((x) => x.clip === spec.id);
    for (const x of s) {
      all.push({ ...x, local });
      if (x.playing) {
        maxErr = Math.max(maxErr, Math.abs(x.t - (spec.from + x.pos / spec.slow)));
        instances.add(x.instance);
      }
    }
  }
  const playing = all.filter((x) => x.playing);
  const locals = new Set(playing.map((x) => x.local));
  ok(locals.size === 5, `${id}: clip playing at all 5 scroll positions (${[...locals].join(', ')})`);
  ok(maxErr < 1e-9, `${id}: picture time = ${spec.from} s + audio position ÷ ${spec.slow} at every frame (max |Δ| ${maxErr.toExponential(1)} s over ${playing.length} frames)`);
  // Scrolling inside the stage does not restart the loop: one instance unless the clip naturally looped meanwhile.
  const dur = (spec.to - spec.from) * spec.slow;
  ok(instances.size <= Math.ceil(3.5 / dur) + 1, `${id}: ${instances.size} play(s) over ~3.5 s of scrolling (clip ${dur.toFixed(2)} s): the scroll does not restart it`);
  // Monotonic within one play, whatever the scroll did between samples.
  let mono = true;
  for (let i = 1; i < playing.length; i++) if (playing[i]!.instance === playing[i - 1]!.instance && playing[i]!.t < playing[i - 1]!.t - 1e-12) mono = false;
  ok(mono, `${id}: time only moves forward within a play while scrolling back and forth`);
}
ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nclock check passed');
process.exit(failures ? 1 : 0);
