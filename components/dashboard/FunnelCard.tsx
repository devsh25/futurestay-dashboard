"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FunnelStage } from "@/lib/types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#3863E6", "#4974E8", "#543CE8", "#0F5955", "#079289", "#1BB8CD"];

export default function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  const dqRow = funnel.find((f) => f.name === "AirbnbDQ");
  const mainFunnel = funnel.filter((f) => f.name !== "AirbnbDQ");
  const chartData = mainFunnel.map((s) => ({
    name: s.name.replace("Authorized ", "Auth ").replace("Created ", "").replace("Properties", "Props").replace("Clicked ", ""),
    count: s.count,
  }));

  return (
    <Card className="border-[#E8EAF0] shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-bold text-[#111111]">
          <span>Funnel Analysis</span>
          {dqRow && (
            <Badge className="bg-[#FFC5E3]/30 text-[#801F50] border-[#801F50]/20 text-[10px] font-medium">
              AirbnbDQ: {dqRow.count} ({dqRow.dropoff?.toFixed(1)}%)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" barCategoryGap="20%">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fill: "#656C74" }} />
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString(), "Count"]}
                contentStyle={{ borderRadius: 8, border: "1px solid #E8EAF0", fontSize: 12 }}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-[#E8EAF0]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Stage</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Count</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Lost</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wider text-[#656C74] font-semibold">Dropoff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mainFunnel.map((stage) => (
              <TableRow key={stage.name} className="border-[#E8EAF0]">
                <TableCell className="font-medium text-[13px] text-[#111111]">
                  {stage.name === "Trial Started" ? "★ " + stage.name
                    : stage.name === "In Trial" ? "☆ " + stage.name
                    : stage.name === "Customer" ? "★★ " + stage.name
                    : stage.name}
                </TableCell>
                <TableCell className="text-right font-mono text-[13px]">{stage.count.toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-[13px] text-[#656C74]">
                  {stage.lost !== null && stage.lost >= 0 ? `-${stage.lost}` : stage.lost !== null ? `+${Math.abs(stage.lost)}` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {stage.dropoff !== null && stage.dropoff >= 0 ? (
                    <Badge variant="outline" className={`font-mono text-[11px] ${stage.dropoff > 50 ? "border-[#801F50] text-[#801F50] bg-[#FFC5E3]/10" : "border-[#E8EAF0] text-[#656C74]"}`}>
                      {stage.dropoff.toFixed(0)}%
                    </Badge>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
