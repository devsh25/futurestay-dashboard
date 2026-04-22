"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RepRow } from "@/lib/types";

function RateBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const color =
    value > thresholds[0]
      ? "border-[#079289]/30 text-[#0F5955] bg-[#EDFBF8]"
      : value > thresholds[1]
        ? "border-[#999258]/30 text-[#999258] bg-[#FBFAED]"
        : "border-[#801F50]/30 text-[#801F50] bg-[#FFC5E3]/10";
  return (
    <Badge variant="outline" className={`font-mono text-[11px] ${color}`}>
      {value.toFixed(1)}%
    </Badge>
  );
}

export default function RepCard({ reps }: { reps: RepRow[] }) {
  return (
    <Card className="border-[#E8EAF0] shadow-[0_1px_3px_rgba(17,17,17,0.04)] rounded-2xl hover:shadow-[0_4px_12px_rgba(17,17,17,0.08)] transition-shadow duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px] font-semibold text-[#111111] tracking-tight">Rep Scorecard</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-[#E8EAF0]">
              {["Rep", "Contacts", "Trials", "In Trial", "Customers", "Contact-to-Trial", "Trial-to-Cust", "Contact-to-Cust"].map((h) => (
                <TableHead key={h} className={`text-[11px] uppercase tracking-wider text-[#656C74] font-semibold ${h !== "Rep" ? "text-right" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {reps.map((row) => (
              <TableRow key={row.rep} className="border-[#E8EAF0]">
                <TableCell className="font-medium text-[13px] text-[#111111]">{row.rep}</TableCell>
                <TableCell className="text-right font-mono text-[13px]">{row.contacts}</TableCell>
                <TableCell className="text-right font-mono text-[13px]">{row.trials}</TableCell>
                <TableCell className="text-right font-mono text-[13px] text-[#999258]">{row.inTrial}</TableCell>
                <TableCell className="text-right font-mono text-[13px]">{row.customers}</TableCell>
                <TableCell className="text-right">
                  <RateBadge value={row.signupToTrial} thresholds={[10, 5]} />
                </TableCell>
                <TableCell className="text-right">
                  {row.trialToCustomer !== null ? (
                    <RateBadge value={row.trialToCustomer} thresholds={[50, 30]} />
                  ) : (
                    <span className="text-[12px] text-[#B0B7BF]">—</span>
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
