import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeFunnelByCampaign } from "@/lib/funnel";
import { fetchMetaInsights } from "@/lib/meta";
import { fetchActiveGoogleCampaigns } from "@/lib/google";
import { PeriodFilter } from "@/lib/types";

/**
 * Per-campaign funnel scoping.
 *
 *   GET /api/funnel?period=custom&start=...&end=...&campaign=12.05%20%7C%20...
 *
 * The `campaign` param is expected to be a full Meta campaign name
 * (matches what the FunnelCard dropdown submits). We pass through the
 * list of currently-active Meta campaigns so computeFunnelByCampaign
 * can do per-Meta attribution (UTM / src2 / ref_source) — same logic
 * as Campaign Analysis — and exclude sibling campaigns sharing the
 * same bucket. If the submitted name doesn't match any active Meta
 * campaign, it's treated as a bucket key for backward compat.
 *
 * Reuses cached fetchAllContacts() so warm-cache calls are cheap.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const period = (params.get("period") || "allTime") as PeriodFilter;
    const customStart = params.get("start") || undefined;
    const customEnd = params.get("end") || undefined;
    const campaignParam = params.get("campaign") || null;
    const countriesParam = params.get("country") || "";
    const channelsParam = params.get("channels") || "";

    const countries = countriesParam ? countriesParam.split(",").filter(Boolean) : [];
    const channels = channelsParam ? channelsParam.split(",").filter(Boolean) : [];

    // Pull contacts + the active Meta + active Google campaign lists
    // in parallel. The Meta list drives per-Meta attribution; the
    // Google list resolves a submitted Google campaign NAME → numeric
    // ID for the utm_campaign match. Both campaign-list calls are
    // wrapped in .catch so a downed external API doesn't take the
    // whole funnel offline — the affected attribution path just goes
    // inert (the filter option becomes a no-op) while the rest works.
    const [contacts, metaInsights, googleCampaigns] = await Promise.all([
      fetchAllContacts(),
      fetchMetaInsights("2024-01-01", new Date().toISOString().slice(0, 10)).catch((err) => {
        console.error("[funnel] fetchMetaInsights failed, falling back to bucket attribution:", err);
        return { campaigns: [] as { name: string }[] };
      }),
      // includePaused so a paused campaign chosen in the dropdown can
      // still be resolved (name → id) and scoped here.
      fetchActiveGoogleCampaigns({ includePaused: true }).catch((err) => {
        console.error("[funnel] fetchActiveGoogleCampaigns failed:", err);
        return [] as { id: string; name: string; status: string }[];
      }),
    ]);
    const activeMetaCampaigns = metaInsights.campaigns.map((m) => m.name);
    const activeGoogleCampaigns = googleCampaigns.map((g) => ({ id: g.id, name: g.name }));

    const funnel = computeFunnelByCampaign(
      contacts,
      period,
      campaignParam,
      countries,
      channels,
      customStart,
      customEnd,
      activeMetaCampaigns,
      activeGoogleCampaigns,
    );

    return NextResponse.json({ funnel, campaign: campaignParam });
  } catch (error) {
    console.error("Funnel API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
