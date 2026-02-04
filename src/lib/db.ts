// src/lib/db.ts
// @ts-ignore
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: any };

// @ts-ignore
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["query"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
