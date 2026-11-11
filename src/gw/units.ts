// Constants and unit conversions (pure, SI). Sources: CODATA 2022 (G, proton radius), IAU 2015 (nominal solar mass
// parameter, parsec, light year via Julian year), LIGO/Virgo/KAGRA detector vertices and arm azimuths as tabulated in
// LALSuite (LALDetectors.h, from LIGO-T980044 / Virgo / KAGRA site surveys; WGS-84 Earth-centred, Earth-fixed metres).

export const C = 299_792_458; // m/s (exact)
export const G = 6.6743e-11; // m³ kg⁻¹ s⁻² (CODATA 2022)
/** Nominal solar mass parameter GM☉ (IAU 2015 B3), m³/s². */
export const GM_SUN = 1.3271244e20;
export const M_SUN = GM_SUN / G; // kg ≈ 1.98841e30
/** GM☉/c³: the Sun's mass as a time, s (≈ 4.925 µs). */
export const T_SUN = GM_SUN / C ** 3;
/** GM☉/c²: the Sun's mass as a length, m (≈ 1.477 km). */
export const L_SUN = GM_SUN / C ** 2;

export const PARSEC = 3.085677581491367e16; // m (IAU 2015)
export const MPC = PARSEC * 1e6;
export const LIGHT_YEAR = C * 365.25 * 86400; // m (Julian year)

/** Proton charge radius, m (CODATA 2022: 0.84075 fm). */
export const PROTON_RADIUS = 0.84075e-15;
export const PROTON_DIAMETER = 2 * PROTON_RADIUS;

/** LIGO arm length, m (3995 m; "4 km"). */
export const LIGO_ARM = 3995;

export const mpcToLy = (mpc: number): number => (mpc * MPC) / LIGHT_YEAR;
export const lyToMpc = (ly: number): number => (ly * LIGHT_YEAR) / MPC;
export const mpcToMetres = (mpc: number): number => mpc * MPC;

/**
 * How far each arm's length changes for strain h (optimal orientation): ΔL = h · L / 2 per arm (one arm stretches by
 * this while the other shrinks by it; the measured difference of the two is h · L).
 */
export const armChange = (h: number, L: number = LIGO_ARM): number => (h * L) / 2;
/** Differential arm length change h · L (what the interferometer reads). */
export const armDifference = (h: number, L: number = LIGO_ARM): number => h * L;

/** Energy radiated when masses m1 + m2 settle into mf (all in M☉), J. */
export const radiatedEnergy = (m1: number, m2: number, mf: number): number => (m1 + m2 - mf) * M_SUN * C * C;

// ── Detectors ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Detector {
  id: 'H1' | 'L1' | 'V1' | 'K1';
  name: string;
  /** Vertex (beam splitter), Earth-centred Earth-fixed, m. */
  ecef: readonly [number, number, number];
  /** Geodetic latitude / longitude, degrees (east positive). */
  lat: number;
  lon: number;
  /** X-arm azimuth, degrees clockwise from local North (Y arm = X − 90°); null where not tabulated here. */
  xArmAzimuth: number | null;
  /** Arm length, m. */
  arm: number;
}

export const DETECTORS: Readonly<Record<Detector['id'], Detector>> = {
  H1: {
    id: 'H1',
    name: 'LIGO Hanford',
    ecef: [-2.16141492636e6, -3.83469517889e6, 4.60035022664e6],
    lat: 46.45514,
    lon: -119.40766,
    xArmAzimuth: 324.0,
    arm: 3995,
  },
  L1: {
    id: 'L1',
    name: 'LIGO Livingston',
    ecef: [-7.42760447238e4, -5.49628371971e6, 3.22425701744e6],
    lat: 30.56289,
    lon: -90.77425,
    xArmAzimuth: 252.28,
    arm: 3995,
  },
  V1: {
    id: 'V1',
    name: 'Virgo',
    ecef: [4.5463741e6, 8.42989698e5, 4.37857696e6],
    lat: 43.63146,
    lon: 10.50449,
    xArmAzimuth: 19.43,
    arm: 3000,
  },
  K1: {
    id: 'K1',
    name: 'KAGRA',
    ecef: [-3.777336024e6, 3.484898411e6, 3.765313697e6],
    lat: 36.41190,
    lon: 137.30559,
    xArmAzimuth: null,
    arm: 3000,
  },
};

/** Straight-line distance between two detector vertices, m. */
export function baseline(a: Detector, b: Detector): number {
  const dx = a.ecef[0] - b.ecef[0];
  const dy = a.ecef[1] - b.ecef[1];
  const dz = a.ecef[2] - b.ecef[2];
  return Math.hypot(dx, dy, dz);
}

/** Light travel time between two detectors, s: the largest possible arrival-time difference for a wave at speed c. */
export const lightTravel = (a: Detector, b: Detector): number => baseline(a, b) / C;
