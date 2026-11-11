// Stage table and the scroll ↔ stage mapping (HANDOFF §7). Scroll is the argument, not the clock: each stage owns a
// scroll span (scrollWeight) and its scene reads `local` ∈ [0, 1] through its own script (src/script/).

import { clamp } from '../physics/interp.ts';

export type TransitionKind = 'dissolve' | 'zoom' | 'stretch';
export type Status = 'exact' | 'measured' | 'convention' | 'tradition' | 'historical' | 'metaphor';

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
  ['two', 'exact', 6, 'dissolve'],
  ['cycle', 'measured', 6, 'dissolve'],
  ['grouping', 'measured', 6, 'dissolve'],
  ['axle', 'exact', 8, 'dissolve'],
  ['knot', 'exact', 7, 'dissolve'],
  ['harmony', 'measured', 8, 'dissolve'],
  ['rhythmicon', 'historical', 6, 'dissolve'],
  ['gears', 'exact', 7, 'dissolve'],
  ['long', 'exact', 6, 'dissolve'],
  ['six', 'measured', 6, 'dissolve'],
  ['even', 'exact', 7, 'dissolve'],
  ['ensemble', 'tradition', 7, 'dissolve'],
  ['studio', 'exact', 6, 'dissolve'],
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
