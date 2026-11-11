// Numbers the detector stages quote, derived from the GW150914 series (pure). scripts/detector-stats.ts writes them to
// src/data/detector-stats.json so the stage scripts (pure, no fetch) can show them; a test recomputes them from
// public/data and checks the file is current.

export interface SeriesSet {
  'raw-H1': ArrayLike<number>;
  'raw-L1': ArrayLike<number>;
  'template-strain-H1': ArrayLike<number>;
  'white-H1': ArrayLike<number>;
  'snr-net': ArrayLike<number>;
  'snr-H1': ArrayLike<number>;
  'snr-L1': ArrayLike<number>;
  'asd-H1': ArrayLike<number>;
}

export interface DetectorStats {
  /** Raw strain, whole window: rms and largest excursion. */
  rawRmsH1: number;
  rawRmsL1: number;
  rawPeakH1: number;
  /** Best-fit template's largest strain at H1. */
  signalPeak: number;
  /** How many times larger the raw wobble is than the signal (rms ÷ signal peak; peak ÷ signal peak). */
  rawOverSignalRms: number;
  rawOverSignalPeak: number;
  asd: {
    /** Quietest band between 20 and 1000 Hz (median over ±6 %), and band medians at 15, 100, 1000 Hz. */
    minValue: number;
    minFreq: number;
    at15: number;
    at100: number;
    at1000: number;
    /** Mains line near 60 Hz: peak and its frequency. */
    mainsValue: number;
    mainsFreq: number;
    /** Strongest line between 490 and 520 Hz (the suspension fibres' violin modes). */
    violinValue: number;
    violinFreq: number;
  };
  snr: { net: number; netT: number; h1: number; l1: number };
  whitePeakH1: number;
}

const round = (v: number, d = 4) => Number(v.toPrecision(d));

function rms(a: ArrayLike<number>) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / a.length);
}
function peak(a: ArrayLike<number>) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

export function detectorStats(s: SeriesSet, w: { t0: number; fs: number }, asd: { f0: number; df: number }): DetectorStats {
  const A = s['asd-H1'];
  const f = (i: number) => asd.f0 + i * asd.df;
  const idx = (fr: number) => Math.round((fr - asd.f0) / asd.df);
  const maxIn = (lo: number, hi: number) => {
    let k = idx(lo);
    for (let i = idx(lo); i <= idx(hi); i++) if (A[i]! > A[k]!) k = i;
    return k;
  };
  // Quietest band: the median over ±6 % around each frequency (single 0.25 Hz bins scatter by a factor of 2).
  const band = (fc: number) => {
    const v: number[] = [];
    for (let i = idx(fc / 1.06); i <= idx(fc * 1.06); i++) v.push(A[i]!);
    v.sort((a, b) => a - b);
    return v[v.length >> 1]!;
  };
  let minFreq = 20;
  let minValue = Infinity;
  for (let fc = 20; fc <= 1000; fc *= 1.02) {
    const m = band(fc);
    if (m < minValue) {
      minValue = m;
      minFreq = fc;
    }
  }
  const kMains = maxIn(59, 61);
  const kViolin = maxIn(490, 520);
  const sig = peak(s['template-strain-H1']) * 1e-21;
  const net = s['snr-net'];
  let kNet = 0;
  for (let i = 1; i < net.length; i++) if (net[i]! > net[kNet]!) kNet = i;
  return {
    rawRmsH1: round(rms(s['raw-H1'])),
    rawRmsL1: round(rms(s['raw-L1'])),
    rawPeakH1: round(peak(s['raw-H1'])),
    signalPeak: round(sig),
    rawOverSignalRms: round(rms(s['raw-H1']) / sig, 3),
    rawOverSignalPeak: round(peak(s['raw-H1']) / sig, 3),
    asd: {
      minValue: round(minValue),
      minFreq: round(minFreq, 3),
      at15: round(band(15)),
      at100: round(band(100)),
      at1000: round(band(1000)),
      mainsValue: round(A[kMains]!),
      mainsFreq: round(f(kMains)),
      violinValue: round(A[kViolin]!),
      violinFreq: round(f(kViolin)),
    },
    snr: { net: round(net[kNet]!), netT: round(w.t0 + kNet / w.fs, 3), h1: round(peak(s['snr-H1'])), l1: round(peak(s['snr-L1'])) },
    whitePeakH1: round(peak(s['white-H1']), 3),
  };
}

export interface CatalogueSummary {
  total: number;
  BBH: number;
  NSBH: number;
  BNS: number;
  candidates: number;
  first: string;
  last: string;
}

/** Counts by type (null = candidate without published parameters) and the date span. */
export function catalogueSummary(events: readonly { type: string | null; utc: string }[]): CatalogueSummary {
  const n = (t: string | null) => events.filter((e) => e.type === t).length;
  const dates = events.map((e) => e.utc).sort();
  return { total: events.length, BBH: n('BBH'), NSBH: n('NSBH'), BNS: n('BNS'), candidates: n(null), first: dates[0]!.slice(0, 10), last: dates[dates.length - 1]!.slice(0, 10) };
}
