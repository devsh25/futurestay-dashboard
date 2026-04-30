"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CampaignRow } from "@/lib/types";

type CampaignType = "All" | "Airbnb" | "Direct Booking" | "Other";

function getCampaignType(campaign: string): "Airbnb" | "Direct Booking" | "Other" {
  const lower = campaign.toLowerCase();
  if (lower.includes("airbnb") || lower.includes("listing optimization") || lower.includes("listing review")) return "Airbnb";
  if (lower.includes("direct") || lower.includes("booking") || lower.includes("website")) return "Direct Booking";
  return "Other";
}

const TYPE_STYLES = {
  Airbnb: "bg-[#2A1F0F] text-[#FBBF24] border-[#FBBF24]/20",
  "Direct Booking": "bg-[#1A1F2A] text-[#60A5FA] border-[#60A5FA]/20",
  Other: "bg-[#1F2937] text-[#8B92A3] border-[#1F2937]",
};

const FILTER_BUTTONS: { value: CampaignType; label: string }[] = [
  { value: "All", label: "All" },
  { value: "Direct Booking", label: "DBW" },
  { value: "Airbnb", label: "Airbnb" },
];

export default function CampaignCard({ campaigns }: { campaigns: CampaignRow[] }) {
  const [typeFilter, setTypeFilter] = useState<CampaignType>("All");
  const filtered = campaigns.filter((c) => {
    if (c.signups <= 0) return false;
    if (typeFilter === "All") return true;
    return getCampaignType(c.campaign) === typeFilter;
  });

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Paid Campaign Performance</span>
          <div className="flex gap-1">
            {FILTER_BUTTONS.map((btn) => (
              <button
                key={btn.value}
                onClick={() => setTypeFilter(btn.value)}
                className={`px-3 py-1 text-[11px] font-medium rounded-full border transition-all ${
                  typeFilter === btn.value
                    ? "bg-[#1E6FFF] text-[#0A0F1A] border-[#1E6FFF]"
                    : "bg-transparent text-[#8B92A3] border-[#1F2937] hover:border-[#1E6FFF]/40 hover:text-white"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-[#1F2937] hover:bg-transparent">
              {["Type", "Campaign", "Source", "Qual. Signups", "Trials", "In Trial", "Cust", "QS-to-T", "QS-to-C"].map((h) => (
                <TableHead key={h} className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold ${h !== "Type" && h !== "Campaign" && h !== "Source" ? "text-right" : h === "Source" ? "text-center" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-[#8B92A3] py-8 text-sm">No campaigns match this filter</TableCell></TableRow>
            ) : (
              filtered.map((row) => {
                const type = getCampaignType(row.campaign);
                const stc = row.signups > 0 ? (row.customers / row.signups) * 100 : 0;
                return (
                  <TableRow key={row.campaign} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-medium ${TYPE_STYLES[type]}`}>
                        {type === "Direct Booking" ? "DBW" : type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-[13px] text-white">{row.campaign}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`text-[10px] font-medium ${row.source.includes("facebook") ? "border-[#60A5FA]/30 text-[#60A5FA] bg-[#1A1F2A]" : "border-[#6EE7B7]/30 text-[#6EE7B7] bg-[#0F2A1F]"}`}>
                        {row.source.includes("facebook") ? "FB" : row.source.includes("google") ? "Google" : row.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.signups}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.trials}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#FBBF24]">{row.inTrial}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.customers}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#8B92A3]">{row.signupToTrial.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#8B92A3]">{stc.toFixed(1)}%</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
