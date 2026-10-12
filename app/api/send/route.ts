import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isViewer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { resendProvider } from "@/lib/mail/resend";
import { rateLimit } from "@/lib/ratelimit";
import { generateToken, replyAddress, subjectWithTag, tagFromToken } from "@/lib/thread/token";

export const runtime = "nodejs";

const BodySchema = z.object({
  senderEmail: z.email(),
  receiverEmail: z.email(),
  notifyEmail: z.email().optional().or(z.literal("")),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  // Gating the read endpoints but not this one would still let anyone burn the
  // Resend quota and send mail from our verified domain.
  if (!isViewer(req)) {
    return NextResponse.json({ error: "Access token required" }, { status: 401 });
  }

  const limit = rateLimit(`send:${clientIp(req)}`, 20, 5 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${limit.resetInSeconds}s.` },
      { status: 429 },
    );
  }

  let input: z.infer<typeof BodySchema>;
  try {
    input = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid request", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // The receiver must not sit on the inbound domain.
  //
  // That domain's MX points at this service's inbound handler, so mail sent
  // there loops straight back, trips the loopback guard and lands in
  // UnmatchedInbound. It looks like "the mail was sent but never arrived" and is
  // painful to diagnose. Rejecting it at the entrance is far cheaper than
  // explaining it afterwards.
  //
  // Sender and receiver being identical, on the other hand, is allowed: testing
  // with a single mailbox is a perfectly reasonable thing to do.
  if (input.receiverEmail.toLowerCase().endsWith(`@${env.inboundDomain.toLowerCase()}`)) {
    return NextResponse.json(
      {
        error: `The receiver cannot be an address at @${env.inboundDomain}`,
        detail:
          "That domain receives mail for this service. Anything sent there loops straight back and never reaches the recipient. Use a real external mailbox.",
      },
      { status: 400 },
    );
  }

  // The notification address must differ from both the sender and the receiver.
  // The client's own words: "This email should be different from the sender and
  // receiver."
  //
  // What is validated is the address that actually takes effect (the form field
  // wins, an empty field falls back to DEFAULT_NOTIFY_EMAIL). Otherwise setting
  // the env var to the receiver's own address would bypass the requirement
  // silently.
  const resolvedNotify = (input.notifyEmail || env.defaultNotifyEmail || "").trim();
  if (!resolvedNotify) {
    return NextResponse.json(
      {
        error: "A notification email is required",
        detail:
          "Fill in the notification email field, or set DEFAULT_NOTIFY_EMAIL. Without it, replies would arrive with no email notification.",
      },
      { status: 400 },
    );
  }
  const notifyLower = resolvedNotify.toLowerCase();
  if (
    notifyLower === input.senderEmail.toLowerCase() ||
    notifyLower === input.receiverEmail.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error: "The notification email must differ from the sender and the receiver",
        detail: `${resolvedNotify} is already used as the ${
          notifyLower === input.senderEmail.toLowerCase() ? "sender" : "receiver"
        } address. Use a third, separate mailbox so reply notifications can be verified independently.`,
      },
      { status: 400 },
    );
  }

  try {
    // The same sender + receiver + subject reuses a thread, so consecutive
    // messages land in one conversation
    let thread = await prisma.thread.findFirst({
      where: {
        senderEmail: input.senderEmail,
        receiverEmail: input.receiverEmail,
        subject: input.subject,
      },
    });

    if (!thread) {
      const token = generateToken();
      thread = await prisma.thread.create({
        data: {
          token,
          tag: tagFromToken(token),
          senderEmail: input.senderEmail,
          receiverEmail: input.receiverEmail,
          notifyEmail: resolvedNotify,
          subject: input.subject,
        },
      });
    } else if (thread.notifyEmail !== resolvedNotify) {
      // Reusing a thread must still accept a new notification address.
      // Otherwise changing the field does nothing at all, and the client
      // explicitly asked for an address "that we can add".
      thread = await prisma.thread.update({
        where: { id: thread.id },
        data: { notifyEmail: resolvedNotify },
      });
    }

    // Show the identity, do not forge the envelope.
    // We hold no SPF/DKIM authorisation for the sender's domain, so actually
    // sending as their address lands in spam or is rejected outright. The
    // display name therefore carries the identity while the envelope address
    // stays on our own verified domain.
    //
    // The display name uses the FULL address rather than the part before the @:
    // the recipient has to see at a glance who this represents, and "jason"
    // alone throws the domain away. Both @ and parentheses are RFC 5322
    // specials, so the whole display name must be quoted or the header will not
    // parse.
    const displayName = `"${input.senderEmail} (via ${env.mailFromName})"`;

    const threadHeaders: Record<string, string> = {};
    if (thread.lastMessageId) {
      threadHeaders["In-Reply-To"] = `<${thread.lastMessageId}>`;
      threadHeaders["References"] = `<${thread.lastMessageId}>`;
    }

    const sent = await resendProvider.send({
      from: `${displayName} <${env.mailFrom}>`,
      to: input.receiverEmail,
      replyTo: replyAddress(thread.token, env.inboundDomain),
      subject: subjectWithTag(input.subject, thread.tag),
      text: input.body,
      headers: Object.keys(threadHeaders).length > 0 ? threadHeaders : undefined,
    });

    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        direction: "OUTBOUND",
        fromEmail: input.senderEmail,
        toEmail: input.receiverEmail,
        bodyRaw: input.body,
        // We wrote this ourselves, so there is no quoted text to strip
        bodyStripped: input.body,
        providerMessageId: sent.providerMessageId,
        rfcMessageId: sent.rfcMessageId,
        // Outbound is never filtered: the requirement is about incoming replies
        status: "VISIBLE",
      },
    });

    // Layer-2 thread matching looks this up
    if (sent.rfcMessageId) {
      await prisma.thread.update({
        where: { id: thread.id },
        data: { lastMessageId: sent.rfcMessageId },
      });
    }

    return NextResponse.json({ threadId: thread.id, messageId: message.id });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/send] send failed", detail);
    return NextResponse.json({ error: "Failed to send", detail }, { status: 500 });
  }
}
