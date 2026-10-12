"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import type { MessageView, ThreadDetail, ThreadSummary } from "@/lib/types";

const POLL_MS = 5000;
const TOKEN_KEY = "relay-app-token";

/**
 * The sender view is not public.
 *
 * It lists every thread together with the sender, receiver and notification
 * addresses and the message bodies, so leaving it open hands the whole
 * conversation history to anyone who knows the URL. One shared token gates it,
 * separate from ADMIN_TOKEN because the admin view additionally exposes the
 * messages the filter held back.
 *
 * A `?token=` in the URL is accepted once, stored, and stripped from the address
 * bar, so a single link is enough to hand the demo to somebody.
 */
function readToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  if (!fromUrl) return localStorage.getItem(TOKEN_KEY);

  localStorage.setItem(TOKEN_KEY, fromUrl);
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.toString());
  return fromUrl;
}

export default function SenderView() {
  const [token, setToken] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setToken(readToken());
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch("/api/threads", { headers: { "x-app-token": token }, cache: "no-store" })
      .then((r) => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, [token]);

  if (!token || !authed) {
    return (
      <TokenGate current={token} failed={Boolean(token) && !authed} onSubmit={setToken} />
    );
  }

  return <SenderBoard token={token} />;
}

function TokenGate({
  current,
  failed,
  onSubmit,
}: {
  current: string | null;
  failed: boolean;
  onSubmit: (t: string) => void;
}) {
  return (
    <div className="flex h-screen items-center justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = (new FormData(e.currentTarget).get("token") as string).trim();
          localStorage.setItem(TOKEN_KEY, value);
          onSubmit(value);
        }}
        className="w-80 space-y-3 rounded-lg border border-slate-200 bg-white p-6"
      >
        <h1 className="text-base font-semibold">Email Relay</h1>
        <p className="text-xs text-slate-500">
          Enter the access token to open the sender view
        </p>
        <input
          name="token"
          type="password"
          defaultValue={current ?? ""}
          required
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {failed && <p className="text-xs text-red-600">Wrong token</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Enter
        </button>
      </form>
    </div>
  );
}

function SenderBoard({ token }: { token: string }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/threads", {
      headers: { "x-app-token": token },
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json();
    setThreads(data.threads);
    return data.threads as ThreadSummary[];
  }, [token]);

  const loadDetail = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/threads/${id}`, {
        headers: { "x-app-token": token },
        cache: "no-store",
      });
      if (!res.ok) return;
      setDetail(await res.json());
    },
    [token],
  );

  // Poll every 5 seconds. SSE was out of scope for a one-day build - the README
  // notes it as an upgrade.
  useEffect(() => {
    loadThreads();
    const timer = setInterval(() => {
      loadThreads();
      if (activeId) loadDetail(activeId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, loadThreads, loadDetail]);

  useEffect(() => {
    if (activeId) loadDetail(activeId);
    else setDetail(null);
  }, [activeId, loadDetail]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Email Relay</h1>
          <span className="text-sm text-slate-500">Sender view</span>
        </div>
        <a
          href="/admin"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Admin view
        </a>
      </header>

      <div className="flex min-h-0 flex-1">
        <ThreadList
          threads={threads}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setComposing(false);
          }}
          onNew={() => {
            setActiveId(null);
            setComposing(true);
          }}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-white">
          {error && (
            <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {composing || (!activeId && threads.length === 0) ? (
            <ComposeNew
              token={token}
              onSent={async (threadId) => {
                setComposing(false);
                await loadThreads();
                setActiveId(threadId);
              }}
              onError={setError}
            />
          ) : detail ? (
            <Conversation
              token={token}
              detail={detail}
              onSent={() => loadDetail(detail.thread.id)}
              onError={setError}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Select a thread on the left
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ThreadList({
  threads,
  activeId,
  onSelect,
  onNew,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <button
          onClick={onNew}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New thread
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No threads yet</p>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                activeId === t.id ? "bg-slate-100" : ""
              }`}
            >
              <div className="truncate text-sm font-medium">{t.subject}</div>
              <div className="truncate text-xs text-slate-500">{t.receiverEmail}</div>
              {t.lastMessage && (
                <div className="mt-1 truncate text-xs text-slate-400">
                  {t.lastMessage.direction === "INBOUND" ? "← " : ""}
                  {t.lastMessage.preview}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function ComposeNew({
  token,
  onSent,
  onError,
}: {
  token: string;
  onSent: (threadId: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onError(null);
    setSending(true);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-token": token },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to send");
      onSent(data.threadId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const field = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl space-y-4 p-8">
      <h2 className="text-base font-semibold">New thread</h2>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Your email</span>
          <input name="senderEmail" type="email" required className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Receiver email</span>
          <input name="receiverEmail" type="email" required className={field} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Notification email &mdash; must be different from both addresses above
        </span>
        <input name="notifyEmail" type="email" className={field} />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Subject</span>
        <input name="subject" required maxLength={200} className={field} />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Message</span>
        <textarea name="body" required rows={8} className={field} />
      </label>

      <p className="text-xs text-slate-500">
        The recipient sees your address as the sender name; the envelope address is this
        service&rsquo;s own verified domain. We hold no SPF/DKIM authorisation for your domain,
        so mail actually sent from your address would land in spam.
      </p>

      <button
        type="submit"
        disabled={sending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {sending ? "Sending\u2026" : "Send"}
      </button>
    </form>
  );
}

function Conversation({
  token,
  detail,
  onSent,
  onError,
}: {
  token: string;
  detail: ThreadDetail;
  onSent: () => void;
  onError: (msg: string | null) => void;
}) {
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail.messages.length]);

  async function handleReply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form).get("body") as string;
    if (!body?.trim()) return;

    onError(null);
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-token": token },
        body: JSON.stringify({
          senderEmail: detail.thread.senderEmail,
          receiverEmail: detail.thread.receiverEmail,
          notifyEmail: detail.thread.notifyEmail ?? "",
          subject: detail.thread.subject,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to send");
      form.reset();
      onSent();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="border-b border-slate-200 px-6 py-3">
        <h2 className="text-sm font-semibold">{detail.thread.subject}</h2>
        <p className="text-xs text-slate-500">
          {detail.thread.senderEmail} ⇄ {detail.thread.receiverEmail}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {detail.messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleReply} className="border-t border-slate-200 p-4">
        <textarea
          name="body"
          rows={3}
          placeholder="Write a message…"
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {sending ? "Sending\u2026" : "Send"}
          </button>
        </div>
      </form>
    </>
  );
}

function Bubble({ message }: { message: MessageView }) {
  const outbound = message.direction === "OUTBOUND";
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[70%]">
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
            outbound ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"
          }`}
        >
          {message.body}
        </div>
        <div
          className={`mt-1 text-xs text-slate-400 ${outbound ? "text-right" : "text-left"}`}
        >
          {formatTime(message.createdAt)}
          {message.attachmentCount > 0 &&
            ` \u00b7 ${message.attachmentCount} attachment(s) \u2014 not stored in v1`}
        </div>
      </div>
    </div>
  );
}
