// The space kit (stages 1–7): spacetime grid with wells, plane waves and the binary's outgoing field; a ring of free
// particles; black-hole horizons; waveform ribbons with a playhead; the scale loupe; the template as a GPU track and
// the slowed chirps that keep orbit and sound on one clock.
export { createSpaceGrid, wellHeight, MAX_WELLS, type SpaceGrid, type SpaceGridOptions } from './grid.ts';
export { createParticleRing, type ParticleRing } from './ring.ts';
export { createHorizon, type Horizon } from './horizon.ts';
export { createRibbon, seriesAt, type Ribbon, type RibbonOptions } from './ribbon.ts';
export { createScaleStack, type ScaleItem, type ScaleStack } from './loupe.ts';
export { loadTemplateTrack, TEX_FS, type TemplateTrack } from './track.ts';
export { defineSlowChirp } from './slowchirp.ts';
export { createBinaryView, type BinaryView, type BinaryViewOptions } from './binaryview.ts';
export { clipClock, createClipClock, type ClipClock } from './clock.ts';
