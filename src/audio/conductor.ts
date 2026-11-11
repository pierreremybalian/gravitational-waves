// The conductor: asks the stage script on screen what it plays at this point of the scroll and hands it to the
// transport. The transport commits changes at the next musical boundary, so scrolling never cuts a beat.

import '../script/all.ts';
import { stageMusic } from '../script/index.ts';
import { $stage } from '../state/store.ts';
import { transport, SILENCE } from './transport.ts';

let started = false;

export function startConductor(single: () => { sceneId: string; local: number } | null): void {
  if (started) return;
  started = true;
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const pos = params?.get('pos');
  const apply = () => {
    const s = single();
    const music = s ? (params?.get('music') === '1' || pos ? stageMusic(s.sceneId, s.local) : null) : stageMusic($stage.get().stageId, $stage.get().local);
    transport.request(music ?? SILENCE);
  };
  $stage.subscribe(apply);
  // Single-scene dev mode changes `local` without the store: poll at the scheduler's pace.
  setInterval(apply, 50);
  apply();
  if (pos !== null && pos !== undefined && pos !== '') transport.freezeAt(Number(pos));
}
