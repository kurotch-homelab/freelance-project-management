export interface SchedulerOptions {
  readonly intervalMinutes: number;
  readonly run: () => void | Promise<void>;
  readonly onError?: (error: unknown) => void | Promise<void>;
}

/** stop() cancels future ticks and resolves once any running job has finished. */
export function startScheduler({ intervalMinutes, run, onError }: SchedulerOptions): () => Promise<void> {
  const delay = intervalMinutes * 60_000;
  if (!Number.isFinite(delay) || delay < 1 || delay > 2_147_483_647) {
    throw new RangeError("Invalid intervalMinutes");
  }
  let stopped = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || pending) return;
    pending = Promise.resolve().then(run).catch(async (error: unknown) => {
      try { await onError?.(error); } catch { /* A reporter must not stop future runs. */ }
    }).finally(() => { pending = undefined; });
  };
  const timer = setInterval(tick, delay);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    return pending ?? Promise.resolve();
  };
}
