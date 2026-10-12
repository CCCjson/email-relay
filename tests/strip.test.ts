import { describe, expect, it } from "vitest";
import { stripQuotedText, stripReply, stripSignature } from "../lib/reply/strip";

describe("stripReply - Gmail web", () => {
  it("strips the 'On ... wrote:' quote block", () => {
    const text = [
      "Hey, got it — I'll take a look this afternoon.",
      "",
      "On Mon, Sep 7, 2026 at 10:02 AM Jason Chen (via Relay) <",
      "relay@example.com> wrote:",
      "",
      "> Hi Alex, can you confirm the kickoff date?",
      ">",
      "> Thanks",
      "",
    ].join("\n");

    expect(stripReply({ text }).stripped).toBe(
      "Hey, got it — I'll take a look this afternoon.",
    );
  });

  it("strips the gmail_quote container (HTML)", () => {
    const html = `<div dir="ltr">Sounds good, Tuesday works.</div>
<div class="gmail_quote">
  <div dir="ltr" class="gmail_attr">On Mon, Sep 7, 2026 at 10:02 AM Jason &lt;jason@example.com&gt; wrote:</div>
  <blockquote class="gmail_quote"><div dir="ltr">Does Tuesday work for you?</div></blockquote>
</div>`;

    const result = stripReply({ html });
    expect(result.source).toBe("html");
    expect(result.stripped).toBe("Sounds good, Tuesday works.");
  });
});

describe("stripReply — Outlook（HTML-only）", () => {
  it("strips the divRplyFwdMsg separator block", () => {
    const html = `<html><body>
<div>Thanks for the update. Let's proceed.</div>
<div id="appendonsend"></div>
<hr>
<div id="divRplyFwdMsg" dir="ltr">
  <b>From:</b> Jason Chen &lt;relay@example.com&gt;<br>
  <b>Sent:</b> Monday, September 7, 2026 10:02 AM<br>
  <b>To:</b> Alex<br>
  <b>Subject:</b> Project kickoff
</div>
<div>Original body text here that must not survive.</div>
</body></html>`;

    const out = stripReply({ html }).stripped;
    expect(out).toContain("Thanks for the update. Let's proceed.");
    expect(out).not.toContain("Original body text");
    expect(out).not.toContain("Sent:");
  });

  it("strips the plain-text form of the Outlook quote header", () => {
    const text = [
      "Approved.",
      "",
      "From: Jason Chen <relay@example.com>",
      "Sent: Monday, September 7, 2026 10:02 AM",
      "To: Alex Morgan",
      "Subject: Project kickoff",
      "",
      "Please approve the budget.",
    ].join("\n");

    expect(stripReply({ text }).stripped).toBe("Approved.");
  });

  it("strips the -----Original Message----- separator", () => {
    const text = [
      "See below.",
      "",
      "-----Original Message-----",
      "From: Jason Chen",
      "Sent: Monday",
      "",
      "old content",
    ].join("\n");

    expect(stripReply({ text }).stripped).toBe("See below.");
  });
});

describe("stripReply - Outlook with a Chinese UI (real sample)", () => {
  /**
   * Captured from a real reply sent by NTU's Outlook with a Chinese UI, not
   * constructed by hand.
   *
   * Two things that could previously only be guessed are confirmed by this data:
   * 1. The separator is a long run of underscores, not Gmail's "On ... wrote:"
   * 2. The quote header is in Chinese: `发件人: / 发送时间: / 收件人: / 主题:`
   *
   * Note also that the tenant's security banner for external mail sits INSIDE the
   * quote block: it was added to the message we sent, and came back quoted when
   * they replied, so it is stripped along with everything else.
   */
  const REAL_OUTLOOK_REPLY = [
    "nice to meet you",
    "________________________________",
    "发件人: jane001 (via Relay) <relay@cccjsonstakexxxx828.com>",
    "发送时间: 2026年9月10日 17:28",
    "收件人: #DOE JANE# <JANE001@e.university.edu>",
    "主题: outlook test [#84d1]",
    "",
    "        [Alert: Non-NTU Email] Be cautious before clicking any link or attachment.",
    "",
    " Confirmed for Tuesday 10am",
    "",
  ].join("\n");

  it("strips the underscore separator and the Chinese quote header", () => {
    expect(stripReply({ text: REAL_OUTLOOK_REPLY }).stripped).toBe("nice to meet you");
  });

  it("leaves no trace of the quoted-back tenant security banner", () => {
    const out = stripReply({ text: REAL_OUTLOOK_REPLY }).stripped;
    expect(out).not.toContain("Non-NTU Email");
    expect(out).not.toContain("Confirmed for Tuesday");
    expect(out).not.toContain("发送时间");
  });

  it("keeps only the part before the separator in a multi-line reply", () => {
    const multi = REAL_OUTLOOK_REPLY.replace(
      "nice to meet you",
      "nice to meet you\n\nlet me know if Tuesday still works",
    );
    expect(stripReply({ text: multi }).stripped).toBe(
      "nice to meet you\n\nlet me know if Tuesday still works",
    );
  });
});

describe("stripReply — iOS Mail", () => {
  it("strips the 'Sent from my iPhone' signature and the quote after it", () => {
    const text = [
      "On my way, 10 minutes out.",
      "",
      "Sent from my iPhone",
      "",
      "> On Sep 7, 2026, at 10:02 AM, Jason Chen <relay@example.com> wrote:",
      ">",
      "> Are you close?",
    ].join("\n");

    expect(stripReply({ text }).stripped).toBe("On my way, 10 minutes out.");
  });
});

describe("stripSignature", () => {
  it("truncates at the RFC 3676 '-- ' marker", () => {
    const text = ["Looks good to me.", "", "-- ", "Alex Morgan", "Head of Ops"].join("\n");
    expect(stripSignature(text).trim()).toBe("Looks good to me.");
  });

  it("strips a Chinese client signature", () => {
    const text = ["收到，明天回复你。", "", "发自我的iPhone"].join("\n");
    expect(stripSignature(text).trim()).toBe("收到，明天回复你。");
  });
});

describe("false-positive checks", () => {
  it("does not treat an ordinary 'From:' in the body as a quote header", () => {
    const text = [
      "Quick question about the form:",
      "From: which address should the invoice come from?",
      "Let me know.",
    ].join("\n");

    // No Sent/To/Date follows, so nothing should be truncated
    expect(stripQuotedText(text)).toBe(text);
  });

  it("keeps a sentence that starts with On but is not a quote header", () => {
    const text = "On second thought, let's push to Thursday.";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("returns a reply with no quote unchanged", () => {
    const text = "Yes, that works. Thanks!";
    expect(stripReply({ text }).stripped).toBe(text);
  });

  it("does not blow up on an empty body", () => {
    expect(stripReply({ text: null, html: null })).toEqual({
      stripped: "",
      source: "empty",
    });
  });

  it("falls back to html when text is empty", () => {
    const result = stripReply({ text: "   ", html: "<p>Fallback body</p>" });
    expect(result.source).toBe("html");
    expect(result.stripped).toBe("Fallback body");
  });
});
