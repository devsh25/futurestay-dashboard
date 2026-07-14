"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// Categorical palette — assigned in fixed order to top-7 assets so a
// given asset always renders the same colour regardless of visibility.
// Ordered by hue distance so adjacent lines contrast, and validated for
// separation against the dashboard's near-black surface.
const PALETTE = [
  "#1E6FFF", "#A78BFA", "#10B981", "#F59E0B",
  "#60A5FA", "#F87171", "#EAB308",
];

type Granularity = "day" | "week" | "month";

interface AssetSeries {
  key: string;
  channel: "Meta" | "Google";
  campaign: string;
  dailyRtl: number[];
  dailyTrials: number[];
  totalRtl: number;
  totalTrials: number;
}
interface ApiResponse {
  days: string[];
  assets: AssetSeries[];
}

// Aggregate daily counts into a bigger bucket. Returns two aligned
// arrays (rtl, trials) same length as the bucket labels. Uses ISO
// week-start (Monday) for weekly, first-of-month for monthly.
function aggregate(days: string[], rtl: number[], trials: number[], granularity: Granularity): { labels: string[]; keys: string[]; rtl: number[]; trials: number[] } {
  if (granularity === "day") {
    return { labels: days, keys: days, rtl, trials };
  }
  const bucketKey = (d: string) => {
    if (granularity === "month") return d.slice(0, 7) + "-01";
    // Weekly: snap to the Monday of the week containing this date.
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    const dow = dt.getUTCDay();
    const back = dow === 0 ? 6 : dow - 1;
    const mon = new Date(dt.getTime() - back * 86_400_000);
    const yy = mon.getUTCFullYear();
    const mm = String(mon.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(mon.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  const seen: Record<string, { rtl: number; trials: number }> = {};
  const order: string[] = [];
  for (let i = 0; i < days.length; i++) {
    const k = bucketKey(days[i]);
    if (seen[k] === undefined) {
      seen[k] = { rtl: 0, trials: 0 };
      order.push(k);
    }
    seen[k].rtl += rtl[i];
    seen[k].trials += trials[i];
  }
  const rtlOut = order.map((k) => seen[k].rtl);
  const trOut = order.map((k) => seen[k].trials);
  return { labels: order, keys: order, rtl: rtlOut, trials: trOut };
}

// Format a bucket start-of-period key ("YYYY-MM-DD") into a compact
// axis tick — MMM dd for day/week, MMM 'YY for month.
function fmtTick(key: string, granularity: Granularity): string {
  const [y, m, d] = key.split("-").map(Number);
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (granularity === "month") return `${months[m]} '${String(y).slice(2)}`;
  return `${months[m]} ${d}`;
}

export default function RtlTrialChart() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("week");
  // Which asset lines are visible. Default: all 7 on.
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/rtl-trial-conversion")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ApiResponse) => {
        if (cancelled) return;
        setData(d);
        setVisible(new Set(d.assets.map((a) => a.key)));
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!data || data.assets.length === 0) return { rows: [], labels: [] as string[] };
    // Bucket each asset in the current granularity, then compute
    // conversion % per bucket. Null in a bucket with 0 RTLs (avoid
    // spurious 0% points that read as a real drop).
    type Row = { label: string } & Record<string, number | string | null>;
    let labels: string[] = [];
    const seriesByKey: Record<string, (number | null)[]> = {};
    for (const asset of data.assets) {
      const agg = aggregate(data.days, asset.dailyRtl, asset.dailyTrials, granularity);
      labels = agg.labels;
      seriesByKey[asset.key] = agg.rtl.map((r, i) => (r > 0 ? (agg.trials[i] / r) * 100 : null));
    }
    const outRows: Row[] = labels.map((label, i) => {
      const row: Row = { label };
      for (const asset of data.assets) row[asset.key] = seriesByKey[asset.key][i];
      return row;
    });
    return { rows: outRows, labels };
  }, [data, granularity]);

  function toggle(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>RTL → Trial Conversion</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[11px] font-medium">
            Top 7 ad assets by RTL, last 90 days
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Ad-asset-attributed.</span>{" "}
          For each ad asset, the share of Ready-to-Launch contacts that started a trial.
          RTL is bucketed by <code className="text-[#C9D1DC]">createdate</code>; Trials by trial-entry date.
          Buckets with 0 RTL show a gap rather than 0% so a flat line always means real conversion.
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
        {data && data.assets.length === 0 && (
          <p className="text-[12px] text-[#8B92A3] py-8 text-center">No ad assets with RTL contacts in the last 90 days.</p>
        )}

        {data && data.assets.length > 0 && (
          <>
            {/* Toggle chips (one per asset) + granularity pill. */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {data.assets.map((asset, idx) => {
                const isOn = visible.has(asset.key);
                const color = PALETTE[idx % PALETTE.length];
                return (
                  <button
                    key={asset.key}
                    onClick={() => toggle(asset.key)}
                    className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12px] font-medium transition-all ${
                      isOn
                        ? "bg-[#1A2235] border-[#1F2937] text-white"
                        : "bg-[#11182B] border-[#1F2937] text-[#5B6478] hover:text-[#C9D1DC]"
                    }`}
                    title={`${asset.channel} · ${asset.campaign} · ${asset.totalRtl} RTL / ${asset.totalTrials} trials in 90d`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isOn ? color : "#1F2937" }} />
                    <span className="max-w-[220px] truncate">{asset.key}</span>
                    <span className="text-[11px] tabular-nums opacity-60">
                      {asset.totalRtl > 0 ? `${((asset.totalTrials / asset.totalRtl) * 100).toFixed(0)}%` : "—"}
                    </span>
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
                <LineChart data={rows.rows} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
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
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    position={{ y: 250 }}
                    wrapperStyle={{ opacity: 0.9, pointerEvents: "none" }}
                    content={(props) => {
                      const { active: isActive, label, payload } = props as {
                        active?: boolean; label?: string;
                        payload?: ReadonlyArray<{ name?: string; value?: number | null; color?: string }>;
                      };
                      if (!isActive || !payload || payload.length === 0) return null;
                      const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
                      if (rows.length === 0) return null;
                      return (
                        <div className="bg-[#0E1422] border border-[#1F2937] rounded-lg p-3 text-[11px] max-w-[360px]">
                          <div className="text-[#8B92A3] mb-1">{label ? fmtTick(String(label), granularity) : ""}</div>
                          {rows.sort((a, b) => (b.value as number) - (a.value as number)).map((r, i) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="h-2 w-2 rounded-full flex-none" style={{ backgroundColor: r.color }} />
                                <span className="text-white truncate">{r.name}</span>
                              </span>
                              <span className="font-mono tabular-nums text-white flex-none">{(r.value as number).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  {data.assets.map((asset, idx) => {
                    if (!visible.has(asset.key)) return null;
                    return (
                      <Line
                        key={asset.key}
                        type="monotone"
                        dataKey={asset.key}
                        name={asset.key}
                        stroke={PALETTE[idx % PALETTE.length]}
                        strokeWidth={2}
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
