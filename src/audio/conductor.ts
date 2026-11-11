// The conductor: asks the stage script on screen what it plays at this point of the scroll and hands it to the
// transport. The transport never cuts a playing chirp: a change waits for the current clip to end.

import '../script/all.ts';
import { stageSound } from '../script/index.ts';
import { $stage } from '../state/store.ts';
import { transport } from './transport.ts';

let started = false;

/** single: the dev scene page's fixed scene (its sound plays only with ?sound=1). */
export function startConductor(single: () => { sceneId: string; local: number } | null): void {
  if (started) return;
  started = true;
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  // Only changes are passed on, so a direct transport.play() (the catalogue) is not overridden until the stage's own
  // request changes.
  let last = '';
  const apply = () => {
    const s = single();
    const req = s ? (params?.get('sound') === '1' ? stageSound(s.sceneId, s.local) : null) : stageSound($stage.get().stageId, $stage.get().local);
    const key = JSON.stringify(req);
    if (key === last) return;
    last = key;
    transport.request(req);
  };
  $stage.subscribe(apply);
  // Single-scene dev mode changes `local` without the store: poll.
  setInterval(apply, 50);
  apply();
}
