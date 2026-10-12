import { prisma } from "../db";
import { env } from "../env";
import type { InboundMessage } from "../mail/provider";
import { extractMessageIds, extractTag, extractToken } from "./token";

/**
 * Three-layer thread matching.
 *
 * A few clients rewrite Reply-To (some corporate Outlook tenants, certain
 * forwarding rules), so plus-addressing cannot be the only route. An email that
 * misses all three layers is written to UnmatchedInbound and never silently
 * dropped: if a reply does not show up during a demo, you need to see straight
 * away which layer it stalled at.
 */

export type MatchLayer = 1 | 2 | 3;

export interface MatchHit {
  matched: true;
  threadId: string;
  layer: MatchLayer;
}

export interface MatchMiss {
  matched: false;
  reason: string;
}

export type MatchResult = MatchHit | MatchMiss;

/** Pull the bare address out of `Name <addr@x>` or a plain address. */
function bareAddress(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1] : value).trim().toLowerCase();
}

/**
 * Loopback detection.
 *
 * Mail we sent can come back to the inbound domain: the recipient set up
 * forwarding, their auto-reply quoted the original, or the recipient address
 * happens to sit on our own domain.
 *
 * Layer-1 token matching necessarily fails for such a message (its recipient is
 * not reply+<token>), but the layer-3 subject tag WOULD claim it, and our own
 * outgoing text would be stored as though it were a reply. We hit this in practice.
 *
 * The test: the sender is our own envelope address.
 */
function isLoopback(inbound: InboundMessage): boolean {
  return bareAddress(inbound.from) === env.mailFrom.trim().toLowerCase();
}

export async function matchThread(inbound: InboundMessage): Promise<MatchResult> {
  if (isLoopback(inbound)) {
    return {
      matched: false,
      reason: `Loopback: sender ${inbound.from} is this service\u2019s own envelope address; dropped without storing.`,
    };
  }

  // ── Layer 1: the plus-addressing token in Reply-To ─────────────────────
  // received_for is the envelope recipient (RCPT TO), which is more reliable than
  // the To header because forwarding rules rewrite the latter.
  const token = extractToken([...inbound.receivedFor, ...inbound.to]);
  if (token) {
    const thread = await prisma.thread.findUnique({
      where: { token },
      select: { id: true },
    });
    if (thread) return { matched: true, threadId: thread.id, layer: 1 };
  }

  // ── Layer 2: look up our outbound Message-ID via In-Reply-To / References ─
  const messageIds = extractMessageIds(
    inbound.headers["in-reply-to"],
    inbound.headers["references"],
  );
  if (messageIds.length > 0) {
    const message = await prisma.message.findFirst({
      where: { rfcMessageId: { in: messageIds } },
      select: { threadId: true },
      orderBy: { createdAt: "desc" },
    });
    if (message) return { matched: true, threadId: message.threadId, layer: 2 };
  }

  // ── Layer 3: the short [#xxxx] tag in the subject ──────────────────────
  const tag = extractTag(inbound.subject);
  if (tag) {
    const thread = await prisma.thread.findFirst({
      where: { tag },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (thread) return { matched: true, threadId: thread.id, layer: 3 };
  }

  return {
    matched: false,
    reason: [
      `All three matching layers missed.`,
      `token=${token ?? "not parsed"}`,
      `message-ids=${messageIds.length > 0 ? messageIds.join(" ") : "none"}`,
      `subject-tag=${tag ?? "none"}`,
      `received_for=${inbound.receivedFor.join(" ") || "none"}`,
    ].join(" | "),
  };
}
