"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CampaignAnalysisData, CampaignAnalysisRow, PeriodFilter } from "@/lib/types";

/**
 * Ad Spend & Efficiency — merges what used to be Meta Ads and Google
 * Ads spend cards into one view. Reuses /api/campaigns/analysis (which
 * already joins ad-platform spend with HubSpot funnel counts by
 * campaign / ad group), so the numbers cannot drift from the Campaign
 * Analysis rows above.
 *
 * The four efficiency metrics the team actually acts on:
 *   Cost per RTL     = spend / readyToLaunch
 *   RTL → Trial %    = trials / readyToLaunch
 *   Cost per Trial   = spend / trials
 *   Cost per Customer = spend / customers
 * Plus Total Spend for the window.
 *
 * Meta = row.optSignal !== "google" (call + self-serve campaigns).
 * Google = row.optSignal === "google" (Google ad groups and Pmax
 * rollups, all treated as one platform).
 */

function fmtMoney(n: number | null): string {
  if (n === null || !isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}
function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}
function fmtPct(n: number | null): string {
  if (n === null || !isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}
function shortCampaign(name: string): string {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return name;
  const filtered = parts.filter((p, i) => {
    if (p.toLowerCase() === "us & ca") return false;
    if (i === parts.length - 1 && p.toLowerCase() === "campaign") return false;
    return true;
  });
  return filtered.join(" | ");
}

function isGoogleRow(r: CampaignAnalysisRow) {
  return r.optSignal === "google";
}
function platformOf(r: CampaignAnalysisRow): "Meta" | "Google" {
  return isGoogleRow(r) ? "Google" : "Meta";
}
function pillClass(p: "Meta" | "Google") {
  return p === "Meta"
    ? "text-[#A78BFA] bg-[#A78BFA]/15 border-[#A78BFA]/30"
    : "text-[#60A5FA] bg-[#60A5FA]/15 border-[#60A5FA]/30";
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[10px] text-[#5B6478] mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AdSpendCard({
  period, customStart, customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [data, setData] = useState<CampaignAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"All" | "Meta" | "Google">("All");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    fetch(`/api/campaigns/analysis?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: CampaignAnalysisData) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, customStart, customEnd]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = data.rows.filter((r) => r.spend > 0 || r.readyToLaunch > 0 || r.trials > 0 || r.customers > 0);
    if (platform === "Meta") return rows.filter((r) => !isGoogleRow(r));
    if (platform === "Google") return rows.filter((r) => isGoogleRow(r));
    return rows;
  }, [data, platform]);

  const totals = useMemo(() => {
    let spend = 0, rtl = 0, trials = 0, customers = 0;
    for (const r of filteredRows) {
      spend += r.spend;
      rtl += r.readyToLaunch;
      trials += r.trials;
      customers += r.customers;
    }
    return {
      spend, rtl, trials, customers,
      costPerRtl:      rtl > 0 ? spend / rtl : null,
      rtlToTrial:      rtl > 0 ? (trials / rtl) * 100 : null,
      costPerTrial:    trials > 0 ? spend / trials : null,
      costPerCustomer: customers > 0 ? spend / customers : null,
    };
  }, [filteredRows]);

  const sortedRows = useMemo(() => {
    // Sort by spend desc within the filtered set (headline campaigns
    // are the ones burning budget). Ties fall through to name for
    // stable ordering.
    return [...filteredRows].sort((a, b) => {
      if (b.spend !== a.spend) return b.spend - a.spend;
      return a.campaign.localeCompare(b.campaign);
    });
  }, [filteredRows]);

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight gap-3">
          <span>Ad Spend & Efficiency</span>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[10px] font-medium">
              Meta + Google · joined to HubSpot
            </Badge>
            <div className="inline-flex h-7 rounded-full bg-[#0E1422] border border-[#1F2937] p-0.5">
              {(["All", "Meta", "Google"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`px-3 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                    platform === p ? "bg-[#1E6FFF] text-white" : "text-[#8B92A3] hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#60A5FA] font-medium">Cohort-based.</span>{" "}
          Ad-platform spend joined to HubSpot contacts whose <code className="text-[#C9C9D1]">createdate</code>
          {" "}falls in the window and who attribute to the campaign / ad group. RTL uses
          <code className="text-[#C9C9D1]"> property_ready_to_launch</code>; RTL → Trial % is
          trials on qualified signups from this cohort divided by RTLs from the same cohort.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-8 text-center">Loading…</p>
        )}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Couldn&apos;t load ad spend data</p>
            <p className="text-[11px] mt-1">{error}</p>
          </div>
        )}
        {data && (
          <>
            {/* Headline strip — the 5 metrics the team acts on. */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pb-4 border-b border-[#1F2937]">
              <Stat label="Total Spend" value={fmtMoney(totals.spend)} sub={`${data.since} → ${data.until}`} />
              <Stat label="Cost / RTL" value={fmtMoney(totals.costPerRtl)} sub={`${fmtNum(totals.rtl)} RTLs`} />
              <Stat label="RTL → Trial" value={fmtPct(totals.rtlToTrial)} sub={`${fmtNum(totals.trials)} trials of ${fmtNum(totals.rtl)}`} />
              <Stat label="Cost / Trial" value={fmtMoney(totals.costPerTrial)} sub={`${fmtNum(totals.trials)} trials`} />
              <Stat label="Cost / Customer" value={fmtMoney(totals.costPerCustomer)} sub={`${fmtNum(totals.customers)} customers`} />
            </div>

            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">
                Per-Campaign ({sortedRows.length}{platform !== "All" ? ` · ${platform}` : ""})
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1F2937] hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Campaign</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Platform</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Spend</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">RTL</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / RTL</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">RTL → Trial</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Trial</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Customer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((r) => {
                      const plat = platformOf(r);
                      const costPerRtl = r.readyToLaunch > 0 ? r.spend / r.readyToLaunch : null;
                      const rtlToT = r.readyToLaunch > 0 ? (r.trials / r.readyToLaunch) * 100 : null;
                      const pctCls = rtlToT === null ? "text-[#5B6478]"
                        : rtlToT >= 40 ? "text-[#10B981]"
                        : rtlToT >= 20 ? "text-[#F59E0B]"
                        : "text-[#F87171]";
                      return (
                        <TableRow key={r.campaign} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                          <TableCell className="font-medium text-[12px] text-white whitespace-nowrap max-w-[280px] truncate" title={r.campaign}>
                            {shortCampaign(r.campaign)}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${pillClass(plat)}`}>{plat}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtMoney(r.spend)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtNum(r.readyToLaunch)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(costPerRtl)}</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctCls}`}>{fmtPct(rtlToT)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(r.costPerTrial)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtMoney(r.costPerCustomer)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {sortedRows.length === 0 && (
                      <TableRow className="border-[#1F2937]">
                        <TableCell colSpan={8} className="text-center text-[12px] text-[#8B92A3] py-6">
                          No campaigns with spend or funnel activity in this window.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <p className="text-[11px] text-[#5B6478] mt-4">
              RTL → Trial % is a cohort measure: for RTLs from signups in the selected window,
              what share went on to trial (whenever the trial started). Cell shading:
              <span className="text-[#10B981] mx-1">green ≥40%</span>·
              <span className="text-[#F59E0B] mx-1">amber 20–39%</span>·
              <span className="text-[#F87171] mx-1">red &lt;20%</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
