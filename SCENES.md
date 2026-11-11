# Scene authoring guide

How to build a stage scene for Gravitational Waves. Read `HANDOFF.md` (story, finale, sound and timing), `CLAUDE.md` (rules) and `DECISIONS.md` first.

## Files

- `src/script/<id>.ts`: pure (no DOM, no three). Registers the stage with `registerStage(id, { note, readouts(local), sound?(local) })` (`src/script/index.ts`): `sound(local)` returns a `SoundRequest` (`{ clip, loop?, gap? }`, clip ids from `src/data/gw150914.json` `clips`) or null; the conductor hands it to the transport.
- `src/scenes/<id>/index.ts`: default-exports a factory returning a `BlockScene` (`src/scenes/types.ts`); typed `params` at the top. Auto-registered by folder name.
- `src/content/stages/<id>.mdx`: the stage's copy (schema in `src/content.config.ts`); beat `local`s line up with what the script plays.
- `src/hud/cards/<id>*.astro`: optional instrument card (SVG/HTML) via `onStage` / `showCard` from `src/hud/card.ts`.

## The chirp is the clock

- `ctx.chirp` (a `ChirpFrame`, `src/audio/schedule.ts`) is filled before every `update()`: `clip` (id playing, or last played), `playing`, `t` (data seconds within the clip, 0 = the merger; index the GW150914 series with `seriesIndex(t)`), `pos` (audio seconds since start), `progress` (0–1), `start`, `sinceEnd` (s since it ended, 0 while playing, Infinity before any), `untilNext` (s to the next scheduled play), `instance` (changes per play), `audible`, `revision`.
- The same values are TSL uniforms in `ctx.globals`: `uChirpT`, `uChirpProgress`, `uChirpPlaying`, `uChirpSinceEnd`, `uAudible`.
- Never time the chirp with `elapsed`. With sound off the transport still runs silently over the same schedule, so the picture moves the same way. The playhead is within one frame of the sound at the ear (`scripts/audio-check.ts`).
- Clips (`src/data/gw150914.json` → `clips`; all 2.000 s, `t0` = −1.5 s, 16384 Hz WAV): `chirp-H1`, `chirp-L1` (both on H1's clock: L1's merger sits at t = −7.1 ms, and L1 is not inverted), `chirp-H1-x4` (pitch ×4, same timing; say so on screen), `chirp-template`, `chirp-template-x4` (best-fit model, no noise: modelled).
- Direct control (catalogue, buttons): `transport.play(clipId, { loop? })` cuts and plays now; `transport.stop()`; `transport.defineSamples(id, Float32Array, fs, t0)` registers a catalogue snippet (`eventClipId(name, det)`, data from `loadSnippet(ev)` in `src/shared/gwdata.ts`). The conductor only passes on changes of the stage's own `sound(local)`, so a direct `play()` stands until then.
- Reduced motion: `$reducedMotion` with `ctx.chirp.audible` false → the engine holds one frame; with sound on it renders every frame: keep the playhead (colour/opacity), drop camera drift and scale pulses.

## Physics and data (`src/gw/`, `src/shared/gwdata.ts`)

- `units.ts`: constants (G, c, M☉, pc, Mpc, ly, proton radius), `mpcToLy`, `armChange(h)` (each arm: hL/2), `armDifference(h)`, `radiatedEnergy(m1, m2, mf)`, `DETECTORS` (H1/L1/V1/K1 ECEF, lat/lon, arm azimuths), `lightTravel(a, b)` (H1–L1 10.01 ms).
- `strain.ts`: `deform`, `ring(n, R, h+, h×)`, `wave(h, f, t, ψ, mix)`, `detectorStrain(h+, h×, α)`, `rodStrain`.
- `chirp.ts`: `chirpMass`, `chirpMassFromFdot`, `chirpMassFromTrack`, `fdot`, `frequencyAt(τ, 𝓜)`, `timeToCoalescence`, `separation(M, f)`, `relativeSpeed(M, f)`, `schwarzschildRadius`.
- `binary.ts`: `binaryAt(track, { m1, m2, mFinal }, t, out)` → positions, separation, v/c, horizon radii, plunge, merged; track = template-freq / template-phase / template-amp (GW150914.template has the detector-frame masses).
- `gwdata.ts`: `GW150914` (metadata), `loadSeries(name)`, `seriesTime(i)`, `seriesIndex(t)`, `loadCatalog()`, `loadSnippet(ev)`, `median(interval)`.

## Shared modules (`src/shared/`)

| Module | Use |
|---|---|
| `gfx/lines.ts` | `createLines(specs, { resolution })`: luminous constant-width polylines in their own data space with per-line transforms (`state[i]`: x, y, z, sx, sy, rot, from/to reveal, intensity, highlight, width, head); `commit()` once per frame. `circlePoints`, `arcPoints`. |
| `gfx/glow.ts` | `createGlowLine(maxPoints, colour)` (camera-facing ribbon rewritten in place), `createGlowPoints(count, colour)` (beads). |
| `gfx/labels.ts` | `LabelSet` HTML labels anchored to 3D points. |
| `gfx/panels.ts` | Split views (`renderPanels`, `renderInPanel`). |
| `gfx/rig.ts` | `OrbitRig` camera with idle drift. |
| `gfx/palette.ts` | `PAL`, `DET` / `detColour(id)`: detector colours (H1 amber, L1 cyan, V1 violet, K1 lime); CSS `--color-h1` … `--color-k1`. |
| `gwdata.ts` | Data loaders (above). |

## Look

Dark, luminous, line-drawn 3D like the rest of the series: black background, additive glowing lines and beads, bloom on highlights (threshold ≈ 0.85; keep idle elements 0.3–0.7 and flashes 2–6). A detector always has its colour `detColour(id)`; both / network is white. Text is HTML only.

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


- `node scripts/shoot.ts --scene <id> --locals 0.05,0.3,0.6,0.95 --outdir scratch/shots/<id>` and Read the PNGs (the transport runs silently in the harness; add `--wait` to let the chirp play).
- Full page with narration and HUD: `node scripts/shoot.ts --stage <id> --at 0.3,0.7 --wait 3500`; `--webgl` for the fallback; `--width 390 --height 844` for phones; `--leak` for load/unload.
- Sound and sync: `node scripts/audio-check.ts` must stay green.
- `pnpm test`, `pnpm check`, `pnpm lint` before you finish.
