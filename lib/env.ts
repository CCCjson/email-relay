/**
 * Central place to read environment variables.
 *
 * Everything goes through a lazy getter: the Next.js build step does not have
 * the runtime environment, so reading these at module top level breaks the build.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example, fill it in, and restart.`,
    );
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get resendApiKey() {
    return required("RESEND_API_KEY");
  },
  get resendWebhookSecret() {
    return required("RESEND_WEBHOOK_SECRET");
  },
  get mailFrom() {
    return required("MAIL_FROM");
  },
  get mailFromName() {
    return optional("MAIL_FROM_NAME", "Relay");
  },
  get inboundDomain() {
    return required("INBOUND_DOMAIN");
  },
  get slackWebhookUrl() {
    return optional("SLACK_WEBHOOK_URL");
  },
  get defaultNotifyEmail() {
    return optional("DEFAULT_NOTIFY_EMAIL");
  },
  get openaiApiKey() {
    return optional("OPENAI_API_KEY");
  },
  get filterStage2Enabled() {
    return bool("FILTER_STAGE2_ENABLED", true);
  },
  get filterFailOpen() {
    return bool("FILTER_FAIL_OPEN", true);
  },
  get adminToken() {
    return required("ADMIN_TOKEN");
  },
  /**
   * Password for the sender view. Optional: when unset it falls back to
   * ADMIN_TOKEN, so the sender view is never left open by forgetting to set it.
   * Set it to something different from ADMIN_TOKEN in production - otherwise
   * whoever can use the sender view can also open the admin view, where the
   * filtered messages are readable.
   */
  get appToken() {
    return optional("APP_TOKEN") || required("ADMIN_TOKEN");
  },
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000");
  },
};
