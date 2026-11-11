"""A read-only file object over HTTP range requests, so h5py can read a few seconds out of GWOSC's 4096 s strain files
(~100 MB each) without downloading them. Blocks are cached on disk (scripts/cache/ranges/<hash>/<block>)."""

from __future__ import annotations

import hashlib
import io
import os
import time
import urllib.request
from pathlib import Path

BLOCK = 1 << 18  # 256 KiB


class RangeFile(io.RawIOBase):
    def __init__(self, url: str, cache: Path, ua: str):
        self.url = url
        self.ua = ua
        self.dir = cache / hashlib.sha1(url.encode()).hexdigest()[:16]
        self.dir.mkdir(parents=True, exist_ok=True)
        size_f = self.dir / 'size'
        if size_f.exists():
            self.size = int(size_f.read_text())
        else:
            req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': ua})
            with urllib.request.urlopen(req, timeout=60) as r:
                self.size = int(r.headers['Content-Length'])
            tmp = size_f.with_name(f'size.{os.getpid()}.part')
            tmp.write_text(str(self.size))
            os.replace(tmp, size_f)
        self.pos = 0
        self.mem: dict[int, bytes] = {}
        self.fetched = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i: int) -> bytes:
        if i in self.mem:
            return self.mem[i]
        f = self.dir / f'{i}'
        if f.exists():
            b = f.read_bytes()
        else:
            lo = i * BLOCK
            hi = min(self.size, lo + BLOCK) - 1
            for attempt in range(5):
                try:
                    req = urllib.request.Request(self.url, headers={'User-Agent': self.ua, 'Range': f'bytes={lo}-{hi}'})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        if r.status != 206:
                            raise RuntimeError(f'no range support ({r.status})')
                        b = r.read()
                    break
                except Exception:  # noqa: BLE001
                    if attempt == 4:
                        raise
                    time.sleep(2 * (attempt + 1))
            tmp = f.with_name(f'{f.name}.{os.getpid()}.part')
            tmp.write_bytes(b)
            os.replace(tmp, f)
            self.fetched += len(b)
        self.mem[i] = b
        return b

    def readinto(self, buf) -> int:  # type: ignore[override]
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        out = memoryview(buf)
        done = 0
        while done < n:
            i, off = divmod(self.pos + done, BLOCK)
            b = self._block(i)
            k = min(n - done, len(b) - off)
            out[done : done + k] = b[off : off + k]
            done += k
        self.pos += n
        return n
