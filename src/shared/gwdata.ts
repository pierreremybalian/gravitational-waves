// Loaders for the generated data (scripts/fetch-gwosc.py, scripts/fetch-catalog.py; GWOSC, CC BY 4.0). Every series
// is fetched once and cached; scenes call these in init(), never per frame.
//
// GW150914 series (public/data/gw150914/<name>.f32, little-endian Float32) share one time axis:
//   t(i) = GW150914.window.t0 + i / GW150914.window.fs   (seconds; 0 = the H1 merger)
// except asd-* (frequency axis: GW150914.asd.f0 + i · df) and nr-H1 (GW150914.nr.t0 + i / nr.fs).

import gw from '../data/gw150914.json';

export const GW150914 = gw;

export type SeriesName =
  | keyof typeof gw.series
  | 'asd-H1'
  | 'asd-L1'
  | 'nr-H1';

const cache = new Map<string, Promise<Float32Array>>();

export function loadSeries(name: SeriesName): Promise<Float32Array> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`/data/gw150914/${name}.f32`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${name}`);
        return r.arrayBuffer();
      })
      .then((b) => new Float32Array(b));
    cache.set(name, p);
    p.catch(() => cache.delete(name));
  }
  return p;
}

/** Data time (s from the merger) of sample i of a windowed series. */
export const seriesTime = (i: number): number => gw.window.t0 + i / gw.window.fs;
/** Sample index (fractional) of data time t in a windowed series. */
export const seriesIndex = (t: number): number => (t - gw.window.t0) * gw.window.fs;

// ── Catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────

/** [median, lower, upper] of a 90% credible interval, or a bare value where no interval is published. */
export type Interval = number | [number, number, number];

export interface CatalogEvent {
  name: string;
  version: number;
  catalog: string;
  gps: number;
  utc: string;
  type: 'BBH' | 'BNS' | 'NSBH' | null;
  typeAmbiguous: boolean;
  m1: Interval | null;
  m2: Interval | null;
  mTotal: Interval | null;
  mChirp: Interval | null;
  mFinal: Interval | null;
  /** Luminosity distance, Mpc. */
  distance: Interval | null;
  redshift: Interval | null;
  chiEff: Interval | null;
  snr: Interval | null;
  far: number | null;
  pAstro: number | null;
  detectors: string[];
  url: string;
  snippet?: { url: string; detectors: string[]; scale: number[]; fs: number; n: number; t0: number; bytes: number };
}

export interface Catalog {
  credit: string;
  source: string;
  generated: string;
  notes: Record<string, string>;
  events: CatalogEvent[];
}

export const median = (v: Interval | null): number | null => (v === null ? null : typeof v === 'number' ? v : v[0]);

let catalog: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  catalog ??= fetch('/data/events.json').then((r) => {
    if (!r.ok) throw new Error(`${r.status} events.json`);
    return r.json() as Promise<Catalog>;
  });
  return catalog;
}

const snippets = new Map<string, Promise<Record<string, Float32Array>>>();

/** An event's whitened snippets per detector, in units of the noise σ (fs = snippet.fs, t0 = snippet.t0). */
export function loadSnippet(ev: CatalogEvent): Promise<Record<string, Float32Array>> {
  const s = ev.snippet;
  if (!s) return Promise.resolve({});
  let p = snippets.get(ev.name);
  if (!p) {
    p = fetch(s.url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${s.url}`);
        return r.arrayBuffer();
      })
      .then((b) => {
        const all = new Int16Array(b);
        const out: Record<string, Float32Array> = {};
        s.detectors.forEach((d, k) => {
          const q = all.subarray(k * s.n, (k + 1) * s.n);
          const f = new Float32Array(s.n);
          const sc = s.scale[k]! / 32767;
          for (let i = 0; i < s.n; i++) f[i] = q[i]! * sc;
          out[d] = f;
        });
        return out;
      });
    snippets.set(ev.name, p);
    p.catch(() => snippets.delete(ev.name));
  }
  return p;
}

/** Clip id for an event's snippet on the transport. */
export const eventClipId = (name: string, det: string): string => `event:${name}:${det}`;
