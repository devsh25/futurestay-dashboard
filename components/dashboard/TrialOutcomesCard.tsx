"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrialOutcomes } from "@/lib/types";

const SEGMENTS: {
  key: keyof Omit<TrialOutcomes, "total">;
  label: string;
  color: string;
  dot: string;
  description: string;
}[] = [
  {
    key: "inTrial",
    label: "Still In Trial",
    color: "bg-[#FB923C]",
    dot: "bg-[#FB923C]",
    description: "Currently active trialists",
  },
  {
    key: "customer",
    label: "Became Customer",
    color: "bg-[#6EE7B7]",
    dot: "bg-[#6EE7B7]",
    description: "Real paid customer (≥2 days)",
  },
  {
    key: "limitedAccess",
    label: "Limited Access",
    color: "bg-[#60A5FA]",
    dot: "bg-[#60A5FA]",
    description: "Cancelled but keeps bookings access",
  },
  {
    key: "churned",
    label: "Churned",
    color: "bg-[#F87171]",
    dot: "bg-[#F87171]",
    description: "Was customer ≥2 days then cancelled",
  },
  {
    key: "failedTrialist",
    label: "Failed Trialist",
    color: "bg-[#A78BFA]",
    dot: "bg-[#A78BFA]",
    description: "Cancelled trial before real conversion",
  },
  {
    key: "reverted",
    label: "Reverted / Other",
    color: "bg-[#6B6B75]",
    dot: "bg-[#6B6B75]",
    description: "Dropped back to signup or unknown",
  },
];

export default function TrialOutcomesCard({ outcomes }: { outcomes: TrialOutcomes }) {
  const total = outcomes.total || 1;

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Trial Outcomes</span>
          <Badge className="bg-[#6EE7B7]/15 text-[#6EE7B7] border-[#6EE7B7]/25 text-[10px] font-medium">
            Where trialists ended up
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[12px] text-[#8A8A94] mb-3">
          Of {outcomes.total.toLocaleString()} people who entered trial in this period,
          where are they now?
        </p>

        {/* Stacked bar */}
        <div className="h-8 w-full rounded-lg overflow-hidden flex bg-[#1F1F28] mb-4">
          {SEGMENTS.map((seg) => {
            const count = outcomes[seg.key];
            const pct = (count / total) * 100;
            if (count === 0) return null;
            return (
              <div
                key={seg.key}
                className={`${seg.color} h-full transition-all`}
                style={{ width: `${pct}%` }}
                title={`${seg.label}: ${count} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>

        {/* Legend with counts */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {SEGMENTS.map((seg) => {
            const count = outcomes[seg.key];
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={seg.key} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${seg.dot}`} />
                  <p className="text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold">
                    {seg.label}
                  </p>
                </div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {count.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6B6B75]">
                  {pct.toFixed(1)}% • {seg.description}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
