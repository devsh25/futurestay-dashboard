"use client";

import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GeoRow } from "@/lib/types";

function pct(num: number, denom: number): string {
  return denom > 0 ? `${((num / denom) * 100).toFixed(1)}%` : "—";
}

export default function GeoCard({ geo }: { geo: GeoRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const topGeo = geo.slice(0, 15);

  return (
    <Card className="border-[#E8EAF0] shadow-[0_1px_3px_rgba(17,17,17,0.04)] rounded-2xl hover:shadow-[0_4px_12px_rgba(17,17,17,0.08)] transition-shadow duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px] font-semibold text-[#111111] tracking-tight">Country & City Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-[#E8EAF0]">
              {["Country", "Qual. Signups", "Auth", "Props", "Launch", "Trial", "In Trial", "Cust", "QS-to-C", "QS-to-T", "T-to-C"].map((h) => (
                <TableHead key={h} className={`text-[11px] uppercase tracking-wider text-[#656C74] font-semibold ${h !== "Country" ? "text-right" : ""}`}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {topGeo.map((row) => (
              <Fragment key={row.country}>
                <TableRow
                  className="border-[#E8EAF0] cursor-pointer hover:bg-[#F1F4FF]/50 transition-colors"
                  onClick={() => setExpanded(expanded === row.country ? null : row.country)}
                >
                  <TableCell className="font-medium text-[13px] text-[#111111]">
                    <span className="mr-1.5 text-[#656C74]">{expanded === row.country ? "▼" : "▶"}</span>
                    {row.country}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{row.signups}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{row.authorized}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{row.createdProperties}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{row.clickedLaunch}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{row.trials}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] text-[#999258]">{row.inTrial}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{row.customers}</TableCell>
                  <TableCell className="text-right font-mono text-[13px] font-semibold text-[#3863E6]">{pct(row.customers, row.signups)}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{pct(row.trials, row.signups)}</TableCell>
                  <TableCell className="text-right font-mono text-[13px]">{pct(row.customers, row.trials)}</TableCell>
                </TableRow>
                {expanded === row.country &&
                  row.cities.map((city) => (
                    <TableRow key={`${row.country}-${city.city}`} className="bg-[#F3F6FA]/60 border-[#E8EAF0]">
                      <TableCell className="pl-9 text-[12px] text-[#656C74]">{city.city}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#656C74]">{city.signups}</TableCell>
                      <TableCell className="text-right text-[12px] text-[#B0B7BF]">—</TableCell>
                      <TableCell className="text-right text-[12px] text-[#B0B7BF]">—</TableCell>
                      <TableCell className="text-right text-[12px] text-[#B0B7BF]">—</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#656C74]">{city.trials}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#999258]">{city.inTrial}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#656C74]">{city.customers}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#656C74]">{pct(city.customers, city.signups)}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#656C74]">{pct(city.trials, city.signups)}</TableCell>
                      <TableCell className="text-right font-mono text-[12px] text-[#656C74]">{pct(city.customers, city.trials)}</TableCell>
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
