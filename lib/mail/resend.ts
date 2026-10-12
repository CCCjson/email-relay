import { Resend } from "resend";
import { env } from "../env";
import type {
  InboundEvent,
  InboundMessage,
  MailProvider,
  SendArgs,
  SendResult,
  WebhookHeaders,
} from "./provider";

let client: Resend | null = null;

function resend(): Resend {
  if (!client) {
    // RESEND_BASE_URL is for local development only. Point it at
    // scripts/mock-resend.mjs to exercise the whole chain with no domain, no DNS
    // and no real account.
    const baseUrl = process.env.RESEND_BASE_URL;
    client = baseUrl
      ? new Resend(env.resendApiKey, { baseUrl })
      : new Resend(env.resendApiKey);
  }
  return client;
}

export const resendProvider: MailProvider = {
  async send(args: SendArgs): Promise<SendResult> {
    const { data, error } = await resend().emails.send({
      from: args.from,
      to: args.to,
      replyTo: args.replyTo,
      subject: args.subject,
      text: args.text,
      headers: args.headers,
    });

    if (error || !data) {
      throw new Error(`Resend send failed: ${error?.message ?? "no response"}`);
    }

    // The send response carries only an id; the RFC Message-ID needs a second
    // fetch. Layer-2 thread matching (looking up In-Reply-To / References)
    // depends on it, so the extra call is worth it. Failing to get it does not
    // fail the send: layer-1 plus-addressing and the layer-3 subject tag remain.
    let rfcMessageId: string | null = null;
    try {
      const got = await resend().emails.get(data.id);
      rfcMessageId = got.data?.message_id ?? null;
    } catch (e) {
      console.error("[resend] could not fetch message_id; layer-2 thread matching will be unavailable", e);
    }

    return { providerMessageId: data.id, rfcMessageId };
  },

  verifyWebhook(rawBody: string, headers: WebhookHeaders): InboundEvent | null {
    if (!headers.id || !headers.timestamp || !headers.signature) {
      throw new Error("webhook is missing the svix signature headers");
    }

    // Note: this must be the unparsed raw body. Parsing and re-stringifying the
    // JSON changes the bytes and the signature no longer matches.
    const event = resend().webhooks.verify({
      payload: rawBody,
      headers: {
        id: headers.id,
        timestamp: headers.timestamp,
        signature: headers.signature,
      },
      webhookSecret: env.resendWebhookSecret,
    });

    if (event.type !== "email.received") return null;

    const d = event.data;
    return {
      providerMessageId: d.email_id,
      from: d.from,
      to: d.to ?? [],
      receivedFor: d.received_for ?? [],
      subject: d.subject ?? "",
    };
  },

  async fetchInbound(providerMessageId: string): Promise<InboundMessage> {
    const { data, error } = await resend().emails.receiving.get(providerMessageId);

    if (error || !data) {
      throw new Error(`Resend inbound fetch failed: ${error?.message ?? "no response"}`);
    }

    return {
      providerMessageId: data.id,
      from: data.from,
      to: data.to ?? [],
      receivedFor: data.received_for ?? [],
      subject: data.subject ?? "",
      text: data.text,
      html: data.html,
      // Header casing is inconsistent in the wild (both In-Reply-To and
      // in-reply-to occur), so normalise everything to lowercase.
      headers: Object.fromEntries(
        Object.entries(data.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      rfcMessageId: data.message_id,
      // v1 discards attachments and only records how many there were.
      attachmentCount: data.attachments?.length ?? 0,
    };
  },
};
