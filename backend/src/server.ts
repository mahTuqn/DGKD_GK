import "dotenv/config";
import { assertMockPaymentConfiguration, createApp } from "./app.js";
import { assertAuthenticationConfiguration } from "./auth.js";
import { prisma } from "./db.js";

const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port.");
assertAuthenticationConfiguration();
assertMockPaymentConfiguration();

await prisma.$connect();
const server = createApp().listen(port, () => {
  console.info(`CinemaBooking API listening on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  });
}
