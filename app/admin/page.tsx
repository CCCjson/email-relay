"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import type { MessageView, ThreadDetail, ThreadSummary } from "@/lib/types";

const POLL_MS = 5000;
const TOKEN_KEY = "relay-admin-token";

interface UnmatchedRow {
  id: string;
  reason: string;
  createdAt: string;
}

/**
 * The admin view.
 *
 * A demo NEEDS somewhere that filtered messages can actually be seen. Without
 * it there is no way to verify the filter is running at all, and it just looks
 * unfinished. So this page lays out everything: HELD messages, the reason they
 * were held, the raw text, the outcome of each notification, and the inbound
 * emails that matched no thread.
 */
export default function AdminView() {
  const [token, setToken] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch("/api/threads?view=admin", { headers: { "x-admin-token": token } })
      .then((r) => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, [token]);

  if (!token || !authed) {
    return <TokenGate current={token} failed={Boolean(token) && !authed} onSubmit={setToken} />;
  }

  return <AdminBoard token={token} />;
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
        <h1 className="text-base font-semibold">Admin view</h1>
        <p className="text-xs text-slate-500">Enter the ADMIN_TOKEN from your environment</p>
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

function AdminBoard({ token }: { token: string }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const headers = { "x-admin-token": token };

  const refresh = useCallback(async () => {
    const [tRes, uRes] = await Promise.all([
      fetch("/api/threads?view=admin", { headers, cache: "no-store" }),
      fetch("/api/unmatched", { headers, cache: "no-store" }),
    ]);
    if (tRes.ok) setThreads((await tRes.json()).threads);
    if (uRes.ok) setUnmatched((await uRes.json()).unmatched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadDetail = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/threads/${id}?view=admin`, {
        headers,
        cache: "no-store",
      });
      if (res.ok) setDetail(await res.json());
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [token],
  );

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      refresh();
      if (activeId) loadDetail(activeId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, refresh, loadDetail]);

  useEffect(() => {
    if (activeId) loadDetail(activeId);
  }, [activeId, loadDetail]);

  const heldCount = detail?.messages.filter((m) => m.status === "HELD").length ?? 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Email Relay</h1>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Admin view
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUnmatched((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Unmatched inbound ({unmatched.length})
          </button>
          <a
            href="/"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Sender view
          </a>
        </div>
      </header>

      {showUnmatched && <UnmatchedPanel rows={unmatched} />}

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          {threads.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No threads yet</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  activeId === t.id ? "bg-slate-100" : ""
                }`}
              >
                <div className="truncate text-sm font-medium">{t.subject}</div>
                <div className="truncate text-xs text-slate-500">
                  {t.senderEmail} ⇄ {t.receiverEmail}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                </div>
              </button>
            ))
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-white">
          {!detail ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Select a thread on the left
            </div>
          ) : (
            <div className="mx-auto max-w-3xl p-6">
              <div className="mb-4 border-b border-slate-200 pb-4">
                <h2 className="text-sm font-semibold">{detail.thread.subject}</h2>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600">
                  <div>Sender: {detail.thread.senderEmail}</div>
                  <div>Receiver: {detail.thread.receiverEmail}</div>
                  <div>Notify: {detail.thread.notifyEmail ?? "not set"}</div>
                  <div className="font-mono">Reply token: {detail.thread.token}</div>
                </dl>
                {heldCount > 0 && (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    ⚠️ {heldCount} message(s) in this thread were filtered. They do not
                    appear in the sender view at all.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                {detail.messages.map((m) => (
                  <AdminMessage key={m.id} message={m} />
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AdminMessage({ message }: { message: MessageView }) {
  const [showRaw, setShowRaw] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const held = message.status === "HELD";

  return (
    <div
      className={`rounded-lg border p-4 ${
        held ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          {message.direction === "OUTBOUND" ? "\u2192 Outbound" : "\u2190 Inbound"}{" "}
          · {message.fromEmail}
        </span>
        <span>{formatTime(message.createdAt)}</span>
      </div>

      <p className="whitespace-pre-wrap text-sm text-slate-900">{message.body}</p>

      {held && (
        <div className="mt-3 space-y-1 rounded-md bg-white/70 px-3 py-2 text-xs text-amber-900">
          <div className="font-medium">
            Filtered (Stage {message.filterStage}
            {message.filterDegraded && ", degraded path"})
          </div>
          <div>Reason: {message.filterReason}</div>
          <div>
            Categories: {(message.filterCategories ?? []).join(", ") || "none"} · Score:{" "}
            {message.filterScore?.toFixed(2) ?? "\u2014"}
          </div>
        </div>
      )}

      {message.notifications && message.notifications.length > 0 && (
        <div className="mt-2 flex gap-2 text-xs">
          {message.notifications.map((n) => (
            <span
              key={n.id}
              title={n.error ?? undefined}
              className={`rounded px-2 py-0.5 ${
                n.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
              }`}
            >
              {n.channel} {n.ok ? "✓" : "✗"}
            </span>
          ))}
        </div>
      )}

      {message.bodyRaw && message.bodyRaw !== message.body && (
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="mt-2 text-xs text-slate-500 underline"
        >
          {showRaw ? "Hide raw text" : "View raw text (before quote stripping)"}
        </button>
      )}
      {showRaw && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-600">
          {message.bodyRaw}
        </pre>
      )}

      {message.bodyHtml && (
        <button
          onClick={() => setShowHtml((v) => !v)}
          className="ml-3 mt-2 text-xs text-slate-500 underline"
        >
          {showHtml ? "Hide raw HTML" : "View raw HTML"}
        </button>
      )}
      {showHtml && message.bodyHtml && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-[11px] text-slate-600">
          {message.bodyHtml}
        </pre>
      )}
    </div>
  );
}

function UnmatchedPanel({ rows }: { rows: UnmatchedRow[] }) {
  return (
    <div className="max-h-64 overflow-y-auto border-b border-slate-200 bg-slate-50 px-6 py-3">
      <h3 className="mb-2 text-xs font-semibold text-slate-700">
        Inbound emails that matched no thread
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">None &mdash; every inbound email matched a thread.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded border border-slate-200 bg-white p-2 text-xs">
              <div className="text-slate-400">{formatTime(r.createdAt)}</div>
              <div className="font-mono text-slate-700">{r.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
