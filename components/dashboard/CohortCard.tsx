"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CohortData } from "@/lib/types";

function RateBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  // Reduced to a 2-tone scale on the blue spectrum: white text for
  // healthy, muted slate for low. Drops the old amber middle and red
  // bottom — saturated status colours on every cohort row was visual
  // noise. Threshold[1] still carries the "low" signal, just in a
  // calmer way.
  const color =
    value > thresholds[0]
      ? "text-white bg-[#1A2235] border-[#1F2937]"
      : value > thresholds[1]
        ? "text-[#60A5FA] bg-[#0F1E2E] border-[#1F2937]"
        : "text-[#5B6478] bg-[#11182B] border-[#1F2937]";
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
    { name: "🚀 Ready to Launch", count: cohort.readyToLaunch, rate: cohort.readyToLaunchRate },
    { name: "★ Trial Started", count: cohort.trials, rate: cohort.trialRate },
    { name: "☆ In Trial", count: cohort.inTrial, rate: cohort.inTrialRate },
    { name: "★★ Customer", count: cohort.customers, rate: cohort.customerRate },
    { name: "⊘ Failed Trialist", count: cohort.failedTrialists, rate: cohort.failedTrialistRate },
    { name: "⚠ Churned (real)", count: cohort.churned, rate: cohort.churnedRate },
  ];

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Cohort Analysis</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#93BBFE] border-[#1E6FFF]/25 text-[10px] font-medium">
            Qualified signups from this period
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Cohort-based.</span>{" "}
          Of qualified signups whose <code className="text-[#C9C9D1]">createdate</code> falls in the window, % that reached each downstream stage. Preserves causal attribution from signup to outcome.
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-[13px] text-[#8B92A3] mb-3">
          Of {cohort.signups.toLocaleString()} qualified signups (Airbnb DQ excluded), what % reached each stage?
        </p>
        <Table>
          <TableHeader>
            <TableRow className="border-[#1F2937] hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Stage</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Count</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">% of Signups</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Visual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((stage) => {
              const pct = cohort.signups > 0 ? (stage.count / cohort.signups) * 100 : 0;
              return (
                <TableRow key={stage.name} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                  <TableCell className="font-medium text-[13px] text-white">{stage.name}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{stage.count.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {stage.rate !== null ? (
                      <RateBadge value={stage.rate} thresholds={[50, 20]} />
                    ) : (
                      <span className="text-[12px] text-[#8B92A3]">100%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right w-[120px]">
                    <div className="flex items-center justify-end gap-1">
                      <div className="h-2 rounded-full bg-[#1F2937] w-[100px] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#1E6FFF] to-[#8B5CF6]"
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
        <div className="mt-4 pt-3 border-t border-[#1F2937] grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">QS-to-T</p>
            <p className="text-2xl font-bold text-[#60A5FA] tabular-nums mt-1">{cohort.trialRate.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">T-to-C</p>
            <p className="text-2xl font-bold text-[#60A5FA] tabular-nums mt-1">{cohort.trialToCustomerRate.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">QS-to-C</p>
            <p className="text-2xl font-bold text-[#1E6FFF] tabular-nums mt-1">{cohort.customerRate.toFixed(1)}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
