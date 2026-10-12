/**
 * Switch databases: create the tables, verify connectivity, update the Vercel
 * environment variable.
 *
 * Usage:
 *   node scripts/switch-db.mjs 'postgresql://...'
 *
 * Moving to Neon needs no ?schema= parameter. That isolation only mattered while
 * the database was shared with another project; a dedicated database can just
 * use public.
 */

import { execFileSync } from "node:child_process";

const URL_ARG = process.argv[2];
if (!URL_ARG || !URL_ARG.startsWith("postgres")) {
  console.error("Usage: node scripts/switch-db.mjs 'postgresql://...'");
  process.exit(1);
}

const isNeon = /\.neon\.tech|neon\.build/.test(URL_ARG);
console.log(`  target: ${isNeon ? "Neon (HTTP driver, no TCP pool)" : "plain Postgres (TCP pool)"}`);

if (isNeon && !URL_ARG.includes("-pooler")) {
  console.warn("  ⚠️  This connection string has no -pooler. Neon recommends the pooled endpoint;");
  console.warn("      pick 'Pooled connection' under Connection string in the dashboard.");
}

function run(cmd, args, env = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// 1. Create the tables
console.log("\n  [1/3] creating tables\u2026");
try {
  const out = run("npx", ["prisma", "db", "push"], { DATABASE_URL: URL_ARG });
  console.log("        " + out.trim().split("\n").pop());
} catch (e) {
  console.error("  ❌ table creation failed: " + (e.stderr || e.message).slice(0, 500));
  process.exit(1);
}

// 2. Verify connectivity and count the tables
console.log("  [2/3] verifying\u2026");
const { Client } = await import("pg");
const c = new Client({ connectionString: URL_ARG });
await c.connect();
const r = await c.query(
  "select table_name from information_schema.tables where table_schema='public' order by table_name",
);
console.log("        tables: " + r.rows.map((x) => x.table_name).join(", "));
await c.end();

// 3. Update Vercel
console.log("  [3/3] updating the Vercel environment variable\u2026");
try {
  run("npx", ["vercel", "env", "rm", "DATABASE_URL", "production", "--yes"]);
} catch {
  /* it was not there to begin with */
}
execFileSync("npx", ["vercel", "env", "add", "DATABASE_URL", "production", "--type", "secret"], {
  input: URL_ARG,
  stdio: ["pipe", "pipe", "pipe"],
});
console.log("        ✅ written");

console.log("\n  Next: npx vercel --prod --yes");
