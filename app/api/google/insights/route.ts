import { NextRequest, NextResponse } from "next/server";
import { fetchGoogleAdsAdGroupInsights, fetchRecentGoogleAdGroups } from "@/lib/google";
import { resolvedDateRange } from "@/lib/funnel";
import { GoogleAdsCampaignRow, GoogleAdsInsightsData, PeriodFilter } from "@/lib/types";

/**
 * Google Ads insights — per-campaign performance over the selected
 * period. Mirrors /api/meta/insights so the same client-side patterns
 * apply (GoogleAdsCard reads this; the Funnel dropdown also pulls
 * from /api/google/campaigns for the campaign roster).
 *
 * Always merges the active-campaign roster into the response, so a
 * brand-new campaign with $0 spend in the selected window still
 * surfaces in the table — mirrors the Meta-side behaviour.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const period = (params.get("period") || "allTime") as PeriodFilter;
    const customStart = params.get("start") || undefined;
    const customEnd = params.get("end") || undefined;

    let since: string;
    let until: string;
    if (period === "custom" && customStart && customEnd) {
      since = customStart;
      until = customEnd;
    } else {
      const { start, end } = resolvedDateRange(period);
      since = ymd(start);
      until = ymd(end);
    }

    const [insights, roster] = await Promise.all([
      fetchGoogleAdsAdGroupInsights(since, until),
      fetchRecentGoogleAdGroups(6).catch(() => [] as Awaited<ReturnType<typeof fetchRecentGoogleAdGroups>>),
    ]);

    // Key by label (already unique per ad unit). Filtering rules:
    //   1. INCLUDE any ad unit with spend > 0 in the window
    //      (even if currently paused — historical spend still matters)
    //   2. INCLUDE any ad unit in the active 6-month roster
    //      (currently ENABLED, even with $0 spend — freshly-launched
    //      ones still surface)
    //   3. EXCLUDE everything else.
    const rosterLabels = new Set(roster.map((r) => r.label));
    const insightsFiltered = insights.filter((i) => i.cost > 0 || rosterLabels.has(i.label));
    const presentLabels = new Set(insightsFiltered.map((i) => i.label));
    const merged: GoogleAdsCampaignRow[] = [
      ...insightsFiltered.map((i) => ({
        id: i.adGroupId ? `${i.campaignId}|${i.adGroupId}` : i.campaignId,
        name: i.label,
        status: i.adGroupStatus ?? i.campaignStatus,
        spend: i.cost,
        impressions: i.impressions,
        clicks: i.clicks,
        ctr: i.ctr,
        cpc: i.cpc,
        conversions: i.conversions,
        conversionValue: i.conversionValue,
        costPerConversion: i.conversions > 0 ? i.cost / i.conversions : 0,
      })),
      ...roster
        .filter((r) => !presentLabels.has(r.label))
        .map((r) => ({
          id: r.adGroupId ? `${r.campaignId}|${r.adGroupId}` : r.campaignId,
          name: r.label,
          status: r.adGroupStatus ?? r.campaignStatus,
          spend: 0,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          cpc: 0,
          conversions: 0,
          conversionValue: 0,
          costPerConversion: 0,
        })),
    ];

    // Sort: highest spend first, then alphabetical for $0-spend ties so
    // newly-launched campaigns group predictably at the bottom.
    merged.sort((a, b) => {
      if (b.spend !== a.spend) return b.spend - a.spend;
      return a.name.localeCompare(b.name);
    });

    const summary = merged.reduce(
      (acc, c) => {
        acc.spend += c.spend;
        acc.impressions += c.impressions;
        acc.clicks += c.clicks;
        acc.conversions += c.conversions;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    );

    const ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
    const cpc = summary.clicks > 0 ? summary.spend / summary.clicks : 0;
    const cpm = summary.impressions > 0 ? (summary.spend / summary.impressions) * 1000 : 0;
    const costPerConversion = summary.conversions > 0 ? summary.spend / summary.conversions : 0;

    const data: GoogleAdsInsightsData = {
      since,
      until,
      summary: {
        ...summary,
        ctr,
        cpc,
        cpm,
        costPerConversion,
        campaignCount: merged.length,
      },
      campaigns: merged,
    };
    return NextResponse.json(data);
  } catch (error) {
    console.error("Google Ads API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
