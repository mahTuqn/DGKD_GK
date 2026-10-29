import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const dbDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

dbDescribe("registration field-level authorization", () => {
  const app = createApp();
  const email = `registration-bopla-${randomUUID()}@test.local`;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    const accidentalAccount = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (accidentalAccount) {
      await prisma.auditLog.deleteMany({ where: { actorId: accidentalAccount.id } });
      await prisma.user.delete({ where: { id: accidentalAccount.id } });
    }
    await prisma.$disconnect();
  });

  it("[TC-SEC-42] rejects privilege-bearing fields during public registration without persistence", async () => {
    const usersBefore = await prisma.user.count();
    const auditsBefore = await prisma.auditLog.count();
    const response = await request(app).post("/api/auth/register").send({
      name: "Privilege Injection",
      email,
      password: "RegistrationSecurity123!",
      role: "ADMIN",
      assignedCinemaId: randomUUID()
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("VALIDATION_ERROR");
    expect(response.body).not.toHaveProperty("token");
    expect(response.body).not.toHaveProperty("user");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.auditLog.count()).toBe(auditsBefore);
  }, 15_000);
});
