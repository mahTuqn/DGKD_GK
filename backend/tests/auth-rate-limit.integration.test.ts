import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { prisma } from "../src/db.js";

const rateLimitDescribe = process.env.DATABASE_URL_TEST ? describe.sequential : describe.skip;

rateLimitDescribe("REQ-SEC-01: runtime login rate limiting", () => {
  const app = createApp();
  const fixture = randomUUID();
  const password = "RateLimitTestPassword123!";
  const invalidPassword = "WrongRateLimitPassword123!";
  let userId: string | undefined;
  const registeredUserIds: string[] = [];
  let email = "";

  beforeAll(async () => {
    await prisma.$connect();
    email = `rate-limit-${fixture}@test.local`;
    const user = await prisma.user.create({
      data: {
        name: "Rate Limit Integration",
        email,
        passwordHash: await hashPassword(password),
        role: Role.CUSTOMER
      },
      select: { id: true }
    });
    userId = user.id;
  }, 15_000);

  afterAll(async () => {
    const fixtureUserIds = [userId, ...registeredUserIds].filter((id): id is string => Boolean(id));
    if (fixtureUserIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: fixtureUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    }
    await prisma.$disconnect();
  }, 15_000);

  it("[TC-SEC-14] skips successful login attempts and blocks the eleventh failure", async () => {
    const successfulLogin = await request(app).post("/api/auth/login").send({ email, password });
    expect(successfulLogin.status).toBe(200);
    expect(successfulLogin.body.user.id).toBe(userId);
    expect(successfulLogin.body).toHaveProperty("token");

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const failedLogin = await request(app).post("/api/auth/login").send({ email, password: invalidPassword });
      expect(failedLogin.status, `failed attempt ${attempt}`).toBe(401);
      expect(failedLogin.body.error).toBe("INVALID_CREDENTIALS");
    }

    const rateLimitedLogin = await request(app).post("/api/auth/login").send({ email, password: invalidPassword });
    expect(rateLimitedLogin.status).toBe(429);
    expect(rateLimitedLogin.body.error).toBe("AUTH_RATE_LIMITED");
  }, 15_000);

  it("[TC-SEC-17] limits public registrations from one client IP", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const registration = await request(app).post("/api/auth/register").send({
        name: `Rate Limited Registration ${attempt}`,
        email: `rate-limit-register-${attempt}-${fixture}@test.local`,
        password: "RateLimitTestPassword123!"
      });
      expect(registration.status, `registration attempt ${attempt}`).toBe(201);
      registeredUserIds.push(registration.body.user.id as string);
    }

    const blockedRegistration = await request(app).post("/api/auth/register").send({
      name: "Rate Limited Registration 6",
      email: `rate-limit-register-6-${fixture}@test.local`,
      password: "RateLimitTestPassword123!"
    });
    expect(blockedRegistration.status).toBe(429);
    expect(blockedRegistration.body.error).toBe("REGISTRATION_RATE_LIMITED");
  }, 15_000);
});
