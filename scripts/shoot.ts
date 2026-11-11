// Screenshot harness for scenes and the full page (used for self-testing and stills).
// Usage:
//   node scripts/shoot.ts --url "http://localhost:4330/dev/scenes/?scene=qgp&local=0.5&ui=0" --out shot.png
//   node scripts/shoot.ts --scene qgp --locals 0.1,0.5,0.9 --outdir scratch/shots [--webgl] [--base …] [--leak] [--chapter <id>]
//   node scripts/shoot.ts --page 0,0.3,0.6 --outdir scratch/shots   (full page at scroll progress values)
// Waits for window.__ready (dev route) and prints console errors. Exit code 1 on page errors or scene failure.
//
// Efficiency marker (owner request: screenshots only where they change a decision):
//  - Several frames are tiled into ONE contact sheet (<outdir>/sheet-<target>.png): read that, not each frame.
//    --no-sheet to skip it.
//  - Every run is logged to scratch/shots/ledger.jsonl. Each target (scene or stage) has a build budget of
//    BUDGET runs; past it the run still happens but prints a warning. `node scripts/shoot.ts --ledger` prints the tally.
//  - Quality gates are NOT budgeted: the final pass (phone, --webgl, --leak, audio-check) always runs once.
import { chromium } from 'playwright';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LEDGER = 'scratch/shots/ledger.jsonl';
const BUDGET = 6;
type LedgerRow = { at: string; target: string; frames: number; sheet: boolean; flags: string[] };
const readLedger = (): LedgerRow[] =>
  existsSync(LEDGER)
    ? readFileSync(LEDGER, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LedgerRow)
    : [];

if (process.argv.includes('--ledger')) {
  const rows = readLedger();
  const by = new Map<string, { runs: number; frames: number; final: number }>();
  for (const r of rows) {
    const e = by.get(r.target) ?? { runs: 0, frames: 0, final: 0 };
    const final = r.flags.some((f) => f === 'webgl' || f === 'phone' || f === 'leak');
    if (final) e.final++;
    else e.runs++;
    e.frames += r.frames;
    by.set(r.target, e);
  }
  console.log('target              build runs   final-pass runs   frames');
  for (const [t, e] of [...by].sort()) {
    const mark = e.runs > BUDGET ? `  ⚠ over budget (${BUDGET})` : '';
    console.log(`${t.padEnd(20)}${String(e.runs).padStart(10)}${String(e.final).padStart(18)}${String(e.frames).padStart(9)}${mark}`);
  }
  const total = rows.reduce((a, r) => a + r.frames, 0);
  const sheets = rows.filter((r) => r.sheet).length;
  console.log(`\n${rows.length} runs, ${total} frames, ${sheets} contact sheets (a sheet of n frames costs about one image read)`);
  process.exit(0);
}

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? (args[i + 1] ?? '') : d;
};
const flag = (k: string) => args.includes(`--${k}`);
const base = opt('base', 'http://localhost:4390')!;
const width = Number(opt('width', '1280'));
const height = Number(opt('height', '720'));
const webgl = flag('webgl');
const tier = opt('tier', 'medium');
const timeout = Number(opt('timeout', '90000'));

const jobs: { url: string; out: string }[] = [];
if (opt('url')) jobs.push({ url: opt('url')!, out: opt('out', 'shot.png')! });
if (opt('scene')) {
  const scene = opt('scene')!;
  const outdir = opt('outdir', 'scratch/shots')!;
  for (const l of (opt('locals', '0.1,0.5,0.9') ?? '').split(',')) {
    const chapter = opt('chapter');
    const u = `${base}/dev/scenes/?scene=${scene}&local=${l}&ui=0&tier=${tier}&frames=${opt('frames', '45')}${webgl ? '&webgl=1' : ''}${chapter ? `&chapter=${chapter}` : ''}`;
    jobs.push({ url: u, out: join(outdir, `${scene}${chapter ? `-${chapter}` : ''}-${l}${webgl ? '-webgl' : ''}.png`) });
  }
}
// Full page inside a stage: --stage whose --at 0.2,0.5 (local positions within the stage)
if (opt('stage')) {
  const { stageIndex, stageToProgress } = await import('../src/time/stages.ts');
  const id = opt('stage')!;
  const i = stageIndex(id);
  if (i < 0) throw new Error(`unknown stage ${id}`);
  const outdir = opt('outdir', 'scratch/shots')!;
  for (const l of (opt('at', '0.5') ?? '').split(',')) {
    const p = stageToProgress(i, Number(l));
    jobs.push({ url: `${base}/?tier=${tier}&probe=0${webgl ? '&webgl=1' : ''}#p=${p.toFixed(6)}`, out: join(outdir, `page-${id}-${l}${webgl ? '-webgl' : ''}.png`) });
  }
}
// Full page at given scroll progress values: --page 0,0.25,0.5
if (opt('page')) {
  const outdir = opt('outdir', 'scratch/shots')!;
  for (const p of opt('page')!.split(',')) jobs.push({ url: `${base}/?tier=${tier}${webgl ? '&webgl=1' : ''}#p=${p}`, out: join(outdir, `page-${p}.png`) });
}
if (!jobs.length) {
  console.error('nothing to do; pass --url or --scene');
  process.exit(2);
}
const target = opt('scene') ?? (opt('stage') ? `page:${opt('stage')}` : opt('page') ? 'page' : 'url');
const flags = [webgl && 'webgl', width < 600 && 'phone', flag('leak') && 'leak'].filter(Boolean) as string[];
{
  const prior = readLedger().filter((r) => r.target === target && !r.flags.some((f) => f === 'webgl' || f === 'phone' || f === 'leak')).length;
  if (!flags.length && prior >= BUDGET)
    console.log(`  ⚠ efficiency: build run ${prior + 1} for ${target} (budget ${BUDGET}). Shoot only if it changes a decision; batch locals.`);
}

const browser = await chromium.launch({
  headless: !flag('headed'),
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
});
let failed = false;
for (const job of jobs) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    // Missing stills (before `pnpm stills` has run) are expected 404s, not scene errors.
    const missingAsset = m.type() === 'error' && /Failed to load resource.*404/.test(t);
    if (missingAsset) return;
    if (m.type() === 'error' || /WebGPU|backend|\[scene|\[quality/.test(t)) console.log(`  [${m.type()}] ${t.slice(0, 400)}`);
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log(`  [pageerror] ${String(e).slice(0, 600)}`);
  });
  const t0 = Date.now();
  // The dev server reloads when other files change; retry a navigation that a reload interrupted.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(job.url, { waitUntil: 'load', timeout });
      break;
    } catch (err) {
      if (attempt >= 2 || !/destroyed|interrupted|ERR_ABORTED/i.test(String(err))) throw err;
      await page.waitForTimeout(1500);
    }
  }
  try {
    if (job.url.includes('/dev/scenes')) await page.waitForFunction('window.__ready === true', null, { timeout, polling: 250 });
    else {
      const m = job.url.match(/#p=([\d.]+)/);
      await page.waitForFunction('window.__ready === true || (!!window.__driver && !!window.__engine)', null, { timeout });
      if (m) {
        await page.evaluate((p) => (window as unknown as { __driver: { scrollToProgress(p: number, o: object): void } }).__driver.scrollToProgress(p, { immediate: true }), Number(m[1]));
      }
      await page.waitForTimeout(Number(opt('wait', '4000')));
    }
  } catch {
    console.log('  timeout waiting for __ready');
    failed = true;
  }
  if (flag('leak') && job.url.includes('/dev/scenes')) {
    await page.evaluate("document.querySelector('[data-leak]').click()");
    await page.waitForFunction('!!window.__leak', null, { timeout: timeout * 3, polling: 500 });
    const leak = (await page.evaluate('window.__leak')) as { ok: boolean };
    console.log(`  leak test: ${JSON.stringify(leak)}`);
    if (!leak.ok) failed = true;
  }
  const sceneFailed = await page.evaluate('window.__sceneFailed === true');
  const backend = await page.evaluate('window.__engine ? window.__engine.backend : "none"');
  mkdirSync(dirname(job.out), { recursive: true });
  await page.screenshot({ path: job.out });
  console.log(`${job.out}  (${backend}, ${((Date.now() - t0) / 1000).toFixed(1)} s)${sceneFailed ? '  SCENE FAILED' : ''}${errors.length ? `  ${errors.length} errors` : ''}`);
  if (sceneFailed || errors.length) failed = true;
  await context.close();
}
// One contact sheet for several frames: reading it costs about as much as reading one frame.
const sheet = jobs.length > 1 && !flag('no-sheet');
if (sheet) {
  const cols = jobs.length <= 4 ? 2 : 3;
  const tileW = Math.floor(1600 / cols);
  const tiles = jobs
    .filter((j) => existsSync(j.out))
    .map((j) => `<figure><img src="data:image/png;base64,${readFileSync(j.out).toString('base64')}"><figcaption>${j.out.split('/').pop()}</figcaption></figure>`)
    .join('');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(
    `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:0}figure{margin:0;position:relative}img{width:${tileW}px;display:block}figcaption{position:absolute;left:6px;top:4px;font:12px monospace;color:#ff0;background:#000a;padding:1px 4px}</style>${tiles}`,
  );
  const out = join(dirname(jobs[0]!.out), `sheet-${target.replace(/[^\w-]/g, '_')}${flags.length ? '-' + flags.join('-') : ''}.png`);
  await pg.screenshot({ path: out, fullPage: true });
  await ctx.close();
  console.log(`sheet: ${out}  ← read this one image (${jobs.length} frames)`);
}
mkdirSync(dirname(LEDGER), { recursive: true });
appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), target, frames: jobs.length, sheet, flags } satisfies LedgerRow) + '\n');
await browser.close();
process.exit(failed ? 1 : 0);
