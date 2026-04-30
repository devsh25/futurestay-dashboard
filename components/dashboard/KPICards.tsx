"use client";

import { Card, CardContent } from "@/components/ui/card";
import { KPIs, CohortData, TrendDelta } from "@/lib/types";
import Sparkline from "./Sparkline";

function TrendBadge({ delta }: { delta: TrendDelta }) {
  if (delta.previous === 0 && delta.current === 0) {
    return <span className="text-[10px] text-[#5B6478] font-medium">—</span>;
  }
  const up = delta.pct >= 0;
  // Dashbrd X status pill — coloured bg, mono number, arrow glyph.
  const styles = up
    ? "text-[#10B981] bg-[#0F2A1F]"
    : "text-[#EF4444] bg-[#2A0F13]";
  const arrow = up ? "↑" : "↓";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums ${styles}`}
    >
      {arrow} {Math.abs(delta.pct).toFixed(1)}%
    </span>
  );
}

/**
 * One KPI cell inside the divided container. Big number + label + optional
 * sparkline. The container provides surrounding padding and dividers, so
 * the cell has no border/radius of its own — that's the whole point of the
 * pattern: 4 metrics in a single visual unit, separated by hairlines.
 */
function KPICell({
  label,
  icon,
  value,
  delta,
  sparklineData,
  sparklineColor,
}: {
  label: string;
  icon?: string;
  value: number;
  delta: TrendDelta;
  sparklineData: number[];
  sparklineColor: string;
}) {
  return (
    <div className="px-6 py-5 first:pl-7 last:pr-7">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[60px] leading-none font-bold text-white tracking-tight tabular-nums">
          {value.toLocaleString()}
        </p>
        <TrendBadge delta={delta} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[#8B92A3] font-medium flex items-center gap-1.5">
          {icon && <span className="text-[14px] leading-none">{icon}</span>}
          {label}
        </p>
        <Sparkline data={sparklineData} color={sparklineColor} width={64} height={24} />
      </div>
    </div>
  );
}

function RateCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "good" | "warn" | "bad";
}) {
  const styles = {
    good: "text-[#10B981]",
    warn: "text-[#F59E0B]",
    bad: "text-[#EF4444]",
  }[color];

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardContent className="px-5 py-4">
        <p className="text-[11px] font-semibold text-[#8B92A3] uppercase tracking-[0.06em]">
          {label}
        </p>
        <p className={`text-[28px] font-bold mt-1.5 tabular-nums tracking-tight ${styles}`}>
          {value.toFixed(1)}
          <span className="text-[18px] ml-0.5 opacity-70">%</span>
        </p>
      </CardContent>
    </Card>
  );
}

export default function KPICards({
  kpis,
  cohort,
}: {
  kpis: KPIs;
  cohort: CohortData;
}) {
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-[#8B92A3] leading-relaxed">
        <span className="text-[#1E6FFF] font-medium">Cohort-based.</span>{" "}
        Top row: counts of contacts whose <code className="text-[#C9D1DC]">createdate</code>{" "}
        falls in the window. Sparkline = daily trend; delta vs same-length prior
        period. Bottom row: cohort conversion rates from Qualified Signup → each
        stage. Excludes WIX/HOPPER partner referrals.
      </p>

      {/* Hero KPI row — divided container pattern. Four numbers share one
          rounded card with hairline dividers between cells. This is the
          signature look of the Dashbrd X moodboard. */}
      <div className="bg-[#11182B] border border-[#1F2937] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#1F2937]">
          <KPICell
            label="Qualified Signups"
            icon="📊"
            value={kpis.totalSignups}
            delta={kpis.deltas.signups}
            sparklineData={kpis.sparkline.signups}
            sparklineColor="#1E6FFF"
          />
          <KPICell
            label="Total Trials"
            icon="★"
            value={kpis.totalTrials}
            delta={kpis.deltas.trials}
            sparklineData={kpis.sparkline.trials}
            sparklineColor="#10B981"
          />
          <KPICell
            label="In Trial"
            icon="☆"
            value={kpis.totalInTrial}
            delta={kpis.deltas.inTrial}
            sparklineData={kpis.sparkline.inTrial}
            sparklineColor="#60A5FA"
          />
          <KPICell
            label="Total Customers"
            icon="★★"
            value={kpis.totalCustomers}
            delta={kpis.deltas.customers}
            sparklineData={kpis.sparkline.customers}
            sparklineColor="#1E6FFF"
          />
        </div>
      </div>

      {/* Conversion-rate cards — smaller, one per metric. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <RateCard
          label="QS → Ready"
          value={cohort.readyToLaunchRate}
          color={cohort.readyToLaunchRate > 20 ? "good" : cohort.readyToLaunchRate > 10 ? "warn" : "bad"}
        />
        <RateCard
          label="QS → Trial"
          value={cohort.trialRate}
          color={cohort.trialRate > 15 ? "good" : cohort.trialRate > 10 ? "warn" : "bad"}
        />
        <RateCard
          label="Trial → Customer"
          value={cohort.trialToCustomerRate}
          color={cohort.trialToCustomerRate > 40 ? "good" : cohort.trialToCustomerRate > 25 ? "warn" : "bad"}
        />
        <RateCard
          label="QS → Customer"
          value={cohort.customerRate}
          color={cohort.customerRate > 5 ? "good" : cohort.customerRate > 3 ? "warn" : "bad"}
        />
        <RateCard
          label="Churn Rate"
          value={kpis.churnRate}
          color={kpis.churnRate < 10 ? "good" : kpis.churnRate < 20 ? "warn" : "bad"}
        />
        <RateCard
          label="DQ Rate"
          value={kpis.dqRate}
          color={kpis.dqRate < 10 ? "good" : kpis.dqRate < 20 ? "warn" : "bad"}
        />
      </div>
    </div>
  );
}
