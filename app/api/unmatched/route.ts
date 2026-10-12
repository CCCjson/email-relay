import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound emails that missed all three thread-matching layers.
 * If a reply was sent during a demo but never appeared in the UI, this is the
 * first place to look.
 */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Admin token required" }, { status: 401 });
  }

  const rows = await prisma.unmatchedInbound.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    unmatched: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt,
      payload: r.payload,
    })),
  });
}
