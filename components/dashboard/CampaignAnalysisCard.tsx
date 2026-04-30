"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CampaignAnalysisData, CampaignAnalysisRow, PeriodFilter } from "@/lib/types";

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0";
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(1)}%`;
}
function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

const TYPE_BADGE = {
  call: { bg: "bg-[#A78BFA]/15", text: "text-[#A78BFA]", border: "border-[#A78BFA]/30" },
  self: { bg: "bg-[#6EE7B7]/15", text: "text-[#6EE7B7]", border: "border-[#6EE7B7]/30" },
} as const;

const OPT_LABEL: Record<string, string> = {
  meetings: "meetings",
  signups: "signups",
  airbnb_connected: "airbnb_conn",
};

function dqColor(rate: number) {
  if (rate >= 20) return "text-[#F87171]";
  if (rate >= 10) return "text-[#FBBF24]";
  return "text-[#8A8A94]";
}

function CampaignRow({ r }: { r: CampaignAnalysisRow }) {
  const tb = TYPE_BADGE[r.type];
  return (
    <TableRow className="border-[#1F1F28] hover:bg-[#1A1A22] transition-colors">
      <TableCell className="font-medium text-[12px] text-white whitespace-nowrap max-w-[260px] truncate" title={r.campaign}>
        {r.campaign}
      </TableCell>
      <TableCell>
        <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${tb.bg} ${tb.text} ${tb.border}`}>
          {r.type}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtMoney(r.spend)}</TableCell>
      <TableCell className="text-[10px] text-[#8A8A94] whitespace-nowrap">{OPT_LABEL[r.optSignal] || r.optSignal}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtNum(r.leads)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">{fmtNum(r.meetingsBooked)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">{fmtNum(r.signups)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtNum(r.qualifiedSignups)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#60A5FA]">{fmtNum(r.airbnbConnected)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#FBBF24]">{fmtNum(r.readyToLaunch)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${dqColor(r.airbnbDqRate)}`}>{fmtPct(r.airbnbDqRate)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.noShowMtgRate !== null && r.noShowMtgRate >= 30 ? "text-[#F87171]" : "text-[#8A8A94]"}`}>{fmtPct(r.noShowMtgRate)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.dqMtgRate !== null && r.dqMtgRate >= 10 ? "text-[#FBBF24]" : "text-[#8A8A94]"}`}>{fmtPct(r.dqMtgRate)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.interestedMtgRate !== null && r.interestedMtgRate >= 10 ? "text-[#6EE7B7]" : "text-[#8A8A94]"}`}>{fmtPct(r.interestedMtgRate)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{fmtPct(r.notInterestedMtgRate)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#A78BFA]">{fmtPct(r.outcomeCoverage)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{fmtPct(r.salesDqRate)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.noShowRate !== null && r.noShowRate >= 30 ? "text-[#F87171]" : "text-[#8A8A94]"}`}>{fmtPct(r.noShowRate)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.interestedRate !== null && r.interestedRate >= 10 ? "text-[#6EE7B7]" : "text-[#8A8A94]"}`}>{fmtPct(r.interestedRate)}</TableCell>
      <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.formToMeetingRate !== null && r.formToMeetingRate < 50 ? "text-[#FBBF24]" : "text-[#8A8A94]"}`}>{fmtPct(r.formToMeetingRate)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">{fmtMoney(r.costPerMeeting)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">{fmtNum(r.trials)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#E5E5EB]">{fmtMoney(r.costPerTrial)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtNum(r.customers)}</TableCell>
      <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtMoney(r.costPerCustomer)}</TableCell>
    </TableRow>
  );
}

export default function CampaignAnalysisCard({
  period,
  customStart,
  customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [data, setData] = useState<CampaignAnalysisData | null>(null);
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
    fetch(`/api/campaigns/analysis?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d: CampaignAnalysisData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [period, customStart, customEnd]);

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3 border-b border-[#1F1F28]">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Campaign Analysis</span>
          <Badge className="bg-[#1877F2]/15 text-[#60A5FA] border-[#1877F2]/25 text-[10px] font-medium">
            6 Meta campaigns × HubSpot funnel
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data && (
          <p className="text-[12px] text-[#8A8A94] py-8 text-center">Loading campaign analysis…</p>
        )}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Couldn&apos;t load campaign analysis</p>
            <p className="text-[11px] mt-1">{error}</p>
          </div>
        )}
        {data && (
          <>
            <p className="text-[12px] text-[#8A8A94] mb-3">
              Window: <span className="text-white font-mono">{data.since}</span> → <span className="text-white font-mono">{data.until}</span>
              <span className="ml-3 text-[11px] text-[#6B6B75]">
                Spend = Meta API · Funnel metrics = HubSpot · WIX/HOPPER + pre-launch fallback victims excluded
              </span>
            </p>
            <div className="overflow-x-auto -mx-2">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#1F1F28] hover:bg-transparent">
                    <TableHead className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Campaign</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Type</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Spend</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Opt Signal</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Leads</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Mtgs Bkd</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Signups</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Qual Sgnp</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Airbnb Conn</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">🚀 Ready</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">A-DQ %</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">No-show % mtgs</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">DQ % mtgs</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Int % mtgs</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">NotInt % mtgs</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Coverage % mtgs</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Sales DQ %</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">No-show %</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Int %</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Form→Mtg %</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">$/Mtg</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Trials</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">$/Trial</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Cust</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">$/Cust</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => <CampaignRow key={r.campaign} r={r} />)}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 pt-3 border-t border-[#1F1F28] flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[#6B6B75]">
              <span><span className="text-[#A78BFA] font-semibold">call</span> = Meta optimizes for meetings</span>
              <span><span className="text-[#6EE7B7] font-semibold">self</span> = Meta optimizes for signups or airbnb_connected</span>
              <span>Qual Sgnp = Signups − Airbnb DQ</span>
              <span>Customers = real paid (Amplify/Flex), excl. &lt;2-day cancels</span>
              <span>Outcome % = derived from sales_call_outcome ∪ note keywords ∪ Aircall after-meeting no-answer</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
