"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { PeriodFilter } from "@/lib/types";

/**
 * RTL Campaign Analysis — one card, Meta + Google, per campaign with
 * an expandable per-ad-asset drill-down.
 *
 * Reads /api/rtl-campaign-analysis, which returns campaigns[] with a
 * nested adAssets[] rolled up under each. Attribution goes through the
 * canonical dashboard helpers so numbers agree with Campaign Analysis
 * and Ad Health. Partner + test contacts excluded upstream.
 *
 * Five columns the team acts on (per campaign, and per ad asset when
 * expanded): Spend, Cost/RTL, RTL → Trial %, Cost/Trial, Cost/Customer.
 * RTL count sits in the Cost/RTL cell as a subtext so we can drop it
 * as a separate column and keep Cost/Customer visible without
 * horizontal scroll on standard desktop widths.
 */

type Platform = "Meta" | "Google";

interface AdAssetRow {
  key: string;
  platform: Platform;
  spend: number;
  rtl: number;
  trials: number;
  customers: number;
}
interface CampaignRow {
  campaign: string;
  platform: Platform;
  spend: number;
  rtl: number;
  trials: number;
  customers: number;
  adAssets: AdAssetRow[];
}
interface ApiResponse {
  since: string;
  until: string;
  rows: CampaignRow[];
}

function fmtMoney(n: number | null): string {
  if (n === null || !isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000)   return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

function pillClass(p: Platform) {
  return p === "Meta"
    ? "text-[#A78BFA] bg-[#A78BFA]/15 border-[#A78BFA]/30"
    : "text-[#60A5FA] bg-[#60A5FA]/15 border-[#60A5FA]/30";
}

function pctColor(pct: number | null): string {
  if (pct === null) return "text-[#5B6478]";
  if (pct >= 40) return "text-[#10B981]";
  if (pct >= 20) return "text-[#F59E0B]";
  return "text-[#F87171]";
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

interface Deriveable {
  spend: number;
  rtl: number;
  trials: number;
  customers: number;
}
function derive(r: Deriveable) {
  return {
    costPerRtl:      r.rtl > 0 ? r.spend / r.rtl : null,
    rtlToTrial:      r.rtl > 0 ? (r.trials / r.rtl) * 100 : null,
    costPerTrial:    r.trials > 0 ? r.spend / r.trials : null,
    costPerCustomer: r.customers > 0 ? r.spend / r.customers : null,
  };
}

export default function AdSpendCard({
  period, customStart, customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"All" | Platform>("All");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    fetch(`/api/rtl-campaign-analysis?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: ApiResponse) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, customStart, customEnd]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = data.rows.filter(
      (r) => r.spend > 0 || r.rtl > 0 || r.trials > 0 || r.customers > 0,
    );
    if (platform === "Meta") return rows.filter((r) => r.platform === "Meta");
    if (platform === "Google") return rows.filter((r) => r.platform === "Google");
    return rows;
  }, [data, platform]);

  const totals = useMemo(() => {
    let spend = 0, rtl = 0, trials = 0, customers = 0;
    for (const r of filteredRows) {
      spend += r.spend; rtl += r.rtl; trials += r.trials; customers += r.customers;
    }
    return { spend, rtl, trials, customers, ...derive({ spend, rtl, trials, customers }) };
  }, [filteredRows]);

  function toggle(campaign: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(campaign)) next.delete(campaign); else next.add(campaign);
      return next;
    });
  }

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight gap-3">
          <span>RTL Campaign Analysis</span>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[10px] font-medium">
              Meta + Google · click a campaign to expand
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
          {" "}falls in the window and who attribute to the campaign / ad group. Click a campaign row to
          reveal per-ad-asset detail underneath.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data && <p className="text-[12px] text-[#8B92A3] py-8 text-center">Loading…</p>}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Couldn&apos;t load RTL campaign data</p>
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
                Per-Campaign ({filteredRows.length}{platform !== "All" ? ` · ${platform}` : ""})
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1F2937] hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Campaign</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Plat.</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Spend</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / RTL</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">RTL → Trial</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Trial</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Cust</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((r) => {
                      const d = derive(r);
                      const isExpanded = expanded.has(r.campaign);
                      const hasAssets = r.adAssets.length > 0;
                      return [
                        // Campaign row
                        <TableRow
                          key={r.campaign}
                          onClick={() => hasAssets && toggle(r.campaign)}
                          className={`border-[#1F2937] transition-colors ${
                            hasAssets
                              ? "cursor-pointer hover:bg-[#0E1422]"
                              : "hover:bg-transparent"
                          } ${isExpanded ? "bg-[#0E1422]" : ""}`}
                        >
                          <TableCell className="font-medium text-[12px] text-white max-w-[220px]" title={r.campaign}>
                            <div className="flex items-center gap-1.5">
                              {hasAssets ? (
                                isExpanded
                                  ? <ChevronDown className="h-3 w-3 flex-none text-[#8B92A3]" />
                                  : <ChevronRight className="h-3 w-3 flex-none text-[#8B92A3]" />
                              ) : (
                                <span className="w-3 h-3 flex-none" />
                              )}
                              <span className="truncate">{shortCampaign(r.campaign)}</span>
                              {hasAssets && <span className="text-[10px] text-[#5B6478] font-mono ml-1">{r.adAssets.length}</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${pillClass(r.platform)}`}>{r.platform}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtMoney(r.spend)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums">
                            <div className="text-[#C9D1DC]">{fmtMoney(d.costPerRtl)}</div>
                            <div className="text-[10px] text-[#5B6478]">{r.rtl} RTL</div>
                          </TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctColor(d.rtlToTrial)}`}>{fmtPct(d.rtlToTrial)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(d.costPerTrial)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtMoney(d.costPerCustomer)}</TableCell>
                        </TableRow>,
                        // Ad-asset rows (only when expanded)
                        ...(isExpanded ? r.adAssets.map((a) => {
                          const ad = derive(a);
                          return (
                            <TableRow key={`${r.campaign}::${a.key}`} className="border-[#1F2937] bg-[#0B111C]">
                              <TableCell className="text-[12px] max-w-[220px] pl-6" title={a.key}>
                                <div className="flex items-center gap-1.5 text-[#C9D1DC]">
                                  <span className="w-3 h-3 flex-none" />
                                  <span className="text-[#5B6478] font-mono">↳</span>
                                  <span className="truncate">{a.key}</span>
                                </div>
                              </TableCell>
                              <TableCell><span className="text-[10px] text-[#5B6478]">ad</span></TableCell>
                              <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(a.spend)}</TableCell>
                              <TableCell className="text-right font-mono text-[12px] tabular-nums">
                                <div className="text-[#C9D1DC]">{fmtMoney(ad.costPerRtl)}</div>
                                <div className="text-[10px] text-[#5B6478]">{a.rtl} RTL</div>
                              </TableCell>
                              <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctColor(ad.rtlToTrial)}`}>{fmtPct(ad.rtlToTrial)}</TableCell>
                              <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(ad.costPerTrial)}</TableCell>
                              <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(ad.costPerCustomer)}</TableCell>
                            </TableRow>
                          );
                        }) : []),
                      ];
                    })}
                    {filteredRows.length === 0 && (
                      <TableRow className="border-[#1F2937]">
                        <TableCell colSpan={7} className="text-center text-[12px] text-[#8B92A3] py-6">
                          No campaigns with spend or funnel activity in this window.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <p className="text-[11px] text-[#5B6478] mt-4">
              Click any campaign with a chevron to reveal its ad assets. RTL → Trial cell colours:
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
