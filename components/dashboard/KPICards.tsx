"use client";

import { Card, CardContent } from "@/components/ui/card";
import { KPIs, CohortData } from "@/lib/types";

function KPICard({
  label,
  value,
  format = "percent",
  color,
  size = "normal",
}: {
  label: string;
  value: number;
  format?: "percent" | "number";
  color?: "blue" | "teal" | "green" | "amber" | "red" | "gray";
  size?: "normal" | "large";
}) {
  const styles = {
    blue: "text-[#3863E6]",
    teal: "text-[#0F5955]",
    green: "text-[#079289]",
    amber: "text-[#999258]",
    red: "text-[#801F50]",
    gray: "text-[#111111]",
  }[color || "gray"];

  return (
    <Card className="border-[#E8EAF0] shadow-sm">
      <CardContent className="pt-4 pb-3 px-5">
        <p className="text-[11px] font-semibold text-[#656C74] uppercase tracking-wider">
          {label}
        </p>
        <p className={`${size === "large" ? "text-3xl" : "text-xl"} font-bold mt-0.5 ${styles}`}>
          {format === "percent" ? `${value.toFixed(1)}%` : value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

export default function KPICards({ kpis, cohort }: { kpis: KPIs; cohort: CohortData }) {
  return (
    <div className="space-y-4">
      {/* Row 1: Core health numbers (period-based) */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Qualified Signups" value={kpis.totalSignups} format="number" color="blue" size="large" />
        <KPICard label="Total Trials" value={kpis.totalTrials} format="number" color="teal" size="large" />
        <KPICard label="In Trial" value={kpis.totalInTrial} format="number" color="amber" size="large" />
        <KPICard label="Total Customers" value={kpis.totalCustomers} format="number" color="green" size="large" />
      </div>

      {/* Row 2: Cohort conversion rates + DQ */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          label="Qualified Signup to Trial (Cohort)"
          value={cohort.trialRate}
          color={cohort.trialRate > 15 ? "green" : cohort.trialRate > 10 ? "amber" : "red"}
        />
        <KPICard
          label="Trial to Customer (Cohort)"
          value={cohort.trialToCustomerRate}
          color={cohort.trialToCustomerRate > 40 ? "green" : cohort.trialToCustomerRate > 25 ? "amber" : "red"}
        />
        <KPICard
          label="Qualified Signup to Customer (Cohort)"
          value={cohort.customerRate}
          color={cohort.customerRate > 5 ? "green" : cohort.customerRate > 3 ? "amber" : "red"}
        />
        <KPICard
          label="AirbnbDQ Rate"
          value={kpis.dqRate}
          color={kpis.dqRate < 10 ? "green" : kpis.dqRate < 20 ? "amber" : "red"}
        />
      </div>
    </div>
  );
}
