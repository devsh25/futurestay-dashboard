import { NextResponse } from "next/server";
import { fetchRecentGoogleAdGroups } from "@/lib/google";

/**
 * Live roster of currently-active Google Ads ad units (ad groups for
 * traditional campaigns, campaign rollups for Pmax / asset-group ones).
 *
 *   GET /api/google/campaigns
 *
 * Used by the FunnelCard dropdown to surface individual Google ad units
 * as filter options. Returns `{ campaigns: [...] }` where each entry has
 * a `name` (the row's display label — campaign name for single-ad-group /
 * Pmax campaigns, "Campaign › Ad Group" for multi-ad-group ones).
 *
 * Response keys are kept as `campaigns` (not `adGroups`) for backward
 * compat with the existing client — the unit changed but the dropdown
 * payload shape didn't.
 *
 * On any failure (developer-token blocked, network, OAuth refresh fail,
 * etc.) we return an empty list with HTTP 200 rather than propagating
 * the error — the dropdown falls back to "no Google entries available"
 * instead of breaking the whole funnel card.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const adGroups = await fetchRecentGoogleAdGroups(6);
    // Shape preserved so the existing dropdown rendering keeps working.
    // `id` is a synthetic "campId|adGroupId" string (or just campId for
    // Pmax rollups) — only used as a React key, the funnel API matches
    // on `name` (the label).
    const campaigns = adGroups.map((u) => ({
      id: u.adGroupId ? `${u.campaignId}|${u.adGroupId}` : u.campaignId,
      name: u.label,
      status: u.adGroupStatus ?? u.campaignStatus,
    }));
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error("[/api/google/campaigns] failed:", err);
    return NextResponse.json({ campaigns: [], error: err instanceof Error ? err.message : "Unknown error" });
  }
}
