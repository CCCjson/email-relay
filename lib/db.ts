import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Prisma 7 uses driver adapters; the adapter is picked from the connection string.
 *
 * - Neon: its serverless driver (HTTP), which does not get hammered by cold
 *   starts the way a TCP pool does inside Vercel's serverless functions.
 * - Anything else (Render, local docker, other hosts): the standard pg driver.
 *
 * Detected rather than switched by an env var, so local and production run the
 * exact same code path.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Pull `?schema=xxx` out of the connection string.
 *
 * The Prisma CLI (db push / migrate) understands that parameter, but the
 * underlying pg / neon drivers do not - the adapter has to be told separately
 * through its constructor. When the two disagree, tables are created in one
 * schema and queried in another, and every query reports a missing table.
 *
 * This matters here because the database also hosts another project's tables.
 * Ours live in their own schema: no interference, and cleanup is one DROP SCHEMA.
 */
function splitSchema(url: string): { connectionString: string; schema?: string } {
  try {
    const parsed = new URL(url);
    const schema = parsed.searchParams.get("schema") ?? undefined;
    parsed.searchParams.delete("schema");
    return { connectionString: parsed.toString(), schema };
  } catch {
    // A malformed connection string is the driver's error to report, not ours.
    return { connectionString: url };
  }
}

function createClient(): PrismaClient {
  const { connectionString, schema } = splitSchema(process.env.DATABASE_URL ?? "");
  const isNeon = /\.neon\.tech|neon\.build/.test(connectionString);

  if (isNeon) {
    // Neon's serverless driver speaks HTTP, so there is no TCP pool to manage.
    return new PrismaClient({
      adapter: new PrismaNeon({ connectionString }, { schema }),
    });
  }

  // Plain Postgres (Render and friends) over a TCP pool.
  //
  // A TCP pool on a serverless platform like Vercel is an architectural mismatch.
  // We hit it twice in practice:
  //
  // 1. pg defaults to max=10 and every function instance owns its own pool. The
  //    frontend polls every 5 seconds, which keeps spinning up new instances, and
  //    within ten minutes Render's free tier sat at 90/100 connections and the
  //    whole site returned 500:
  //      Too many database connections opened: remaining connection slots
  //      are reserved for roles with the SUPERUSER attribute
  //
  // 2. Dropping to max=1 was worse: Vercel's fluid compute serves several requests
  //    concurrently on one instance, a single connection is not enough to go
  //    around, and requests queue until
  //      timeout exceeded when trying to connect
  //
  // On top of that, a frozen instance has a stopped event loop, so the
  // idleTimeoutMillis timer never fires: idle connections are not returned when
  // expected and simply wait for the instance to be recycled.
  //
  // The settings below are the compromise: enough for fluid compute's concurrency,
  // not so many that a handful of instances exhaust the limit. The real fix is a
  // driver that holds no TCP connection (Neon's HTTP driver) or a host with a
  // long-lived process (a Render Web Service). Both are written up in the README.
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString,
        max: 3,
        idleTimeoutMillis: 5_000,
        // Fail fast when no connection is available rather than hanging the request
        connectionTimeoutMillis: 3_000,
        // Makes it obvious in pg_stat_activity which app holds a connection.
        application_name: "email-relay",
      },
      { schema },
    ),
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
