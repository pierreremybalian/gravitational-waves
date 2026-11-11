// Sound state. 'off' until the visitor asks; a stored "on" arms the toggle so the next tap or key press starts the
// sound (scrolling is not a user gesture). 'blocked' when the browser suspended the audio and needs another tap.

import { atom } from 'nanostores';

export type SoundState = 'off' | 'armed' | 'starting' | 'on' | 'blocked';

export const $sound = atom<SoundState>('off');

/** What the listener hears now, for live readouts (which clip, playing or not). Throttled by the transport. */
export interface Audible {
  clip: string | null;
  playing: boolean;
}
export const $audible = atom<Audible>({ clip: null, playing: false });

const KEY = 'gravitational-waves:sound';
const OFFSET_KEY = 'gravitational-waves:sync-ms';

export function storedSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function storeSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

/** User sync offset, ms: positive delays the picture to match late audio (Bluetooth). */
export function storedSyncMs(): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(v) ? Math.max(-100, Math.min(400, v)) : 0;
  } catch {
    return 0;
  }
}

export function storeSyncMs(ms: number): void {
  try {
    localStorage.setItem(OFFSET_KEY, String(Math.round(ms)));
  } catch {
    /* ignore */
  }
}

export const $syncMs = atom(0);
