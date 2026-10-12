/**
 * Text normalisation: the preprocessing that runs before Stage 1 wordlist matching.
 *
 * The goal is to fold common evasions back to their base form:
 *   f*ck / fu ck / f.u.c.k / sh1t / @ss / fuuuck
 *
 * Word boundaries must never be sacrificed to achieve it. Lose the boundary and
 * class / assess / analysis / Scunthorpe all become false positives - the classic
 * Scunthorpe problem. So this module only folds; the actual matching always keeps
 * its boundary assertions.
 */

/** Leetspeak folding table. */
const LEET_MAP: Record<string, string> = {
  "@": "a",
  "4": "a",
  "8": "b",
  "(": "c",
  "<": "c",
  "3": "e",
  "6": "g",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
};

/** Strip Unicode combining accents: ｆｕｃｋ / fúck -> fuck. */
function deaccent(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function foldLeet(text: string): string {
  return text.replace(/[@48(<361!|05$7+]/g, (ch) => LEET_MAP[ch] ?? ch);
}

/**
 * Fold repeated characters: fuuuck -> fuck.
 * Only runs of three or more are folded. Folding two would turn assess into
 * asses and manufacture a false positive.
 */
function collapseRepeats(text: string): string {
  return text.replace(/(.)\1{2,}/g, "$1");
}

/**
 * Fold the "single letter plus separator" evasion: f.u.c.k / f-u-c-k / f u c k -> fuck.
 *
 * Only the shape "at least three single letters strung together by separators"
 * matches. Ordinary English prose does not look like that, so normal sentences
 * are left alone. Word boundaries still hold after folding.
 */
function foldSeparated(text: string): string {
  return text.replace(
    /\b(?:[a-z](?:[^a-z0-9\n]){1,2}){2,}[a-z]\b/gi,
    (m) => m.replace(/[^a-z0-9]/gi, ""),
  );
}

export interface Normalized {
  /** Primary variant: NFKC + lowercase + de-accent + leet folding + repeat folding. */
  primary: string;
  /** Extra variant: primary with the separator evasion folded as well. */
  separated: string;
}

export function normalize(input: string): Normalized {
  const base = collapseRepeats(
    foldLeet(deaccent(input.normalize("NFKC").toLowerCase())),
  );

  return {
    primary: base,
    // Separator folding runs after leet folding so that both f.u.c.k and
    // f.u.(.k are covered.
    separated: collapseRepeats(foldSeparated(base)),
  };
}
