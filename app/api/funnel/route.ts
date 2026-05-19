import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeFunnelByCampaign } from "@/lib/funnel";
import { bucketMetaCampaign } from "@/lib/campaigns";
import { PeriodFilter } from "@/lib/types";

/**
 * Per-campaign funnel scoping.
 *
 *   GET /api/funnel?period=custom&start=...&end=...&campaign=Airbnb%20Optimization%20Call
 *
 * Returns FunnelStage[] for contacts attributed to the named campaign
 * within the period. If campaign is omitted/empty, returns the funnel
 * for the full cohort (matches what /api/hubspot/contacts returns
 * under data.funnel).
 *
 * Reuses the cached fetchAllContacts() so it's cheap on warm cache.
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

    // Resolve the campaign param. The FunnelCard dropdown now submits
    // full Meta campaign names like "18.05 | US & CA | Direct Website
    // Call | Batch 2 Video Ads | Campaign", so we translate to the
    // bucket key the HubSpot attribution lives under. Backward compat:
    // if the param is already a bucket key (e.g. "Direct Website
    // Call"), bucketMetaCampaign returns the same string. If it
    // matches no UTM rule (e.g. "Retargeting Ads"), we pass the raw
    // string through — bucketContactToCampaign won't match any contact
    // and the funnel returns zeros, which is the honest result for an
    // unbucketed Meta campaign.
    const campaign = campaignParam
      ? (bucketMetaCampaign(campaignParam) ?? campaignParam)
      : null;

    const contacts = await fetchAllContacts();
    const funnel = computeFunnelByCampaign(
      contacts,
      period,
      campaign,
      countries,
      channels,
      customStart,
      customEnd
    );

    // Echo the user-submitted name (not the resolved bucket) so the
    // UI shows what the user picked in their dropdown.
    return NextResponse.json({ funnel, campaign: campaignParam });
  } catch (error) {
    console.error("Funnel API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
