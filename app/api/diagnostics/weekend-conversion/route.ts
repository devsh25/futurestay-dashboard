import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import {
  isTestContact,
  isPartnerReferral,
  isReadyToLaunch,
  isSignup,
  hasDQ,
} from "@/lib/funnel";
import { tzDateKey, tzDayOfWeek, tzStartOfDay, tzEndOfDay, tzAddDays } from "@/lib/timezone";
import type { HubSpotContact } from "@/lib/types";

/**
 * Diagnostic: Ready-to-Launch → Trialist conversion, weekend vs weekday.
 *
 *   GET /api/diagnostics/weekend-conversion?weeks=5[&end=YYYY-MM-DD]
 *
 * Cleaning matches the dashboard exactly: partner referrals (WIX/HOPPER)
 * and internal/test contacts are excluded (isPartnerReferral / isTestContact).
 *
 * Metric — RTL→Trialist CONVERSION RATE (the headline answer):
 *   Cohort = qualified signups (isSignup && !hasDQ) whose createdate falls in
 *   the last N ET weeks AND who reached Ready to Launch (property_ready_to_launch).
 *   Conversion = % of that cohort who have a trial-entry date
 *   (hs_v2_date_entered_opportunity, falling back to trial__start_date).
 *   Split by whether the contact SIGNED UP (createdate) on a weekend (Sat/Sun)
 *   vs a weekday (Mon–Fri). We key on signup day because "Ready to Launch" is a
 *   boolean with no timestamp, so it's the only date every cohort member has.
 *
 * Also returns:
 *   - byDayOfWeek: the same cohort/conversion broken out per weekday.
 *   - runRateAligned: weekend-vs-weekday SUMS of the daily RTL and Trialist
 *     counts exactly as the Run Rate chart buckets them (RTL by createdate,
 *     Trialists by trial-entry date), for the chart-aligned reading.
 *
 * NOTE on maturity: recent signups may not have finished converting to trial
 * yet, so the most recent days slightly understate conversion. Pass ?end= to
 * pin the window's end earlier (e.g. a few days ago) for matured numbers.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

function trialDateOf(c: HubSpotContact): string | null {
  return c.hs_v2_date_entered_opportunity || c.trial__start_date || null;
}
const isWeekendDow = (dow: number) => dow === 5 || dow === 6; // tzDayOfWeek: 0=Mon…6=Sun

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const weeks = Math.max(1, Math.min(52, parseInt(sp.get("weeks") || "5", 10) || 5));
  const endParam = sp.get("end");

  try {
    const contacts = await fetchAllContacts();
    const clean = contacts.filter((c) => !isPartnerReferral(c) && !isTestContact(c));

    // Window: N weeks (N*7 days) ending on `end` (default today ET), in ET.
    const endDay = endParam && /^\d{4}-\d{2}-\d{2}$/.test(endParam)
      ? tzEndOfDay(new Date(endParam + "T12:00:00Z"))
      : tzEndOfDay(new Date());
    const startDay = tzStartOfDay(tzAddDays(endDay, -(weeks * 7 - 1)));
    const inWindow = (d: string | null) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return !isNaN(t) && t >= startDay.getTime() && t <= endDay.getTime();
    };

    // ---- Conversion cohort: RTL contacts by signup day ----
    const rtlCohort = clean.filter(
      (c) => isSignup(c) && !hasDQ(c) && inWindow(c.createdate) && isReadyToLaunch(c),
    );

    type Bucket = { rtl: number; trialed: number };
    const mk = (): Bucket => ({ rtl: 0, trialed: 0 });
    const weekend = mk();
    const weekday = mk();
    const dow: Bucket[] = Array.from({ length: 7 }, mk); // 0=Mon…6=Sun

    for (const c of rtlCohort) {
      const d = tzDayOfWeek(new Date(c.createdate));
      const trialed = trialDateOf(c) != null;
      const target = isWeekendDow(d) ? weekend : weekday;
      target.rtl += 1;
      dow[d].rtl += 1;
      if (trialed) {
        target.trialed += 1;
        dow[d].trialed += 1;
      }
    }

    const rate = (b: Bucket) => (b.rtl > 0 ? (b.trialed / b.rtl) * 100 : null);
    const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // ---- Run-Rate-aligned daily counts, weekend vs weekday ----
    // Matches the chart's bucketing: RTL keyed by createdate, Trialists by
    // trial-entry date. These are independent daily volumes (not a cohort),
    // so trials/RTL here is a velocity ratio, not a per-contact conversion.
    const rr = {
      weekend: { rtl: 0, trials: 0 },
      weekday: { rtl: 0, trials: 0 },
    };
    for (const c of clean) {
      if (isSignup(c) && !hasDQ(c) && inWindow(c.createdate) && isReadyToLaunch(c)) {
        const wk = isWeekendDow(tzDayOfWeek(new Date(c.createdate)));
        (wk ? rr.weekend : rr.weekday).rtl += 1;
      }
      const td = trialDateOf(c);
      if (td && inWindow(td)) {
        const wk = isWeekendDow(tzDayOfWeek(new Date(td)));
        (wk ? rr.weekend : rr.weekday).trials += 1;
      }
    }

    const weekendRate = rate(weekend);
    const weekdayRate = rate(weekday);

    return NextResponse.json({
      window: {
        weeks,
        startET: tzDateKey(startDay),
        endET: tzDateKey(endDay),
        note: "Cleaning excludes WIX/HOPPER + internal test contacts, matching the dashboard.",
      },
      conversionRtlToTrialist: {
        definition:
          "Of qualified signups who reached Ready-to-Launch (cohort keyed by signup day-of-week), % who have a trial-entry date. RTL has no timestamp, so signup day is the split key.",
        weekend: { ...weekend, conversionPct: weekendRate },
        weekday: { ...weekday, conversionPct: weekdayRate },
        differencePctPoints:
          weekendRate != null && weekdayRate != null
            ? Math.round((weekendRate - weekdayRate) * 10) / 10
            : null,
        byDayOfWeek: dow.map((b, i) => ({
          day: DOW_LABELS[i],
          weekend: isWeekendDow(i),
          rtl: b.rtl,
          trialed: b.trialed,
          conversionPct: rate(b),
        })),
      },
      runRateAligned: {
        definition:
          "Daily RTL (by createdate) and Trialist (by trial-entry date) volumes summed over weekend vs weekday days, as the Run Rate chart buckets them. trials/RTL here is a velocity ratio, NOT a per-contact conversion.",
        weekend: { ...rr.weekend, trialsPerRtl: rr.weekend.rtl > 0 ? rr.weekend.trials / rr.weekend.rtl : null },
        weekday: { ...rr.weekday, trialsPerRtl: rr.weekday.rtl > 0 ? rr.weekday.trials / rr.weekday.rtl : null },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
