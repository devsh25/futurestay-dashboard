"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { DQWeekly } from "@/lib/types";

const COLORS = {
  UNSUPPORTED_COUNTRY: "#801F50",
  INCOMPLETE_ADDRESS: "#999258",
  NO_PUBLISHED_LISTINGS_FOUND: "#3863E6",
  UNPUBLISHED_LISTING: "#543CE8",
  OTHER: "#B0B7BF",
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
    <Card className="border-[#E8EAF0] shadow-[0_1px_3px_rgba(17,17,17,0.04)] rounded-2xl hover:shadow-[0_4px_12px_rgba(17,17,17,0.08)] transition-shadow duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px] font-semibold text-[#111111] tracking-tight">Airbnb DQ Reasons (Weekly)</CardTitle>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <p className="text-sm text-[#656C74] py-8 text-center">No DQ data for this period.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: -10 }}>
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 10, fill: "#656C74" }}
                  axisLine={{ stroke: "#E8EAF0" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#B0B7BF" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "#F3F6FA" }}
                  contentStyle={{
                    borderRadius: 10, border: "1px solid #E8EAF0", fontSize: 12,
                    boxShadow: "0 4px 12px rgba(17,17,17,0.08)", padding: "8px 12px",
                  }}
                  formatter={(value, name) => [value, LABELS[name as string] || name]}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(value) => <span className="text-[10px] text-[#656C74]">{LABELS[value] || value}</span>}
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
