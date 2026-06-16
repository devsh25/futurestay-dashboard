import { NextResponse } from "next/server";
import { fetchActiveGoogleCampaigns } from "@/lib/google";

/**
 * Live roster of currently-active Google Ads campaigns.
 *
 *   GET /api/google/campaigns
 *
 * Used by the FunnelCard dropdown to surface individual Google
 * campaigns as filter options. Returns `[{ id, name, status }]` —
 * the dropdown's display string is built client-side from `name`,
 * the funnel-filter payload submits the same `name` back, and the
 * server resolves it to an ID inside computeFunnelByCampaign.
 *
 * On any failure (developer-token blocked, network, OAuth refresh
 * fail, etc.) we return an empty list with HTTP 200 rather than
 * propagating the error — the dropdown falls back to "no Google
 * campaigns available" instead of breaking the whole funnel card.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // includePaused so the dropdown can offer recently-paused campaigns
    // (their historical funnel is still worth inspecting).
    const campaigns = await fetchActiveGoogleCampaigns({ includePaused: true });
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error("[/api/google/campaigns] failed:", err);
    return NextResponse.json({ campaigns: [], error: err instanceof Error ? err.message : "Unknown error" });
  }
}
