/**
 * Mail provider abstraction.
 *
 * Resend is the only implementation today. The seam exists because Resend's
 * inbound support is fairly new: if it misbehaves on the day, switching to
 * Cloudflare Email Routing plus an Email Worker means adding one implementation
 * file and changing nothing above it (thread matching, quote stripping,
 * filtering, notifications).
 */

export interface SendArgs {
  /** The full From value including display name, e.g. `"jason@acme.com (via Relay)" <relay@domain.com>`. */
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  /** Threading headers such as In-Reply-To / References. */
  headers?: Record<string, string>;
}

export interface SendResult {
  /** The provider-side email id, stored as Message.providerMessageId. */
  providerMessageId: string;
  /** This email's RFC Message-ID header, used by layer-2 thread matching. */
  rfcMessageId: string | null;
}

/** Metadata from a verified webhook. Resend's email.received carries only this - no body. */
export interface InboundEvent {
  providerMessageId: string;
  from: string;
  to: string[];
  /** The real envelope recipient (RCPT TO). The `To:` header can be rewritten; this cannot - the preferred source for layer-1 matching. */
  receivedFor: string[];
  subject: string;
}

/** The full inbound email, which takes a second fetch to retrieve. */
export interface InboundMessage extends InboundEvent {
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  rfcMessageId: string;
  attachmentCount: number;
}

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export interface MailProvider {
  send(args: SendArgs): Promise<SendResult>;

  /**
   * Verify and parse a webhook.
   * Returning null means the event type is not one we care about (delivered,
   * opened and so on) and the caller should simply answer 200. A failed
   * signature check must throw.
   */
  verifyWebhook(rawBody: string, headers: WebhookHeaders): InboundEvent | null;

  /** Fetch the full inbound email by id (body plus headers). */
  fetchInbound(providerMessageId: string): Promise<InboundMessage>;
}
