import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { filterMessage, summarizeVerdict } from "@/lib/filter";
import type { InboundMessage } from "@/lib/mail/provider";
import { resendProvider } from "@/lib/mail/resend";
import { notifyEmail } from "@/lib/notify/email";
import { notifySlack } from "@/lib/notify/slack";
import { stripReply } from "@/lib/reply/strip";
import { matchThread } from "@/lib/thread/match";

export const runtime = "nodejs";

/**
 * Resend's email.received webhook.
 *
 * Hard rule: ANY internal error still answers 200.
 * A 5xx makes svix retry over and over, turning a local failure into a storm -
 * and every retry carries the same broken email. Errors are logged and stored;
 * the HTTP layer always succeeds.
 *
 * The single exception is a failed signature check: that means the request did
 * not come from Resend at all, so it answers 400.
 */

/** Idempotency: the unique constraint on providerMessageId is the whole implementation. */
async function alreadyProcessed(providerMessageId: string): Promise<boolean> {
  const existing = await prisma.message.findUnique({
    where: { providerMessageId },
    select: { id: true },
  });
  return existing !== null;
}

async function fanOutNotifications(params: {
  messageId: string;
  threadId: string;
  subject: string;
  senderEmail: string;
  receiverEmail: string;
  notifyEmail: string | null;
  fromEmail: string;
  bodyPreview: string;
  held: boolean;
  filterReason: string | null;
}): Promise<void> {
  // Each channel has its own try/catch: one failing affects neither the other
  // channel nor the webhook's 200.
  const channels: { channel: "SLACK" | "EMAIL"; run: () => Promise<void> }[] = [
    {
      channel: "SLACK",
      run: () =>
        notifySlack({
          threadId: params.threadId,
          subject: params.subject,
          senderEmail: params.senderEmail,
          receiverEmail: params.receiverEmail,
          bodyPreview: params.bodyPreview,
          held: params.held,
          filterReason: params.filterReason,
        }),
    },
    {
      channel: "EMAIL",
      run: () =>
        notifyEmail({
          to: params.notifyEmail || env.defaultNotifyEmail,
          threadId: params.threadId,
          subject: params.subject,
          senderEmail: params.senderEmail,
          receiverEmail: params.receiverEmail,
          fromEmail: params.fromEmail,
          bodyPreview: params.bodyPreview,
          held: params.held,
          filterReason: params.filterReason,
        }),
    },
  ];

  await Promise.all(
    channels.map(async ({ channel, run }) => {
      try {
        await run();
        await prisma.notification.create({
          data: { messageId: params.messageId, channel, ok: true },
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[api/inbound] ${channel} notification failed`, error);
        await prisma.notification
          .create({
            data: { messageId: params.messageId, channel, ok: false, error },
          })
          .catch(() => {
            /* failing to record the failure must not bubble up */
          });
      }
    }),
  );
}

export async function POST(req: NextRequest) {
  // The raw, unparsed body is required: parsing and re-stringifying the JSON
  // breaks the svix signature
  const rawBody = await req.text();

  let event;
  try {
    event = resendProvider.verifyWebhook(rawBody, {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    });
  } catch (e) {
    console.error("[api/inbound] signature verification failed", e);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Events such as delivered / opened are not ours to handle
  if (!event) return NextResponse.json({ ok: true, skipped: true });

  try {
    if (await alreadyProcessed(event.providerMessageId)) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    // The webhook carries metadata only; the body needs a second fetch
    const inbound: InboundMessage = await resendProvider.fetchInbound(
      event.providerMessageId,
    );

    // ── Three-layer thread matching ──────────────────────────────────
    const match = await matchThread(inbound);
    if (!match.matched) {
      await prisma.unmatchedInbound.create({
        data: {
          payload: JSON.parse(rawBody),
          reason: match.reason,
        },
      });
      console.warn("[api/inbound] thread match failed", match.reason);
      return NextResponse.json({ ok: true, unmatched: true });
    }

    const thread = await prisma.thread.findUniqueOrThrow({
      where: { id: match.threadId },
    });

    // ── Quote stripping ─────────────────────────────────────────────
    const { stripped } = stripReply({ text: inbound.text, html: inbound.html });

    // ── Two-stage filtering ─────────────────────────────────────────
    const verdict = await filterMessage(stripped);

    // ── Store it (the original is always kept; filtering only sets status) ─
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        direction: "INBOUND",
        fromEmail: inbound.from,
        toEmail: thread.senderEmail,
        bodyRaw: inbound.text ?? inbound.html ?? "",
        bodyStripped: stripped,
        bodyHtml: inbound.html,
        providerMessageId: inbound.providerMessageId,
        rfcMessageId: inbound.rfcMessageId,
        inReplyTo: inbound.headers["in-reply-to"] ?? null,
        references: inbound.headers["references"] ?? null,
        status: verdict.status,
        filterStage: verdict.stage,
        filterCategories: verdict.categories,
        filterScore: verdict.score,
        filterReason: verdict.reason,
        filterDegraded: verdict.degraded,
        attachmentCount: inbound.attachmentCount,
      },
    });

    console.log(
      `[api/inbound] reply received thread=${thread.id} layer=${match.layer} ` +
        `status=${verdict.status}${verdict.stage ? ` stage=${verdict.stage}` : ""}` +
        `${verdict.degraded ? " (degraded)" : ""}`,
    );

    // ── Fan out the notifications ───────────────────────────────────
    await fanOutNotifications({
      messageId: message.id,
      threadId: thread.id,
      subject: thread.subject,
      senderEmail: thread.senderEmail,
      receiverEmail: thread.receiverEmail,
      notifyEmail: thread.notifyEmail,
      fromEmail: inbound.from,
      bodyPreview: stripped,
      held: verdict.status === "HELD",
      // The notification channels get the summary only, never the matched words
      filterReason: summarizeVerdict(verdict),
    });

    return NextResponse.json({ ok: true, messageId: message.id });
  } catch (e) {
    // Reaching here means the fault is ours. Log it, but still answer 200 -
    // see the note at the top of this file.
    console.error("[api/inbound] processing failed", e);
    return NextResponse.json({ ok: false, logged: true });
  }
}
