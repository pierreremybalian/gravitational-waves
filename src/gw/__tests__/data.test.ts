import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import gw from '../../data/gw150914.json';
import type { Catalog } from '../../shared/gwdata.ts';
import { f32, json } from './data.ts';

const PUB = fileURLToPath(new URL('../../../public/', import.meta.url));

describe('GW150914 data', () => {
  it('every windowed series has the window length', () => {
    for (const name of Object.keys(gw.series)) expect(f32(`gw150914/${name}.f32`).length, name).toBe(gw.window.n);
    expect(f32('gw150914/asd-H1.f32').length).toBe(gw.asd.n);
    expect(f32('gw150914/nr-H1.f32').length).toBe(gw.nr.n);
  });
  it('matched-filter SNR peaks near 24 at the merger', () => {
    expect(gw.snr.network).toBeGreaterThan(22);
    expect(gw.snr.network).toBeLessThan(26);
    const s = f32('gw150914/snr-net.f32');
    let k = 0;
    for (let i = 1; i < s.length; i++) if (s[i]! > s[k]!) k = i;
    expect(Math.abs(gw.window.t0 + k / gw.window.fs)).toBeLessThan(0.005);
  });
  it('the whitened data correlates with the published reconstruction', () => {
    expect(gw.validation['whitened H1 data vs PRL fig1 NR waveform H1']).toBeGreaterThan(0.75);
    expect(gw.validation['whitened H1 vs PRL fig1 observed H1']).toBeGreaterThan(0.9);
  });
  it('clips exist and are 16-bit WAVs of the stated length', () => {
    for (const c of Object.values(gw.clips)) {
      const p = PUB + c.url.slice(1);
      expect(existsSync(p), c.url).toBe(true);
      expect(statSync(p).size).toBe(44 + Math.round(c.duration * 16384) * 2);
    }
  });
});

describe('catalogue', () => {
  const cat = json<Catalog>('public/data/events.json');
  it('lists the confirmed events with parameters and intervals', () => {
    expect(cat.events.length).toBeGreaterThan(90);
    const names = new Set(cat.events.map((e) => e.name));
    for (const n of ['GW150914', 'GW170817', 'GW190521']) expect(names.has(n), n).toBe(true);
    const e = cat.events.find((x) => x.name === 'GW150914')!;
    expect(e.type).toBe('BBH');
    expect(e.detectors).toEqual(['H1', 'L1']);
    expect(Array.isArray(e.m1) && e.m1[1] < e.m1[0] && e.m1[0] < e.m1[2]).toBe(true);
    expect(cat.events.find((x) => x.name === 'GW170817')!.type).toBe('BNS');
    for (let i = 1; i < cat.events.length; i++) expect(cat.events[i]!.gps).toBeGreaterThan(cat.events[i - 1]!.gps);
  });
  it('snippets exist with the declared size, within the size budget', () => {
    let total = 0;
    for (const e of cat.events) {
      if (!e.snippet) continue;
      const p = PUB + e.snippet.url.slice(1);
      expect(statSync(p).size, e.name).toBe(e.snippet.detectors.length * e.snippet.n * 2);
      total += e.snippet.bytes;
    }
    expect(total).toBeLessThan(15e6);
  });
});
