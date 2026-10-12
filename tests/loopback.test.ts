import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Loopback detection.
 *
 * Hit for real during live testing: an email we sent came back to the inbound
 * domain, layer-1 token matching failed, and the layer-3 subject tag claimed it -
 * so our own outgoing text was stored as a reply and pushed a notification.
 */

vi.mock("../lib/db", () => ({
  prisma: {
    thread: { findUnique: vi.fn(), findFirst: vi.fn() },
    message: { findFirst: vi.fn() },
  },
}));

process.env.MAIL_FROM = "relay@example.com";
process.env.INBOUND_DOMAIN = "example.com";

const { matchThread } = await import("../lib/thread/match");
const { prisma } = await import("../lib/db");

function inbound(overrides: Record<string, unknown> = {}) {
  return {
    providerMessageId: "e1",
    from: "alex@receiver.test",
    to: ["reply+aaaabbbbccccdddd@example.com"],
    receivedFor: ["reply+aaaabbbbccccdddd@example.com"],
    subject: "Re: Kickoff [#aaaa]",
    text: "body",
    html: null,
    headers: {},
    rfcMessageId: "<in@x>",
    attachmentCount: 0,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.mocked(prisma.thread.findUnique).mockReset().mockResolvedValue(null as never);
  vi.mocked(prisma.thread.findFirst).mockReset().mockResolvedValue(null as never);
  vi.mocked(prisma.message.findFirst).mockReset().mockResolvedValue(null as never);
});

describe("loopback detection", () => {
  it("treats our own envelope address as a loopback and skips matching entirely", async () => {
    const r = await matchThread(inbound({ from: "relay@example.com" }));

    expect(r.matched).toBe(false);
    expect((r as { reason: string }).reason).toContain("Loopback");
    // The point: not even one database query should be made
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.thread.findFirst).not.toHaveBeenCalled();
  });

  it("recognises the form with a display name", async () => {
    const r = await matchThread(
      inbound({ from: "Jason (via Relay) <relay@example.com>" }),
    );
    expect(r.matched).toBe(false);
    expect((r as { reason: string }).reason).toContain("Loopback");
  });

  it("is case insensitive", async () => {
    const r = await matchThread(inbound({ from: "<RELAY@EXAMPLE.COM>" }));
    expect((r as { reason: string }).reason).toContain("Loopback");
  });

  it("leaves a genuine reply alone - layer 1 still matches", async () => {
    vi.mocked(prisma.thread.findUnique).mockResolvedValue({ id: "t1" } as never);

    const r = await matchThread(inbound());
    expect(r).toEqual({ matched: true, threadId: "t1", layer: 1 });
  });

  it("does not let layer 3 claim a loopback even when the subject tag would match", async () => {
    // Layer 3 would otherwise match: this is exactly the scenario seen in production
    vi.mocked(prisma.thread.findFirst).mockResolvedValue({ id: "t1" } as never);

    const r = await matchThread(
      inbound({
        from: "relay@example.com",
        receivedFor: ["someone@example.com"], // no token
        to: ["someone@example.com"],
      }),
    );

    expect(r.matched).toBe(false);
    expect(prisma.thread.findFirst).not.toHaveBeenCalled();
  });
});
