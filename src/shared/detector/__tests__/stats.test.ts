import { describe, expect, it } from 'vitest';
import gw from '../../../data/gw150914.json';
import stats from '../../../data/detector-stats.json';
import { f32 } from '../../../gw/__tests__/data.ts';
import { detectorStats, type SeriesSet } from '../stats.ts';
import { lightTravel, DETECTORS } from '../../../gw/units.ts';

describe('detector stats', () => {
  const names = ['raw-H1', 'raw-L1', 'template-strain-H1', 'white-H1', 'snr-net', 'snr-H1', 'snr-L1', 'asd-H1'] as const;
  const s = Object.fromEntries(names.map((n) => [n, f32(`gw150914/${n}.f32`)])) as unknown as SeriesSet;
  it('src/data/detector-stats.json is current (node scripts/detector-stats.ts)', () => {
    expect(detectorStats(s, gw.window, gw.asd)).toEqual(stats);
  });
  it('quotes agree with the published analysis', () => {
    expect(stats.snr.net).toBeCloseTo(gw.snr.network, 2);
    expect(Math.abs(stats.snr.netT)).toBeLessThan(0.001);
    // The raw strain wobbles hundreds of times more than the signal (dominated by low-frequency motion).
    expect(stats.rawOverSignalRms).toBeGreaterThan(100);
    // Most sensitive band is in the low hundreds of Hz, at a few 10⁻²⁴ /√Hz.
    expect(stats.asd.minFreq).toBeGreaterThan(80);
    expect(stats.asd.minFreq).toBeLessThan(400);
    expect(stats.asd.minValue).toBeLessThan(2e-23);
    expect(stats.asd.mainsFreq).toBeCloseTo(60, 0);
  });
  it('the H1–L1 delay sits inside the light-travel limit', () => {
    const lim = lightTravel(DETECTORS.H1, DETECTORS.L1);
    expect(Math.abs(gw.offset.dtL1)).toBeLessThan(lim);
    // cos θ of the arrival ring ≈ 0.71 (θ ≈ 45°).
    expect(Math.abs(gw.offset.dtL1) / lim).toBeGreaterThan(0.65);
    expect(Math.abs(gw.offset.dtL1) / lim).toBeLessThan(0.75);
  });
});

describe('stage 12 extract', () => {
  it('src/data/results.json matches events.json', async () => {
    const { json } = await import('../../../gw/__tests__/data.ts');
    const results = (await import('../../../data/results.json')).default as Record<string, unknown>;
    const cat = json<{ events: { name: string }[] }>('public/data/events.json');
    for (const n of ['GW150914', 'GW170817']) expect(results[n]).toEqual(cat.events.find((e) => e.name === n));
    const { catalogueSummary } = await import('../stats.ts');
    expect(results.summary).toEqual(catalogueSummary(cat.events as never));
  });
});
