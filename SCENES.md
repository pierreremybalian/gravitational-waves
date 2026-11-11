# Scene authoring guide

How to build a stage scene for Cross Rhythm. Read `HANDOFF.md` (story, finale, sound and timing), `CLAUDE.md` (rules) and `DECISIONS.md` first.

## Files

- `src/script/<id>.ts`: pure (no DOM, no three). Already written for every stage: the section(s) it plays, `music(local)`, `readouts(local)`, `note`, and helpers such as `pairIndex(local)` that the scene must use so the picture shows exactly what is heard. Extend it (state functions, more readouts) but keep the music as designed unless DECISIONS.md says otherwise.
- `src/scenes/<id>/index.ts`: default-exports a factory returning a `BlockScene` (`src/scenes/types.ts`); typed `params` at the top. Auto-registered by folder name.
- `src/content/stages/<id>.mdx`: written. Beat `local`s are aligned with the music changes in the script; adjust the copy only where the picture you built needs it.
- `src/hud/cards/<id>*.astro`: optional instrument card (SVG/HTML) via `onStage` / `showCard` from `src/hud/card.ts`.

## The music is the clock

- `ctx.music` (a `MusicFrame`, `src/rhythm/frame.ts`) is filled before every `update()`: per layer `layerPhase` (0–1 through the layer cycle), `layerCycle`, `layerStep`, `onsetAge` (seconds since the last hit as heard, `Infinity` if none), `onsetStep`, `onsetAccent`, `layerOn`, `layerGain`, `layerRate` (steps/s); and `phase`/`bar` (master cycle), `rate`, `realignPhase`, `realignAge`, `entry` (the committed section: `entry.c.section.layers`, `entry.c.steps`, `entry.mask`), `audible`, `revision`.
- The same values are TSL uniforms in `ctx.globals`: `uMusicPhase`, `uMusicRate`, `uAudible`, `uLayerPhase[q]`, `uLayerAge[q]`, `uLayerGain[q]` (vec4s; layer i is `[i >> 2]` component `i & 3`).
- A flash is `exp(−age / τ)` with τ ≈ 0.12–0.2 s. Hands and rotating things use `layerPhase` / `phase`, never `elapsed`. With sound off the transport still runs silently, so the picture moves the same way.
- Read the layer structure from `ctx.music.entry` (what is playing now), not from the script's local, when drawing hits: section changes land on bar lines, a little after the scroll asks for them.
- Fast rates: when `layerRate` exceeds ~8 steps/s, crossfade flashes into a steady picture (they alias at 60 fps).
- Reduced motion: `$reducedMotion` with `ctx.music.audible` false → the engine holds one frame; with sound on it renders every frame: keep hands and flashes (colour/opacity only), drop camera drift and scale pulses.

## Shared modules (`src/shared/`)

| Module | Use |
|---|---|
| `gfx/lines.ts` | `createLines(specs, { resolution })`: luminous constant-width polylines in their own data space with per-line transforms (`state[i]`: x, y, z, sx, sy, rot, from/to reveal, intensity, highlight, width, head); `commit()` once per frame. `circlePoints`, `arcPoints`. |
| `brass/lines.ts` | `createGlowPoints(count, colour)`: glowing points (beads); `createGlowLine`. |
| `brass/geometry.ts` | `GeoBuilder`, `gear({ teeth, module, … })` involute gear profiles, `revolve`, `extrude`, `rod`, `circle`. |
| `brass/outline.ts`, `brass/material.ts` | Edge-detected brass outline pass and the brass material (Tide Machine's machine look). |
| `gfx/labels.ts` | `LabelSet` HTML labels anchored to 3D points (tones a / b / both / light / warm / plain / mute). |
| `gfx/panels.ts` | Split views (`renderPanels`, `renderInPanel`). |
| `gfx/rig.ts` | `OrbitRig` camera with idle drift. |
| `gfx/palette.ts` | `LAYER` / `layerColour(i)`: layer colours in order (amber, cyan, rose, lime, violet, gold); CSS `--color-l0…l5`. |
| `rhythm/*` | The rhythm visual kit (rings, beads, hand, flashes, composite, Shapes mode); see its header comment. |

## Look

Dark, luminous, line-drawn 3D like the rest of the series: black background, additive glowing lines and beads, bloom on highlights (threshold ≈ 0.85; keep idle elements 0.3–0.7 and flashes 2–6). Layer i always has colour `layerColour(i)`; coincident hits (several layers on one tick) flash white. Text is HTML only.

## Gotchas

- Use `attribute('position')`, not `positionLocal`, for fragment-side math when `positionNode` is set.
- WebGPU allows 8 vertex buffers per pipeline; pack attributes.
- `vertexStage(uniformArray.element(i))` for per-instance lookups.
- Never use reversed `smoothstep` edges; `pow` of a possibly negative base needs `.abs()`.
- Additive blending with `depthWrite: false` for everything luminous.
- The first 12% of a stage blends with the previous scene: start calm, end on a calm frame.
- No allocation in `update()`; dispose every geometry, material and texture.

## Self-test loop

Efficiency (owner request): shoot only when it changes a decision. Several locals in one run make one contact sheet (`sheet-<id>.png`): Read the sheet, not the frames. Each scene has a build budget of 6 shoot runs (`node scripts/shoot.ts --ledger` shows the tally; runs past it print a warning). The final pass (phone, `--webgl`, `--leak`, audio-check) is not budgeted and always runs once at the end. Never trade a quality gate for budget: if a scene needs more looks to be right, take them and say why in your report.


- `node scripts/shoot.ts --scene <id> --locals 0.05,0.3,0.6,0.95 --outdir scratch/shots/<id>` and Read the PNGs (the transport runs silently in the harness; add `--wait` to let a few bars play).
- Full page with narration and HUD: `node scripts/shoot.ts --stage <id> --at 0.3,0.7 --wait 3500`; `--webgl` for the fallback; `--width 390 --height 844` for phones; `--leak` for load/unload.
- Sound and sync: `node scripts/audio-check.ts` must stay green.
- `pnpm test`, `pnpm check`, `pnpm lint` before you finish.
