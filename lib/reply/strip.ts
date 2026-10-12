import EmailReplyParser from "email-reply-parser";
import { convert } from "html-to-text";

/**
 * Quote and signature stripping.
 *
 * Postmark's inbound payload ships a StrippedTextReply; Resend does not, so all
 * of this has to be implemented here. Three layers of safety net: strip quote
 * containers out of the HTML, then email-reply-parser, then our own regexes.
 *
 * The original always lives separately in bodyRaw - what this module returns
 * only affects display.
 */

export interface StripInput {
  text?: string | null;
  html?: string | null;
}

export interface StripResult {
  stripped: string;
  /** Whether the body came from plain text or was converted from HTML - useful when debugging. */
  source: "text" | "html" | "empty";
}

/**
 * The containers each client wraps quoted text in.
 * Skipping the whole block before converting HTML to text is far more reliable
 * than converting first and guessing with regexes afterwards.
 */
const QUOTE_SELECTORS = [
  ".gmail_quote", // Gmail
  ".gmail_signature",
  "#divRplyFwdMsg", // The "original message" separator in Outlook desktop and web
  "#appendonsend", // Newer Outlook
  "#Signature",
  "blockquote[type=cite]", // Apple Mail and most other clients
  ".yahoo_quoted", // Yahoo
  ".moz-cite-prefix", // Thunderbird
  "#OLK_SRC_BODY_SECTION", // Outlook for Mac
  ".protonmail_quote", // Proton
  ".zmail_extra", // Zoho
] as const;

/**
 * Markers meaning "everything from here down is quoted".
 *
 * Skipping the containers is not enough: Outlook puts the original body in a
 * SIBLING of #divRplyFwdMsg, so skipping the container itself still lets the
 * quoted body through. The string has to be truncated at the marker instead.
 */
const HTML_QUOTE_MARKER_RE =
  /<[a-z]+[^>]*\b(?:id|class)\s*=\s*["'][^"']*\b(?:divRplyFwdMsg|appendonsend|gmail_quote|gmail_signature|yahoo_quoted|protonmail_quote|moz-cite-prefix|OLK_SRC_BODY_SECTION|zmail_extra|Signature)\b/i;

const HTML_BLOCKQUOTE_CITE_RE = /<blockquote[^>]*\btype\s*=\s*["']?cite\b/i;

export function truncateHtmlAtQuote(html: string): string {
  const indices = [HTML_QUOTE_MARKER_RE, HTML_BLOCKQUOTE_CITE_RE]
    .map((re) => html.search(re))
    .filter((i) => i >= 0);

  if (indices.length === 0) return html;
  return html.slice(0, Math.min(...indices));
}

export function htmlToPlainText(html: string): string {
  return convert(truncateHtmlAtQuote(html), {
    wordwrap: false,
    selectors: [
      ...QUOTE_SELECTORS.map((selector) => ({ selector, format: "skip" as const })),
      // Images and link targets are only noise once flattened to plain text
      { selector: "img", format: "skip" as const },
      { selector: "a", options: { ignoreHref: true } },
    ],
  });
}

/**
 * Markers for the start of a quote block. On any match, everything from that
 * line down is discarded. Order does not matter - the earliest match wins.
 */
const QUOTE_LINE_PATTERNS: RegExp[] = [
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  /^\s*_{10,}\s*$/, // Outlook's long underscore separator
  /^\s*From:\s*.+$/i, // Outlook quote header (further validated by the Sent/To lookahead)
  /^\s*发件人\s*[:：]/,
  /^\s*寄件者\s*[:：]/,
  /^\s*>/, // The classic quote prefix
  /^\s*在.{0,100}写道\s*[:：]\s*$/, // Chinese-language clients
  /^\s*.{0,120}\s+于\s*.{0,60}\s*写道\s*[:：]/,
];

/** "On <date> <someone> wrote:" - Gmail often wraps it over two or three lines, so match across them. */
const ON_WROTE_RE = /^\s*(On|Le|El|Am|Op)\b[\s\S]{0,300}?\bwrote\s*:\s*$/i;
const ON_WROTE_LOCALIZED_RE =
  /^\s*(Le|El|Am|Op)\b[\s\S]{0,300}?\b(a écrit|escribió|schrieb|schreef)\s*:\s*$/i;

/**
 * Outlook's `From:` quote header is easy to confuse with a normal "From: ..."
 * that appears in the body. Only accept it when Sent/Date/To follows.
 */
function isOutlookQuoteHeader(lines: string[], i: number): boolean {
  if (!/^\s*(From|发件人|寄件者)\s*[:：]/i.test(lines[i])) return false;
  const lookahead = lines.slice(i + 1, i + 4).join("\n");
  return /^\s*(Sent|Date|To|发送时间|日期|收件人)\s*[:：]/im.test(lookahead);
}

export function stripQuotedText(text: string): string {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*(From|发件人|寄件者)\s*[:：]/i.test(line)) {
      if (isOutlookQuoteHeader(lines, i)) return lines.slice(0, i).join("\n");
      continue; // An ordinary "From: ..." in the body does not count
    }

    if (QUOTE_LINE_PATTERNS.some((re) => re.test(line))) {
      return lines.slice(0, i).join("\n");
    }

    // "On ... wrote:" can span up to three lines
    if (/^\s*(On|Le|El|Am|Op)\b/i.test(line)) {
      const window = lines.slice(i, i + 3).join("\n");
      if (ON_WROTE_RE.test(window) || ON_WROTE_LOCALIZED_RE.test(window)) {
        return lines.slice(0, i).join("\n");
      }
    }
  }

  return text;
}

/** Markers for the start of a signature. */
const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/, // The RFC 3676 "-- " separator
  /^__+\s*$/,
  /^\s*Sent from my \w+/i,
  /^\s*Sent from Mail for Windows/i,
  /^\s*Get Outlook for (iOS|Android)/i,
  /^\s*发自我的\S+/,
  /^\s*来自(我的)?\S+手机/,
];

export function stripSignature(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (SIGNATURE_PATTERNS.some((re) => re.test(lines[i]))) {
      return lines.slice(0, i).join("\n");
    }
  }
  return text;
}

function tidy(text: string): string {
  return text
    .replace(/\u00a0/g, " ") // &nbsp; left over from the HTML conversion
    .replace(/[ \t]+$/gm, "")
    // Outlook's <hr> flattens to a long run of dashes, which is left dangling
    // at the end after truncation
    .replace(/(?:^|\n)[-_=*]{3,}[ \t]*$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripReply(input: StripInput): StripResult {
  const hasText = Boolean(input.text && input.text.trim());
  const source: StripResult["source"] = hasText
    ? "text"
    : input.html && input.html.trim()
      ? "html"
      : "empty";

  if (source === "empty") return { stripped: "", source };

  // Outlook frequently sends HTML only. Stripping the quote containers before
  // converting to text is much more accurate than converting and then guessing.
  let body = source === "text" ? input.text! : htmlToPlainText(input.html!);

  // The main parser. It handles Gmail-style replies well but cannot cope with
  // Outlook's HTML-converted text, so our own rules run afterwards as well.
  try {
    const parsed = new EmailReplyParser().parseReply(body);
    // The parser occasionally swallows the entire message; in that case keep
    // what we had and let the next layer deal with it
    if (parsed && parsed.trim()) body = parsed;
  } catch {
    // A parser exception must not lose the message; fall through to the regexes
  }

  body = stripQuotedText(body);
  body = stripSignature(body);

  return { stripped: tidy(body), source };
}
