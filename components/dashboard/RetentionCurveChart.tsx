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
  failedTrialists: {
    days: number;
    total: number;
    bySegment: Record<string, number>;
  };
  planSwitchers: {
    total: number;
    bySegment: Record<string, number>;
  };
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
  // Which segments are currently visible on the chart. Click a segment
  // chip to toggle. Default: all on. Stored as a Set for O(1) lookup
  // during render; we coerce to/from arrays at the React boundaries.
  // Initialized from the data once it arrives (the segment names come
  // from the API response, not hardcoded).
  const [active, setActive] = useState<Set<string> | null>(null);

  useEffect(() => {
    // Initialise the visibility set the first time data arrives — all
    // segments visible. Subsequent data refreshes don't reset visibility
    // (so a refresh-on-filter-change doesn't blow away the user's selection).
    if (data && active === null) {
      setActive(new Set(data.segments.map((s) => s.segment)));
    }
  }, [data, active]);

  function toggleSegment(name: string) {
    setActive((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(name)) {
        // Block deselecting the LAST visible segment — empty chart is
        // useless and the user has to triple-click to recover. Better
        // to just no-op the last toggle.
        if (next.size <= 1) return next;
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

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
            referrals. Customers who exited within{" "}
            <span className="text-white">{data?.failedTrialists.days ?? 4} days</span>{" "}
            of entry are reclassified as failed trialists, removed from every curve,
            and reported as a separate count above. The plotted x-axis stops at the
            longest milestone where the segment still has ≥ 10 customers with that
            much tenure — beyond that the line would be statistical noise.
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
            {/* Two callouts above the segment chips: count of failed
                trialists (customers excluded from the curves because
                they exited within the 4-day cutoff) and count of plan
                switchers (cohort customers whose cb_product history
                has ≥2 distinct values). Both are surfaced because
                they materially affect how the curves are read. */}
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-[#11182B] border border-[#1F2937] rounded-xl">
                <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-[#5B6478]" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-white">
                    Failed trialists (≤{data.failedTrialists.days}d, excluded)
                    {" "}
                    <span className="text-white font-bold ml-1">{data.failedTrialists.total}</span>
                  </span>
                  <span className="text-[11px] text-[#8B92A3] tabular-nums">
                    {Object.entries(data.failedTrialists.bySegment)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${k.replace("Amplify ", "A·").replace("Flex ", "F·")} ${n}`)
                      .join(" · ") || "none in any segment"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5 bg-[#11182B] border border-[#1F2937] rounded-xl">
                <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-[#60A5FA]" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-white">
                    Plan switchers in cohort
                    {" "}
                    <span className="text-white font-bold ml-1">{data.planSwitchers.total}</span>
                  </span>
                  <span className="text-[11px] text-[#8B92A3] tabular-nums">
                    {Object.entries(data.planSwitchers.bySegment)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${k.replace("Amplify ", "A·").replace("Flex ", "F·")} ${n}`)
                      .join(" · ") || "no switches"}
                    {" "}
                    <span className="text-[#5B6478]">— ≥2 distinct cb_product values</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Segment toggle chips — same pattern + styling as the
                Run Rate chart's metric chips so clickability reads at
                a glance. Click to hide that segment's line; click
                again to bring it back. Last-visible chip is sticky
                (toggleSegment no-ops on size<=1) so the chart never
                empties. Cohort size + Wk1→final summary are inlined
                as a single muted suffix on each chip. */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="text-[11px] uppercase tracking-wider text-[#5B6478] font-semibold mr-1">Toggle:</span>
              {data.segments.map((s) => {
                const last = s.points[s.points.length - 1];
                const wk1 = s.points.find((p) => p.day === 7);
                const isOn = active?.has(s.segment) ?? true;
                const color = SEGMENT_COLORS[s.segment] || "#FFF";
                const summary = wk1 && last
                  ? `n=${s.totalCohort} · ${wk1.retentionPct.toFixed(0)}%→${last.retentionPct.toFixed(0)}%`
                  : `n=${s.totalCohort}`;
                return (
                  <button
                    key={s.segment}
                    type="button"
                    onClick={() => toggleSegment(s.segment)}
                    aria-pressed={isOn}
                    title={isOn ? `Click to hide ${s.segment}` : `Click to show ${s.segment}`}
                    className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12px] font-medium transition-all cursor-pointer ${
                      isOn
                        ? "bg-[#1A2235] border-[#1F2937] text-white"
                        : "bg-[#11182B] border-[#1F2937] text-[#5B6478] hover:text-[#C9D1DC]"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: isOn ? color : "#1F2937" }}
                    />
                    <span>{s.segment}</span>
                    <span className="text-[11px] tabular-nums opacity-60">{summary}</span>
                  </button>
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
                  {data.segments
                    // Visible segments only — clicking a chip above
                    // toggles inclusion here. Y-axis stays pinned at
                    // 0–100% so the curve doesn't rescale awkwardly
                    // when one segment is hidden.
                    .filter((s) => active === null || active.has(s.segment))
                    .map((s) => (
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
