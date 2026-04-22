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
  Airbnb: "bg-[#FBFAED] text-[#999258] border-[#999258]/30",
  "Direct Booking": "bg-[#F1F4FF] text-[#3863E6] border-[#3863E6]/30",
  Other: "bg-[#F3F6FA] text-[#656C74] border-[#E8EAF0]",
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
    <Card className="border-[#E8EAF0] shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-bold text-[#111111]">
          <span>Paid Campaign Performance</span>
          <div className="flex gap-1">
            {FILTER_BUTTONS.map((btn) => (
              <button
                key={btn.value}
                onClick={() => setTypeFilter(btn.value)}
                className={`px-3 py-1 text-[11px] font-medium rounded-full border transition-all ${
                  typeFilter === btn.value
                    ? "bg-[#3863E6] text-white border-[#3863E6]"
                    : "bg-white text-[#656C74] border-[#E8EAF0] hover:border-[#3863E6]/40"
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
            <TableRow className="border-[#E8EAF0]">
              {["Type", "Campaign", "Source", "Qual. Signups", "Trials", "In Trial", "Cust", "QS-to-T", "QS-to-C"].map((h) => (
                <TableHead key={h} className={`text-[11px] uppercase tracking-wider text-[#656C74] font-semibold ${h !== "Type" && h !== "Campaign" && h !== "Source" ? "text-right" : h === "Source" ? "text-center" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-[#656C74] py-8 text-sm">No campaigns match this filter</TableCell></TableRow>
            ) : (
              filtered.map((row) => {
                const type = getCampaignType(row.campaign);
                const stc = row.signups > 0 ? (row.customers / row.signups) * 100 : 0;
                return (
                  <TableRow key={row.campaign} className="border-[#E8EAF0]">
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-medium ${TYPE_STYLES[type]}`}>
                        {type === "Direct Booking" ? "DBW" : type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-[13px] text-[#111111]">{row.campaign}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`text-[10px] font-medium ${row.source.includes("facebook") ? "border-[#3863E6]/30 text-[#3863E6] bg-[#F1F4FF]" : "border-[#0F5955]/30 text-[#0F5955] bg-[#EDFBF8]"}`}>
                        {row.source.includes("facebook") ? "FB" : row.source.includes("google") ? "Google" : row.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{row.signups}</TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{row.trials}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] text-[#999258]">{row.inTrial}</TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{row.customers}</TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{row.signupToTrial.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{stc.toFixed(1)}%</TableCell>
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
