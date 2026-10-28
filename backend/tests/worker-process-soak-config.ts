export const DEFAULT_WORKER_SOAK_DURATION_MS = 60_000;
export const WORKER_SOAK_EVENT_INTERVAL_MS = 10_000;
const MAX_WORKER_SOAK_DURATION_MS = 15 * 60_000;

export function resolveWorkerSoakDurationMs(raw = process.env.WORKER_PROCESS_SOAK_DURATION_MS): number {
  if (raw === undefined || raw === "") return DEFAULT_WORKER_SOAK_DURATION_MS;

  const durationMs = Number(raw);
  if (!Number.isSafeInteger(durationMs) || durationMs < DEFAULT_WORKER_SOAK_DURATION_MS || durationMs > MAX_WORKER_SOAK_DURATION_MS) {
    throw new Error(`WORKER_PROCESS_SOAK_DURATION_MS must be an integer from ${DEFAULT_WORKER_SOAK_DURATION_MS} to ${MAX_WORKER_SOAK_DURATION_MS}.`);
  }
  return durationMs;
}
