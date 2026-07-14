"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdHealthData, WindowMetrics, AssetChannel, CampaignChannel } from "./AdHealthSignalsCard";

function fmtQRT(w: WindowMetrics): string { return `${w.qualified} → ${w.rtl} → ${w.trials}`; }
function pct(w: WindowMetrics): number { return w.rtl > 0 ? (w.trials / w.rtl) * 100 : 0; }
function pctClass(p: number): string {
  if (p >= 40) return "text-[#10B981]";
  if (p >= 20) return "text-[#F59E0B]";
  return "text-[#F87171]";
}
function trendArrow(d14pct: number, d7pct: number): { arrow: string; color: string } {
  const diff = d7pct - d14pct;
  if (diff >= 3) return { arrow: "▲", color: "#10B981" };
  if (diff <= -3) return { arrow: "▼", color: "#F87171" };
  return { arrow: "→", color: "#5B6478" };
}
function channelPill(ch: AssetChannel | CampaignChannel) {
  const cls =
    ch === "Meta"   ? "text-[#A78BFA] bg-[#A78BFA]/15 border-[#A78BFA]/30" :
    ch === "Google" ? "text-[#60A5FA] bg-[#60A5FA]/15 border-[#60A5FA]/30" :
                       "text-[#8B92A3] bg-[#1F2937] border-[#1F2937]";
  return `inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`;
}

export default function AdHealthDetailCard({
  data, activeWindow, onWindowChange,
}: {
  data: AdHealthData | null;
  activeWindow: "7d" | "14d";
  onWindowChange: (w: "7d" | "14d") => void;
}) {
  const activeCls = "bg-[#1A2235]";
  const dimCls = "";
  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Ad Health Detail</span>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[10px] font-medium">
              14d + 7d windows
            </Badge>
            <div className="inline-flex h-7 rounded-full bg-[#0E1422] border border-[#1F2937] p-0.5">
              {(["7d", "14d"] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => onWindowChange(w)}
                  className={`px-3 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                    activeWindow === w ? "bg-[#1E6FFF] text-white" : "text-[#8B92A3] hover:text-white"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          Both windows shown side-by-side so trend direction is visible.
          The toggle highlights the window you&apos;re asking about; the other stays for context.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {!data && (
          <div className="space-y-4">
            <div className="h-48 bg-[#0E1422] rounded-xl animate-pulse" />
            <div className="h-48 bg-[#0E1422] rounded-xl animate-pulse" />
          </div>
        )}

        {data && (
          <>
            {/* Campaigns table */}
            <div className="mb-6">
              <p className="text-[11px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">📊 Campaigns</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1F2937] hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Campaign</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Channel</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "14d" ? activeCls : dimCls}`}>14d Q → R → T</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "14d" ? activeCls : dimCls}`}>14d RTL→T%</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "7d" ? activeCls : dimCls}`}>7d Q → R → T</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "7d" ? activeCls : dimCls}`}>7d RTL→T%</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-center">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.campaigns.map((c) => {
                      const p14 = pct(c.d14), p7 = pct(c.d7);
                      const t = trendArrow(p14, p7);
                      return (
                        <TableRow key={c.key} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                          <TableCell className="font-medium text-[12px] text-white max-w-[280px] truncate" title={c.key}>{c.key}</TableCell>
                          <TableCell><span className={channelPill(c.channel)}>{c.channel}</span></TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums text-[#C9D1DC] ${activeWindow === "14d" ? activeCls : dimCls}`}>{fmtQRT(c.d14)}</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctClass(p14)} ${activeWindow === "14d" ? activeCls : dimCls}`}>{p14.toFixed(1)}%</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums text-[#C9D1DC] ${activeWindow === "7d" ? activeCls : dimCls}`}>{fmtQRT(c.d7)}</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctClass(p7)} ${activeWindow === "7d" ? activeCls : dimCls}`}>{p7.toFixed(1)}%</TableCell>
                          <TableCell className="text-center font-mono text-[14px]" style={{ color: t.color }}>{t.arrow}</TableCell>
                        </TableRow>
                      );
                    })}
                    {data.campaigns.length === 0 && (
                      <TableRow className="border-[#1F2937]">
                        <TableCell colSpan={7} className="text-center text-[12px] text-[#8B92A3] py-6">No campaigns with ≥3 RTLs over 14d.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Ad assets table */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">🎬 Ad Assets</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#1F2937] hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Ad Asset</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Channel</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold">Campaign</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "14d" ? activeCls : dimCls}`}>14d Q → R → T</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "14d" ? activeCls : dimCls}`}>14d RTL→T%</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "7d" ? activeCls : dimCls}`}>7d Q → R → T</TableHead>
                      <TableHead className={`text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right ${activeWindow === "7d" ? activeCls : dimCls}`}>7d RTL→T%</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-center">Trend</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-[#8B92A3] font-semibold text-right">Age</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.adAssets.map((a) => {
                      const p14 = pct(a.d14), p7 = pct(a.d7);
                      const t = trendArrow(p14, p7);
                      return (
                        <TableRow key={`${a.campaign}::${a.key}`} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                          <TableCell className="font-medium text-[12px] text-white max-w-[280px] truncate" title={a.key}>{a.key}</TableCell>
                          <TableCell><span className={channelPill(a.channel)}>{a.channel}</span></TableCell>
                          <TableCell className="text-[12px] text-[#C9D1DC] max-w-[180px] truncate" title={a.campaign}>{a.campaign}</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums text-[#C9D1DC] ${activeWindow === "14d" ? activeCls : dimCls}`}>{fmtQRT(a.d14)}</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctClass(p14)} ${activeWindow === "14d" ? activeCls : dimCls}`}>{p14.toFixed(1)}%</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums text-[#C9D1DC] ${activeWindow === "7d" ? activeCls : dimCls}`}>{fmtQRT(a.d7)}</TableCell>
                          <TableCell className={`text-right font-mono text-[12px] tabular-nums ${pctClass(p7)} ${activeWindow === "7d" ? activeCls : dimCls}`}>{p7.toFixed(1)}%</TableCell>
                          <TableCell className="text-center font-mono text-[14px]" style={{ color: t.color }}>{t.arrow}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8B92A3]">{a.ageDays !== null ? `${a.ageDays}d` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                    {data.adAssets.length === 0 && (
                      <TableRow className="border-[#1F2937]">
                        <TableCell colSpan={9} className="text-center text-[12px] text-[#8B92A3] py-6">No ad assets with ≥3 RTLs over 14d.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
