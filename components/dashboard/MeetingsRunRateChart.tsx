"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

type PathSeries = {
  meetingsBooked: number[];
  meetingsHeld: number[];
  trialists: number[];
  customers: number[];
};
type Series = {
  days: string[];
  airbnb: PathSeries;
  direct: PathSeries;
};

// Each visible "line" is one (path, metric) pair — 8 total. Path
// determines the hue; metric determines the shade and stroke style.
type Path = "airbnb" | "direct";
type Metric = "meetingsBooked" | "meetingsHeld" | "trialists" | "customers";
type SeriesKey = `${Path}_${Metric}`;

const PATH_COLORS: Record<Path, { base: string; light: string; lightest: string; lighter2: string }> = {
  // Airbnb path = blue spectrum (matches the moodboard primary).
  airbnb: { base: "#1E6FFF", light: "#3B82F6", lighter2: "#60A5FA", lightest: "#93C5FD" },
  // Direct path = white-through-light-blue gradient. Keeps the chart
  // strictly within the dashboard's blue/white palette per spec.
  direct: { base: "#FFFFFF", light: "#E0E7FF", lighter2: "#C7D2FE", lightest: "#A5B4FC" },
};

const METRIC_LABELS: Record<Metric, string> = {
  meetingsBooked: "Meetings Booked",
  meetingsHeld: "Meetings Held",
  trialists: "Trialists",
  customers: "Customers",
};

const SERIES_DEFS: { key: SeriesKey; path: Path; metric: Metric; color: string; dasharray?: string }[] = [
  { key: "airbnb_meetingsBooked", path: "airbnb", metric: "meetingsBooked", color: PATH_COLORS.airbnb.base, dasharray: "4 3" },
  { key: "airbnb_meetingsHeld",   path: "airbnb", metric: "meetingsHeld",   color: PATH_COLORS.airbnb.light },
  { key: "airbnb_trialists",      path: "airbnb", metric: "trialists",      color: PATH_COLORS.airbnb.lighter2 },
  { key: "airbnb_customers",      path: "airbnb", metric: "customers",      color: PATH_COLORS.airbnb.lightest },
  { key: "direct_meetingsBooked", path: "direct", metric: "meetingsBooked", color: PATH_COLORS.direct.base, dasharray: "4 3" },
  { key: "direct_meetingsHeld",   path: "direct", metric: "meetingsHeld",   color: PATH_COLORS.direct.light },
  { key: "direct_trialists",      path: "direct", metric: "trialists",      color: PATH_COLORS.direct.lighter2 },
  { key: "direct_customers",      path: "direct", metric: "customers",      color: PATH_COLORS.direct.lightest },
];

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

export default function MeetingsRunRateChart() {
  const [data, setData] = useState<Series | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default visible: meetings held + trialists + customers for both
  // paths. Booked is shown dashed alongside held when toggled on.
  const [active, setActive] = useState<Set<SeriesKey>>(new Set([
    "airbnb_meetingsHeld", "airbnb_trialists", "airbnb_customers",
    "direct_meetingsHeld", "direct_trialists", "direct_customers",
  ]));
  const [smoothed, setSmoothed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/campaigns/meetings-timeseries?days=60")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Series) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const sm = (a: number[]) => (smoothed ? smooth(a) : a);
    const s: Record<SeriesKey, number[]> = {
      airbnb_meetingsBooked: sm(data.airbnb.meetingsBooked),
      airbnb_meetingsHeld: sm(data.airbnb.meetingsHeld),
      airbnb_trialists: sm(data.airbnb.trialists),
      airbnb_customers: sm(data.airbnb.customers),
      direct_meetingsBooked: sm(data.direct.meetingsBooked),
      direct_meetingsHeld: sm(data.direct.meetingsHeld),
      direct_trialists: sm(data.direct.trialists),
      direct_customers: sm(data.direct.customers),
    };
    return data.days.map((day, i) => {
      const r: Record<string, number | string> = { day };
      (Object.keys(s) as SeriesKey[]).forEach((k) => { r[k] = s[k][i]; });
      return r;
    });
  }, [data, smoothed]);

  const totals = useMemo(() => {
    if (!data) return null;
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    return {
      airbnb_meetingsBooked: sum(data.airbnb.meetingsBooked),
      airbnb_meetingsHeld: sum(data.airbnb.meetingsHeld),
      airbnb_trialists: sum(data.airbnb.trialists),
      airbnb_customers: sum(data.airbnb.customers),
      direct_meetingsBooked: sum(data.direct.meetingsBooked),
      direct_meetingsHeld: sum(data.direct.meetingsHeld),
      direct_trialists: sum(data.direct.trialists),
      direct_customers: sum(data.direct.customers),
    } as Record<SeriesKey, number>;
  }, [data]);

  function toggle(k: SeriesKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function toggleAllPath(path: Path) {
    setActive((prev) => {
      const next = new Set(prev);
      const keys = SERIES_DEFS.filter((s) => s.path === path).map((s) => s.key);
      const allOn = keys.every((k) => next.has(k));
      if (allOn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Meetings Run Rate</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[11px] font-medium">
            {data ? `${data.days[0]} → ${data.days[data.days.length - 1]}` : "60-day window"}
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-2 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Period-based, daily.</span>{" "}
          Daily meetings booked / held / trialists / customers split by campaign path.
          <span className="text-[#1E6FFF] font-medium"> Airbnb path</span> = Airbnb Optimization Call + Listing Opt variants.{" "}
          <span className="text-white font-medium">Direct path</span> = Direct Website Call + DW Booking variants.{" "}
          Meetings booked uses{" "}
          <code className="text-[#C9D1DC]">engagements_last_meeting_booked</code>;
          held = booked minus contacts whose <code className="text-[#C9D1DC]">sales_call_outcome</code> classifies as no-show.
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-12 text-center">Loading meetings timeseries…</p>
        )}
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-3 text-[#C9D1DC] text-[12px]">
            <p className="font-semibold text-white">Failed to load</p>
            <p className="text-[11px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {data && totals && (
          <>
            {/* Path-grouped chips. "Airbnb" / "Direct" header chips
                toggle the whole path on/off; per-metric chips toggle
                individual lines. */}
            <div className="space-y-2 mb-5">
              {(["airbnb", "direct"] as Path[]).map((path) => {
                const series = SERIES_DEFS.filter((s) => s.path === path);
                return (
                  <div key={path} className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => toggleAllPath(path)}
                      className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12px] font-semibold ${
                        path === "airbnb" ? "text-[#60A5FA]" : "text-white"
                      } bg-[#1A2235] border-[#1F2937] hover:border-[#1E6FFF]/40`}
                      title={`Toggle all ${path} lines`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PATH_COLORS[path].base }} />
                      {path === "airbnb" ? "Airbnb path" : "Direct path"}
                    </button>
                    {series.map((s) => {
                      const isOn = active.has(s.key);
                      return (
                        <button
                          key={s.key}
                          onClick={() => toggle(s.key)}
                          className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[11px] font-medium transition-all ${
                            isOn
                              ? "bg-[#1A2235] border-[#1F2937] text-white"
                              : "bg-[#11182B] border-[#1F2937] text-[#5B6478] hover:text-[#C9D1DC]"
                          }`}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: isOn ? s.color : "#1F2937" }}
                          />
                          <span>{METRIC_LABELS[s.metric]}</span>
                          <span className="text-[10px] tabular-nums opacity-60">
                            {totals[s.key].toLocaleString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              <div className="flex justify-end mt-1">
                <span className="text-[12px] text-[#8B92A3] flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={smoothed}
                    onChange={(e) => setSmoothed(e.target.checked)}
                    className="accent-[#1E6FFF]"
                    id="meetings-smoothed"
                  />
                  <label htmlFor="meetings-smoothed" className="cursor-pointer">7-day smooth</label>
                </span>
              </div>
            </div>

            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#1F2937" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "#8B92A3" }}
                    axisLine={{ stroke: "#1F2937" }}
                    tickLine={false}
                    minTickGap={50}
                    tickFormatter={(v: string) => {
                      const [, m, d] = v.split("-");
                      const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                      return `${months[parseInt(m)]} ${parseInt(d)}`;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#5B6478" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    allowDecimals={false}
                    tickFormatter={(v: number) => Math.round(v).toLocaleString()}
                  />
                  <Tooltip
                    cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
                    content={(props) => {
                      const { active: act, label, payload } = props as {
                        active?: boolean;
                        label?: string | number;
                        payload?: ReadonlyArray<{ name?: string | number; value?: number | string; color?: string }>;
                      };
                      if (!act || !payload || payload.length === 0) return null;

                      const labelStr = typeof label === "string" ? label : String(label ?? "");
                      let dateStr: string = labelStr;
                      if (labelStr && /^\d{4}-\d{2}-\d{2}/.test(labelStr)) {
                        const [, m, d] = labelStr.split("-");
                        const months = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        dateStr = `${months[parseInt(m)]} ${parseInt(d)}, ${labelStr.split("-")[0]}`;
                      }

                      const byKey: Record<string, { value: number; color: string }> = {};
                      for (const p of payload) {
                        const k = typeof p.name === "string" ? p.name : String(p.name ?? "");
                        if (k) byKey[k] = {
                          value: typeof p.value === "number" ? p.value : parseFloat(String(p.value ?? 0)),
                          color: p.color || "#FFFFFF",
                        };
                      }

                      // Group rows by path
                      const groupRows = (path: Path) =>
                        SERIES_DEFS
                          .filter((s) => s.path === path && byKey[s.key])
                          .map((s) => ({
                            label: METRIC_LABELS[s.metric],
                            value: byKey[s.key].value,
                            color: byKey[s.key].color,
                          }));

                      return (
                        <div style={{
                          backgroundColor: "rgba(14, 20, 34, 0.95)", backdropFilter: "blur(8px)",
                          borderRadius: 12, border: "1px solid #1F2937", fontSize: 12,
                          boxShadow: "0 12px 36px rgba(0,0,0,0.5)", padding: "10px 14px",
                          color: "#FFFFFF", minWidth: 240,
                        }}>
                          <div style={{ color: "#8B92A3", fontSize: 11, marginBottom: 6 }}>{dateStr}</div>
                          {(["airbnb", "direct"] as Path[]).map((path) => {
                            const items = groupRows(path);
                            if (items.length === 0) return null;
                            return (
                              <div key={path} style={{ marginTop: 4, paddingTop: 4 }}>
                                <div style={{ fontSize: 10, color: "#8B92A3", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
                                  {path === "airbnb" ? "Airbnb path" : "Direct path"}
                                </div>
                                {items.map((it, i) => (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 0", color: "#C9D1DC" }}>
                                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: it.color, flexShrink: 0 }} />
                                    <span style={{ flex: 1 }}>{it.label}</span>
                                    <span style={{ fontVariantNumeric: "tabular-nums", color: "#FFFFFF", fontWeight: 600 }}>
                                      {Math.round(it.value).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  {SERIES_DEFS.filter((s) => active.has(s.key)).map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.key}
                      stroke={s.color}
                      strokeWidth={2.25}
                      strokeDasharray={s.dasharray}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: s.color }}
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
