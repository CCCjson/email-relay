import { env } from "../env";

/**
 * Slack notifications over an Incoming Webhook: no app to create, no OAuth.
 *
 * For a filtered message only the reason and a link are posted, never the
 * abusive text itself. Otherwise the filter would be pointless and would only
 * have moved the abuse somewhere else.
 */

export interface SlackNotifyArgs {
  threadId: string;
  subject: string;
  senderEmail: string;
  receiverEmail: string;
  bodyPreview: string;
  held: boolean;
  filterReason: string | null;
}

const PREVIEW_LIMIT = 200;

export async function notifySlack(args: SlackNotifyArgs): Promise<void> {
  if (!env.slackWebhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is not configured");
  }

  const link = `${env.appUrl}/admin?thread=${args.threadId}`;
  const badge = args.held ? "⚠️ Filtered" : "✅ Delivered";

  const preview = args.held
    ? `_Hidden from the sender. Reason: ${args.filterReason ?? "not recorded"}_`
    : args.bodyPreview.slice(0, PREVIEW_LIMIT) +
      (args.bodyPreview.length > PREVIEW_LIMIT ? "…" : "");

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `${badge}  New reply`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Subject*\n${args.subject}` },
        { type: "mrkdwn", text: `*Thread*\n${args.senderEmail} ⇄ ${args.receiverEmail}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: preview } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Relay" },
          url: link,
        },
      ],
    },
  ];

  const res = await fetch(env.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `${badge} New reply: ${args.subject}`, blocks }),
  });

  if (!res.ok) {
    throw new Error(`Slack returned ${res.status}: ${await res.text()}`);
  }
}
