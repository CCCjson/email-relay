import { describe, expect, it } from "vitest";

/**
 * Entry validation for /api/send.
 *
 * Pure logic only (no Next server), pinning down the rules themselves:
 * - a receiver on the inbound domain must be rejected (it loops back and the
 *   recipient never receives anything)
 * - sender == receiver must be allowed (testing with one mailbox is reasonable)
 */

const INBOUND_DOMAIN = "cccjsonstakexxxx828.com";

function isInboundDomain(receiver: string, inboundDomain: string): boolean {
  return receiver.toLowerCase().endsWith(`@${inboundDomain.toLowerCase()}`);
}

describe("receiver domain validation", () => {
  it.each([
    "demo@cccjsonstakexxxx828.com",
    "DEMO@CCCJSONSTAKEXXXX828.COM",
    "reply+abc@cccjsonstakexxxx828.com",
  ])("rejects an address on the inbound domain: %s", (addr) => {
    expect(isInboundDomain(addr, INBOUND_DOMAIN)).toBe(true);
  });

  it.each([
    "someone@gmail.com",
    "someone@outlook.com",
    // A subdomain does not count - only the exact inbound domain is blocked
    "someone@mail.cccjsonstakexxxx828.com",
    // The domain appearing in the local part must not trigger it either
    "cccjsonstakexxxx828.com@gmail.com",
  ])("allows an external address: %s", (addr) => {
    expect(isInboundDomain(addr, INBOUND_DOMAIN)).toBe(false);
  });
});
