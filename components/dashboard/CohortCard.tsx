"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CohortData } from "@/lib/types";

function RateBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const color =
    value > thresholds[0]
      ? "border-[#079289]/30 text-[#0F5955] bg-[#EDFBF8]"
      : value > thresholds[1]
        ? "border-[#999258]/30 text-[#999258] bg-[#FBFAED]"
        : "border-[#801F50]/30 text-[#801F50] bg-[#FFC5E3]/10";
  return (
    <Badge variant="outline" className={`font-mono text-[11px] ${color}`}>
      {value.toFixed(1)}%
    </Badge>
  );
}

export default function CohortCard({ cohort, period }: { cohort: CohortData; period: string }) {
  const stages = [
    { name: "Signed Up", count: cohort.signups, rate: null },
    { name: "Authorized Airbnb", count: cohort.authorized, rate: cohort.authRate },
    { name: "Created Properties", count: cohort.createdProperties, rate: cohort.propsRate },
    { name: "Clicked Launch", count: cohort.clickedLaunch, rate: cohort.launchRate },
    { name: "★ Trial Started", count: cohort.trials, rate: cohort.trialRate },
    { name: "★★ Customer", count: cohort.customers, rate: cohort.customerRate },
  ];

  return (
    <Card className="border-[#E8EAF0] shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-bold text-[#111111]">
          <span>Cohort Analysis</span>
          <Badge className="bg-[#F1F4FF] text-[#3863E6] border-[#3863E6]/20 text-[10px] font-medium">
            Signups who signed up during this period
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[12px] text-[#656C74] mb-3">
          Of {cohort.signups.toLocaleString()} people who signed up, what % reached each stage?
        </p>
        <Table>
          <TableHeader>
            <TableRow className="border-[#E8EAF0]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Stage</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Count</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">% of Signups</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Visual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((stage) => {
              const pct = cohort.signups > 0 ? (stage.count / cohort.signups) * 100 : 0;
              return (
                <TableRow key={stage.name} className="border-[#E8EAF0]">
                  <TableCell className="font-medium text-[13px] text-[#111111]">{stage.name}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{stage.count.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {stage.rate !== null ? (
                      <RateBadge value={stage.rate} thresholds={[50, 20]} />
                    ) : (
                      <span className="text-[12px] text-[#656C74]">100%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right w-[120px]">
                    <div className="flex items-center justify-end gap-1">
                      <div className="h-2 rounded-full bg-[#E8EAF0] w-[100px] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#3863E6] to-[#543CE8]"
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
        <div className="mt-4 pt-3 border-t border-[#E8EAF0] grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">S-to-T</p>
            <p className="text-lg font-bold text-[#0F5955]">{cohort.trialRate.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">T-to-C</p>
            <p className="text-lg font-bold text-[#0F5955]">{cohort.trialToCustomerRate.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">S-to-C</p>
            <p className="text-lg font-bold text-[#3863E6]">{cohort.customerRate.toFixed(1)}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
