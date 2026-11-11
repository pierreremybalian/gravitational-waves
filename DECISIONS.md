# Decisions

Deviations from HANDOFF.md, newest last.

## 2026-11-10 — Foundation (phases 1–3)

### Bootstrap
- Removed Cross Rhythm's `src/rhythm/`, `src/shared/rhythm/`, `src/shared/brass/` (machine look) and the sequencer/conductor music path. Kept `brass/lines.ts` as `src/shared/gfx/glow.ts` (glow line + glow points). Palette: layer colours replaced by detector colours (`DET`, CSS `--color-h1/l1/v1/k1`).
- Statuses are `measured | established | modelled | metaphor` (`src/time/stages.ts`, CSS `--color-st-*`, `STATUS_HELP` in `src/data/site.ts`).
- Stage ids: `sound, fabric, ripples, binary, inspiral, merger, scale, interferometer, noise, finding, detectors, results, catalogue`.

### Transport (sound and picture on one clock)
- `src/audio/schedule.ts` (pure, tested) places clip instances on transport time; `src/audio/transport.ts` keeps Cross Rhythm's AudibleClock / silent-vs-audio offsets / iOS unlock / visibility handling and turns instances into `AudioBufferSourceNode`s. Scenes read `ctx.chirp` (`ChirpFrame`) and the `uChirp*` uniforms.
- Requests from the scroll never cut a playing chirp (the next clip waits for the current one to end); `transport.play()` cuts (20 ms fade) for buttons. Hiding the tab cuts the clip in the schedule too, so picture and sound agree on return.
- Late buffers join part-way rather than being dropped (all story clips are preloaded when sound turns on, so this should not happen; audio-check asserts 0 late starts).
- Catalogue snippets (2048 Hz int16) are upsampled ×8 in the browser by a Blackman-windowed sinc (`src/audio/resample.ts`) because `AudioBuffer` sample rates below 8000 Hz are not guaranteed.

### GW150914 data (`scripts/fetch-gwosc.py` → `public/data/gw150914/`, `src/data/gw150914.json`)
Sources (GWOSC, CC BY 4.0): 32 s H1/L1 strain at 4096 Hz from the GWTC-1-confident v3 release (`H-H1_GWOSC_4KHZ_R1-1126259447-32.hdf5`, `L-L1_…`); the tutorial best-fit template `GW150914_4_template.hdf5` (SEOBNRv2, detector-frame m1 = 41.74, m2 = 29.24 M☉, χ1 = 0.355, χ2 = −0.769); `GW150914_4_NR_waveform.txt`; PRL 116, 061102 Fig. 1/2 data (`P150914/fig1-*.txt`, `fig2-unfiltered-waveform-H.txt`).

Processing: Welch PSD (4 s Hann, 50 % overlap, median) over the 32 s; whitening by the ASD (Tukey α = 1/8); zero-phase 4th-order Butterworth band-pass 35–350 Hz; normalised by the noise σ measured 2–12 s into the file. Matched filter as in GWOSC's tutorial (complex template h+ + i h×, 20–1800 Hz). **t = 0 is the H1 merger, defined as the best-fit template's peak amplitude at the H1 matched-filter peak: GPS 1126259462.4237.** All windowed series run t ∈ [−2.0, +1.0] s at 4096 Hz.

Results:
| Check | Value |
|---|---|
| Matched-filter SNR H1 / L1 / network | 19.51 / 13.71 / **23.85** (PRL: 24) |
| H1–L1 offset (SNR peaks) | **L1 first by 7.09 ms** (xcorr of whitened data: 7.28 ms); PRL: ~7 ms |
| Sign | **L1 inverted** (xcorr −0.61 at the lag) |
| Whitened H1 vs PRL Fig. 1 observed H1 | 0.959 |
| Whitened L1 vs PRL Fig. 1 observed L1 | 0.932 |
| Band-passed + notched H1 vs PRL Fig. 1 observed H1 | 0.991 |
| **Whitened H1 data vs PRL Fig. 1 numerical-relativity waveform (published reconstruction)** | **0.828** |
| Our best-fit template (band-passed) vs PRL Fig. 1 NR waveform | 0.976 |
| Whitened H1 / L1 data vs whitened best-fit template (−0.3…+0.05 s) | 0.804 / 0.715 |
| Best-fit template peak strain at H1 | 1.08 × 10⁻²¹ (PRL Fig. 2 NR: 1.23 × 10⁻²¹; PRL text: 1.0 × 10⁻²¹) |

- Band-passed L1 vs PRL observed L1 is only 0.53: Livingston has more strong lines in band than the six we notch (34.7, 35.3, 60, 120, 180, 331.3 Hz). The whitened series (what we show and play) matches at 0.93, so the notch list was not pursued further; `bandpass-L1` is labelled as "PRL style" only.
- The PRL Fig. 1 files are published with times relative to GPS 1126259462 at 16384 Hz; compared by interpolation onto them.
- `template-freq` / `template-phase` come from the phase of h+ + i h× of the best-fit template (exact quadrature, no Hilbert estimate); after the ringdown (amplitude < 2 % of peak) the frequency is held.

Chirp audio (16384 Hz, 16-bit WAV, 2.000 s, t ∈ [−1.5, +0.5] s, 80 ms fades, normalised to 0.89 peak): `chirp-H1`, `chirp-L1` (on H1's clock, so L1's merger is heard 7 ms earlier, not inverted), `chirp-H1-x4` and `chirp-template-x4` (pitch ×4: the analytic signal's phase is multiplied by 4 — every frequency ×4, envelope and timing unchanged — then band-passed 140–1400 Hz; exact for a single chirping tone; noise becomes noise four times higher), `chirp-template` (modelled, no noise). audio-check confirms each clip is loudest within 1 ms of where its metadata puts the merger (L1: −8 ms, as it should be).

### Physics core (`src/gw/`)
- Chirp mass test: the Newtonian fit of f^(−8/3) vs t over the template's frequency track 1.0–0.2 s before the merger (17–29 Hz) gives 𝓜 ≈ 32 M☉ (detector frame), vs 30.3 for the template's own masses and 28.6 × 1.09 = 31.2 from the catalogue. Closer to the merger the Newtonian law overestimates (34–36 M☉ at 35–66 Hz), as expected. Zero crossings of the noisy whitened data alone do not give a usable f(t), so the "measured" track is the template fitted to the data.
- "1/1000 of a proton": each arm changes by hL/2 = 2.0 × 10⁻¹⁸ m for h = 10⁻²¹ on 3995 m, 1/840 of the proton's diameter (CODATA 2022 radius 0.84075 fm). `armChange` (per arm) and `armDifference` (hL, what the interferometer reads) are both exported; stages must say which they show.
- Hanford–Livingston light travel time 10.01 ms from the LALSuite vertex coordinates (ECEF).
- `binary.ts`: Kepler separation from the template's f(t); in the last 12 ms (`PLUNGE`) the separation is eased to zero and from t = 0 the bodies are merged. The plunge easing is a drawing choice (stage 6 is labelled modelled).

### Catalogue (`scripts/fetch-catalog.py` → `public/data/events.json`, `public/data/events/*.bin`)
- Source: GWOSC's cumulative confident catalogue `https://gwosc.org/eventapi/json/GWTC/` (latest version of each event): **391 events** (GWTC-1-confident 1, GWTC-2.1-confident 54, GWTC-3-confident 35, GWTC-4.1 140, GWTC-5.0 161), 14 Sep 2015 – 20 Jan 2025. HANDOFF said "GWTC-1…GWTC-4 as available"; GWTC-5.0 is now published, so it is included.
- **109 events (GWTC-4.1: 52, GWTC-5.0: 57) have no published masses or distance** (only SNR, FAR, p_astro ≥ 0.5): kept with nulls (`type: null`); the finale must show them as "candidate, parameters not published" or filter them. 282 events have parameters.
- Type from median source-frame component masses against 3 M☉: 273 BBH, 7 NSBH, 2 BNS (GW170817, GW190425); `typeAmbiguous` when a 90 % interval crosses 3 M☉ (GW190917_114630, GW200210_092254, GW230529_181500). GW190814 (23 + 2.6 M☉) counts as NSBH by this rule although its light component's nature is unknown.
- Intervals are `[median, lower, upper]` (90 % credible bounds, i.e. median + published `_lower`/`_upper` offsets); a bare number where no interval is published (e.g. some SNRs).
- `detectors` lists detectors with open strain around the event (can include G1 = GEO600 for GW170817; no palette colour for it yet).
- Snippets: one file per event, int16 per detector at 2048 Hz, whitened (4 s median Welch over 32 s), band-passed **30–350 Hz** (35 Hz for the story; a little lower here for heavy events like GW190521), in units of the noise σ; window **[−1.75, +0.25] s** around the catalogue GPS time for BBH / unknown, **[−3.5, +0.5] s** for BNS/NSBH. The catalogue GPS is rounded to 0.1 s and is the geocentre time, so a snippet's merger can sit up to ~60 ms from its t = 0. For most events the chirp is not audible above the whitened noise (SNR ~ 8–15): that is honest, and the finale's "model waveform" should carry the sound where the data cannot.
- O4 events (GWTC-4.1/5.0) have only 4096 s bulk files (~100 MB each): 32 s are read out of them with HTTP range requests through h5py (`scripts/rangefile.py`, ~2.4 MB per detector). Processes, not threads: h5py serialises calls behind one lock.
- Result: 389 of 391 events have snippets (GW240414_054515 and GW240622_004008: no usable data window, NaN gaps); 30 detector snippets missing in total. **Snippets 7.81 MB + events.json 235 KB; all of public/data 8.8 MB.**

### Not done in this phase
- `src/gw/filter.ts` (reference whitening / matched filter for small arrays, HANDOFF Physics core) is not written yet; the heavy processing lives in the Python scripts.
- Sky map (GWOSC FITS → band) for stage 11 not fetched yet.

## Stages 1–7 (2026-11-10)
- Stages 4–6 play the best-fit model slowed with its pitch kept, built in the browser from the template's frequency/phase/amplitude tracks: 4 = −1.5…−0.6 s ×10 slower, pitch ×8; 5 = −0.6…+0.03 s ×12, pitch ×4; 6 = −35…+30 ms ×60, pitch ×4. Clips are registered on the transport at their slow rate, so `ctx.chirp.t` is data time and orbit, waves and sound share one clock. Stated in each stage note.
- Stage 4 draws the outgoing waves at a quarter of light speed so the spiral fits the view (stated).
- Masses are source-frame from events.json (34.6 + 30.0 → 61.5 M☉, 3.1 M☉ radiated); stage 1/5 readouts that quote detector-frame values say so.

## 2026-11-10 — Stages 8–13 and the catalogue finale

- Kit `src/shared/detector/`: `interferometer.ts`, `globe.ts` (Natural Earth 110m coastlines, public domain, copied to `public/data/geo/`), `ridges.ts` + `landscape.ts` + `noisefield.ts` (noise landscape), `beads.ts`, `spectro.ts` (FFT, whitening, short-time spectra; tested), `trace.ts`, `stats.ts`, `clips.ts`.
- Numbers quoted by the pure stage scripts come from `src/data/detector-stats.json` and `src/data/results.json`, written by `node scripts/detector-stats.ts` from `public/data`; a test fails if they go stale.
- Stage 8: the arms are driven by the best-fit template at Hanford on the clip `chirp-template`; mirror motion ×8.3 × 10¹⁹, swing slowed 12× (phase ÷ 12) because 35–250 Hz cannot be drawn at 60 fps; both stated.
- Stage 9 plays the raw Hanford strain as a clip (`raw-H1`, defined at run time from `raw-H1.f32`, t0 −1.5 s, nothing filtered): mostly below hearing, which is the point.
- Noise landscape: the raw terrain is ASD(f)·|W(t,f)| (whitened short-time spectrum with the ASD multiplied back), not a direct STFT of the raw strain, which leaks the <10 Hz motion everywhere. The whitened terrain is also divided by each frequency's median power over the 3 s (the 32 s ASD does not flatten 3 s exactly).
- Stage 10's SNR pen reads `snr-net` at the template's offset (one best-fit template, not a bank); locks at 23.85.
- Stage 11: the sky ring is cos θ = 7.09/10.01 about the H1→L1 axis; the highlighted arc is its part below −14.5° declination (where the published map lies); the wavefront comes from the ring's southernmost point, a drawing choice.
- Stage 12 shows the catalogue values (GWTC-2.1: 34.6 + 30.0 → 61.5, 470 Mpc) beside the 2016 PRL values (36 + 29 → 62, 410 Mpc); the HANDOFF numbers are the latter.
- Finale: `src/finale/` (layout, state, model chirp, UI). Model chirp = Newtonian inspiral to ISCO + Berti et al. ringdown at spin 0.69 (none for BNS), labelled modelled. Selecting an event autoplays its first detector's data; the status chip switches to modelled while the model plays. `<Finale />` added to `src/pages/index.astro`. `node scripts/finale-check.ts` checks card values against events.json, playback, keyboard, filters, phone layout.
