import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeMeetingsTimeseries } from "@/lib/campaigns";

/**
 * Daily timeseries of meetings (booked + held) and downstream
 * conversions (trialists + customers), split by campaign path
 * (Airbnb vs Direct). Fixed 60-day window — the chart's purpose is
 * to spot day-over-day trends, not arbitrary historical ranges.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const days = Math.max(7, Math.min(180, parseInt(params.get("days") || "60", 10) || 60));

    const contacts = await fetchAllContacts();
    const series = await computeMeetingsTimeseries(contacts, days);
    return NextResponse.json(series);
  } catch (error) {
    console.error("Meetings timeseries error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
