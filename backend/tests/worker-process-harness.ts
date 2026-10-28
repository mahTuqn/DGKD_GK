import { prisma } from "../src/db.js";
import { startWorker } from "../src/worker.js";

type HarnessCommand = { type: "start" } | { type: "shutdown" };

await prisma.$connect();
process.send?.({ type: "ready", pid: process.pid });

let worker: ReturnType<typeof startWorker> | undefined;
let stopping = false;
process.on("message", (message: HarnessCommand) => {
  if (message?.type === "start" && !worker && !stopping) {
    worker = startWorker({
      database: prisma,
      intervalMs: 250,
      batchSize: 10,
      onError: (error) => process.send?.({ type: "cycle-error", error: error instanceof Error ? error.message : String(error) })
    });
    process.send?.({ type: "started" });
    return;
  }

  if (message?.type === "shutdown" && !stopping) {
    stopping = true;
    void (async () => {
      await worker?.stop();
      await prisma.$disconnect();
    })().then(
      () => process.send?.({ type: "stopped" }, () => process.disconnect()),
      (error: unknown) => {
        process.exitCode = 1;
        process.send?.({ type: "error", error: error instanceof Error ? error.message : String(error) }, () => process.disconnect());
      }
    );
  }
});
