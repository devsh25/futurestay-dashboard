"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FunnelStage } from "@/lib/types";

const COLORS = ["#3863E6", "#4974E8", "#543CE8", "#0F5955", "#079289", "#1BB8CD"];

export default function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  const dqRow = funnel.find((f) => f.name === "AirbnbDQ");
  const mainFunnel = funnel.filter((f) => f.name !== "AirbnbDQ");
  const maxCount = mainFunnel[0]?.count || 1;

  return (
    <Card className="border-[#E8EAF0] shadow-[0_1px_3px_rgba(17,17,17,0.04)] rounded-2xl hover:shadow-[0_4px_12px_rgba(17,17,17,0.08)] transition-shadow duration-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-[#111111] tracking-tight">
          <span>Funnel Analysis</span>
          {dqRow && (
            <Badge className="bg-[#FFC5E3]/30 text-[#801F50] border-[#801F50]/20 text-[10px] font-medium">
              AirbnbDQ: {dqRow.count} ({dqRow.dropoff?.toFixed(1)}%)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Trapezoid funnel visualization */}
        <div className="mb-5 space-y-1 px-2">
          {mainFunnel.map((stage, i) => {
            const widthPct = Math.max(14, (stage.count / maxCount) * 100);
            const color = COLORS[i % COLORS.length];
            const label =
              stage.name === "Trial Started"
                ? "★ Trial Started"
                : stage.name === "In Trial"
                  ? "☆ In Trial"
                  : stage.name === "Customer"
                    ? "★★ Customer"
                    : stage.name;
            const isLast = i === mainFunnel.length - 1;

            return (
              <div key={stage.name} className="flex items-center gap-3">
                {/* Label column */}
                <div className="w-32 flex-shrink-0">
                  <p className="text-[12px] font-medium text-[#111111] tracking-tight truncate">
                    {label}
                  </p>
                </div>
                {/* Funnel segment */}
                <div className="flex-1 flex items-center gap-3">
                  <div
                    className="h-8 rounded-md flex items-center justify-center transition-all duration-300"
                    style={{
                      width: `${widthPct}%`,
                      background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                      clipPath: isLast
                        ? undefined
                        : i === 0
                          ? "polygon(0 0, 100% 0, 98% 100%, 2% 100%)"
                          : "polygon(2% 0, 98% 0, 96% 100%, 4% 100%)",
                    }}
                  >
                    <span className="text-white text-[11px] font-semibold">
                      {stage.count.toLocaleString()}
                    </span>
                  </div>
                  {stage.dropoff !== null && stage.dropoff >= 0 && stage.dropoff > 0 && (
                    <span className={`text-[10px] font-semibold whitespace-nowrap ${stage.dropoff > 50 ? "text-[#801F50]" : "text-[#656C74]"}`}>
                      −{stage.dropoff.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail table */}
        <Table>
          <TableHeader>
            <TableRow className="border-[#E8EAF0]">
              <TableHead className="text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">Stage</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">Count</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">Lost</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-wider text-[#656C74] font-semibold">Dropoff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mainFunnel.map((stage) => (
              <TableRow key={stage.name} className="border-[#E8EAF0] hover:bg-[#F3F6FA]/50 transition-colors">
                <TableCell className="font-medium text-[13px] text-[#111111]">
                  {stage.name === "Trial Started" ? "★ " + stage.name
                    : stage.name === "In Trial" ? "☆ " + stage.name
                    : stage.name === "Customer" ? "★★ " + stage.name
                    : stage.name}
                </TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums">{stage.count.toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-[13px] text-[#656C74] tabular-nums">
                  {stage.lost !== null && stage.lost >= 0 ? `-${stage.lost}` : stage.lost !== null ? `+${Math.abs(stage.lost)}` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {stage.dropoff !== null && stage.dropoff >= 0 ? (
                    <Badge variant="outline" className={`font-mono text-[11px] tabular-nums ${stage.dropoff > 50 ? "border-[#801F50] text-[#801F50] bg-[#FFC5E3]/10" : "border-[#E8EAF0] text-[#656C74]"}`}>
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
