import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts, fetchOwnerNames } from "@/lib/hubspot";
import { processDashboardData } from "@/lib/funnel";
import { PeriodFilter } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const period = (params.get("period") || "allTime") as PeriodFilter;
    const countryParam = params.get("country") || "";
    const channelsParam = params.get("channels") || "";
    const customStart = params.get("start") || undefined;
    const customEnd = params.get("end") || undefined;

    const countries = countryParam
      ? countryParam.split(",").filter(Boolean)
      : [];
    const channels = channelsParam
      ? channelsParam.split(",").filter(Boolean)
      : [];

    const [contacts, ownerNames] = await Promise.all([
      fetchAllContacts(),
      fetchOwnerNames(),
    ]);

    const data = processDashboardData(
      contacts,
      ownerNames,
      period,
      countries,
      channels,
      customStart,
      customEnd
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("HubSpot API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
