import { randomBytes } from "node:crypto";

/**
 * Thread tokens and subject tags.
 *
 * A random token rather than an incrementing id: the Reply-To address lands in
 * the recipient's mailbox, and a sequential id would expose the whole thread
 * space to anyone willing to guess.
 */

/** 16 hex characters. */
const TOKEN_RE = /reply\+([0-9a-f]{16})@/i;
/** The short tag carried in the subject, e.g. [#8f3a]. */
const TAG_RE = /\[#([0-9a-f]{4})\]/i;

export function generateToken(): string {
  return randomBytes(8).toString("hex");
}

/** The subject tag is the first 4 characters of the token: a fallback only, never a credential. */
export function tagFromToken(token: string): string {
  return token.slice(0, 4);
}

export function replyAddress(token: string, inboundDomain: string): string {
  return `reply+${token}@${inboundDomain}`;
}

export function subjectWithTag(subject: string, tag: string): string {
  const marker = `[#${tag}]`;
  return subject.includes(marker) ? subject : `${subject} ${marker}`;
}

/**
 * Extract the token from a set of addresses.
 * Prefer received_for (the envelope recipient) over the To header, which
 * forwarding rules rewrite.
 */
export function extractToken(addresses: (string | null | undefined)[]): string | null {
  for (const addr of addresses) {
    if (!addr) continue;
    const m = addr.match(TOKEN_RE);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function extractTag(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(TAG_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pull every Message-ID out of the In-Reply-To / References headers.
 * References is a space-separated list of <id> values that grows with the reply
 * chain; all of them are returned.
 */
export function extractMessageIds(
  ...headerValues: (string | null | undefined)[]
): string[] {
  const ids: string[] = [];
  for (const value of headerValues) {
    if (!value) continue;
    for (const m of value.matchAll(/<([^<>]+)>/g)) {
      ids.push(m[1]);
    }
    // A few clients omit the angle brackets.
    if (!value.includes("<") && value.trim()) {
      ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}
