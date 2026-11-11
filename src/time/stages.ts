// Stage table (HANDOFF "Story") and the scroll ↔ stage mapping. Scroll is the argument, not the clock: each stage owns a
// scroll span (scrollWeight) and its scene reads `local` ∈ [0, 1] through its own script (src/script/).

import { clamp } from '../physics/interp.ts';

export type TransitionKind = 'dissolve' | 'zoom' | 'stretch';
/** How sure: measured (GWOSC data / published analysis), established (tested physics), modelled (a fitted model),
 * metaphor (a picture, nothing literal). */
export type Status = 'measured' | 'established' | 'modelled' | 'metaphor';

export interface Stage {
  id: string;
  sceneId: string;
  status: Status;
  scrollWeight: number;
  transitionIn: TransitionKind;
  /** 0–1 fraction of this stage used to blend in from the previous scene. */
  transitionSpan: number;
}

const DEFAULT_SPAN = 0.12;

type Row = [id: string, status: Status, weight: number, transition: TransitionKind];

const ROWS: Row[] = [
  ['sound', 'measured', 6, 'dissolve'], // 1 A sound from space
  ['fabric', 'established', 6, 'dissolve'], // 2 Spacetime is a fabric
  ['ripples', 'established', 6, 'dissolve'], // 3 Ripples (+ and × on a ring of particles)
  ['binary', 'modelled', 6, 'dissolve'], // 4 Two black holes
  ['inspiral', 'measured', 7, 'dissolve'], // 5 The inspiral (the chirp)
  ['merger', 'modelled', 6, 'dissolve'], // 6 Merger and ringdown
  ['scale', 'measured', 6, 'dissolve'], // 7 How small
  ['interferometer', 'established', 7, 'dissolve'], // 8 An interferometer
  ['noise', 'measured', 6, 'dissolve'], // 9 Noise
  ['finding', 'measured', 7, 'dissolve'], // 10 Finding it (whitening, matched filter)
  ['detectors', 'measured', 6, 'dissolve'], // 11 Two detectors
  ['results', 'measured', 6, 'dissolve'], // 12 What it told us
  ['catalogue', 'measured', 8, 'dissolve'], // 13 The catalogue (finale)
];

export const STAGES: readonly Stage[] = ROWS.map(([id, status, scrollWeight, transitionIn]) => ({
  id,
  sceneId: id,
  status,
  scrollWeight,
  transitionIn,
  transitionSpan: DEFAULT_SPAN,
}));

export const TOTAL_WEIGHT = STAGES.reduce((s, c) => s + c.scrollWeight, 0);

/** Progress at which each stage starts; length = STAGES.length + 1 (last entry = 1). */
export const STAGE_STARTS: readonly number[] = (() => {
  const out = [0];
  let acc = 0;
  for (const c of STAGES) {
    acc += c.scrollWeight;
    out.push(acc / TOTAL_WEIGHT);
  }
  out[out.length - 1] = 1;
  return out;
})();

export function stageIndex(id: string): number {
  return STAGES.findIndex((s) => s.id === id);
}

export function stageById(id: string): Stage | undefined {
  return STAGES.find((s) => s.id === id);
}

export interface StagePoint {
  stage: Stage;
  index: number;
  local: number;
}

export function progressToStage(p: number, out?: StagePoint): StagePoint {
  const pc = clamp(p, 0, 1);
  let i = 0;
  while (i < STAGES.length - 1 && pc >= STAGE_STARTS[i + 1]!) i++;
  const p0 = STAGE_STARTS[i]!;
  const p1 = STAGE_STARTS[i + 1]!;
  const local = clamp((pc - p0) / (p1 - p0), 0, 1);
  if (out) {
    out.stage = STAGES[i]!;
    out.index = i;
    out.local = local;
    return out;
  }
  return { stage: STAGES[i]!, index: i, local };
}

export function stageToProgress(index: number, local: number): number {
  const i = clamp(Math.round(index), 0, STAGES.length - 1);
  const p0 = STAGE_STARTS[i]!;
  const p1 = STAGE_STARTS[i + 1]!;
  return p0 + (p1 - p0) * clamp(local, 0, 1);
}
