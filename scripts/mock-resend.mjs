/**
 * A local Resend + Slack mock for development.
 *
 * Purpose: exercise the whole chain - send, receiver replies, thread matching,
 * quote stripping, filtering, notifications - with no domain, no DNS propagation
 * and no real Resend account.
 *
 * Usage:
 *   node scripts/mock-resend.mjs
 * Then set RESEND_BASE_URL=http://localhost:4010 in .env
 *
 * It implements the Resend endpoints the app actually calls:
 *   POST /emails                    send
 *   GET  /emails/:id                fetch the RFC Message-ID
 *   GET  /emails/receiving/:id      fetch the inbound body
 * plus two helpers that exist only in the mock:
 *   POST /mock/slack                receive a Slack notification and print it
 *   POST /mock/reply                simulate a reply: build an inbound email and
 *                                   deliver it to the app with a valid svix signature
 */

import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const WEBHOOK_SECRET =
  process.env.RESEND_WEBHOOK_SECRET ?? "whsec_bG9jYWxkZXZzZWNyZXRsb2NhbGRldnNlY3JldA==";

/** Sent emails: id -> details. Needed by GET /emails/:id. */
const sentEmails = new Map();
/** Simulated inbound emails: id -> details. Needed by GET /emails/receiving/:id. */
const inboundEmails = new Map();
/** Slack notifications received, so they can be asserted on. */
const slackMessages = [];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Sign the way svix specifies: HMAC-SHA256(`${id}.${timestamp}.${payload}`),
 * with the key being the base64-decoded part after whsec_.
 * This makes the app's resend.webhooks.verify() take its real verification path
 * rather than being bypassed.
 */
function svixHeaders(payload) {
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");

  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
    "Content-Type": "application/json",
  };
}

/** Pull the address out of "Name <addr@x>". */
function bareAddress(value) {
  const m = String(value).match(/<([^>]+)>/);
  return m ? m[1] : String(value).trim();
}

const routes = {
  // ── Resend: send ────────────────────────────────────────────────────
  "POST /emails": async (req, res, body) => {
    const payload = JSON.parse(body);
    const id = randomUUID();
    const messageId = `${id}@mock.resend.local`;

    sentEmails.set(id, {
      id,
      message_id: messageId,
      from: payload.from,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      reply_to: payload.reply_to ?? payload.replyTo ?? null,
      subject: payload.subject,
      text: payload.text ?? null,
      html: payload.html ?? null,
      headers: payload.headers ?? {},
    });

    console.log(
      `📤 sent   to=${payload.to}  subject=${payload.subject}  reply-to=${
        payload.reply_to ?? payload.replyTo
      }`,
    );
    json(res, 200, { id });
  },

  // ── Resend: fetch a sent email (the app uses it for the RFC Message-ID) ─
  "GET /emails/:id": (req, res, _body, [id]) => {
    const email = sentEmails.get(id);
    if (!email) return json(res, 404, { message: "not found", name: "not_found" });
    json(res, 200, { object: "email", last_event: "delivered", ...email });
  },

  // ── Resend: fetch an inbound body ───────────────────────────────────
  "GET /emails/receiving/:id": (req, res, _body, [id]) => {
    const email = inboundEmails.get(id);
    if (!email) return json(res, 404, { message: "not found", name: "not_found" });
    json(res, 200, email);
  },

  // ── mock：Slack ──────────────────────────────────────────────────────
  "POST /mock/slack": (req, res, body) => {
    const payload = JSON.parse(body);
    slackMessages.push(payload);
    console.log(`💬 Slack  ${payload.text}`);
    res.writeHead(200).end("ok");
  },

  "GET /mock/slack": (req, res) => json(res, 200, { messages: slackMessages }),

  // ── mock: simulate a reply from the receiver ────────────────────────
  // body: { replyTo, from, subject, text?, html?, inReplyTo? }
  // Redeliver the webhook for the same inbound email, to exercise idempotency
  "POST /mock/replay": async (req, res, body) => {
    const { emailId } = JSON.parse(body);
    const inbound = inboundEmails.get(emailId);
    if (!inbound) return json(res, 404, { message: "no such emailId" });

    const event = JSON.stringify({
      type: "email.received",
      created_at: inbound.created_at,
      data: {
        email_id: emailId,
        created_at: inbound.created_at,
        from: inbound.from,
        to: inbound.to,
        bcc: [],
        cc: [],
        received_for: inbound.received_for,
        message_id: inbound.message_id,
        subject: inbound.subject,
        attachments: [],
      },
    });

    console.log(`🔁 redelivered  emailId=${emailId}`);
    const webhookRes = await fetch(`${APP_URL}/api/inbound`, {
      method: "POST",
      headers: svixHeaders(event),
      body: event,
    });

    json(res, 200, {
      webhookStatus: webhookRes.status,
      webhookBody: await webhookRes.json().catch(() => null),
    });
  },

  "POST /mock/reply": async (req, res, body) => {
    const input = JSON.parse(body);
    const emailId = randomUUID();
    const replyToAddress = bareAddress(input.replyTo);

    const headers = {};
    if (input.inReplyTo) {
      headers["In-Reply-To"] = `<${input.inReplyTo}>`;
      headers["References"] = `<${input.inReplyTo}>`;
    }

    const inbound = {
      object: "email",
      id: emailId,
      from: input.from,
      to: [replyToAddress],
      // received_for is the envelope recipient (RCPT TO), the preferred source
      // for layer-1 thread matching
      received_for: [replyToAddress],
      bcc: null,
      cc: null,
      reply_to: null,
      created_at: new Date().toISOString(),
      subject: input.subject,
      text: input.text ?? null,
      html: input.html ?? null,
      headers,
      message_id: `${emailId}@mock.inbound.local`,
      attachments: [],
    };
    inboundEmails.set(emailId, inbound);

    const event = JSON.stringify({
      type: "email.received",
      created_at: inbound.created_at,
      data: {
        email_id: emailId,
        created_at: inbound.created_at,
        from: inbound.from,
        to: inbound.to,
        bcc: [],
        cc: [],
        received_for: inbound.received_for,
        message_id: inbound.message_id,
        subject: inbound.subject,
        attachments: [],
      },
    });

    console.log(`📥 reply  from=${input.from}  to=${replyToAddress}`);

    const webhookRes = await fetch(`${APP_URL}/api/inbound`, {
      method: "POST",
      headers: svixHeaders(event),
      body: event,
    });

    json(res, 200, {
      emailId,
      webhookStatus: webhookRes.status,
      webhookBody: await webhookRes.json().catch(() => null),
    });
  },
};

function match(method, pathname) {
  const exact = routes[`${method} ${pathname}`];
  if (exact) return { handler: exact, params: [] };

  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, pattern] = key.split(" ");
    if (routeMethod !== method || !pattern.includes(":")) continue;

    const re = new RegExp(`^${pattern.replace(/:[^/]+/g, "([^/]+)")}$`);
    const m = pathname.match(re);
    if (m) return { handler, params: m.slice(1) };
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const found = match(req.method, url.pathname);

  if (!found) {
    console.warn(`⚠️  unimplemented endpoint: ${req.method} ${url.pathname}`);
    return json(res, 404, { message: "endpoint not implemented by the mock", name: "not_found" });
  }

  try {
    const body = req.method === "GET" ? "" : await readBody(req);
    await found.handler(req, res, body, found.params);
  } catch (e) {
    console.error("mock request failed", e);
    json(res, 500, { message: String(e), name: "mock_error" });
  }
}).listen(PORT, () => {
  console.log(`Resend/Slack mock listening on http://localhost:${PORT}`);
  console.log(`webhooks will be delivered to ${APP_URL}/api/inbound`);
});
