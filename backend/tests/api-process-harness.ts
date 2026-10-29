import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import type { Server } from "node:http";

type HarnessCommand = { type: "shutdown" };

let stopping = false;
let server: Server | undefined;

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    await prisma.$disconnect();
    process.send?.({ type: "stopped" }, () => process.disconnect());
  } catch (error) {
    process.exitCode = 1;
    process.send?.({ type: "error", error: error instanceof Error ? error.message : String(error) }, () => process.disconnect());
  }
}

try {
  if (process.env.NODE_ENV !== "test") throw new Error("The API process harness must run with NODE_ENV=test.");
  await prisma.$connect();
  server = createApp().listen(0, "127.0.0.1", () => {
    const address = server?.address();
    if (!address || typeof address === "string") {
      process.send?.({ type: "error", error: "Could not resolve the API listener address." });
      process.exitCode = 1;
      void stop();
      return;
    }
    process.send?.({ type: "ready", pid: process.pid, port: address.port });
  });
  server.once("error", (error) => {
    process.send?.({ type: "error", error: error.message });
    process.exitCode = 1;
    void stop();
  });
  process.once("message", (message: HarnessCommand) => {
    if (message?.type === "shutdown") void stop();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void stop());
} catch (error) {
  process.exitCode = 1;
  process.send?.({ type: "error", error: error instanceof Error ? error.message : String(error) }, () => process.disconnect());
  await prisma.$disconnect().catch(() => undefined);
}
