// Finale check (HANDOFF Verification): open the page at the catalogue, select events through the panel (search,
// quick picks, keyboard), and assert that the card's numbers match public/data/events.json, that the event's data
// clip plays on the transport (and the model chirp where there are masses), that candidates show no model, and that
// the page logs no errors. Overlay (model over Hanford's data): selecting an event with masses plays it by default;
// its clip starts with the data's (same t0, same length, sample for sample) and the model layer inside the mix,
// recovered independently, sits within 2 ms of the offset the page computed. Screenshots (desktop and phone) go to scratch/shots/finale/.
// Usage: node scripts/finale-check.ts [--base http://localhost:4390] [--webgl]
import { chromium, type Page } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { stageIndex, stageToProgress } from '../src/time/stages.ts';
import type { Catalog, CatalogEvent, Interval } from '../src/shared/gwdata.ts';
import { modelChirp } from '../src/finale/model.ts';
import { alignModel, MIX, processModel } from '../src/finale/overlay.ts';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1]! : 'http://localhost:4390';
const webgl = args.includes('--webgl');
const cat = JSON.parse(readFileSync('public/data/events.json', 'utf8')) as Catalog;
const byName = new Map(cat.events.map((e) => [e.name, e]));
const med = (v: Interval | null) => (v === null ? null : typeof v === 'number' ? v : v[0]);
const OUT = 'scratch/shots/finale';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ok ' : '  FAIL'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });

async function open(width: number, height: number): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource.*404/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${base}/?tier=medium&probe=0&audiolog=1${webgl ? '&webgl=1' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__driver && !!window.__engine', null, { timeout: 90000 });
  const p = stageToProgress(stageIndex('catalogue'), 0.6);
  await page.evaluate((pp) => (window as unknown as { __driver: { scrollToProgress(p: number, o: object): void } }).__driver.scrollToProgress(pp, { immediate: true }), p);
  await page.waitForFunction(() => document.documentElement.classList.contains('finale-on'), null, { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('[data-n="BBH"]')?.textContent, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  return { page, errors };
}

const frame = (page: Page) => page.evaluate(() => (window as unknown as { __transport: { frameOut: { clip: string | null; playing: boolean; t: number } } }).__transport.frameOut);

async function waitClip(page: Page, clip: string): Promise<boolean> {
  try {
    await page.waitForFunction((c) => {
      const f = (window as unknown as { __transport?: { frameOut: { clip: string | null; playing: boolean } } }).__transport?.frameOut;
      return !!f && f.clip === c && f.playing;
    }, clip, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function selectByName(page: Page, name: string) {
  await page.fill('[data-q]', name);
  await page.press('[data-q]', 'Enter');
  await page.waitForFunction((n) => document.querySelector('[data-name]')?.textContent === n, name, { timeout: 10000 });
}

async function facts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const dts = [...document.querySelectorAll('[data-facts] dt')];
    for (const dt of dts) out[dt.textContent ?? ''] = (dt.nextElementSibling as HTMLElement).textContent ?? '';
    return out;
  });
}

const firstNumber = (s: string | undefined) => (s ? Number(s.replace(/,/g, '').match(/-?[\d.]+/)?.[0]) : NaN);
interface OverlayDebug {
  name: string;
  det: string;
  offset: number;
  snr: number;
  network: number;
  fallback: boolean;
  t0: number;
  fs: number;
  tPeak: number;
  data: number[];
  model: number[];
  mix: number[];
  clips: Record<string, { t0: number; duration: number } | null>;
}

async function checkOverlay(page: Page, ev: CatalogEvent): Promise<OverlayDebug | null> {
  const o = (await page.evaluate((name) => {
    const w = window as unknown as { __finaleOverlay?: Record<string, unknown> & { name: string; det: string; data: Float32Array; model: Float32Array; mix: Float32Array }; __transport: { info(id: string): { t0: number; duration: number } | undefined } };
    const f = w.__finaleOverlay;
    if (!f || f.name !== name) return null;
    const info = (id: string) => {
      const i = w.__transport.info(id);
      return i ? { t0: i.t0, duration: i.duration } : null;
    };
    return {
      ...f,
      data: Array.from(f.data),
      model: Array.from(f.model),
      mix: Array.from(f.mix),
      clips: { overlay: info(`overlay:${name}`), model: info(`model:${name}`), data: info(`event:${name}:${f.det}`) },
    };
  }, ev.name)) as OverlayDebug | null;
  if (!o) {
    ok(false, `${ev.name}: overlay state exposed`);
    return null;
  }
  const { overlay, model, data } = o.clips;
  ok(!!overlay && !!data && !!model && overlay.t0 === data.t0 && model.t0 === data.t0 && Math.abs(overlay.duration - data.duration) < 1e-9 && Math.abs(model.duration - data.duration) < 1e-9, `${ev.name}: overlay, model and ${o.det} data clips start together (t0 ${data?.t0} s, ${data?.duration.toFixed(3)} s each)`);
  ok(o.mix.length === o.data.length && o.model.length === o.data.length, `${ev.name}: mix is sample for sample over the data (${o.mix.length} samples)`);
  // The model layer inside the mix (mix − limited data), aligned independently against a model rebuilt here.
  const c = MIX.dataCeil;
  const layer = Float32Array.from(o.mix, (v, i) => (v - c * Math.tanh((o.data[i]! * MIX.data) / c)) * 10);
  const p = processModel(modelChirp({ m1: med(ev.m1)!, m2: med(ev.m2)!, mFinal: med(ev.mFinal), redshift: med(ev.redshift), bns: ev.type === 'BNS' }), o.fs);
  const r = alignModel(layer, o.t0, p, [], o.offset, 0.03);
  const err = Math.abs(r.offset - o.offset) * 1000;
  ok(!r.fallback && err < 2, `${ev.name}: model's merger in the mix at ${(r.offset * 1000).toFixed(2)} ms, page offset ${(o.offset * 1000).toFixed(2)} ms (|Δ| ${err.toFixed(2)} ms); ${o.fallback ? 'catalogue time (no clear match)' : `matched SNR ${o.snr.toFixed(1)} in ${o.det}, network ${o.network.toFixed(1)}`}`);
  return o;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.005);

function checkCard(f: Record<string, string>, ev: CatalogEvent) {
  if (ev.m1 !== null) {
    ok(close(firstNumber(f['Heavier']), med(ev.m1)!), `${ev.name} heavier ${f['Heavier']} = ${med(ev.m1)}`);
    ok(close(firstNumber(f['Lighter']), med(ev.m2)!), `${ev.name} lighter ${f['Lighter']} = ${med(ev.m2)}`);
    if (ev.mFinal !== null) ok(close(firstNumber(f['Became']), med(ev.mFinal)!), `${ev.name} remnant ${f['Became']} = ${med(ev.mFinal)}`);
  } else ok(!('Heavier' in f), `${ev.name}: no masses shown (candidate)`);
  if (ev.distance !== null) ok(close(firstNumber(f['Distance']), med(ev.distance)!), `${ev.name} distance ${f['Distance']?.split('about')[0]} = ${med(ev.distance)}`);
  if (ev.snr !== null) ok(close(firstNumber(f['Signal-to-noise']), med(ev.snr)!), `${ev.name} SNR ${f['Signal-to-noise']} = ${med(ev.snr)}`);
}

// ── Desktop ──
{
  const { page, errors } = await open(1280, 800);
  const counts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-n]')].map((b) => [(b as HTMLElement).dataset.n!, Number(b.textContent)])));
  const n = (t: string | null) => cat.events.filter((e) => e.type === t).length;
  ok(counts.BBH === n('BBH') && counts.NSBH === n('NSBH') && counts.BNS === n('BNS') && counts.candidate === n(null), `filter counts ${JSON.stringify(counts)}`);
  ok(!(await page.evaluate(() => (document.querySelector('[data-finale]') as HTMLElement).inert)), 'panel live (not inert) at the catalogue');

  const cand = cat.events.find((e) => e.type === null && e.snippet)!;
  const heavy = cat.events.filter((e) => med(e.mTotal) !== null).reduce((a, b) => (med(b.mTotal)! > med(a.mTotal)! ? b : a));
  for (const name of ['GW150914', 'GW170817', heavy.name, 'GW190521', 'GW230529_181500', cand.name]) {
    const ev = byName.get(name)!;
    await selectByName(page, name);
    await page.waitForTimeout(400);
    checkCard(await facts(page), ev);
    const det = ['H1', 'L1', 'V1', 'K1', 'G1'].find((d) => ev.snippet?.detectors.includes(d));
    const modelHidden = (await page.evaluate(() => (document.querySelector("[data-play-model]") as HTMLElement).hidden)) as boolean;
    if (ev.m1 !== null && det) {
      ok(await waitClip(page, `overlay:${name}`), `${name}: model over the data plays by default`);
      const chip = await page.evaluate(() => document.querySelector('[data-acc-chip]')?.getAttribute('data-st'));
      ok(chip === 'modelled', `${name}: status chip says modelled while the overlay plays (${chip})`);
      ok(/modelled/i.test((await page.textContent('[data-play-overlay]')) ?? ''), `${name}: overlay button labelled modelled`);
      await checkOverlay(page, ev);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/finale-desktop-overlay-${name}.png` });
      await page.click(`[data-det="${det}"]`);
      ok(await waitClip(page, `event:${name}:${det}`), `${name}: ${det} data alone plays`);
    } else if (det) ok(await waitClip(page, `event:${name}:${det}`), `${name}: ${det} data plays on the transport`);
    if (ev.m1 !== null) {
      ok(!modelHidden, `${name}: model chirp offered`);
      await page.click('[data-play-model]');
      ok(await waitClip(page, `model:${name}`), `${name}: model alone plays`);
      const chip = await page.evaluate(() => document.querySelector('[data-acc-chip]')?.getAttribute('data-st'));
      ok(chip === 'modelled', `${name}: status chip says modelled while the model plays (${chip})`);
    } else ok(modelHidden, `${name}: no model chirp for a candidate`);
  }
  // Quick pick and keyboard stepping.
  await page.click('[data-pick="loudest"]');
  const loud = cat.events.filter((e) => med(e.snr) !== null).reduce((a, b) => (med(b.snr)! > med(a.snr)! ? b : a));
  await page.waitForFunction((n) => document.querySelector('[data-name]')?.textContent === n, loud.name, { timeout: 10000 });
  ok(true, `"The loudest" → ${loud.name} (SNR ${med(loud.snr)})`);
  checkCard(await facts(page), loud);
  ok(await waitClip(page, `overlay:${loud.name}`), `${loud.name}: model over Hanford data plays`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/finale-desktop-loudest.png` });
  const i = cat.events.findIndex((e) => e.name === loud.name);
  await page.focus('[data-layer]');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((n) => document.querySelector('[data-name]')?.textContent === n, cat.events[i + 1]!.name, { timeout: 10000 }).then(
    () => ok(true, `ArrowRight → ${cat.events[i + 1]!.name}`),
    () => ok(false, 'ArrowRight steps to the next event'),
  );
  // Filters: turning BBH off and stepping skips them.
  await page.click('[data-filter="BBH"]');
  await page.click('[data-next]');
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => document.querySelector('[data-kind]')?.textContent ?? '');
  ok(!/Two black holes/.test(t), `with black-hole pairs filtered out, Next lands on: ${t}`);
  await page.click('[data-filter="BBH"]');
  await page.click('[data-view="distance"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/finale-desktop-distance.png` });
  const f = await frame(page);
  ok(typeof f.t === 'number', `transport frame readable (clip ${f.clip})`);
  ok(!(await page.evaluate('window.__sceneFailed === true')), 'scene did not fail');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.context().close();
}

// ── Phone ──
{
  const { page, errors } = await open(390, 844);
  await page.click('[data-pick="first"]');
  await page.waitForFunction(() => document.querySelector('[data-name]')?.textContent === 'GW150914', null, { timeout: 10000 });
  checkCard(await facts(page), byName.get('GW150914')!);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/finale-phone.png` });
  const fits = await page.evaluate(() => {
    const r = document.querySelector('[data-scroller]')!.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
  });
  ok(fits, 'phone: panel inside the viewport, no horizontal scroll');
  ok(errors.length === 0, `phone: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.context().close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nfinale check passed');
process.exit(failures ? 1 : 0);
