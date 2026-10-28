import { createServer, type Server } from "node:http";

export const WORKER_HEALTH_PATH = "/healthz";
export const WORKER_HEALTH_MAX_AGE_MS = 30_000;

export type WorkerHealthSnapshot = {
  lastSuccessfulCycleAt: number | null;
  lastErrorAt: number | null;
};

export function isWorkerHealthy(
  snapshot: WorkerHealthSnapshot,
  now = Date.now(),
  maxAgeMs = WORKER_HEALTH_MAX_AGE_MS
): boolean {
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) {
    throw new RangeError("maxAgeMs must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(now) || snapshot.lastSuccessfulCycleAt === null) return false;
  if (snapshot.lastErrorAt !== null && snapshot.lastErrorAt > snapshot.lastSuccessfulCycleAt) return false;

  const ageMs = now - snapshot.lastSuccessfulCycleAt;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

export function createWorkerHealthServer(
  getSnapshot: () => WorkerHealthSnapshot,
  maxAgeMs = WORKER_HEALTH_MAX_AGE_MS
): Server {
  return createServer((request, response) => {
    if (request.method !== "GET" || request.url !== WORKER_HEALTH_PATH) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "not-found" }));
      return;
    }

    const healthy = isWorkerHealthy(getSnapshot(), Date.now(), maxAgeMs);
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: healthy ? "ok" : "unavailable" }));
  });
}
