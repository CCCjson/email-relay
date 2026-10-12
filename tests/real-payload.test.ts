import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripReply } from "../lib/reply/strip";
import { extractMessageIds, extractTag, extractToken } from "../lib/thread/token";
import { stage1 } from "../lib/filter/stage1";

/**
 * Run the whole parsing pipeline against a REAL Resend inbound email.
 *
 * The payload was actually received on the production domain (via the self-loop
 * probe in scripts), not hand-written. Resend's inbound field shapes are thinly
 * documented, so this test pins down what was observed in practice.
 */
const payload = JSON.parse(
  readFileSync(new URL("./fixtures/real-inbound.json", import.meta.url), "utf8"),
);

describe("a real Resend inbound email", () => {
  it("exposes received_for as the envelope recipient, so layer 1 can extract the token", () => {
    const token = extractToken([...payload.received_for, ...payload.to]);
    expect(token).toBe("00000000deadbeef");
  });

  it("returns headers as an object with lowercase keys", () => {
    expect(typeof payload.headers).toBe("object");
    const keys = Object.keys(payload.headers);
    expect(keys).toContain("message-id");
    expect(keys.every((k: string) => k === k.toLowerCase())).toBe(true);
  });

  it("lets layer 2 extract ids from the message-id headers", () => {
    const ids = extractMessageIds(payload.headers["message-id"]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("amazonses.com");
  });

  it("lets layer 3 extract the tag from the subject", () => {
    expect(extractTag(payload.subject)).toBe("0000");
  });

  it("strips the quote block and signature, leaving only the reply", () => {
    const { stripped, source } = stripReply({
      text: payload.text,
      html: payload.html,
    });

    expect(source).toBe("text");
    expect(stripped).toBe("Probe body line one.");
    expect(stripped).not.toContain("quoted text");
    expect(stripped).not.toContain("Probe Signature");
    expect(stripped).not.toContain("wrote:");
  });

  it("does not let Stage 1 flag clean text", () => {
    const { stripped } = stripReply({ text: payload.text, html: payload.html });
    expect(stage1(stripped).hit).toBe(false);
  });

  it("returns attachments as an array, which v1 only counts", () => {
    expect(Array.isArray(payload.attachments)).toBe(true);
    expect(payload.attachments).toHaveLength(0);
  });
});
