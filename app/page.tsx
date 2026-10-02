"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { DashboardData, PeriodFilter } from "@/lib/types";
import { tzStartOfDay, tzStartOfMonth, tzDateKey } from "@/lib/timezone";
import { fullMonthTargetForRange } from "@/lib/customer-targets";
import FilterBar from "@/components/FilterBar";
import PaidCustomerMetricsRow from "@/components/dashboard/PaidCustomerMetricsRow";
import AllTimeChart from "@/components/dashboard/AllTimeChart";
import RtlRunRateChart from "@/components/dashboard/RtlRunRateChart";
import PaidCustomerRunRateChart from "@/components/dashboard/PaidCustomerRunRateChart";
import DashboardSkeleton from "@/components/dashboard/DashboardSkeleton";
import RetentionCurveChart from "@/components/dashboard/RetentionCurveChart";
import FunnelCard from "@/components/dashboard/FunnelCard";
import AdSpendCard from "@/components/dashboard/AdSpendCard";
import SectionHeading, { Icons } from "@/components/dashboard/SectionHeading";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import DownloadDataButton from "@/components/DownloadDataButton";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // First-fold loading tracker. The skeleton stays visible until BOTH
  //   1) the contacts API call returns (powers KPIs + funnel)
  //   2) the AllTimeChart's timeseries call returns (the Run Rate card)
  // Once both are done we know everything in the first viewport has
  // its data and the skeleton can fade out. Subsequent refreshes
  // (filter changes) don't re-show the skeleton — they show the top
  // progress bar instead, since the existing data is still valid until
  // the new data lands.
  const [hasInitialContacts, setHasInitialContacts] = useState(false);
  const [hasInitialRunRate, setHasInitialRunRate] = useState(false);
  const firstFoldReady = hasInitialContacts && hasInitialRunRate;
  const isRefreshing = loading && firstFoldReady;
  // Default custom range: this calendar month to date (ET). The team
  // tracks performance against monthly targets, so opening the
  // dashboard on month-to-date is the natural reference view. Switch
  // back to a single-day or trailing window via the filter bar when a
  // narrower cut is wanted.
  //
  // All date arithmetic in ET so the default is stable for any user
  // regardless of their browser timezone.
  const nowEt = tzStartOfDay(new Date());
  const todayIso = tzDateKey(nowEt);
  const monthStartIso = tzDateKey(tzStartOfMonth(nowEt));

  const [period, setPeriod] = useState<PeriodFilter>("custom");
  const [customStart, setCustomStart] = useState(monthStartIso);
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [countries, setCountries] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);

  // Headline customer target for the KPI chip: sum of the FULL monthly
  // targets for every calendar month the window overlaps. A single day
  // in October counts the whole 165 as the goal, not a prorated share.
  //
  // Only computed for "custom" periods right now because the FilterBar's
  // preset periods (last 7 / 30 / 90 days, this/last week etc.) don't
  // have an obvious month-anchored target interpretation. If a preset
  // ever needs one, resolve its date range here and reuse
  // fullMonthTargetForRange on it.
  const customerTarget = useMemo(() => {
    if (period !== "custom") return undefined;
    const t = fullMonthTargetForRange(customStart, customEnd);
    return t > 0 ? t : undefined;
  }, [period, customStart, customEnd]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (countries.length > 0) params.set("country", countries.join(","));
      if (channels.length > 0) params.set("channels", channels.join(","));
      if (period === "custom") {
        params.set("start", customStart);
        params.set("end", customEnd);
      }
      const res = await fetch(`/api/hubspot/contacts?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch data");
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setHasInitialContacts(true);  // initial load complete (success or fail)
    }
  }, [period, countries, channels, customStart, customEnd]);

  // Stable callback for AllTimeChart so its useEffect dep doesn't loop.
  const handleRunRateReady = useMemo(() => () => setHasInitialRunRate(true), []);

  useEffect(() => {
    const timeout = setTimeout(fetchData, 300);
    return () => clearTimeout(timeout);
  }, [fetchData]);

  return (
    <div id="dashboard-root" className="min-h-screen bg-[#0A0F1A] text-white antialiased">
      {/* Sticky header — Dashbrd X look: subtle blur + hairline divider,
          left cluster (logo + title + breadcrumb), right cluster (filters
          + qualified-signups chip). */}
      <header className="bg-[#0A0F1A]/85 border-b border-[#1F2937] sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-8 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Logo mark — solid blue gradient square per moodboard. */}
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1E6FFF] to-[#3B82F6] flex items-center justify-center shadow-[0_8px_24px_rgba(30,111,255,0.35)]">
                <span className="text-white font-bold text-[17px] tracking-tight">F</span>
              </div>
              <div className="flex items-center gap-2.5 text-[14px]">
                <span className="text-[#8B92A3]">Futurestay</span>
                <span className="text-[#1F2937]">›</span>
                <span className="text-white font-semibold tracking-tight">Growth Dashboard</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <DownloadPdfButton />
              <DownloadDataButton period={period} customStart={customStart} customEnd={customEnd} />
              <div className="no-print contents">
                <FilterBar
                  period={period}
                  onPeriodChange={setPeriod}
                  customStart={customStart}
                  customEnd={customEnd}
                  onCustomStartChange={setCustomStart}
                  onCustomEndChange={setCustomEnd}
                  countries={countries}
                  onCountriesChange={setCountries}
                  channels={channels}
                  onChannelsChange={setChannels}
                  loading={loading}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-6 lg:px-8 py-6 lg:py-8">
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-4 text-[#C9D1DC] mb-5">
            <p className="font-semibold text-sm text-white">Error loading data</p>
            <p className="text-xs mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {/* Top progress bar — visible during any refresh after the
            initial load has completed. Two states:
              • First load: skeleton replaces content entirely.
              • Refresh: existing content stays visible, this thin
                blue bar at the top signals new data is in flight. */}
        {isRefreshing && <div className="lp-progress-bar" />}

        {/* Initial-load skeleton — replaces the real content area
            until both the contacts API and the Run Rate timeseries API
            have returned. Layout matches the real first fold so the
            page doesn't reflow when data lands. */}
        {!firstFoldReady && !error && <DashboardSkeleton />}

        {/* Real content — hidden during initial load, dimmed slightly
            during refreshes so the user knows the numbers are about
            to update. */}
        <div
          id="dashboard-content"
          className={`transition-opacity duration-200 space-y-6 ${
            !firstFoldReady ? "hidden" : isRefreshing ? "opacity-60 pointer-events-none" : "opacity-100"
          }`}
        >
          {data && (
            <>
              <PaidCustomerMetricsRow kpis={data.kpis} customerTarget={customerTarget} />

              {/* Headline timeseries — independent of period filter,
                  shows daily milestone counts since first signup. */}
              <AllTimeChart onReady={handleRunRateReady} />
              <RtlRunRateChart />
              <PaidCustomerRunRateChart />

              <SectionHeading
                icon={Icons.Funnel}
                title="Funnel & Campaign Performance"
                description="How qualified signups progress through stages, and where they come from"
                iconColor="#1E6FFF"
              />
              <FunnelCard
                funnel={data.funnel}
                period={period}
                customStart={customStart}
                customEnd={customEnd}
                countries={countries}
                channels={channels}
              />

              {/* Unified Ad Spend & Efficiency card. Was two cards
                  (Meta and Google) with impressions / CTR / CPC etc.
                  Merged into one focused on the five metrics the
                  team actually acts on: total spend, cost per RTL,
                  RTL to Trial %, cost per trial, cost per customer.
                  Data comes from /api/campaigns/analysis so numbers
                  cannot drift from the Campaign Analysis table above. */}
              <AdSpendCard
                period={period}
                customStart={customStart}
                customEnd={customEnd}
              />

              <SectionHeading
                icon={Icons.Shield}
                title="Retention & Quality"
                description="How long paying customers stick around"
                iconColor="#93C5FD"
              />
              <RetentionCurveChart />
            </>
          )}
        </div>

        {/* Empty state — only shown if the initial load completed but
            returned no data (genuine empty result, not still loading).
            Loading is now handled by <DashboardSkeleton /> above. */}
        {firstFoldReady && !data && !error && (
          <div className="text-center py-20 text-[#8B92A3]">
            <p>No data available. Check your HubSpot API token.</p>
          </div>
        )}
      </main>
    </div>
  );
}
