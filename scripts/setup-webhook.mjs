/**
 * Create the Resend inbound webhook and print its signing secret.
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx node scripts/setup-webhook.mjs https://your-app.vercel.app
 *
 * Easier than clicking through the dashboard: the create response carries the
 * signing_secret directly, so there is no detail page to hunt through.
 *
 * Prerequisite: Receiving must already be enabled on the domain, otherwise no
 * email.received event is ever produced. This script checks that first.
 */

const API = "https://api.resend.com";
const KEY = process.env.RESEND_API_KEY;
const APP_URL = process.argv[2];

if (!KEY) {
  console.error("RESEND_API_KEY is missing");
  process.exit(1);
}
if (!APP_URL || !APP_URL.startsWith("https://")) {
  console.error("Usage: node scripts/setup-webhook.mjs https://your-app.vercel.app");
  console.error("(must be a public https URL - Resend has to be able to reach it)");
  process.exit(1);
}

const ENDPOINT = `${APP_URL.replace(/\/$/, "")}/api/inbound`;

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// ── 1. Confirm Receiving is enabled on a domain ─────────────────────────
const { data: domains } = await api("/domains");
const enabled = domains.filter((d) => d.capabilities?.receiving === "enabled");

if (enabled.length === 0) {
  console.error("❌ No domain has Receiving enabled.");
  console.error();
  for (const d of domains) {
    console.error(`   ${d.name}：sending=${d.capabilities?.sending} receiving=${d.capabilities?.receiving}`);
  }
  console.error();
  console.error("   Enable it in the Resend dashboard under Emails > Receiving,");
  console.error("   add the inbound MX record it gives you to DNS, then run this again.");
  console.error("   Without Receiving, the email.received event is never produced.");
  process.exit(1);
}

console.log("✅ Domains with Receiving enabled:");
for (const d of enabled) console.log(`   ${d.name}`);

// ── 2. Do not create a second webhook for the same endpoint ─────────────
const { data: existing } = await api("/webhooks");
const dupe = existing?.find((w) => w.endpoint === ENDPOINT);
if (dupe) {
  const full = await api(`/webhooks/${dupe.id}`);
  console.log();
  console.log(`⚠️  This URL already has a webhook (id=${dupe.id}); nothing was created.`);
  console.log();
  console.log("RESEND_WEBHOOK_SECRET=" + full.signing_secret);
  process.exit(0);
}

// ── 3. Create it ────────────────────────────────────────────────────────
// Subscribe to email.received only. Subscribing to more would not break
// anything (the route answers 200 and skips them) but would add pointless
// inbound request volume.
const created = await api("/webhooks", {
  method: "POST",
  body: JSON.stringify({ endpoint: ENDPOINT, events: ["email.received"] }),
});

console.log();
console.log(`✅ webhook created  id=${created.id}`);
console.log(`   endpoint: ${ENDPOINT}`);
console.log(`   events:   email.received`);
console.log();
console.log("Put this in your environment variables and redeploy:");
console.log();
console.log("RESEND_WEBHOOK_SECRET=" + created.signing_secret);
