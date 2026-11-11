// Writes src/data/detector-stats.json: the numbers stages 8–11 quote, derived from public/data/gw150914 (see
// src/shared/detector/stats.ts). Run after scripts/fetch-gwosc.py: node scripts/detector-stats.ts
import { readFileSync, writeFileSync } from 'node:fs';
import gw from '../src/data/gw150914.json' with { type: 'json' };
import { catalogueSummary, detectorStats, type SeriesSet } from '../src/shared/detector/stats.ts';

const f32 = (name: string) => {
  const b = readFileSync(`public/data/gw150914/${name}.f32`);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const names = ['raw-H1', 'raw-L1', 'template-strain-H1', 'white-H1', 'snr-net', 'snr-H1', 'snr-L1', 'asd-H1'] as const;
const s = Object.fromEntries(names.map((n) => [n, f32(n)])) as unknown as SeriesSet;
const out = detectorStats(s, gw.window, gw.asd);
writeFileSync('src/data/detector-stats.json', JSON.stringify(out, null, 2) + '\n');
console.log(out);

// The two catalogue entries stage 12 quotes (events.json is too big to import into the page's scripts).
const cat = JSON.parse(readFileSync('public/data/events.json', 'utf8')) as { events: { name: string; type: string | null; utc: string }[] };
const pick = (n: string) => cat.events.find((e) => e.name === n);
writeFileSync('src/data/results.json', JSON.stringify({ GW150914: pick('GW150914'), GW170817: pick('GW170817'), summary: catalogueSummary(cat.events) }, null, 2) + '\n');
