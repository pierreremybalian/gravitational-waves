# Gravitational Waves

Scroll-driven 3D explanation of gravitational waves and LIGO's first detection (GW150914), with the real chirp played as sound, ending in a catalogue of every confirmed merger. Astro 7, TypeScript strict, three.js r186 WebGPU + TSL (WebGL2 fallback), nanostores, Lenis, Web Audio. Infrastructure copied from Cross Rhythm (`../cross-rhythm`; rhythm-specific code is to be removed or adapted). Static output on Cloudflare Workers static assets at https://gravitational-waves.balian.dev (`pnpm run deploy`; deploy only when Pierre says). `HANDOFF.md` is the spec; `DECISIONS.md` logs deviations; `SCENES.md` is the scene guide (follow its efficiency rules for Playwright).

## Rules
- `src/gw/`, `src/time/`, `src/script/` are pure TypeScript (no DOM, three or Web Audio). Every number on screen comes from real data (GWOSC, CC BY 4.0) or the tested physics core; exaggerations (strain ×10²¹, time slowed) are uniforms and stated in the stage note.
- One clock: sound and picture read the same transport; never time the chirp with `elapsed`.
- Visuals and sound are built together from the first build (owner feedback on earlier demos).
- Scenes isolated (`src/scenes/<id>/`), share only `src/shared/`; no allocation in the frame loop; dispose everything; TSL gotchas as in SCENES.md. Text never in the canvas.
- Every *.balian.dev demo carries the Hire Me corner link.
- Public repo hygiene: author `Pierre Balian <967646+pierreremybalian@users.noreply.github.com>`; Cloudflare account ID only in the gitignored `.env`.
