/**
 * In-process rate limiting.
 *
 * Good enough for a demo: on Vercel every instance counts on its own and the
 * counters reset when an instance restarts. A production deployment that needs
 * a shared limit has to move to Redis / Upstash - noted as an upgrade in the README.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetInSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetInSeconds: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const resetInSeconds = Math.ceil((existing.resetAt - now) / 1000);

  // Sweep expired buckets while we are here, so a long-running process does
  // not creep upwards in memory.
  if (buckets.size > 1000) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }

  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetInSeconds,
  };
}
