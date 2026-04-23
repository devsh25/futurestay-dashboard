"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CohortData } from "@/lib/types";

function RateBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const color =
    value > thresholds[0]
      ? "text-[#6EE7B7] bg-[#0F2A1F] border-[#6EE7B7]/20"
      : value > thresholds[1]
        ? "text-[#FBBF24] bg-[#2A1F0F] border-[#FBBF24]/20"
        : "text-[#F87171] bg-[#2A0F13] border-[#F87171]/20";
  return (
    <Badge variant="outline" className={`font-mono text-[11px] tabular-nums ${color}`}>
      {value.toFixed(1)}%
    </Badge>
  );
}

export default function CohortCard({ cohort }: { cohort: CohortData; period: string }) {
  const stages = [
    { name: "Qualified Signups", count: cohort.signups, rate: null },
    { name: "Authorized Airbnb", count: cohort.authorized, rate: cohort.authRate },
    { name: "Created Properties", count: cohort.createdProperties, rate: cohort.propsRate },
    { name: "Clicked Launch", count: cohort.clickedLaunch, rate: cohort.launchRate },
    { name: "★ Trial Started", count: cohort.trials, rate: cohort.trialRate },
    { name: "☆ In Trial", count: cohort.inTrial, rate: cohort.inTrialRate },
    { name: "★★ Customer", count: cohort.customers, rate: cohort.customerRate },
  ];

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Cohort Analysis</span>
          <Badge className="bg-[#A78BFA]/15 text-[#C4B5FD] border-[#A78BFA]/25 text-[10px] font-medium">
            Qualified signups from this period
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[12px] text-[#8A8A94] mb-3">
          Of {cohort.signups.toLocaleString()} qualified signups (Airbnb DQ excluded), what % reached each stage?
        </p>
        <Table>
          <TableHeader>
            <TableRow className="border-[#1F1F28] hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Stage</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Count</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">% of Signups</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">Visual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((stage) => {
              const pct = cohort.signups > 0 ? (stage.count / cohort.signups) * 100 : 0;
              return (
                <TableRow key={stage.name} className="border-[#1F1F28] hover:bg-[#1A1A22] transition-colors">
                  <TableCell className="font-medium text-[13px] text-white">{stage.name}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{stage.count.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {stage.rate !== null ? (
                      <RateBadge value={stage.rate} thresholds={[50, 20]} />
                    ) : (
                      <span className="text-[12px] text-[#8A8A94]">100%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right w-[120px]">
                    <div className="flex items-center justify-end gap-1">
                      <div className="h-2 rounded-full bg-[#1F1F28] w-[100px] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#A78BFA] to-[#8B5CF6]"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Key conversion rates summary */}
        <div className="mt-4 pt-3 border-t border-[#1F1F28] grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">QS-to-T</p>
            <p className="text-2xl font-bold text-[#6EE7B7] tabular-nums mt-1">{cohort.trialRate.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">T-to-C</p>
            <p className="text-2xl font-bold text-[#6EE7B7] tabular-nums mt-1">{cohort.trialToCustomerRate.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">QS-to-C</p>
            <p className="text-2xl font-bold text-[#A78BFA] tabular-nums mt-1">{cohort.customerRate.toFixed(1)}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
