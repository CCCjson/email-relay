/**
 * Push environment variables into Vercel production.
 *
 * Usage: node scripts/set-vercel-env.mjs <env file>
 * Prerequisite: npx vercel login && npx vercel link
 *
 * Why not a shell script: connection strings contain & and ?, env files contain
 * quotes, and the bash shipped with macOS is 3.2, where indirect variable
 * expansion is unreliable. Together those three fail silently far too easily.
 * (We hit it once already: & was treated as a background operator, DATABASE_URL
 * was truncated, and the app connected to a different database.)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ENV_FILE = process.argv[2];
if (!ENV_FILE) {
  console.error("Usage: node scripts/set-vercel-env.mjs <env file>");
  process.exit(1);
}

/** Sensitive values are stored as secrets (hidden in the dashboard); the rest as config, so they stay editable there. */
const SECRETS = new Set([
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "SLACK_WEBHOOK_URL",
  "OPENAI_API_KEY",
  "ADMIN_TOKEN",
]);

const KEYS = [
  "DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "MAIL_FROM",
  "MAIL_FROM_NAME",
  "INBOUND_DOMAIN",
  "SLACK_WEBHOOK_URL",
  "DEFAULT_NOTIFY_EMAIL",
  "OPENAI_API_KEY",
  "FILTER_STAGE2_ENABLED",
  "FILTER_FAIL_OPEN",
  "ADMIN_TOKEN",
  "APP_URL",
];

/** Parse both `export KEY='value'` and `KEY=value`. */
function parseEnvFile(path) {
  const out = new Map();
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const m = line.replace(/^export\s+/, "").match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;

    let value = m[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    out.set(m[1], value);
  }
  return out;
}

function vercel(args, input) {
  return execFileSync("npx", ["vercel", ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

const values = parseEnvFile(ENV_FILE);

for (const key of KEYS) {
  const value = values.get(key);
  if (value === undefined || value === "") {
    console.log(`  ⏭  ${key} (empty, skipped)`);
    continue;
  }

  // Remove an existing value first, otherwise vercel env add fails on the duplicate
  try {
    vercel(["env", "rm", key, "production", "--yes"]);
  } catch {
    /* it did not exist, which is fine */
  }

  const type = SECRETS.has(key) ? "secret" : "config";
  try {
    vercel(["env", "add", key, "production", "--type", type], value);
    console.log(`  ✅ ${key}  (${type})`);
  } catch (e) {
    console.error(`  ❌ ${key}：${e.stderr?.trim() || e.message}`);
    process.exitCode = 1;
  }
}

console.log();
console.log("RESEND_BASE_URL is deliberately not set: it exists for the local mock only,");
console.log("and setting it in production would point mail traffic at an address that does not exist.");
console.log();
console.log("Next: npx vercel --prod");
