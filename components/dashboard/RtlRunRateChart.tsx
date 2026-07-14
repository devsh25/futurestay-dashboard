"use client";

import { useEffect, useMemo, useState } from "react";
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
type MetricKey = "metaSpend" | "googleSpend" | "rtl" | "rtlToTrial";

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
    return order.map((k) => {
      const b = buckets.get(k)!;
      const pct = b.rtl > 0 ? (b.trials / b.rtl) * 100 : null;
      return { label: k, metaSpend: b.metaSpend, googleSpend: b.googleSpend, rtl: b.rtl, rtlToTrial: pct };
    });
  }, [data, granularity]);

  const totals = useMemo(() => {
    if (!data) return null;
    const sumMeta = data.metaSpend.reduce((s, v) => s + v, 0);
    const sumGoogle = data.googleSpend.reduce((s, v) => s + v, 0);
    const sumRtl = data.rtl.reduce((s, v) => s + v, 0);
    const sumTr  = data.trials.reduce((s, v) => s + v, 0);
    return {
      metaSpend:   sumMeta,
      googleSpend: sumGoogle,
      rtl:         sumRtl,
      rtlToTrial:  sumRtl > 0 ? (sumTr / sumRtl) * 100 : null,
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
                    // Fixed y = tooltip's TOP edge inside the 360px
                    // chart. Do not use `transform: translateY(...)`
                    // in wrapperStyle — Recharts uses that CSS
                    // property for horizontal cursor tracking, so
                    // overriding it pins the tooltip to the corner.
                    position={{ y: 40 }}
                    wrapperStyle={{ opacity: 0.9, pointerEvents: "none" }}
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean; label?: string;
                        payload?: ReadonlyArray<{ name?: string; value?: number | null; color?: string; dataKey?: string }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;
                      return (
                        <div className="bg-[#0E1422] border border-[#1F2937] rounded-lg p-3 text-[11px] min-w-[220px]">
                          <div className="text-[#8B92A3] mb-1">{label ? fmtTick(String(label), granularity) : ""}</div>
                          {METRICS.filter((m) => active.has(m.key)).map((m) => {
                            const row = payload.find((p) => p.dataKey === m.key);
                            if (!row || row.value === null || row.value === undefined) return null;
                            const v = row.value as number;
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
                  {METRICS.map((m) => {
                    if (!active.has(m.key)) return null;
                    return (
                      <Line
                        key={m.key}
                        type="monotone"
                        dataKey={m.key}
                        name={m.label}
                        yAxisId={m.axis}
                        stroke={m.color}
                        strokeWidth={2}
                        strokeDasharray={m.isCurrency ? "4 4" : undefined}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
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
