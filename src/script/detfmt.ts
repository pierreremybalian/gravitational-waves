// Number formatting for the detector stages 8–13 (pure): Unicode superscript exponents (the narration turns them into <sup>).

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export function sup(n: number): string {
  return String(n)
    .replace('-', '⁻')
    .replace(/\d/g, (c) => SUP[Number(c)]!);
}

/** 2.2 × 10⁻¹⁸ */
export function exp10(v: number, digits = 1): string {
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `${(v / 10 ** e).toFixed(digits)} × 10${sup(e)}`;
}

export const fixed = (v: number, d = 1): string => v.toFixed(d);
