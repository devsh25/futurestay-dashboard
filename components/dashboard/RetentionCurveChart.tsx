"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

type RetentionPoint = {
  day: number;
  label: string;
  retentionPct: number;
  cohortSize: number;
};
type RetentionSegment = {
  segment: string;
  totalCohort: number;
  points: RetentionPoint[];
};
type RetentionData = {
  asOf: string;
  segments: RetentionSegment[];
  milestones: { day: number; label: string }[];
};

// Per-segment colour: Amplify = primary blue, Flex = light blue.
// Stays inside the dashboard's blue-spectrum palette (no green/red).
const SEGMENT_COLORS: Record<string, string> = {
  Amplify: "#1E6FFF",
  Flex: "#60A5FA",
};

export default function RetentionCurveChart() {
  const [data, setData] = useState<RetentionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/customers/retention")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: RetentionData) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Recharts wants the data shape as one row per x-axis tick with the
  // segment values as columns. Flatten the per-segment points into
  // one row per milestone day.
  const chartRows = (() => {
    if (!data) return [];
    const allDays = Array.from(
      new Set(data.segments.flatMap((s) => s.points.map((p) => p.day)))
    ).sort((a, b) => a - b);
    return allDays.map((day) => {
      const row: Record<string, number | string> = { day, label: "" };
      for (const s of data.segments) {
        const p = s.points.find((x) => x.day === day);
        if (p) {
          row[s.segment] = p.retentionPct;
          row[`${s.segment}_n`] = p.cohortSize;
          row.label = p.label;
        }
      }
      return row;
    });
  })();

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Retention Curve — Paying Customers</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[11px] font-medium">
            As of {data?.asOf || "—"}
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Single-cohort survival.</span>{" "}
          For each plan family, the cohort is the same group of customers across
          every milestone — specifically, those with enough tenure to be observed
          at the longest plotted milestone. Retention at each point is the % of that
          fixed cohort still active. This guarantees a monotonically decreasing
          curve (you can never gain retained customers as time passes). Cancellation
          timestamps come from HubSpot&apos;s property history{" "}
          (<code className="text-[#C9D1DC]">account_lifecycle → former.customer</code>),
          since <code className="text-[#C9D1DC]">hs_v2_date_exited_customer</code> is empty in this account.
          The curve extends only as far as the data supports a cohort of ≥ 10
          customers — it lengthens automatically as more time passes.{" "}
          <span className="text-[#8B92A3] italic">
            Note: Annual vs Monthly billing-cycle data is too sparse to segment by;
            this view splits by plan family instead. Once cycle data is reliably
            populated, this can switch to Annual vs Monthly without a refactor.
          </span>
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-12 text-center">Computing retention curves…</p>
        )}
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-3 text-[#C9D1DC] text-[12px]">
            <p className="font-semibold text-white">Failed to load retention data</p>
            <p className="text-[11px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {data && (
          <>
            {/* Segment summary chips: shows total cohort + key drop-off */}
            <div className="flex flex-wrap gap-3 mb-5">
              {data.segments.map((s) => {
                const last = s.points[s.points.length - 1];
                const wk1 = s.points.find((p) => p.day === 7);
                return (
                  <div
                    key={s.segment}
                    className="flex items-center gap-3 px-4 py-2.5 bg-[#1A2235] border border-[#1F2937] rounded-xl"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: SEGMENT_COLORS[s.segment] || "#FFF" }}
                    />
                    <div className="flex flex-col">
                      <span className="text-[13px] font-semibold text-white">
                        {s.segment}{" "}
                        <span className="text-[#8B92A3] font-normal text-[12px]">
                          (n={s.totalCohort})
                        </span>
                      </span>
                      {wk1 && last && (
                        <span className="text-[11px] text-[#8B92A3] tabular-nums">
                          Wk1 {wk1.retentionPct.toFixed(0)}% → {last.label} {last.retentionPct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 12, right: 24, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#1F2937" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#8B92A3" }}
                    axisLine={{ stroke: "#1F2937" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11, fill: "#5B6478" }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    content={(props) => {
                      const { active, label, payload } = props as {
                        active?: boolean;
                        label?: string | number;
                        payload?: ReadonlyArray<{
                          name?: string | number;
                          value?: number | string;
                          color?: string;
                          payload?: Record<string, number | string>;
                        }>;
                      };
                      if (!active || !payload || payload.length === 0) return null;
                      return (
                        <div style={{
                          backgroundColor: "rgba(14, 20, 34, 0.95)",
                          backdropFilter: "blur(8px)",
                          borderRadius: 12,
                          border: "1px solid #1F2937",
                          fontSize: 12,
                          boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
                          padding: "10px 14px",
                          color: "#FFFFFF",
                          minWidth: 200,
                        }}>
                          <div style={{ color: "#8B92A3", fontSize: 11, marginBottom: 6 }}>
                            {String(label ?? "")}
                          </div>
                          {payload.map((p, i) => {
                            const name = String(p.name ?? "");
                            const v = typeof p.value === "number" ? p.value : parseFloat(String(p.value ?? 0));
                            const cohortN = p.payload?.[`${name}_n`];
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 0", color: "#C9D1DC" }}>
                                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: p.color || "#FFF", flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>{name}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", color: "#FFFFFF", fontWeight: 600 }}>
                                  {v.toFixed(1)}%
                                </span>
                                {cohortN !== undefined && (
                                  <span style={{ fontVariantNumeric: "tabular-nums", color: "#5B6478", fontSize: 10, marginLeft: 4 }}>
                                    n={cohortN}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    iconType="line"
                    iconSize={14}
                    wrapperStyle={{ paddingTop: 12, fontSize: 11 }}
                    formatter={(value) => <span className="text-[#C9D1DC]">{value}</span>}
                  />
                  {data.segments.map((s) => (
                    <Line
                      key={s.segment}
                      type="monotone"
                      dataKey={s.segment}
                      name={s.segment}
                      stroke={SEGMENT_COLORS[s.segment] || "#FFF"}
                      strokeWidth={2.5}
                      dot={{ r: 4, strokeWidth: 0, fill: SEGMENT_COLORS[s.segment] || "#FFF" }}
                      activeDot={{ r: 6, strokeWidth: 0, fill: SEGMENT_COLORS[s.segment] || "#FFF" }}
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
