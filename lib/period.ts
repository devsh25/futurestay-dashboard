/**
 * Period → date-range resolver. Pure JS so it can be imported from
 * both server (lib/funnel.ts) and client (FilterBar) without dragging
 * in HubSpot SDK or env-var dependencies.
 *
 * Mirrors the logic in lib/funnel.ts:resolvedDateRange but as a
 * standalone module. The server-side resolver re-imports this so
 * there's a single source of truth.
 */

import type { PeriodFilter } from "./types";

function getDateRange(period: PeriodFilter): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case "last7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "last30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "thisWeek": {
      const dow = (now.getDay() + 6) % 7; // Mon→0, Sun→6
      const start = new Date(now);
      start.setDate(start.getDate() - dow);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "lastWeek": {
      const dow = (now.getDay() + 6) % 7;
      const start = new Date(now);
      start.setDate(start.getDate() - dow - 7);
      start.setHours(0, 0, 0, 0);
      const lwEnd = new Date(start);
      lwEnd.setDate(start.getDate() + 6);
      lwEnd.setHours(23, 59, 59, 999);
      return { start, end: lwEnd };
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end };
    }
    case "thisQuarter": {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1, 0, 0, 0, 0);
      return { start, end };
    }
    case "allTime": {
      const start = new Date(2026, 0, 1, 0, 0, 0, 0);
      return { start, end };
    }
    case "custom":
    default:
      return { start: new Date(2026, 0, 1, 0, 0, 0, 0), end };
  }
}

export function resolvedDateRange(
  period: PeriodFilter,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  if (period === "custom" && customStart && customEnd) {
    return {
      start: new Date(customStart + "T00:00:00.000Z"),
      end: new Date(customEnd + "T23:59:59.999Z"),
    };
  }
  return getDateRange(period);
}

/** ISO YYYY-MM-DD slice, locale-independent. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
