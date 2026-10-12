/**
 * Full local walkthrough: no domain, no DNS, no real account required.
 *
 * Prerequisites:
 *   1. docker run -d --name relay-pg -e POSTGRES_PASSWORD=relay -e POSTGRES_USER=relay \
 *        -e POSTGRES_DB=relay -p 55432:5432 postgres:16-alpine
 *   2. cp .env.local.example .env && npx prisma db push
 *   3. In two terminals: node scripts/mock-resend.mjs   and   npm run dev
 *
 * Then: node scripts/demo.mjs
 */

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MOCK = process.env.MOCK_URL ?? "http://localhost:4010";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const INBOUND_DOMAIN = process.env.INBOUND_DOMAIN ?? "inbound.example.test";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const step = (s) => console.log(`\n${bold(s)}`);

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the raw text for the error message */
  }
  if (!res.ok) throw new Error(`${url} → ${res.status} ${text}`);
  return parsed;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function reply(payload) {
  const result = await postJson(`${MOCK}/mock/reply`, payload);
  if (!result?.emailId) throw new Error(`Delivery failed: ${JSON.stringify(result)}`);
  if (result.webhookStatus !== 200) {
    throw new Error(`webhook returned ${result.webhookStatus}`);
  }
  console.log(`   ok  ${JSON.stringify(result.webhookBody)}`);
}

async function main() {
  // A different subject each run, so an earlier thread is not reused and the
  // results do not get mixed together
  const subject = `Project kickoff ${new Date().toISOString().slice(11, 19)}`;

  step("1/6  Send a message from the UI");
  const sent = await postJson(`${APP}/api/send`, {
    senderEmail: "jason@sender.test",
    receiverEmail: "alex@receiver.test",
    notifyEmail: "ops@notify.test",
    subject,
    body: "Hi Alex, can you confirm the kickoff date?",
  });
  console.log(`   thread ${sent.threadId}`);

  const adminHeaders = { "x-admin-token": ADMIN_TOKEN };
  const detail = await getJson(
    `${APP}/api/threads/${sent.threadId}?view=admin`,
    adminHeaders,
  );
  const replyTo = `reply+${detail.thread.token}@${INBOUND_DOMAIN}`;
  console.log(`   reply address ${replyTo}`);

  step("2/6  The receiver replies from their mailbox (Gmail format, with quote and signature)");
  await reply({
    replyTo,
    from: "alex@receiver.test",
    subject: `Re: ${subject}`,
    text: [
      "Yes, Tuesday works for me.",
      "",
      "On Mon, Sep 7, 2026 at 10:02 AM Jason Chen (via Relay) <",
      "relay@example.test> wrote:",
      "",
      "> Hi Alex, can you confirm the kickoff date?",
      "",
      "-- ",
      "Alex Morgan",
      "Head of Ops",
    ].join("\n"),
  });

  step("3/6  An HTML-only reply from Outlook");
  await reply({
    replyTo,
    from: "alex@receiver.test",
    subject: `Re: ${subject}`,
    text: null,
    html:
      "<html><body><div>Confirmed for Tuesday 10am.</div>" +
      '<div id="appendonsend"></div><hr>' +
      '<div id="divRplyFwdMsg"><b>From:</b> Jason<br><b>Sent:</b> Monday<br><b>To:</b> Alex</div>' +
      "<div>Hi Alex, can you confirm the kickoff date?</div></body></html>",
  });

  step("4/6  Legitimate negative feedback - must be allowed through");
  await reply({
    replyTo,
    from: "alex@receiver.test",
    subject: `Re: ${subject}`,
    text: "This is late and I am not happy. The analysis you sent was a classic mistake. I want a refund.",
  });

  step("5/6  Abuse - must be hidden from the sender");
  await reply({
    replyTo,
    from: "alex@receiver.test",
    subject: `Re: ${subject}`,
    text: "are you f*cking kidding me you idiot",
  });

  step("6/6  Compare the two views");

  const senderView = await getJson(`${APP}/api/threads/${sent.threadId}`);
  console.log("\n── What the sender sees ────────────────────────────────");
  for (const m of senderView.messages) {
    console.log(`  ${m.direction === "OUTBOUND" ? "→" : "←"} ${JSON.stringify(m.body)}`);
  }

  const adminView = await getJson(
    `${APP}/api/threads/${sent.threadId}?view=admin`,
    adminHeaders,
  );
  console.log("\n── What admin sees ─────────────────────────────────────");
  for (const m of adminView.messages) {
    const flag = m.status === "HELD" ? "🚫" : "  ";
    console.log(
      `  ${flag} ${m.direction === "OUTBOUND" ? "→" : "←"} ${JSON.stringify(m.body)}`,
    );
    if (m.status === "HELD") {
      console.log(`        ${m.filterReason}  categories=${JSON.stringify(m.filterCategories)}`);
    }
  }

  const hidden = adminView.messages.length - senderView.messages.length;
  console.log(
    `\nSender view: ${senderView.messages.length} message(s). Admin view: ${adminView.messages.length}. ` +
      `${hidden} filtered message(s) do not exist at all as far as the sender is concerned.`,
  );
  console.log(`\nOpen ${APP} and ${APP}/admin to see the UI.`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
