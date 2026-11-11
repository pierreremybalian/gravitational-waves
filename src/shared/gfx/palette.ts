// Shared colours (linear RGB, HDR-friendly). Mirrored as CSS tokens in src/styles/global.css.
// Layers are coloured in order: amber, cyan, rose, lime, violet, gold (then repeat, dimmer). White = together.

export type RGB = readonly [number, number, number];

export const PAL = {
  a: [1.0, 0.52, 0.14] as RGB,
  b: [0.16, 0.74, 1.0] as RGB,
  both: [1.0, 0.97, 0.92] as RGB,
  light: [0.6, 0.45, 1.0] as RGB,
  line: [1.0, 0.88, 0.74] as RGB,
  cool: [0.62, 0.72, 0.95] as RGB,
  edge: [0.42, 0.5, 0.72] as RGB,
  bowl: [0.98, 0.84, 0.6] as RGB,
  sun: [1.0, 0.78, 0.42] as RGB,
  earth: [0.36, 0.7, 1.0] as RGB,
  moon: [0.78, 0.8, 0.86] as RGB,
  andromeda: [0.86, 0.66, 1.0] as RGB,
  green: [0.45, 1.0, 0.7] as RGB,
  red: [1.0, 0.3, 0.26] as RGB,
} as const;

/** Layer colours in display order (sRGB-ish values used as linear HDR; CSS --color-l0…l5). */
export const LAYER: readonly RGB[] = [
  [1.0, 0.62, 0.22],
  [0.22, 0.78, 1.0],
  [1.0, 0.36, 0.64],
  [0.64, 0.96, 0.3],
  [0.62, 0.52, 1.0],
  [1.0, 0.86, 0.42],
];

export const layerColour = (i: number): RGB => {
  const c = LAYER[i % LAYER.length]!;
  const k = i < LAYER.length ? 1 : 0.7;
  return [c[0] * k, c[1] * k, c[2] * k];
};

/** Hex for CSS/HTML use. */
export function hex(c: RGB): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
}
