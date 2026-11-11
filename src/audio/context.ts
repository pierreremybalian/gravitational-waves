// The AudioContext: created and resumed synchronously inside a user gesture (autoplay rules). On iOS the ringer
// switch mutes Web Audio unless the audio session is "playback": navigator.audioSession where it exists, otherwise a
// silent looping <audio> element started in the same gesture.

let ctx: AudioContext | null = null;
let shim: HTMLAudioElement | null = null;

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

function silentWavUrl(): string {
  // 0.5 s of silence, 8 kHz mono 8-bit.
  const n = 4000;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Call synchronously from a click / keydown / pointerup handler. */
export function unlock(): AudioContext | null {
  const nav = navigator as AudioSessionNav;
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* not supported */
  }
  if (!ctx) {
    const A = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!A) return null;
    ctx = new A({ latencyHint: 'interactive' });
  }
  if (!nav.audioSession && /iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent) && !shim) {
    shim = document.createElement('audio');
    shim.src = silentWavUrl();
    shim.loop = true;
    shim.setAttribute('playsinline', '');
    void shim.play().catch(() => {});
  }
  if (ctx.state !== 'running') void ctx.resume();
  return ctx;
}

export function audioContext(): AudioContext | null {
  return ctx;
}

export function pauseShim(paused: boolean): void {
  if (!shim) return;
  if (paused) shim.pause();
  else void shim.play().catch(() => {});
}
