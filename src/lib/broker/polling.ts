import { setTimeout as sleep } from 'node:timers/promises';

export type PollOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  clock?: () => number;
  wait?: (ms: number) => Promise<unknown>;
  beforeRead?: () => void | Promise<void>;
};

// Only repeat reads. Exceptions (including quantity/version mismatches) remain fatal.
export async function pollRead<T>(read: () => Promise<T>, ready: (value: T) => boolean,
  options: PollOptions = {}) {
  const clock = options.clock ?? Date.now, wait = options.wait ?? sleep;
  const deadline = clock() + (options.timeoutMs ?? 30000);
  const attempts = options.maxAttempts ?? 30;
  for (let attempt = 0; ; attempt++) {
    await options.beforeRead?.();
    const value = await read(), matched = ready(value);
    if (matched || attempt + 1 >= attempts || clock() >= deadline) return { value, matched };
    await wait(Math.min(1000 * (attempt + 1), 5000, Math.max(0, deadline - clock())));
  }
}
