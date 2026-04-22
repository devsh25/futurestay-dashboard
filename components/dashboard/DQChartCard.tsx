"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { DQWeekly } from "@/lib/types";

const COLORS = {
  UNSUPPORTED_COUNTRY: "#F87171",
  INCOMPLETE_ADDRESS: "#FBBF24",
  NO_PUBLISHED_LISTINGS_FOUND: "#A78BFA",
  UNPUBLISHED_LISTING: "#60A5FA",
  OTHER: "#4B5563",
};

const LABELS: Record<string, string> = {
  UNSUPPORTED_COUNTRY: "Unsupported Country",
  INCOMPLETE_ADDRESS: "Incomplete Address",
  NO_PUBLISHED_LISTINGS_FOUND: "No Published Listings",
  UNPUBLISHED_LISTING: "Unpublished Listing",
  OTHER: "Other",
};

export default function DQChartCard({ data }: { data: DQWeekly[] }) {
  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold text-white tracking-tight">Airbnb DQ Reasons (Weekly)</CardTitle>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <p className="text-sm text-[#8A8A94] py-8 text-center">No DQ data for this period.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: -10 }}>
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 10, fill: "#8A8A94" }}
                  axisLine={{ stroke: "#2A2A32" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#6B6B75" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(167, 139, 250, 0.08)" }}
                  contentStyle={{
                    backgroundColor: "#1A1A22",
                    borderRadius: 10,
                    border: "1px solid #2A2A32",
                    fontSize: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    padding: "8px 12px",
                    color: "#FFFFFF",
                  }}
                  labelStyle={{ color: "#FFFFFF" }}
                  itemStyle={{ color: "#E5E5EB" }}
                  formatter={(value, name) => [value, LABELS[name as string] || name]}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(value) => <span className="text-[10px] text-[#8A8A94]">{LABELS[value] || value}</span>}
                />
                <Bar dataKey="UNSUPPORTED_COUNTRY" stackId="a" fill={COLORS.UNSUPPORTED_COUNTRY} />
                <Bar dataKey="INCOMPLETE_ADDRESS" stackId="a" fill={COLORS.INCOMPLETE_ADDRESS} />
                <Bar dataKey="NO_PUBLISHED_LISTINGS_FOUND" stackId="a" fill={COLORS.NO_PUBLISHED_LISTINGS_FOUND} />
                <Bar dataKey="UNPUBLISHED_LISTING" stackId="a" fill={COLORS.UNPUBLISHED_LISTING} radius={[6, 6, 0, 0]} />
                <Bar dataKey="OTHER" stackId="a" fill={COLORS.OTHER} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
