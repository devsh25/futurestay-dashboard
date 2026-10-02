"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PeriodFilter } from "@/lib/types";
import { resolvedDateRange, toIsoDate } from "@/lib/period";

interface FilterBarProps {
  period: PeriodFilter;
  onPeriodChange: (period: PeriodFilter) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  countries: string[];
  onCountriesChange: (countries: string[]) => void;
  channels: string[];
  onChannelsChange: (channels: string[]) => void;
  loading?: boolean;
}

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: "last7d", label: "Last 7 days" },
  { value: "last30d", label: "Last 30 days" },
  { value: "thisWeek", label: "This week (Mon–Sun)" },
  { value: "lastWeek", label: "Last week (Mon–Sun)" },
  { value: "thisMonth", label: "This month" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "allTime", label: "Since Jan 2026" },
  { value: "custom", label: "Custom range" },
];

// COUNTRY_OPTIONS, CHANNEL_OPTIONS and MultiCheckPopover removed with
// the "All Countries" / "All Channels" dropdowns. The country/channel
// filter props stay on this component for now so the dashboard still
// compiles when callers pass `countries=[]` / `channels=[]` through to
// the downstream endpoints.

export default function FilterBar({
  period,
  onPeriodChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  countries,
  onCountriesChange,
  channels,
  onChannelsChange,
  loading,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={period}
        onValueChange={(v) => onPeriodChange((v ?? "allTime") as PeriodFilter)}
      >
        <SelectTrigger className="w-[160px] h-9 px-4 rounded-full bg-[#11182B] border-[#1F2937] text-[#C9D1DC] hover:border-[#1E6FFF]/50 hover:bg-[#1A2235] hover:text-white text-[13px]">
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent className="bg-[#0E1422] border-[#1F2937] rounded-xl">
          {PERIOD_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-[#C9D1DC] focus:bg-[#1A2235] focus:text-white">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Always show the resolved start → end of the active window.
          For "custom" the inputs are editable. For preset periods
          (Last 7d / This week / etc.) the inputs are read-only and
          display the dates the preset resolves to — so the user
          never has to wonder "what date range am I looking at?". */}
      {(() => {
        const { start, end } = resolvedDateRange(period, customStart, customEnd);
        const isCustom = period === "custom";
        const startVal = isCustom ? customStart : toIsoDate(start);
        const endVal = isCustom ? customEnd : toIsoDate(end);
        const base = "h-9 rounded-full border border-[#1F2937] px-3.5 text-[13px] transition-colors [color-scheme:dark]";
        const editable = "bg-[#11182B] text-[#C9D1DC] hover:border-[#1E6FFF]/50 hover:bg-[#1A2235] cursor-pointer";
        const readOnly = "bg-[#0E1422] text-[#8B92A3] cursor-default";
        return (
          <>
            <input
              type="date"
              value={startVal}
              onChange={(e) => {
                // Editing a non-custom date switches the period to
                // custom and applies the new start.
                if (!isCustom) onPeriodChange("custom");
                onCustomStartChange(e.target.value);
              }}
              readOnly={!isCustom}
              title={isCustom ? "Custom start date" : `Resolved start for ${period}`}
              className={`${base} ${isCustom ? editable : readOnly}`}
            />
            <span className="text-[13px] text-[#5B6478]">→</span>
            <input
              type="date"
              value={endVal}
              onChange={(e) => {
                if (!isCustom) onPeriodChange("custom");
                onCustomEndChange(e.target.value);
              }}
              readOnly={!isCustom}
              title={isCustom ? "Custom end date" : `Resolved end for ${period}`}
              className={`${base} ${isCustom ? editable : readOnly}`}
            />
          </>
        );
      })()}

      {loading && (
        <span className="text-sm text-[#1E6FFF] animate-pulse">
          Loading…
        </span>
      )}
    </div>
  );
}
