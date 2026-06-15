"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GoogleAdsInsightsData, PeriodFilter } from "@/lib/types";

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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[10px] text-[#5B6478] mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * Google Ads — Spend & Performance card.
 *
 * Parallels MetaSpendCard in shape so users get a consistent reading
 * pattern across the two paid-channel cards. Headline stats:
 *   Amount Spent · Impressions · Clicks · CTR · Conversions · Cost / Conv
 *
 * Per-campaign table: name + impressions + clicks + CTR + CPC +
 * conversions + cost-per-conversion + spend. Pulled live from the
 * Google Ads API (Basic Access required for cost data).
 */
export default function GoogleAdsCard({
  period,
  customStart,
  customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [data, setData] = useState<GoogleAdsInsightsData | null>(null);
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
    fetch(`/api/google/insights?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d: GoogleAdsInsightsData) => {
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
          <span>Google Ads — Spend & Performance</span>
          {/* Violet badge to match the Run Rate chart's Google line and
              keep Meta (blue) vs Google (violet) consistent visually. */}
          <Badge className="bg-[#A78BFA]/15 text-[#A78BFA] border-[#A78BFA]/25 text-[10px] font-medium">
            Live from Google Ads API
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#A78BFA] font-medium">Period-based.</span>{" "}
          Spend, impressions, clicks, CTR, CPC, and conversions pulled from Google Ads API for the selected window. Independent of HubSpot — purely platform metrics.
        </p>
      </CardHeader>
      <CardContent>
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-8 text-center">Loading Google Ads insights…</p>
        )}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Google Ads API error</p>
            <p className="text-[11px] mt-1">{error}</p>
          </div>
        )}
        {data && (
          <>
            {/* Headline strip — account-level totals across the window */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pb-4 border-b border-[#1F2937]">
              <Stat label="Amount Spent" value={fmtMoney(data.summary.spend)} sub={`${data.since} → ${data.until}`} />
              <Stat label="Impressions" value={fmtNum(data.summary.impressions)} />
              <Stat label="Clicks" value={fmtNum(data.summary.clicks)} sub={`CTR ${data.summary.ctr.toFixed(2)}%`} />
              <Stat label="Conversions" value={fmtNum(Math.round(data.summary.conversions))} />
              <Stat label="Cost / Conv" value={data.summary.costPerConversion > 0 ? fmtMoney(data.summary.costPerConversion) : "—"} />
            </div>

            {/* Per-campaign table — sorted by spend desc. New zero-spend
                campaigns appear at the bottom (sorted alphabetically) so
                the user can confirm new campaigns are recognised. */}
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">
                Per-Campaign Performance ({data.summary.campaignCount})
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1F2937] hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Campaign</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Impressions</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Clicks</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">CTR</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">CPC</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Conversions</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Cost / Conv</TableHead>
                      <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Amount Spent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.campaigns.slice(0, 20).map((c) => (
                      <TableRow key={c.id || c.name} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                        <TableCell className="font-medium text-[12px] text-white whitespace-nowrap" title={c.name}>
                          {c.name}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {fmtNum(c.impressions)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {fmtNum(c.clicks)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {c.cpc > 0 ? fmtMoney(c.cpc) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">
                          {fmtNum(Math.round(c.conversions))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">
                          {c.costPerConversion > 0 ? fmtMoney(c.costPerConversion) : "—"}
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
                <p className="text-[12px] text-[#8B92A3] py-4 text-center">No campaigns in this period.</p>
              )}
            </div>

            {/* Note about reconciliation with the rest of the dashboard */}
            <div className="mt-4 pt-3 border-t border-[#1F2937]">
              <p className="text-[11px] text-[#8B92A3] leading-relaxed">
                <span className="text-[#A78BFA] font-medium">vs Campaign Analysis:</span>{" "}
                Google numbers won&apos;t bit-match the cohort-based Campaign Analysis table — Google uses click-through attribution within its own conversion window, while Campaign Analysis counts HubSpot contacts whose <span className="font-mono text-[#C9D1DC]">createdate</span> falls in the same window. Same-window numbers are typically within ±10%; brand-search drift is the smallest because intent signals are cleanest there.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
