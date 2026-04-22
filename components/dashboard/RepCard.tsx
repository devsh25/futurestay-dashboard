"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RepRow } from "@/lib/types";

function RateBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const color =
    value > thresholds[0]
      ? "text-[#6EE7B7] bg-[#0F2A1F] border-[#6EE7B7]/20"
      : value > thresholds[1]
        ? "text-[#FBBF24] bg-[#2A1F0F] border-[#FBBF24]/20"
        : "text-[#F87171] bg-[#2A0F13] border-[#F87171]/20";
  return (
    <Badge variant="outline" className={`font-mono text-[11px] tabular-nums ${color}`}>
      {value.toFixed(1)}%
    </Badge>
  );
}

export default function RepCard({ reps }: { reps: RepRow[] }) {
  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold text-white tracking-tight">Rep Scorecard</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-[#1F1F28] hover:bg-transparent">
              {["Rep", "Contacts", "Trials", "In Trial", "Customers", "Contact-to-Trial", "Trial-to-Cust", "Contact-to-Cust"].map((h) => (
                <TableHead key={h} className={`text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold ${h !== "Rep" ? "text-right" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {reps.map((row) => (
              <TableRow key={row.rep} className="border-[#1F1F28] hover:bg-[#1A1A22] transition-colors">
                <TableCell className="font-medium text-[13px] text-white">{row.rep}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.contacts}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.trials}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#FBBF24]">{row.inTrial}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.customers}</TableCell>
                <TableCell className="text-right">
                  <RateBadge value={row.signupToTrial} thresholds={[10, 5]} />
                </TableCell>
                <TableCell className="text-right">
                  {row.trialToCustomer !== null ? (
                    <RateBadge value={row.trialToCustomer} thresholds={[50, 30]} />
                  ) : (
                    <span className="text-[12px] text-[#6B6B75]">\u2014</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <RateBadge value={row.contactToCustomer} thresholds={[5, 3]} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
