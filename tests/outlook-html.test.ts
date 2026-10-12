import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { htmlToPlainText, stripReply, truncateHtmlAtQuote } from "../lib/reply/strip";

/**
 * The Outlook HTML-only path, exercised with a real sample.
 *
 * This HTML was exported from the production database and was actually produced
 * by NTU's Outlook with a Chinese UI - not hand-written. Its structure is exactly
 * the trap the unit tests were originally written around:
 *
 *   <div class="elementToProof">nice to meet you</div>   <- the actual reply
 *   <div id="appendonsend"></div>                        <- the boundary marker
 *   <hr>
 *   <div id="divRplyFwdMsg">发件人: / 发送时间: ...</div>   <- the quote header
 *   <div class="BodyFragment">...quoted body...</div>     <- a SIBLING, not a child
 *
 * Skipping the #divRplyFwdMsg container alone is not enough: the quoted body
 * lives outside it and would still be converted to text. The HTML string has to
 * be truncated at the marker instead.
 */
const REAL_OUTLOOK_HTML = readFileSync(
  new URL("./fixtures/outlook-real-reply.html", import.meta.url),
  "utf8",
);

describe("Outlook HTML-only (real sample)", () => {
  it("takes the HTML path when text is empty and strips the body cleanly", () => {
    const { stripped, source } = stripReply({ text: null, html: REAL_OUTLOOK_HTML });

    expect(source).toBe("html");
    expect(stripped).toBe("nice to meet you");
  });

  it("leaves nothing of the quoted body in the sibling node - the easiest thing to miss", () => {
    const { stripped } = stripReply({ text: null, html: REAL_OUTLOOK_HTML });

    expect(stripped).not.toContain("Confirmed for Tuesday");
    expect(stripped).not.toContain("Non-NTU Email");
  });

  it("leaves nothing of the Chinese quote header", () => {
    const { stripped } = stripReply({ text: null, html: REAL_OUTLOOK_HTML });

    expect(stripped).not.toContain("发件人");
    expect(stripped).not.toContain("发送时间");
    expect(stripped).not.toContain("收件人");
  });

  it("truncates at #appendonsend, which appears before divRplyFwdMsg", () => {
    const truncated = truncateHtmlAtQuote(REAL_OUTLOOK_HTML);

    expect(truncated).toContain("nice to meet you");
    expect(truncated).not.toContain("appendonsend");
    expect(truncated).not.toContain("divRplyFwdMsg");
    expect(truncated).not.toContain("BodyFragment");
  });

  it("does not leave the dashes converted from <hr> at the end of the body", () => {
    const text = htmlToPlainText(REAL_OUTLOOK_HTML);
    const { stripped } = stripReply({ text: null, html: REAL_OUTLOOK_HTML });

    // The conversion may produce dashes, but the final output must be clean
    expect(stripped).not.toMatch(/^[-_=*]{3,}$/m);
    expect(text.length).toBeGreaterThan(0);
  });

  it("normalises &nbsp; to an ordinary space", () => {
    const { stripped } = stripReply({ text: null, html: REAL_OUTLOOK_HTML });
    expect(stripped).not.toContain(" ");
  });

  it("prefers text when both text and html are present (real mail is usually multipart)", () => {
    const { source } = stripReply({
      text: "nice to meet you\n________________________________\n发件人: x",
      html: REAL_OUTLOOK_HTML,
    });
    expect(source).toBe("text");
  });
});
