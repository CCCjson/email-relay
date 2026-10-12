import type { NextRequest } from "next/server";
import { env } from "./env";

/**
 * Static token checks.
 *
 * v1 has no user accounts and no multi-tenancy, but neither view can be left
 * open: the admin view can read the abusive text of filtered messages, and the
 * sender view lists every thread with its sender, receiver and notification
 * addresses plus the message bodies. Two separate tokens, so handing someone the
 * sender view does not hand them the admin view.
 *
 * Tokens are accepted either as a header (for API calls) or as a query parameter
 * (so a page can be opened straight from a browser).
 */

function matches(provided: string, expected: string): boolean {
  if (!provided) return false;

  // Reject on a length mismatch first, so the byte-by-byte compare below
  // cannot leak the expected length.
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function isAdmin(req: NextRequest): boolean {
  const provided =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token") ??
    "";

  return matches(provided, env.adminToken);
}

/**
 * May this request use the sender view at all?
 *
 * The admin token is accepted too: admin is strictly the higher privilege, and
 * the two views link to each other.
 */
export function isViewer(req: NextRequest): boolean {
  const provided =
    req.headers.get("x-app-token") ??
    new URL(req.url).searchParams.get("token") ??
    "";

  return matches(provided, env.appToken) || isAdmin(req);
}
