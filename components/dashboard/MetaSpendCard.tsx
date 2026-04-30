"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[10px] text-[#5B6478] mt-0.5">{sub}</p>}
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
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Meta Ads — Spend & Performance</span>
          <Badge className="bg-[#1877F2]/15 text-[#60A5FA] border-[#1877F2]/25 text-[10px] font-medium">
            Live from Meta Marketing API
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#60A5FA] font-medium">Period-based.</span>{" "}
          Spend, impressions, clicks, CTR, CPC pulled from Meta Marketing API for the selected window. Independent of HubSpot — purely platform metrics.
        </p>
      </CardHeader>
      <CardContent>
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-8 text-center">Loading Meta insights…</p>
        )}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Meta API error</p>
            <p className="text-[11px] mt-1">{error}</p>
          </div>
        )}
        {data && (
          <>
            {/* Headline strip — totals across all campaigns.
                Subscriptions (= Airbnb Connect event) and Results (=
                optimization signal: meeting for call, signup for self) */}
            {(() => {
              const totalSubs = data.campaigns.reduce((s, c) => s + c.subscriptions, 0);
              const totalResults = data.campaigns.reduce((s, c) => s + c.resultValue, 0);
              const blendedCps = totalSubs > 0 ? data.summary.spend / totalSubs : 0;
              const blendedCpr = totalResults > 0 ? data.summary.spend / totalResults : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pb-4 border-b border-[#1F2937]">
                  <Stat label="Amount Spent" value={fmtMoney(data.summary.spend)} sub={`${data.since} → ${data.until}`} />
                  <Stat label="Airbnb Connects" value={fmtNum(totalSubs)} sub="Subscribe event" />
                  <Stat label="Cost / Connect" value={blendedCps > 0 ? fmtMoney(blendedCps) : "—"} />
                  <Stat label="Results" value={fmtNum(totalResults)} sub="optimization signal" />
                  <Stat label="Cost / Result" value={blendedCpr > 0 ? fmtMoney(blendedCpr) : "—"} />
                </div>
              );
            })()}

            {/* Campaigns table — columns match Meta UI exactly:
                  Campaign | Subscriptions | $/Sub | Results | $/Result | Spend
                The Result column shows the campaign's optimization
                signal (Website Contacts / Leads / Subscribes / Completed
                Reg) since Meta reports a different event type per
                campaign objective. */}
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">
                Per-Campaign Performance ({data.summary.campaignCount})
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1F2937] hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Campaign</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Airbnb Connects</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Connect</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Results</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Result</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Amount Spent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.campaigns.slice(0, 15).map((c) => (
                      <TableRow key={c.id || c.name} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                        <TableCell className="font-medium text-[12px] text-white max-w-[380px] truncate" title={c.name}>
                          {shortCampaign(c.name)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">
                          {fmtNum(c.subscriptions)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {c.costPerSub > 0 ? fmtMoney(c.costPerSub) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end leading-tight">
                            <span className="font-mono text-[12px] tabular-nums text-white">{fmtNum(c.resultValue)}</span>
                            <span className="text-[10px] text-[#5B6478]">{c.resultLabel || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {c.resultCost > 0 ? fmtMoney(c.resultCost) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">
                          {fmtMoney(c.spend)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {data.campaigns.length === 0 && (
                <p className="text-[12px] text-[#8B92A3] py-4 text-center">No campaigns with spend in this period.</p>
              )}
            </div>

            {/* Event mapping + reconciliation note */}
            <div className="mt-4 pt-3 border-t border-[#1F2937] space-y-2">
              <p className="text-[11px] text-[#8B92A3] leading-relaxed">
                <span className="text-[#60A5FA] font-medium">Meta event ⇢ funnel meaning:</span>{" "}
                <span className="font-mono text-[#C9D1DC]">Subscribe</span> ⇢ Airbnb Connected ·{" "}
                <span className="font-mono text-[#C9D1DC]">Lead / Contact</span> ⇢ Meeting Booked (call campaigns) ·{" "}
                <span className="font-mono text-[#C9D1DC]">Complete Registration</span> ⇢ Signup (self-serve campaigns).
              </p>
              <p className="text-[11px] text-[#8B92A3] leading-relaxed">
                <span className="text-[#60A5FA] font-medium">vs Campaign Analysis:</span>{" "}
                Meta numbers won&apos;t bit-match the cohort-based table above — Meta uses click-through + view-through within its own attribution window, while Campaign Analysis counts HubSpot contacts whose <span className="font-mono text-[#C9D1DC]">createdate</span> falls in the same window. Plus Meta deduplicates per-user while HubSpot can have multiple events per contact. Same-window numbers are typically within ±15%; call campaigns drift more because of the UTM-mapping bug (Meta sees the lead, HubSpot loses the campaign attribution).
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
