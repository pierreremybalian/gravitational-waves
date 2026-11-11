"""Shared helpers for the GWOSC data scripts: cached downloads, strain I/O, PSD, whitening, filters, WAV and
binary writers. numpy/scipy/h5py only. All data: LIGO Scientific Collaboration, Virgo Collaboration and KAGRA,
Gravitational Wave Open Science Center (GWOSC, https://gwosc.org), CC BY 4.0."""

from __future__ import annotations

import json
import os
import time
import urllib.request
import wave
from pathlib import Path

import h5py
import numpy as np
from scipy import signal
from scipy.interpolate import interp1d

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'scripts' / 'cache'
PUBLIC = ROOT / 'public' / 'data'
UA = 'gravitational-waves.balian.dev build script (contact via balian.dev)'


def fetch(url: str, dest: Path, retries: int = 4) -> Path:
    """Download url to dest once (cache)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f'{dest.name}.{os.getpid()}.part')
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as f:
                while chunk := r.read(1 << 16):
                    f.write(chunk)
            os.replace(tmp, dest)
            return dest
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise RuntimeError(f'download failed: {url}: {e}') from e
            time.sleep(2 * (attempt + 1))
    return dest


def fetch_json(url: str, dest: Path) -> dict:
    return json.loads(fetch(url, dest).read_text())


def read_strain(path: Path) -> tuple[np.ndarray, float, float]:
    """GWOSC strain HDF5 → (strain, gps_start, fs)."""
    with h5py.File(path, 'r') as f:
        d = f['strain/Strain']
        x = d[...].astype(np.float64)
        dt = float(d.attrs['Xspacing'])
        t0 = float(d.attrs['Xstart'])
    return x, t0, 1.0 / dt


def psd(x: np.ndarray, fs: float, seg: float = 4.0) -> tuple[np.ndarray, np.ndarray]:
    """One-sided PSD by Welch (Hann, 50% overlap, median). NaN-safe: NaN samples are not allowed upstream."""
    n = int(seg * fs)
    f, p = signal.welch(x, fs=fs, nperseg=n, noverlap=n // 2, window='hann', average='median')
    return f, p


def whiten(x: np.ndarray, fs: float, f_psd: np.ndarray, p_psd: np.ndarray, alpha: float = 1 / 8) -> np.ndarray:
    """Divide the data's spectrum by the ASD (unit-variance white noise out, before band-passing)."""
    n = len(x)
    win = signal.windows.tukey(n, alpha)
    X = np.fft.rfft(x * win)
    f = np.fft.rfftfreq(n, 1 / fs)
    asd = np.sqrt(interp1d(f_psd, p_psd, bounds_error=False, fill_value=(p_psd[0], p_psd[-1]))(f))
    W = X / asd
    W[0] = 0
    return np.fft.irfft(W, n) * np.sqrt(2.0 / fs)


def bandpass(x: np.ndarray, fs: float, lo: float = 35.0, hi: float = 350.0, order: int = 4) -> np.ndarray:
    sos = signal.butter(order, [lo, hi], btype='band', fs=fs, output='sos')
    return signal.sosfiltfilt(sos, x)


def notch(x: np.ndarray, fs: float, freqs: list[float], q: float = 30.0) -> np.ndarray:
    for f0 in freqs:
        b, a = signal.iirnotch(f0, q, fs)
        x = signal.filtfilt(b, a, x)
    return x


def write_f32(path: Path, arr: np.ndarray) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    b = np.asarray(arr, dtype='<f4').tobytes()
    path.write_bytes(b)
    return len(b)


def write_i16(path: Path, arr: np.ndarray, scale: float) -> int:
    """arr / scale → int16 (so value = int16 * scale / 32767)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    q = np.clip(np.round(np.asarray(arr) / scale * 32767), -32767, 32767).astype('<i2')
    b = q.tobytes()
    path.write_bytes(b)
    return len(b)


def write_wav(path: Path, x: np.ndarray, fs: int) -> int:
    """Mono 16-bit PCM; x already in [-1, 1]."""
    path.parent.mkdir(parents=True, exist_ok=True)
    q = np.clip(np.round(np.asarray(x) * 32767), -32767, 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(fs)
        w.writeframes(q.tobytes())
    return path.stat().st_size


def fade(x: np.ndarray, fs: float, t_in: float = 0.05, t_out: float = 0.05) -> np.ndarray:
    y = x.copy()
    a, b = int(t_in * fs), int(t_out * fs)
    if a:
        y[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if b:
        y[-b:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b))
    return y


def pitch_scale(x: np.ndarray, n: float) -> np.ndarray:
    """Multiply the instantaneous phase of the analytic signal by n: every frequency ×n, duration and envelope
    unchanged. Exact for a single chirping tone; broadband noise becomes noise n times higher."""
    a = signal.hilbert(x)
    env = np.abs(a)
    ph = np.unwrap(np.angle(a))
    return env * np.cos(n * ph)


def dump_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    path.write_text(s)
    return len(s.encode())
