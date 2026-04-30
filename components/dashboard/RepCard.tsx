"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RepRow } from "@/lib/types";

function RateBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  // Same 2-tone restraint as CohortCard. Healthy = white text on subtle
  // bg; mid = light blue; low = muted slate. No amber, no red.
  const color =
    value > thresholds[0]
      ? "text-white bg-[#1A2235] border-[#1F2937]"
      : value > thresholds[1]
        ? "text-[#60A5FA] bg-[#0F1E2E] border-[#1F2937]"
        : "text-[#5B6478] bg-[#11182B] border-[#1F2937]";
  return (
    <Badge variant="outline" className={`font-mono text-[11px] tabular-nums ${color}`}>
      {value.toFixed(1)}%
    </Badge>
  );
}

export default function RepCard({ reps }: { reps: RepRow[] }) {
  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold text-white tracking-tight">Rep Scorecard</CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Cohort-based.</span>{" "}
          Contacts assigned to each rep (via <code className="text-[#C9C9D1]">hubspot_owner_id</code>) whose <code className="text-[#C9C9D1]">createdate</code> falls in the selected window. Trial / customer rates count outcomes from that cohort.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-[#1F2937] hover:bg-transparent">
              {["Rep", "Contacts", "Trials", "In Trial", "Customers", "Contact-to-Trial", "Trial-to-Cust", "Contact-to-Cust"].map((h) => (
                <TableHead key={h} className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold ${h !== "Rep" ? "text-right" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {reps.map((row) => (
              <TableRow key={row.rep} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                <TableCell className="font-medium text-[13px] text-white">{row.rep}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.contacts}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.trials}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#8B92A3]">{row.inTrial}</TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.customers}</TableCell>
                <TableCell className="text-right">
                  <RateBadge value={row.signupToTrial} thresholds={[10, 5]} />
                </TableCell>
                <TableCell className="text-right">
                  {row.trialToCustomer !== null ? (
                    <RateBadge value={row.trialToCustomer} thresholds={[50, 30]} />
                  ) : (
                    <span className="text-[12px] text-[#5B6478]">—</span>
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
