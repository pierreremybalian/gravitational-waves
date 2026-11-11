// The catalogue finale's HTML side (src/finale/ui/Finale.astro): view and filters, quick picks, search and stepping,
// the selected event's card (masses with 90% ranges, remnant, radiated, distance, date, detectors, significance) and
// its sound: the whitened data per detector (measured) or a model chirp from its parameters (modelled), both played
// on the transport so the scene's strip and binary move with what is heard. Also the pointer and keyboard surface
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
import { picks } from '../layout.ts';
import { $events, $filters, $free, $hover, $orbit, $playing, $selected, $toolOn, $view, bridge, kindOf, modelClipId, type Kind } from '../state.ts';

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
    stop: q<HTMLButtonElement>('[data-stop]'),
    hint: q<HTMLElement>('[data-sound-hint]'),
    soundOn: q<HTMLButtonElement>('[data-sound-on]'),
    note: q<HTMLElement>('[data-note]'),
    link: q<HTMLAnchorElement>('[data-link]'),
    sr: q<HTMLElement>('[data-sr]'),
  };
  const docEl = document.documentElement;
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
    const model = m1 !== null && m2 !== null ? modelChirp({ m1, m2, mFinal: median(ev.mFinal), redshift: median(ev.redshift), bns: ev.type === 'BNS' }) : null;
    if (model) transport.defineSamples(modelClipId(ev.name), model.h, model.fs, model.t0);
    $selected.set({ name: ev.name, index: i, snippets: null, model });
    fillCard(ev, model !== null);
    input.value = ev.name;
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
    if (s) for (const d of Object.keys(snippets)) transport.defineSamples(eventClipId(ev.name, d), snippets[d]!, s.fs, s.t0);
    $selected.set({ name: ev.name, index: i, snippets, model });
    fillPlay(ev, snippets);
    const dets = DET_ORDER.filter((d) => snippets[d]);
    if (autoplay && dets.length) play(ev, 'data', dets[0]!);
    else publish(ev, null);
  }

  function play(ev: CatalogEvent, kind: 'data' | 'model', det: string | null) {
    const clip = kind === 'model' ? modelClipId(ev.name) : eventClipId(ev.name, det!);
    transport.play(clip);
    $playing.set({ clip, name: ev.name, kind, det });
    root.querySelectorAll<HTMLButtonElement>('[data-det]').forEach((b) => b.setAttribute('aria-pressed', String(kind === 'data' && b.dataset.det === det)));
    el.playModel.setAttribute('aria-pressed', String(kind === 'model'));
    publish(ev, kind);
    el.sr.textContent = kind === 'model' ? `Playing a model chirp for ${ev.name} (modelled).` : `Playing ${ev.name}, ${DET_NAME[det!] ?? det} data.`;
  }

  function stop() {
    transport.stop();
    $playing.set(null);
    root.querySelectorAll<HTMLButtonElement>('[data-det]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    el.playModel.setAttribute('aria-pressed', 'false');
    const s = $selected.get();
    if (s) publish(events[s.index]!, null);
  }

  /** Readouts and the status chip follow what is shown and heard. */
  function publish(ev: CatalogEvent, kind: 'data' | 'model' | null) {
    const rows: Readout[] = [{ label: 'Event', value: ev.name, tone: 'plain' }];
    const m1 = median(ev.m1);
    const m2 = median(ev.m2);
    if (m1 !== null && m2 !== null) rows.push({ label: 'Masses', value: `${num(m1)} + ${num(m2)} M☉`, tone: 'warm' });
    const d = median(ev.distance);
    if (d !== null) rows.push({ label: 'Distance', value: `${num(d, 0)} Mpc`, tone: 'mute' });
    if (kind) rows.push({ label: 'Hearing', value: kind === 'model' ? 'model chirp (modelled)' : `${DET_NAME[$playing.get()?.det ?? ''] ?? ''} data`, tone: kind === 'model' ? 'warm' : 'b' });
    const status = kind === 'model' ? 'modelled' : 'measured';
    setCatalogueReadouts(rows, status);
    $statusOverride.set({ ...$statusOverride.get(), catalogue: status });
    refreshNarration();
  }

  function fillCard(ev: CatalogEvent, hasModel: boolean) {
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
    el.playData.innerHTML = '';
    const notes: string[] = [];
    if (ev.type === null) notes.push(`Parameters not published yet (${ev.catalog}): only its significance. No model chirp without masses.`);
    else notes.push('The data are whitened and band-passed (30–350 Hz); for most events the chirp is buried in the noise to the ear. The model chirp is a sketch from the published masses (leading-order inspiral and a ringdown), labelled modelled.');
    if (ev.typeAmbiguous) notes.push('Whether the lighter body is a neutron star is uncertain: its mass range crosses 3 M☉.');
    el.note.textContent = notes.join(' ');
    el.link.href = ev.url;
    el.hint.hidden = $sound.get() === 'on';
    el.sr.textContent = `${ev.name}: ${KIND_TEXT[k]}.`;
  }

  function fillPlay(ev: CatalogEvent, snippets: Record<string, Float32Array>) {
    el.playData.innerHTML = '';
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

  el.playModel.addEventListener('click', () => {
    const s = $selected.get();
    if (s) play(events[s.index]!, 'model', null);
  });
  el.stop.addEventListener('click', stop);
  el.soundOn.addEventListener('click', () => {
    transport.enableSound();
    const p = $playing.get();
    const s = $selected.get();
    if (p && s) play(events[s.index]!, p.kind, p.det);
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
