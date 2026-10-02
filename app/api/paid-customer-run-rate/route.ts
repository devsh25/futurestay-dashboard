import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import {
  everBecameRealCustomer, isPartnerReferral, isTestContact,
} from "@/lib/funnel";
import { tzDateKey } from "@/lib/timezone";
import { dailyTarget, lastTargetDateIso } from "@/lib/customer-targets";

/**
 * Paid Customer Run Rate — account-level daily series.
 *
 *   GET /api/paid-customer-run-rate
 *
 * Three aligned daily series spanning the last 90 ET days through the
 * end of the last configured target month (so the chart can project
 * the target line forward past today to the planning horizon):
 *   actual   count       Contacts whose hs_v2_date_entered_customer
 *                        falls on that day AND they ever became a
 *                        real paid customer. Null for future days
 *                        (no data yet, chart stops the actual line).
 *   target   float        Prorated per-day monthly customer target
 *                        (monthlyTarget / daysInMonth). Zero on days
 *                        with no configured target.
 *   isFuture boolean     True for days strictly after today ET, so
 *                        the chart can style the forward segment
 *                        differently (projected target).
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
    const todayIso = tzDateKey(new Date(nowMs));

    // Build the day list from 90 days ago through either today or the
    // last configured target day, whichever is later. Future days
    // carry the target projection; the actual series is null for
    // them so the chart can stop that line at today.
    const horizonIso = lastTargetDateIso();
    const days: string[] = [];
    for (let i = daysBack; i >= 0; i--) {
      days.push(tzDateKey(new Date(nowMs - i * 86_400_000)));
    }
    if (horizonIso && horizonIso > todayIso) {
      // Append future days (today + 1 .. horizonIso)
      let cursor = todayIso;
      while (cursor < horizonIso) {
        // Step one ET day forward via a noon-UTC probe so DST
        // transitions don't skip or double-count a day.
        const probe = new Date(cursor + "T12:00:00Z");
        const next = tzDateKey(new Date(probe.getTime() + 86_400_000));
        if (next <= cursor) break; // defensive: never loop
        days.push(next);
        cursor = next;
      }
    }

    const dayIndex = new Map(days.map((d, i) => [d, i] as const));

    const contacts = await fetchAllContacts();

    // actual: null for future days so the client can stop the line
    // at today; 0 for past days with no customer activity.
    const actual: (number | null)[] = days.map((d) => d > todayIso ? null : 0);
    const target: number[] = days.map(dailyTarget);
    const isFuture: boolean[] = days.map((d) => d > todayIso);

    for (const c of contacts) {
      if (isPartnerReferral(c) || isTestContact(c)) continue;
      if (!everBecameRealCustomer(c)) continue;
      if (!c.hs_v2_date_entered_customer) continue;
      const i = dayIndex.get(tzDateKey(c.hs_v2_date_entered_customer));
      if (i !== undefined && actual[i] !== null) actual[i] = (actual[i] as number) + 1;
    }

    return NextResponse.json({ days, actual, target, isFuture });
  } catch (err) {
    console.error("[/api/paid-customer-run-rate] failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        days: [], actual: [], target: [], isFuture: [],
      },
      { status: 500 },
    );
  }
}
