import { stage1 } from "./stage1";
import { stage2 } from "./stage2";
import type { FilterCategory } from "./wordlist";

export type { FilterCategory } from "./wordlist";

/**
 * Orchestration of the two filter stages.
 *
 * Nothing is deleted, only hidden: every message is stored verbatim and this
 * module only decides its status. The sender view queries VISIBLE; the admin
 * view and the notification channels also see HELD messages and the reason.
 */

export interface FilterVerdict {
  status: "VISIBLE" | "HELD";
  /** Which stage blocked it; null when the message was allowed. */
  stage: 1 | 2 | null;
  categories: FilterCategory[];
  score: number;
  reason: string | null;
  /** Stage 2 timed out, errored, or was switched off, so a degraded path was taken. */
  degraded: boolean;
}

export async function filterMessage(text: string): Promise<FilterVerdict> {
  // ── Stage 1: deterministic wordlist ─────────────────────────────────
  const s1 = stage1(text);
  if (s1.hit) {
    return {
      status: "HELD",
      stage: 1,
      categories: s1.categories,
      score: s1.score,
      reason: `Wordlist match: ${s1.matches.map((m) => m.word).join(", ")}`,
      degraded: false,
    };
  }

  // ── Stage 2: model verdict (only when Stage 1 did not match) ────────
  const s2 = await stage2(text);
  if (s2.verdict === "block") {
    return {
      status: "HELD",
      stage: 2,
      categories: s2.categories,
      score: s2.severity,
      reason: s2.reason,
      degraded: s2.degraded,
    };
  }

  return {
    status: "VISIBLE",
    stage: null,
    categories: [],
    score: s2.severity,
    reason: null,
    degraded: s2.degraded,
  };
}

/**
 * Summary for the notification channels.
 *
 * Deliberately excludes the words that matched: the detailed reason, which
 * contains the profanity itself, stays in the database and the admin view.
 * Otherwise the Slack channel would carry the abuse verbatim and the filter
 * would only have moved it somewhere else.
 */
export function summarizeVerdict(verdict: FilterVerdict): string {
  if (verdict.status !== "HELD") return "";

  const parts = [
    verdict.stage === 1 ? "Wordlist match (Stage 1)" : "Model verdict (Stage 2)",
    verdict.categories.length > 0 ? `Categories: ${verdict.categories.join(", ")}` : null,
    `Score ${verdict.score.toFixed(2)}`,
    verdict.degraded ? "degraded path" : null,
  ].filter(Boolean);

  return parts.join(" \u00b7 ");
}
