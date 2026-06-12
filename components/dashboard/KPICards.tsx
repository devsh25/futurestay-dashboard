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
  value,
  delta,
  sparklineData,
  sparklineColor,
  basis,
}: {
  label: string;
  value: number;
  delta: TrendDelta;
  sparklineData: number[];
  sparklineColor: string;
  // "cohort" = filtered by createdate in window
  // "period" = filtered by lifecycle-event date in window (trial/customer entry)
  basis: "cohort" | "period";
}) {
  // Tiny corner indicator so the basis is glanceable without reading the
  // methodology paragraph. Uses the same blue tone for both so it
  // doesn't fight the number — the letter alone signals which is which.
  const basisLabel = basis === "cohort" ? "C" : "P";
  const basisTitle = basis === "cohort"
    ? "Cohort-based: createdate in window"
    : "Period-based: lifecycle-event date in window";
  return (
    <div className="relative px-5 py-5 first:pl-6 last:pr-6">
      <span
        className="absolute top-2 right-3 text-[9px] font-semibold text-[#5B6478] uppercase tracking-wider tabular-nums select-none"
        title={basisTitle}
      >
        {basisLabel}
      </span>
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <p className="text-[44px] xl:text-[52px] leading-none font-bold text-white tracking-tight tabular-nums">
          {value.toLocaleString()}
        </p>
        <TrendBadge delta={delta} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-[#8B92A3] font-medium truncate">{label}</p>
        <Sparkline data={sparklineData} color={sparklineColor} width={56} height={22} />
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
  // Rate cards used to use green/amber/red. Pulled back to blue-spectrum
  // tones — readers still see relative health (bright blue = good, light
  // blue = mid, muted = poor) without three saturated hues fighting on
  // the same row. Status pills in the hero KPI row already carry the
  // green/red signal where it matters.
  const styles = {
    good: "text-white",
    warn: "text-[#60A5FA]",
    bad: "text-[#5B6478]",
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
        <span className="text-[#1E6FFF] font-medium">Mixed methodology — read carefully.</span>{" "}
        <span className="text-white">Total Signups</span> and{" "}
        <span className="text-white">Qualified Signups</span> are{" "}
        <span className="text-[#60A5FA]">cohort-based</span> — contacts whose{" "}
        <code className="text-[#C9D1DC]">createdate</code> falls in the window
        and whose lifecycle has reached signup. <span className="text-white">Total Trials</span>,{" "}
        <span className="text-white">In Trial</span>, and{" "}
        <span className="text-white">Total Customers</span> are{" "}
        <span className="text-[#60A5FA]">period-based</span> — contacts whose
        trial- or customer-entry date falls in the window, regardless of when
        they originally signed up. So a customer who signed up 60 days ago and
        converted today counts in Customers but not Signups for a 30-day view.
        Sparkline = daily trend; delta vs same-length prior period. The{" "}
        <span className="text-white">bottom row</span> ratios use the cohort path
        consistently — denominators are Qualified Signups in the window, so the
        % matches a clean signup-to-stage conversion. Excludes WIX/HOPPER partner
        referrals.
      </p>

      {/* Hero KPI row — divided container pattern. Five numbers share
          one rounded card with hairline dividers between cells. The
          first cell (Total Signups) includes DQ'd contacts; everything
          right of it filters them out. Bumped from 4-up to 5-up so the
          full top-of-funnel is visible at a glance. */}
      <div className="bg-[#11182B] border border-[#1F2937] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[#1F2937]">
          {/* All sparklines use the same blue tone — keeps the divided
              row looking like one cohesive band rather than 5 different
              colour stories. The numbers themselves carry the meaning. */}
          <KPICell
            label="Total Signups"
            value={kpis.totalRawSignups}
            delta={kpis.deltas.rawSignups}
            sparklineData={kpis.sparkline.rawSignups}
            sparklineColor="#1E6FFF"
            basis="cohort"
          />
          <KPICell
            label="Qualified Signups"
            value={kpis.totalSignups}
            delta={kpis.deltas.signups}
            sparklineData={kpis.sparkline.signups}
            sparklineColor="#1E6FFF"
            basis="cohort"
          />
          <KPICell
            label="Total Trials"
            value={kpis.totalTrials}
            delta={kpis.deltas.trials}
            sparklineData={kpis.sparkline.trials}
            sparklineColor="#1E6FFF"
            basis="period"
          />
          <KPICell
            label="In Trial"
            value={kpis.totalInTrial}
            delta={kpis.deltas.inTrial}
            sparklineData={kpis.sparkline.inTrial}
            sparklineColor="#1E6FFF"
            basis="period"
          />
          <KPICell
            label="Total Customers"
            value={kpis.totalCustomers}
            delta={kpis.deltas.customers}
            sparklineData={kpis.sparkline.customers}
            sparklineColor="#1E6FFF"
            basis="period"
          />
        </div>
      </div>

      {/* Conversion-rate cards — smaller, one per metric. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
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
        <RateCard
          label="Airbnb DQ Rate"
          value={kpis.airbnbDqRate}
          color={kpis.airbnbDqRate < 10 ? "good" : kpis.airbnbDqRate < 20 ? "warn" : "bad"}
        />
      </div>
    </div>
  );
}
