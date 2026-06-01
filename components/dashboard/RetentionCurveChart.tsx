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

// Four segments: {Amplify, Flex} × {Yearly, Monthly}.
// Visual encoding inside the blue palette:
//   – Family = colour (Amplify = primary blue, Flex = light blue)
//   – Cycle  = stroke style (Yearly = solid, Monthly = dashed)
// This stays readable on dark bg and reinforces the hierarchy at a
// glance: solid lines = annual commitments (higher LTV).
const SEGMENT_COLORS: Record<string, string> = {
  "Amplify Yearly":  "#1E6FFF",
  "Amplify Monthly": "#1E6FFF",
  "Flex Yearly":     "#60A5FA",
  "Flex Monthly":    "#60A5FA",
};
const SEGMENT_DASH: Record<string, string | undefined> = {
  "Amplify Yearly":  undefined,
  "Amplify Monthly": "6 4",
  "Flex Yearly":     undefined,
  "Flex Monthly":    "6 4",
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
        {/* Retention methodology — exact math written out so anyone reading
            the chart can audit the numbers without leaving the page. */}
        <div className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed space-y-2.5">
          <p>
            <span className="text-[#1E6FFF] font-medium">Four segments:</span>{" "}
            <span className="text-white">{`{Amplify, Flex} × {Yearly, Monthly}`}</span>.
            Family + cycle come from Chargebee&apos;s{" "}
            <code className="text-[#C9D1DC]">cb_product</code> plan code
            (e.g. <code className="text-[#C9D1DC]">Futurestay-Amplify-USD-Yearly</code>).
            Limited-Access SKUs fold back into their original plan family via{" "}
            <code className="text-[#C9D1DC]">limited_access_previous_plan</code>.
            Contacts without a <code className="text-[#C9D1DC]">cb_product</code> cycle
            marker are dropped from this chart (no guessing).
          </p>
          <p>
            <span className="text-[#1E6FFF] font-medium">Cohort definition (same for all 4 segments):</span>{" "}
            paying customers (lifecycle ∈ <code className="text-[#C9D1DC]">customer / former.customer / Customer&#47;Limited Access</code>)
            who entered customer status on or after{" "}
            <span className="text-white">March 1, 2026</span>, excluding WIX/HOPPER partner
            referrals. The plotted x-axis stops at the longest milestone where the
            segment still has ≥ 10 customers with that much tenure — beyond that the
            line would be statistical noise.
          </p>
          <p>
            <span className="text-[#1E6FFF] font-medium">Survival math (single-cohort, monotonic):</span>{" "}
            For each segment, the anchor cohort = customers with tenure ≥ the segment&apos;s
            horizon milestone. At every plotted milestone <code className="text-[#C9D1DC]">W</code>:{" "}
            <span className="text-white">retention(W) = (customers in anchor cohort who had NOT
            cancelled before day W) ÷ (anchor cohort size)</span>. The denominator is fixed,
            so the curve is guaranteed to decrease — you can never gain retained
            customers as time passes. Entry &amp; cancellation timestamps come from
            HubSpot&apos;s <code className="text-[#C9D1DC]">account_lifecycle</code> property
            history (<code className="text-[#C9D1DC]">hs_v2_date_exited_customer</code> is empty
            in this account, so history is the only reliable source).
          </p>
          <p className="text-[12px] text-[#5B6478]">
            Visual key: <span className="text-[#1E6FFF]">━</span>{" "}
            Amplify Yearly &nbsp;·&nbsp;{" "}
            <span className="text-[#1E6FFF]">┄ ┄</span> Amplify Monthly &nbsp;·&nbsp;{" "}
            <span className="text-[#60A5FA]">━</span> Flex Yearly &nbsp;·&nbsp;{" "}
            <span className="text-[#60A5FA]">┄ ┄</span> Flex Monthly.
          </p>
        </div>
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
                      strokeDasharray={SEGMENT_DASH[s.segment]}
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
