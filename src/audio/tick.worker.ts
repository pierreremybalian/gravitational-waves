// Scheduler heartbeat: a worker timer keeps ticking at 25 ms when the main thread's rAF is busy or throttled.
let timer: ReturnType<typeof setInterval> | null = null;
self.onmessage = (e: MessageEvent<'start' | 'stop'>) => {
  if (e.data === 'start' && !timer) timer = setInterval(() => self.postMessage(0), 25);
  if (e.data === 'stop' && timer) {
    clearInterval(timer);
    timer = null;
  }
};
