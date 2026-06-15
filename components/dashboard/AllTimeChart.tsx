"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import { tzStartOfWeek, tzDateKey } from "@/lib/timezone";

/** Add `n` calendar days to a YYYY-MM-DD string. Pure string math —
 *  DST-safe because we're not crossing time-of-day boundaries. */
function addDaysToKey(key: string, n: number): string {
  const y = parseInt(key.slice(0, 4), 10);
  const m = parseInt(key.slice(5, 7), 10);
  const d = parseInt(key.slice(8, 10), 10);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

type Granularity = "day" | "week" | "month";
type Mode = "count" | "percent";

type Series = {
  days: string[];
  signups: number[];
  airbnbConnects: number[];
  readyToLaunch: number[];
  trials: number[];
  customers: number[];
  /** Daily total ad spend (Meta + Google) in $. May read as 0 for
   *  Google portion until Basic Access is granted on the dev token. */
  spend: number[];
};

type MetricKey = "signups" | "airbnbConnects" | "readyToLaunch" | "trials" | "customers" | "spend";

const METRICS: { key: MetricKey; label: string; color: string; description: string; isCurrency?: boolean }[] = [
  { key: "signups",        label: "Qualified Signups",  color: "#1E6FFF", description: "createdate, Airbnb DQ excluded" },
  { key: "airbnbConnects", label: "Airbnb Connects",    color: "#60A5FA", description: "auth status COMPLETED/REVOKED" },
  { key: "readyToLaunch",  label: "Ready to Launch",    color: "#93C5FD", description: "property_ready_to_launch=true" },
  { key: "trials",         label: "Trialists",          color: "#FFFFFF", description: "by actual trial start date" },
  { key: "customers",      label: "Customers",          color: "#10B981", description: "by actual customer entry date" },
  // Plotted on the secondary $ axis (right side) as a dotted line so
  // it visually reads as a budget overlay, not a funnel-stage count.
  // Excluded from step-to-step conversion math in the tooltip.
  { key: "spend",          label: "Budget Spent",       color: "#F59E0B", description: "Daily Meta + Google ad spend ($)", isCurrency: true },
];

/** 7-day moving average — the daily volumes are too spiky on weekends
 *  to read cleanly. Smooths into a trend line without losing detail. */
function smooth(arr: number[], window = 7): number[] {
  const out: number[] = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      sum += arr[j];
      n++;
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

type WeeklyData = {
  /** ISO YYYY-MM-DD of each week's Monday (ET). */
  weekStart: string[];
  /** Inclusive end of each week (Sunday, ET). */
  weekEnd: string[];
  /** Sums for each metric. */
  signups: number[];
  airbnbConnects: number[];
  readyToLaunch: number[];
  trials: number[];
  customers: number[];
  /** Sum of daily ad spend ($) within the bucket. */
  spend: number[];
  /** Whether each week is "partial" — only true for the most recent
   *  week if today < its Sunday. Lets the chart mark it visually so
   *  the dip from an incomplete week isn't misread as a real drop. */
  partial: boolean[];
};

/** Aggregate daily series into Monday-Sunday weeks (Eastern Time).
 *  Days in the input that don't fill a complete week at either end
 *  still contribute — the partial[] array flags which weeks are
 *  incomplete so the UI can render them differently. */
function bucketByWeek(data: Series): WeeklyData {
  // Map week-start (Mon ET, YYYY-MM-DD) → aggregated row
  const buckets = new Map<string, { weekStart: string; weekEnd: string; signups: number; airbnbConnects: number; readyToLaunch: number; trials: number; customers: number; spend: number; daysSeen: number; lastDay: string }>();

  for (let i = 0; i < data.days.length; i++) {
    const day = data.days[i];
    // `day` is already an ET calendar date — parse as noon UTC, which
    // always lands inside the ET day regardless of DST, then snap to
    // the week's Monday.
    const dayDate = new Date(day + "T12:00:00Z");
    const monday = tzStartOfWeek(dayDate);
    const weekKey = tzDateKey(monday);
    // Sunday key via pure string math so we don't drift across DST
    // (Mon + 6×24h can land 23h or 25h off on transition weeks).
    const sundayKey = addDaysToKey(weekKey, 6);

    if (!buckets.has(weekKey)) {
      buckets.set(weekKey, {
        weekStart: weekKey,
        weekEnd: sundayKey,
        signups: 0, airbnbConnects: 0, readyToLaunch: 0, trials: 0, customers: 0,
        spend: 0,
        daysSeen: 0, lastDay: day,
      });
    }
    const b = buckets.get(weekKey)!;
    b.signups += data.signups[i];
    b.airbnbConnects += data.airbnbConnects[i];
    b.readyToLaunch += data.readyToLaunch[i];
    b.trials += data.trials[i];
    b.customers += data.customers[i];
    b.spend += data.spend?.[i] ?? 0;
    b.daysSeen += 1;
    if (day > b.lastDay) b.lastDay = day;
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  // A week is "partial" if it has fewer than 7 days of data — that's
  // true for the leading edge (older cohort entry) and the trailing
  // edge (current week, where today is mid-week).
  return {
    weekStart: sorted.map((b) => b.weekStart),
    weekEnd: sorted.map((b) => b.weekEnd),
    signups: sorted.map((b) => b.signups),
    airbnbConnects: sorted.map((b) => b.airbnbConnects),
    readyToLaunch: sorted.map((b) => b.readyToLaunch),
    trials: sorted.map((b) => b.trials),
    customers: sorted.map((b) => b.customers),
    spend: sorted.map((b) => b.spend),
    partial: sorted.map((b) => b.daysSeen < 7),
  };
}

/** Aggregate daily series into calendar months (Eastern Time).
 *  Returns the same shape as bucketByWeek with `weekStart`/`weekEnd`
 *  repurposed as month-start (1st) and month-end (last day) so the
 *  downstream chart code (tooltips, partial flag, _solid/_dashed
 *  split) doesn't need a parallel codepath. The `partial` flag is
 *  true when the month has fewer real days of data than its calendar
 *  length — that's the current (still-running) month at the trailing
 *  edge, and the truncated month at the leading edge if the series
 *  starts mid-month. */
function bucketByMonth(data: Series): WeeklyData {
  // `day` strings are YYYY-MM-DD ET keys. Month key = YYYY-MM.
  type Row = { monthStart: string; monthEnd: string; days: Set<string>;
               signups: number; airbnbConnects: number; readyToLaunch: number;
               trials: number; customers: number; spend: number; daysInMonth: number };
  const buckets = new Map<string, Row>();
  function lastDayOfMonth(y: number, m: number): number {
    // m is 1-indexed; Date.UTC with day 0 returns last day of previous month
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  for (let i = 0; i < data.days.length; i++) {
    const day = data.days[i];
    const monthKey = day.slice(0, 7);                  // "2026-04"
    const y = parseInt(monthKey.slice(0, 4), 10);
    const m = parseInt(monthKey.slice(5, 7), 10);
    if (!buckets.has(monthKey)) {
      const last = lastDayOfMonth(y, m);
      buckets.set(monthKey, {
        monthStart: `${monthKey}-01`,
        monthEnd:   `${monthKey}-${String(last).padStart(2, "0")}`,
        days: new Set<string>(),
        signups: 0, airbnbConnects: 0, readyToLaunch: 0, trials: 0, customers: 0,
        spend: 0,
        daysInMonth: last,
      });
    }
    const b = buckets.get(monthKey)!;
    b.days.add(day);
    b.signups       += data.signups[i];
    b.airbnbConnects+= data.airbnbConnects[i];
    b.readyToLaunch += data.readyToLaunch[i];
    b.trials        += data.trials[i];
    b.customers     += data.customers[i];
    b.spend         += data.spend?.[i] ?? 0;
  }
  const sorted = Array.from(buckets.values()).sort((a, b) => a.monthStart.localeCompare(b.monthStart));
  return {
    weekStart: sorted.map((b) => b.monthStart),
    weekEnd:   sorted.map((b) => b.monthEnd),
    signups:   sorted.map((b) => b.signups),
    airbnbConnects: sorted.map((b) => b.airbnbConnects),
    readyToLaunch:  sorted.map((b) => b.readyToLaunch),
    trials:    sorted.map((b) => b.trials),
    customers: sorted.map((b) => b.customers),
    spend:     sorted.map((b) => b.spend),
    // A month is "partial" if we don't have a row for every calendar
    // day in it. Catches both the trailing current-month case (today
    // < last day) and the leading mid-month-start case.
    partial:   sorted.map((b) => b.days.size < b.daysInMonth),
  };
}

/** "Mar '26" — short month + 2-digit year for monthly-mode ticks. */
function shortMonth(iso: string): string {
  const [y, m] = iso.split("-");
  const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10)]} '${y.slice(2)}`;
}

/** "Apr 28" — short month + day for x-axis ticks. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10)]} ${parseInt(d, 10)}`;
}

export default function AllTimeChart({ onReady }: { onReady?: () => void } = {}) {
  const [data, setData] = useState<Series | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<MetricKey>>(
    new Set(["signups", "airbnbConnects", "trials", "customers", "spend"])
  );
  const [smoothed, setSmoothed] = useState(true);
  const [granularity, setGranularity] = useState<Granularity>("day");
  // "count"  → raw daily/weekly/monthly volumes.
  // "percent"→ each milestone as a % of Qualified Signups in the SAME bucket,
  //            i.e. funnel conversion rates over time (Qualified Signups = 100%).
  const [mode, setMode] = useState<Mode>("count");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hubspot/timeseries")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Series) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          // Notify parent so the dashboard's first-fold loader knows
          // this metric is done. Both data success AND error count as
          // "done" — we want to dismiss the skeleton even on failure
          // so the user sees the error state, not a frozen loader.
          onReady?.();
        }
      });
    return () => { cancelled = true; };
  }, [onReady]);

  // Build chart-ready rows. Shape depends on granularity:
  //   day:   one row per ET calendar day; values are the raw daily
  //          counts (optionally 7-day smoothed for visual readability)
  //   week:  one row per Monday-Sunday ET week; values are SUM per week
  //          (smoothing N/A — aggregation already smooths weekend dips)
  //   month: one row per calendar month; values are SUM per month
  //          (current month and any mid-month-start month flagged
  //          partial and rendered dashed)
  const rows = useMemo(() => {
    if (!data) return [];
    const asPercent = mode === "percent";
    // Each milestone as a % of Qualified Signups in the SAME bucket. Null when
    // the bucket has no signups (avoids divide-by-zero / a spurious point) —
    // Recharts then leaves a gap there.
    const toPercentOf = (arr: number[], denom: number[]): (number | null)[] =>
      arr.map((v, i) => (denom[i] > 0 ? (v / denom[i]) * 100 : null));

    if (granularity === "week" || granularity === "month") {
      const w = granularity === "week" ? bucketByWeek(data) : bucketByMonth(data);
      const N = w.weekStart.length;

      // Plotted value per metric: raw period sums, or the period's conversion
      // rate (metric / signups). The % uses each bucket's own sums so it lines
      // up with the week/month the reader sees.
      // Funnel-stage values get %-of-signups (when asPercent) or raw
      // counts. Spend is excluded from this map because it's not a
      // count and not a % — it renders separately on the right $ axis
      // as a single dotted line (no partial-period split).
      const vals: Record<Exclude<MetricKey, "spend">, (number | null)[]> = asPercent
        ? {
            signups: toPercentOf(w.signups, w.signups),
            airbnbConnects: toPercentOf(w.airbnbConnects, w.signups),
            readyToLaunch: toPercentOf(w.readyToLaunch, w.signups),
            trials: toPercentOf(w.trials, w.signups),
            customers: toPercentOf(w.customers, w.signups),
          }
        : {
            signups: w.signups,
            airbnbConnects: w.airbnbConnects,
            readyToLaunch: w.readyToLaunch,
            trials: w.trials,
            customers: w.customers,
          };

      // Split each metric's values into two parallel arrays per row:
      //   metric_solid   = value on full weeks, null on partial weeks
      //   metric_dashed  = value on partial weeks, null on full weeks
      // Plus at every solid↔dashed transition, the boundary index gets
      // its value copied into the other array so the line actually
      // *connects* through the transition instead of leaving a gap.
      const partial = w.partial;
      function split(values: (number | null)[]) {
        const solid: (number | null)[] = new Array(N).fill(null);
        const dashed: (number | null)[] = new Array(N).fill(null);
        for (let i = 0; i < N; i++) {
          if (partial[i]) dashed[i] = values[i];
          else            solid[i]  = values[i];
        }
        for (let i = 1; i < N; i++) {
          // Boundary point: this index's "is partial" differs from prev.
          // Ensure the line that "lives" on this side has the previous
          // point too, so Recharts draws the connecting segment.
          if (partial[i] && !partial[i - 1]) {
            dashed[i - 1] = values[i - 1];     // start dashed at the last complete week
          } else if (!partial[i] && partial[i - 1]) {
            solid[i - 1] = values[i - 1];      // start solid at the last partial week
          }
        }
        return { solid, dashed };
      }

      const split_signups        = split(vals.signups);
      const split_airbnbConnects = split(vals.airbnbConnects);
      const split_readyToLaunch  = split(vals.readyToLaunch);
      const split_trials         = split(vals.trials);
      const split_customers      = split(vals.customers);

      return w.weekStart.map((ws, i) => ({
        day: ws,                  // x-axis key, named `day` for continuity with daily mode
        weekEnd: w.weekEnd[i],
        partial: w.partial[i],
        // Plotted values — used by the tooltip (read directly from row.payload)
        signups: vals.signups[i],
        airbnbConnects: vals.airbnbConnects[i],
        readyToLaunch: vals.readyToLaunch[i],
        trials: vals.trials[i],
        customers: vals.customers[i],
        // Budget Spent — always raw $, single continuous line on the
        // right $ y-axis. Not split into solid/dashed.
        spend: w.spend[i],
        // Split values — used by the two Line components per metric
        signups_solid: split_signups.solid[i],
        signups_dashed: split_signups.dashed[i],
        airbnbConnects_solid: split_airbnbConnects.solid[i],
        airbnbConnects_dashed: split_airbnbConnects.dashed[i],
        readyToLaunch_solid: split_readyToLaunch.solid[i],
        readyToLaunch_dashed: split_readyToLaunch.dashed[i],
        trials_solid: split_trials.solid[i],
        trials_dashed: split_trials.dashed[i],
        customers_solid: split_customers.solid[i],
        customers_dashed: split_customers.dashed[i],
      }));
    }
    // Daily mode. Smooth the counts first (if enabled), then take the ratio —
    // dividing two smoothed series is far less jumpy than smoothing a noisy
    // day-by-day ratio of small numbers.
    const rawOrSmooth = (a: number[]) => (smoothed ? smooth(a) : a);
    const base: Record<Exclude<MetricKey, "spend">, number[]> = {
      signups: rawOrSmooth(data.signups),
      airbnbConnects: rawOrSmooth(data.airbnbConnects),
      readyToLaunch: rawOrSmooth(data.readyToLaunch),
      trials: rawOrSmooth(data.trials),
      customers: rawOrSmooth(data.customers),
    };
    // Spend gets the same smoothing treatment as counts (daily $ is
    // also spiky weekend-vs-weekday) but always reads as raw $, not %.
    const spendSeries = rawOrSmooth(data.spend || new Array(data.days.length).fill(0));
    const series: Record<Exclude<MetricKey, "spend">, (number | null)[]> = asPercent
      ? {
          signups: toPercentOf(base.signups, base.signups),
          airbnbConnects: toPercentOf(base.airbnbConnects, base.signups),
          readyToLaunch: toPercentOf(base.readyToLaunch, base.signups),
          trials: toPercentOf(base.trials, base.signups),
          customers: toPercentOf(base.customers, base.signups),
        }
      : base;
    return data.days.map((day, i) => ({
      day,
      signups: series.signups[i],
      airbnbConnects: series.airbnbConnects[i],
      readyToLaunch: series.readyToLaunch[i],
      trials: series.trials[i],
      customers: series.customers[i],
      spend: spendSeries[i],
    }));
  }, [data, smoothed, granularity, mode]);

  // Headline totals shown in the card header — full series sums, not
  // smoothed (smoothing is just for the visual line).
  const totals = useMemo(() => {
    if (!data) return null;
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    return {
      signups: sum(data.signups),
      airbnbConnects: sum(data.airbnbConnects),
      readyToLaunch: sum(data.readyToLaunch),
      trials: sum(data.trials),
      customers: sum(data.customers),
      spend: sum(data.spend || []),
    };
  }, [data]);

  function toggle(key: MetricKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Run Rate</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[11px] font-medium">
            {data ? `${data.days[0]} → ${data.days[data.days.length - 1]}` : "—"}
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Period-based.</span>{" "}
          {granularity === "month" ? "Monthly" : granularity === "week" ? "Weekly" : "Daily"} counts of each milestone since March 1, 2026 (
          {granularity === "month"
            ? "sum per calendar month, ET"
            : granularity === "week"
              ? "sum per Monday–Sunday week, ET"
              : "one point per ET calendar day"}). Signups / Airbnb Connects / Ready to Launch use{" "}
          <code className="text-[#C9D1DC]">createdate</code> (same-day proxy); Trialists use{" "}
          <code className="text-[#C9D1DC]">trial__start_date</code>; Customers use{" "}
          <code className="text-[#C9D1DC]">hs_v2_date_entered_customer</code>. Toggle metrics
          with the chips below; switch Daily / Weekly / Monthly with the toggle on the right.
          {mode === "percent" && (
            <>
              {" "}Showing each milestone as a{" "}
              <span className="text-[#60A5FA]">% of Qualified Signups</span> in the same
              bucket — funnel conversion rates over time, with Qualified Signups as the
              100% baseline.
            </>
          )}
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-12 text-center">Loading time series…</p>
        )}
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-3 text-[#C9D1DC] text-[12px]">
            <p className="font-semibold text-white">Failed to load timeseries</p>
            <p className="text-[11px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {data && totals && (
          <>
            {/* Toggle chips — one per metric. Active chips have the metric
                colour as the bg dot and a white text; inactive show only
                a dim outline so the chart stays the focus. */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {METRICS.map((m) => {
                const isOn = active.has(m.key);
                return (
                  <button
                    key={m.key}
                    onClick={() => toggle(m.key)}
                    className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12px] font-medium transition-all ${
                      isOn
                        ? "bg-[#1A2235] border-[#1F2937] text-white"
                        : "bg-[#11182B] border-[#1F2937] text-[#5B6478] hover:text-[#C9D1DC]"
                    }`}
                    title={m.description}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: isOn ? m.color : "#1F2937" }}
                    />
                    <span>{m.label}</span>
                    <span className="text-[11px] tabular-nums opacity-60">
                      {m.isCurrency
                        ? `$${Math.round(totals[m.key]).toLocaleString()}`
                        : totals[m.key].toLocaleString()}
                    </span>
                  </button>
                );
              })}

              <div className="ml-auto flex items-center gap-3">
                {/* Value-mode toggle — Counts (raw volumes) vs. % of
                    Qualified Signups (conversion rate over time). */}
                <div className="inline-flex rounded-full border border-[#1F2937] bg-[#0E1422] p-0.5 text-[11px] font-semibold">
                  {([
                    ["count", "Counts"],
                    ["percent", "% of signups"],
                  ] as [Mode, string][]).map(([md, label]) => (
                    <button
                      key={md}
                      onClick={() => setMode(md)}
                      className={`px-3 py-1 rounded-full transition-colors ${
                        mode === md
                          ? "bg-[#1E6FFF] text-white"
                          : "text-[#8B92A3] hover:text-white"
                      }`}
                      title={
                        md === "percent"
                          ? "Show each milestone as a % of Qualified Signups in the same bucket"
                          : "Show raw counts"
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Granularity toggle — Daily / Weekly / Monthly.
                    Daily for spotting day-of-week patterns; Weekly
                    (Mon-Sun ET) for the natural growth reporting
                    cadence; Monthly for board-style cohort trends.
                    Partial periods at either edge render dashed. */}
                <div className="inline-flex rounded-full border border-[#1F2937] bg-[#0E1422] p-0.5 text-[11px] font-semibold">
                  {(["day", "week", "month"] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`px-3 py-1 rounded-full transition-colors ${
                        granularity === g
                          ? "bg-[#1E6FFF] text-white"
                          : "text-[#8B92A3] hover:text-white"
                      }`}
                    >
                      {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
                    </button>
                  ))}
                </div>

                {/* 7-day smoothing only applies to daily granularity. */}
                {granularity === "day" && (
                  <span className="text-[12px] text-[#8B92A3] flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={smoothed}
                      onChange={(e) => setSmoothed(e.target.checked)}
                      className="accent-[#1E6FFF]"
                      id="smoothed"
                    />
                    <label htmlFor="smoothed" className="cursor-pointer">7-day smooth</label>
                  </span>
                )}
              </div>
            </div>

            {/* Line chart. Each enabled metric becomes a Line. The chart
                grows or shrinks the y-axis automatically from whatever's
                visible, so disabling a tall series re-zooms to the rest. */}
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#1F2937" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "#8B92A3" }}
                    axisLine={{ stroke: "#1F2937" }}
                    tickLine={false}
                    minTickGap={granularity === "month" ? 24 : granularity === "week" ? 40 : 60}
                    tickFormatter={(v: string) => (granularity === "month" ? shortMonth(v) : shortDate(v))}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: "#5B6478" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    // Round y-axis ticks to integers — fractional people
                    // don't make sense even when the underlying line is a
                    // 7-day moving average. In percent mode, show "NN%".
                    tickFormatter={(v: number) =>
                      mode === "percent" ? `${Math.round(v)}%` : Math.round(v).toLocaleString()
                    }
                    allowDecimals={false}
                  />
                  {/* Secondary $ axis for the Budget Spent line.
                      Independent scale so the spend curve (hundreds–thousands $)
                      doesn't squash the funnel-stage counts (0–50 typical). */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "#F59E0B" }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}K` : `$${Math.round(v)}`
                    }
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    // Custom content so we can render colour dots before
                    // each metric name AND show step-to-step conversion %
                    // between adjacent visible metrics (e.g. Trials/QS).
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean;
                        label?: string | number;
                        payload?: ReadonlyArray<{ name?: string | number; value?: number | string; color?: string; payload?: Record<string, number | null | string | boolean> }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;

                      // Read raw values from the row payload — that has
                      // every metric's full value (vs. the per-Line
                      // `name`/`value` pairs, which in weekly mode are
                      // split into "_solid"/"_dashed" halves with nulls).
                      const row = (payload[0] as { payload?: Record<string, number | null | string | boolean> })?.payload ?? {};

                      // Build a key-indexed lookup of values for visible
                      // metrics (outer-scope `active` is the toggle Set).
                      const byKey: Record<string, { name: string; value: number; color: string }> = {};
                      for (const m of METRICS) {
                        if (!active.has(m.key)) continue;
                        const v = row[m.key];
                        const num = typeof v === "number" ? v : parseFloat(String(v ?? 0));
                        if (Number.isFinite(num)) {
                          byKey[m.key] = { name: m.label, value: num, color: m.color };
                        }
                      }

                      // Render rows in METRICS order so the funnel reads
                      // top-to-bottom (signups → connects → ready → trials → customers)
                      const visible = METRICS.filter((m) => byKey[m.key]);

                      // Format the date label.
                      // - Daily:   "Apr 12, 2026"
                      // - Weekly:  "Mon Apr 28 – Sun May 4 (partial week)"
                      // - Monthly: "Mar 2026 (full)" / "May 2026 (partial month, 1-27)"
                      const labelStr = typeof label === "string" ? label : String(label ?? "");
                      const firstPayload = payload[0] as unknown as { payload?: { weekEnd?: string; partial?: boolean } } | undefined;
                      const weekEnd = firstPayload?.payload?.weekEnd;
                      const partial = firstPayload?.payload?.partial;
                      let dateStr: string = labelStr;
                      if (granularity === "month" && weekEnd) {
                        // labelStr = "YYYY-MM-01" (first day), weekEnd = last calendar day.
                        // For partial months we show "May 2026 (partial, through May 27)"
                        // so the reader knows what window is summed.
                        const baseLabel = shortMonth(labelStr);
                        if (partial) {
                          // Find the latest date we actually have data for — same calc
                          // as the bucket's range but without re-walking the data.
                          dateStr = `${baseLabel}  (partial month, through ${shortDate(weekEnd)})`;
                        } else {
                          dateStr = `${baseLabel}  (full month)`;
                        }
                      } else if (granularity === "week" && weekEnd) {
                        // "Mon Apr 27 – Sun May 3" so the reader can see
                        // at a glance the bucket matches the Mon-Sun
                        // convention used by the "Last week" filter.
                        dateStr = `Mon ${shortDate(labelStr)} – Sun ${shortDate(weekEnd)}${partial ? "  (partial week)" : ""}`;
                      } else if (labelStr && /^\d{4}-\d{2}-\d{2}/.test(labelStr)) {
                        const [, m, d] = labelStr.split("-");
                        const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        dateStr = `${months[parseInt(m)]} ${parseInt(d)}, ${labelStr.split("-")[0]}`;
                      }

                      return (
                        <div
                          style={{
                            backgroundColor: "rgba(14, 20, 34, 0.95)",
                            backdropFilter: "blur(8px)",
                            borderRadius: 12,
                            border: "1px solid #1F2937",
                            fontSize: 12,
                            boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
                            padding: "10px 14px",
                            color: "#FFFFFF",
                            minWidth: 200,
                          }}
                        >
                          <div style={{ color: "#8B92A3", fontSize: 11, marginBottom: 6 }}>
                            {dateStr}
                          </div>

                          {visible.map((m) => {
                            const row = byKey[m.key];
                            return (
                              <div
                                key={m.key}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "2px 0",
                                  color: "#C9D1DC",
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-block",
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    backgroundColor: m.color,
                                    flexShrink: 0,
                                  }}
                                />
                                <span style={{ flex: 1 }}>{m.label}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", color: "#FFFFFF", fontWeight: 600 }}>
                                  {m.isCurrency
                                    ? `$${Math.round(row.value).toLocaleString()}`
                                    : mode === "percent"
                                      ? `${row.value.toFixed(1)}%`
                                      : Math.round(row.value).toLocaleString()}
                                </span>
                              </div>
                            );
                          })}

                          {/* Step-to-step conversion rates between adjacent
                              visible funnel metrics. Excludes "spend"
                              since "$1.5K / 32 trials" is meaningless as a
                              percentage — that ratio would belong on a
                              cost-per-X card, not this funnel tooltip. */}
                          {(() => {
                            const funnelMetrics = visible.filter((m) => !m.isCurrency);
                            if (funnelMetrics.length < 2) return null;
                            return (
                            <div
                              style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: "1px solid #1F2937",
                                color: "#8B92A3",
                                fontSize: 11,
                              }}
                            >
                              {funnelMetrics.slice(0, -1).map((m, i) => {
                                const next = funnelMetrics[i + 1];
                                const a = byKey[m.key].value;
                                const b = byKey[next.key].value;
                                if (!a || a === 0) return null;
                                const pct = (b / a) * 100;
                                return (
                                  <div key={m.key + "->" + next.key} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                                    <span>{m.label} → {next.label}</span>
                                    <span style={{ fontVariantNumeric: "tabular-nums", color: "#60A5FA" }}>
                                      {pct.toFixed(1)}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            );
                          })()}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    iconType="line"
                    iconSize={14}
                    wrapperStyle={{ paddingTop: 12, fontSize: 11 }}
                    formatter={(value) => {
                      const m = METRICS.find((x) => x.key === value);
                      return <span className="text-[#C9D1DC]">{m?.label || value}</span>;
                    }}
                  />
                  {/* In daily mode: one solid Line per metric.
                      In weekly / monthly mode: TWO lines per metric —
                      solid covers full periods, dashed covers the
                      leading-edge / trailing-edge partial period so
                      the reader doesn't misread a half-period dip as
                      a real drop. Both pull from null-padded arrays
                      built in `rows`, so they only render where they
                      should. */}
                  {METRICS.filter((m) => active.has(m.key)).flatMap((m) => {
                    // Budget Spent — always a single dotted line on the
                    // right ($) y-axis, regardless of granularity. We
                    // don't split it into solid/dashed for partial
                    // periods because it's ALREADY dotted; the doubled
                    // dash treatment would be visually confusing.
                    if (m.key === "spend") {
                      return [
                        <Line
                          key="spend"
                          yAxisId="right"
                          type="monotone"
                          name={m.key}
                          dataKey="spend"
                          stroke={m.color}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0, fill: m.color }}
                          isAnimationActive={false}
                          connectNulls={false}
                        />,
                      ];
                    }
                    if (granularity !== "day") {
                      return [
                        <Line
                          key={m.key + "_solid"}
                          yAxisId="left"
                          type="monotone"
                          name={m.key}
                          dataKey={m.key + "_solid"}
                          stroke={m.color}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 5, strokeWidth: 0, fill: m.color }}
                          isAnimationActive={false}
                          connectNulls={false}
                        />,
                        <Line
                          key={m.key + "_dashed"}
                          yAxisId="left"
                          type="monotone"
                          name={m.key + "__dashed"}
                          dataKey={m.key + "_dashed"}
                          stroke={m.color}
                          strokeWidth={2.5}
                          strokeDasharray="4 4"
                          strokeOpacity={0.85}
                          dot={false}
                          activeDot={{ r: 5, strokeWidth: 0, fill: m.color }}
                          isAnimationActive={false}
                          connectNulls={false}
                          legendType="none"  // hide the dashed half from the legend
                        />,
                      ];
                    }
                    return [
                      <Line
                        key={m.key}
                        yAxisId="left"
                        type="monotone"
                        dataKey={m.key}
                        stroke={m.color}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, strokeWidth: 0, fill: m.color }}
                        isAnimationActive={false}
                      />,
                    ];
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
