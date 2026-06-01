"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FunnelStage, MetaInsightsData, PeriodFilter } from "@/lib/types";

/** Strip Meta-naming boilerplate so the dropdown stays readable.
 *  "05.03 | US & CA | Direct Website Booking | Static & Video Ads | Campaign"
 *    → "05.03 | Direct Website Booking | Static & Video Ads"
 *  Pipe-format names get the geo + "Campaign" suffix dropped; everything
 *  else (paused-bucket names, "Retargeting Ads") passes through. Mirrors
 *  the same helper in CampaignAnalysisCard / MetaSpendCard. */
function shortCampaign(name: string): string {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return name;
  const filtered = parts.filter((p, i) => {
    if (p.toLowerCase() === "us & ca") return false;
    if (i === parts.length - 1 && p.toLowerCase() === "campaign") return false;
    return true;
  });
  return filtered.join(" | ");
}

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

// Spine: Total Signups → Qualified Signups → Auth → Ready → Trial Started,
// then 3 outcomes drop straight down from Trial Started. The Total →
// Qualified drop is the Airbnb DQ step. Bumped VB_W from 1500 to 1700 to
// fit 5 spine nodes plus the right-side outcome cluster (Customer at
// X_TRIAL + 270 = 1580 + NODE_W/2 = 1695).
const VB_W = 1700;
const VB_H = 800;
const NODE_W = 230;
const NODE_H = 132;

const SPINE_Y = 180;
// Trial outcomes row — directly below Trial Started, all 3 dropping down.
const BRANCH_Y = 540;
// Churned drops below Customer.
const CHURN_Y = 720;

// Spine x — 5 stages evenly across the canvas with ~290px spacing.
// Total at 130, Trial Started at 1310 → outcomes still fit on the right.
const X_TOTAL = 130;
const X_QS = 425;
const X_AUTH = 720;
const X_READY = 1015;
const X_TRIAL = 1310;

// Outcome cluster — 3 boxes spread either side of Trial Started.
const X_FAILED = X_TRIAL - 270;   // 1040
const X_INTRIAL = X_TRIAL;        // 1310 — directly under Trial Started
const X_CUSTOMER = X_TRIAL + 270; // 1580

// Restricted palette — blue spectrum + white only. No red/green/coral
// in decorative elements. Status colors (delta pills) keep green/red
// because they're tiny and universally recognised.
const C_INFLIGHT = "#1E6FFF";   // electric blue — primary
const C_POSITIVE = "#60A5FA";   // light blue — Customer (positive arrival)
const C_NEUTRAL = "#FFFFFF";    // white — Failed Trialist / Churned (off-path)

const NODES: Node[] = [
  // Linear spine
  { key: "Total Signups",      label: "Total Signups",      cx: X_TOTAL,      cy: SPINE_Y, color: C_INFLIGHT },
  { key: "Qualified Signups",  label: "Qualified Signups",  cx: X_QS,         cy: SPINE_Y, color: C_INFLIGHT, parent: "Total Signups" },
  { key: "Authorized Airbnb",  label: "Authorized Airbnb",  cx: X_AUTH,       cy: SPINE_Y, color: C_INFLIGHT, parent: "Qualified Signups" },
  { key: "Ready to Launch",    label: "Ready to Launch",    cx: X_READY,      cy: SPINE_Y, color: C_INFLIGHT, parent: "Authorized Airbnb", icon: "🚀" },
  { key: "Trial Started",      label: "Trial Started",      cx: X_TRIAL,      cy: SPINE_Y, color: C_INFLIGHT, parent: "Ready to Launch", icon: "★" },

  // Trial outcomes — all drop DOWN from Trial Started. Failed and
  // Customer fan slightly outward; In Trial drops straight down.
  { key: "Failed Trialist",    label: "Failed Trialist",    cx: X_FAILED,     cy: BRANCH_Y, color: C_NEUTRAL,  parent: "Trial Started", icon: "⊘" },
  { key: "In Trial",           label: "In Trial",           cx: X_INTRIAL,    cy: BRANCH_Y, color: C_INFLIGHT, parent: "Trial Started", icon: "☆" },
  { key: "Customer",           label: "Customer",           cx: X_CUSTOMER,   cy: BRANCH_Y, color: C_POSITIVE, parent: "Trial Started", icon: "★★" },

  // Customer → Churned (vertical drop)
  { key: "Churned",            label: "Churned",            cx: X_CUSTOMER,   cy: CHURN_Y,  color: C_NEUTRAL, parent: "Customer", icon: "⚠" },
];

const BRANCH_KEYS = new Set(["In Trial", "Failed Trialist", "Customer"]);

// Nodes whose label should show "% of parent" rather than "−X% lost".
// Used for: the Trial Started outcomes (In Trial / Failed / Customer)
// where the 3 shares should sum to ~100%, and Churned. Everything else
// (spine progression: QS → Auth → Ready → Trial) shows the loss %.
const SHARE_LABEL_KEYS = new Set([
  "In Trial",
  "Failed Trialist",
  "Customer",
  "Churned",
]);

interface FunnelCardProps {
  funnel: FunnelStage[];
  // Period + custom dates passed from the page so the per-campaign
  // refetch can scope to the same window the rest of the dashboard
  // is showing.
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
  countries?: string[];
  channels?: string[];
}

export default function FunnelCard({
  funnel: funnelProp,
  period,
  customStart,
  customEnd,
  countries = [],
  channels = [],
}: FunnelCardProps) {
  const [campaign, setCampaign] = useState<string | null>(null); // null = All
  const [scopedFunnel, setScopedFunnel] = useState<FunnelStage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live Meta + Google rosters for the dropdown. Fetched once on
  // mount, independent of the period filter — we want to show ALL
  // currently active campaigns regardless of window so freshly-
  // launched ones with zero spend still appear.
  const [metaOptions, setMetaOptions] = useState<{ name: string; display: string }[]>([]);
  const [googleOptions, setGoogleOptions] = useState<{ name: string; display: string }[]>([]);

  // Sentinel values — must match lib/funnel.ts. Hardcoding the string
  // here rather than importing because that import would pull the
  // server-only funnel module into a client bundle.
  const ALL_META_SENTINEL = "@all-meta";
  const ALL_GOOGLE_SENTINEL = "@all-google";

  useEffect(() => {
    let cancelled = false;
    // Meta — server-side merges /campaigns?effective_status=ACTIVE into
    // the insights response and filters test campaigns out.
    fetch("/api/meta/insights?period=allTime")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: MetaInsightsData) => {
        if (cancelled) return;
        const opts = d.campaigns.map((c) => ({ name: c.name, display: shortCampaign(c.name) }));
        opts.sort((a, b) => a.display.localeCompare(b.display));
        setMetaOptions(opts);
      })
      .catch(() => { /* dropdown's Meta section stays empty on API failure */ });

    // Google — separate endpoint. Returns [] (not an error) if the
    // Ads API is disconnected, so the Google section just becomes
    // empty while the rest of the dropdown still works.
    fetch("/api/google/campaigns")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { campaigns: { id: string; name: string }[] }) => {
        if (cancelled) return;
        const opts = d.campaigns.map((c) => ({ name: c.name, display: c.name }));
        opts.sort((a, b) => a.display.localeCompare(b.display));
        setGoogleOptions(opts);
      })
      .catch(() => { /* Google section silently empty on failure */ });

    return () => { cancelled = true; };
  }, []);

  // When campaign is null, use the prop-passed funnel (already
  // computed for the global cohort). When a campaign is selected,
  // fetch a scoped version from /api/funnel.
  useEffect(() => {
    if (!campaign) {
      setScopedFunnel(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period, campaign });
    if (period === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    if (countries.length > 0) params.set("country", countries.join(","));
    if (channels.length > 0) params.set("channels", channels.join(","));

    fetch(`/api/funnel?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: { funnel: FunnelStage[] }) => { if (!cancelled) setScopedFunnel(d.funnel); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign, period, customStart, customEnd, countries, channels]);

  // Pick the active funnel: scoped if a campaign is set + data has
  // arrived, otherwise the prop (full cohort).
  const funnel: FunnelStage[] = scopedFunnel ?? funnelProp;
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
        <CardTitle className="flex items-center justify-between gap-3 text-[17px] font-semibold text-white tracking-tight">
          <span>Funnel Analysis</span>
          <div className="flex items-center gap-2">
            {/* Campaign filter — null = all campaigns (default).
                Selecting one re-scopes the entire funnel to contacts
                attributed to that Meta campaign via the same logic
                Campaign Analysis uses (UTM ∪ source_data_2 ∪ URL
                fallback, with pre-launch exclusion). */}
            <select
              value={campaign ?? ""}
              onChange={(e) => setCampaign(e.target.value || null)}
              className="h-8 px-3 rounded-full text-[12px] font-medium bg-[#0E1422] border border-[#1F2937] text-[#C9D1DC] hover:border-[#1E6FFF]/50 hover:text-white transition-colors cursor-pointer outline-none focus:border-[#1E6FFF]/60"
              disabled={loading}
            >
              <option value="">All campaigns</option>
              {metaOptions.length > 0 && (
                <option value={ALL_META_SENTINEL}>All Meta campaigns</option>
              )}
              {googleOptions.length > 0 && (
                <option value={ALL_GOOGLE_SENTINEL}>All Google campaigns</option>
              )}
              {metaOptions.length > 0 && (
                <optgroup label="Meta — individual">
                  {metaOptions.map((c) => (
                    <option key={`meta-${c.name}`} value={c.name} title={c.name}>{c.display}</option>
                  ))}
                </optgroup>
              )}
              {googleOptions.length > 0 && (
                <optgroup label="Google — individual">
                  {googleOptions.map((c) => (
                    <option key={`google-${c.name}`} value={c.name} title={c.name}>{c.display}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {dqRow && (
              <Badge className="bg-[#1A2235] text-[#8B92A3] border-[#1F2937] text-[11px] font-medium">
                AirbnbDQ: {dqRow.count.toLocaleString()} ({dqRow.dropoff?.toFixed(1)}%)
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        <p className="text-[14px] text-[#A8A8B2] mb-4 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Cohort-based.</span>{" "}
          Of qualified signups (contacts whose <code className="text-[#C9D1DC] text-[13px]">account_lifecycle</code> has reached <span className="text-white">signup</span> or beyond and whose <code className="text-[#C9D1DC] text-[13px]">createdate</code> falls in the window), what % reached each stage.{" "}
          {campaign ? (
            <span className="text-[#60A5FA] font-medium">
              Filtered to{" "}
              <span className="text-white" title={campaign}>
                {campaign === ALL_META_SENTINEL
                  ? "All Meta campaigns"
                  : campaign === ALL_GOOGLE_SENTINEL
                    ? "All Google campaigns"
                    : shortCampaign(campaign)}
              </span>
              .
            </span>
          ) : (
            <>Authorizing Airbnb auto-imports listings (the path most users take). 3 outcomes drop from Trial Started (In Trial = still active, Customer = real paid, Failed = cancelled before converting). Customer can further churn.</>
          )}
        </p>

        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-3 text-[#C9D1DC] text-[12px] mb-4">
            <p className="font-semibold text-white" title={campaign ?? undefined}>
              Failed to scope funnel to {campaign ? shortCampaign(campaign) : "campaign"}
            </p>
            <p className="text-[11px] mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}
        {loading && (
          <p className="text-[12px] text-[#8B92A3] mb-3" title={campaign ?? undefined}>
            Re-scoping funnel to {campaign ? shortCampaign(campaign) : "campaign"}…
          </p>
        )}

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
              CONVERSION SPINE →
            </text>
            <text x={50} y={BRANCH_Y - NODE_H / 2 - 20} fill="#5B6478" fontSize={11} fontWeight={700} letterSpacing="2.5">
              ↓ OUTCOMES OF TRIAL STARTED
            </text>

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
                  // Default: share-of-parent. % of Trial Started who
                  // ended up as Customer / In Trial / Failed Trialist.
                  // Special case for Churned: standard churn rate is
                  //   churned / (churned + active customers)
                  // not churned / current-customers, because it's
                  // measuring "what fraction of everyone who became a
                  // customer eventually cancelled" — including the
                  // 28 who already churned in the denominator.
                  const denom = p.to.key === "Churned"
                    ? parentCount + childCount
                    : parentCount;
                  const share = (childCount / denom) * 100;
                  labelText = `${share.toFixed(0)}%`;
                  labelColor = p.color;
                } else {
                  // Spine progression — show drop-off.
                  const lost = parentCount - childCount;
                  const pct = (lost / parentCount) * 100;
                  if (Math.abs(pct) >= 1) {
                    // Drop-off labels stay neutral. The number itself is
                    // the signal — colour-coding it red when "high" added
                    // visual noise without clarifying intent. Same neutral
                    // gray for both directions.
                    labelText = pct >= 0
                      ? `−${pct.toFixed(0)}%`
                      : `+${Math.abs(pct).toFixed(0)}%`;
                    labelColor = "#8B92A3";
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
              // Inside-card percentage. For most nodes we show "% of
              // qualified" using QualifiedSignups as the denominator.
              // Total Signups is a special case — it's *above* Qualified
              // in the funnel, so a "% of qualified" reading would be
              // > 100% which is meaningless. Show it as % of itself
              // (always 100%) labelled "of total" instead.
              const isTotal = n.key === "Total Signups";
              const pctOfTop = isTotal
                ? 100
                : topCount > 0 ? (count / topCount) * 100 : 0;
              const pctLabel = isTotal ? "100% of total" : `${pctOfTop.toFixed(1)}% of qualified`;
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
                    {pctLabel}
                  </text>
                </g>
              );
            })}
          </svg>

        {/* Legend — restricted blue-spectrum palette */}
        <div className="mt-6 pt-5 border-t border-[#1F2937] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[14px] leading-snug">
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#1E6FFF] shrink-0" />
            <span className="text-[#C9D1DC]">
              <span className="text-white font-medium">In-flight</span> = stages still progressing (Auth → Ready → Trial → In Trial)
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#60A5FA] shrink-0" />
            <span className="text-[#C9D1DC]">
              <span className="text-white font-medium">Customer</span> = real paid customer (Amplify/Flex, ≥2 days)
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-white shrink-0" />
            <span className="text-[#C9D1DC]">
              <span className="text-white font-medium">Off-path</span> = Failed Trialist or Churned (left the funnel)
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
