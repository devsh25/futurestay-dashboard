import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeTimeSeries } from "@/lib/funnel";
import { fetchMetaInsights } from "@/lib/meta";
import { fetchGoogleAdsDaily } from "@/lib/google";

/**
 * All-time daily timeseries for the headline KPIs.
 *
 * Returns parallel arrays — `days` is ISO YYYY-MM-DD, the metric arrays
 * are integer counts indexed by the same day. Frontend chart toggles
 * which series to render.
 *
 * Also returns `spend[]` — the daily sum of Meta + Google ad spend,
 * aligned to `days[]`. Used by the Run Rate chart's "Budget Spent"
 * line (dotted, on a secondary $ y-axis). Either ad-API call
 * failing falls back to a zero-filled slice so the rest of the chart
 * keeps working regardless of credential / quota state.
 *
 * Reuses the cached `fetchAllContacts()` so this endpoint is cheap to
 * call alongside /api/hubspot/contacts.
 */
export async function GET() {
  try {
    const contacts = await fetchAllContacts();
    const series = computeTimeSeries(contacts);

    // Align spend to the same days[] the funnel series uses. Cap the
    // ad-API windows to that range so we don't pull more than we need.
    const since = series.days[0] || "2026-03-01";
    const until = series.days[series.days.length - 1] || new Date().toISOString().slice(0, 10);

    const [metaDaily, googleDaily] = await Promise.all([
      fetchMetaInsights(since, until).then((d) => d.daily).catch((err) => {
        console.error("[timeseries] Meta daily spend fetch failed:", err);
        return [] as { date: string; spend: number }[];
      }),
      fetchGoogleAdsDaily(since, until).catch((err) => {
        console.error("[timeseries] Google daily spend fetch failed:", err);
        return [] as { date: string; cost: number }[];
      }),
    ]);

    // Sum spend per date across both platforms.
    const spendByDate = new Map<string, number>();
    for (const d of metaDaily)   spendByDate.set(d.date, (spendByDate.get(d.date) || 0) + d.spend);
    for (const d of googleDaily) spendByDate.set(d.date, (spendByDate.get(d.date) || 0) + d.cost);

    const spend = series.days.map((day) => Math.round((spendByDate.get(day) || 0) * 100) / 100);

    return NextResponse.json({ ...series, spend });
  } catch (error) {
    console.error("Timeseries API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
