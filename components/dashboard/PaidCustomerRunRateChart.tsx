"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { MONTHLY_CUSTOMER_TARGETS } from "@/lib/customer-targets";
import { tzDateKey } from "@/lib/timezone";
import { PaidCustomerFourTiles, summarize } from "./PaidCustomerMetricsRow";

/**
 * Paid Customer Run Rate — cumulative actual vs cumulative monthly
 * target over the last 90 ET days.
 *
 * Design shape (mirrors RtlRunRateChart):
 *   - Day / Week / Month granularity toggle
 *   - Last bucket in every granularity drawn dotted (partial)
 *   - Both series are CUMULATIVE across the whole window so you can read
 *     "total surplus / deficit at that stage" directly as the gap
 *     between the two lines
 *   - Tooltip shows actual, target, and the surplus / deficit at that
 *     bucket's end (actual - target), plus bucket counts in parentheses
 *
 * Data source: /api/paid-customer-run-rate (daily actual + per-day
 * prorated target). Keeping cumulation client-side keeps the endpoint
 * reusable and lets granularity changes be instant.
 */

type Granularity = "day" | "week" | "month";

interface ApiResponse {
  days: string[];
  actual: (number | null)[];
  target: number[];
  // Per-day flag for days strictly after today ET. The chart uses it
  // to split the target line into actual-to-date vs projected, and
  // to stop the actual line at today.
  isFuture: boolean[];
}

type MetricKey = "actualCum" | "targetCum";

const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  dashed?: boolean;
  description: string;
}[] = [
  { key: "actualCum", label: "Actual (cumulative)", color: "#1E6FFF", description: "Running total of paid customers since the start of the window" },
  { key: "targetCum", label: "Target (cumulative)", color: "#A78BFA", dashed: true, description: "Running total of prorated monthly customer target since the start of the window" },
];

function bucketKey(day: string, g: Granularity): string {
  if (g === "day") return day;
  if (g === "month") return day.slice(0, 7) + "-01";
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  const mon = new Date(dt.getTime() - back * 86_400_000);
  return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
}

function fmtTick(key: string, g: Granularity): string {
  const [y, m, d] = key.split("-").map(Number);
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (g === "month") return `${months[m]} '${String(y).slice(2)}`;
  return `${months[m]} ${d}`;
}
function fmtTooltipDate(key: string, g: Granularity): string {
  if (g === "month") return fmtTick(key, g);
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${fmtTick(key, g)} (${dow})`;
}

export default function PaidCustomerRunRateChart() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default to weekly — matches the Run Rate chart above so the two
  // read against the same cadence, and gives finer resolution than
  // monthly without the day-view noise.
  const [granularity, setGranularity] = useState<Granularity>("week");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/paid-customer-run-rate")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ApiResponse) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [] as Array<Record<string, number | string | boolean | null>>;

    // 1) Trim the leading days where no target exists yet. Including
    //    them would inflate the "actual" cumulative line against a flat
    //    target line and visually overstate the surplus. Starting at
    //    the first target day puts both series on equal footing.
    let firstTargetDay = data.target.findIndex((t) => t > 0);
    if (firstTargetDay === -1) firstTargetDay = 0;
    const days     = data.days.slice(firstTargetDay);
    const actual   = data.actual.slice(firstTargetDay);
    const target   = data.target.slice(firstTargetDay);
    const isFuture = (data.isFuture ?? new Array(data.days.length).fill(false)).slice(firstTargetDay);

    // 2) Bucket daily actual + target + future-flag into day/week/month
    //    totals. We also track which calendar role each bucket plays —
    //    "past" (fully before today), "current" (contains today) or
    //    "future" (fully after today) — so the chart can stop the
    //    actual line at today while the target line projects forward.
    type Agg = { actual: number; target: number; hasToday: boolean; hasFuture: boolean; hasPast: boolean };
    const buckets = new Map<string, Agg>();
    const order: string[] = [];
    const todayIso = tzDateKey(new Date());
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const k = bucketKey(d, granularity);
      let b = buckets.get(k);
      if (!b) { b = { actual: 0, target: 0, hasToday: false, hasFuture: false, hasPast: false }; buckets.set(k, b); order.push(k); }
      const a = actual[i];
      if (a !== null && a !== undefined) b.actual += a;
      b.target += target[i] || 0;
      if (isFuture[i]) b.hasFuture = true;
      else if (d === todayIso) b.hasToday = true;
      else b.hasPast = true;
    }
    type Kind = "past" | "current" | "future";
    function kindOf(b: Agg): Kind {
      if (b.hasToday) return "current";
      if (b.hasFuture && !b.hasPast) return "future";
      return "past";
    }

    // 3) Walk the buckets in order and compute CUMULATIVE actual + target.
    //    Target accumulates all the way through the horizon. Actual stops
    //    accumulating in future buckets and is set to null there so the
    //    chart gaps the actual line at today.
    //
    //    For monthly buckets we also carry the FULL-month target (from
    //    the lookup map) so the tooltip can show the real monthly goal
    //    (165 for Oct, 174 for Nov, 182 for Dec) rather than the
    //    day-prorated share the cumulative line uses.
    type Row = {
      label: string;
      actualBucket: number | null;
      targetBucket: number;
      monthlyTargetFull: number | null;
      actualCum: number | null;
      targetCum: number;
      surplus: number | null;
      kind: Kind;
    };
    let aCum = 0, tCum = 0;
    const base: Row[] = order.map((k) => {
      const b = buckets.get(k)!;
      const kind = kindOf(b);
      tCum += b.target;
      if (kind !== "future") aCum += b.actual;
      const actualCum = kind === "future" ? null : aCum;
      const monthlyTargetFull = granularity === "month"
        ? (MONTHLY_CUSTOMER_TARGETS[k.slice(0, 7)] ?? null)
        : null;
      return {
        label: k,
        actualBucket: kind === "future" ? null : b.actual,
        targetBucket: b.target,
        monthlyTargetFull,
        actualCum,
        targetCum: tCum,
        surplus: actualCum === null ? null : actualCum - tCum,
        kind,
      };
    });

    // 4) Split each cumulative series into solid + dashed segments so
    //    the chart can style them differently.
    //      actual: past → solid, current → dashed, future → null
    //      target: past → solid, current + future → dashed (projection
    //              uses the same stroke as the current partial bucket)
    //    Boundary points are duplicated into the dashed series so lines
    //    connect visually at past → current / past → future transitions
    //    instead of leaving a gap.
    const N = base.length;
    function splitActual(values: (number | null)[]) {
      const solid: (number | null)[] = new Array(N).fill(null);
      const dashed: (number | null)[] = new Array(N).fill(null);
      for (let i = 0; i < N; i++) {
        const k = base[i].kind;
        if (k === "past") solid[i] = values[i];
        else if (k === "current") dashed[i] = values[i];
      }
      for (let i = 1; i < N; i++) {
        if (base[i].kind === "current" && base[i - 1].kind === "past") {
          dashed[i - 1] = values[i - 1];
        }
      }
      return { solid, dashed };
    }
    function splitTarget(values: (number | null)[]) {
      const solid: (number | null)[] = new Array(N).fill(null);
      const dashed: (number | null)[] = new Array(N).fill(null);
      for (let i = 0; i < N; i++) {
        const k = base[i].kind;
        if (k === "past") solid[i] = values[i];
        else dashed[i] = values[i];
      }
      for (let i = 1; i < N; i++) {
        if (base[i].kind !== "past" && base[i - 1].kind === "past") {
          dashed[i - 1] = values[i - 1];
        }
      }
      return { solid, dashed };
    }
    const splits = {
      actualCum: splitActual(base.map((r) => r.actualCum)),
      targetCum: splitTarget(base.map((r) => r.targetCum)),
    };

    return base.map((r, i) => ({
      ...r,
      // isPartial / isFuture let the tooltip caption describe the bucket
      // correctly: "partial" for current (today's in-flight bucket),
      // "projected" for future buckets past the horizon.
      isPartial: r.kind === "current",
      isFuture:  r.kind === "future",
      actualCum_solid:  splits.actualCum.solid[i],
      actualCum_dashed: splits.actualCum.dashed[i],
      targetCum_solid:  splits.targetCum.solid[i],
      targetCum_dashed: splits.targetCum.dashed[i],
    } as Record<string, number | string | boolean | null>));
  }, [data, granularity]);

  // Shared summary helper — same four numbers the top-of-dashboard
  // metrics row shows, so the chart card's headline tiles always match.
  const totals = useMemo(() => (data ? summarize(data) : null), [data]);

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-5 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[22px] font-semibold text-white tracking-tight">
          <span>Paid Customer Run Rate</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[13px] font-semibold px-3 py-1">
            Cumulative actual vs projected target · through Dec 2026
          </Badge>
        </CardTitle>
        <p className="text-[15px] text-[#C9D1DC] mt-3 leading-relaxed">
          <span className="text-[#60A5FA] font-semibold">Period-based.</span>{" "}
          Running total of real paid customers (date = <code className="text-[#E6EBF3] bg-[#0E1422] px-1.5 py-0.5 rounded">hs_v2_date_entered_customer</code>) alongside the
          running total of the monthly customer target, prorated per day. The actual line stops at today;
          the target line projects forward through the end of the last target month so the remaining goal
          is visible. Target months currently loaded: Aug to Dec 2026. Excludes partner referrals and
          Futurestay test contacts.
        </p>
      </CardHeader>

      <CardContent className="pt-6">
        {loading && !data && <p className="text-[14px] text-[#C9D1DC] py-16 text-center">Loading…</p>}
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-4 text-[#C9D1DC] text-[14px]">
            <p className="font-semibold text-white text-[15px]">Failed to load</p>
            <p className="text-[13px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {data && totals && (
          <>
            {/* Headline tiles — same four big metrics the top-of-dashboard
                row shows, kept inside the card so the chart reads as
                self-contained and the metrics act as a legend for the
                lines below. */}
            <div className="bg-[#0E1422] border border-[#1F2937] rounded-xl overflow-hidden mb-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-[#1F2937]">
                <PaidCustomerFourTiles totals={totals} />
              </div>
            </div>

            {/* Granularity toggle — moved to its own row so it keeps the
                same right-aligned pill it had next to the old chip row.
                Larger text / taller control for prominence on this
                headline chart. */}
            <div className="flex items-center justify-end mb-5">
              <div className="inline-flex h-10 rounded-full bg-[#0E1422] border border-[#1F2937] p-1">
                {(["day", "week", "month"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-4 rounded-full text-[14px] font-semibold transition-colors cursor-pointer ${
                      granularity === g ? "bg-[#1E6FFF] text-white" : "text-[#8B92A3] hover:text-white"
                    }`}
                  >
                    {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[440px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#1F2937" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#C9D1DC", fontSize: 13 }}
                    tickLine={false}
                    axisLine={{ stroke: "#1F2937" }}
                    tickFormatter={(v: string) => fmtTick(v, granularity)}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: "#C9D1DC", fontSize: 13 }}
                    tickLine={false}
                    axisLine={{ stroke: "#1F2937" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "#60A5FA", strokeWidth: 1.5 }}
                    position={{ x: 40, y: 40 }}
                    wrapperStyle={{ opacity: 0.95, pointerEvents: "none" }}
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean; label?: string;
                        payload?: ReadonlyArray<{ payload?: Record<string, number | null | string | boolean> }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;
                      const raw = payload[0]?.payload ?? {};
                      const isPartial = raw.isPartial === true;
                      const isFutureBucket = raw.isFuture === true;
                      const aCumRaw = raw.actualCum;
                      const aBktRaw = raw.actualBucket;
                      // actualCum / actualBucket are null for future
                      // buckets (we don't know the customer count
                      // yet). Carry that nullability through so the
                      // tooltip can show a plain em-dash instead of
                      // "0" where there is no data.
                      const aCum = aCumRaw === null || aCumRaw === undefined ? null : Number(aCumRaw);
                      const aBkt = aBktRaw === null || aBktRaw === undefined ? null : Number(aBktRaw);
                      const tCum = Number(raw.targetCum ?? 0);
                      // In monthly view, swap in the FULL-month target
                      // (165 for Oct, 174 for Nov, 182 for Dec) in
                      // place of the day-prorated share. Daily / weekly
                      // keep the bucket's own prorated target because
                      // "full-month target" doesn't apply across
                      // sub-month windows.
                      const tBktRaw = Number(raw.targetBucket ?? 0);
                      const monthlyFull = raw.monthlyTargetFull as number | null | undefined;
                      const tBkt = (granularity === "month" && monthlyFull != null)
                        ? monthlyFull
                        : tBktRaw;
                      // Round + `+ 0` normalises float-arithmetic
                      // slivers (154 - 153.999... = -1e-14, which
                      // Math.round preserves as `-0`) so the chip
                      // never prints "-0". The `+ 0` is load-bearing:
                      // `-0 + 0 === +0` while `Math.round` alone
                      // keeps the negative sign.
                      const surplus       = aCum === null ? null : Math.round(aCum - tCum) + 0;
                      const bucketSurplus = aBkt === null ? null : Math.round(aBkt - tBkt) + 0;
                      // "this month / week / day" copy follows the
                      // granularity so the per-bucket block reads
                      // naturally regardless of toggle.
                      const bucketWord =
                        granularity === "month" ? "This month" :
                        granularity === "week"  ? "This week"  :
                                                  "This day";
                      const tagText =
                        isFutureBucket ? "projected" :
                        isPartial      ? "partial"   :
                                         null;
                      // Common renderer so null actuals print as a plain
                      // em-dash instead of "0" or "NaN" — future buckets
                      // have no customer data yet.
                      const fmtNum  = (v: number | null) => v === null ? "—" : v.toLocaleString();
                      const fmtRnd  = (v: number | null) => v === null ? "—" : Math.round(v).toLocaleString();
                      const fmtDelta = (v: number | null) => {
                        if (v === null) return "—";
                        return `${v > 0 ? "+" : ""}${v.toLocaleString()}`;
                      };
                      const deltaTone = (v: number | null) => {
                        if (v === null) return "text-[#5B6478]";
                        return v >= 0 ? "text-[#10B981]" : "text-[#EF4444]";
                      };
                      return (
                        <div className="bg-[#0E1422] border border-[#1F2937] rounded-xl p-4 text-[14px] min-w-[300px] shadow-xl">
                          <div className="text-[#C9D1DC] mb-3 text-[14px] font-semibold">
                            {label ? fmtTooltipDate(String(label), granularity) : ""}
                            {tagText && <span className="ml-2 text-[#F59E0B]">· {tagText}</span>}
                          </div>

                          {/* Per-bucket block — the actual and target
                              for just this month / week / day, plus the
                              surplus or deficit for the same window. */}
                          <div className="mb-3">
                            <div className="text-[11px] uppercase tracking-wider text-[#8B92A3] mb-1.5 font-semibold">{bucketWord}</div>
                            <div className="flex items-center justify-between gap-4 py-0.5">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="h-2.5 w-2.5 rounded-full flex-none" style={{ backgroundColor: "#1E6FFF" }} />
                                <span className="text-white">Actual</span>
                              </span>
                              <span className="font-mono tabular-nums text-white text-[15px] font-semibold">{fmtNum(aBkt)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-0.5">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="h-2.5 w-2.5 rounded-full flex-none" style={{ backgroundColor: "#A78BFA" }} />
                                <span className="text-white">Target</span>
                              </span>
                              <span className="font-mono tabular-nums text-white text-[15px] font-semibold">{Math.round(tBkt).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-0.5">
                              <span className="text-[#8B92A3]">Surplus / deficit</span>
                              <span className={`font-mono tabular-nums font-bold text-[15px] ${deltaTone(bucketSurplus)}`}>
                                {fmtDelta(bucketSurplus)}
                              </span>
                            </div>
                          </div>

                          {/* Cumulative block — totals from the start
                              of the window to the end of this bucket's
                              period. For past buckets this is the real
                              to-date value; for current + future it
                              carries the target line's projection to
                              the end of the bucket, with actual either
                              frozen at today (current) or dashed as
                              unknown (future). */}
                          <div className="pt-3 border-t border-[#1F2937]">
                            <div className="text-[11px] uppercase tracking-wider text-[#8B92A3] mb-1.5 font-semibold">Cumulative at end of period</div>
                            <div className="flex items-center justify-between gap-4 py-0.5">
                              <span className="text-white">Actual</span>
                              <span className="font-mono tabular-nums text-white text-[15px] font-semibold">{fmtRnd(aCum)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-0.5">
                              <span className="text-white">Target</span>
                              <span className="font-mono tabular-nums text-white text-[15px] font-semibold">{Math.round(tCum).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-0.5">
                              <span className="text-[#8B92A3]">Surplus / deficit</span>
                              <span className={`font-mono tabular-nums font-bold text-[15px] ${deltaTone(surplus)}`}>
                                {fmtDelta(surplus)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  {METRICS.map((m) => (
                    <React.Fragment key={m.key}>
                      <Line
                        type="monotone"
                        dataKey={`${m.key}_solid`}
                        name={m.label}
                        stroke={m.color}
                        strokeWidth={3}
                        strokeDasharray={m.dashed ? "7 5" : undefined}
                        dot={false}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${m.key}_dashed`}
                        name={`${m.label}__dashed`}
                        stroke={m.color}
                        strokeWidth={3}
                        strokeDasharray="3 5"
                        dot={false}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                        connectNulls={false}
                        legendType="none"
                      />
                    </React.Fragment>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
