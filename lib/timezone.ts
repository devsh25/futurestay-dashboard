/**
 * Eastern Time utilities for date bucketing + period boundaries.
 *
 * Why this exists:
 *   HubSpot stores all timestamps as UTC. The dashboard used to bucket
 *   events into days using new Date().toISOString().slice(0,10) which
 *   produces UTC day keys. For a US-based team that means events
 *   between 8pm and midnight ET appear on the wrong calendar day.
 *
 * Strategy:
 *   • Keep all underlying timestamps as UTC ms (no mutation).
 *   • Use Intl.DateTimeFormat with America/New_York for all bucketing,
 *     day-of-week, and period boundary calculations. The browser /
 *     Node runtime handles DST correctly (EST → EDT in March, EDT →
 *     EST in November) without external libs.
 */

export const APP_TIMEZONE = "America/New_York";

// Reusable formatters (created once, used everywhere)
const _dateKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// en-US weekday "short" returns Mon/Tue/Wed/... regardless of locale.
const _dowFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  weekday: "short",
});

// Monday=0, Tuesday=1, ..., Sunday=6 — matches the existing Mon-first
// week convention used by getDateRange's "thisWeek" / "lastWeek".
const DOW_MAP: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/** YYYY-MM-DD in Eastern Time. Handles DST. */
export function tzDateKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return _dateKeyFmt.format(date);
}

/** Day-of-week (0=Mon … 6=Sun) in Eastern Time. */
export function tzDayOfWeek(d: Date | string): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return DOW_MAP[_dowFmt.format(date)];
}

/**
 * Eastern-Time offset in minutes for a specific instant (handles DST).
 * Returns negative number — e.g., -300 for EST (UTC-5), -240 for EDT
 * (UTC-4). Used internally; callers usually want tzStartOfDay /
 * tzEndOfDay instead.
 */
function tzOffsetMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => {
    const part = parts.find((p) => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };
  // Reconstruct as if those ET wall-clock parts were UTC — diff from
  // the actual UTC instant is the timezone offset.
  const asUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),  // some locales return 24 for midnight
    get("minute"),
    get("second")
  );
  return Math.round((asUtcMs - d.getTime()) / 60000);
}

/**
 * Returns the UTC Date corresponding to 00:00:00 ET on the calendar
 * day that contains `d` in Eastern Time. Handles DST transitions.
 */
export function tzStartOfDay(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  // Day key from ET perspective
  const key = tzDateKey(date);   // "YYYY-MM-DD"
  // Build an ET midnight timestamp. To know the right UTC instant we
  // need the offset for *that* date — use noon UTC of the same day as
  // a probe (avoids DST-transition edge cases at 2am).
  const probe = new Date(`${key}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(probe);  // negative
  // ET midnight in UTC = "key 00:00 + (- offsetMin) minutes"
  // i.e., if ET is UTC-5, ET midnight = 05:00 UTC the same day.
  const utcMs = Date.parse(`${key}T00:00:00Z`) - offsetMin * 60000;
  return new Date(utcMs);
}

/** End of the ET calendar day containing `d` (23:59:59.999 ET in UTC). */
export function tzEndOfDay(d: Date | string): Date {
  const start = tzStartOfDay(d);
  return new Date(start.getTime() + 86_400_000 - 1);
}

/** Step backwards by `n` ET calendar days, returning ET-midnight. */
export function tzAddDays(d: Date | string, n: number): Date {
  const start = tzStartOfDay(d);
  // Adding 86_400_000 might cross a DST boundary and land at 23:00 or
  // 01:00 instead of 00:00. Re-normalise via tzStartOfDay.
  return tzStartOfDay(new Date(start.getTime() + n * 86_400_000));
}

/** Start of week (Monday 00:00 ET) containing `d`. */
export function tzStartOfWeek(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  const dow = tzDayOfWeek(date);  // 0=Mon..6=Sun
  return tzAddDays(date, -dow);
}

/** Start of month (1st 00:00 ET) containing `d`. */
export function tzStartOfMonth(d: Date | string): Date {
  const key = tzDateKey(d);
  const firstOfMonth = key.slice(0, 8) + "01";
  return tzStartOfDay(new Date(`${firstOfMonth}T12:00:00Z`));
}

/** Start of quarter in ET. */
export function tzStartOfQuarter(d: Date | string): Date {
  const key = tzDateKey(d);
  const year = parseInt(key.slice(0, 4), 10);
  const month = parseInt(key.slice(5, 7), 10);
  const qMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const qStart = `${year}-${String(qMonth).padStart(2, "0")}-01`;
  return tzStartOfDay(new Date(`${qStart}T12:00:00Z`));
}
