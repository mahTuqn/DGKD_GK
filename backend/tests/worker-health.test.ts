import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createWorkerHealthServer, WORKER_HEALTH_MAX_AGE_MS, WORKER_HEALTH_PATH, type WorkerHealthSnapshot } from "../src/worker-health.js";

let server: Server | undefined;

async function startHealthServer(snapshot: WorkerHealthSnapshot) {
  server = createWorkerHealthServer(() => snapshot);
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve);
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve the worker health test server address.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
});

describe("worker health endpoint", () => {
  it("[TC-WORKER-08] reports unhealthy before success, after errors or stale cycles, and recovers after success", async () => {
    const snapshot: WorkerHealthSnapshot = { lastSuccessfulCycleAt: null, lastErrorAt: null };
    const baseUrl = await startHealthServer(snapshot);

    expect((await fetch(`${baseUrl}${WORKER_HEALTH_PATH}`)).status).toBe(503);

    snapshot.lastSuccessfulCycleAt = Date.now();
    expect((await fetch(`${baseUrl}${WORKER_HEALTH_PATH}`)).status).toBe(200);

    snapshot.lastSuccessfulCycleAt = Date.now() - 1;
    snapshot.lastErrorAt = Date.now();
    expect((await fetch(`${baseUrl}${WORKER_HEALTH_PATH}`)).status).toBe(503);

    snapshot.lastSuccessfulCycleAt = Date.now();
    expect((await fetch(`${baseUrl}${WORKER_HEALTH_PATH}`)).status).toBe(200);

    snapshot.lastErrorAt = null;
    snapshot.lastSuccessfulCycleAt = Date.now() - WORKER_HEALTH_MAX_AGE_MS - 1;
    expect((await fetch(`${baseUrl}${WORKER_HEALTH_PATH}`)).status).toBe(503);
  });

  it("[TC-WORKER-08] only serves the worker health route over GET", async () => {
    const baseUrl = await startHealthServer({ lastSuccessfulCycleAt: Date.now(), lastErrorAt: null });

    expect((await fetch(`${baseUrl}/`)).status).toBe(404);
    expect((await fetch(`${baseUrl}${WORKER_HEALTH_PATH}`, { method: "POST" })).status).toBe(404);
  });
});
