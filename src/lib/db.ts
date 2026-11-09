/**
 * AnchorTransport TMS - Database Client Singleton
 * Prisma ORM with connection pooling & lifecycle management
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // Prevent multiple PrismaClient instances during hot reloads
  var prismaGlobal: PrismaClient | undefined;
}

export const db =
  globalThis.prismaGlobal ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = db;
}

/**
 * Verifies active database connection with a lightweight ping
 */
export async function testDatabaseConnection(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1 as ping`;
    const latencyMs = Date.now() - start;
    return { ok: true, message: 'Database connection established successfully.', latencyMs };
  } catch (error: any) {
    return {
      ok: false,
      message: error?.message || 'Could not connect to PostgreSQL database.',
    };
  }
}
