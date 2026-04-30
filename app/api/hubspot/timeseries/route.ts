import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeTimeSeries } from "@/lib/funnel";

/**
 * All-time daily timeseries for the headline KPIs.
 *
 * Returns parallel arrays — `days` is ISO YYYY-MM-DD, the metric arrays
 * are integer counts indexed by the same day. Frontend chart toggles
 * which series to render.
 *
 * Reuses the cached `fetchAllContacts()` so this endpoint is cheap to
 * call alongside /api/hubspot/contacts.
 */
export async function GET() {
  try {
    const contacts = await fetchAllContacts();
    const series = computeTimeSeries(contacts);
    return NextResponse.json(series);
  } catch (error) {
    console.error("Timeseries API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
