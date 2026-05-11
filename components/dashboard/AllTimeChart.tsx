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

type Granularity = "day" | "week";

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
  const buckets = new Map<string, { weekStart: string; weekEnd: string; signups: number; airbnbConnects: number; readyToLaunch: number; trials: number; customers: number; daysSeen: number; lastDay: string }>();

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
        daysSeen: 0, lastDay: day,
      });
    }
    const b = buckets.get(weekKey)!;
    b.signups += data.signups[i];
    b.airbnbConnects += data.airbnbConnects[i];
    b.readyToLaunch += data.readyToLaunch[i];
    b.trials += data.trials[i];
    b.customers += data.customers[i];
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
    partial: sorted.map((b) => b.daysSeen < 7),
  };
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
    new Set(["signups", "airbnbConnects", "trials", "customers"])
  );
  const [smoothed, setSmoothed] = useState(true);
  const [granularity, setGranularity] = useState<Granularity>("day");

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
  //   day:  one row per ET calendar day; values are the raw daily
  //         counts (optionally 7-day smoothed for visual readability)
  //   week: one row per Monday-Sunday ET week; values are the SUM of
  //         that week's daily counts (smoothing N/A — aggregation is
  //         already smoothing weekend dips into a single bar)
  const rows = useMemo(() => {
    if (!data) return [];
    if (granularity === "week") {
      const w = bucketByWeek(data);
      const N = w.weekStart.length;

      // Split each metric's values into two parallel arrays per row:
      //   metric_solid   = value on full weeks, null on partial weeks
      //   metric_dashed  = value on partial weeks, null on full weeks
      // Plus at every solid↔dashed transition, the boundary index gets
      // its value copied into the other array so the line actually
      // *connects* through the transition instead of leaving a gap.
      const partial = w.partial;
      function split(values: number[]) {
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

      const split_signups        = split(w.signups);
      const split_airbnbConnects = split(w.airbnbConnects);
      const split_readyToLaunch  = split(w.readyToLaunch);
      const split_trials         = split(w.trials);
      const split_customers      = split(w.customers);

      return w.weekStart.map((ws, i) => ({
        day: ws,                  // x-axis key, named `day` for continuity with daily mode
        weekEnd: w.weekEnd[i],
        partial: w.partial[i],
        // Raw values — used by the tooltip (read directly from row.payload)
        signups: w.signups[i],
        airbnbConnects: w.airbnbConnects[i],
        readyToLaunch: w.readyToLaunch[i],
        trials: w.trials[i],
        customers: w.customers[i],
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
    // Daily mode (existing behaviour)
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
  }, [data, smoothed, granularity]);

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
          <span className="text-[#1E6FFF] font-medium">Period-based.</span>{" "}
          {granularity === "week" ? "Weekly" : "Daily"} counts of each milestone since the
          earliest signup, bucketed by Monday-Sunday ET week ({granularity === "week" ? "sum per week" : "one point per day"}). Signups / Airbnb Connects / Ready to Launch use{" "}
          <code className="text-[#C9D1DC]">createdate</code> (same-day proxy); Trialists use{" "}
          <code className="text-[#C9D1DC]">trial__start_date</code>; Customers use{" "}
          <code className="text-[#C9D1DC]">hs_v2_date_entered_customer</code>. Toggle metrics
          with the chips below; switch Daily/Weekly with the toggle on the right.
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

              <div className="ml-auto flex items-center gap-3">
                {/* Granularity toggle — Daily / Weekly. Weekly sums
                    Monday-Sunday ET values into one point per week,
                    which is the natural reporting cadence for most
                    growth questions. Daily stays for spotting day-of-
                    week patterns. */}
                <div className="inline-flex rounded-full border border-[#1F2937] bg-[#0E1422] p-0.5 text-[11px] font-semibold">
                  {(["day", "week"] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`px-3 py-1 rounded-full transition-colors ${
                        granularity === g
                          ? "bg-[#1E6FFF] text-white"
                          : "text-[#8B92A3] hover:text-white"
                      }`}
                    >
                      {g === "day" ? "Daily" : "Weekly"}
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
                    minTickGap={granularity === "week" ? 40 : 60}
                    tickFormatter={(v: string) => shortDate(v)}
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
                      // - Daily: "Apr 12, 2026"
                      // - Weekly: "Apr 28 – May 4 (partial)" — pulled
                      //   from the row's weekEnd + partial fields if
                      //   present (only set in weekly aggregation).
                      const labelStr = typeof label === "string" ? label : String(label ?? "");
                      const firstPayload = payload[0] as unknown as { payload?: { weekEnd?: string; partial?: boolean } } | undefined;
                      const weekEnd = firstPayload?.payload?.weekEnd;
                      const partial = firstPayload?.payload?.partial;
                      let dateStr: string = labelStr;
                      if (granularity === "week" && weekEnd) {
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
                  {/* In daily mode: one solid Line per metric.
                      In weekly mode: TWO lines per metric — the solid
                      one covers full Mon-Sun weeks; the dashed one
                      covers the leading-edge / trailing-edge partial
                      week so the reader doesn't misread a half-week
                      dip as a real drop. Both pull from null-padded
                      arrays built in `rows`, so they only render where
                      they should. */}
                  {METRICS.filter((m) => active.has(m.key)).flatMap((m) => {
                    if (granularity === "week") {
                      return [
                        <Line
                          key={m.key + "_solid"}
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
