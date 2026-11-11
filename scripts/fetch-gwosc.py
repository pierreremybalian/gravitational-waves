"""GW150914 data for the story (stages 1, 5, 7, 9, 10, 11).

Downloads (cached in scripts/cache/gw150914) from GWOSC (https://gwosc.org, CC BY 4.0):
  - 32 s of H1 and L1 strain at 4096 Hz (GWTC-1-confident GW150914 v3 release, R1),
  - the best-fit template GWOSC publishes with its GW150914 tutorial (GW150914_4_template.hdf5, SEOBNRv2,
    detector-frame m1 = 41.7, m2 = 29.2 M_sun),
  - the numerical-relativity waveform at Hanford (GW150914_4_NR_waveform.txt),
  - the PRL 116, 061102 Figure 1/2 data (fig1-observed-H/L, fig1-waveform-H/L, fig2-unfiltered-waveform-H).
Writes public/data/gw150914/*.f32 (little-endian Float32) + meta.json + chirp WAVs, and prints the validation numbers.

Time origin everywhere: t = 0 at the H1 merger time, defined as the time of the best-fit template's peak amplitude
found by the matched filter in H1 (GPS in meta.json, `gpsMerger`).

Run: scripts/.venv/bin/python -I scripts/fetch-gwosc.py
"""

from __future__ import annotations

import json
import sys

import numpy as np
from scipy import signal
from scipy.interpolate import interp1d

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from gwlib import (  # noqa: E402
    CACHE,
    PUBLIC,
    ROOT,
    bandpass,
    dump_json,
    fade,
    fetch,
    notch,
    pitch_scale,
    psd,
    read_strain,
    whiten,
    write_f32,
    write_wav,
)
import h5py  # noqa: E402

EV = 'https://gwosc.org/eventapi/json/GWTC-1-confident/GW150914/v3/'
S = 'https://gwosc.org/s/events/GW150914/'
C = CACHE / 'gw150914'
OUT = PUBLIC / 'gw150914'
FS = 4096
DETS = ['H1', 'L1']
WIN = (-2.0, 1.0)  # seconds around the merger exported for pictures
AUDIO = (-1.5, 0.5)  # seconds around the merger in the chirp clips
AUDIO_FS = 16384
PITCH = 4  # ×4 = two octaves up, same duration
# Strong instrumental lines near 35–350 Hz (calibration lines, power mains 60/120/180 Hz), found in each detector's
# band-passed spectrum: notched for the PRL-style band-passed series, as PRL Fig. 1 does.
PRL_NOTCH = {'H1': [35.9, 36.7, 40.95, 60.0, 120.0, 180.0, 331.9], 'L1': [34.7, 35.3, 60.0, 120.0, 180.0, 331.3]}

sizes: dict[str, int] = {}


def put_f32(name: str, arr: np.ndarray) -> None:
    sizes[name] = write_f32(OUT / name, arr)


def parabolic(y: np.ndarray, i: int) -> float:
    """Sub-sample peak position around index i."""
    if i <= 0 or i >= len(y) - 1:
        return float(i)
    a, b, c = y[i - 1], y[i], y[i + 1]
    d = a - 2 * b + c
    return i + (0.5 * (a - c) / d if d != 0 else 0.0)


def main() -> None:
    files = {
        'H1': fetch(EV + 'H-H1_GWOSC_4KHZ_R1-1126259447-32.hdf5', C / 'H-H1_GWOSC_4KHZ_R1-1126259447-32.hdf5'),
        'L1': fetch(EV + 'L-L1_GWOSC_4KHZ_R1-1126259447-32.hdf5', C / 'L-L1_GWOSC_4KHZ_R1-1126259447-32.hdf5'),
    }
    f_tmpl = fetch(S + 'GW150914_4_template.hdf5', C / 'GW150914_4_template.hdf5')
    f_nr = fetch(S + 'GW150914_4_NR_waveform.txt', C / 'GW150914_4_NR_waveform.txt')
    prl = {}
    for k in ['fig1-observed-H', 'fig1-observed-L', 'fig1-waveform-H', 'fig1-waveform-L', 'fig2-unfiltered-waveform-H']:
        prl[k] = np.loadtxt(fetch(S + f'P150914/{k}.txt', C / f'{k}.txt'))

    strain, gps0 = {}, None
    for d in DETS:
        x, t0, fs = read_strain(files[d])
        assert fs == FS and np.isfinite(x).all()
        strain[d] = x
        gps0 = t0
    n = len(strain['H1'])
    t_file = np.arange(n) / FS  # seconds from gps0

    with h5py.File(f_tmpl, 'r') as f:
        hp, hc = f['template'][...].astype(np.float64)
        tmeta = {k: (v.item() if hasattr(v, 'item') else v) for k, v in f['meta'].attrs.items()}
        tmeta = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in tmeta.items()}
    assert len(hp) == n
    h = hp + 1j * hc
    ip = int(np.argmax(np.abs(h)))  # template peak sample

    # PSD, whitening, band-pass, matched filter per detector.
    win = signal.windows.tukey(n, 1 / 8)
    freqs_full = np.fft.fftfreq(n, 1 / FS)
    df = FS / n
    res = {}
    for d in DETS:
        x = strain[d]
        fp, pp = psd(x, FS)
        Sx = interp1d(fp, pp, bounds_error=False, fill_value=(pp[0], pp[-1]))(np.abs(freqs_full))
        D = np.fft.fft(x * win) / FS
        H = np.fft.fft(h * win) / FS
        band = (np.abs(freqs_full) >= 20) & (np.abs(freqs_full) <= 1800)
        Sx_b = np.where(band, Sx, np.inf)
        z = 2 * np.fft.ifft(D * H.conj() / Sx_b) * FS
        sigma = np.sqrt(np.abs(np.sum(H * H.conj() / Sx_b) * df))
        z = np.roll(z, ip) / sigma  # index k ↔ template peak at sample k
        snr = np.abs(z)
        # Search only well inside the file (Tukey edges) for the peak.
        lo, hi = int(4 * FS), n - int(4 * FS)
        k = lo + int(np.argmax(snr[lo:hi]))
        kf = parabolic(snr, k)
        white = whiten(x, FS, fp, pp)
        wbp = bandpass(white, FS)
        noise_sd = float(np.std(wbp[int(2 * FS) : int(12 * FS)]))  # 2–12 s into the file: noise only
        prl_bp = notch(bandpass(x, FS), FS, PRL_NOTCH[d])
        res[d] = dict(fp=fp, pp=pp, z=z, snr=snr, k=k, kf=kf, peak=float(snr[k]), white=wbp / noise_sd, prl=prl_bp, sd=noise_sd)

    tH = res['H1']['kf'] / FS  # merger time in H1, s from gps0
    tL = res['L1']['kf'] / FS
    gps_merger = gps0 + tH

    # Best-fit template per detector: shift the template to the detector's SNR peak, whiten and band-pass it like the
    # data, then least-squares fit a·h+ + b·h× (amplitude and phase) to the whitened data over [-0.3, +0.05] s.
    fit = {}
    for d in DETS:
        r = res[d]
        shift = r['k'] - ip
        tp = np.roll(hp, shift)
        tc = np.roll(hc, shift)
        wp = bandpass(whiten(tp, FS, r['fp'], r['pp']), FS) / r['sd']
        wc = bandpass(whiten(tc, FS, r['fp'], r['pp']), FS) / r['sd']
        m = (t_file >= r['k'] / FS - 0.3) & (t_file <= r['k'] / FS + 0.05)
        A = np.stack([wp[m], wc[m]], 1)
        coef, *_ = np.linalg.lstsq(A, r['white'][m], rcond=None)
        wfit = coef[0] * wp + coef[1] * wc
        # The same fit in strain (unwhitened, physical units at the detector): band-limited only by the template.
        hfit = coef[0] * tp + coef[1] * tc
        cc = float(np.corrcoef(wfit[m], r['white'][m])[0, 1])
        fit[d] = dict(white=wfit, strain=hfit, coef=coef.tolist(), corr=cc, amp=float(np.hypot(*coef)))

    # H1–L1: time offset and sign from cross-correlating the whitened, band-passed data near the merger.
    mH = (t_file >= tH - 0.25) & (t_file <= tH + 0.05)
    a = res['H1']['white'][mH]
    lags = np.arange(-int(0.012 * FS), int(0.012 * FS) + 1)
    iH0 = np.nonzero(mH)[0][0]
    cc = np.array([np.corrcoef(a, res['L1']['white'][iH0 + L : iH0 + L + len(a)])[0, 1] for L in lags])
    j = int(np.argmax(np.abs(cc)))
    jf = parabolic(np.abs(cc), j)
    lag_xcorr = (lags[0] + jf) / FS  # L1 sample index − H1 sample index (s): negative = L1 earlier
    sign = int(np.sign(cc[j]))

    # Network SNR: L1 shifted onto H1's time by the measured offset.
    dt_snr = tL - tH
    shiftL = int(round(dt_snr * FS))
    net = np.sqrt(res['H1']['snr'] ** 2 + np.roll(res['L1']['snr'], -shiftL) ** 2)
    kn = int(np.argmax(net[int(4 * FS) : n - int(4 * FS)])) + int(4 * FS)

    # Validation against the published PRL reconstructions (fig. 1, times relative to GPS 1126259462).
    def on_prl(arr: np.ndarray, tq: np.ndarray) -> np.ndarray:
        return np.interp(tq + (1126259462 - gps0), t_file, arr)

    v = {}
    tq = prl['fig1-observed-H'][:, 0]
    v['bandpassed H1 vs PRL fig1 observed H1'] = float(np.corrcoef(on_prl(res['H1']['prl'], tq), prl['fig1-observed-H'][:, 1])[0, 1])
    v['whitened H1 vs PRL fig1 observed H1'] = float(np.corrcoef(on_prl(res['H1']['white'], tq), prl['fig1-observed-H'][:, 1])[0, 1])
    tq = prl['fig1-observed-L'][:, 0]
    v['bandpassed L1 vs PRL fig1 observed L1'] = float(np.corrcoef(on_prl(res['L1']['prl'], tq), prl['fig1-observed-L'][:, 1])[0, 1])
    v['whitened L1 vs PRL fig1 observed L1'] = float(np.corrcoef(on_prl(res['L1']['white'], tq), prl['fig1-observed-L'][:, 1])[0, 1])
    tq = prl['fig1-waveform-H'][:, 0]
    nrH = prl['fig1-waveform-H'][:, 1]
    v['whitened H1 data vs PRL fig1 NR waveform H1'] = float(np.corrcoef(on_prl(res['H1']['white'], tq), nrH)[0, 1])
    v['bandpassed H1 data vs PRL fig1 NR waveform H1'] = float(np.corrcoef(on_prl(res['H1']['prl'], tq), nrH)[0, 1])
    bp_fit = notch(bandpass(fit['H1']['strain'], FS), FS, PRL_NOTCH['H1'])
    v['best-fit template (band-passed) vs PRL fig1 NR waveform H1'] = float(np.corrcoef(on_prl(bp_fit, tq), nrH)[0, 1])
    v['whitened H1 data vs whitened best-fit template (-0.3..+0.05 s)'] = fit['H1']['corr']
    v['whitened L1 data vs whitened best-fit template (-0.3..+0.05 s)'] = fit['L1']['corr']
    # The unfiltered NR waveform (fig 2) vs our best-fit strain: peak amplitude, both ×1e-21.
    v['PRL fig2 unfiltered NR peak |h| (1e-21)'] = float(np.max(np.abs(prl['fig2-unfiltered-waveform-H'][:, 1])))
    v['best-fit template peak |h| at H1 (1e-21)'] = float(np.max(np.abs(fit['H1']['strain'])) * 1e21)

    # ---------- Exports ----------
    OUT.mkdir(parents=True, exist_ok=True)
    i0 = res['H1']['k'] + int(round(WIN[0] * FS))
    i1 = res['H1']['k'] + int(round(WIN[1] * FS))
    t_first = (i0 - res['H1']['kf']) / FS  # data time (s from merger) of sample 0 of every exported window

    for d in DETS:
        r = res[d]
        put_f32(f'raw-{d}.f32', strain[d][i0:i1])
        put_f32(f'white-{d}.f32', r['white'][i0:i1])
        put_f32(f'snr-{d}.f32', r['snr'][i0:i1])
        put_f32(f'fit-white-{d}.f32', fit[d]['white'][i0:i1])
        put_f32(f'bandpass-{d}.f32', r['prl'][i0:i1] * 1e21)
        sel = (r['fp'] >= 10) & (r['fp'] <= 2000)
        put_f32(f'asd-{d}.f32', np.sqrt(r['pp'][sel]))
    put_f32('snr-net.f32', net[i0:i1])
    fsel = (res['H1']['fp'] >= 10) & (res['H1']['fp'] <= 2000)
    asd_f = res['H1']['fp'][fsel]

    # Template (H1 best fit, physical strain at Hanford ×1e21) with its GW frequency and phase: binary.ts drives the
    # orbit from these. Phase/frequency from h+ + i h× of the shifted template (exact quadrature), not a Hilbert guess.
    shift = res['H1']['k'] - ip
    hp_s, hc_s = np.roll(hp, shift), np.roll(hc, shift)
    ph = np.unwrap(np.angle(hp_s + 1j * hc_s))
    amp = np.abs(hp_s + 1j * hc_s)
    fgw = np.gradient(ph, 1 / FS) / (2 * np.pi)
    fgw = np.abs(fgw)
    # Ringdown tail: once the amplitude fades below 2% of its peak the phase is numerical noise; hold the last value.
    pk = res['H1']['k']
    post = np.nonzero(amp[pk:] < 0.02 * amp[pk])[0]
    if len(post):
        cut = pk + int(post[0])
        fgw[cut:] = fgw[cut - 1]
    put_f32('template-strain-H1.f32', fit['H1']['strain'][i0:i1] * 1e21)
    put_f32('template-amp.f32', amp[i0:i1] * fit['H1']['amp'] * 1e21)
    put_f32('template-freq.f32', fgw[i0:i1])
    put_f32('template-phase.f32', (ph - ph[pk])[i0:i1])

    # Published NR waveform at Hanford (tutorial file), t relative to its own peak.
    nr = np.loadtxt(f_nr)
    nr_t = nr[:, 0] - nr[np.argmax(np.abs(nr[:, 1])), 0]
    put_f32('nr-H1.f32', nr[:, 1] * 1e21)

    # ---------- Audio ----------
    clips = {}

    def clip(name: str, x: np.ndarray, label: str, kind: str, pitch: float = 1) -> None:
        a0 = res['H1']['k'] + int(round(AUDIO[0] * FS))
        a1 = res['H1']['k'] + int(round(AUDIO[1] * FS))
        y = x[a0:a1]
        y = signal.resample_poly(y, AUDIO_FS // FS, 1)
        if pitch != 1:
            y = pitch_scale(y, pitch)
            y = bandpass(y, AUDIO_FS, 35 * pitch, min(350 * pitch, AUDIO_FS * 0.45))
        y = fade(y, AUDIO_FS, 0.08, 0.08)
        gain = 0.89 / np.max(np.abs(y))
        sizes[name] = write_wav(OUT / name, y * gain, AUDIO_FS)
        clips[name.removesuffix('.wav')] = dict(
            url=f'/data/gw150914/{name}',
            duration=len(y) / AUDIO_FS,
            t0=(a0 - res['H1']['kf']) / FS,
            speed=1,
            pitch=pitch,
            kind=kind,
            label=label,
        )

    clip('chirp-H1.wav', res['H1']['white'], 'Hanford (H1), whitened and band-passed 35–350 Hz, real time and pitch', 'measured')
    clip('chirp-L1.wav', res['L1']['white'], 'Livingston (L1), whitened and band-passed 35–350 Hz, real time and pitch', 'measured')
    clip(
        f'chirp-H1-x{PITCH}.wav',
        res['H1']['white'],
        f'Hanford (H1), whitened; pitch raised ×{PITCH} (two octaves) for small speakers, same duration',
        'measured',
        PITCH,
    )
    clip('chirp-template.wav', fit['H1']['white'], 'Best-fit template (SEOBNRv2), whitened like the H1 data: no noise', 'modelled')
    clip(
        f'chirp-template-x{PITCH}.wav',
        fit['H1']['white'],
        f'Best-fit template, pitch raised ×{PITCH} (two octaves), same duration',
        'modelled',
        PITCH,
    )

    meta = {
        'event': 'GW150914',
        'credit': 'LIGO Scientific Collaboration and Virgo Collaboration; Gravitational Wave Open Science Center (gwosc.org), CC BY 4.0',
        'sources': {
            'strain': [EV + files[d].name for d in DETS],
            'template': S + 'GW150914_4_template.hdf5',
            'nr': S + 'GW150914_4_NR_waveform.txt',
            'prl': S + 'P150914/',
        },
        'gpsStart': gps0,
        'gpsMerger': gps_merger,
        'fs': FS,
        'window': {'t0': t_first, 'n': i1 - i0, 'fs': FS, 'note': 't = seconds from the H1 merger (template peak)'},
        'series': {
            'raw-H1': 'raw strain, H1',
            'raw-L1': 'raw strain, L1',
            'white-H1': 'whitened, band-passed 35–350 Hz, in units of the noise σ',
            'white-L1': 'whitened, band-passed 35–350 Hz, in units of the noise σ (not shifted, not inverted)',
            'fit-white-H1': 'best-fit template whitened and band-passed like white-H1',
            'fit-white-L1': 'best-fit template whitened and band-passed like white-L1',
            'bandpass-H1': 'strain ×1e21, band-passed 35–350 Hz and notched at the instrumental lines (PRL fig. 1 style)',
            'bandpass-L1': 'strain ×1e21, band-passed and notched like bandpass-H1',
            'snr-H1': 'matched-filter SNR, H1',
            'snr-L1': 'matched-filter SNR, L1',
            'snr-net': 'network SNR, sqrt(H1² + L1²) with L1 shifted by dtL1',
            'template-strain-H1': 'best-fit template at Hanford, physical strain ×1e21',
            'template-amp': 'its amplitude envelope |h+ + i h×| ×1e21',
            'template-freq': 'its gravitational-wave frequency, Hz (orbital frequency = half)',
            'template-phase': 'its gravitational-wave phase, rad, 0 at the merger (orbital phase = half)',
        },
        'asd': {'f0': float(asd_f[0]), 'df': float(asd_f[1] - asd_f[0]), 'n': int(len(asd_f)), 'unit': 'strain/√Hz'},
        'nr': {'t0': float(nr_t[0]), 'fs': 1 / float(np.median(np.diff(nr[:, 0]))), 'n': int(len(nr)), 'unit': 'strain ×1e21'},
        'template': {**tmeta, 'source': 'GWOSC GW150914 tutorial template (detector-frame masses)'},
        'snr': {'H1': res['H1']['peak'], 'L1': res['L1']['peak'], 'network': float(net[kn])},
        'offset': {
            'dtL1': dt_snr,
            'dtL1_xcorr': lag_xcorr,
            'sign': sign,
            'note': 'dtL1 = L1 merger time − H1 merger time (s); negative: Livingston first. sign −1: L1 inverted.',
        },
        'fit': {d: {'coef': fit[d]['coef'], 'corr': fit[d]['corr']} for d in DETS},
        'validation': v,
        'clips': clips,
        'bandpass': [35, 350],
    }
    sizes['meta.json'] = dump_json(OUT / 'meta.json', meta)
    # The same metadata for static import by the app (clip durations, SNR, offset: known before any fetch).
    (ROOT / 'src' / 'data' / 'gw150914.json').write_text(json.dumps(meta, indent=2, ensure_ascii=False) + '\n')

    print(f'GPS merger (H1 template peak): {gps_merger:.4f}')
    print(f"SNR H1 {res['H1']['peak']:.2f}  L1 {res['L1']['peak']:.2f}  network {net[kn]:.2f}")
    print(f'H1–L1: dt(SNR peaks) = {dt_snr * 1e3:+.2f} ms, dt(xcorr) = {lag_xcorr * 1e3:+.2f} ms, sign {sign:+d} (cc {cc[j]:+.3f})')
    for k2, val in v.items():
        print(f'  {k2}: {val:.3f}')
    tot = 0
    for k2, s in sorted(sizes.items()):
        tot += s
        print(f'  {k2:28s} {s / 1024:8.1f} KB')
    print(f'  total {tot / 1024:.1f} KB')


if __name__ == '__main__':
    main()
