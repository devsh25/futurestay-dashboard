import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeFunnelByCampaign } from "@/lib/funnel";
import { fetchMetaInsights } from "@/lib/meta";
import { fetchRecentGoogleAdGroups } from "@/lib/google";
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

    // Pull contacts + active Meta + active Google ad-group lists in
    // parallel. Meta drives per-Meta attribution; the Google ad-group
    // list resolves a submitted ad-unit LABEL back to a contact-
    // attribution decision. Both external calls are wrapped in .catch
    // so a downed API doesn't take the whole funnel offline — the
    // affected attribution path goes inert while the rest works.
    const [contacts, metaInsights, googleAdGroups] = await Promise.all([
      fetchAllContacts(),
      fetchMetaInsights("2024-01-01", new Date().toISOString().slice(0, 10)).catch((err) => {
        console.error("[funnel] fetchMetaInsights failed, falling back to bucket attribution:", err);
        return { campaigns: [] as { name: string }[] };
      }),
      // 6-month window so contacts attributed to a campaign / ad group
      // that was active during pre-template-fix days still resolve to
      // the correct ad unit.
      fetchRecentGoogleAdGroups(6).catch((err) => {
        console.error("[funnel] fetchRecentGoogleAdGroups failed:", err);
        return [] as Awaited<ReturnType<typeof fetchRecentGoogleAdGroups>>;
      }),
    ]);
    const activeMetaCampaigns = metaInsights.campaigns.map((m) => m.name);

    const funnel = computeFunnelByCampaign(
      contacts,
      period,
      campaignParam,
      countries,
      channels,
      customStart,
      customEnd,
      activeMetaCampaigns,
      googleAdGroups,
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
