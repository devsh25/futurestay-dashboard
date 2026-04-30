"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { DQWeekly } from "@/lib/types";

const COLORS = {
  UNSUPPORTED_COUNTRY: "#F87171",
  INCOMPLETE_ADDRESS: "#FBBF24",
  NO_PUBLISHED_LISTINGS_FOUND: "#1E6FFF",
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
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold text-white tracking-tight">Airbnb DQ Reasons (Weekly)</CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Period-based, weekly.</span>{" "}
          Counts of <code className="text-[#C9C9D1]">airbnbdqreason</code> values bucketed by signup week. Includes only DQ&apos;d contacts (auto-disqualified at the Airbnb step).
        </p>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <p className="text-sm text-[#8B92A3] py-8 text-center">No DQ data for this period.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: -10 }}>
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 10, fill: "#8B92A3" }}
                  axisLine={{ stroke: "#1F2937" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#5B6478" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(167, 139, 250, 0.08)" }}
                  contentStyle={{
                    backgroundColor: "#0E1422",
                    borderRadius: 10,
                    border: "1px solid #1F2937",
                    fontSize: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    padding: "8px 12px",
                    color: "#FFFFFF",
                  }}
                  labelStyle={{ color: "#FFFFFF" }}
                  itemStyle={{ color: "#C9D1DC" }}
                  formatter={(value, name) => [value, LABELS[name as string] || name]}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(value) => <span className="text-[10px] text-[#8B92A3]">{LABELS[value] || value}</span>}
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
