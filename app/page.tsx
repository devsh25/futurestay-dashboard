"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardData, PeriodFilter } from "@/lib/types";
import FilterBar from "@/components/FilterBar";
import KPICards from "@/components/dashboard/KPICards";
import AllTimeChart from "@/components/dashboard/AllTimeChart";
import FunnelCard from "@/components/dashboard/FunnelCard";
import GeoCard from "@/components/dashboard/GeoCard";
import RepCard from "@/components/dashboard/RepCard";
import DQChartCard from "@/components/dashboard/DQChartCard";
import MetaSpendCard from "@/components/dashboard/MetaSpendCard";
import CampaignAnalysisCard from "@/components/dashboard/CampaignAnalysisCard";
import SectionHeading, { Icons } from "@/components/dashboard/SectionHeading";
import ActiveFilterChips from "@/components/ActiveFilterChips";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default custom range: Feb 1, 2026 → T−14d.
  // T−14d enforces the cohort-maturity rule (Futurestay's median signup→customer
  // is ~14 days, so anything fresher than that has unmatured conversion data).
  const today = new Date();
  const tMinus14 = new Date(today);
  tMinus14.setDate(tMinus14.getDate() - 14);
  const tMinus14Iso = tMinus14.toISOString().slice(0, 10);

  const [period, setPeriod] = useState<PeriodFilter>("custom");
  const [customStart, setCustomStart] = useState("2026-02-01");
  const [customEnd, setCustomEnd] = useState(tMinus14Iso);
  const [countries, setCountries] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);

  // Cohort-maturity warning: end date inside the last 14 days means trial
  // and customer counts for recent signups haven't fully materialized.
  const isMaturityRisky = (() => {
    if (period !== "custom") return false;
    const end = new Date(customEnd + "T00:00:00Z");
    const cutoff = new Date(today);
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - 14);
    return end > cutoff;
  })();

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
    }
  }, [period, countries, channels, customStart, customEnd]);

  useEffect(() => {
    const timeout = setTimeout(fetchData, 300);
    return () => clearTimeout(timeout);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-[#0A0F1A] text-white antialiased">
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
              {data && (
                <span className="hidden md:inline-flex items-center gap-1.5 ml-2 px-3 py-1 rounded-full bg-[#11182B] border border-[#1F2937] text-[12px] text-[#C9D1DC] font-medium tabular-nums">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                  {data.totalContacts.toLocaleString()} qualified signups
                </span>
              )}
            </div>
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
      </header>

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-6 lg:px-8 py-6 lg:py-8">
        {error && (
          <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-4 text-[#C9D1DC] mb-5">
            <p className="font-semibold text-sm text-white">Error loading data</p>
            <p className="text-xs mt-1 text-[#8B92A3]">{error}</p>
          </div>
        )}

        {/* Loading overlay */}
        <div
          className={`transition-opacity duration-200 space-y-6 ${loading ? "opacity-40 pointer-events-none" : "opacity-100"}`}
        >
          {data && (
            <>
              {isMaturityRisky && (
                <div className="bg-[#11182B] border border-[#1F2937] rounded-xl p-4 flex items-start gap-3">
                  <span className="text-[#60A5FA] text-lg leading-none mt-0.5">ⓘ</span>
                  <div className="flex-1">
                    <p className="font-semibold text-[13px] text-white">
                      Cohort still maturing
                    </p>
                    <p className="text-[12px] mt-1 text-[#8B92A3] leading-relaxed">
                      Your end date <span className="font-mono text-[#C9D1DC]">{customEnd}</span> is within the last 14 days. Trial and Customer counts for recent signups will be undercounted because the median signup-to-customer time is ~14 days. Set the end date to{" "}
                      <button onClick={() => setCustomEnd(tMinus14Iso)} className="text-[#60A5FA] hover:text-white underline font-mono transition-colors">{tMinus14Iso}</button>{" "}
                      for fully-matured numbers.
                    </p>
                  </div>
                </div>
              )}

              <ActiveFilterChips
                period={period}
                customStart={customStart}
                customEnd={customEnd}
                countries={countries}
                channels={channels}
                onCountriesChange={setCountries}
                onChannelsChange={setChannels}
                onPeriodChange={setPeriod}
              />

              <SectionHeading
                icon={Icons.Gauge}
                title="Overview"
                description="Headline metrics with 14-day trend vs prior period"
                iconColor="#60A5FA"
              />
              <KPICards kpis={data.kpis} cohort={data.cohort} />

              {/* Headline timeseries — independent of period filter,
                  shows daily milestone counts since first signup. */}
              <AllTimeChart />

              <SectionHeading
                icon={Icons.Funnel}
                title="Funnel & Campaign Performance"
                description="How qualified signups progress through stages, and where they come from"
                iconColor="#1E6FFF"
              />
              <FunnelCard funnel={data.funnel} />

              <CampaignAnalysisCard
                period={period}
                customStart={customStart}
                customEnd={customEnd}
              />

              {/* Meta Ads card lives at the end of the funnel section so
                  the spend numbers sit next to the campaign performance
                  table they relate to, rather than splitting the funnel
                  story in half. */}
              <MetaSpendCard
                period={period}
                customStart={customStart}
                customEnd={customEnd}
              />

              <SectionHeading
                icon={Icons.Shield}
                title="Quality & Team"
                description="DQ reasons by week and sales rep performance"
                iconColor="#93C5FD"
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <DQChartCard data={data.dqWeekly} />
                <RepCard reps={data.reps} />
              </div>

              <SectionHeading
                icon={Icons.Globe}
                title="Geography"
                description="Country and city breakdown of qualified signups"
                iconColor="#60A5FA"
              />
              <GeoCard geo={data.geo} />
            </>
          )}
        </div>

        {/* Skeleton loading */}
        {!data && loading && (
          <div className="space-y-5 animate-pulse">
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-[#11182B] rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-[#11182B] rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="h-96 bg-[#11182B] rounded-2xl" />
              <div className="h-96 bg-[#11182B] rounded-2xl" />
            </div>
          </div>
        )}

        {!data && !loading && !error && (
          <div className="text-center py-20 text-[#8B92A3]">
            <p>No data available. Check your HubSpot API token.</p>
          </div>
        )}
      </main>
    </div>
  );
}
