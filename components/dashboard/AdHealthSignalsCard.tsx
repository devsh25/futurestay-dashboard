"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Shared with AdHealthDetailCard so both cards agree on the data shape.
export interface WindowMetrics { qualified: number; rtl: number; trials: number }
export type AssetChannel = "Meta" | "Google" | "Other";
export type CampaignChannel = "Meta" | "Google" | "Organic" | "Paid-Other";
export interface AdHealthData {
  since14d: string; until14d: string;
  since7d: string;  until7d: string;
  campaigns: Array<{ key: string; channel: CampaignChannel; d14: WindowMetrics; d7: WindowMetrics }>;
  adAssets: Array<{ key: string; channel: AssetChannel; campaign: string; ageDays: number | null; d14: WindowMetrics; d7: WindowMetrics; spend14d: number }>;
  winners: Array<{ key: string; channel: AssetChannel; campaign: string; d7: WindowMetrics; ageDays: number | null; rule: "A" | "B" | "C"; action: string }>;
  dying: Array<{ key: string; channel: AssetChannel; campaign: string; d14: WindowMetrics; ageDays: number | null; spend14d: number; rule: "X" | "Y" | "Z"; action: string }>;
  actions: Array<{ priority: "High" | "Medium" | "Low"; text: string; why: string }>;
  wastedSpend14d: number;
}

function priorityChip(p: "High" | "Medium" | "Low") {
  const cls =
    p === "High"   ? "bg-[#F87171]/15 text-[#FCA5A5] border-[#F87171]/30" :
    p === "Medium" ? "bg-[#F59E0B]/15 text-[#FCD34D] border-[#F59E0B]/30" :
                     "bg-[#1F2937] text-[#8B92A3] border-[#1F2937]";
  return `inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`;
}

function fmtQRT(w: WindowMetrics): string { return `${w.qualified} → ${w.rtl} → ${w.trials}`; }
function fmtMoney(n: number): string {
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000)   return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}

function channelPill(ch: AssetChannel | CampaignChannel) {
  const cls =
    ch === "Meta"   ? "text-[#A78BFA] bg-[#A78BFA]/15 border-[#A78BFA]/30" :
    ch === "Google" ? "text-[#60A5FA] bg-[#60A5FA]/15 border-[#60A5FA]/30" :
                       "text-[#8B92A3] bg-[#1F2937] border-[#1F2937]";
  return `inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`;
}

export default function AdHealthSignalsCard({
  data, activeWindow,
}: {
  data: AdHealthData | null;
  activeWindow: "7d" | "14d";
}) {
  const empty = data && data.actions.length === 0 && data.winners.length === 0 && data.dying.length === 0;

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Ad Health Signals</span>
          <Badge className="bg-[#1E6FFF]/15 text-[#60A5FA] border-[#1E6FFF]/25 text-[10px] font-medium">
            Based on last {activeWindow === "7d" ? "7 days" : "14 days"}
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          What to scale, what to pause, and where to look next. Winners and Dying are computed
          server-side from fixed rules; the 7d/14d toggle on the Detail card below changes only
          the tag above and which columns light up there.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {!data && (
          <div className="space-y-3">
            <div className="h-24 bg-[#0E1422] rounded-xl animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="h-40 bg-[#0E1422] rounded-xl animate-pulse" />
              <div className="h-40 bg-[#0E1422] rounded-xl animate-pulse" />
            </div>
          </div>
        )}

        {data && empty && (
          <p className="text-[13px] text-[#8B92A3] py-8 text-center">No signals to flag right now — funnel is stable.</p>
        )}

        {data && !empty && (
          <>
            {/* Actions */}
            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">🎯 Suggested Actions</p>
              <ol className="space-y-2">
                {data.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 text-[12px] text-white">
                    <span className="text-[#5B6478] font-mono w-4 text-right tabular-nums flex-none">{i + 1}.</span>
                    <span className={priorityChip(a.priority) + " flex-none mt-0.5"}>{a.priority}</span>
                    <span className="flex-1">{a.text}</span>
                    <span className="text-[#5B6478] cursor-help flex-none mt-0.5" title={a.why}>ⓘ</span>
                  </li>
                ))}
                {data.actions.length === 0 && <li className="text-[12px] text-[#8B92A3]">No actions right now.</li>}
              </ol>
            </div>

            {/* Winners + Dying two-column */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2">🟢 Winners</p>
                <div className="space-y-2">
                  {data.winners.length === 0 && <p className="text-[12px] text-[#8B92A3]">No qualifying winners.</p>}
                  {data.winners.slice(0, 5).map((w) => (
                    <div key={w.key} className="border border-[#1F2937] rounded-lg px-3 py-2 bg-[#0E1422]">
                      <div className="flex items-center gap-2 text-[13px] text-white">
                        <span className="truncate flex-1" title={w.key}>{w.key}</span>
                        <span className={priorityChip("Medium")}>Rule {w.rule}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[#8B92A3]">
                        <span className={channelPill(w.channel)}>{w.channel}</span>
                        <span className="truncate">{w.campaign}</span>
                        <span className="ml-auto font-mono tabular-nums text-[#C9D1DC]">7d {fmtQRT(w.d7)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#8B92A3] font-semibold mb-2 flex items-center justify-between">
                  <span>🔴 Dying</span>
                  {data.wastedSpend14d > 0 && (
                    <span className="text-[#FCA5A5] normal-case tracking-normal">⚠️ Est. {fmtMoney(data.wastedSpend14d)} wasted (0 trials, 14d)</span>
                  )}
                </p>
                <div className="space-y-2">
                  {data.dying.length === 0 && <p className="text-[12px] text-[#8B92A3]">No dying ads.</p>}
                  {data.dying.slice(0, 6).map((d) => (
                    <div key={d.key} className="border border-[#1F2937] rounded-lg px-3 py-2 bg-[#0E1422]">
                      <div className="flex items-center gap-2 text-[13px] text-white">
                        <span className="truncate flex-1" title={d.key}>{d.key}</span>
                        <span className={priorityChip("High")}>Rule {d.rule}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[#8B92A3] flex-wrap">
                        <span className={channelPill(d.channel)}>{d.channel}</span>
                        <span className="truncate max-w-[160px]">{d.campaign}</span>
                        {d.ageDays !== null && <span className="text-[#5B6478]">{d.ageDays}d old</span>}
                        {d.spend14d > 0 && <span className="text-[#FCA5A5]">{fmtMoney(d.spend14d)} spent</span>}
                        <span className="ml-auto font-mono tabular-nums text-[#C9D1DC]">14d {fmtQRT(d.d14)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
