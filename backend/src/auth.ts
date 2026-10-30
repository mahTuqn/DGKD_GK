import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Role } from "@prisma/client";
import { prisma } from "./db.js";

const developmentSecret = "cinema-booking-local-secret-change-before-deploy-2026";
const publicJwtSecrets = new Set([
  developmentSecret,
  "local-development-secret-change-before-deployment",
  "ci-only-secret-change-before-deployment"
]);

function jwtSecret() {
  const configured = process.env.JWT_SECRET;
  const isLocalEnvironment = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  if (!isLocalEnvironment) {
    if (!configured) throw new Error("JWT_SECRET must be configured with at least 32 characters outside development and test.");
    if (publicJwtSecrets.has(configured)) throw new Error("JWT_SECRET must not use a published development or CI value outside development and test.");
    if (configured.length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters outside development and test.");
    return configured;
  }
  if (configured && configured.length >= 32) return configured;
  return configured || developmentSecret;
}

export function assertAuthenticationConfiguration() {
  jwtSecret();
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 11);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function createToken(user: { id: string; authVersion: number }) {
  return jwt.sign({ authVersion: user.authVersion }, jwtSecret(), { subject: user.id, expiresIn: "8h", issuer: "cinema-booking" });
}

export const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED", message: "Vui lòng đăng nhập để tiếp tục." });
  try {
    const payload = jwt.verify(token, jwtSecret(), { issuer: "cinema-booking", maxAge: "8h" }) as jwt.JwtPayload;
    if (!payload.sub) return res.status(401).json({ error: "INVALID_TOKEN", message: "Phiên đăng nhập không hợp lệ." });
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return res.status(401).json({ error: "INVALID_TOKEN", message: "Phiên đăng nhập không có thời hạn hợp lệ." });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true, role: true, assignedCinemaId: true, authVersion: true } });
    if (!user) return res.status(401).json({ error: "INVALID_TOKEN", message: "Tài khoản không còn tồn tại." });
    if (typeof payload.authVersion !== "number" || !Number.isSafeInteger(payload.authVersion) || payload.authVersion !== user.authVersion) {
      return res.status(401).json({ error: "INVALID_TOKEN", message: "Phiên đăng nhập không hợp lệ hoặc đã bị thu hồi." });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role, assignedCinemaId: user.assignedCinemaId };
    req.authVersion = payload.authVersion;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "INVALID_TOKEN", message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
    }
    next(error);
  }
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED", message: "Vui lòng đăng nhập để tiếp tục." });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "ROLE_FORBIDDEN", message: "Tài khoản không có quyền thực hiện thao tác này." });
    next();
  };
}
