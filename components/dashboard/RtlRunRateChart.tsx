"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// Same visual system as the Run Rate chart above it: dotted right-axis
// lines for dollars, solid left-axis lines for counts / percentage.
// Palette lifted from AllTimeChart so paired lines read as the same
// system (amber Meta, violet Google, primary blue for RTL, soft blue
// for the percentage).
type MetricKey = "metaSpend" | "googleSpend" | "rtl" | "rtlToTrial" | "costPerRtl" | "costPerTrial";

const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  axis: "count" | "money";
  isPercent?: boolean;
  isCurrency?: boolean;
  description: string;
}[] = [
  { key: "metaSpend",   label: "Meta budget",   color: "#F59E0B", axis: "money", isCurrency: true, description: "Meta account-level daily spend" },
  { key: "googleSpend", label: "Google budget", color: "#A78BFA", axis: "money", isCurrency: true, description: "Google Ads account-level daily spend" },
  { key: "rtl",         label: "RTLs",          color: "#1E6FFF", axis: "count",                   description: "Contacts flagged property_ready_to_launch on that day (qualified signups)" },
  { key: "rtlToTrial",  label: "RTL → Trial %", color: "#60A5FA", axis: "count", isPercent: true,  description: "For RTLs signed up in the bucket, share that started a trial" },
  // Cost per RTL sits on the money axis with the two spend lines, and
  // is dashed like them. Scale in $10-$500 range, so it renders as a
  // low line near the bottom of the money axis when Meta/Google spend
  // are also enabled — toggle those off to zoom in on this metric.
  { key: "costPerRtl",   label: "Cost / RTL",   color: "#F87171", axis: "money", isCurrency: true, description: "(Meta + Google spend) / RTL count for the bucket" },
  // Cost per Trialist — same shape as Cost / RTL but divided by trials
  // instead. Runs a bit hotter numerically (trials are ~40% of RTLs on
  // average, so $/Trial is roughly 2.5x $/RTL). Warm orange colour to
  // read as related-to-cost-efficiency but distinct from Cost / RTL.
  { key: "costPerTrial", label: "Cost / Trial", color: "#FB923C", axis: "money", isCurrency: true, description: "(Meta + Google spend) / Trial count for the bucket" },
];

type Granularity = "day" | "week" | "month";

interface ApiResponse {
  days: string[];
  metaSpend: number[];
  googleSpend: number[];
  rtl: number[];
  trials: number[];
}

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
  // Tooltip header — same date shape as the x-axis tick, plus the day
  // of week for daily and weekly views (skipped for monthly since the
  // bucket key is always the 1st).
  if (g === "month") return fmtTick(key, g);
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const base = fmtTick(key, g);
  return `${base} (${dow})`;
}

export default function RtlRunRateChart() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [active, setActive] = useState<Set<MetricKey>>(
    new Set<MetricKey>(["metaSpend", "googleSpend", "rtl", "rtlToTrial"]),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/rtl-run-rate")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ApiResponse) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [] as Array<Record<string, number | string | null>>;
    // Aggregate the 4 daily series into buckets, then compute the % from
    // bucket totals so it reads correctly at every granularity.
    type Agg = { metaSpend: number; googleSpend: number; rtl: number; trials: number };
    const buckets = new Map<string, Agg>();
    const order: string[] = [];
    for (let i = 0; i < data.days.length; i++) {
      const k = bucketKey(data.days[i], granularity);
      let b = buckets.get(k);
      if (!b) { b = { metaSpend: 0, googleSpend: 0, rtl: 0, trials: 0 }; buckets.set(k, b); order.push(k); }
      b.metaSpend  += data.metaSpend[i]   || 0;
      b.googleSpend+= data.googleSpend[i] || 0;
      b.rtl        += data.rtl[i]         || 0;
      b.trials     += data.trials[i]      || 0;
    }

    // Compute derived values per bucket.
    type Row = { label: string; metaSpend: number; googleSpend: number; rtl: number; rtlToTrial: number | null; costPerRtl: number | null; costPerTrial: number | null };
    const base: Row[] = order.map((k) => {
      const b = buckets.get(k)!;
      const pct = b.rtl > 0 ? (b.trials / b.rtl) * 100 : null;
      const costPerRtl = b.rtl > 0 ? (b.metaSpend + b.googleSpend) / b.rtl : null;
      const costPerTrial = b.trials > 0 ? (b.metaSpend + b.googleSpend) / b.trials : null;
      return {
        label: k,
        metaSpend: b.metaSpend, googleSpend: b.googleSpend,
        rtl: b.rtl, rtlToTrial: pct, costPerRtl, costPerTrial,
      };
    });

    // Mark the LAST bucket as partial in every granularity.
    // Daily: today (still accumulating). Weekly: current Mon-Sun.
    // Monthly: current calendar month. Split each metric's series into
    // solid (complete buckets) + dashed (partial bucket) so the current
    // period renders dotted. The boundary point (last complete bucket)
    // is duplicated into the dashed series so the line visually
    // connects across the transition rather than gapping.
    const N = base.length;
    const partial: boolean[] = new Array(N).fill(false);
    if (N > 0) partial[N - 1] = true;
    const numericKeys = ["metaSpend", "googleSpend", "rtl", "rtlToTrial", "costPerRtl", "costPerTrial"] as const;
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
    const splits: Record<string, { solid: (number | null)[]; dashed: (number | null)[] }> = {};
    for (const k of numericKeys) splits[k] = split(base.map((r) => r[k] as number | null));

    return base.map((r, i) => {
      const row: Record<string, number | string | null> = { ...r };
      for (const k of numericKeys) {
        row[`${k}_solid`] = splits[k].solid[i];
        row[`${k}_dashed`] = splits[k].dashed[i];
      }
      return row;
    });
  }, [data, granularity]);

  const totals = useMemo(() => {
    if (!data) return null;
    const sumMeta = data.metaSpend.reduce((s, v) => s + v, 0);
    const sumGoogle = data.googleSpend.reduce((s, v) => s + v, 0);
    const sumRtl = data.rtl.reduce((s, v) => s + v, 0);
    const sumTr  = data.trials.reduce((s, v) => s + v, 0);
    return {
      metaSpend:     sumMeta,
      googleSpend:   sumGoogle,
      rtl:           sumRtl,
      rtlToTrial:    sumRtl > 0 ? (sumTr / sumRtl) * 100 : null,
      costPerRtl:    sumRtl > 0 ? (sumMeta + sumGoogle) / sumRtl : null,
      costPerTrial:  sumTr  > 0 ? (sumMeta + sumGoogle) / sumTr  : null,
    };
  }, [data]);

  function toggle(key: MetricKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const hasMoneyLines = METRICS.some((m) => m.axis === "money" && active.has(m.key));
  const hasCountLines = METRICS.some((m) => m.axis === "count" && active.has(m.key));

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>RTL Run Rate</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[11px] font-medium">
            Account-level · last 90 days
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Period-based.</span>{" "}
          Daily / weekly / monthly totals across Meta and Google, alongside the RTL count and its
          conversion to Trial. RTL uses <code className="text-[#C9D1DC]">property_ready_to_launch</code> at
          <code className="text-[#C9D1DC]"> createdate</code>; conversion is computed from bucket totals so
          the weekly and monthly views read from the same denominator as the daily.
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
            {/* Toggle chips + granularity pill. Same geometry as the
                Run Rate chart above, so the two read as a set. */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {METRICS.map((m) => {
                const isOn = active.has(m.key);
                const raw = totals[m.key];
                const totalDisplay = m.isPercent
                  ? (raw === null || raw === undefined ? "—" : `${(raw as number).toFixed(1)}%`)
                  : m.isCurrency
                    ? `$${Math.round(raw as number).toLocaleString()}`
                    : (raw as number).toLocaleString();
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
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isOn ? m.color : "#1F2937" }} />
                    <span>{m.label}</span>
                    <span className="text-[11px] tabular-nums opacity-60">{totalDisplay}</span>
                  </button>
                );
              })}
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
                  {hasCountLines && (
                    <YAxis
                      yAxisId="count"
                      tick={{ fill: "#8B92A3", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "#1F2937" }}
                      allowDecimals={false}
                    />
                  )}
                  {hasMoneyLines && (
                    <YAxis
                      yAxisId="money"
                      orientation="right"
                      tick={{ fill: "#8B92A3", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "#1F2937" }}
                      tickFormatter={(v: number) => `$${v >= 1000 ? (v / 1000).toFixed(0) + "K" : v.toFixed(0)}`}
                    />
                  )}
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    // Fix BOTH x and y so the tooltip pins to the
                    // upper-left region of the plot area, out of the
                    // cursor's way. Do not set `transform` in
                    // wrapperStyle — Recharts uses that CSS property
                    // for cursor tracking, and overriding it strands
                    // the wrapper in the corner (the very bug we hit
                    // before). Opacity 0.65 so lines under the tooltip
                    // stay readable.
                    position={{ x: 40, y: 40 }}
                    wrapperStyle={{ opacity: 0.65, pointerEvents: "none" }}
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean; label?: string;
                        payload?: ReadonlyArray<{ payload?: Record<string, number | null | string | boolean> }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;
                      // Read raw values off the row payload — the base
                      // metric keys are still present alongside the
                      // _solid / _dashed split fields, so a lookup here
                      // works regardless of which line the cursor was
                      // over. Also means the tooltip shows all active
                      // metrics for the bucket, not just the one line.
                      const raw = payload[0]?.payload ?? {};
                      const isPartial = !!raw.metaSpend_dashed || !!raw.rtl_dashed;
                      return (
                        <div className="bg-[#0E1422] border border-[#1F2937] rounded-lg p-3 text-[11px] min-w-[220px]">
                          <div className="text-[#8B92A3] mb-1">
                            {label ? fmtTooltipDate(String(label), granularity) : ""}
                            {isPartial && <span className="ml-1 text-[#F59E0B]">· partial</span>}
                          </div>
                          {METRICS.filter((m) => active.has(m.key)).map((m) => {
                            const rv = raw[m.key];
                            if (rv === null || rv === undefined) return null;
                            const v = typeof rv === "number" ? rv : Number(rv);
                            if (!Number.isFinite(v)) return null;
                            const display = m.isPercent
                              ? `${v.toFixed(1)}%`
                              : m.isCurrency
                                ? `$${Math.round(v).toLocaleString()}`
                                : v.toLocaleString();
                            return (
                              <div key={m.key} className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2 min-w-0">
                                  <span className="h-2 w-2 rounded-full flex-none" style={{ backgroundColor: m.color }} />
                                  <span className="text-white truncate">{m.label}</span>
                                </span>
                                <span className="font-mono tabular-nums text-white flex-none">{display}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  {/* Two Line components per metric: solid stroke for
                      complete buckets, dotted stroke for the current
                      partial bucket. The split arrays computed in
                      `rows` above ensure the dotted segment starts
                      at the last-complete bucket so the transition
                      reads as one continuous line with a texture
                      change instead of a gap. */}
                  {METRICS.map((m) => {
                    if (!active.has(m.key)) return null;
                    const solidDash = m.isCurrency ? "4 4" : undefined;
                    return (
                      <React.Fragment key={m.key}>
                        <Line
                          key={m.key + "_solid"}
                          type="monotone"
                          dataKey={`${m.key}_solid`}
                          name={m.label}
                          yAxisId={m.axis}
                          stroke={m.color}
                          strokeWidth={2}
                          strokeDasharray={solidDash}
                          dot={false}
                          activeDot={{ r: 4 }}
                          isAnimationActive={false}
                          connectNulls={false}
                        />
                        <Line
                          key={m.key + "_dashed"}
                          type="monotone"
                          dataKey={`${m.key}_dashed`}
                          name={`${m.label}__dashed`}
                          yAxisId={m.axis}
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
                    );
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
