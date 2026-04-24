"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrialOutcomes } from "@/lib/types";

type Segment = {
  key: keyof Omit<TrialOutcomes, "total">;
  label: string;
  shortLabel: string;
  hex: string;           // hex value for SVG fill/stroke
  bgTint: string;        // tailwind bg class
  borderTint: string;    // tailwind border class
  textTint: string;      // tailwind text class
  description: string;
  icon: string;          // single glyph for the card header
};

const SEGMENTS: Segment[] = [
  {
    key: "inTrial",
    label: "Still In Trial",
    shortLabel: "In Trial",
    hex: "#FB923C",
    bgTint: "bg-[#FB923C]/8",
    borderTint: "border-[#FB923C]/30",
    textTint: "text-[#FB923C]",
    description: "Currently active trialists",
    icon: "☆",
  },
  {
    key: "customer",
    label: "Became Customer",
    shortLabel: "Customer",
    hex: "#6EE7B7",
    bgTint: "bg-[#6EE7B7]/8",
    borderTint: "border-[#6EE7B7]/30",
    textTint: "text-[#6EE7B7]",
    description: "Real paid customer (≥2 days)",
    icon: "★★",
  },
  {
    key: "limitedAccess",
    label: "Limited Access",
    shortLabel: "Limited",
    hex: "#60A5FA",
    bgTint: "bg-[#60A5FA]/8",
    borderTint: "border-[#60A5FA]/30",
    textTint: "text-[#60A5FA]",
    description: "Cancelled but keeps bookings access",
    icon: "◐",
  },
  {
    key: "churned",
    label: "Churned",
    shortLabel: "Churned",
    hex: "#F87171",
    bgTint: "bg-[#F87171]/8",
    borderTint: "border-[#F87171]/30",
    textTint: "text-[#F87171]",
    description: "Was customer ≥2 days then cancelled",
    icon: "⚠",
  },
  {
    key: "failedTrialist",
    label: "Failed Trialist",
    shortLabel: "Failed",
    hex: "#A78BFA",
    bgTint: "bg-[#A78BFA]/8",
    borderTint: "border-[#A78BFA]/30",
    textTint: "text-[#A78BFA]",
    description: "Cancelled trial before real conversion",
    icon: "⊘",
  },
  {
    key: "reverted",
    label: "Reverted / Other",
    shortLabel: "Reverted",
    hex: "#6B6B75",
    bgTint: "bg-[#6B6B75]/8",
    borderTint: "border-[#6B6B75]/30",
    textTint: "text-[#9CA3AF]",
    description: "Dropped back to signup or unknown",
    icon: "↺",
  },
];

export default function TrialOutcomesCard({ outcomes }: { outcomes: TrialOutcomes }) {
  const total = outcomes.total || 1;

  // Flowchart geometry — viewBox stays constant; SVG scales to container.
  const VB_W = 1200;
  const VB_H = 260;
  const TOP_CX = VB_W / 2;
  const TOP_CY = 54;
  const TOP_BOTTOM = 96;        // y-coord where lines leave top node
  const BOT_TOP = 232;          // y-coord where lines meet outcome cards
  const COL_W = VB_W / SEGMENTS.length;

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F1F28]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Trial Outcomes</span>
          <Badge className="bg-[#6EE7B7]/15 text-[#6EE7B7] border-[#6EE7B7]/25 text-[11px] font-medium">
            Where trialists ended up
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        <p className="text-[13px] text-[#8A8A94] mb-5">
          Of{" "}
          <span className="text-white font-semibold">
            {outcomes.total.toLocaleString()}
          </span>{" "}
          people who entered trial in this period, here&apos;s where they ended up.
        </p>

        {/* Stacked overview bar */}
        <div className="mb-7">
          <div className="h-12 w-full rounded-xl overflow-hidden flex bg-[#1F1F28] border border-[#2A2A32]">
            {SEGMENTS.map((seg) => {
              const count = outcomes[seg.key];
              const pct = (count / total) * 100;
              if (count === 0) return null;
              return (
                <div
                  key={seg.key}
                  className="h-full transition-all flex items-center justify-center group relative"
                  style={{ width: `${pct}%`, backgroundColor: seg.hex }}
                  title={`${seg.label}: ${count} (${pct.toFixed(1)}%)`}
                >
                  {pct > 6 && (
                    <span className="text-[11px] font-bold text-[#0A0A0C] tabular-nums">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Flowchart */}
        <div className="relative mb-5" style={{ paddingTop: 0 }}>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full"
            style={{ height: VB_H, display: "block" }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Gradient defs for each branch line */}
            <defs>
              {SEGMENTS.map((seg) => (
                <linearGradient
                  key={`grad-${seg.key}`}
                  id={`grad-${seg.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={seg.hex} stopOpacity="0.15" />
                  <stop offset="100%" stopColor={seg.hex} stopOpacity="0.75" />
                </linearGradient>
              ))}
            </defs>

            {/* Branch paths */}
            {SEGMENTS.map((seg, i) => {
              const count = outcomes[seg.key];
              const pct = count / total;
              const cx = (i + 0.5) * COL_W;
              // Bezier control points for a gentle S-curve
              const midY = (TOP_BOTTOM + BOT_TOP) / 2;
              const d = `M ${TOP_CX} ${TOP_BOTTOM} C ${TOP_CX} ${midY}, ${cx} ${midY}, ${cx} ${BOT_TOP}`;
              // Stroke width: min 3, max 40, scaled by pct
              const strokeWidth = Math.max(3, pct * 55);
              return (
                <path
                  key={seg.key}
                  d={d}
                  stroke={`url(#grad-${seg.key})`}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  opacity={count > 0 ? 1 : 0.15}
                />
              );
            })}

            {/* Top node: Trial Started */}
            <g>
              <rect
                x={TOP_CX - 130}
                y={TOP_CY - 34}
                width={260}
                height={68}
                rx={14}
                fill="#1F1F28"
                stroke="#A78BFA"
                strokeWidth={2}
                strokeOpacity={0.5}
              />
              <text
                x={TOP_CX}
                y={TOP_CY - 8}
                textAnchor="middle"
                fill="#A78BFA"
                fontSize={11}
                fontWeight={700}
                letterSpacing="1.5"
              >
                TRIAL STARTED
              </text>
              <text
                x={TOP_CX}
                y={TOP_CY + 22}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={28}
                fontWeight={800}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {outcomes.total.toLocaleString()}
              </text>
            </g>

            {/* Bottom tiny node markers — colored circles at the landing points */}
            {SEGMENTS.map((seg, i) => {
              const cx = (i + 0.5) * COL_W;
              return (
                <circle
                  key={`dot-${seg.key}`}
                  cx={cx}
                  cy={BOT_TOP}
                  r={6}
                  fill={seg.hex}
                  stroke="#15151A"
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {/* Outcome cards positioned right below the SVG lines */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3">
            {SEGMENTS.map((seg) => {
              const count = outcomes[seg.key];
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div
                  key={seg.key}
                  className={`rounded-xl border ${seg.borderTint} ${seg.bgTint} px-4 py-4 transition-all hover:scale-[1.02]`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-base ${seg.textTint}`}>{seg.icon}</span>
                    <p className="text-[10px] uppercase tracking-wider text-[#E5E5EB] font-bold">
                      {seg.label}
                    </p>
                  </div>
                  <p className="text-4xl font-black text-white tabular-nums leading-none">
                    {count.toLocaleString()}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className={`text-[13px] font-bold tabular-nums ${seg.textTint}`}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8A8A94] mt-2 leading-snug">
                    {seg.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
