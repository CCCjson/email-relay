import { env } from "../env";
import { resendProvider } from "../mail/resend";

/**
 * Email notifications, sent to the notify_email configured on the thread: a
 * third address, different from both the sender and the receiver, so that
 * "the reply really did arrive" can be verified independently.
 *
 * Same rule as Slack: for a filtered message only the reason is sent, never
 * the abusive text.
 */

export interface EmailNotifyArgs {
  to: string;
  threadId: string;
  subject: string;
  senderEmail: string;
  receiverEmail: string;
  fromEmail: string;
  bodyPreview: string;
  held: boolean;
  filterReason: string | null;
}

const PREVIEW_LIMIT = 500;

export async function notifyEmail(args: EmailNotifyArgs): Promise<void> {
  if (!args.to) {
    throw new Error("This thread has no notify_email and DEFAULT_NOTIFY_EMAIL is empty");
  }

  const badge = args.held ? "[Filtered]" : "[New reply]";
  const link = `${env.appUrl}/admin?thread=${args.threadId}`;

  const body = args.held
    ? [
        `${args.fromEmail} replied in the thread \u201c${args.subject}\u201d.`,
        "",
        "The message was hidden by the content filter, so the sender cannot see it.",
        `Reason: ${args.filterReason ?? "not recorded"}`,
        "",
        "The original text was not deleted \u2014 you can read it in the admin view:",
        link,
      ].join("\n")
    : [
        `${args.fromEmail} replied in the thread \u201c${args.subject}\u201d:`,
        "",
        args.bodyPreview.slice(0, PREVIEW_LIMIT) +
          (args.bodyPreview.length > PREVIEW_LIMIT ? "…" : ""),
        "",
        `Thread: ${args.senderEmail} \u21c4 ${args.receiverEmail}`,
        link,
      ].join("\n");

  await resendProvider.send({
    from: `${env.mailFromName} Notifications <${env.mailFrom}>`,
    to: args.to,
    // A notification should not be answered into the relay chain, so point
    // Reply-To back at our own address.
    replyTo: env.mailFrom,
    subject: `${badge} ${args.subject}`,
    text: body,
  });
}
