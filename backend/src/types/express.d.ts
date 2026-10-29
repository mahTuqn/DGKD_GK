import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: Role; name: string; assignedCinemaId: string | null };
      authVersion?: number;
    }
  }
}

export {};
