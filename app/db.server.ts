import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
const db = globalDb.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
export default db;
