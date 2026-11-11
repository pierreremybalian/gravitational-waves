// The catalogue finale's HTML side (src/finale/ui/Finale.astro): view and filters, quick picks, search and stepping,
// the selected event's card (masses with 90% ranges, remnant, radiated, distance, date, detectors, significance) and
// its sound: by default the model chirp alone (modelled), trimmed to its audible part and loudness-matched, pitch ×4
// when it peaks below 120 Hz (src/finale/listen.ts); or the model over Hanford's whitened data, aligned to the data's
// merger (src/finale/overlay.ts), or each detector's data, cut to the same window; all played on the transport so
// the scene's strip and binary move with what is heard. Also the pointer and keyboard surface
// over the 3D view, the narration hand-off (readouts and the status chip) and the free area left for the view.

import { $stage } from '../../state/store.ts';
import { $sound } from '../../state/sound.ts';
import { transport } from '../../audio/transport.ts';
import { $statusOverride, refreshNarration } from '../../story/live.ts';
import { TOOL_AT, setCatalogueReadouts } from '../../script/catalogue.ts';
import type { Readout } from '../../script/index.ts';
import { eventClipId, loadCatalog, loadSnippet, median, type CatalogEvent, type Interval } from '../../shared/gwdata.ts';
import { mpcToLy } from '../../gw/units.ts';
import { modelChirp } from '../model.ts';
import { alignModel, mixOverlay, processModel, travelTime } from '../overlay.ts';
import { autoPitch, LISTEN, listenClip, listenModel, listenWindow, peakFrequency, trimTo } from '../listen.ts';
import { picks } from '../layout.ts';
import { $events, $filters, $free, $hover, $orbit, $playing, $selected, $toolOn, $view, bridge, kindOf, modelClipId, overlayClipId, type Kind, type Listen, type Overlay, type PlayKind } from '../state.ts';

const KIND_TEXT: Record<Kind, string> = {
  BBH: 'Two black holes',
  NSBH: 'Neutron star + black hole',
  BNS: 'Two neutron stars',
  candidate: 'Candidate',
};
const DET_NAME: Record<string, string> = { H1: 'Hanford', L1: 'Livingston', V1: 'Virgo', K1: 'KAGRA', G1: 'GEO600' };
const DET_ORDER = ['H1', 'L1', 'V1', 'K1', 'G1'];

const fmtDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/** As published (up to two decimals; whole numbers from 1000). */
function num(v: number, d?: number): string {
  const digits = d ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** "34.6 (32.0–39.0)" from [median, lower, upper]. */
function iv(v: Interval | null, unit = '', d?: number): string {
  if (v === null) return '—';
  if (typeof v === 'number') return `${num(v, d)}${unit}`;
  return `${num(v[0], d)}${unit} <small>(${num(v[1], d)}–${num(v[2], d)})</small>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Window (s around the catalogue time) for events without a model: their data are cut to it. */
const CAND_WINDOW: readonly [number, number] = [-1.0, 0.3];

export function initFinale(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const layer = q<HTMLElement>('[data-layer]');
  const scroller = q<HTMLElement>('[data-scroller]');
  const count = q<HTMLElement>('[data-count]');
  const input = q<HTMLInputElement>('[data-q]');
  const names = q<HTMLDataListElement>('[data-names]');
  const card = q<HTMLElement>('[data-card]');
  const el = {
    name: q<HTMLElement>('[data-name]'),
    kind: q<HTMLElement>('[data-kind]'),
    when: q<HTMLElement>('[data-when]'),
    facts: q<HTMLElement>('[data-facts]'),
    dets: q<HTMLElement>('[data-dets]'),
    playData: q<HTMLElement>('[data-play-data]'),
    playModel: q<HTMLButtonElement>('[data-play-model]'),
    playTrue: q<HTMLButtonElement>('[data-play-true]'),
    listen: q<HTMLElement>('[data-listen]'),
    playOverlay: q<HTMLButtonElement>('[data-play-overlay]'),
    stop: q<HTMLButtonElement>('[data-stop]'),
    hint: q<HTMLElement>('[data-sound-hint]'),
    soundOn: q<HTMLButtonElement>('[data-sound-on]'),
    note: q<HTMLElement>('[data-note]'),
    link: q<HTMLAnchorElement>('[data-link]'),
    sr: q<HTMLElement>('[data-sr]'),
  };
  const docEl = document.documentElement;
  const debug = new URLSearchParams(location.search).get('audiolog') === '1';
  let events: CatalogEvent[] = [];
  let quick: ReturnType<typeof picks> | null = null;
  const byName = new Map<string, number>();

  void loadCatalog().then((cat) => {
    events = cat.events;
    $events.set(events);
    events.forEach((e, i) => byName.set(e.name, i));
    quick = picks(events);
    const n: Record<Kind, number> = { BBH: 0, NSBH: 0, BNS: 0, candidate: 0 };
    for (const e of events) n[kindOf(e)]++;
    for (const k of Object.keys(n) as Kind[]) q<HTMLElement>(`[data-n="${k}"]`).textContent = String(n[k]);
    const first = events[0]!.utc.slice(0, 4);
    const last = events[events.length - 1]!.utc.slice(0, 4);
    count.textContent = `${events.length} events, ${first}–${last}, from GWOSC’s catalogue. Pick one to hear it.`;
    const frag = document.createDocumentFragment();
    for (const e of events) {
      const o = document.createElement('option');
      o.value = e.name;
      frag.appendChild(o);
    }
    names.appendChild(frag);
  });

  const engage = () => docEl.classList.add('finale-engaged');

  // ── View and filters ──
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      engage();
      $view.set(b.dataset.view as 'time' | 'distance');
    }),
  );
  $view.subscribe((v) => root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v))));
  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      engage();
      const k = b.dataset.filter as Kind;
      const f = { ...$filters.get(), [k]: !$filters.get()[k] };
      $filters.set(f);
    }),
  );
  $filters.subscribe((f) => root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(f[b.dataset.filter as Kind]))));

  // ── Selection ──
  const visible = (i: number) => $filters.get()[kindOf(events[i]!)];
  function step(dir: 1 | -1) {
    if (!events.length) return;
    const cur = $selected.get()?.index ?? (dir > 0 ? -1 : events.length);
    for (let k = 1; k <= events.length; k++) {
      const i = (cur + dir * k + events.length * 2) % events.length;
      if (visible(i)) return select(i);
    }
  }

  let seq = 0;
  async function select(i: number, autoplay = true) {
    const ev = events[i];
    if (!ev) return;
    engage();
    const my = ++seq;
    // Showing a filtered-out kind turns its filter back on.
    const k = kindOf(ev);
    if (!$filters.get()[k]) $filters.set({ ...$filters.get(), [k]: true });
    const m1 = median(ev.m1);
    const m2 = median(ev.m2);
    const params = m1 !== null && m2 !== null ? { m1, m2, mFinal: median(ev.mFinal), redshift: median(ev.redshift), bns: ev.type === 'BNS' } : null;
    const model = params ? modelChirp(params) : null;
    // The default sound: the model chirp alone, trimmed to its audible part, pitch ×4 when it peaks below 120 Hz
    // (src/finale/listen.ts). On its own clock (0 = the model's merger), so it plays at once.
    let listen: Listen | null = null;
    if (params) {
      const lm = listenModel(params, ev.type === 'BNS' || ev.type === 'NSBH');
      listen = { model: lm, win: listenWindow(lm), pitch: autoPitch(lm), peakF: peakFrequency(lm) };
      for (const k of listen.pitch === 1 ? [1] : [listen.pitch, 1]) {
        const id = modelClipId(ev.name, k);
        if (!transport.info(id)) transport.defineBuffer(id, listenClip(lm, listen.win, k), LISTEN.fs, listen.win.from);
      }
    }
    // The model processed like the data (whitened, band-passed), to find where its merger sits in the data.
    const processed = model ? processModel(model, ev.snippet?.fs ?? 2048) : null;
    $selected.set({ name: ev.name, index: i, snippets: null, model, processed, overlay: null, listen, shift: 0 });
    fillCard(ev, listen);
    input.value = ev.name;
    if (autoplay && listen) play(ev, 'model', null, listen.pitch);
    // Phones: bring the card into the sheet's view.
    if (innerWidth < 768) scroller.scrollTo({ top: card.offsetTop - 8, behavior: 'smooth' });
    let snippets: Record<string, Float32Array> = {};
    try {
      snippets = await loadSnippet(ev);
    } catch {
      snippets = {};
    }
    if (my !== seq) return;
    const s = ev.snippet;
    const dets = DET_ORDER.filter((d) => snippets[d]);
    let overlay: Overlay | null = null;
    let shift = 0;
    let mixed: Float32Array | null = null;
    if (processed && s && dets.length) {
      // Over Hanford where it has data: aligned to its merger with the other detectors as witnesses.
      const det = dets.includes('H1') ? 'H1' : dets[0]!;
      const others = dets.filter((d) => d !== det).map((d) => ({ data: snippets[d]!, travel: travelTime(det, d) }));
      const align = alignModel(snippets[det]!, s.t0, processed, others);
      const mix = mixOverlay(snippets[det]!, s.t0, s.fs, processed, align);
      overlay = { det, align, model: mix.model, t0: s.t0, fs: s.fs };
      shift = align.offset;
      mixed = mix.mix;
    }
    // Data and model-over-data clips cut to the listening window around the (aligned) merger: no dead space.
    const from = shift + (listen ? listen.win.from : CAND_WINDOW[0]);
    const to = shift + (listen ? listen.win.to : CAND_WINDOW[1]);
    const clips: Record<string, { t0: number; n: number }> = {};
    if (s)
      for (const d of dets) {
        const tr = trimTo(snippets[d]!, s.t0, s.fs, from, to);
        transport.defineSamples(eventClipId(ev.name, d), tr.data, s.fs, tr.t0);
        clips[d] = { t0: tr.t0, n: tr.data.length };
      }
    if (overlay && mixed && s) {
      const tr = trimTo(mixed, s.t0, s.fs, from, to);
      transport.defineSamples(overlayClipId(ev.name), tr.data, s.fs, tr.t0);
      if (debug)
        (window as unknown as { __finaleOverlay?: unknown }).__finaleOverlay = { name: ev.name, det: overlay.det, ...overlay.align, t0: s.t0, fs: s.fs, data: snippets[overlay.det], model: overlay.model, mix: mixed, tPeak: processed!.tPeak, from, to, clips };
    }
    $selected.set({ name: ev.name, index: i, snippets, model, processed, overlay, listen, shift });
    fillPlay(ev, snippets, overlay);
    if (autoplay && !listen && dets.length) play(ev, 'data', dets[0]!);
    else if (!listen) publish(ev, null);
  }

  function play(ev: CatalogEvent, kind: PlayKind, det: string | null, pitch = 1) {
    const clip = kind === 'model' ? modelClipId(ev.name, pitch) : kind === 'overlay' ? overlayClipId(ev.name) : eventClipId(ev.name, det!);
    transport.play(clip);
    $playing.set({ clip, name: ev.name, kind, det, pitch: kind === 'model' ? pitch : 1 });
    root.querySelectorAll<HTMLButtonElement>('[data-det]').forEach((b) => b.setAttribute('aria-pressed', String(kind === 'data' && b.dataset.det === det)));
    const def = $selected.get()?.listen?.pitch ?? 1;
    el.playModel.setAttribute('aria-pressed', String(kind === 'model' && pitch === def));
    el.playTrue.setAttribute('aria-pressed', String(kind === 'model' && pitch !== def));
    el.playOverlay.setAttribute('aria-pressed', String(kind === 'overlay'));
    publish(ev, kind);
    el.sr.textContent =
      kind === 'model'
        ? `Playing a model chirp for ${ev.name} (modelled)${pitch === 1 ? '' : `, pitch raised ×${pitch}`}.`
        : kind === 'overlay'
          ? `Playing a model chirp for ${ev.name} (modelled) over ${DET_NAME[det!] ?? det} data.`
          : `Playing ${ev.name}, ${DET_NAME[det!] ?? det} data.`;
  }

  function stop() {
    transport.stop();
    $playing.set(null);
    root.querySelectorAll<HTMLButtonElement>('[data-det]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    el.playModel.setAttribute('aria-pressed', 'false');
    el.playTrue.setAttribute('aria-pressed', 'false');
    el.playOverlay.setAttribute('aria-pressed', 'false');
    const s = $selected.get();
    if (s) publish(events[s.index]!, null);
  }

  /** Readouts and the status chip follow what is shown and heard. */
  function publish(ev: CatalogEvent, kind: PlayKind | null) {
    const rows: Readout[] = [{ label: 'Event', value: ev.name, tone: 'plain' }];
    const m1 = median(ev.m1);
    const m2 = median(ev.m2);
    if (m1 !== null && m2 !== null) rows.push({ label: 'Masses', value: `${num(m1)} + ${num(m2)} M☉`, tone: 'warm' });
    const d = median(ev.distance);
    if (d !== null) rows.push({ label: 'Distance', value: `${num(d, 0)} Mpc`, tone: 'mute' });
    const dn = DET_NAME[$playing.get()?.det ?? ''] ?? '';
    const pk = $playing.get()?.pitch ?? 1;
    if (kind) rows.push({ label: 'Hearing', value: kind === 'model' ? `model chirp (modelled)${pk === 1 ? '' : ` · pitch ×${pk}`}` : kind === 'overlay' ? `model chirp (modelled) over ${dn} data` : `${dn} data`, tone: kind === 'data' ? 'b' : 'warm' });
    const status = kind === 'model' || kind === 'overlay' ? 'modelled' : 'measured';
    setCatalogueReadouts(rows, status);
    $statusOverride.set({ ...$statusOverride.get(), catalogue: status });
    refreshNarration();
  }

  function fillCard(ev: CatalogEvent, listen: Listen | null) {
    const hasModel = listen !== null;
    card.hidden = false;
    const k = kindOf(ev);
    el.name.textContent = ev.name;
    el.kind.innerHTML = `<i data-k="${k}"></i>${KIND_TEXT[k]}${ev.typeAmbiguous ? ' (uncertain)' : ''}`;
    el.when.textContent = `${fmtDate.format(new Date(ev.utc))} UTC · ${ev.catalog}`;
    const rows: [string, string][] = [];
    if (ev.m1 !== null) {
      rows.push(['Heavier', iv(ev.m1, ' M☉')], ['Lighter', iv(ev.m2, ' M☉')]);
      if (ev.mFinal !== null) rows.push(['Became', iv(ev.mFinal, ' M☉')]);
      const m1 = median(ev.m1)!;
      const m2 = median(ev.m2)!;
      const mf = median(ev.mFinal);
      if (mf !== null && ev.type !== 'BNS') rows.push(['Radiated', `${num(m1 + m2 - mf, 1)} M☉ <small>(medians)</small>`]);
    }
    const d = median(ev.distance);
    if (d !== null) rows.push(['Distance', `${iv(ev.distance, ' Mpc', 0)}<br><small>about ${num(mpcToLy(d) / 1e9, 2)} billion light years</small>`]);
    if (ev.snr !== null) rows.push(['Signal-to-noise', iv(ev.snr, '', 1)]);
    if (ev.pAstro !== null) rows.push(['Astrophysical', `${num(ev.pAstro * 100, 1)}% <small>probability</small>`]);
    if (ev.far !== null) rows.push(['False alarms', `${ev.far < 0.001 ? ev.far.toExponential(0) : num(ev.far, 3)} per year`]);
    el.facts.innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    el.dets.innerHTML = ev.detectors.map((dd) => `<span style="color: var(--color-${dd.toLowerCase()}, var(--color-fog))">${escapeHtml(DET_NAME[dd] ?? dd)}</span>`).join('');
    el.playModel.hidden = !hasModel;
    el.playModel.setAttribute('aria-pressed', 'false');
    el.playTrue.hidden = !listen || listen.pitch === 1;
    el.playTrue.setAttribute('aria-pressed', 'false');
    el.listen.hidden = !listen;
    if (listen) {
      const shifted = listen.pitch !== 1;
      el.playModel.innerHTML = `Model chirp${shifted ? ` · pitch ×${listen.pitch}` : ''} <span>modelled</span>`;
      el.playTrue.innerHTML = `True pitch <span>modelled</span>`;
      const lead = -listen.win.from;
      const len = listen.win.to - listen.win.from;
      el.listen.textContent =
        `Plays the model chirp alone: its audible part, from ${lead < 1 ? `${Math.round(lead * 1000)} ms` : `${num(lead, 1)} s`} before the merger ` +
        `(where it enters the detectors’ band at ${LISTEN.fEnter} Hz${ev.type === 'BNS' || ev.type === 'NSBH' ? `, at most ${LISTEN.leadNs} s` : `, at most ${LISTEN.leadBbh} s`}) ` +
        `through the ${ev.type === 'BNS' ? 'merger' : 'ringdown'}, ${num(len, 1)} s in all, at the same loudness as every other event.` +
        (shifted
          ? ` Pitch raised ×${listen.pitch} (every frequency ×${listen.pitch}, timing unchanged): it peaks at ${Math.round(listen.peakF)} Hz, too low for small speakers. “True pitch” plays it as it is.`
          : ` True pitch: it peaks at ${Math.round(listen.peakF)} Hz.`);
    }
    el.playOverlay.hidden = true;
    el.playOverlay.setAttribute('aria-pressed', 'false');
    el.playData.innerHTML = '';
    const notes: string[] = [];
    if (ev.type === null) notes.push(`Parameters not published yet (${ev.catalog}): only its significance. No model chirp without masses.`);
    else
      notes.push(
        'The model chirp is a sketch from the published masses (leading-order inspiral and a ringdown), labelled modelled. The data are whitened and band-passed (30–350 Hz) and cut to the same window around the merger; for most events the chirp is buried in their noise to the ear. Over the data the model is whitened the same way and slid to where it best matches them.',
      );
    if (ev.typeAmbiguous) notes.push('Whether the lighter body is a neutron star is uncertain: its mass range crosses 3 M☉.');
    el.note.textContent = notes.join(' ');
    el.link.href = ev.url;
    el.hint.hidden = $sound.get() === 'on';
    el.sr.textContent = `${ev.name}: ${KIND_TEXT[k]}.`;
  }

  function fillPlay(ev: CatalogEvent, snippets: Record<string, Float32Array>, overlay: Overlay | null) {
    el.playData.innerHTML = '';
    el.playOverlay.hidden = !overlay;
    if (overlay) {
      const a = overlay.align;
      const name = DET_NAME[overlay.det] ?? overlay.det;
      el.playOverlay.innerHTML = `Model over ${escapeHtml(name)} data <span>modelled</span>`;
      el.playOverlay.setAttribute('aria-pressed', String($playing.get()?.kind === 'overlay'));
      el.playOverlay.title = a.fallback
        ? `No clear match in the data: the model's merger is put at the catalogue time.`
        : `Model's merger placed at ${(a.offset * 1000).toFixed(1)} ms from the catalogue time (best match, SNR ${a.snr.toFixed(1)} in ${name}).`;
    }
    const dets = DET_ORDER.filter((d) => snippets[d]);
    if (!dets.length) {
      const p = document.createElement('span');
      p.className = 'nodata';
      p.textContent = 'No usable open-data window around this event.';
      el.playData.appendChild(p);
      return;
    }
    for (const d of dets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.det = d;
      b.setAttribute('aria-pressed', 'false');
      b.textContent = `${DET_NAME[d] ?? d} data`;
      b.style.color = `var(--color-${d.toLowerCase()}, var(--color-paper))`;
      b.addEventListener('click', () => play(ev, 'data', d));
      el.playData.appendChild(b);
    }
  }

  el.playOverlay.addEventListener('click', () => {
    const s = $selected.get();
    if (s?.overlay) play(events[s.index]!, 'overlay', s.overlay.det);
  });
  el.playModel.addEventListener('click', () => {
    const s = $selected.get();
    if (s?.listen) play(events[s.index]!, 'model', null, s.listen.pitch);
  });
  el.playTrue.addEventListener('click', () => {
    const s = $selected.get();
    if (s?.listen) play(events[s.index]!, 'model', null, 1);
  });
  el.stop.addEventListener('click', stop);
  el.soundOn.addEventListener('click', () => {
    transport.enableSound();
    const p = $playing.get();
    const s = $selected.get();
    if (p && s) play(events[s.index]!, p.kind, p.det, p.pitch);
  });
  $sound.subscribe((s) => (el.hint.hidden = s === 'on' || card.hidden));

  root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!quick) return;
      const name = quick[b.dataset.pick as keyof typeof quick];
      const i = byName.get(name);
      if (i !== undefined) void select(i);
    }),
  );
  q<HTMLButtonElement>('[data-prev]').addEventListener('click', () => step(-1));
  q<HTMLButtonElement>('[data-next]').addEventListener('click', () => step(1));
  const tryInput = () => {
    const v = input.value.trim().toUpperCase();
    const i = byName.get(v);
    if (i !== undefined && $selected.get()?.index !== i) void select(i);
  };
  input.addEventListener('change', tryInput);
  input.addEventListener('input', tryInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim().toUpperCase();
      const i = byName.get(v) ?? events.findIndex((ev) => ev.name.startsWith(v));
      if (i >= 0) void select(i);
    }
  });

  // ── Pointer and keys over the 3D view ──
  let drag: { x: number; y: number; az: number; el: number; moved: boolean } | null = null;
  layer.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, az: $orbit.get().az, el: $orbit.get().el, moved: false };
    layer.setPointerCapture(e.pointerId);
  });
  layer.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        engage();
        $orbit.set({ az: drag.az - dx * 0.006, el: Math.max(-0.4, Math.min(0.9, drag.el + dy * 0.004)) });
      }
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const i = bridge.pick?.(e.clientX / innerWidth, e.clientY / innerHeight) ?? -1;
    if (i !== $hover.get()) $hover.set(i);
    layer.classList.toggle('pointing', i >= 0);
  });
  layer.addEventListener('pointerleave', () => $hover.set(-1));
  layer.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (d && !d.moved) {
      const i = bridge.pick?.(e.clientX / innerWidth, e.clientY / innerHeight) ?? -1;
      if (i >= 0) void select(i);
    }
  });
  layer.addEventListener('keydown', (e) => {
    const o = $orbit.get();
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowUp') $orbit.set({ ...o, el: Math.min(0.9, o.el + 0.08) });
    else if (e.key === 'ArrowDown') $orbit.set({ ...o, el: Math.max(-0.4, o.el - 0.08) });
    else if (e.key === 'Escape') stop();
    else return;
    e.preventDefault();
    engage();
  });

  // ── On and off with the scroll; the free area for the view ──
  const measure = () => {
    if (!docEl.classList.contains('finale-on')) {
      $free.set({ x: 0, y: 0, w: 1, h: 1 });
      return;
    }
    const r = scroller.getBoundingClientRect();
    const W = innerWidth;
    const H = innerHeight;
    if (W < 768) $free.set({ x: 0, y: 0, w: 1, h: Math.max(0.35, r.top / H) });
    else $free.set({ x: 0, y: 0, w: Math.max(0.4, (r.left - 8) / W), h: 1 });
  };
  new ResizeObserver(measure).observe(scroller);
  addEventListener('resize', measure);
  let wasOn = false;
  $stage.subscribe((s) => {
    const on = s.stageId === 'catalogue' && s.local >= TOOL_AT - 0.02;
    if (on === wasOn) return;
    wasOn = on;
    docEl.classList.toggle('finale-on', on);
    root.inert = !on;
    $toolOn.set(on);
    if (!on) {
      docEl.classList.remove('finale-engaged');
      if ($playing.get()) stop();
    }
    requestAnimationFrame(measure);
  });
}
