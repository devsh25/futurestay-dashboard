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
  /** Optional second incoming parent — used by Ready to Launch which can
   *  be reached from EITHER Authorized Airbnb OR Created Properties. */
  extraParent?: string;
  parentExitX?: number; // override the exit x on the parent (for fan branches)
};

// Wide canvas: spine runs left→right with a parallel pair (Auth / Properties)
// branching off Qualified Signups and merging back at Ready to Launch.
// Then trial outcomes branch downward from Trial Started.
const VB_W = 1500;
const VB_H = 850;
const NODE_W = 230;
const NODE_H = 132;

// Spine y for QS, Ready, Trial — all on a horizontal line.
const SPINE_Y = 200;
// Parallel pair sits above/below the spine at the same x.
const AUTH_Y = 80;
const PROPS_Y = 320;
// Trial outcomes row.
const BRANCH_Y = 580;
// Churned drops below Customer.
const CHURN_Y = 760;

// Spine x positions. Auth/Properties share the second slot.
//   QS → [Auth/Props] → Ready → Trial
const X_QS = 150;
const X_PARALLEL = 600;   // Auth (top) + Properties (bottom)
const X_READY = 1000;
const X_TRIAL = 1300;     // Trial Started (kept far right so branches have room)

const C_INFLIGHT = "#1E6FFF";  // electric blue
const C_POSITIVE = "#6EE7B7";  // mint
const C_NEGATIVE = "#F87171";  // coral

const NODES: Node[] = [
  // Spine entry
  { key: "Qualified Signups",  label: "Qualified Signups",  cx: X_QS,       cy: SPINE_Y, color: C_INFLIGHT },

  // Parallel activation steps — siblings of Qualified Signups.
  // Auth and Created Properties are independent paths to setup. Some
  // users authorize Airbnb (which auto-imports listings); others
  // manually create properties. They are NOT sequential — that's why
  // Created Properties can be > Authorized Airbnb in the data.
  { key: "Authorized Airbnb",  label: "Authorized Airbnb",  cx: X_PARALLEL, cy: AUTH_Y,  color: C_INFLIGHT, parent: "Qualified Signups" },
  { key: "Created Properties", label: "Created Properties", cx: X_PARALLEL, cy: PROPS_Y, color: C_INFLIGHT, parent: "Qualified Signups" },

  // Merge: Ready to Launch is fed by both parallel activation paths.
  { key: "Ready to Launch",    label: "Ready to Launch",    cx: X_READY,    cy: SPINE_Y, color: C_INFLIGHT, parent: "Authorized Airbnb", extraParent: "Created Properties", icon: "🚀" },

  // Spine continues
  { key: "Trial Started",      label: "Trial Started",      cx: X_TRIAL,    cy: SPINE_Y, color: C_INFLIGHT, parent: "Ready to Launch", icon: "★" },

  // Trial outcomes branch off Trial Started.
  { key: "Failed Trialist",    label: "Failed Trialist",    cx: 380,        cy: BRANCH_Y, color: C_NEGATIVE, parent: "Trial Started", icon: "⊘", parentExitX: X_TRIAL - NODE_W / 2 + 30 },
  { key: "In Trial",           label: "In Trial",           cx: 840,        cy: BRANCH_Y, color: C_INFLIGHT, parent: "Trial Started", icon: "☆", parentExitX: X_TRIAL - 60 },
  { key: "Customer",           label: "Customer",           cx: X_TRIAL,    cy: BRANCH_Y, color: C_POSITIVE, parent: "Trial Started", icon: "★★" },

  // Customer → Churned (vertical drop)
  { key: "Churned",            label: "Churned",            cx: X_TRIAL,    cy: CHURN_Y,  color: C_NEGATIVE, parent: "Customer", icon: "⚠" },
];

const BRANCH_KEYS = new Set(["In Trial", "Failed Trialist", "Customer"]);

// Nodes whose label should show "% of parent" rather than "−X% lost".
// Used for: parallel activation siblings off Qualified Signups (Auth /
// Created Properties), the Trial Started outcomes (In Trial / Failed /
// Customer), and Churned. For everything else (Ready → Trial) we show
// the loss % so the user can see drop-off through the spine.
const SHARE_LABEL_KEYS = new Set([
  "Authorized Airbnb",
  "Created Properties",
  "In Trial",
  "Failed Trialist",
  "Customer",
  "Churned",
]);

export default function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  const dqRow = funnel.find((f) => f.name === "AirbnbDQ");
  const byName: Record<string, FunnelStage> = {};
  for (const s of funnel) byName[s.name] = s;

  const topCount = byName["Qualified Signups"]?.count || 1;

  type PathInfo = {
    d: string;
    strokeWidth: number;
    color: string;
    pathId: string;
    from: Node;
    to: Node;
    kind: "horizontal" | "branch" | "vertical";
  };
  const paths: PathInfo[] = [];

  // Uniform stroke width across every connector — the labels (–60%, 38%,
  // etc.) carry the proportion information, so the lines themselves don't
  // need to grow/shrink. Keeps the diagram readable regardless of cohort
  // shape and ensures small branches like Trial Started → Customer stay
  // visible even when only a small % converted.
  const STROKE_W = 18;

  /** Build the SVG `d` for a connector and classify its shape. Centralised
   *  so both the primary parent and any `extraParent` (merge) edge use the
   *  exact same geometry rules. */
  function buildPath(parent: Node, n: Node): { d: string; kind: PathInfo["kind"] } {
    if (n.cy === parent.cy) {
      // Same horizontal — straight line edge-to-edge.
      const x1 = parent.cx + NODE_W / 2;
      const x2 = n.cx - NODE_W / 2;
      return { d: `M ${x1} ${parent.cy} L ${x2} ${n.cy}`, kind: "horizontal" };
    }
    if (n.cx === parent.cx) {
      // Same vertical — straight drop edge-to-edge.
      const y1 = parent.cy + NODE_H / 2;
      const y2 = n.cy - NODE_H / 2;
      return { d: `M ${parent.cx} ${y1} L ${n.cx} ${y2}`, kind: "vertical" };
    }
    // Off-axis: draw a smooth Bezier. Exit from the parent's edge (right
    // edge if parent is left of child, bottom edge if parent is above).
    const goingDown = n.cy > parent.cy;
    const goingRight = n.cx > parent.cx;
    let x1: number, y1: number, x2: number, y2: number, c1x: number, c1y: number, c2x: number, c2y: number;
    if (Math.abs(n.cy - parent.cy) > Math.abs(n.cx - parent.cx) * 0.6) {
      // Mostly vertical move (e.g. trial → branch row). Exit from the
      // parent's bottom edge, enter the child's top edge.
      x1 = n.parentExitX ?? parent.cx;
      y1 = parent.cy + (goingDown ? NODE_H / 2 : -NODE_H / 2);
      x2 = n.cx;
      y2 = n.cy + (goingDown ? -NODE_H / 2 : NODE_H / 2);
      const midY = (y1 + y2) / 2;
      c1x = x1; c1y = midY; c2x = x2; c2y = midY;
    } else {
      // Mostly horizontal move (e.g. QS → Auth/Properties). Exit from the
      // parent's right/left edge, enter the child's left/right edge —
      // gives a clean side-to-side curve regardless of vertical offset.
      x1 = parent.cx + (goingRight ? NODE_W / 2 : -NODE_W / 2);
      y1 = parent.cy;
      x2 = n.cx + (goingRight ? -NODE_W / 2 : NODE_W / 2);
      y2 = n.cy;
      const midX = (x1 + x2) / 2;
      c1x = midX; c1y = y1; c2x = midX; c2y = y2;
    }
    return {
      d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
      kind: "branch",
    };
  }

  for (const n of NODES) {
    if (!n.parent) continue;
    const parent = NODES.find((p) => p.key === n.parent);
    if (!parent) continue;
    if (!byName[n.key] || !byName[parent.key]) continue;

    const primary = buildPath(parent, n);
    paths.push({
      d: primary.d,
      strokeWidth: STROKE_W,
      color: n.color,
      pathId: `fpath-${n.key.replace(/\s+/g, "_")}`,
      from: parent,
      to: n,
      kind: primary.kind,
    });

    // Merge-edge support: if this node has a second parent, draw a second
    // incoming connector. Used by Ready to Launch, which is fed by both
    // Authorized Airbnb and Created Properties (parallel activation
    // paths). Prevents the funnel from implying false sequence between
    // those two stages.
    if (n.extraParent) {
      const extra = NODES.find((p) => p.key === n.extraParent);
      if (extra && byName[extra.key]) {
        const merge = buildPath(extra, n);
        paths.push({
          d: merge.d,
          strokeWidth: STROKE_W,
          color: n.color,
          pathId: `fpath-${n.key.replace(/\s+/g, "_")}-from-${extra.key.replace(/\s+/g, "_")}`,
          from: extra,
          to: n,
          kind: merge.kind,
        });
      }
    }
  }

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-4 border-b border-[#1F2937]">
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
          <span className="text-[#1E6FFF] font-medium">Cohort-based.</span>{" "}
          Of qualified signups whose <code className="text-[#C9D1DC] text-[13px]">createdate</code> falls in the window, what % reached each stage. <span className="text-white font-medium">Authorized Airbnb</span> and <span className="text-white font-medium">Created Properties</span> are <span className="text-[#1E6FFF]">parallel activation paths</span> — most users authorize Airbnb (which auto-imports listings), some create properties manually. Both feed into Ready to Launch. Then 3 outcomes branch off Trial Started (Customer can further churn).
        </p>

        <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full"
            style={{ display: "block", aspectRatio: `${VB_W} / ${VB_H}`, maxWidth: "100%" }}
          >
            <defs>
              {/* Hidden path geometry — referenced by both the visible stroke
                  and the animated particle motion. Defining once here avoids
                  duplicating the d-attribute and keeps animation in sync with
                  the rendered line. */}
              {paths.map((p) => (
                <path key={`${p.pathId}-def`} id={p.pathId} d={p.d} fill="none" />
              ))}

              {/* Soft glow filter for the moving particle so it reads as
                  "energy flowing through the funnel" against the dark bg. */}
              <filter id="particleGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <linearGradient id="branchBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1F2937" stopOpacity="0" />
                <stop offset="50%" stopColor="#1F2937" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#1F2937" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Section labels */}
            <text x={50} y={30} fill="#5B6478" fontSize={11} fontWeight={700} letterSpacing="2.5">
              ACTIVATION PATHS (PARALLEL) →
            </text>
            <text x={50} y={490} fill="#5B6478" fontSize={11} fontWeight={700} letterSpacing="2.5">
              ↓ OUTCOMES OF TRIAL STARTED
            </text>

            {/* Subtle merge-zone band behind Auth/Properties → Ready */}
            <rect x={X_PARALLEL - NODE_W / 2 - 10} y={AUTH_Y - NODE_H / 2 - 10} width={X_READY - X_PARALLEL + 20} height={PROPS_Y - AUTH_Y + NODE_H + 20} fill="#1E6FFF" fillOpacity={0.03} rx={20} />

            {/* Subtle band behind trial outcomes branch zone */}
            <rect x={20} y={BRANCH_Y - NODE_H / 2 - 30} width={VB_W - 40} height={CHURN_Y - BRANCH_Y + NODE_H + 60} fill="url(#branchBand)" rx={20} />

            {/* Flow paths */}
            {paths.map((p, idx) => {
              // Merge edges (Auth → Ready, Properties → Ready) are silent —
              // we don't want to imply a single "% conversion" through them
              // because Ready is fed by both paths in parallel.
              const isMergeEdge = p.pathId.includes("-from-");
              const parentCount = byName[p.from.key]?.count ?? 0;
              const childCount = byName[p.to.key]?.count ?? 0;
              let labelText = "";
              let labelColor = "#8B92A3";
              if (parentCount > 0 && !isMergeEdge) {
                if (SHARE_LABEL_KEYS.has(p.to.key)) {
                  // Show share-of-parent (% of QS who reached this milestone,
                  // % of Trial who became Customer, etc.).
                  const share = (childCount / parentCount) * 100;
                  labelText = `${share.toFixed(0)}%`;
                  labelColor = p.color;
                } else {
                  // Spine progression — show drop-off.
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
              // Suppress the BRANCH_KEYS reference for lint — kept for backwards
              // compatibility / future use elsewhere in the file.
              void BRANCH_KEYS;
              // Stagger animation start so multiple particles don't all
              // depart at the exact same instant — feels more organic.
              const animDuration = p.kind === "horizontal" ? 3.2 : 2.6;
              const animDelay = ((idx * 0.4) % 1.2).toFixed(2);
              return (
                <g key={`path-${p.pathId}`}>
                  {/* Visible connector — solid color with reduced opacity so
                      the animated particle reads on top of it. */}
                  <use
                    href={`#${p.pathId}`}
                    stroke={p.color}
                    strokeOpacity={0.55}
                    strokeWidth={p.strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                  />

                  {/* Animated particle: a small circle that traces the path
                      end-to-end. Uses SVG <animateMotion> with mpath so the
                      motion follows whatever curve the path defines (works
                      identically for horizontal lines, branches, and
                      vertical drops). */}
                  <circle r={5} fill={p.color} filter="url(#particleGlow)">
                    <animateMotion
                      dur={`${animDuration}s`}
                      begin={`${animDelay}s`}
                      repeatCount="indefinite"
                      rotate="auto"
                      keyPoints="0;1"
                      keyTimes="0;1"
                    >
                      <mpath href={`#${p.pathId}`} />
                    </animateMotion>
                  </circle>
                  {/* Trailing softer particle for a tail effect. */}
                  <circle r={3} fill={p.color} fillOpacity={0.5}>
                    <animateMotion
                      dur={`${animDuration}s`}
                      begin={`${(parseFloat(animDelay) - 0.2).toFixed(2)}s`}
                      repeatCount="indefinite"
                      rotate="auto"
                    >
                      <mpath href={`#${p.pathId}`} />
                    </animateMotion>
                  </circle>

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
                        // Bezier branch: place the chip near the curve's
                        // geometric centre. For mostly-horizontal curves
                        // (QS → Auth, QS → Properties) this lands cleanly
                        // on the line; for mostly-vertical curves (Trial
                        // → outcomes) it lands in the gap above the child.
                        const mostlyVertical =
                          Math.abs(p.to.cy - p.from.cy) >
                          Math.abs(p.to.cx - p.from.cx) * 0.6;
                        if (mostlyVertical) {
                          const x1 = p.to.parentExitX ?? p.from.cx;
                          midX = (x1 + p.to.cx) / 2;
                          midY = (p.from.cy + NODE_H / 2 + p.to.cy - NODE_H / 2) / 2;
                        } else {
                          midX = (p.from.cx + p.to.cx) / 2;
                          midY = (p.from.cy + p.to.cy) / 2;
                        }
                      }
                      return (
                        <g>
                          <rect
                            x={midX - 32}
                            y={midY - 14}
                            width={64}
                            height={28}
                            rx={8}
                            fill="#0A0F1A"
                            stroke="#1F2937"
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
                    fill="#11182B"
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
        <div className="mt-6 pt-5 border-t border-[#1F2937] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[14px] leading-snug">
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#1E6FFF] shrink-0" />
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
