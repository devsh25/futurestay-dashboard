"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardData, PeriodFilter } from "@/lib/types";
import FilterBar from "@/components/FilterBar";
import KPICards from "@/components/dashboard/KPICards";
import FunnelCard from "@/components/dashboard/FunnelCard";
import CampaignCard from "@/components/dashboard/CampaignCard";
import GeoCard from "@/components/dashboard/GeoCard";
import RepCard from "@/components/dashboard/RepCard";
import DQChartCard from "@/components/dashboard/DQChartCard";
import CohortCard from "@/components/dashboard/CohortCard";
import TrialOutcomesCard from "@/components/dashboard/TrialOutcomesCard";
import MetaSpendCard from "@/components/dashboard/MetaSpendCard";
import CampaignAnalysisCard from "@/components/dashboard/CampaignAnalysisCard";
import SectionHeading, { Icons } from "@/components/dashboard/SectionHeading";
import ActiveFilterChips from "@/components/ActiveFilterChips";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodFilter>("allTime");
  const [customStart, setCustomStart] = useState("2026-01-01");
  const [customEnd, setCustomEnd] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [countries, setCountries] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);

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
    <div className="min-h-screen bg-[#0A0A0C] text-white">
      {/* Header */}
      <header className="bg-[#0A0A0C] border-b border-[#1F1F28] sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Futurestay logo mark */}
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#A78BFA] to-[#6366F1] flex items-center justify-center shadow-[0_4px_16px_rgba(167,139,250,0.3)]">
                <span className="text-white font-bold text-base">F</span>
              </div>
              <div>
                <h1 className="text-[15px] font-semibold text-white tracking-tight">
                  Futurestay Growth
                </h1>
                {data && (
                  <p className="text-[11px] text-[#8A8A94]">
                    {data.totalContacts.toLocaleString()} qualified signups
                  </p>
                )}
              </div>
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
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-4 text-[#FCA5A5] mb-5">
            <p className="font-semibold text-sm">Error loading data</p>
            <p className="text-xs mt-1 text-[#F87171]">{error}</p>
          </div>
        )}

        {/* Loading overlay */}
        <div
          className={`transition-opacity duration-200 space-y-6 ${loading ? "opacity-40 pointer-events-none" : "opacity-100"}`}
        >
          {data && (
            <>
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
                iconColor="#A78BFA"
              />
              <KPICards kpis={data.kpis} cohort={data.cohort} />

              <SectionHeading
                icon={Icons.Funnel}
                title="Funnel & Campaign Performance"
                description="How qualified signups progress through stages, and where they come from"
                iconColor="#6EE7B7"
              />
              <FunnelCard funnel={data.funnel} />
              <CampaignCard campaigns={data.campaigns} />

              <MetaSpendCard
                period={period}
                customStart={customStart}
                customEnd={customEnd}
              />

              <CampaignAnalysisCard
                period={period}
                customStart={customStart}
                customEnd={customEnd}
              />

              <SectionHeading
                icon={Icons.Shield}
                title="Quality & Team"
                description="DQ reasons by week and sales rep performance"
                iconColor="#FB923C"
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <DQChartCard data={data.dqWeekly} />
                <RepCard reps={data.reps} />
              </div>

              <SectionHeading
                icon={Icons.Globe}
                title="Cohort & Geography"
                description="Signup cohort progression, trial outcomes, and country/city breakdown"
                iconColor="#60A5FA"
              />
              <TrialOutcomesCard outcomes={data.trialOutcomes} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <CohortCard cohort={data.cohort} period={data.period} />
                <GeoCard geo={data.geo} />
              </div>
            </>
          )}
        </div>

        {/* Skeleton loading */}
        {!data && loading && (
          <div className="space-y-5 animate-pulse">
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-[#15151A] rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-[#15151A] rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="h-96 bg-[#15151A] rounded-2xl" />
              <div className="h-96 bg-[#15151A] rounded-2xl" />
            </div>
          </div>
        )}

        {!data && !loading && !error && (
          <div className="text-center py-20 text-[#8A8A94]">
            <p>No data available. Check your HubSpot API token.</p>
          </div>
        )}
      </main>
    </div>
  );
}
