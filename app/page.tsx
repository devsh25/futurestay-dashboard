"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardData, PeriodFilter } from "@/lib/types";
import FilterBar from "@/components/FilterBar";
import KPICards from "@/components/dashboard/KPICards";
import FunnelCard from "@/components/dashboard/FunnelCard";
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
              {isMaturityRisky && (
                <div className="bg-[#2A1F0F] border border-[#F59E0B]/30 rounded-xl p-4 text-[#FCD34D] flex items-start gap-3">
                  <span className="text-lg leading-none mt-0.5">⚠</span>
                  <div className="flex-1">
                    <p className="font-semibold text-[13px] text-[#FCD34D]">
                      Cohort still maturing
                    </p>
                    <p className="text-[12px] mt-1 text-[#FBBF24]/90 leading-relaxed">
                      Your end date <span className="font-mono">{customEnd}</span> is within the last 14 days. Trial and Customer counts for recent signups will be undercounted because the median signup-to-customer time is ~14 days. Set the end date to <button onClick={() => setCustomEnd(tMinus14Iso)} className="underline hover:text-white font-mono">{tMinus14Iso}</button> for fully-matured numbers.
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
