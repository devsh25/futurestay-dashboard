import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import {
  everBecameRealCustomer, isPartnerReferral, isTestContact,
} from "@/lib/funnel";
import { tzDateKey } from "@/lib/timezone";
import { dailyTarget } from "@/lib/customer-targets";

/**
 * Paid Customer Run Rate — account-level daily series.
 *
 *   GET /api/paid-customer-run-rate
 *
 * Two aligned daily series over the last 90 ET days:
 *   actual  count  Contacts whose hs_v2_date_entered_customer falls on
 *                  that day AND they ever became a real paid customer
 *                  (filter matches the Total Customers KPI tile)
 *   target  float  Prorated per-day monthly customer target
 *                  (monthlyTarget / daysInMonth). Zero on days with
 *                  no configured target.
 *
 * The chart component builds the cumulative-to-date lines and the
 * surplus / deficit on top of these daily series, so the endpoint
 * stays deterministic and reusable (same shape regardless of what
 * aggregation the chart decides to show).
 *
 * Partner + test contacts excluded upstream to match everywhere else.
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

    const contacts = await fetchAllContacts();

    const actual: number[] = new Array(days.length).fill(0);
    const target: number[] = days.map(dailyTarget);

    for (const c of contacts) {
      if (isPartnerReferral(c) || isTestContact(c)) continue;
      if (!everBecameRealCustomer(c)) continue;
      if (!c.hs_v2_date_entered_customer) continue;
      const i = dayIndex.get(tzDateKey(c.hs_v2_date_entered_customer));
      if (i !== undefined) actual[i]++;
    }

    return NextResponse.json({ days, actual, target });
  } catch (err) {
    console.error("[/api/paid-customer-run-rate] failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        days: [], actual: [], target: [],
      },
      { status: 500 },
    );
  }
}
