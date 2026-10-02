import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts, fetchAllCustomers } from "@/lib/hubspot";

/**
 * Warm the HubSpot Data Cache so a dashboard load never faces a cold
 * fetchAllContacts / fetchAllCustomers.
 *
 * Why this exists:
 *   Both fetchers are wrapped in unstable_cache (see lib/hubspot.ts),
 *   so once the cache is populated every dashboard route reads it in
 *   ~50ms. But on a cold cache, the first dashboard load fires 7-9
 *   serverless containers in parallel; each tries to populate the
 *   cache independently; HubSpot rate-limits them; most time out at
 *   Vercel's 60s cap; cache never populates; dashboard never loads.
 *
 *   This cron sidesteps that stampede by paying the full fetch cost
 *   ONCE from a single invocation (max 300s), with the two fetchers
 *   run sequentially (not in parallel) so they don't rate-limit each
 *   other. The populated Data Cache then stays valid for 25h — see
 *   DATA_CACHE_TTL_SECONDS in lib/hubspot.ts — which is why a daily
 *   cron is enough.
 *
 * Trigger paths:
 *   - Scheduled by Vercel via vercel.json (daily, Hobby-plan limit)
 *   - Manually via `?secret=<CRON_SECRET>` or
 *     `Authorization: Bearer <CRON_SECRET>` after a deploy that
 *     invalidates the cache key (e.g. CONTACT_PROPERTIES change).
 *
 * Returns a small JSON summary with timing + counts so a user triggering
 * it by hand can verify it worked.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  // Vercel's scheduler sets this header on cron invocations.
  if (req.headers.get("x-vercel-cron") !== null) return true;
  // Manual re-runs: ?secret=<CRON_SECRET> or `Authorization: Bearer <>`.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (qs && qs === secret) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const counts: Record<string, number> = {};

  // Sequential — two parallel full-paginations against HubSpot search
  // compete for the same rate budget and both end up slower overall
  // than running one after the other.
  // `force: true` bypasses the Blob read inside each fetcher so this
  // cron always re-paginates HubSpot and overwrites the Blob — the
  // whole point of a scheduled warm.
  try {
    const t0 = Date.now();
    const contacts = await fetchAllContacts({ force: true });
    timings.fetchAllContactsMs = Date.now() - t0;
    counts.contacts = contacts.length;
  } catch (err) {
    return NextResponse.json(
      { error: "fetchAllContacts failed", message: err instanceof Error ? err.message : String(err), timings, counts },
      { status: 500 },
    );
  }

  try {
    const t0 = Date.now();
    const customers = await fetchAllCustomers({ force: true });
    timings.fetchAllCustomersMs = Date.now() - t0;
    counts.customers = customers.length;
  } catch (err) {
    return NextResponse.json(
      { error: "fetchAllCustomers failed", message: err instanceof Error ? err.message : String(err), timings, counts },
      { status: 500 },
    );
  }

  const totalMs = Date.now() - startedAt;
  return NextResponse.json({
    ok: true,
    totalMs,
    timings,
    counts,
    note: "HubSpot Blob cache refreshed. Dashboard routes will serve from Blob until the next cron run.",
  });
}
