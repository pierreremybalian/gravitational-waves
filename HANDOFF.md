# Gravitational Waves — handoff spec

The build spec. Deviations go in `DECISIONS.md`; scene guide in `SCENES.md`.


## Context
Next demo in the balian.dev series, chosen over the black hole for lower dev time and risk. On 14 September 2015 LIGO heard two black holes merge 1.3 billion light years away (GW150914). The piece explains what a gravitational wave is, how a detector measures a stretch of 1/1000 of a proton, how the signal was pulled out of noise, and what it tells us. It ends in a catalogue of every confirmed merger. Real data throughout; the chirp is played as sound.

Decisions (owner, 2026-11-10): name **Gravitational Waves** (`~/Code/gravitational-waves`, `gravitational-waves.balian.dev`, repo from Pierre); finale = **event catalogue**.

Series conventions: luminous line-drawn 3D instruments driven by real data (not literal charts), honest status labels (measured · established · modelled · metaphor), scroll story + finale, Hire Me corner link, GA `G-MXMS8L0Z1H`, SEO/OG/JSON-LD, sound off until a click, visuals and sound built together from the first build, efficient Playwright (contact sheets, shoot ledger budget, one final pass), noreply author, account ID only in `.env`, deploy only when Pierre says.

## Story (12 stages + finale)
| # | Stage | Status | Main view |
|---|---|---|---|
| 1 | A sound from space | measured | The real chirp from both detectors, played; a waveform rising in pitch and loudness for 0.2 s. "This is two black holes colliding." |
| 2 | Spacetime is a fabric | established | A grid of spacetime; a mass dimples it; light bends. Sets up the medium (Block Universe callback). |
| 3 | Ripples | established | A ring of free particles: the wave passes and squeezes/stretches it in the + then × pattern (exact quadrupole formula, strain exaggerated 10²¹, stated). |
| 4 | Two black holes | modelled | The binary orbiting, radiating waves outward as a spiral pattern; orbital frequency = half the wave frequency. |
| 5 | The inspiral | measured | As they spiral in, the frequency and loudness rise: the chirp. Orbit separation and speed computed from the measured frequency (up to ~half light speed). |
| 6 | Merger and ringdown | modelled | The two horizons merge; the new black hole rings like a bell and settles. 3 solar masses radiated away in 0.2 s, more power than all the stars in the universe. |
| 7 | How small | measured | The scale: 10⁻²¹ strain on a 4 km arm = 1/1000 of a proton; a zoom loupe through scales (Block Universe loupe). |
| 8 | An interferometer | established | LIGO drawn: laser, splitter, two 4 km arms, mirrors; arm lengths change, the light interferes, the photodetector reads it. |
| 9 | Noise | measured | The raw detector output: the signal is invisible under seismic, thermal and quantum noise; the noise spectrum (ASD) as a landscape. |
| 10 | Finding it | measured | Whitening and band-pass reveal it; the template bank and matched filter lock onto the chirp; signal-to-noise peaks at 24. |
| 11 | Two detectors | measured | Hanford and Livingston on a globe: the same signal 7 ms apart (light travel limit 10 ms) and inverted by arm orientation; sky localisation as a band. |
| 12 | What it told us | measured | 36 + 29 → 62 solar masses; distance 410 Mpc; speed of gravity = c (GW170817 with the light flash). |
| 13 | The catalogue (finale) | measured | Every confirmed event: pick one, hear its chirp, see its masses, distance, merger. |

## Finale: the catalogue
- GWOSC event catalogue (GWTC-1…GWTC-4 as available): masses, final mass, distance, SNR, detectors, date; a 3D "chart" of events (mass vs distance vs time, or the classic mass graveyard plot as luminous beads).
- Selecting an event plays its whitened chirp (pre-processed strain around the merger, ~1–4 s, per available detector) and drives the binary/merger visual with its parameters (model waveform from the catalogue's best-fit parameters, labelled modelled).
- Filters (BBH, BNS, NSBH), the loudest, the heaviest, GW170817 (neutron stars + light).

## Data (build time, scripts/)
- `scripts/fetch-gwosc.py` (Python, numpy/scipy/gwpy-free if possible): GWOSC open data (CC BY 4.0): 32 s of H1 and L1 strain around GW150914 at 4096 Hz; ASD; whitening + band-pass (35–350 Hz); the numerical-relativity template GWOSC publishes for GW150914; matched-filter SNR time series. Outputs compact Float32 binaries + JSON in `public/data/`.
- `scripts/fetch-catalog.py`: GWOSC event API → `public/data/events.json` (parameters, credible intervals) and per-event whitened chirp snippets (e.g. 2 s, 2048 Hz, int16) for the finale; size budget ≤ ~15 MB total, lazily fetched.
- Detector geometry (Hanford/Livingston/Virgo positions, arm azimuths) from published values; sky-map for GW150914 (GWOSC skymap FITS → simplified band).
- All data credited: LIGO Scientific Collaboration, Virgo Collaboration, KAGRA (GWOSC, CC BY 4.0).

## Physics core (pure TS, `src/gw/`, unit-tested)
- `strain.ts`: plus/cross polarisation pattern on a ring of particles (exact for a plane wave).
- `chirp.ts`: leading-order (Newtonian) chirp: f(t), chirp mass from df/dt, orbital separation and velocity from Kepler; tests: chirp mass of GW150914 ≈ 30 M☉ from the measured f(t).
- `binary.ts`: positions of the two bodies through inspiral (from f(t) of the template), with merger/ringdown handled by the template; energy radiated (≈3 M☉c²).
- `units.ts`: strain scales, proton comparison, light-travel time between sites (10.0 ms), Mpc/ly.
- `filter.ts`: tested reference implementations of whitening/matched filter for small arrays (the heavy processing runs at build time).

## Sound
- Reuse Cross Rhythm's audio layer (`~/Code/cross-rhythm/src/audio/{context,clock,transport,SoundToggle}`): AudibleClock, sound toggle, iOS unlock, visibility. The chirp plays as an AudioBuffer of the whitened strain (and a pitch-shifted ×n version where stated, for small-speaker audibility), scheduled on the transport so the waveform playhead, the orbit and the ring of particles are locked to what is heard.

## Architecture
Copy Cross Rhythm infrastructure (render loop, scene manager, compositor, scroll/story/narration, HUD, labels, glow lines, panels/loupe from Block Universe if needed, sound toggle, Hire Me, Base layout, shoot/stills/headers scripts, docs). Drop rhythm-specific code. New: `src/gw/` (pure), `src/scenes/<stage>/`, `src/finale/` (catalogue UI + scene), `public/data/`.

## Execution
1. Bootstrap `~/Code/gravitational-waves` from Cross Rhythm; noreply author; `.env`; docs (HANDOFF from this plan, CLAUDE, DECISIONS, SCENES); remote once Pierre gives the repo.
2. Data scripts (GW150914 strain, template, whitening/SNR; catalogue + snippets) and `src/gw/` with tests (chirp mass, light-travel time, strain pattern).
3. Sound: chirp playback on the transport; a `/dev/listen` page.
4. Shared visual kit: spacetime grid (TSL vertex displacement from the quadrupole field), particle ring, binary + horizons, waveform ribbon with playhead, globe with detector sites. Anchor stages 1, 3 and 5 myself, visuals and sound together; then parallel builders for the rest and the finale under the shoot budget.
5. Journey review, stills, OG, SEO; push; deploy when Pierre says.

## Verification
- `pnpm test` (physics core: chirp mass ≈ 30 M☉ from GW150914's f(t); +/× pattern; 10 ms light-travel limit; data schema), `pnpm check`, `pnpm lint`, `pnpm build`.
- Data checks: our whitened H1 signal correlates with GWOSC's published reconstruction; peak SNR ≈ 24; H1–L1 offset ≈ 7 ms.
- Browser: sound/visual sync check (adapted audio-check: the waveform playhead and flashes within one frame of the audio); finale check (select events, chirp plays, parameters match the catalogue).
- Contact-sheet journey review desktop + phone; WebGL2 fallback; production headers under wrangler dev.
