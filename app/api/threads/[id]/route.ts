import { NextRequest, NextResponse } from "next/server";
import { isAdmin, isViewer } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The messages of a single thread.
 *
 * view=sender (the default) returns VISIBLE messages only and no filter fields
 * at all: the sender should not learn that a message was filtered, nor why.
 * view=admin returns everything, with the filter reason and the raw text.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = new URL(req.url).searchParams.get("view") === "admin";
  if (admin && !isAdmin(req)) {
    return NextResponse.json({ error: "Admin token required" }, { status: 401 });
  }
  if (!admin && !isViewer(req)) {
    return NextResponse.json({ error: "Access token required" }, { status: 401 });
  }

  const thread = await prisma.thread.findUnique({
    where: { id: params.id },
    include: {
      messages: {
        where: admin ? {} : { status: "VISIBLE" },
        orderBy: { createdAt: "asc" },
        include: admin ? { notifications: true } : undefined,
      },
    },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({
    thread: {
      id: thread.id,
      subject: thread.subject,
      senderEmail: thread.senderEmail,
      receiverEmail: thread.receiverEmail,
      notifyEmail: thread.notifyEmail,
      createdAt: thread.createdAt,
      // The token is exposed to the admin view only: it is part of the reply
      // address and therefore a credential for the thread.
      ...(admin ? { token: thread.token, tag: thread.tag } : {}),
    },
    messages: thread.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      fromEmail: m.fromEmail,
      toEmail: m.toEmail,
      body: m.bodyStripped,
      createdAt: m.createdAt,
      attachmentCount: m.attachmentCount,
      ...(admin
        ? {
            status: m.status,
            bodyRaw: m.bodyRaw,
            // Only the raw HTML explains what happened when debugging quote
            // stripping on an HTML-only reply. This field used to be stored but
            // never returned, which made it invisible in the admin view.
            bodyHtml: m.bodyHtml,
            filterStage: m.filterStage,
            filterCategories: m.filterCategories,
            filterScore: m.filterScore,
            filterReason: m.filterReason,
            filterDegraded: m.filterDegraded,
            notifications: "notifications" in m ? m.notifications : [],
          }
        : {}),
    })),
  });
}
