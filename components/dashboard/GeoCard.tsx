"use client";

import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GeoRow } from "@/lib/types";

function pct(num: number, denom: number): string {
  return denom > 0 ? `${((num / denom) * 100).toFixed(1)}%` : "\u2014";
}

export default function GeoCard({ geo }: { geo: GeoRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const topGeo = geo.slice(0, 15);

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold text-white tracking-tight">Country & City Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-[#1F1F28] hover:bg-transparent">
              {["Country", "Qual. Signups", "Auth", "Props", "Launch", "Trial", "In Trial", "Cust", "QS-to-C", "QS-to-T", "T-to-C"].map((h) => (
                <TableHead key={h} className={`text-[10px] uppercase tracking-wider text-[#8A8A94] font-semibold ${h !== "Country" ? "text-right" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {topGeo.map((row) => (
              <Fragment key={row.country}>
                <TableRow
                  className="border-[#1F1F28] cursor-pointer hover:bg-[#1A1A22] transition-colors"
                  onClick={() => setExpanded(expanded === row.country ? null : row.country)}
                >
                  <TableCell className="font-medium text-[13px] text-white">
                    <span className="mr-1.5 text-[#6B6B75]">{expanded === row.country ? "\u25BC" : "\u25B6"}</span>
                    {row.country}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.signups}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#E5E5EB]">{row.authorized}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#E5E5EB]">{row.createdProperties}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#E5E5EB]">{row.clickedLaunch}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#E5E5EB]">{row.trials}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#FBBF24]">{row.inTrial}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-white">{row.customers}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums font-semibold text-[#A78BFA]">{pct(row.customers, row.signups)}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#8A8A94]">{pct(row.trials, row.signups)}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-[#8A8A94]">{pct(row.customers, row.trials)}</TableCell>
                </TableRow>
                {expanded === row.country &&
                  row.cities.map((city) => (
                    <TableRow key={`${row.country}-${city.city}`} className="bg-[#0F0F14] border-[#1F1F28]">
                      <TableCell className="pl-9 text-[12px] text-[#8A8A94]">{city.city}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{city.signups}</TableCell>
                      <TableCell className="text-right text-[12px] text-[#6B6B75]">\u2014</TableCell>
                      <TableCell className="text-right text-[12px] text-[#6B6B75]">\u2014</TableCell>
                      <TableCell className="text-right text-[12px] text-[#6B6B75]">\u2014</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{city.trials}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#FBBF24]">{city.inTrial}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{city.customers}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{pct(city.customers, city.signups)}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{pct(city.trials, city.signups)}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8A8A94]">{pct(city.customers, city.trials)}</TableCell>
                    </TableRow>
                  ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
