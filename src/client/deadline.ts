import { AsyncLocalStorage } from "node:async_hooks";

const deadlines = new AsyncLocalStorage<{
  signal: AbortSignal;
  endsAt: number;
}>();
export function providerDeadline() {
  return deadlines.getStore();
}

/** Propagates cancellation through nested provider reads and retry backoff. */
export async function withProviderDeadline<T>(
  load: () => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController();
  const parent = providerDeadline();
  const budget = Math.max(
    1,
    Math.min(milliseconds, parent ? parent.endsAt - Date.now() : milliseconds),
  );
  const abort = () => controller.abort();
  parent?.signal.addEventListener("abort", abort, { once: true });
  if (parent?.signal.aborted) controller.abort();
  const timer = setTimeout(abort, budget);
  try {
    return await deadlines.run(
      { signal: controller.signal, endsAt: Date.now() + budget },
      load,
    );
  } finally {
    clearTimeout(timer);
    parent?.signal.removeEventListener("abort", abort);
  }
}
