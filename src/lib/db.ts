import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalForDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    }),
  });
if (process.env.NODE_ENV !== "production") globalForDb.prisma = db;
