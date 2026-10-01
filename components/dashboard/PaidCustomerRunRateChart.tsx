"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

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
  actual: number[];
  target: number[];
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
  // Default to month view since targets are set monthly — makes the
  // target line step cleanly on each 1st and the gap column read as
  // "monthly surplus / deficit".
  const [granularity, setGranularity] = useState<Granularity>("month");

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
    const days   = data.days.slice(firstTargetDay);
    const actual = data.actual.slice(firstTargetDay);
    const target = data.target.slice(firstTargetDay);

    // 2) Bucket daily actual + target into day / week / month totals.
    type Agg = { actual: number; target: number };
    const buckets = new Map<string, Agg>();
    const order: string[] = [];
    for (let i = 0; i < days.length; i++) {
      const k = bucketKey(days[i], granularity);
      let b = buckets.get(k);
      if (!b) { b = { actual: 0, target: 0 }; buckets.set(k, b); order.push(k); }
      b.actual += actual[i] || 0;
      b.target += target[i] || 0;
    }

    // 3) Walk the buckets in order and compute CUMULATIVE actual + target.
    //    These are the series the chart plots. The per-bucket raw values
    //    stay in the row so the tooltip can show both.
    type Row = {
      label: string;
      actualBucket: number; targetBucket: number;
      actualCum: number;    targetCum: number;
      surplus: number;
    };
    let aCum = 0, tCum = 0;
    const base: Row[] = order.map((k) => {
      const b = buckets.get(k)!;
      aCum += b.actual;
      tCum += b.target;
      return {
        label: k,
        actualBucket: b.actual, targetBucket: b.target,
        actualCum: aCum,        targetCum: tCum,
        surplus: aCum - tCum,
      };
    });

    // 4) Mark the last bucket as partial so the current period renders
    //    dotted. Split-array trick lifted from RtlRunRateChart: each
    //    cumulative series gets a solid-only copy and a dashed-only copy
    //    with the boundary point duplicated so the line is continuous.
    const N = base.length;
    const partial: boolean[] = new Array(N).fill(false);
    if (N > 0) partial[N - 1] = true;
    function split(values: (number | null)[]): { solid: (number | null)[]; dashed: (number | null)[] } {
      const solid: (number | null)[] = new Array(N).fill(null);
      const dashed: (number | null)[] = new Array(N).fill(null);
      for (let i = 0; i < N; i++) (partial[i] ? dashed : solid)[i] = values[i];
      for (let i = 1; i < N; i++) {
        if (partial[i] && !partial[i - 1]) dashed[i - 1] = values[i - 1];
        else if (!partial[i] && partial[i - 1]) solid[i - 1] = values[i - 1];
      }
      return { solid, dashed };
    }
    const splits = {
      actualCum: split(base.map((r) => r.actualCum)),
      targetCum: split(base.map((r) => r.targetCum)),
    };

    return base.map((r, i) => ({
      ...r,
      // isPartial is tracked explicitly here so the tooltip can tell
      // "this bucket is the current, incomplete one" apart from "this
      // bucket is complete but it's the boundary point duplicated into
      // the dashed series so the line visually connects". Reading the
      // dashed field as the partial signal (as RtlRunRateChart does)
      // mislabels the last complete bucket when the hover lands on it.
      isPartial: partial[i],
      actualCum_solid:  splits.actualCum.solid[i],
      actualCum_dashed: splits.actualCum.dashed[i],
      targetCum_solid:  splits.targetCum.solid[i],
      targetCum_dashed: splits.targetCum.dashed[i],
    } as Record<string, number | string | boolean | null>));
  }, [data, granularity]);

  const totals = useMemo(() => {
    if (!data) return null;
    // Only sum from the first target day forward so the chip totals
    // agree with the trimmed series the chart draws (otherwise the
    // chip "Actual" would be ~150 higher than the chart's rightmost
    // Actual point from the pre-target July days that aren't plotted).
    let firstTargetDay = data.target.findIndex((t) => t > 0);
    if (firstTargetDay === -1) firstTargetDay = 0;
    const sumActual = data.actual.slice(firstTargetDay).reduce((s, v) => s + v, 0);
    const sumTarget = data.target.slice(firstTargetDay).reduce((s, v) => s + v, 0);
    // Round the surplus before storing so the chip label never flips
    // to "Deficit" or prints "-0" because of a float-arithmetic sliver.
    return {
      actualCum: sumActual,
      targetCum: sumTarget,
      surplus:   Math.round(sumActual - sumTarget),
    };
  }, [data]);

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Paid Customer Run Rate</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[11px] font-medium">
            Cumulative vs target · last 90 days
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Period-based.</span>{" "}
          Running total of real paid customers (date = <code className="text-[#C9D1DC]">hs_v2_date_entered_customer</code>) alongside the
          running total of the monthly customer target, prorated per day. The gap at any point is the surplus
          or deficit since the start of the window. Target months currently loaded: Aug to Dec 2026. Excludes
          partner referrals and Futurestay test contacts.
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        {loading && !data && <p className="text-[12px] text-[#8B92A3] py-12 text-center">Loading…</p>}
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-3 text-[#C9D1DC] text-[12px]">
            <p className="font-semibold text-white">Failed to load</p>
            <p className="text-[11px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {data && totals && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {METRICS.map((m) => {
                const raw = totals[m.key];
                return (
                  <span
                    key={m.key}
                    className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-[#1A2235] border border-[#1F2937] text-[12px] font-medium text-white"
                    title={m.description}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                    <span>{m.label}</span>
                    <span className="text-[11px] tabular-nums opacity-60">
                      {Math.round(raw).toLocaleString()}
                    </span>
                  </span>
                );
              })}
              <span
                className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12px] font-medium tabular-nums ${
                  totals.surplus >= 0
                    ? "bg-[#0F2A1F] border-[#10B981]/25 text-[#10B981]"
                    : "bg-[#2A0F13] border-[#EF4444]/25 text-[#EF4444]"
                }`}
                title="Cumulative surplus (positive) or deficit (negative) over the last 90 days"
              >
                {totals.surplus >= 0 ? "Surplus" : "Deficit"}
                <span>{totals.surplus > 0 ? "+" : ""}{totals.surplus.toLocaleString()}</span>
              </span>
              <div className="ml-auto inline-flex h-8 rounded-full bg-[#0E1422] border border-[#1F2937] p-0.5">
                {(["day", "week", "month"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-3 rounded-full text-[12px] font-medium transition-colors cursor-pointer ${
                      granularity === g ? "bg-[#1E6FFF] text-white" : "text-[#8B92A3] hover:text-white"
                    }`}
                  >
                    {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#1F2937" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#8B92A3", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "#1F2937" }}
                    tickFormatter={(v: string) => fmtTick(v, granularity)}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: "#8B92A3", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "#1F2937" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    position={{ x: 40, y: 40 }}
                    wrapperStyle={{ opacity: 0.65, pointerEvents: "none" }}
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean; label?: string;
                        payload?: ReadonlyArray<{ payload?: Record<string, number | null | string | boolean> }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;
                      const raw = payload[0]?.payload ?? {};
                      const isPartial = raw.isPartial === true;
                      const aCum = Number(raw.actualCum ?? 0);
                      const tCum = Number(raw.targetCum ?? 0);
                      const aBkt = Number(raw.actualBucket ?? 0);
                      const tBkt = Number(raw.targetBucket ?? 0);
                      // Round before comparing so a float-arithmetic
                      // sliver (e.g. 154 - 153.999999... = -1e-14) does
                      // not flip the sign of a value that is really 0.
                      // Keeps the chip from ever printing "-0".
                      const surplus       = Math.round(aCum - tCum);
                      const bucketSurplus = Math.round(aBkt - tBkt);
                      return (
                        <div className="bg-[#0E1422] border border-[#1F2937] rounded-lg p-3 text-[11px] min-w-[240px]">
                          <div className="text-[#8B92A3] mb-1">
                            {label ? fmtTooltipDate(String(label), granularity) : ""}
                            {isPartial && <span className="ml-1 text-[#F59E0B]">· partial</span>}
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full flex-none" style={{ backgroundColor: "#1E6FFF" }} />
                              <span className="text-white truncate">Actual (cumulative)</span>
                            </span>
                            <span className="font-mono tabular-nums text-white flex-none">
                              {Math.round(aCum).toLocaleString()}
                              <span className="opacity-50 ml-1">(+{aBkt.toLocaleString()})</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full flex-none" style={{ backgroundColor: "#A78BFA" }} />
                              <span className="text-white truncate">Target (cumulative)</span>
                            </span>
                            <span className="font-mono tabular-nums text-white flex-none">
                              {Math.round(tCum).toLocaleString()}
                              <span className="opacity-50 ml-1">(+{Math.round(tBkt).toLocaleString()})</span>
                            </span>
                          </div>
                          <div className="mt-2 pt-2 border-t border-[#1F2937]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[#8B92A3]">Surplus / deficit</span>
                              <span className={`font-mono tabular-nums font-semibold ${surplus >= 0 ? "text-[#10B981]" : "text-[#EF4444]"}`}>
                                {surplus > 0 ? "+" : ""}{surplus.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 opacity-70">
                              <span className="text-[#8B92A3]">This bucket</span>
                              <span className={`font-mono tabular-nums ${bucketSurplus >= 0 ? "text-[#10B981]" : "text-[#EF4444]"}`}>
                                {bucketSurplus > 0 ? "+" : ""}{bucketSurplus.toLocaleString()}
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
                        strokeWidth={2}
                        strokeDasharray={m.dashed ? "6 4" : undefined}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${m.key}_dashed`}
                        name={`${m.label}__dashed`}
                        stroke={m.color}
                        strokeWidth={2}
                        strokeDasharray="2 4"
                        dot={false}
                        activeDot={{ r: 4 }}
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
