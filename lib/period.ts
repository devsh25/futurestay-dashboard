/**
 * Client-side date-range resolver — kept in sync with the server-side
 * resolver in lib/funnel.ts. Both use Eastern Time for all boundaries
 * (period presets, custom date pickers) so a US-based team sees days
 * aligned to their local calendar.
 *
 * Pure JS — no server-only imports, safe to use in client components.
 */

import type { PeriodFilter } from "./types";
import {
  tzStartOfDay, tzEndOfDay, tzAddDays, tzStartOfWeek,
  tzStartOfMonth, tzStartOfQuarter,
} from "./timezone";

function getDateRange(period: PeriodFilter): { start: Date; end: Date } {
  const now = new Date();
  const end = tzEndOfDay(now);

  switch (period) {
    case "last7d":
      return { start: tzAddDays(now, -7), end };
    case "last30d":
      return { start: tzAddDays(now, -30), end };
    case "thisWeek":
      return { start: tzStartOfWeek(now), end };
    case "lastWeek": {
      const thisMonday = tzStartOfWeek(now);
      const start = tzAddDays(thisMonday, -7);
      const lwEnd = tzEndOfDay(tzAddDays(start, 6));
      return { start, end: lwEnd };
    }
    case "thisMonth":
      return { start: tzStartOfMonth(now), end };
    case "thisQuarter":
      return { start: tzStartOfQuarter(now), end };
    case "allTime":
      return { start: tzStartOfDay(new Date("2026-01-01T12:00:00Z")), end };
    case "custom":
    default:
      return { start: tzStartOfDay(new Date("2026-01-01T12:00:00Z")), end };
  }
}

export function resolvedDateRange(
  period: PeriodFilter,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  if (period === "custom" && customStart && customEnd) {
    return {
      start: tzStartOfDay(new Date(customStart + "T12:00:00Z")),
      end: tzEndOfDay(new Date(customEnd + "T12:00:00Z")),
    };
  }
  return getDateRange(period);
}

/** YYYY-MM-DD string in Eastern Time — for displaying the resolved
 *  range in the filter bar's date inputs. */
export function toIsoDate(d: Date): string {
  // Use the timezone helper so the displayed date matches ET, not the
  // browser's local zone.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
