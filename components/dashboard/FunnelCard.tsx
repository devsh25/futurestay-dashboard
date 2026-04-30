"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FunnelStage } from "@/lib/types";

type Node = {
  key: string;
  label: string;
  icon?: string;
  cx: number;
  cy: number;
  color: string;
  parent?: string;
  parentExitX?: number; // override the exit x on the parent (for fan branches)
};

// Wide canvas: linear flow runs left→right at top, branches drop down from
// Trial Started.
const VB_W = 1500;
const VB_H = 770;
const NODE_W = 230;
const NODE_H = 132;

// Linear top row (y = 90). 5 nodes evenly spaced with ~75px gap each.
const TOP_Y = 90;
// Branch row — outcomes drop from Trial Started.
const BRANCH_Y = 470;
// Churned drops below Customer.
const CHURN_Y = 660;

// Linear x positions: 150, 430, 710, 990, 1270 (280 apart, with right margin)
const LIN_X = [150, 430, 710, 990, 1270];

// 3-color palette designed for dark backgrounds:
//   VIOLET — linear in-flight stages (signup, auth, props, ready, trial, in-trial)
//   MINT   — positive outcome (Customer)
//   CORAL  — negative outcomes (Failed Trialist, Churned)
const C_INFLIGHT = "#A78BFA";  // violet
const C_POSITIVE = "#6EE7B7";  // mint
const C_NEGATIVE = "#F87171";  // coral

const NODES: Node[] = [
  // Linear conversion path (left → right) — all violet
  { key: "Qualified Signups",  label: "Qualified Signups",  cx: LIN_X[0], cy: TOP_Y, color: C_INFLIGHT },
  { key: "Authorized Airbnb",  label: "Authorized Airbnb",  cx: LIN_X[1], cy: TOP_Y, color: C_INFLIGHT, parent: "Qualified Signups" },
  { key: "Created Properties", label: "Created Properties", cx: LIN_X[2], cy: TOP_Y, color: C_INFLIGHT, parent: "Authorized Airbnb" },
  { key: "Ready to Launch",    label: "Ready to Launch",    cx: LIN_X[3], cy: TOP_Y, color: C_INFLIGHT, parent: "Created Properties", icon: "🚀" },
  { key: "Trial Started",      label: "Trial Started",      cx: LIN_X[4], cy: TOP_Y, color: C_INFLIGHT, parent: "Ready to Launch", icon: "★" },

  // Branches off Trial Started.
  { key: "Failed Trialist",    label: "Failed Trialist",    cx: 350,      cy: BRANCH_Y, color: C_NEGATIVE, parent: "Trial Started", icon: "⊘", parentExitX: LIN_X[4] - NODE_W / 2 + 30 },
  { key: "In Trial",           label: "In Trial",           cx: 810,      cy: BRANCH_Y, color: C_INFLIGHT, parent: "Trial Started", icon: "☆", parentExitX: LIN_X[4] - 60 },
  { key: "Customer",           label: "Customer",           cx: LIN_X[4], cy: BRANCH_Y, color: C_POSITIVE, parent: "Trial Started", icon: "★★" },

  // Customer → Churned (vertical drop)
  { key: "Churned",            label: "Churned",            cx: LIN_X[4], cy: CHURN_Y,  color: C_NEGATIVE, parent: "Customer", icon: "⚠" },
];

const BRANCH_KEYS = new Set(["In Trial", "Failed Trialist", "Customer"]);

export default function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  const dqRow = funnel.find((f) => f.name === "AirbnbDQ");
  const byName: Record<string, FunnelStage> = {};
  for (const s of funnel) byName[s.name] = s;

  const topCount = byName["Qualified Signups"]?.count || 1;

  type PathInfo = {
    d: string;
    strokeWidth: number;
    color: string;
    gradId: string;
    from: Node;
    to: Node;
    kind: "horizontal" | "branch" | "vertical";
  };
  const paths: PathInfo[] = [];
  for (const n of NODES) {
    if (!n.parent) continue;
    const parent = NODES.find((p) => p.key === n.parent);
    if (!parent) continue;
    const stage = byName[n.key];
    const parentStage = byName[parent.key];
    if (!stage || !parentStage) continue;

    const proportion = Math.min(1, stage.count / Math.max(1, parentStage.count));
    // Wider strokes for outcome branches, slimmer for linear connectors.
    // Non-linear paths (branches + verticals) need a healthy minimum so the
    // Trial→Customer drop and Customer→Churned drop stay visible even when
    // the proportion is small (Customer is often <20% of Trial Started).
    const isLinear = n.cy === parent.cy;
    const strokeWidth = Math.max(isLinear ? 8 : 14, proportion * (isLinear ? 50 : 70));

    let d = "";
    let kind: PathInfo["kind"] = "horizontal";
    if (n.cy === parent.cy) {
      const x1 = parent.cx + NODE_W / 2;
      const x2 = n.cx - NODE_W / 2;
      d = `M ${x1} ${parent.cy} L ${x2} ${n.cy}`;
      kind = "horizontal";
    } else if (n.cx === parent.cx) {
      const y1 = parent.cy + NODE_H / 2;
      const y2 = n.cy - NODE_H / 2;
      d = `M ${parent.cx} ${y1} L ${n.cx} ${y2}`;
      kind = "vertical";
    } else {
      const x1 = n.parentExitX ?? parent.cx;
      const y1 = parent.cy + NODE_H / 2;
      const x2 = n.cx;
      const y2 = n.cy - NODE_H / 2;
      const midY = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      kind = "branch";
    }

    paths.push({
      d,
      strokeWidth,
      color: n.color,
      gradId: `fgrad-${n.key.replace(/\s+/g, "_")}`,
      from: parent,
      to: n,
      kind,
    });
  }

  return (
    <Card className="bg-[#15151A] border border-[#1F1F28] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F1F28]">
        <CardTitle className="flex items-center justify-between text-[17px] font-semibold text-white tracking-tight">
          <span>Funnel Analysis</span>
          {dqRow && (
            <Badge className="bg-[#2A0F13] text-[#F87171] border-[#EF4444]/20 text-[11px] font-medium">
              AirbnbDQ: {dqRow.count.toLocaleString()} ({dqRow.dropoff?.toFixed(1)}%)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        <p className="text-[14px] text-[#A8A8B2] mb-4 leading-relaxed">
          <span className="text-[#A78BFA] font-medium">Cohort-based.</span>{" "}
          Of qualified signups whose <code className="text-[#C9C9D1] text-[13px]">createdate</code> falls in the window, what % reached each stage. Linear path top → Trial Started, then 3 outcomes branch downward (Customer can further churn).
        </p>

        <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full"
            style={{ display: "block", aspectRatio: `${VB_W} / ${VB_H}`, maxWidth: "100%" }}
          >
            <defs>
              {paths.map((p) => (
                <linearGradient
                  key={p.gradId}
                  id={p.gradId}
                  x1="0"
                  y1="0"
                  x2={p.kind === "horizontal" ? "1" : "0"}
                  y2={p.kind === "horizontal" ? "0" : "1"}
                >
                  <stop offset="0%" stopColor={p.color} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={p.color} stopOpacity="0.95" />
                </linearGradient>
              ))}
              <linearGradient id="branchBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1F1F28" stopOpacity="0" />
                <stop offset="50%" stopColor="#1F1F28" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#1F1F28" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Section labels */}
            <text x={50} y={40} fill="#6B6B75" fontSize={11} fontWeight={700} letterSpacing="2.5">
              CONVERSION PATH →
            </text>
            <text x={50} y={290} fill="#6B6B75" fontSize={11} fontWeight={700} letterSpacing="2.5">
              ↓ OUTCOMES OF TRIAL STARTED
            </text>

            {/* Subtle band behind branches */}
            <rect x={20} y={310} width={VB_W - 40} height={310} fill="url(#branchBand)" rx={20} />

            {/* Flow paths */}
            {paths.map((p) => {
              const isBranch = BRANCH_KEYS.has(p.to.key);
              const parentCount = byName[p.from.key]?.count ?? 0;
              const childCount = byName[p.to.key]?.count ?? 0;
              let labelText = "";
              let labelColor = "#8A8A94";
              if (parentCount > 0) {
                if (isBranch || p.to.key === "Churned") {
                  const share = (childCount / parentCount) * 100;
                  labelText = `${share.toFixed(0)}%`;
                  labelColor = p.color;
                } else {
                  const lost = parentCount - childCount;
                  const pct = (lost / parentCount) * 100;
                  if (Math.abs(pct) >= 1) {
                    if (pct >= 0) {
                      labelText = `−${pct.toFixed(0)}%`;
                      labelColor = pct > 50 ? "#F87171" : "#9CA3AF";
                    } else {
                      labelText = `+${Math.abs(pct).toFixed(0)}%`;
                      labelColor = "#6EE7B7";
                    }
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
                  {labelText &&
                    (() => {
                      let midX = 0;
                      let midY = 0;
                      if (p.kind === "horizontal") {
                        midX = (p.from.cx + p.to.cx) / 2;
                        midY = p.from.cy - 32;
                      } else if (p.kind === "vertical") {
                        midX = p.from.cx + 60;
                        midY = (p.from.cy + p.to.cy) / 2;
                      } else {
                        const x1 = p.to.parentExitX ?? p.from.cx;
                        midX = (x1 + p.to.cx) / 2;
                        midY = (p.from.cy + NODE_H / 2 + p.to.cy - NODE_H / 2) / 2;
                      }
                      return (
                        <g>
                          <rect
                            x={midX - 32}
                            y={midY - 14}
                            width={64}
                            height={28}
                            rx={8}
                            fill="#0A0A0C"
                            stroke="#2A2A32"
                            strokeWidth={1}
                          />
                          <text
                            x={midX}
                            y={midY + 5}
                            textAnchor="middle"
                            fill={labelColor}
                            fontSize={14}
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

            {/* Nodes (vertical layout: accent bar, label, count, %) */}
            {NODES.map((n) => {
              const stage = byName[n.key];
              if (!stage) return null;
              const count = stage.count;
              const pctOfTop = topCount > 0 ? (count / topCount) * 100 : 0;
              const x = n.cx - NODE_W / 2;
              const y = n.cy - NODE_H / 2;
              return (
                <g key={n.key}>
                  {/* Soft halo */}
                  <rect
                    x={x - 3}
                    y={y - 3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={18}
                    fill={n.color}
                    fillOpacity={0.06}
                  />
                  {/* Card */}
                  <rect
                    x={x}
                    y={y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={14}
                    fill="#15151A"
                    stroke={n.color}
                    strokeWidth={2}
                    strokeOpacity={0.7}
                  />
                  {/* Top accent bar */}
                  <rect x={x} y={y} width={NODE_W} height={5} rx={2} fill={n.color} />

                  {/* Label */}
                  <text
                    x={n.cx}
                    y={y + 32}
                    textAnchor="middle"
                    fill={n.color}
                    fontSize={12}
                    fontWeight={700}
                    letterSpacing="1.8"
                  >
                    {n.icon ? `${n.icon}  ` : ""}{n.label.toUpperCase()}
                  </text>
                  {/* Count (large, centered) */}
                  <text
                    x={n.cx}
                    y={y + 78}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize={40}
                    fontWeight={800}
                    style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-1px" }}
                  >
                    {count.toLocaleString()}
                  </text>
                  {/* % of top (centered below) */}
                  <text
                    x={n.cx}
                    y={y + 110}
                    textAnchor="middle"
                    fill={n.color}
                    fontSize={15}
                    fontWeight={700}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {pctOfTop.toFixed(1)}% of qualified
                  </text>
                </g>
              );
            })}
          </svg>

        {/* Legend — 3-color palette: violet=in-flight, mint=positive, coral=negative */}
        <div className="mt-6 pt-5 border-t border-[#1F1F28] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[14px] leading-snug">
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#A78BFA] shrink-0" />
            <span className="text-[#C9C9D1]">
              <span className="text-white font-medium">In-flight</span> = stages still progressing (Auth → Properties → Ready → Trial → In Trial)
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#6EE7B7] shrink-0" />
            <span className="text-[#C9C9D1]">
              <span className="text-white font-medium">Customer</span> = real paid customer (Amplify/Flex, ≥2 days)
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#F87171] shrink-0" />
            <span className="text-[#C9C9D1]">
              <span className="text-white font-medium">Failed / Churned</span> = cancelled before converting, or after ≥2 days as customer
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
