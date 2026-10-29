import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createToken } from "../src/auth.js";
import { prisma } from "../src/db.js";

const productionDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

productionDescribe("production mock-payment route gate", () => {
  const fixture = randomUUID();
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    MOCK_PAYMENT_SECRET: process.env.MOCK_PAYMENT_SECRET
  };
  let userId: string | undefined;

  afterAll(async () => {
    if (userId) {
      await prisma.auditLog.deleteMany({ where: { actorId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 15_000);

  it("[TC-SEC-18] disables customer-triggered mock payment completion outside local modes", async () => {
    process.env.JWT_SECRET = "production-mode-test-jwt-secret-value-32chars";
    process.env.MOCK_PAYMENT_SECRET = "production-mode-test-payment-secret-32chars";
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        name: "Production Mode Mock Payment Test",
        email: `production-mock-payment-${fixture}@test.local`,
        passwordHash: "unused-test-only",
        role: Role.CUSTOMER
      },
      select: { id: true, authVersion: true }
    });
    userId = user.id;

    const app = createApp();
    const authorization = { Authorization: `Bearer ${createToken(user)}` };

    for (const mode of ["production", "staging", "preview", undefined]) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;

      const response = await request(app)
        .post("/api/payments/mock/complete")
        .set(authorization)
        .send({ orderId: `nonexistent-${fixture}` });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("MOCK_PAYMENT_DISABLED");
    }

    for (const mode of ["development", "test"]) {
      process.env.NODE_ENV = mode;

      const response = await request(app)
        .post("/api/payments/mock/complete")
        .set(authorization)
        .send({ orderId: `nonexistent-${fixture}` });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("ORDER_NOT_FOUND");
    }
  }, 15_000);
});
