"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/**
 * Growth Run Rate — single merged chart combining the old Funnel Chart
 * and Efficiency Chart. Twelve toggleable metrics in a single reading,
 * dual axis (counts on the left, dollars on the right).
 *
 * Data sources:
 *   /api/hubspot/timeseries  — totalSignups, signups (qualified),
 *                              airbnbConnects, trials, customers,
 *                              metaSpend, googleSpend
 *   /api/rtl-run-rate         — rtl (property_ready_to_launch per day)
 *
 * The two series are aligned by ET date. timeseries spans more history
 * (back to the first configured signup month); rtl-run-rate covers the
 * last 90 days only — pre-90-day days have rtl = 0, so the three
 * RTL-derived metrics (RTLs, Cost / RTL, RTL → Trial %) read as flat
 * at the leading edge until rtl-run-rate's window starts.
 *
 * Cost-per metrics are derived PER BUCKET from (metaSpend + googleSpend)
 * divided by that bucket's volume (rtl / trials / customers). Doing the
 * division per bucket after summing avoids the misleading average that
 * dividing daily cost-per values would produce.
 */

type Granularity = "day" | "week" | "month";

type MetricKey =
  | "trials"
  | "customers"
  | "costPerTrial"
  | "costPerCustomer"
  | "rtl"
  | "costPerRtl"
  | "rtlToTrial"
  | "metaSpend"
  | "googleSpend"
  | "totalSignups"
  | "signups"
  | "airbnbConnects";

const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  axis: "count" | "money";
  isPercent?: boolean;
  isCurrency?: boolean;
  description: string;
}[] = [
  { key: "trials",          label: "Trialists",         color: "#FFFFFF", axis: "count",                   description: "Contacts whose trial-entry date falls in the bucket" },
  { key: "customers",       label: "Customers",         color: "#10B981", axis: "count",                   description: "Contacts who became real paid customers in the bucket" },
  { key: "costPerTrial",    label: "Cost / Trialist",   color: "#FB923C", axis: "money", isCurrency: true, description: "(Meta + Google spend) / Trialists for the bucket" },
  { key: "costPerCustomer", label: "Cost / Customer",   color: "#2DD4BF", axis: "money", isCurrency: true, description: "(Meta + Google spend) / Customers for the bucket" },
  { key: "rtl",             label: "RTLs",              color: "#38BDF8", axis: "count",                   description: "Contacts flagged property_ready_to_launch on that day" },
  { key: "costPerRtl",      label: "Cost / RTL",        color: "#F87171", axis: "money", isCurrency: true, description: "(Meta + Google spend) / RTLs for the bucket" },
  { key: "rtlToTrial",      label: "RTL → Trial %",     color: "#60A5FA", axis: "count", isPercent: true,  description: "Trialists / RTLs for the bucket" },
  { key: "metaSpend",       label: "Meta budget",       color: "#F59E0B", axis: "money", isCurrency: true, description: "Meta account-level daily spend" },
  { key: "googleSpend",     label: "Google budget",     color: "#A78BFA", axis: "money", isCurrency: true, description: "Google Ads account-level daily spend" },
  { key: "totalSignups",    label: "Total Signups",     color: "#94A3B8", axis: "count",                   description: "All contacts by createdate (includes Airbnb DQ)" },
  { key: "signups",         label: "Qualified Signups", color: "#1E6FFF", axis: "count",                   description: "Signups with Airbnb DQ excluded" },
  { key: "airbnbConnects",  label: "Airbnb Connects",   color: "#93C5FD", axis: "count",                   description: "Contacts with Airbnb auth status COMPLETED/REVOKED" },
];

interface TimeseriesResponse {
  days: string[];
  totalSignups: number[];
  signups: number[];
  airbnbConnects: number[];
  trials: number[];
  customers: number[];
  metaSpend?: number[];
  googleSpend?: number[];
}

interface RtlResponse {
  days: string[];
  rtl: number[];
}

/** Merged per-day row, aligned by ET date. */
type DailyRow = {
  day: string;
  totalSignups: number;
  signups: number;
  airbnbConnects: number;
  trials: number;
  customers: number;
  rtl: number;
  metaSpend: number;
  googleSpend: number;
};

/** Collapse two API responses into one aligned daily array, using
 *  timeseries' days as the master index. */
function merge(ts: TimeseriesResponse, rtl: RtlResponse | null): DailyRow[] {
  const rtlByDay = new Map<string, number>();
  if (rtl) {
    for (let i = 0; i < rtl.days.length; i++) rtlByDay.set(rtl.days[i], rtl.rtl[i] || 0);
  }
  return ts.days.map((d, i) => ({
    day: d,
    totalSignups:   ts.totalSignups[i]   || 0,
    signups:        ts.signups[i]        || 0,
    airbnbConnects: ts.airbnbConnects[i] || 0,
    trials:         ts.trials[i]         || 0,
    customers:      ts.customers[i]      || 0,
    rtl:            rtlByDay.get(d)      || 0,
    metaSpend:      ts.metaSpend?.[i]    || 0,
    googleSpend:    ts.googleSpend?.[i]  || 0,
  }));
}

/** Add n days to a YYYY-MM-DD key — pure string math, DST-safe. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Week-start (Monday) key for a given YYYY-MM-DD. */
function mondayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // step back to Mon
  return addDays(key, -back);
}

/** Days in a YYYY-MM calendar month. */
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

type Bucket = {
  key: string;        // bucket x-axis key
  endKey: string;     // last calendar day of the bucket (for the partial check)
  isPartial: boolean; // true if the bucket is incomplete (leading or trailing)
  totalSignups: number;
  signups: number;
  airbnbConnects: number;
  trials: number;
  customers: number;
  rtl: number;
  metaSpend: number;
  googleSpend: number;
};

/** Bucket per granularity. Day returns one bucket per day (never partial);
 *  Week sums Monday-Sunday ET; Month sums calendar month ET. Partial
 *  marks the leading and trailing buckets that don't cover a full
 *  period. */
function bucketize(rows: DailyRow[], g: Granularity): Bucket[] {
  if (rows.length === 0) return [];
  if (g === "day") {
    return rows.map((r) => ({
      key: r.day, endKey: r.day, isPartial: false,
      totalSignups: r.totalSignups, signups: r.signups, airbnbConnects: r.airbnbConnects,
      trials: r.trials, customers: r.customers, rtl: r.rtl,
      metaSpend: r.metaSpend, googleSpend: r.googleSpend,
    }));
  }
  const map = new Map<string, Bucket & { daysSeen: Set<string> }>();
  const order: string[] = [];
  for (const r of rows) {
    const bucketKey = g === "week" ? mondayKey(r.day) : r.day.slice(0, 7) + "-01";
    const endKey    = g === "week" ? addDays(bucketKey, 6) : bucketKey.slice(0, 7) + "-" + String(daysInMonth(bucketKey.slice(0, 7))).padStart(2, "0");
    let b = map.get(bucketKey);
    if (!b) {
      b = {
        key: bucketKey, endKey, isPartial: false,
        totalSignups: 0, signups: 0, airbnbConnects: 0,
        trials: 0, customers: 0, rtl: 0,
        metaSpend: 0, googleSpend: 0,
        daysSeen: new Set<string>(),
      };
      map.set(bucketKey, b);
      order.push(bucketKey);
    }
    b.daysSeen.add(r.day);
    b.totalSignups   += r.totalSignups;
    b.signups        += r.signups;
    b.airbnbConnects += r.airbnbConnects;
    b.trials         += r.trials;
    b.customers      += r.customers;
    b.rtl            += r.rtl;
    b.metaSpend      += r.metaSpend;
    b.googleSpend    += r.googleSpend;
  }
  return order.map((k) => {
    const b = map.get(k)!;
    const expected = g === "week" ? 7 : daysInMonth(k.slice(0, 7));
    const { daysSeen, ...clean } = b;
    return { ...clean, isPartial: daysSeen.size < expected };
  });
}

/** Short label for an x-axis tick. */
function fmtTick(key: string, g: Granularity): string {
  const [y, m, d] = key.split("-").map(Number);
  const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (g === "month") return `${months[m]} '${String(y).slice(2)}`;
  return `${months[m]} ${d}`;
}

/** Long date for the tooltip header; adds the day-of-week on daily and
 *  the week-end span on weekly. */
function fmtTooltipDate(key: string, g: Granularity, endKey?: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (g === "month") return `${months[m]} ${y}`;
  if (g === "week" && endKey) {
    const [, em, ed] = endKey.split("-").map(Number);
    return `${months[m]} ${d} – ${months[em]} ${ed}`;
  }
  const dow = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${months[m]} ${d}, ${y} (${dow})`;
}

export default function GrowthRunRateChart({ onReady }: { onReady?: () => void } = {}) {
  const [ts, setTs] = useState<TimeseriesResponse | null>(null);
  const [rtl, setRtl] = useState<RtlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("week");
  // Default toggle set: the four efficiency-vs-volume metrics the
  // Growth team opens with. Everything else is one click away.
  const [active, setActive] = useState<Set<MetricKey>>(
    new Set<MetricKey>(["trials", "customers", "costPerTrial", "costPerCustomer"]),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Both endpoints hit the same cached fetchAllContacts underneath,
    // so parallel fetching is cheap once the Blob cache is warm.
    Promise.all([
      fetch("/api/hubspot/timeseries").then((r) => r.ok ? r.json() : Promise.reject(new Error(`timeseries HTTP ${r.status}`))),
      fetch("/api/rtl-run-rate").then((r) => r.ok ? r.json() : Promise.reject(new Error(`rtl-run-rate HTTP ${r.status}`))),
    ])
      .then(([t, r]) => {
        if (cancelled) return;
        setTs(t as TimeseriesResponse);
        setRtl(r as RtlResponse);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onReady?.();
      });
    return () => { cancelled = true; };
  }, [onReady]);

  const rows = useMemo(() => {
    if (!ts) return [];
    const daily = merge(ts, rtl);
    const buckets = bucketize(daily, granularity);
    const N = buckets.length;

    // Derived metrics per bucket. Division happens after summing so a
    // week's $/trialist reads from (sum of weekly spend) / (sum of
    // weekly trials), not an average of noisy daily ratios.
    type Row = Bucket & {
      costPerRtl: number | null;
      costPerTrial: number | null;
      costPerCustomer: number | null;
      rtlToTrial: number | null;
    };
    const base: Row[] = buckets.map((b) => {
      const spend = b.metaSpend + b.googleSpend;
      return {
        ...b,
        costPerRtl:      b.rtl       > 0 ? spend / b.rtl       : null,
        costPerTrial:    b.trials    > 0 ? spend / b.trials    : null,
        costPerCustomer: b.customers > 0 ? spend / b.customers : null,
        rtlToTrial:      b.rtl       > 0 ? (b.trials / b.rtl) * 100 : null,
      };
    });

    // Partial periods render dotted. Boundary points duplicate into
    // the dashed series so adjacent segments visually connect across
    // the solid-to-dashed transition instead of leaving a gap.
    const partial = base.map((r) => r.isPartial);
    function split(values: (number | null)[]) {
      const solid: (number | null)[] = new Array(N).fill(null);
      const dashed: (number | null)[] = new Array(N).fill(null);
      for (let i = 0; i < N; i++) (partial[i] ? dashed : solid)[i] = values[i];
      for (let i = 1; i < N; i++) {
        if (partial[i] && !partial[i - 1]) dashed[i - 1] = values[i - 1];
        else if (!partial[i] && partial[i - 1]) solid[i - 1] = values[i - 1];
      }
      return { solid, dashed };
    }
    const SPLIT_KEYS: MetricKey[] = [
      "trials","customers","rtl","totalSignups","signups","airbnbConnects",
      "costPerTrial","costPerCustomer","costPerRtl","rtlToTrial",
      "metaSpend","googleSpend",
    ];
    const splits: Record<string, { solid: (number | null)[]; dashed: (number | null)[] }> = {};
    for (const k of SPLIT_KEYS) splits[k] = split(base.map((r) => (r as Record<string, number | null | boolean | string>)[k] as number | null));

    return base.map((r, i) => {
      const row: Record<string, number | string | boolean | null> = { ...r };
      for (const k of SPLIT_KEYS) {
        row[`${k}_solid`] = splits[k].solid[i];
        row[`${k}_dashed`] = splits[k].dashed[i];
      }
      return row;
    });
  }, [ts, rtl, granularity]);

  // Chip totals — summed over the full window; cost-per values use
  // the window-wide (spend / volume) ratio, matching per-bucket math.
  const totals = useMemo(() => {
    if (!ts) return null;
    const daily = merge(ts, rtl);
    const sum = (f: (r: DailyRow) => number) => daily.reduce((s, r) => s + f(r), 0);
    const T = {
      totalSignups:   sum((r) => r.totalSignups),
      signups:        sum((r) => r.signups),
      airbnbConnects: sum((r) => r.airbnbConnects),
      trials:         sum((r) => r.trials),
      customers:      sum((r) => r.customers),
      rtl:            sum((r) => r.rtl),
      metaSpend:      sum((r) => r.metaSpend),
      googleSpend:    sum((r) => r.googleSpend),
    };
    const spend = T.metaSpend + T.googleSpend;
    return {
      ...T,
      costPerTrial:    T.trials    > 0 ? spend / T.trials    : null,
      costPerCustomer: T.customers > 0 ? spend / T.customers : null,
      costPerRtl:      T.rtl       > 0 ? spend / T.rtl       : null,
      rtlToTrial:      T.rtl       > 0 ? (T.trials / T.rtl) * 100 : null,
    };
  }, [ts, rtl]);

  function toggle(key: MetricKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const hasMoney = METRICS.some((m) => m.axis === "money" && active.has(m.key));
  const hasCount = METRICS.some((m) => m.axis === "count" && active.has(m.key));

  function fmtTotal(key: MetricKey, raw: number | null | undefined): string {
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return "—";
    const meta = METRICS.find((m) => m.key === key)!;
    if (meta.isPercent)  return `${raw.toFixed(1)}%`;
    if (meta.isCurrency) return `$${Math.round(raw).toLocaleString()}`;
    return Math.round(raw).toLocaleString();
  }

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-5 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[22px] font-semibold text-white tracking-tight">
          <span>Growth Run Rate</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[13px] font-semibold px-3 py-1">
            {ts ? `${ts.days[0]} → ${ts.days[ts.days.length - 1]}` : "—"}
          </Badge>
        </CardTitle>
        <p className="text-[14px] text-[#C9D1DC] mt-3 leading-relaxed">
          <span className="text-[#60A5FA] font-semibold">Period-based.</span>{" "}
          Twelve metrics across funnel volume and ad-efficiency, one chart. Toggle any
          combination with the chips below; counts render on the left axis, dollars on the right.
          Cost / Trialist, Cost / Customer and Cost / RTL are computed per bucket as
          (Meta + Google spend) ÷ volume. The current partial period renders dotted.
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        {loading && !ts && <p className="text-[14px] text-[#C9D1DC] py-16 text-center">Loading growth run rate…</p>}
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-4 text-[#C9D1DC] text-[14px]">
            <p className="font-semibold text-white text-[15px]">Failed to load</p>
            <p className="text-[13px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {ts && totals && (
          <>
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
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isOn ? m.color : "#1F2937" }} />
                    <span>{m.label}</span>
                    <span className="text-[11px] tabular-nums opacity-60">
                      {fmtTotal(m.key, totals[m.key] as number | null | undefined)}
                    </span>
                  </button>
                );
              })}
              <div className="ml-auto inline-flex h-10 rounded-full bg-[#0E1422] border border-[#1F2937] p-1">
                {(["day", "week", "month"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-4 rounded-full text-[13px] font-semibold transition-colors cursor-pointer ${
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
                    dataKey="key"
                    tick={{ fill: "#C9D1DC", fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: "#1F2937" }}
                    tickFormatter={(v: string) => fmtTick(v, granularity)}
                    minTickGap={granularity === "day" ? 60 : granularity === "week" ? 40 : 24}
                  />
                  {hasCount && (
                    <YAxis
                      yAxisId="count"
                      tick={{ fill: "#C9D1DC", fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: "#1F2937" }}
                      allowDecimals={false}
                    />
                  )}
                  {hasMoney && (
                    <YAxis
                      yAxisId="money"
                      orientation="right"
                      tick={{ fill: "#C9D1DC", fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: "#1F2937" }}
                      tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`)}
                    />
                  )}
                  <Tooltip
                    cursor={{ stroke: "#60A5FA", strokeWidth: 1.5 }}
                    position={{ x: 40, y: 40 }}
                    wrapperStyle={{ opacity: 0.95, pointerEvents: "none" }}
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean; label?: string | number;
                        payload?: ReadonlyArray<{ payload?: Record<string, number | null | string | boolean> }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;
                      const raw = payload[0]?.payload ?? {};
                      const endKey = typeof raw.endKey === "string" ? raw.endKey : undefined;
                      const isPartial = raw.isPartial === true;
                      const header = typeof label === "string" || typeof label === "number"
                        ? fmtTooltipDate(String(label), granularity, endKey)
                        : "";
                      return (
                        <div className="bg-[#0E1422] border border-[#1F2937] rounded-xl p-4 text-[14px] min-w-[260px] shadow-xl">
                          <div className="text-[#C9D1DC] mb-3 text-[14px] font-semibold">
                            {header}
                            {isPartial && <span className="ml-2 text-[#F59E0B]">· partial</span>}
                          </div>
                          {METRICS.filter((m) => active.has(m.key)).map((m) => {
                            const v = raw[m.key];
                            if (v === null || v === undefined) return null;
                            const num = typeof v === "number" ? v : parseFloat(String(v));
                            if (!Number.isFinite(num)) return null;
                            const display = m.isPercent
                              ? `${num.toFixed(1)}%`
                              : m.isCurrency
                                ? `$${Math.round(num).toLocaleString()}`
                                : Math.round(num).toLocaleString();
                            return (
                              <div key={m.key} className="flex items-center justify-between gap-4 py-0.5">
                                <span className="flex items-center gap-2 min-w-0">
                                  <span className="h-2.5 w-2.5 rounded-full flex-none" style={{ backgroundColor: m.color }} />
                                  <span className="text-white">{m.label}</span>
                                </span>
                                <span className="font-mono tabular-nums text-white text-[15px] font-semibold">{display}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  {METRICS.filter((m) => active.has(m.key)).map((m) => {
                    const solidDash = m.isCurrency ? "6 4" : undefined;
                    return (
                      <React.Fragment key={m.key}>
                        <Line
                          type="monotone"
                          dataKey={`${m.key}_solid`}
                          name={m.label}
                          yAxisId={m.axis}
                          stroke={m.color}
                          strokeWidth={2.5}
                          strokeDasharray={solidDash}
                          dot={false}
                          activeDot={{ r: 4 }}
                          isAnimationActive={false}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey={`${m.key}_dashed`}
                          name={`${m.label}__dashed`}
                          yAxisId={m.axis}
                          stroke={m.color}
                          strokeWidth={2.5}
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
