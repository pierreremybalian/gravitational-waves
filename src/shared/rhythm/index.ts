// The rhythm visual kit: luminous rings, beads, hand, composite and Shapes view, all driven by ctx.music so every
// flash lands when its sound is heard. Import from here.
//
// ── Angle and time conventions (shared with the audio's stereo spread) ─────────────────────────────────────────
// Local frame: rings in the x–y plane facing +z, the axle along z. Step j of n is at θ = π/2 − 2π·j/n: downbeat at
// 12 o'clock, clockwise as seen from +z (the right half of a ring is the right ear). Keep the camera on +z and don't
// orbit behind for long. Time runs back along −z: a hit `a` bars ago sits a·barDepth behind its ring.
// `angleOf(phase)` and `stepAngle(j, n)` give θ.
//
// ── createWheel(opts): Wheel ─────────────────────────────────────────────────────────────────────────────────────
// Concentric rings on one axle (one per layer), one hand, beads that flash on their hits, a composite ring on the
// lcm grid, a faint grid ring, a trail of past bars receding along the axle, and the Shapes view (polygons inscribed
// in one circle with a dot running each perimeter, the composite polygon in front, past bars as ghost polygons that
// peel off at each downbeat) with a 0.4 s crossfade. Section changes land on the bar line with the sound; the trail
// keeps what each past bar actually played.
//
//   const wheel = createWheel({ resolution: ctx.globals.uResolution, fallback: S32, accept: (c) => c.key === S32.key });
//   scene.add(wheel.group);                       // position/rotate/scale the group freely (+z towards the camera)
//   // every frame:
//   wheel.mode = $drawMode.get();                 // 'rings' | 'shapes' (crossfades)
//   wheel.show.trail = smoothstep(0.2, 0.3, local); // part opacities, smoothed internally (≈0.2 s)
//   wheel.emphasis[0] = 1;                        // per-layer highlight 0–1; wheel.dim[i] multiplier; wheel.lift[i] z
//   wheel.still = $reducedMotion.get();           // no scale pulses
//   wheel.update(ctx.music, dt);
//   wheel.setFallback(section)                    // what to draw when nothing accepted plays (dev harness, stills)
//   wheel.layerPoint(i, phase, dr, v3)            // world anchors for LabelSet: on ring i at a cycle phase
//   wheel.compositePoint(phase, dr, v3); wheel.playheadPoint(i, v3); wheel.axlePoint(z, v3)
//   wheel.info                                    // steps, hitCount, grid, composite hits and gaps; .revision bumps
//   wheel.dispose();
//
// Options (WheelOptions in ./wheel.ts): maxLayers (8, ≤16), firstRadius (0.78) and gap (0.2) or radii[],
// compositeRadius (1), shapeRadius (= compositeRadius), ringDz (0: per-ring step back along the axle), shapeDz (0.24:
// per-polygon step in Shapes mode; the composite polygon sits one step in front), compositeZ, gridLayer (−1: a
// layer drawn as dots on the grid ring, e.g. a shaker playing the lcm grid), trailBars (4, ≤8), barDepth (0.5),
// tau (0.17 s flash decay), beadScale, lineScale, fallback (Section drawn statically when nothing accepted plays),
// accept(c) (which playing sections to draw; others show the fallback), colour(i) (default layerColour).
// show: rings, beads, rests, hand, spokes, reach (hit → grid step), composite, grid, trail, helix, axle, playheads (0–1).
//
// What it reads: ctx.music.entry (structure: steps, hits, accents; changes land on the bar line with the sound),
// layerPhase (hand, playheads, sweep afterglow), onsetAge/onsetStep (flashes, exp(−age/τ), accents brighter),
// layerOn/layerGain (fade in/out), layerRate (above ~8 steps/s flashes crossfade into a steady glow). Coincident
// hits (several layers in the same instant) flash white. The composite and grid need every ring layer to span the
// bar (a polyrhythm); polymeter layers still get rings with their own playheads.
//
// ── Building blocks ────────────────────────────────────────────────────────────────────────────────────────────
// createRhythmLines({ resolution, capacity, slots }): rewritable constant-width glowing polylines. clear(); begin(slot,
//   colour, width, closed); point(x, y, z, u)…; end(); upload() (whenever the shape changes); per frame set
//   slots[s] = { x, y, z, scale, rot, intensity, sweepPhase, sweepGain, fade, zScale, width, uTo } and commit().
//   `u` is a point's time position 0–1: the sweep lights what the playhead just passed, e^(−fade·u) fades a trail.
// createBeads(capacity): beads.set(i, x, y, z, radius, r, g, b, brightness, BEAD_FILLED | BEAD_HOLLOW |
//   BEAD_PLAYHEAD) → i + 1; beads.commit(count) once per frame.
// flashOf(age, tau), stepAngle(j, n), angleOf(phase): helpers.
//
// Brightness guide (bloom threshold 0.85): idle lines 0.3–0.6, idle beads 0.5–0.75, flashes 3–6.

export { createWheel, type Wheel, type WheelOptions, type WheelShow, type WheelInfo, type DrawMode } from './wheel.ts';
export { createRhythmLines, defaultSlot, type RhythmLines, type RhythmLinesOptions, type LineSlot } from './lines.ts';
export { createBeads, BEAD_FILLED, BEAD_HOLLOW, BEAD_PLAYHEAD, type Beads, type BeadsOptions } from './beads.ts';

/** θ of cycle phase (downbeat at 12 o'clock, clockwise seen from +z). */
export const angleOf = (phase: number): number => Math.PI / 2 - Math.PI * 2 * phase;
/** θ of step j of n. */
export const stepAngle = (j: number, n: number): number => angleOf(j / n);
/** Flash brightness for a hit `age` seconds ago (0 when none). */
export const flashOf = (age: number, tau = 0.17): number => (Number.isFinite(age) && age >= 0 ? Math.exp(-age / tau) : 0);
