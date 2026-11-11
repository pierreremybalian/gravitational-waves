// Number formatting for stage readouts (pure). Unicode superscript exponents; the narration turns them into <sup>.
// (Restored after an accidental overwrite by the stages 8–13 builder: sci and group as used by stages 3–7.)

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) =>
  String(n)
    .replace('-', '⁻')
    .replace(/\d/g, (c) => SUP[Number(c)]!);

/** 1.1 × 10⁻²¹ */
export function sci(v: number, digits = 1): string {
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `${(v / 10 ** e).toFixed(digits)} × 10${sup(e)}`;
}

/** 12,345 (rounded, thousands grouped). */
export function group(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
