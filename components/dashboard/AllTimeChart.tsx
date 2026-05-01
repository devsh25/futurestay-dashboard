"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";

type Series = {
  days: string[];
  signups: number[];
  airbnbConnects: number[];
  readyToLaunch: number[];
  trials: number[];
  customers: number[];
};

type MetricKey = "signups" | "airbnbConnects" | "readyToLaunch" | "trials" | "customers";

const METRICS: { key: MetricKey; label: string; color: string; description: string }[] = [
  { key: "signups",        label: "Qualified Signups",  color: "#1E6FFF", description: "createdate, Airbnb DQ excluded" },
  { key: "airbnbConnects", label: "Airbnb Connects",    color: "#60A5FA", description: "auth status COMPLETED/REVOKED" },
  { key: "readyToLaunch",  label: "Ready to Launch",    color: "#93C5FD", description: "property_ready_to_launch=true" },
  { key: "trials",         label: "Trialists",          color: "#FFFFFF", description: "by actual trial start date" },
  { key: "customers",      label: "Customers",          color: "#10B981", description: "by actual customer entry date" },
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

export default function AllTimeChart() {
  const [data, setData] = useState<Series | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<MetricKey>>(
    new Set(["signups", "airbnbConnects", "trials", "customers"])
  );
  const [smoothed, setSmoothed] = useState(true);

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
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Build chart-ready rows: one row per day, each metric as a column.
  const rows = useMemo(() => {
    if (!data) return [];
    const series: Record<MetricKey, number[]> = {
      signups: smoothed ? smooth(data.signups) : data.signups,
      airbnbConnects: smoothed ? smooth(data.airbnbConnects) : data.airbnbConnects,
      readyToLaunch: smoothed ? smooth(data.readyToLaunch) : data.readyToLaunch,
      trials: smoothed ? smooth(data.trials) : data.trials,
      customers: smoothed ? smooth(data.customers) : data.customers,
    };
    return data.days.map((day, i) => ({
      day,
      signups: series.signups[i],
      airbnbConnects: series.airbnbConnects[i],
      readyToLaunch: series.readyToLaunch[i],
      trials: series.trials[i],
      customers: series.customers[i],
    }));
  }, [data, smoothed]);

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
          <span className="text-[#1E6FFF] font-medium">Period-based, daily.</span>{" "}
          Daily counts of each milestone since the earliest signup. Signups / Airbnb Connects / Ready to Launch use{" "}
          <code className="text-[#C9D1DC]">createdate</code> (same-day proxy); Trialists use{" "}
          <code className="text-[#C9D1DC]">trial__start_date</code>; Customers use{" "}
          <code className="text-[#C9D1DC]">hs_v2_date_entered_customer</code>. Toggle metrics with the chips below.
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
                      {totals[m.key].toLocaleString()}
                    </span>
                  </button>
                );
              })}

              <span className="ml-auto text-[12px] text-[#8B92A3] flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={smoothed}
                  onChange={(e) => setSmoothed(e.target.checked)}
                  className="accent-[#1E6FFF]"
                  id="smoothed"
                />
                <label htmlFor="smoothed" className="cursor-pointer">7-day smooth</label>
              </span>
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
                    minTickGap={60}
                    tickFormatter={(v: string) => {
                      // "2026-04-12" → "Apr 12"
                      const [, m, d] = v.split("-");
                      const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                      return `${months[parseInt(m)]} ${parseInt(d)}`;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#5B6478" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    // Round y-axis ticks to integers — fractional people
                    // don't make sense even when the underlying line is a
                    // 7-day moving average.
                    tickFormatter={(v: number) => Math.round(v).toLocaleString()}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    // Custom content so we can render colour dots before
                    // each metric name AND show step-to-step conversion %
                    // between adjacent visible metrics (e.g. Trials/QS).
                    content={(props) => {
                      const { active, label, payload } = props as {
                        active?: boolean;
                        label?: string | number;
                        payload?: ReadonlyArray<{ name?: string | number; value?: number | string; color?: string }>;
                      };
                      if (!active || !payload || payload.length === 0) return null;

                      // Index payload by key for lookup
                      const byKey: Record<string, { name: string; value: number; color: string }> = {};
                      for (const p of payload) {
                        const k = typeof p.name === "string" ? p.name : String(p.name ?? "");
                        if (k) {
                          byKey[k] = {
                            name: k,
                            value: typeof p.value === "number" ? p.value : parseFloat(String(p.value ?? 0)),
                            color: p.color || "#FFFFFF",
                          };
                        }
                      }

                      // Render rows in METRICS order so the funnel reads
                      // top-to-bottom (signups → connects → ready → trials → customers)
                      const visible = METRICS.filter((m) => byKey[m.key]);

                      // Format the date label nicely
                      const labelStr = typeof label === "string" ? label : String(label ?? "");
                      let dateStr: string = labelStr;
                      if (labelStr && /^\d{4}-\d{2}-\d{2}/.test(labelStr)) {
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
                                  {Math.round(row.value).toLocaleString()}
                                </span>
                              </div>
                            );
                          })}

                          {/* Step-to-step conversion rates between adjacent
                              visible metrics in funnel order. Lets the
                              reader see "Trials/QS = 16%" without doing
                              the arithmetic in their head. */}
                          {visible.length >= 2 && (
                            <div
                              style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: "1px solid #1F2937",
                                color: "#8B92A3",
                                fontSize: 11,
                              }}
                            >
                              {visible.slice(0, -1).map((m, i) => {
                                const next = visible[i + 1];
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
                          )}
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
                  {METRICS.filter((m) => active.has(m.key)).map((m) => (
                    <Line
                      key={m.key}
                      type="monotone"
                      dataKey={m.key}
                      stroke={m.color}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0, fill: m.color }}
                      isAnimationActive={false}
                    />
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
