"use client";

import { Card, CardContent } from "@/components/ui/card";
import { KPIs, CohortData, TrendDelta } from "@/lib/types";
import Sparkline from "./Sparkline";

function TrendBadge({ delta }: { delta: TrendDelta }) {
  if (delta.previous === 0 && delta.current === 0) {
    return <span className="text-[10px] text-[#B0B7BF] font-medium">\u2014</span>;
  }
  const up = delta.pct >= 0;
  const color = up ? "text-[#0F5955] bg-[#EDFBF8]" : "text-[#801F50] bg-[#FFC5E3]/40";
  const arrow = up ? "\u2191" : "\u2193";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
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
    <Card className="border-[#E8EAF0] shadow-[0_1px_3px_rgba(17,17,17,0.04)] hover:shadow-[0_4px_12px_rgba(17,17,17,0.08)] transition-shadow duration-200">
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between mb-2">
          <p className="text-[11px] font-semibold text-[#656C74] uppercase tracking-wider">
            {label}
          </p>
          <TrendBadge delta={delta} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <p className="text-3xl font-bold text-[#111111] tracking-tight">
            {value.toLocaleString()}
          </p>
          <div className="flex-shrink-0">
            <Sparkline data={sparklineData} color={color} />
          </div>
        </div>
        <p className="text-[10px] text-[#B0B7BF] mt-2">
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
  const styles = {
    green: { text: "text-[#0F5955]", bg: "bg-[#EDFBF8]", border: "border-[#079289]/20" },
    amber: { text: "text-[#999258]", bg: "bg-[#FBFAED]", border: "border-[#999258]/30" },
    red: { text: "text-[#801F50]", bg: "bg-[#FFC5E3]/30", border: "border-[#801F50]/20" },
  }[color];

  return (
    <Card className={`border ${styles.border} ${styles.bg} shadow-none`}>
      <CardContent className="pt-4 pb-3 px-5">
        <p className="text-[11px] font-semibold text-[#656C74] uppercase tracking-wider">
          {label}
        </p>
        <p className={`text-2xl font-bold mt-1 ${styles.text}`}>
          {value.toFixed(1)}%
        </p>
      </CardContent>
    </Card>
  );
}

export default function KPICards({ kpis, cohort }: { kpis: KPIs; cohort: CohortData }) {
  return (
    <div className="space-y-4">
      {/* Row 1: Core health numbers with sparklines + trend deltas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPIMainCard
          label="Qualified Signups"
          value={kpis.totalSignups}
          delta={kpis.deltas.signups}
          sparklineData={kpis.sparkline.signups}
          color="#3863E6"
        />
        <KPIMainCard
          label="Total Trials"
          value={kpis.totalTrials}
          delta={kpis.deltas.trials}
          sparklineData={kpis.sparkline.trials}
          color="#0F5955"
        />
        <KPIMainCard
          label="In Trial"
          value={kpis.totalInTrial}
          delta={kpis.deltas.inTrial}
          sparklineData={kpis.sparkline.inTrial}
          color="#999258"
        />
        <KPIMainCard
          label="Total Customers"
          value={kpis.totalCustomers}
          delta={kpis.deltas.customers}
          sparklineData={kpis.sparkline.customers}
          color="#079289"
        />
      </div>

      {/* Row 2: Cohort conversion rates + DQ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RateCard
          label="Qualified Signup \u2192 Trial"
          value={cohort.trialRate}
          color={cohort.trialRate > 15 ? "green" : cohort.trialRate > 10 ? "amber" : "red"}
        />
        <RateCard
          label="Trial \u2192 Customer"
          value={cohort.trialToCustomerRate}
          color={cohort.trialToCustomerRate > 40 ? "green" : cohort.trialToCustomerRate > 25 ? "amber" : "red"}
        />
        <RateCard
          label="Qualified Signup \u2192 Customer"
          value={cohort.customerRate}
          color={cohort.customerRate > 5 ? "green" : cohort.customerRate > 3 ? "amber" : "red"}
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
