/** Response shapes shared between the UI and the API. */

export interface ThreadSummary {
  id: string;
  subject: string;
  senderEmail: string;
  receiverEmail: string;
  notifyEmail: string | null;
  messageCount: number;
  updatedAt: string;
  lastMessage: {
    preview: string;
    createdAt: string;
    direction: "OUTBOUND" | "INBOUND";
    status: "VISIBLE" | "HELD";
  } | null;
}

export interface MessageView {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  fromEmail: string;
  toEmail: string;
  body: string;
  createdAt: string;
  attachmentCount: number;
  // Everything below is returned by the admin view only.
  status?: "VISIBLE" | "HELD";
  bodyRaw?: string;
  bodyHtml?: string | null;
  filterStage?: number | null;
  filterCategories?: string[] | null;
  filterScore?: number | null;
  filterReason?: string | null;
  filterDegraded?: boolean;
  notifications?: {
    id: string;
    channel: "SLACK" | "EMAIL";
    ok: boolean;
    error: string | null;
  }[];
}

export interface ThreadDetail {
  thread: {
    id: string;
    subject: string;
    senderEmail: string;
    receiverEmail: string;
    notifyEmail: string | null;
    createdAt: string;
    token?: string;
    tag?: string;
  };
  messages: MessageView[];
}
