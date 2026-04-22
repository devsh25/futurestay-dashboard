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
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="bg-white border-b border-[#E8EAF0] sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Futurestay logo mark */}
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3863E6] to-[#543CE8] flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-[#111111] tracking-tight">
                  Futurestay Growth Dashboard
                </h1>
                {data && (
                  <p className="text-[11px] text-[#656C74]">
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
      <main className="max-w-[1400px] mx-auto px-6 py-5">
        {error && (
          <div className="bg-[#FFC5E3] border border-[#801F50]/20 rounded-xl p-4 text-[#801F50] mb-5">
            <p className="font-semibold text-sm">Error loading data</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        )}

        {/* Loading overlay */}
        <div
          className={`transition-opacity duration-200 space-y-5 ${loading ? "opacity-40 pointer-events-none" : "opacity-100"}`}
        >
          {data && (
            <>
              <KPICards kpis={data.kpis} cohort={data.cohort} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <FunnelCard funnel={data.funnel} />
                <CampaignCard campaigns={data.campaigns} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <DQChartCard data={data.dqWeekly} />
                <RepCard reps={data.reps} />
              </div>

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
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-white rounded-xl border border-[#E8EAF0]" />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 bg-white rounded-xl border border-[#E8EAF0]" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="h-96 bg-white rounded-xl border border-[#E8EAF0]" />
              <div className="h-96 bg-white rounded-xl border border-[#E8EAF0]" />
            </div>
          </div>
        )}

        {!data && !loading && !error && (
          <div className="text-center py-20 text-[#656C74]">
            <p>No data available. Check your HubSpot API token.</p>
          </div>
        )}
      </main>
    </div>
  );
}
