// The Earth with the gravitational-wave detectors, line-drawn (stage 11; reusable): Natural Earth coastlines and a
// graticule, each detector's vertex as a bead in its colour with its two arms along their surveyed azimuths
// (DETECTORS in src/gw/units.ts; arms drawn hundreds of times longer than 4 km so they show), the straight chord
// between two sites (the light-travel baseline), a ring on the sky of the directions a given arrival-time difference
// allows, and a plane wavefront that can sweep through.
//
// Frame (Earth-fixed): scene (x, y, z) = ECEF (x, z, −y) / R⊕, so the north pole is +y and the globe has radius 1.

import { Group, Quaternion, Vector3 } from 'three/webgpu';
import type { Vec2Uniform } from '../../render/globals.ts';
import { DETECTORS, type Detector } from '../../gw/units.ts';
import { createLines, type LineSpec, type Lines } from '../gfx/lines.ts';
import { detColour, type RGB } from '../gfx/palette.ts';
import { createBeads, type Beads } from './beads.ts';

export const EARTH_RADIUS = 6.371e6;
export type SiteId = Detector['id'];
export const SITE_IDS: readonly SiteId[] = ['H1', 'L1', 'V1', 'K1'];

/** Scene coordinates of an ECEF vector (m) divided by R⊕. */
export function ecefToScene(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x / EARTH_RADIUS, z / EARTH_RADIUS, -y / EARTH_RADIUS);
}

/** Unit scene vector of a latitude / longitude (degrees). */
export function latLonToScene(lat: number, lon: number, out: Vector3, r = 1): Vector3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return ecefToScene(Math.cos(la) * Math.cos(lo) * r * EARTH_RADIUS, Math.cos(la) * Math.sin(lo) * r * EARTH_RADIUS, Math.sin(la) * r * EARTH_RADIUS, out);
}

/** Local north and east unit vectors (scene frame) at a latitude / longitude. */
export function localFrame(lat: number, lon: number, north: Vector3, east: Vector3): void {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  // ECEF: E = (−sin λ, cos λ, 0), N = (−sin φ cos λ, −sin φ sin λ, cos φ); scene = (x, z, −y).
  east.set(-Math.sin(lo), 0, -Math.cos(lo));
  north.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo));
}

/** Direction (scene frame) of a detector arm: X arm at its azimuth, Y arm 90° anticlockwise of it (azimuth − 90°). */
export function armDirection(d: Detector, arm: 'x' | 'y', out: Vector3): Vector3 {
  const n = new Vector3();
  const e = new Vector3();
  localFrame(d.lat, d.lon, n, e);
  const az = (((d.xArmAzimuth ?? 0) - (arm === 'y' ? 90 : 0)) * Math.PI) / 180;
  return out.copy(n).multiplyScalar(Math.cos(az)).addScaledVector(e, Math.sin(az));
}

export interface GlobeOptions {
  resolution: Vec2Uniform;
  /** Coastline polylines [lon, lat][] (Natural Earth 110m); drawn when given. */
  coast?: number[][][];
  /** Sites drawn (default all four). */
  sites?: readonly SiteId[];
  /** Drawn arm length (globe radii). */
  armLength?: number;
  /** Arrival-time ring: axis from site a to site b, cos θ = c·Δt / |b − a|. */
  ring?: { from: SiteId; to: SiteId; cos: number; radius: number };
  wavefront?: { size: number; lines: number };
  colour?: { coast: RGB; grid: RGB; ring: RGB; front: RGB };
}

export interface DetectorGlobe {
  group: Group;
  /** Global multipliers (0 hides). */
  show: { coast: number; grid: number; sites: number; arms: number; chord: number; ring: number; front: number };
  /** Per-site brightness multipliers (flashes). */
  site: Record<SiteId, number>;
  /** Portion of the sky ring drawn brighter (the band), as fractions of the ring [from, to]; null = none. */
  band: { from: number; to: number; on: number };
  /** Wavefront travel direction is −n (it comes from n); position s along n (globe radii). */
  front: { n: Vector3; s: number };
  sitePosition(id: SiteId, out: Vector3): Vector3;
  /** Point on the sky ring at fraction u (0–1). */
  ringPoint(u: number, out: Vector3): Vector3;
  /** Unit direction of the ring point at fraction u. */
  ringDirection(u: number, out: Vector3): Vector3;
  update(): void;
  dispose(): void;
}

const COAST: RGB = [0.36, 0.62, 1.0];
const GRID: RGB = [0.32, 0.38, 0.6];
const RING: RGB = [1.0, 0.95, 0.88];
const FRONT: RGB = [0.75, 0.8, 1.0];

export function createDetectorGlobe(o: GlobeOptions): DetectorGlobe {
  const colours = o.colour ?? { coast: COAST, grid: GRID, ring: RING, front: FRONT };
  const sites = o.sites ?? SITE_IDS;
  const group = new Group();
  const v = new Vector3();

  // ── Surface lines (dimmed behind the globe) ──
  const surf: LineSpec[] = [];
  const kind: ('coast' | 'grid' | 'arm')[] = [];
  const armSite: (SiteId | null)[] = [];
  const R = 1.001;
  if (o.coast) {
    for (const poly of o.coast) {
      if (poly.length < 2) continue;
      const pts = new Float32Array(poly.length * 3);
      poly.forEach(([lon, lat], i) => {
        latLonToScene(lat!, lon!, v, R);
        pts.set([v.x, v.y, v.z], i * 3);
      });
      surf.push({ points: pts, dims: 3, colour: colours.coast, width: 1.3, intensity: 0.75 });
      kind.push('coast');
      armSite.push(null);
    }
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = new Float32Array(97 * 3);
    for (let i = 0; i <= 96; i++) {
      latLonToScene(lat, (i / 96) * 360, v, R);
      pts.set([v.x, v.y, v.z], i * 3);
    }
    surf.push({ points: pts, dims: 3, colour: colours.grid, width: lat === 0 ? 1.1 : 0.8, intensity: lat === 0 ? 0.45 : 0.28 });
    kind.push('grid');
    armSite.push(null);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = new Float32Array(49 * 3);
    for (let i = 0; i <= 48; i++) {
      latLonToScene(-90 + (i / 48) * 180, lon, v, R);
      pts.set([v.x, v.y, v.z], i * 3);
    }
    surf.push({ points: pts, dims: 3, colour: colours.grid, width: 0.8, intensity: 0.28 });
    kind.push('grid');
    armSite.push(null);
  }
  const armLen = o.armLength ?? 0.09;
  for (const id of sites) {
    const d = DETECTORS[id];
    if (d.xArmAzimuth === null) continue;
    const p = ecefToScene(d.ecef[0], d.ecef[1], d.ecef[2], new Vector3()).normalize().multiplyScalar(1.004);
    for (const arm of ['x', 'y'] as const) {
      armDirection(d, arm, v);
      surf.push({ points: Float32Array.from([p.x, p.y, p.z, p.x + v.x * armLen, p.y + v.y * armLen, p.z + v.z * armLen]), dims: 3, colour: detColour(id), width: 2.4, intensity: 1.4 });
      kind.push('arm');
      armSite.push(id);
    }
  }
  const surface: Lines = createLines(surf, { resolution: o.resolution, occluder: { centre: [0, 0, 0], radius: 1, dim: 0.12 } });
  group.add(surface.mesh);

  // ── Chord and sky ring (not occluded: the chord runs through the Earth) ──
  const free: LineSpec[] = [];
  const pos = (id: SiteId, out: Vector3) => {
    const d = DETECTORS[id];
    return ecefToScene(d.ecef[0], d.ecef[1], d.ecef[2], out);
  };
  const ringAxis = new Vector3();
  const ringU = new Vector3();
  const ringV = new Vector3();
  let ringCos = 0;
  let ringR = 3;
  let iChord = -1;
  let iRing = -1;
  let iBand = -1;
  if (o.ring) {
    const a = pos(o.ring.from, new Vector3());
    const b = pos(o.ring.to, new Vector3());
    free.push({ points: Float32Array.from([a.x, a.y, a.z, b.x, b.y, b.z]), dims: 3, colour: colours.ring, width: 1.6, intensity: 0.9, dash: 0.03 });
    iChord = 0;
    ringAxis.copy(b).sub(a).normalize();
    ringU.set(0, 1, 0).cross(ringAxis).normalize();
    ringV.copy(ringAxis).cross(ringU).normalize();
    ringCos = o.ring.cos;
    ringR = o.ring.radius;
    const N = 160;
    const pts = new Float32Array(N * 3);
    const sinT = Math.sqrt(1 - ringCos * ringCos);
    for (let i = 0; i < N; i++) {
      const ph = (i / N) * Math.PI * 2;
      v.copy(ringAxis).multiplyScalar(ringCos).addScaledVector(ringU, sinT * Math.cos(ph)).addScaledVector(ringV, sinT * Math.sin(ph)).multiplyScalar(ringR);
      pts.set([v.x, v.y, v.z], i * 3);
    }
    free.push({ points: pts, dims: 3, colour: colours.ring, width: 1.3, intensity: 0.4, closed: true });
    iRing = 1;
    free.push({ points: pts, dims: 3, colour: [1.0, 0.8, 0.5], width: 4, intensity: 0.8, closed: true });
    iBand = 2;
  }
  const freeLines: Lines | null = free.length ? createLines(free, { resolution: o.resolution }) : null;
  if (freeLines) group.add(freeLines.mesh);

  // ── Wavefront: a square grid in its own group, oriented along n ──
  const wf = o.wavefront ?? { size: 3.2, lines: 11 };
  const frontSpecs: LineSpec[] = [];
  for (let i = 0; i < wf.lines; i++) {
    const c = -wf.size / 2 + (wf.size * i) / (wf.lines - 1);
    const fade = 1 - Math.abs(c) / (wf.size * 0.62);
    frontSpecs.push({ points: Float32Array.from([-wf.size / 2, c, wf.size / 2, c]), colour: colours.front, width: 1.2, intensity: 0.5 * fade });
    frontSpecs.push({ points: Float32Array.from([c, -wf.size / 2, c, wf.size / 2]), colour: colours.front, width: 1.2, intensity: 0.5 * fade });
  }
  const frontGroup = new Group();
  const frontLines = createLines(frontSpecs, { resolution: o.resolution });
  frontGroup.add(frontLines.mesh);
  group.add(frontGroup);

  // ── Site beads ──
  const beads: Beads = createBeads(sites.length, { intensity: 1.6, minSize: 0.006 });
  sites.forEach((id, i) => {
    const c = detColour(id);
    beads.colour(i, c[0], c[1], c[2]);
  });
  group.add(beads.mesh);

  const show = { coast: 1, grid: 1, sites: 1, arms: 1, chord: 0, ring: 0, front: 0 };
  const site = { H1: 1, L1: 1, V1: 1, K1: 1 } as Record<SiteId, number>;
  const band = { from: 0, to: 0, on: 0 };
  const front = { n: new Vector3(0, 0, 1), s: 3 };
  const q = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);

  const self: DetectorGlobe = {
    group,
    show,
    site,
    band,
    front,
    sitePosition(id, out) {
      return pos(id, out);
    },
    ringPoint(u, out) {
      return self.ringDirection(u, out).multiplyScalar(ringR);
    },
    ringDirection(u, out) {
      const ph = u * Math.PI * 2;
      const sinT = Math.sqrt(1 - ringCos * ringCos);
      return out.copy(ringAxis).multiplyScalar(ringCos).addScaledVector(ringU, sinT * Math.cos(ph)).addScaledVector(ringV, sinT * Math.sin(ph));
    },
    update() {
      for (let i = 0; i < surf.length; i++) {
        const k = kind[i]!;
        const s = surface.state[i]!;
        s.intensity = k === 'coast' ? show.coast : k === 'grid' ? show.grid : show.arms * site[armSite[i]!]!;
      }
      surface.commit();
      if (freeLines) {
        freeLines.state[iChord]!.intensity = show.chord;
        freeLines.state[iRing]!.intensity = show.ring;
        const bs = freeLines.state[iBand]!;
        bs.intensity = show.ring * band.on;
        bs.from = band.from;
        bs.to = band.to;
        freeLines.commit();
      }
      frontLines.opacity.value = show.front;
      frontGroup.visible = show.front > 0.001;
      q.setFromUnitVectors(zAxis, front.n);
      frontGroup.quaternion.copy(q);
      frontGroup.position.copy(front.n).multiplyScalar(front.s);
      sites.forEach((id, i) => {
        pos(id, v).normalize().multiplyScalar(1.006);
        beads.set(i, v.x, v.y, v.z, 0.022, show.sites * site[id]);
      });
      beads.commit();
    },
    dispose() {
      surface.dispose();
      freeLines?.dispose();
      frontLines.dispose();
      beads.dispose();
    },
  };
  self.update();
  return self;
}
