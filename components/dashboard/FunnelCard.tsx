"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FunnelStage } from "@/lib/types";

type Node = {
  key: string;          // funnel stage name
  label: string;
  icon?: string;
  cx: number;           // SVG center x
  cy: number;           // SVG center y
  color: string;        // hex
  parent?: string;      // parent stage name for flow
  subtle?: boolean;     // dimmer styling for branch outcomes
};

// SVG geometry — viewBox so it scales with container width.
const VB_W = 1200;
const VB_H = 860;
const NODE_W = 280;
const NODE_H = 76;

// Linear progression (vertical stack down the center).
const CENTER = VB_W / 2;

// Branch row: Trial Started fans into In Trial / Failed Trialist / Customer.
// Customer further drops to Churned.
const NODES: Node[] = [
  { key: "Qualified Signups",     label: "Qualified Signups",   cx: CENTER, cy: 60,  color: "#A78BFA" },
  { key: "Authorized Airbnb",     label: "Authorized Airbnb",   cx: CENTER, cy: 180, color: "#8B5CF6", parent: "Qualified Signups" },
  { key: "Created Properties",    label: "Created Properties",  cx: CENTER, cy: 300, color: "#34D399", parent: "Authorized Airbnb" },
  { key: "Trial Started",         label: "Trial Started",       cx: CENTER, cy: 440, color: "#6EE7B7", parent: "Created Properties", icon: "★" },
  // Branches — horizontal spread at the same Y
  { key: "In Trial",              label: "In Trial",            cx: 280,    cy: 600, color: "#FB923C", parent: "Trial Started", icon: "☆", subtle: false },
  { key: "Failed Trialist",       label: "Failed Trialist",     cx: 620,    cy: 600, color: "#A78BFA", parent: "Trial Started", icon: "⊘", subtle: false },
  { key: "Customer",              label: "Customer",            cx: 960,    cy: 600, color: "#6EE7B7", parent: "Trial Started", icon: "★★", subtle: false },
  // Customer drops to Churned
  { key: "Churned",               label: "Churned",             cx: 960,    cy: 760, color: "#F87171", parent: "Customer", icon: "⚠", subtle: false },
];

export default function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  const dqRow = funnel.find((f) => f.name === "AirbnbDQ");
  const byName: Record<string, FunnelStage> = {};
  for (const s of funnel) byName[s.name] = s;

  const topCount = byName["Qualified Signups"]?.count || 1;

  // Build paths between parent and child nodes
  type PathInfo = {
    d: string;
    strokeWidth: number;
    color: string;
    gradId: string;
    from: Node;
    to: Node;
    lost?: number | null;
    dropoff?: number | null;
  };
  const paths: PathInfo[] = [];
  for (const n of NODES) {
    if (!n.parent) continue;
    const parent = NODES.find((p) => p.key === n.parent);
    if (!parent) continue;
    const stage = byName[n.key];
    const parentStage = byName[n.parent];
    if (!stage || !parentStage) continue;

    const count = stage.count;
    const parentCount = Math.max(1, parentStage.count);
    const proportion = Math.min(1, count / parentCount);

    const x1 = parent.cx;
    const y1 = parent.cy + NODE_H / 2;
    const x2 = n.cx;
    const y2 = n.cy - NODE_H / 2;
    const midY = (y1 + y2) / 2;

    // S-curve between parent and child
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

    // Stroke width 4..48 based on proportion; min visible 4
    const strokeWidth = Math.max(4, proportion * 70);

    paths.push({
      d,
      strokeWidth,
      color: n.color,
      gradId: `fgrad-${n.key.replace(/\s+/g, "_")}`,
      from: parent,
      to: n,
      lost: stage.lost,
      dropoff: stage.dropoff,
    });
  }

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F1F28]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Funnel Analysis</span>
          {dqRow && (
            <Badge className="bg-[#2A0F13] text-[#F87171] border-[#EF4444]/20 text-[11px] font-medium">
              AirbnbDQ: {dqRow.count} ({dqRow.dropoff?.toFixed(1)}%)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        <p className="text-[13px] text-[#8A8A94] mb-4">
          Signup cohort progression. Trial Started branches into three outcomes;
          Customer can further churn.
        </p>

        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ maxHeight: 900, display: "block" }}
        >
          <defs>
            {paths.map((p) => (
              <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={p.color} stopOpacity="0.75" />
              </linearGradient>
            ))}
          </defs>

          {/* Flow paths first so nodes render on top */}
          {paths.map((p) => {
            // Branch children (Trial Started's 3 outcomes + Customer→Churned)
            // display as "share of parent". Linear stages show "-% dropoff".
            const isBranch = ["In Trial", "Failed Trialist", "Customer", "Churned"].includes(p.to.key);
            const parentCount = byName[p.from.key]?.count ?? 0;
            const childCount = byName[p.to.key]?.count ?? 0;
            let labelText = "";
            let labelColor = "#8A8A94";
            if (parentCount > 0) {
              if (isBranch) {
                // Share of parent — for Churned this is "% of current customers"
                const share = (childCount / parentCount) * 100;
                labelText = `${share.toFixed(0)}%`;
                labelColor = p.color;
              } else {
                // Linear dropoff. Could be negative (e.g. Properties > Authorized).
                const lost = parentCount - childCount;
                const pct = (lost / parentCount) * 100;
                if (Math.abs(pct) < 1) {
                  labelText = "";
                } else if (pct >= 0) {
                  labelText = `−${pct.toFixed(0)}%`;
                  labelColor = pct > 50 ? "#F87171" : "#8A8A94";
                } else {
                  labelText = `+${Math.abs(pct).toFixed(0)}%`;
                  labelColor = "#6EE7B7";
                }
              }
            }
            return (
              <g key={`path-${p.gradId}`}>
                <path
                  d={p.d}
                  stroke={`url(#${p.gradId})`}
                  strokeWidth={p.strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                />
                {labelText && (() => {
                  const midX = (p.from.cx + p.to.cx) / 2;
                  const midY = (p.from.cy + NODE_H / 2 + p.to.cy - NODE_H / 2) / 2;
                  return (
                    <g>
                      <rect
                        x={midX - 36}
                        y={midY - 12}
                        width={72}
                        height={22}
                        rx={6}
                        fill="#15151A"
                        stroke="#2A2A32"
                        strokeWidth={1}
                      />
                      <text
                        x={midX}
                        y={midY + 4}
                        textAnchor="middle"
                        fill={labelColor}
                        fontSize={11}
                        fontWeight={700}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {labelText}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Nodes */}
          {NODES.map((n) => {
            const stage = byName[n.key];
            if (!stage) return null;
            const count = stage.count;
            const pctOfTop = topCount > 0 ? (count / topCount) * 100 : 0;
            const x = n.cx - NODE_W / 2;
            const y = n.cy - NODE_H / 2;
            return (
              <g key={n.key}>
                {/* Soft background halo in node color */}
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={14}
                  fill={n.color}
                  fillOpacity={0.08}
                />
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={14}
                  fill="none"
                  stroke={n.color}
                  strokeWidth={2}
                  strokeOpacity={0.55}
                />
                {/* Icon + label row */}
                <text
                  x={n.cx}
                  y={y + 24}
                  textAnchor="middle"
                  fill={n.color}
                  fontSize={11}
                  fontWeight={700}
                  letterSpacing="1.2"
                >
                  {n.icon ? `${n.icon}  ` : ""}{n.label.toUpperCase()}
                </text>
                {/* Count (big) */}
                <text
                  x={n.cx - 40}
                  y={y + 58}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={28}
                  fontWeight={800}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {count.toLocaleString()}
                </text>
                {/* % of top */}
                <text
                  x={n.cx + 52}
                  y={y + 58}
                  textAnchor="middle"
                  fill={n.color}
                  fontSize={13}
                  fontWeight={700}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {pctOfTop.toFixed(1)}%
                </text>
              </g>
            );
          })}
        </svg>

        {/* Legend describing branches */}
        <div className="mt-5 pt-4 border-t border-[#1F1F28] grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FB923C]" />
            <span className="text-[#8A8A94]">In Trial = still active</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#A78BFA]" />
            <span className="text-[#8A8A94]">Failed = cancelled before converting</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#6EE7B7]" />
            <span className="text-[#8A8A94]">Customer = real paid (Amplify/Flex)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#F87171]" />
            <span className="text-[#8A8A94]">Churned = cancelled after ≥2 days</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
