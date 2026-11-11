"""The finale's catalogue: every event in GWOSC's cumulative confident catalogue ("GWTC", latest version of each event:
GWTC-1 … GWTC-5.0 as published) → public/data/events.json, plus a short whitened chirp snippet per event and detector
(public/data/events/<name>.bin, lazily fetched by the page).

Strain: for O1–O3 events, GWOSC's per-event 32 s / 4096 Hz HDF5 files; for O4 events (only 4096 s bulk files are
published), the same 32 s read out of the bulk HDF5 with HTTP range requests (rangefile.py), so a few MB per detector
are downloaded instead of ~100 MB. Everything is cached under scripts/cache/catalog.

Snippet processing per detector (as for GW150914): Welch PSD (4 s Hann, median) over the 32 s, whitening, zero-phase
Butterworth band-pass 30–350 Hz, divided by the noise σ measured away from the event, decimated to 2048 Hz, int16.

Run: scripts/.venv/bin/python -I scripts/fetch-catalog.py [--limit N] [--jobs 6]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
import h5py  # noqa: E402
from gwlib import CACHE, PUBLIC, UA, bandpass, dump_json, fetch, fetch_json, psd, read_strain, whiten  # noqa: E402
from rangefile import RangeFile  # noqa: E402

C = CACHE / 'catalog'
OUT = PUBLIC / 'events'
CATALOG_URL = 'https://gwosc.org/eventapi/json/GWTC/'
FS = 4096
OUT_FS = 2048
SPAN = 32.0  # seconds of strain per detector (PSD + whitening)
BAND = (30.0, 350.0)
WIN_BBH = (-1.75, 0.25)  # snippet window around the catalogue GPS time, seconds
WIN_NS = (-3.5, 0.5)  # BNS / NSBH: their chirps are longer in band
NS_MAX = 3.0  # M_sun: a component lighter than this is counted as a neutron star

# GPS − UTC (leap seconds) for the observing runs: 17 s from 2015-07-01, 18 s from 2017-01-01 (none since).
GPS_EPOCH = dt.datetime(1980, 1, 6, tzinfo=dt.UTC)


def gps_to_utc(gps: float) -> str:
    leap = 18 if gps >= 1167264018 else 17
    t = GPS_EPOCH + dt.timedelta(seconds=gps - leap)
    return t.strftime('%Y-%m-%dT%H:%M:%S.') + f'{t.microsecond // 100000}Z'


def val(e: dict, k: str):
    v = e.get(k)
    if v is None:
        return None
    lo, hi = e.get(k + '_lower'), e.get(k + '_upper')
    if lo is None and hi is None:
        return v
    return [v, round(v + (lo or 0), 4), round(v + (hi or 0), 4)]  # [median, lower bound, upper bound] (90% credible)


def classify(m1, m2) -> tuple[str | None, bool]:
    """BBH / NSBH / BNS by the median component masses against 3 M_sun; `ambiguous` when a 90% interval crosses it."""
    if m1 is None or m2 is None:
        return None, False
    ns = [m[0] < NS_MAX for m in (m1, m2)]
    t = 'BNS' if all(ns) else 'NSBH' if any(ns) else 'BBH'
    amb = any(m[1] < NS_MAX <= m[2] for m in (m1, m2))
    return t, amb


def strain_window(name: str, d: str, entries: list[dict], gps: float) -> np.ndarray | None:
    """SPAN seconds of 4096 Hz strain centred on gps, from the per-event 32 s file or the 4096 s bulk file."""
    hdf = [s for s in entries if s['detector'] == d and s['format'] == 'hdf5' and int(s['sampling_rate']) == FS]
    short = [s for s in hdf if int(s['duration']) == 32]
    if short:
        s = short[0]
        path = fetch(s['url'], C / name / Path(s['url']).name)
        x, t0, fs = read_strain(path)
    else:
        bulk = [s for s in hdf if s['GPSstart'] <= gps - SPAN / 2 and s['GPSstart'] + s['duration'] >= gps + SPAN / 2]
        if not bulk:
            return None
        s = bulk[0]
        rf = RangeFile(s['url'], C / 'ranges', UA)
        with h5py.File(rf, 'r') as f:
            ds = f['strain/Strain']
            t0 = float(ds.attrs['Xstart'])
            i = int(round((gps - SPAN / 2 - t0) * FS))
            x = ds[i : i + int(SPAN * FS)].astype(np.float64)
            t0 = t0 + i / FS
            fs = FS
    assert fs == FS
    i0 = int(round((gps - SPAN / 2 - t0) * FS))
    x = x[max(0, i0) : max(0, i0) + int(SPAN * FS)]
    if len(x) < int(SPAN * FS * 0.9):
        return None
    return x


def snippet(x: np.ndarray, gps_in_x: float, win: tuple[float, float]) -> tuple[np.ndarray, float] | None:
    """Whitened, band-passed, σ-normalised, decimated snippet; None if the data has gaps (NaN) near the event."""
    if not np.isfinite(x).all():
        good = np.isfinite(x)
        # Use the largest finite stretch if it still covers the snippet with margin.
        i_ev = int(gps_in_x * FS)
        lo = i_ev
        while lo > 0 and good[lo - 1]:
            lo -= 1
        hi = i_ev
        while hi < len(x) and good[hi]:
            hi += 1
        if hi - lo < 12 * FS or i_ev - lo < 4 * FS or hi - i_ev < 2 * FS:
            return None
        x = x[lo:hi]
        gps_in_x -= lo / FS
    fp, pp = psd(x, FS, seg=min(4.0, len(x) / FS / 4))
    w = bandpass(whiten(x, FS, fp, pp), FS, *BAND)
    i_ev = int(round(gps_in_x * FS))
    # Noise σ away from the event (the whole span minus ±3 s around it and the tapered edges).
    m = np.ones(len(w), bool)
    m[: int(2 * FS)] = False
    m[-int(2 * FS) :] = False
    m[max(0, i_ev - 3 * FS) : i_ev + 3 * FS] = False
    sd = float(np.std(w[m])) if m.sum() > FS else float(np.std(w))
    a, b = i_ev + int(round(win[0] * FS)), i_ev + int(round(win[1] * FS))
    if a < 0 or b > len(w):
        return None
    y = signal.resample_poly(w[a - 64 : b + 64] / sd, 1, FS // OUT_FS)[32:-32]
    return y.astype(np.float64), sd


def process(e: dict) -> dict:
    name = e['commonName']
    ev = fetch_json(e['jsonurl'].rstrip('/') + '/', C / name / 'event.json')
    full = next(iter(ev['events'].values()))
    entries = full.get('strain', [])
    dets = sorted({s['detector'] for s in entries})
    m1, m2 = val(e, 'mass_1_source'), val(e, 'mass_2_source')
    typ, amb = classify(m1, m2)
    win = WIN_BBH if typ in (None, 'BBH') else WIN_NS
    gps = float(e['GPS'])
    snips = {}
    for d in dets:
        try:
            x = strain_window(name, d, entries, gps)
        except Exception as err:  # noqa: BLE001
            print(f'  {name} {d}: {err}', file=sys.stderr)
            x = None
        if x is None:
            continue
        r = snippet(x, SPAN / 2, win)
        if r is not None:
            snips[d] = r[0]
    rec = {
        'name': name,
        'version': e['version'],
        'catalog': e['catalog.shortName'],
        'gps': gps,
        'utc': gps_to_utc(gps),
        'type': typ,
        'typeAmbiguous': amb,
        'm1': m1,
        'm2': m2,
        'mTotal': val(e, 'total_mass_source'),
        'mChirp': val(e, 'chirp_mass_source'),
        'mFinal': val(e, 'final_mass_source'),
        'distance': val(e, 'luminosity_distance'),
        'redshift': val(e, 'redshift'),
        'chiEff': val(e, 'chi_eff'),
        'snr': val(e, 'network_matched_filter_snr'),
        'far': e.get('far'),
        'pAstro': e.get('p_astro'),
        'detectors': dets,
        'url': f"https://gwosc.org/eventapi/html/{e['catalog.shortName']}/{name}/v{e['version']}/",
    }
    if snips:
        order = [d for d in dets if d in snips]
        parts, scales = [], []
        for d in order:
            y = snips[d]
            s = float(np.max(np.abs(y)))
            scales.append(round(s, 4))
            parts.append(np.clip(np.round(y / s * 32767), -32767, 32767).astype('<i2'))
        blob = np.concatenate(parts).tobytes()
        safe = re.sub(r'[^A-Za-z0-9_]', '_', name)
        (OUT / f'{safe}.bin').write_bytes(blob)
        rec['snippet'] = {
            'url': f'/data/events/{safe}.bin',
            'detectors': order,
            'scale': scales,
            'fs': OUT_FS,
            'n': len(parts[0]),
            't0': win[0],
            'bytes': len(blob),
        }
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--jobs', type=int, default=10)
    args = ap.parse_args()
    cat = fetch_json(CATALOG_URL, C / 'GWTC.json')['events']
    events = sorted(cat.values(), key=lambda e: e['GPS'])
    if args.limit:
        events = events[: args.limit]
    OUT.mkdir(parents=True, exist_ok=True)
    recs = []
    # Processes, not threads: h5py serialises every call behind one lock, and the range reads happen inside them.
    with ProcessPoolExecutor(args.jobs) as pool:
        futs = {pool.submit(process, e): e['commonName'] for e in events}
        for i, f in enumerate(as_completed(futs)):
            try:
                recs.append(f.result())
            except Exception as err:  # noqa: BLE001
                print(f'FAILED {futs[f]}: {err}', file=sys.stderr)
            if (i + 1) % 20 == 0:
                print(f'{i + 1}/{len(events)}', flush=True)
    recs.sort(key=lambda r: r['gps'])
    doc = {
        'credit': 'LIGO Scientific Collaboration, Virgo Collaboration and KAGRA; Gravitational Wave Open Science Center (gwosc.org), CC BY 4.0',
        'source': CATALOG_URL,
        'generated': dt.date.today().isoformat(),
        'notes': {
            'intervals': '[median, lower, upper]: 90% credible interval bounds as published (source-frame masses, M_sun; distance in Mpc)',
            'type': f'by median component masses: a component under {NS_MAX} M_sun counts as a neutron star; typeAmbiguous when an interval crosses it; null when no masses are published',
            'snippet': f'int16 per detector, concatenated in snippet.detectors order; value (noise σ) = int16 × scale / 32767; whitened, band-passed {BAND[0]:.0f}–{BAND[1]:.0f} Hz, {OUT_FS} Hz; t0 = seconds from the catalogue GPS time',
        },
        'events': recs,
    }
    n = dump_json(PUBLIC / 'events.json', doc)
    tot = sum(r.get('snippet', {}).get('bytes', 0) for r in recs)
    print(f'events: {len(recs)} ({sum(1 for r in recs if "snippet" in r)} with snippets)')
    print(f'events.json {n / 1024:.0f} KB; snippets {tot / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
