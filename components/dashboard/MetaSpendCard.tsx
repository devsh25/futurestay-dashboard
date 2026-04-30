"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { MetaInsightsData, PeriodFilter } from "@/lib/types";

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function shortCampaign(name: string): string {
  // "05.03 | US & CA | Direct Website Booking | Static ..." → "Direct Website Booking | Static ..."
  const parts = name.split("|").map((p) => p.trim());
  if (parts.length >= 3) return parts.slice(2).join(" | ");
  return name;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[10px] text-[#6B6B75] mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MetaSpendCard({
  period,
  customStart,
  customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [data, setData] = useState<MetaInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    fetch(`/api/meta/insights?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d: MetaInsightsData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, customStart, customEnd]);

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Meta Ads — Spend & Performance</span>
          <Badge className="bg-[#1877F2]/15 text-[#60A5FA] border-[#1877F2]/25 text-[10px] font-medium">
            Live from Meta Marketing API
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8A8A94] mt-1.5 leading-relaxed">
          <span className="text-[#60A5FA] font-medium">Period-based.</span>{" "}
          Spend, impressions, clicks, CTR, CPC pulled from Meta Marketing API for the selected window. Independent of HubSpot — purely platform metrics.
        </p>
      </CardHeader>
      <CardContent>
        {loading && !data && (
          <p className="text-[12px] text-[#8A8A94] py-8 text-center">Loading Meta insights…</p>
        )}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Meta API error</p>
            <p className="text-[11px] mt-1">{error}</p>
          </div>
        )}
        {data && (
          <>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 pb-4 border-b border-[#1F1F28]">
              <Stat label="Spend" value={fmtMoney(data.summary.spend)} sub={`${data.since} → ${data.until}`} />
              <Stat label="Impressions" value={fmtNum(data.summary.impressions)} />
              <Stat label="Clicks" value={fmtNum(data.summary.clicks)} />
              <Stat label="CTR" value={`${data.summary.ctr.toFixed(2)}%`} />
              <Stat label="CPC" value={fmtMoney(data.summary.cpc)} />
              <Stat label="CPM" value={fmtMoney(data.summary.cpm)} />
            </div>

            {/* Daily spend */}
            {data.daily.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold mb-2">
                  Daily Spend
                </p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} margin={{ top: 4, right: 0, bottom: 0, left: -10 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: "#8A8A94" }}
                        axisLine={{ stroke: "#2A2A32" }}
                        tickLine={false}
                        tickFormatter={(v: string) => {
                          const [, m, d] = v.split("-");
                          return `${parseInt(m)}/${parseInt(d)}`;
                        }}
                        minTickGap={20}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#6B6B75" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v}`)}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(96, 165, 250, 0.08)" }}
                        contentStyle={{
                          backgroundColor: "#1A1A22",
                          borderRadius: 10,
                          border: "1px solid #2A2A32",
                          fontSize: 12,
                          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                          padding: "8px 12px",
                          color: "#FFFFFF",
                        }}
                        labelStyle={{ color: "#FFFFFF" }}
                        itemStyle={{ color: "#60A5FA" }}
                        formatter={(value) => {
                          const n = typeof value === "number" ? value : parseFloat(String(value ?? 0));
                          return [fmtMoney(isNaN(n) ? 0 : n), "Spend"];
                        }}
                      />
                      <Bar dataKey="spend" fill="#60A5FA" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Campaigns table */}
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold mb-2">
                Top Campaigns ({data.summary.campaignCount})
              </p>
              <Table>
                <TableHeader>
                  <TableRow className="border-[#1F1F28] hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Campaign</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Spend</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Impr.</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Clicks</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">CTR</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">CPC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.campaigns.slice(0, 15).map((c) => (
                    <TableRow key={c.id || c.name} className="border-[#1F1F28] hover:bg-[#1A1A22] transition-colors">
                      <TableCell className="font-medium text-[12px] text-white max-w-[380px] truncate" title={c.name}>
                        {shortCampaign(c.name)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">
                        {fmtMoney(c.spend)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">
                        {fmtNum(c.impressions)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">
                        {fmtNum(c.clicks)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">
                        {c.ctr.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">
                        {fmtMoney(c.cpc)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.campaigns.length === 0 && (
                <p className="text-[12px] text-[#8A8A94] py-4 text-center">No campaigns with spend in this period.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
