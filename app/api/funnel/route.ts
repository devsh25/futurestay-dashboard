import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeFunnelByCampaign } from "@/lib/funnel";
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
    const campaign = params.get("campaign") || null;
    const countriesParam = params.get("country") || "";
    const channelsParam = params.get("channels") || "";

    const countries = countriesParam ? countriesParam.split(",").filter(Boolean) : [];
    const channels = channelsParam ? channelsParam.split(",").filter(Boolean) : [];

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

    return NextResponse.json({ funnel, campaign });
  } catch (error) {
    console.error("Funnel API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
