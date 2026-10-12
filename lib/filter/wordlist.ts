/**
 * The deterministic wordlist behind Stage 1.
 *
 * Source: a trimmed LDNOOBW open-source list plus hand-added South and Southeast
 * Asian slang, which the general English lists miss but which is common in
 * hiring and outsourcing contexts like this one.
 *
 * severity only drives ordering and the Slack display. Whether a message is
 * blocked is decided by category, and every category blocks.
 */

export type FilterCategory = "profanity" | "slur" | "threat" | "harassment";

export interface WordEntry {
  word: string;
  category: FilterCategory;
  severity: number;
}

export const WORDLIST: WordEntry[] = [
  // ── General profanity ───────────────────────────────────────────────────
  { word: "fuck", category: "profanity", severity: 0.7 },
  { word: "fucker", category: "profanity", severity: 0.8 },
  { word: "fucking", category: "profanity", severity: 0.6 },
  { word: "motherfucker", category: "profanity", severity: 0.9 },
  { word: "shit", category: "profanity", severity: 0.5 },
  { word: "bullshit", category: "profanity", severity: 0.5 },
  { word: "bitch", category: "profanity", severity: 0.8 },
  { word: "bastard", category: "profanity", severity: 0.7 },
  { word: "asshole", category: "profanity", severity: 0.8 },
  { word: "arsehole", category: "profanity", severity: 0.8 },
  { word: "dickhead", category: "profanity", severity: 0.8 },
  { word: "prick", category: "profanity", severity: 0.7 },
  { word: "cunt", category: "profanity", severity: 0.95 },
  { word: "wanker", category: "profanity", severity: 0.7 },
  { word: "twat", category: "profanity", severity: 0.7 },
  { word: "slut", category: "profanity", severity: 0.85 },
  { word: "whore", category: "profanity", severity: 0.85 },
  { word: "douchebag", category: "profanity", severity: 0.6 },
  { word: "jackass", category: "profanity", severity: 0.5 },
  { word: "dumbass", category: "profanity", severity: 0.6 },
  { word: "piss", category: "profanity", severity: 0.4 },

  // Common respellings. Censor characters are handled by the Stage 1 regex
  // (f*ck), but letter substitutions (f0ck, which folds to fock) have to be
  // listed explicitly.
  { word: "fck", category: "profanity", severity: 0.7 },
  { word: "fuk", category: "profanity", severity: 0.7 },
  { word: "fuq", category: "profanity", severity: 0.7 },
  { word: "fock", category: "profanity", severity: 0.7 },
  { word: "phuck", category: "profanity", severity: 0.7 },
  { word: "shyt", category: "profanity", severity: 0.5 },
  { word: "shite", category: "profanity", severity: 0.5 },
  { word: "biatch", category: "profanity", severity: 0.8 },
  { word: "btch", category: "profanity", severity: 0.8 },
  { word: "azzhole", category: "profanity", severity: 0.8 },

  // ── Insults aimed at a person, not at the work ──────────────────────────
  //
  // Only words that are almost certainly abuse regardless of context belong here.
  // worthless / pathetic / clown / loser / crap / you will regret used to be on
  // this list and have been removed: they are far too common in legitimate
  // negative feedback ("this deliverable is worthless", "you will regret
  // signing"). Stage 1 is a hard block that the model cannot overturn, and the
  // cost of a false positive is a sender who believes nobody replied. Anything
  // that needs context goes to Stage 2 instead.
  { word: "idiot", category: "harassment", severity: 0.5 },
  { word: "moron", category: "harassment", severity: 0.55 },
  { word: "imbecile", category: "harassment", severity: 0.55 },
  { word: "scumbag", category: "harassment", severity: 0.7 },
  { word: "retard", category: "slur", severity: 0.85 },
  { word: "retarded", category: "slur", severity: 0.85 },

  // ── Slurs ───────────────────────────────────────────────────────────────
  // Blocked regardless of context; the model never gets a second opinion here.
  { word: "nigger", category: "slur", severity: 1.0 },
  { word: "nigga", category: "slur", severity: 1.0 },
  { word: "chink", category: "slur", severity: 1.0 },
  { word: "gook", category: "slur", severity: 1.0 },
  { word: "spic", category: "slur", severity: 1.0 },
  { word: "kike", category: "slur", severity: 1.0 },
  { word: "wetback", category: "slur", severity: 1.0 },
  { word: "towelhead", category: "slur", severity: 1.0 },
  { word: "raghead", category: "slur", severity: 1.0 },
  { word: "paki", category: "slur", severity: 0.95 },
  { word: "faggot", category: "slur", severity: 1.0 },
  { word: "fag", category: "slur", severity: 0.9 },
  { word: "tranny", category: "slur", severity: 0.95 },
  { word: "coolie", category: "slur", severity: 0.9 },

  // ── South / Southeast Asian slang (missing from the general English lists) ─
  { word: "bhenchod", category: "profanity", severity: 0.9 },
  { word: "behenchod", category: "profanity", severity: 0.9 },
  { word: "madarchod", category: "profanity", severity: 0.9 },
  { word: "madarchood", category: "profanity", severity: 0.9 },
  { word: "chutiya", category: "profanity", severity: 0.85 },
  { word: "chutiye", category: "profanity", severity: 0.85 },
  { word: "gandu", category: "profanity", severity: 0.8 },
  { word: "harami", category: "profanity", severity: 0.7 },
  { word: "kutta", category: "harassment", severity: 0.6 },
  { word: "kutti", category: "harassment", severity: 0.6 },
  { word: "randi", category: "profanity", severity: 0.9 },
  { word: "lauda", category: "profanity", severity: 0.75 },
  { word: "bakchod", category: "profanity", severity: 0.7 },
  { word: "puki", category: "profanity", severity: 0.7 },
  { word: "babi", category: "harassment", severity: 0.55 },
  { word: "pukimak", category: "profanity", severity: 0.9 },
  { word: "cibai", category: "profanity", severity: 0.9 },
  { word: "kanina", category: "profanity", severity: 0.85 },
  { word: "tangina", category: "profanity", severity: 0.85 },
  { word: "putangina", category: "profanity", severity: 0.9 },
  { word: "gago", category: "profanity", severity: 0.7 },
  { word: "bobo", category: "harassment", severity: 0.5 },

  // ── Threats ─────────────────────────────────────────────────────────────
  // A single word cannot establish a threat, so these are phrases that appear
  // almost exclusively in threatening context.
  { word: "kill you", category: "threat", severity: 1.0 },
  { word: "kill yourself", category: "threat", severity: 1.0 },
  { word: "kys", category: "threat", severity: 0.95 },
  { word: "hunt you down", category: "threat", severity: 1.0 },
  { word: "find you and", category: "threat", severity: 0.85 },
  { word: "beat you up", category: "threat", severity: 0.9 },
  { word: "watch your back", category: "threat", severity: 0.75 },
];

/**
 * Whitelist: blanked out of the text before matching.
 *
 * Boundary matching already prevents almost every Scunthorpe-style false
 * positive (the ass in assess never matches, because the boundary does not
 * hold). What remains here are the few cases that can still collide after
 * normalisation, plus place and person names that need an explicit exemption.
 */
export const WHITELIST: string[] = [
  "scunthorpe",
  "penistone",
  "lightwater",
  "cockburn",
  "cockpit",
  "cocktail",
  "shiitake",
  "assessment",
  "assessments",
  "assess",
  "assassin",
  "classic",
  "classics",
  "class",
  "analysis",
  "analyst",
  "analytics",
  "bassett",
  "grape",
  "therapist",
  "specialist",
  "dickinson",
  "hancock",
  "babcock",
  "titan",
  "titanium",
  "matsushita",
  "kutta software",
];
