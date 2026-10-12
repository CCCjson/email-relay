import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdmin, isViewer } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The thread list.
 *
 * In the sender view (the default) the message count includes VISIBLE messages
 * only. A filtered message must not leave even a trace of "one message is
 * hidden" in this view - that is what the requirement asks for.
 */
export async function GET(req: NextRequest) {
  const admin = new URL(req.url).searchParams.get("view") === "admin";
  if (admin && !isAdmin(req)) {
    return NextResponse.json({ error: "Admin token required" }, { status: 401 });
  }
  if (!admin && !isViewer(req)) {
    return NextResponse.json({ error: "Access token required" }, { status: 401 });
  }

  const threads = await prisma.thread.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      messages: {
        where: admin ? {} : { status: "VISIBLE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { bodyStripped: true, createdAt: true, direction: true, status: true },
      },
      _count: {
        select: { messages: admin ? {} : { where: { status: "VISIBLE" } } },
      },
    },
  });

  return NextResponse.json({
    threads: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      senderEmail: t.senderEmail,
      receiverEmail: t.receiverEmail,
      notifyEmail: t.notifyEmail,
      messageCount: t._count.messages,
      updatedAt: t.updatedAt,
      lastMessage: t.messages[0]
        ? {
            preview: t.messages[0].bodyStripped.slice(0, 120),
            createdAt: t.messages[0].createdAt,
            direction: t.messages[0].direction,
            status: t.messages[0].status,
          }
        : null,
    })),
  });
}
