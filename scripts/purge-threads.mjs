/**
 * Delete every thread, and with them every message and notification.
 *
 * For clearing test data out of a demo deployment: the sender view lists all
 * threads, so leftover debugging rows are visible to whoever is being shown the
 * demo. Messages and notifications go with the threads through the cascade
 * declared in schema.prisma, so one DELETE is enough.
 *
 * Usage: node scripts/purge-threads.mjs '<connection string>'
 *
 * Quote the connection string: the & in it is a background operator in a shell.
 */

import { Client } from "pg";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Usage: node scripts/purge-threads.mjs '<connection string>'");
  process.exit(1);
}

// The Prisma CLI understands ?schema=; the pg driver does not, so it is pulled
// out and applied as a search_path instead.
const parsed = new URL(url);
const schema = parsed.searchParams.get("schema");
parsed.searchParams.delete("schema");

const client = new Client({ connectionString: parsed.toString() });
await client.connect();
if (schema) await client.query(`SET search_path TO "${schema}"`);

const before = await client.query(
  `SELECT
     (SELECT count(*) FROM "Thread") AS threads,
     (SELECT count(*) FROM "Message") AS messages,
     (SELECT count(*) FROM "Notification") AS notifications,
     (SELECT count(*) FROM "UnmatchedInbound") AS unmatched`,
);
console.log("before:", before.rows[0]);

await client.query(`DELETE FROM "Thread"`);
await client.query(`DELETE FROM "UnmatchedInbound"`);

const after = await client.query(
  `SELECT
     (SELECT count(*) FROM "Thread") AS threads,
     (SELECT count(*) FROM "Message") AS messages,
     (SELECT count(*) FROM "Notification") AS notifications,
     (SELECT count(*) FROM "UnmatchedInbound") AS unmatched`,
);
console.log("after: ", after.rows[0]);

await client.end();
