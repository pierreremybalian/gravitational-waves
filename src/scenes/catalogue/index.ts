// Stage 13 · The catalogue (finale). Every event GWOSC lists as luminous beads: per event a vertical stem from the
// lighter body to the heavier, the remnant on top (height = log mass), coloured by kind; candidates without
// published parameters as hollow beads on the floor. Two arrangements (src/finale/layout.ts): a spiral of discovery,
// or mass against distance. The intro scroll lays the events out in order of discovery; then the finale UI
// (src/finale/ui) drives the view, filters and selection. The selected event gets a ring, a small binary above its
// remnant turning with its model chirp (src/finale/model.ts) on the transport clock, and a strip of its whitened
// data per detector (and the model when that plays) with a playhead locked to what is heard.

import { Group, PerspectiveCamera, Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { createBeads, type Beads } from '../../shared/detector/beads.ts';
import { sampleSeries, tracePoints } from '../../shared/detector/trace.ts';
import { createLines, type LineSpec, type Lines } from '../../shared/gfx/lines.ts';
import { createGlowLine, createGlowPoints, type GlowLine, type GlowPoints } from '../../shared/gfx/glow.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { detColour, PAL, type RGB } from '../../shared/gfx/palette.ts';
import { loadCatalog, median, type CatalogEvent } from '../../shared/gwdata.ts';
import { binaryAt, createBinaryState, type Track } from '../../gw/binary.ts';
import { $reducedMotion } from '../../state/store.ts';
import { smoothstep } from '../../shared/math.ts';
import { DIST_WIDTH, FLOOR, MASS_HEIGHT, distX, massY, placeEvents, spiralAt, SPIRAL_R1, type Placed } from '../../finale/layout.ts';
import { $events, $filters, $free, $hover, $orbit, $playing, $selected, $toolOn, $view, bridge, kindOf, type Kind, type Selected } from '../../finale/state.ts';
import { CAT, TOOL_AT } from '../../script/catalogue.ts';

const KIND_RGB: Record<Kind, RGB> = {
  BBH: [1.0, 0.74, 0.46],
  NSBH: [0.42, 1.0, 0.72],
  BNS: [0.72, 0.56, 1.0],
  candidate: [0.5, 0.56, 0.72],
};
const REMNANT: RGB = [1.0, 0.94, 0.86];
const MASS_MARKS = [1, 3, 10, 30, 100] as const;
const DIST_MARKS = [100, 1000, 10000] as const;
const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
/** GPS seconds at 00:00 UTC on 1 January of a year (18 leap seconds since 1980 for these years). */
const gpsOfYear = (y: number) => Date.UTC(y, 0, 1) / 1000 - 315964800 + (y >= 2017 ? 18 : 17);

const params = {
  fov: 30,
  dist: { time: 12.2, distance: 10.4 },
  el: { time: 0.46, distance: 0.14 },
  target: { time: [0, 1.0, 0] as const, distance: [0.4, 1.05, 0] as const },
  stripDepth: 6,
};

export default function catalogueScene(): BlockScene {
  let renderer: WebGPURenderer;
  let ctx: RenderContext;
  const scene = new Scene();
  const camera = new PerspectiveCamera(params.fov, 16 / 9, 0.05, 200);
  scene.add(camera);
  let events: CatalogEvent[] = [];
  let placed: Placed[] = [];
  let beads: Beads;
  let stems: Lines;
  let stemOf: Int32Array = new Int32Array(0);
  let guides: Lines;
  let nGuideTime = 0;
  let binA: GlowLine;
  let binB: GlowLine;
  const strip = new Group();
  camera.add(strip);
  let stripLines: Lines | null = null;
  let stripDets: string[] = [];
  let stripData: Float32Array[] = [];
  let stripModel = -1;
  let stripT0 = 0;
  let stripFs = 2048;
  let heads: GlowPoints;
  let W = 1280;
  let H = 720;
  let mixV = 0;
  let stripLift = 0;
  let az = 0.6;
  let rev = 0;
  let selIdx = -1;
  let selModelTrack: Track | null = null;
  let selMasses = { m1: 30, m2: 30, mf: 57 };
  let a0 = 1;
  const bs = createBinaryState();
  const v = new Vector3();
  const tgt = new Vector3();
  const unsubs: (() => void)[] = [];
  const NMAX = 400;
  const labels = new LabelSet([
    ...MASS_MARKS.map((m) => ({ id: `m${m}`, text: `${m} M☉`, tone: 'mute' as const, side: 'right' as const, size: 'sm' as const, keepCase: true })),
    ...DIST_MARKS.map((d) => ({ id: `d${d}`, text: d >= 1000 ? `${d / 1000} Gpc` : `${d} Mpc`, tone: 'mute' as const, side: 'below' as const, size: 'sm' as const, keepCase: true })),
    ...YEARS.map((y) => ({ id: `y${y}`, text: String(y), tone: 'mute' as const, side: 'center' as const, size: 'sm' as const })),
    { id: 'ns', text: 'Neutron-star masses below ~3 M☉', tone: 'light', side: 'right', size: 'sm' },
    { id: 'cand', text: 'Candidates: parameters not yet published', tone: 'mute', side: 'below', size: 'sm' },
    { id: 'sel', text: '', tone: 'event', side: 'right', size: 'md' },
    { id: 'hover', text: '', tone: 'plain', side: 'above', size: 'sm' },
    { id: 's0', text: '', tone: 'a', side: 'right', size: 'sm' },
    { id: 's1', text: '', tone: 'b', side: 'right', size: 'sm' },
    { id: 's2', text: '', tone: 'light', side: 'right', size: 'sm' },
    { id: 's3', text: '', tone: 'mute', side: 'right', size: 'sm' },
    { id: 's4', text: 'Model chirp (modelled)', tone: 'plain', side: 'right', size: 'sm' },
  ]);
  const LM = MASS_MARKS.map((m) => labels.index(`m${m}`));
  const LD = DIST_MARKS.map((d) => labels.index(`d${d}`));
  const LY = YEARS.map((y) => labels.index(`y${y}`));
  const LNS = labels.index('ns');
  const LC = labels.index('cand');
  const LSEL = labels.index('sel');
  const LHOV = labels.index('hover');
  const LS = [0, 1, 2, 3, 4].map((k) => labels.index(`s${k}`));
  let yearU: number[] = [];
  let candU = 0;

  /** Camera centred in the free rect (the panel takes the rest). */
  function frame() {
    const r = $free.get();
    const pw = Math.max(1, r.w * W);
    const ph = Math.max(1, r.h * H);
    camera.aspect = pw / ph;
    camera.setViewOffset(pw, ph, -r.x * W, -r.y * H, W, H);
    camera.updateProjectionMatrix();
  }

  function pos(i: number, out: Vector3, which: 'f' | '1' | '2'): Vector3 {
    const p = placed[i]!;
    const x = p.time[0] + (p.dist[0] - p.time[0]) * mixV;
    const z = p.time[1] + (p.dist[1] - p.time[1]) * mixV;
    return out.set(x, which === 'f' ? p.yf : which === '1' ? p.y1 : p.y2, z);
  }

  function buildStrip(sel: Selected | null) {
    if (stripLines) {
      strip.remove(stripLines.mesh);
      stripLines.dispose();
      stripLines = null;
    }
    stripDets = [];
    stripData = [];
    stripModel = -1;
    if (!sel) return;
    const ev = events[sel.index]!;
    const specs: LineSpec[] = [];
    const sn = ev.snippet;
    if (sel.snippets && sn) {
      stripT0 = sn.t0;
      stripFs = sn.fs;
      for (const d of sn.detectors) {
        const arr = sel.snippets[d];
        if (!arr) continue;
        stripDets.push(d);
        stripData.push(arr);
        specs.push({ points: tracePoints(arr, sn.t0, sn.fs, sn.t0, sn.t0 + sn.n / sn.fs, 1, 2), colour: detColour(d), width: 1.1, intensity: 0.75 });
      }
    }
    if (sel.model) {
      const m = sel.model;
      stripModel = specs.length;
      specs.push({ points: tracePoints(m.h, m.t0, m.fs, m.t0, m.t0 + m.h.length / m.fs, 1, 2), colour: PAL.both, width: 1.3, intensity: 0.9 });
    }
    if (!specs.length) return;
    stripLines = createLines(specs, { resolution: ctx.globals.uResolution });
    strip.add(stripLines.mesh);
  }

  function onSelect(sel: Selected | null) {
    selIdx = sel ? sel.index : -1;
    selModelTrack = null;
    if (sel?.model) {
      const m = sel.model;
      selModelTrack = { t0: m.t0, fs: m.fs, f: m.f, phase: m.phase, amp: m.amp };
      const e = events[sel.index]!;
      const z = 1 + (median(e.redshift) ?? 0);
      selMasses = { m1: (median(e.m1) ?? 30) * z, m2: (median(e.m2) ?? 30) * z, mf: (median(e.mFinal) ?? 57) * z };
      binaryAt(selModelTrack, selMasses, m.t0, bs);
      a0 = bs.a || 1;
    }
    buildStrip(sel);
    labels.setText(LSEL, sel ? events[sel.index]!.name : '');
    rev++;
  }

  const self: BlockScene = {
    id: 'catalogue',
    status: 'measured',
    statusNote: 'Measured: GWOSC’s catalogue (published medians); hollow beads are candidates whose parameters are not yet published. Model chirps are labelled modelled.',
    labels,
    revision: () => rev,
    async init(c: RenderContext) {
      ctx = c;
      renderer = c.renderer;
      const cat = await loadCatalog();
      events = cat.events.slice(0, NMAX);
      placed = placeEvents(events);
      if (!$events.get().length) $events.set(cat.events);
      const n = events.length;
      beads = createBeads(n * 3 + 2, { intensity: 0.5, minSize: 0.0024 });
      events.forEach((e, i) => {
        const k = KIND_RGB[kindOf(e)];
        beads.colour(i * 3, k[0], k[1], k[2]);
        beads.colour(i * 3 + 1, k[0], k[1], k[2]);
        beads.colour(i * 3 + 2, REMNANT[0], REMNANT[1], REMNANT[2]);
      });
      beads.colour(n * 3, 1, 1, 1);
      beads.colour(n * 3 + 1, 1, 0.9, 0.7);
      scene.add(beads.mesh);
      // Stems (events with masses): from the lighter body to the remnant.
      const specs: LineSpec[] = [];
      stemOf = new Int32Array(n).fill(-1);
      placed.forEach((p, i) => {
        if (!p.hasMass) return;
        stemOf[i] = specs.length;
        specs.push({ points: Float32Array.from([0, p.y2, 0, Math.max(p.yf, p.y1)]), colour: KIND_RGB[kindOf(events[i]!)], width: 1.0, intensity: 0.32 });
      });
      stems = createLines(specs, { resolution: c.globals.uResolution });
      scene.add(stems.mesh);
      // Guides: mass rings (time view), the discovery spiral on the floor, mass lines and distance ticks (distance view).
      const g: LineSpec[] = [];
      for (const m of MASS_MARKS) {
        const y = massY(m);
        const pts = new Float32Array(97 * 3);
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 2;
          pts.set([Math.cos(a) * (SPIRAL_R1 + 0.35), y, Math.sin(a) * (SPIRAL_R1 + 0.35)], k * 3);
        }
        g.push({ points: pts, dims: 3, colour: m === 3 ? KIND_RGB.BNS : PAL.edge, width: 0.9, intensity: m === 3 ? 0.32 : 0.18, dash: m === 3 ? 0.08 : 0 });
      }
      {
        const pts = new Float32Array(241 * 3);
        for (let k = 0; k <= 240; k++) {
          const [x, z] = spiralAt(k / 240);
          pts.set([x, FLOOR - 0.04, z], k * 3);
        }
        g.push({ points: pts, dims: 3, colour: PAL.edge, width: 1.0, intensity: 0.28 });
      }
      nGuideTime = g.length;
      for (const m of MASS_MARKS) {
        const y = massY(m);
        g.push({ points: Float32Array.from([-DIST_WIDTH / 2, y, -1.5, DIST_WIDTH / 2, y, -1.5]), dims: 3, colour: m === 3 ? KIND_RGB.BNS : PAL.edge, width: 1.0, intensity: m === 3 ? 0.45 : 0.3, dash: m === 3 ? 0.08 : 0 });
      }
      for (const d of DIST_MARKS) {
        const x = distX(d);
        g.push({ points: Float32Array.from([x, FLOOR, -1.5, x, MASS_HEIGHT, -1.5]), dims: 3, colour: PAL.edge, width: 1.0, intensity: 0.25 });
      }
      guides = createLines(g, { resolution: c.globals.uResolution });
      scene.add(guides.mesh);
      // The selected event's binary.
      binA = createGlowLine(49, KIND_RGB.BBH, { width: 0.006, intensity: 0 });
      binB = createGlowLine(49, KIND_RGB.BBH, { width: 0.006, intensity: 0 });
      scene.add(binA.mesh, binB.mesh);
      heads = createGlowPoints(6, PAL.both, { radius: 0.02, intensity: 2.2 });
      strip.add(heads.mesh);
      // Year marks along the spiral.
      const g0 = events[0]!.gps;
      const g1 = events[events.length - 1]!.gps;
      yearU = YEARS.map((y) => (gpsOfYear(y) - g0) / (g1 - g0));
      const firstCand = events.findIndex((e) => e.type === null);
      candU = firstCand >= 0 ? placed[firstCand]!.u : 1;
      bridge.pick = (fx, fy) => {
        let best = -1;
        let bd = 0.03 * 0.03;
        const fl = $filters.get();
        const aspect = W / H;
        for (let i = 0; i < events.length; i++) {
          if (!fl[kindOf(events[i]!)]) continue;
          for (const w of ['f', '1'] as const) {
            pos(i, v, w).project(camera);
            const dx = ((v.x + 1) / 2 - fx) * aspect;
            const dy = (1 - v.y) / 2 - fy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) {
              bd = d2;
              best = i;
            }
          }
        }
        return best;
      };
      unsubs.push($selected.subscribe((s) => onSelect(s)));
      unsubs.push($free.subscribe(() => frame()));
      unsubs.push($hover.subscribe((h) => labels.setText(LHOV, h >= 0 ? events[h]?.name ?? '' : '')));
      unsubs.push($filters.subscribe(() => rev++));
      unsubs.push($view.subscribe(() => rev++));
      unsubs.push($orbit.subscribe(() => rev++));
      await renderer.compileAsync(scene, camera);
    },
    update(local: number, dt: number, elapsed: number) {
      const reduced = $reducedMotion.get();
      const tool = $toolOn.get() || local >= TOOL_AT;
      const n = events.length;
      // View blend (eased toward the chosen view).
      const want = $view.get() === 'distance' ? 1 : 0;
      mixV += (want - mixV) * Math.min(1, (reduced ? 1 : 3.5) * Math.min(dt, 0.1));
      if (Math.abs(want - mixV) < 1e-3) mixV = want;
      else rev++;
      const mv = smoothstep(0, 1, mixV);
      // Intro: events appear in order of discovery.
      const appear = tool ? 1.01 : CAT.appear(local);
      const fl = $filters.get();
      const sel = selIdx;
      for (let i = 0; i < n; i++) {
        const p = placed[i]!;
        const e = events[i]!;
        const k = kindOf(e);
        const shown = (fl[k] ? 1 : 0.05) * smoothstep(p.u - 0.02, p.u + 0.01, appear);
        const isSel = i === sel ? 1 : 0;
        const dim = sel >= 0 && !isSel ? 0.75 : 1;
        const m1 = median(e.m1) ?? 1;
        const m2 = median(e.m2) ?? 1;
        const mf = median(e.mFinal) ?? m1 + m2;
        const x = p.time[0] + (p.dist[0] - p.time[0]) * mv;
        const z = p.time[1] + (p.dist[1] - p.time[1]) * mv;
        if (p.hasMass) {
          beads.set(i * 3, x, p.y1, z, 0.008 + 0.0045 * Math.cbrt(m1), shown * dim * (0.8 + isSel));
          beads.set(i * 3 + 1, x, p.y2, z, 0.008 + 0.0045 * Math.cbrt(m2), shown * dim * (0.8 + isSel));
          beads.set(i * 3 + 2, x, p.yf, z, 0.01 + 0.005 * Math.cbrt(mf), shown * dim * (0.9 + 1.5 * isSel));
          const st = stems.state[stemOf[i]!]!;
          st.x = x;
          st.z = z;
          st.intensity = shown * dim;
          st.highlight = isSel;
        } else {
          beads.set(i * 3, x, FLOOR, z, 0.022, shown * 0.8 * (1 + isSel), 1);
          beads.set(i * 3 + 1, 0, 0, 0, 0, 0);
          beads.set(i * 3 + 2, 0, 0, 0, 0, 0);
        }
      }
      // Selection ring and hover bead.
      if (sel >= 0) {
        pos(sel, v, placed[sel]!.hasMass ? 'f' : '1');
        beads.set(n * 3, v.x, v.y, v.z, 0.09, 1.4, 1);
      } else beads.set(n * 3, 0, 0, 0, 0, 0);
      const hv = $hover.get();
      if (hv >= 0 && hv !== sel) {
        pos(hv, v, placed[hv]!.hasMass ? 'f' : '1');
        beads.set(n * 3 + 1, v.x, v.y, v.z, 0.06, 0.9, 1);
      } else beads.set(n * 3 + 1, 0, 0, 0, 0, 0);
      beads.commit();
      stems.commit();
      const gi = smoothstep(0.1, 0.24, local) * (tool ? 1 : 1);
      for (let k = 0; k < guides.state.length; k++) guides.state[k]!.intensity = gi * (k < nGuideTime ? 1 - mv : mv);
      guides.commit();

      // ── The selected event's binary, on the clock of whatever of it plays ──
      const ch = ctx.chirp;
      const pl = $playing.get();
      const mine = pl !== null && sel >= 0 && pl.name === events[sel]!.name && ch.clip === pl.clip;
      let binOn = 0;
      if (sel >= 0 && selModelTrack) {
        binOn = 1;
        const t = mine ? Math.min(ch.t, selModelTrack.t0 + selModelTrack.f.length / selModelTrack.fs) : selModelTrack.t0;
        binaryAt(selModelTrack, selMasses, Math.min(t, 0), bs);
        pos(sel, tgt, 'f');
        tgt.y += 0.42;
        const sep = 0.32 * Math.sqrt(bs.a / a0);
        const M = selMasses.m1 + selMasses.m2;
        const c = Math.cos(bs.orbitPhase);
        const s = Math.sin(bs.orbitPhase);
        const merged = t >= 0;
        const ra = 0.05 * Math.cbrt(selMasses.m1 / 30);
        const rb = 0.05 * Math.cbrt(selMasses.m2 / 30);
        const rf = 0.05 * Math.cbrt(selMasses.mf / 30) * (1 + (merged ? 0.25 * bs.amp * Math.sin(t * 900) : 0));
        const xa = merged ? 0 : (sep * selMasses.m2) / M;
        const xb = merged ? 0 : (-sep * selMasses.m1) / M;
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          binA.set(k, tgt.x + xa * c + ca * (merged ? rf : ra), tgt.y, tgt.z + xa * s + sa * (merged ? rf : ra));
          binB.set(k, tgt.x + xb * c + ca * rb, tgt.y, tgt.z + xb * s + sa * rb);
        }
        binA.commit(49);
        binB.commit(merged ? 0 : 49);
      }
      binA.intensity.value = 2.0 * binOn;
      binB.intensity.value = 2.0 * binOn;

      // ── Camera ──
      const o = $orbit.get();
      if (!reduced && !$selected.get()) az += dt * 0.04;
      // The spiral turns slowly until something is selected; the distance view faces the mass–distance plane.
      const azNow = (1 - mv) * (az + o.az) + mv * o.az * 0.6;
      const el = (params.el.time + (params.el.distance - params.el.time) * mv) + o.el;
      const dist = (params.dist.time + (params.dist.distance - params.dist.time) * mv) * (camera.aspect < 1 ? 1.25 : 1);
      tgt.set(
        params.target.time[0] + (params.target.distance[0] - params.target.time[0]) * mv,
        params.target.time[1] + (params.target.distance[1] - params.target.time[1]) * mv,
        params.target.time[2] + (params.target.distance[2] - params.target.time[2]) * mv,
      );
      // Room for the strip under the view when an event is shown.
      stripLift += ((sel >= 0 && stripLines ? 1 : 0) - stripLift) * Math.min(1, 4 * Math.min(dt, 0.1));
      tgt.y -= 0.75 * stripLift;
      const ce = Math.cos(el);
      camera.position.set(tgt.x + dist * ce * Math.sin(azNow), tgt.y + dist * Math.sin(el), tgt.z + dist * ce * Math.cos(azNow));
      camera.lookAt(tgt);
      camera.updateMatrixWorld();
      void elapsed;

      // ── Strip (camera-fixed, bottom of the free view) ──
      strip.position.set(0, 0, -params.stripDepth);
      strip.visible = tool && sel >= 0 && stripLines !== null;
      strip.updateMatrixWorld();
      const half = params.stripDepth * Math.tan((params.fov * Math.PI) / 360);
      const halfW = half * camera.aspect;
      const rows = stripDets.length + (stripModel >= 0 ? 1 : 0);
      const sw = halfW * 1.5;
      const showStrip = tool && sel >= 0 && stripLines ? 1 : 0;
      if (stripLines) {
        const ev = events[sel]!;
        const span = ev.snippet ? ev.snippet.n / ev.snippet.fs : 2;
        const sx = sw / span;
        const x0 = -sw / 2 - sx * (ev.snippet?.t0 ?? -1.75);
        const rowH = Math.min(0.17, (half * 0.34) / Math.max(1, rows));
        const yTop = -half * 0.6;
        for (let r = 0; r < stripLines.state.length; r++) {
          const s = stripLines.state[r]!;
          s.x = x0;
          s.y = yTop - r * rowH;
          s.sx = sx;
          s.sy = r === stripModel ? rowH * 0.42 : rowH * 0.06;
          s.z = 0;
          const playingThis = mine && ((pl!.kind === 'model' && r === stripModel) || (pl!.kind === 'data' && stripDets[r] === pl!.det));
          s.intensity = showStrip * (playingThis ? 1.2 : 0.55);
        }
        stripLines.commit();
        // Row names: detectors in order, then the model (label slot 4).
        for (let k = 0; k < 5; k++) labels.hide(LS[k]!);
        if (showStrip) {
          for (let r = 0; r < rows; r++) {
            const isModel = r === stripModel;
            const li = LS[isModel ? 4 : Math.min(r, 3)]!;
            if (!isModel) labels.setText(li, stripDets[r]!);
            v.set(-sw / 2 - 0.02, yTop - r * rowH + 0.06, 0);
            strip.localToWorld(v);
            labels.place(li, v.x, v.y, v.z, camera, 0.9);
          }
        }
        // Playhead on the row playing.
        for (let k = 0; k < 6; k++) heads.set(k, 0, 0, 0, 0);
        if (mine && ch.playing) {
          const isModel = pl!.kind === 'model';
          const r = isModel ? stripModel : stripDets.indexOf(pl!.det ?? '');
          if (r >= 0) {
            const m = $selected.get()?.model;
            const y = isModel ? (m ? rowH * 0.42 * sampleSeries(m.h, m.t0, m.fs, ch.t) : 0) : rowH * 0.06 * sampleSeries(stripData[r]!, stripT0, stripFs, ch.t);
            heads.set(0, x0 + sx * ch.t, yTop - r * rowH + y, 0, 1);
          }
        }
        heads.commit();
      } else {
        for (const l of LS) labels.hide(l);
      }

      // ── Labels ──
      const ax = gi * (tool ? 1 : 1);
      const R = SPIRAL_R1 + 0.35;
      // Mass marks on the near side of their rings (time view) or at the left of the lines (distance view).
      const camAz = Math.atan2(camera.position.x - tgt.x, camera.position.z - tgt.z) + 0.55;
      MASS_MARKS.forEach((m, k) => {
        const y = massY(m);
        const xt = Math.sin(camAz) * R;
        const zt = Math.cos(camAz) * R;
        const xd = DIST_WIDTH / 2 + 0.05;
        labels.place(LM[k]!, xt + (xd - xt) * mv, y, zt + (-1.5 - zt) * mv, camera, ax * 0.9);
      });
      DIST_MARKS.forEach((d, k) => labels.place(LD[k]!, distX(d), FLOOR, -1.5, camera, ax * mv));
      YEARS.forEach((y, k) => {
        const u = yearU[k]!;
        if (u < 0 || u > 1) return labels.hide(LY[k]!);
        const [x, z] = spiralAt(u);
        labels.place(LY[k]!, x, FLOOR - 0.12, z, camera, ax * (1 - mv) * 0.8);
      });
      labels.place(LNS, Math.sin(camAz) * R, massY(3), Math.cos(camAz) * R, camera, 0);
      const [cx, cz] = spiralAt(Math.min(1, candU + 0.02));
      labels.place(LC, cx + (DIST_WIDTH / 2 + 0.7 - cx) * mv, FLOOR - 0.1, cz + (-1.3 - cz) * mv, camera, ax * (fl.candidate ? 0.85 : 0) * (tool ? 1 : 0));
      if (sel >= 0) {
        pos(sel, v, placed[sel]!.hasMass ? 'f' : '1');
        labels.place(LSEL, v.x + 0.08, v.y, v.z, camera, 1);
      } else labels.hide(LSEL);
      if (hv >= 0 && hv !== sel) {
        pos(hv, v, placed[hv]!.hasMass ? 'f' : '1');
        labels.place(LHOV, v.x, v.y + 0.06, v.z, camera, 1);
      } else labels.hide(LHOV);
      if (mine && ch.playing) rev++;
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    resize(width: number, height: number) {
      W = width;
      H = height;
      frame();
    },
    dispose() {
      for (const u of unsubs) u();
      bridge.pick = null;
      beads?.dispose();
      stems?.dispose();
      guides?.dispose();
      binA?.dispose();
      binB?.dispose();
      heads?.dispose();
      stripLines?.dispose();
    },
  };
  return self;
}
