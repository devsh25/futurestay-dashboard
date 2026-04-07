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
    <Card className="border-[#E8EAF0] shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-[#111111]">Airbnb DQ Reasons (Weekly)</CardTitle>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <p className="text-sm text-[#656C74] py-8 text-center">No DQ data for this period.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#656C74" }} />
                <YAxis tick={{ fontSize: 11, fill: "#656C74" }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #E8EAF0", fontSize: 12 }}
                  formatter={(value, name) => [value, LABELS[name as string] || name]}
                />
                <Legend formatter={(value) => <span className="text-[10px] text-[#656C74]">{LABELS[value] || value}</span>} />
                <Bar dataKey="UNSUPPORTED_COUNTRY" stackId="a" fill={COLORS.UNSUPPORTED_COUNTRY} radius={[0, 0, 0, 0]} />
                <Bar dataKey="INCOMPLETE_ADDRESS" stackId="a" fill={COLORS.INCOMPLETE_ADDRESS} />
                <Bar dataKey="NO_PUBLISHED_LISTINGS_FOUND" stackId="a" fill={COLORS.NO_PUBLISHED_LISTINGS_FOUND} />
                <Bar dataKey="UNPUBLISHED_LISTING" stackId="a" fill={COLORS.UNPUBLISHED_LISTING} radius={[3, 3, 0, 0]} />
                <Bar dataKey="OTHER" stackId="a" fill={COLORS.OTHER} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
