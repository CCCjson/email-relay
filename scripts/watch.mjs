/**
 * Live watch on inbound messages - for testing against real mailboxes.
 *
 * Usage:
 *   APP_URL=https://your-app.vercel.app ADMIN_TOKEN=xxx node scripts/watch.mjs
 *
 * Hit reply in Gmail or Outlook and this prints, as it happens: what arrived,
 * what quote stripping reduced it to, how the filter judged it, and whether the
 * notifications went out. When something breaks, it shows which step it was.
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Configuration precedence: environment variables first, then the .env.prod file.
 * .env.prod is a local scratch file for this script. It is listed in .gitignore
 * and .vercelignore, so it reaches neither the repository nor the deployment.
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.replace(/^export\s+/, "").match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const file = loadEnvFile(new URL("../.env.prod", import.meta.url).pathname);

const APP = (process.env.APP_URL ?? file.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_TOKEN ?? file.ADMIN_TOKEN;
const POLL_MS = 3000;

if (!TOKEN) {
  console.error("ADMIN_TOKEN is missing.");
  console.error("Either set the environment variable, or create .env.prod in the project root:");
  console.error("  APP_URL=https://your-app.vercel.app");
  console.error("  ADMIN_TOKEN=xxx");
  process.exit(1);
}

const headers = { "x-admin-token": TOKEN };
const seenMessages = new Set();
const seenUnmatched = new Set();
let first = true;

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

async function get(path) {
  const res = await fetch(`${APP}${path}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function printMessage(thread, m) {
  const when = new Date(m.createdAt).toLocaleTimeString();
  const dir = m.direction === "OUTBOUND" ? "\u2192 outbound" : "\u2190 inbound";

  console.log();
  console.log(bold(`${dir}  ${when}  「${thread.subject}」`));
  console.log(`  from:   ${m.fromEmail}`);

  if (m.direction === "INBOUND") {
    const held = m.status === "HELD";
    console.log(`  body:   ${JSON.stringify(m.body)}`);

    if (m.bodyRaw && m.bodyRaw !== m.body) {
      const savedChars = m.bodyRaw.length - m.body.length;
      console.log(dim(`          (quote stripping removed ${savedChars} characters)`));
    }

    console.log(
      held
        ? red(`  filter: HELD \u00b7 Stage ${m.filterStage} \u00b7 ${m.filterReason}`)
        : green(`  filter: allowed${m.filterDegraded ? yellow(" (degraded path - Stage 2 did not run)") : ""}`),
    );

    if (m.attachmentCount > 0) {
      console.log(yellow(`  files:  ${m.attachmentCount} attachment(s) (v1 counts them, does not store them)`));
    }

    const notes = (m.notifications ?? [])
      .map((n) => `${n.channel}${n.ok ? "✓" : "✗ " + (n.error ?? "")}`)
      .join("  ");
    if (notes) console.log(`  notify: ${notes}`);
  } else {
    console.log(`  body:   ${JSON.stringify(m.body).slice(0, 90)}`);
  }
}

async function tick() {
  const { threads } = await get("/api/threads?view=admin");

  for (const t of threads) {
    const { thread, messages } = await get(`/api/threads/${t.id}?view=admin`);
    for (const m of messages) {
      if (seenMessages.has(m.id)) continue;
      seenMessages.add(m.id);
      if (!first) printMessage(thread, m);
    }
  }

  const { unmatched } = await get("/api/unmatched");
  for (const u of unmatched) {
    if (seenUnmatched.has(u.id)) continue;
    seenUnmatched.add(u.id);
    if (!first) {
      console.log();
      console.log(red(bold("⚠️  An inbound email arrived but matched no thread")));
      console.log(`  ${u.reason}`);
    }
  }

  if (first) {
    first = false;
    console.log(
      dim(`Baseline recorded at ${seenMessages.size} message(s); only newer ones will be shown.`),
    );
    console.log(dim("Now hit reply in Gmail or Outlook. Ctrl+C to exit."));
  }
}

console.log(bold(`Watching: ${APP}`));
await tick();
setInterval(() => tick().catch((e) => console.error(red(`Poll failed: ${e.message}`))), POLL_MS);
