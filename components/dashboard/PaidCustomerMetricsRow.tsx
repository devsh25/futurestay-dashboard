"use client";

import React, { useEffect, useMemo, useState } from "react";
import { KPIs, TrendDelta } from "@/lib/types";
import Sparkline from "./Sparkline";

/**
 * Headline metrics row shown at the top of the dashboard.
 *
 * Three big tiles in one divided container (same visual pattern the hero
 * KPI row used to use):
 *   1. Paid Customer Status  — combined "actual / target" number with
 *                              the signed surplus-or-deficit written
 *                              under the label. Invariant to the top
 *                              filter bar; always covers the chart
 *                              horizon so the number stays stable.
 *   2. Paid Customers        — filter-bar-scoped count of real paid
 *                              customers, with trend badge, sparkline
 *                              and "% of target" chip.
 *   3. Trials                — filter-bar-scoped count of trials
 *                              started, with trend badge and sparkline.
 *
 * The chart card below reuses the same Paid Customer Status trio
 * (actual, target, surplus) as four big tiles — see
 * PaidCustomerRunRateChart — so the top-of-dashboard numbers and the
 * card's own headline numbers always match.
 */

interface ApiResponse {
  days: string[];
  actual: (number | null)[];
  target: number[];
  isFuture: boolean[];
}

// Palette aligned with the chart's own line colors so the small dot in
// each tile corner reads as a legend.
const COLOR_ACTUAL  = "#1E6FFF";
const COLOR_TARGET  = "#A78BFA";

function TrendBadge({ delta }: { delta: TrendDelta }) {
  if (delta.previous === 0 && delta.current === 0) {
    return <span className="text-[10px] text-[#5B6478] font-medium">—</span>;
  }
  const up = delta.pct >= 0;
  const styles = up ? "text-[#10B981] bg-[#0F2A1F]" : "text-[#EF4444] bg-[#2A0F13]";
  const arrow = up ? "↑" : "↓";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums ${styles}`}>
      {arrow} {Math.abs(delta.pct).toFixed(1)}%
    </span>
  );
}

function TargetChip({ actual, target }: { actual: number; target: number }) {
  if (target <= 0) return null;
  const pct = (actual / target) * 100;
  // Colored chip so the pace reading jumps off the tile the way the
  // Surplus/Deficit chip does. Green at or above goal, blue above 50,
  // amber below 50 — the three bands you actually care about on a
  // single number.
  const styles =
    pct >= 100 ? "bg-[#0F2A1F] border-[#10B981]/35 text-[#10B981]" :
    pct >= 50  ? "bg-[#0E1D33] border-[#1E6FFF]/35 text-[#60A5FA]" :
                 "bg-[#2A1F0F] border-[#F59E0B]/35 text-[#F59E0B]";
  return (
    <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[13px] font-semibold tabular-nums ${styles}`}>
      <span className="text-[15px]">{pct.toFixed(0)}%</span>
      <span>of target</span>
      <span className="opacity-70 font-normal">({actual.toLocaleString()} / {target.toLocaleString()})</span>
    </div>
  );
}

export type PaidCustomerSummary = {
  actualCum: number;
  targetCum: number;
  surplus: number;
  horizonTarget: number;
};

/** Compute the four Paid Customer headline numbers from the API payload. */
export function summarize(data: ApiResponse): PaidCustomerSummary {
  let firstTargetDay = data.target.findIndex((t) => t > 0);
  if (firstTargetDay === -1) firstTargetDay = 0;
  const future = data.isFuture ?? new Array(data.days.length).fill(false);
  let sumActual = 0, sumTarget = 0, sumProjected = 0;
  for (let i = firstTargetDay; i < data.days.length; i++) {
    if (future[i]) sumProjected += data.target[i];
    else {
      sumActual += (data.actual[i] ?? 0);
      sumTarget += data.target[i];
    }
  }
  return {
    actualCum:     sumActual,
    targetCum:     Math.round(sumTarget),
    // Math.round(+0 or -0 float sliver) can keep a negative sign; `+ 0`
    // normalises -0 to +0 so the chip never reads "-0".
    surplus:       Math.round(sumActual - sumTarget) + 0,
    horizonTarget: Math.round(sumTarget + sumProjected),
  };
}

/** One big tile. Mirrors the KPI hero row's cell geometry. */
export function BigMetricTile({
  label, value, dotColor, valueTone,
}: {
  label: React.ReactNode;
  value: string;
  dotColor?: string;
  valueTone?: string;
}) {
  return (
    <div className="relative px-5 py-5 first:pl-6 last:pr-6">
      {dotColor && (
        <span
          className="absolute top-3 right-3 h-2 w-2 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      )}
      <p className={`text-[44px] xl:text-[52px] leading-none font-bold tracking-tight tabular-nums mb-3 ${valueTone ?? "text-white"}`}>
        {value}
      </p>
      <p className="text-[12px] text-[#8B92A3] font-medium">{label}</p>
    </div>
  );
}

/**
 * The four Paid Customer tiles rendered inline — reused by this row and
 * by the chart card below. Pass `null` while the data is still loading.
 */
export function PaidCustomerFourTiles({ totals }: { totals: PaidCustomerSummary | null }) {
  const isSurplus = (totals?.surplus ?? 0) >= 0;
  const fmt = (v: number) => v.toLocaleString();
  return (
    <>
      <BigMetricTile
        label="Actual (cumulative)"
        value={totals ? fmt(totals.actualCum) : "…"}
        dotColor={COLOR_ACTUAL}
      />
      <BigMetricTile
        label="Target (cumulative)"
        value={totals ? fmt(totals.targetCum) : "…"}
        dotColor={COLOR_TARGET}
      />
      <BigMetricTile
        label={
          totals
            ? (
              <>
                Current Status · {" "}
                <span className={isSurplus ? "text-[#10B981]" : "text-[#EF4444]"}>
                  {isSurplus ? "Surplus" : "Deficit"}
                </span>
              </>
            )
            : "Current Status"
        }
        value={totals ? `${totals.surplus > 0 ? "+" : ""}${totals.surplus.toLocaleString()}` : "…"}
        valueTone={totals ? (isSurplus ? "text-[#10B981]" : "text-[#EF4444]") : undefined}
      />
      <BigMetricTile
        label="Horizon target"
        value={totals ? fmt(totals.horizonTarget) : "…"}
        dotColor={COLOR_TARGET}
      />
    </>
  );
}

/**
 * Combined "Paid Customer Status" tile. Big "actual / target" fraction
 * on top, "Paid Customer Status" label, surplus / deficit line in
 * green or red below. Collapses what used to be three separate tiles
 * (Actual cumulative, Target cumulative, Current Status) into one
 * reading because the three numbers only ever get interpreted
 * together.
 */
// Label matches the fact that the tile covers the full chart horizon
// (Aug 1 onward — the first configured target month), not the top
// filter bar's window. Updating this string? Also update the "since"
// language if the earliest month in MONTHLY_CUSTOMER_TARGETS changes.
const PAID_CUSTOMER_TILE_LABEL = "Paid Customer Bucket (since August 1st)";

function PaidCustomerStatusTile({ totals }: { totals: PaidCustomerSummary | null }) {
  if (!totals) {
    return (
      <div className="relative px-5 py-5 first:pl-6 last:pr-6">
        <p className="text-[44px] xl:text-[52px] leading-none font-bold text-white tracking-tight tabular-nums mb-3">…</p>
        <p className="text-[12px] text-[#8B92A3] font-medium">{PAID_CUSTOMER_TILE_LABEL}</p>
      </div>
    );
  }
  const isSurplus = totals.surplus >= 0;
  const styles = isSurplus
    ? "bg-[#0F2A1F] border-[#10B981]/35 text-[#10B981]"
    : "bg-[#2A0F13] border-[#EF4444]/35 text-[#EF4444]";
  const word = isSurplus ? "Surplus" : "Deficit";
  const signed = `${totals.surplus > 0 ? "+" : ""}${totals.surplus.toLocaleString()}`;
  return (
    <div className="relative px-5 py-5 first:pl-6 last:pr-6">
      <p className="text-[44px] xl:text-[52px] leading-none font-bold text-white tracking-tight tabular-nums mb-3">
        <span>{totals.actualCum.toLocaleString()}</span>
        <span className="opacity-40 mx-1.5">/</span>
        <span className="opacity-70">{totals.targetCum.toLocaleString()}</span>
      </p>
      <p className="text-[12px] text-[#8B92A3] font-medium">{PAID_CUSTOMER_TILE_LABEL}</p>
      <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-semibold tabular-nums ${styles}`}>
        <span>{word}</span>
        <span className="text-[15px]">{signed}</span>
      </div>
    </div>
  );
}

export default function PaidCustomerMetricsRow({
  kpis,
  customerTarget,
}: {
  kpis: KPIs;
  customerTarget?: number;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/paid-customer-run-rate")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ApiResponse) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => (data ? summarize(data) : null), [data]);

  return (
    <div className="bg-[#11182B] border border-[#1F2937] rounded-2xl overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#1F2937]">
        {/* 1. Paid Customer Status — combined cumulative-actual /
            cumulative-target with surplus/deficit under the label.
            Invariant to the top filter bar; always covers the full
            chart horizon from the paid-customer run-rate endpoint. */}
        <PaidCustomerStatusTile totals={totals} />

        {/* 2. Paid Customers (period-filtered) — count + trend + sparkline
            + "% of target" chip. Matches the old Total Customers tile
            exactly; just renamed so the row vocabulary stays aligned
            with "Paid Customer Status" above. */}
        <div className="relative px-5 py-5 first:pl-6 last:pr-6">
          <div className="flex items-baseline justify-between mb-3 gap-2">
            <p className="text-[44px] xl:text-[52px] leading-none font-bold text-white tracking-tight tabular-nums">
              {kpis.totalCustomers.toLocaleString()}
            </p>
            <TrendBadge delta={kpis.deltas.customers} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-[#8B92A3] font-medium truncate">Paid Customers</p>
            <Sparkline data={kpis.sparkline.customers} color={COLOR_ACTUAL} width={56} height={22} />
          </div>
          {customerTarget !== undefined && (
            <TargetChip actual={kpis.totalCustomers} target={customerTarget} />
          )}
        </div>

        {/* 3. Trials (period-filtered) — count + trend + sparkline.
            No target chip because trial volume isn't a planned
            number; it's a top-of-funnel reading alongside the two
            customer-focused tiles. */}
        <div className="relative px-5 py-5 first:pl-6 last:pr-6">
          <div className="flex items-baseline justify-between mb-3 gap-2">
            <p className="text-[44px] xl:text-[52px] leading-none font-bold text-white tracking-tight tabular-nums">
              {kpis.totalTrials.toLocaleString()}
            </p>
            <TrendBadge delta={kpis.deltas.trials} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-[#8B92A3] font-medium truncate">Trials</p>
            <Sparkline data={kpis.sparkline.trials} color={COLOR_ACTUAL} width={56} height={22} />
          </div>
        </div>
      </div>
    </div>
  );
}
