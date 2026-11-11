// The scale loupe: a dive through powers of ten without floating-point trouble. Every object is drawn in its own unit
// space (1 = `metres`) and placed each frame at size metres / 10^zoom, so the view at zoom z shows objects near 10^z m
// across; an object fades in as it grows into view and out as it fills past the frame. Zoom is the only state.
// Labels (sizes, names) are HTML; `screen(i)` gives an object's current size for placing them.

import { createLines, type LineSpec, type Lines } from '../gfx/lines.ts';
import type { Vec2Uniform } from '../../render/globals.ts';
import type { RGB } from '../gfx/palette.ts';

export interface ScaleItem {
  id: string;
  /** Real size, metres, of 1 unit of `points`. */
  metres: number;
  points: ArrayLike<number>;
  colour: RGB;
  width?: number;
  intensity?: number;
  closed?: boolean;
  dash?: number;
  /** Offset of the item's origin, in its own units (e.g. the arm's end where the dive goes in). */
  ox?: number;
  oy?: number;
  /** log10 of relative size at which it is fully gone when small / when large (defaults −1.7 / 0.75). */
  minLog?: number;
  maxLog?: number;
}

export interface ScaleStack {
  lines: Lines;
  items: readonly ScaleItem[];
  /** World units per 10^zoom metres (the frame's half-size, about). */
  unit: number;
  /** Place everything for zoom exponent z (log10 metres at the frame). `gain` scales every intensity. */
  update(z: number, gain?: number): void;
  /** On-screen size of item i in world units at the last update (0 if hidden). */
  screen(i: number): number;
  /** Visibility (0–1) of item i at the last update. */
  vis(i: number): number;
  dispose(): void;
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createScaleStack(items: readonly ScaleItem[], resolution: Vec2Uniform, unit = 1): ScaleStack {
  const specs: LineSpec[] = items.map((it) => ({
    points: it.points,
    colour: it.colour,
    width: it.width ?? 1.6,
    intensity: it.intensity ?? 1,
    closed: it.closed,
    dash: it.dash,
  }));
  const lines = createLines(specs, { resolution });
  const size = new Float32Array(items.length);
  const vis = new Float32Array(items.length);
  return {
    lines,
    items,
    unit,
    update(z, gain = 1) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const rel = Math.log10(it.metres) - z;
        const lo = it.minLog ?? -1.7;
        const hi = it.maxLog ?? 0.75;
        const v = ss(lo, lo + 0.7, rel) * (1 - ss(hi - 0.45, hi, rel));
        const s = Math.pow(10, rel) * unit;
        const st = lines.state[i]!;
        st.sx = s;
        st.sy = s;
        st.x = -(it.ox ?? 0) * s;
        st.y = -(it.oy ?? 0) * s;
        st.intensity = v * gain;
        size[i] = v > 0 ? s : 0;
        vis[i] = v;
      }
      lines.commit();
    },
    screen: (i) => size[i]!,
    vis: (i) => vis[i]!,
    dispose() {
      lines.dispose();
    },
  };
}
