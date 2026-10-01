/**
 * Monthly paid-customer targets, straight from the plan.
 *
 * Keys are ET year-month ("YYYY-MM"). Values are the full-month target.
 *
 * When the dashboard needs a target for an arbitrary date range, it
 * prorates per day: for each month that overlaps the range, add
 *   monthlyTarget[m] * daysOfRangeInsideMonth / daysInMonth(m)
 *
 * This means a month in the range contributes a share proportional to
 * how much of that month the range covers, which is the right behavior
 * for both the KPI "% of target" chip and the run-rate target line.
 *
 * Updating: add months here as finance confirms them. The helpers below
 * silently treat months outside the map as zero target, so stale maps
 * degrade safely instead of producing phantom targets.
 */

import { tzDateKey } from "./timezone";

export const MONTHLY_CUSTOMER_TARGETS: Record<string, number> = {
  "2026-08": 144,
  "2026-09": 154,
  "2026-10": 165,
  "2026-11": 174,
  "2026-12": 182,
};

/** Days in the ET calendar month identified by "YYYY-MM". */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  // Day 0 of next month = last day of this month in UTC terms, which is
  // the correct day count because month lengths don't depend on tz.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Prorated target for one ET day — monthlyTarget / daysInMonth. */
export function dailyTarget(dateIso: string): number {
  const ym = dateIso.slice(0, 7);
  const monthly = MONTHLY_CUSTOMER_TARGETS[ym];
  if (!monthly) return 0;
  return monthly / daysInMonth(ym);
}

/**
 * Prorated target for an inclusive ET date range [startIso, endIso].
 *
 * Walks the range day by day and sums `dailyTarget` for each day. This
 * is simple, correct across month boundaries, and cheap for the
 * ranges the dashboard works with (<= 1 year).
 */
export function targetForRange(startIso: string, endIso: string): number {
  if (!startIso || !endIso || endIso < startIso) return 0;
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  let total = 0;
  for (let t = startMs; t <= endMs; t += 86_400_000) {
    const d = new Date(t);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    total += dailyTarget(iso);
  }
  return total;
}

/** Convenience: the current ET calendar month as "YYYY-MM". */
export function currentMonthKey(): string {
  return tzDateKey(new Date()).slice(0, 7);
}
