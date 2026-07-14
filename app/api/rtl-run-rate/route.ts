import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { fetchMetaInsights } from "@/lib/meta";
import { fetchGoogleAdsDaily } from "@/lib/google";
import {
  isSignup, hasDQ, isReadyToLaunch, isPartnerReferral, isTestContact,
} from "@/lib/funnel";
import { tzDateKey } from "@/lib/timezone";

/**
 * RTL Run Rate — account-level daily series.
 *
 *   GET /api/rtl-run-rate
 *
 * Four aligned daily series over the last 90 days:
 *   metaSpend    ($)  Meta account-level daily spend
 *   googleSpend  ($)  Google Ads account-level daily spend
 *   rtl        count  Contacts whose createdate is on that day AND
 *                     lifecycle reached signup AND !hasDQ AND
 *                     property_ready_to_launch=true
 *   trials     count  Contacts whose trial-entry date is on that day
 *                     (used only to derive RTL → Trial % client-side —
 *                     the tooltip doesn't show trial count directly)
 *
 * The chart component computes RTL → Trial % per bucket client-side
 * so weekly / monthly aggregation just needs to sum RTL and trials
 * per bucket and recompute the ratio. Aggregation client-side keeps
 * the endpoint deterministic (one shape, no toggles).
 *
 * Partner + test contacts excluded upstream.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const nowMs = Date.now();
    const daysBack = 90;
    const days: string[] = [];
    for (let i = daysBack; i >= 0; i--) {
      days.push(tzDateKey(new Date(nowMs - i * 86_400_000)));
    }
    const dayIndex = new Map(days.map((d, i) => [d, i] as const));

    const since = days[0];
    const until = days[days.length - 1];

    const [contacts, mi, googleDaily] = await Promise.all([
      fetchAllContacts(),
      fetchMetaInsights(since, until).catch(() => ({ daily: [] as { date: string; spend: number }[] })),
      fetchGoogleAdsDaily(since, until).catch(() => [] as { date: string; cost: number }[]),
    ]);

    const metaSpend: number[] = new Array(days.length).fill(0);
    const googleSpend: number[] = new Array(days.length).fill(0);
    const rtl: number[] = new Array(days.length).fill(0);
    const trials: number[] = new Array(days.length).fill(0);

    // Meta daily spend — the /insights level=account time_increment=1 payload
    // returns one row per day.
    for (const p of mi.daily) {
      const i = dayIndex.get(p.date);
      if (i !== undefined) metaSpend[i] += p.spend;
    }
    // Google daily spend.
    for (const p of googleDaily) {
      const i = dayIndex.get(p.date);
      if (i !== undefined) googleSpend[i] += p.cost;
    }

    // Contacts → RTL count by createdate, trial count by trial-entry date.
    for (const c of contacts) {
      if (isPartnerReferral(c) || isTestContact(c)) continue;
      if (c.createdate && isSignup(c) && !hasDQ(c) && isReadyToLaunch(c)) {
        const i = dayIndex.get(tzDateKey(c.createdate));
        if (i !== undefined) rtl[i]++;
      }
      const td = c.hs_v2_date_entered_opportunity || c.trial__start_date;
      if (td) {
        const i = dayIndex.get(tzDateKey(td));
        if (i !== undefined) trials[i]++;
      }
    }

    return NextResponse.json({ days, metaSpend, googleSpend, rtl, trials });
  } catch (err) {
    console.error("[/api/rtl-run-rate] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error", days: [], metaSpend: [], googleSpend: [], rtl: [], trials: [] },
      { status: 500 },
    );
  }
}
