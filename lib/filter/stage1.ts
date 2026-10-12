import { normalize } from "./normalize";
import { WHITELIST, WORDLIST, type FilterCategory, type WordEntry } from "./wordlist";

/**
 * Stage 1: deterministic wordlist matching.
 *
 * A match blocks immediately and the model is never called. This stage has to be
 * fast and explainable: during a demo you must be able to point at one word and
 * say "that is what blocked it".
 */

export interface Stage1Match {
  word: string;
  category: FilterCategory;
  severity: number;
}

export interface Stage1Result {
  hit: boolean;
  matches: Stage1Match[];
  categories: FilterCategory[];
  /** The highest severity among the matches. */
  score: number;
}

/** Censor characters. After leet folding these are what remain: f*ck / sh#t / b%tch. */
const CENSOR_CHARS = "*#%";

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile the matching regex for one wordlist entry.
 *
 * Boundaries use lookaround rather than \b: \b requires a \w/\W transition, which
 * does not hold for a spelling that ends in a censor character such as "fu**".
 * Lookaround only asks that the neighbouring character is not alphanumeric, which
 * covers both cases.
 *
 * The first letter stays literal and only later positions may be censored. Opening
 * up every position would make ordinary emphasis such as "****" read as profanity.
 */
function compile(entry: WordEntry): RegExp {
  const body = [...entry.word]
    .map((ch, i) => {
      if (ch === " ") return "\\s+";
      if (i === 0) return escapeRegex(ch);
      return `[${escapeRegex(ch)}${CENSOR_CHARS}]`;
    })
    .join("");

  // (?:s|es)? covers plurals without loosening the right boundary: in "assess",
  // ass + es is still followed by an s, so the trailing lookahead still rejects it.
  return new RegExp(`(?<![a-z0-9])${body}(?:s|es)?(?![a-z0-9])`, "g");
}

const COMPILED: { entry: WordEntry; re: RegExp }[] = WORDLIST.map((entry) => ({
  entry,
  re: compile(entry),
}));

const WHITELIST_RE = new RegExp(
  `(?<![a-z0-9])(?:${WHITELIST.map((w) => w.replace(/\s+/g, "\\s+")).join("|")})(?![a-z0-9])`,
  "g",
);

/** Blank out whitelisted words before matching, so normalisation cannot make them collide. */
function maskWhitelist(text: string): string {
  return text.replace(WHITELIST_RE, (m) => " ".repeat(m.length));
}

export function stage1(input: string): Stage1Result {
  const { primary, separated } = normalize(input);
  const haystacks = [maskWhitelist(primary), maskWhitelist(separated)];

  const found = new Map<string, Stage1Match>();

  for (const { entry, re } of COMPILED) {
    for (const haystack of haystacks) {
      re.lastIndex = 0;
      if (re.test(haystack)) {
        found.set(entry.word, {
          word: entry.word,
          category: entry.category,
          severity: entry.severity,
        });
        break;
      }
    }
  }

  const matches = [...found.values()].sort((a, b) => b.severity - a.severity);

  return {
    hit: matches.length > 0,
    matches,
    categories: [...new Set(matches.map((m) => m.category))],
    score: matches.reduce((max, m) => Math.max(max, m.severity), 0),
  };
}
