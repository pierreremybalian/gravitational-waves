// Shared state of the catalogue finale (no DOM, no three): the UI (src/finale/ui) writes the view, filters and
// selection, and the event's loaded snippet and model; the scene (src/scenes/catalogue) reads them and reports what
// is under the pointer through `bridge`.

import { atom } from 'nanostores';
import type { CatalogEvent } from '../shared/gwdata.ts';
import type { ModelChirp } from './model.ts';
import type { ListenWindow } from './listen.ts';
import type { Alignment, ProcessedModel } from './overlay.ts';
import type { View } from './layout.ts';

export type Kind = 'BBH' | 'NSBH' | 'BNS' | 'candidate';

export const kindOf = (e: CatalogEvent): Kind => e.type ?? 'candidate';

export const $events = atom<CatalogEvent[]>([]);
export const $view = atom<View>('time');
export const $filters = atom<Record<Kind, boolean>>({ BBH: true, NSBH: true, BNS: true, candidate: true });

export interface Selected {
  name: string;
  index: number;
  /** Whitened snippets per detector (noise σ), loaded lazily. */
  snippets: Record<string, Float32Array> | null;
  /** Model chirp from the catalogue parameters (null for candidates). */
  model: ModelChirp | null;
  /** The model whitened and band-passed like the data (src/finale/overlay.ts); what is heard and drawn. */
  processed: ProcessedModel | null;
  /** The model laid over one detector's data (Hanford where it has data), once the snippets are in. */
  overlay: Overlay | null;
  /** The listening model (the default sound): trimmed window, default pitch (src/finale/listen.ts). */
  listen: Listen | null;
  /** Data time (s from the catalogue time) of the model's merger: the overlay's offset once aligned, else 0. */
  shift: number;
}

export interface Listen {
  model: ModelChirp;
  /** Model time (0 = merger) of the window; the data clips are cut to it shifted by `shift`. */
  win: ListenWindow;
  /** Default pitch factor (4 when the chirp peaks below 120 Hz) and that peak (Hz). */
  pitch: number;
  peakF: number;
}

export interface Overlay {
  det: string;
  align: Alignment;
  /** The aligned, phase-matched processed model on the data's grid (t0, fs of the snippet), peak 1. */
  model: Float32Array;
  t0: number;
  fs: number;
}

export type PlayKind = 'data' | 'model' | 'overlay';

export const $selected = atom<Selected | null>(null);

/** What the finale plays now (clip id and what it is), for the scene's strip and the status chip. */
export const $playing = atom<{ clip: string; name: string; kind: PlayKind; det: string | null; pitch: number } | null>(null);

/** The panel's footprint: the part of the viewport left for the 3D view (fractions, top-left origin). */
export const $free = atom<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 1, h: 1 });

/** The tool is live (the reader has reached it). */
export const $toolOn = atom(false);

/** Event index under the pointer (−1 = none), for the hover label. */
export const $hover = atom(-1);

/** Orbit offsets from drags and keys (radians). */
export const $orbit = atom({ az: 0, el: 0 });

/** Set by the scene: event index under a screen point (fractions, top-left), or −1. */
export const bridge: { pick: ((fx: number, fy: number) => number) | null } = { pick: null };

/** The listening clip (model chirp alone, trimmed; pitch ×1 or ×4). Model time: 0 = the model's merger. */
export const modelClipId = (name: string, pitch = 1): string => `model:${name}${pitch === 1 ? '' : `:x${pitch}`}`;

export const overlayClipId = (name: string): string => `overlay:${name}`;
