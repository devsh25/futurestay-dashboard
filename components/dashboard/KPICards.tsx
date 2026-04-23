"use client";

import { Card, CardContent } from "@/components/ui/card";
import { KPIs, CohortData, TrendDelta } from "@/lib/types";
import Sparkline from "./Sparkline";

function TrendBadge({ delta }: { delta: TrendDelta }) {
  if (delta.previous === 0 && delta.current === 0) {
    return <span className="text-[10px] text-[#6B6B75] font-medium">—</span>;
  }
  const up = delta.pct >= 0;
  const color = up ? "text-[#6EE7B7] bg-[#0F2A1F]" : "text-[#F87171] bg-[#2A0F13]";
  const arrow = up ? "↑" : "↓";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {arrow} {Math.abs(delta.pct).toFixed(0)}%
    </span>
  );
}

function KPIMainCard({
  label,
  value,
  delta,
  sparklineData,
  color,
}: {
  label: string;
  value: number;
  delta: TrendDelta;
  sparklineData: number[];
  color: string;
}) {
  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none hover:border-[#2A2A32] transition-colors duration-200">
      <CardContent className="pt-5 pb-5 px-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-[11px] font-medium text-[#8A8A94] uppercase tracking-wider">
            {label}
          </p>
          <TrendBadge delta={delta} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <p className="text-[48px] leading-none font-bold text-white tracking-tight tabular-nums">
            {value.toLocaleString()}
          </p>
          <div className="flex-shrink-0 pb-1">
            <Sparkline data={sparklineData} color={color} width={80} height={32} />
          </div>
        </div>
        <p className="text-[10px] text-[#6B6B75] mt-3">
          vs {delta.previous.toLocaleString()} prior period
        </p>
      </CardContent>
    </Card>
  );
}

function RateCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "amber" | "red";
}) {
  const valueColor = {
    green: "text-[#6EE7B7]",
    amber: "text-[#FBBF24]",
    red: "text-[#F87171]",
  }[color];

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardContent className="pt-4 pb-4 px-5">
        <p className="text-[11px] font-medium text-[#8A8A94] uppercase tracking-wider">
          {label}
        </p>
        <p className={`text-3xl font-bold mt-2 tabular-nums ${valueColor}`}>
          {value.toFixed(1)}%
        </p>
      </CardContent>
    </Card>
  );
}

export default function KPICards({ kpis, cohort }: { kpis: KPIs; cohort: CohortData }) {
  return (
    <div className="space-y-5">
      {/* Row 1: Core health numbers with sparklines + trend deltas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPIMainCard
          label="Qualified Signups"
          value={kpis.totalSignups}
          delta={kpis.deltas.signups}
          sparklineData={kpis.sparkline.signups}
          color="#A78BFA"
        />
        <KPIMainCard
          label="Total Trials"
          value={kpis.totalTrials}
          delta={kpis.deltas.trials}
          sparklineData={kpis.sparkline.trials}
          color="#6EE7B7"
        />
        <KPIMainCard
          label="In Trial"
          value={kpis.totalInTrial}
          delta={kpis.deltas.inTrial}
          sparklineData={kpis.sparkline.inTrial}
          color="#FB923C"
        />
        <KPIMainCard
          label="Total Customers"
          value={kpis.totalCustomers}
          delta={kpis.deltas.customers}
          sparklineData={kpis.sparkline.customers}
          color="#60A5FA"
        />
      </div>

      {/* Row 2: Cohort conversion rates + Churn + DQ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <RateCard
          label="Qualified Signup → Trial"
          value={cohort.trialRate}
          color={cohort.trialRate > 15 ? "green" : cohort.trialRate > 10 ? "amber" : "red"}
        />
        <RateCard
          label="Trial → Customer"
          value={cohort.trialToCustomerRate}
          color={cohort.trialToCustomerRate > 40 ? "green" : cohort.trialToCustomerRate > 25 ? "amber" : "red"}
        />
        <RateCard
          label="Qualified Signup → Customer"
          value={cohort.customerRate}
          color={cohort.customerRate > 5 ? "green" : cohort.customerRate > 3 ? "amber" : "red"}
        />
        <RateCard
          label="Churn Rate"
          value={kpis.churnRate}
          color={kpis.churnRate < 10 ? "green" : kpis.churnRate < 20 ? "amber" : "red"}
        />
        <RateCard
          label="AirbnbDQ Rate"
          value={kpis.dqRate}
          color={kpis.dqRate < 10 ? "green" : kpis.dqRate < 20 ? "amber" : "red"}
        />
      </div>
    </div>
  );
}
