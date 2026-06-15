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
 * Also returns `metaSpend[]` and `googleSpend[]` — daily ad-spend
 * arrays per platform, both aligned to `days[]`. Used by the Run
 * Rate chart's two "Spent" lines (dotted, on a secondary $ y-axis,
 * one amber for Meta one violet for Google). Either ad-API call
 * failing zero-fills its own array so the other platform + the
 * funnel metrics keep working regardless of credential state.
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

    // Build per-platform daily-spend maps, then align both to days[].
    const metaByDate = new Map<string, number>();
    for (const d of metaDaily) metaByDate.set(d.date, (metaByDate.get(d.date) || 0) + d.spend);
    const googleByDate = new Map<string, number>();
    for (const d of googleDaily) googleByDate.set(d.date, (googleByDate.get(d.date) || 0) + d.cost);

    const round = (v: number) => Math.round(v * 100) / 100;
    const metaSpend   = series.days.map((day) => round(metaByDate.get(day)   || 0));
    const googleSpend = series.days.map((day) => round(googleByDate.get(day) || 0));

    return NextResponse.json({ ...series, metaSpend, googleSpend });
  } catch (error) {
    console.error("Timeseries API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
