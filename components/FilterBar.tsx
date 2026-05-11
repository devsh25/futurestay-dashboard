"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { PeriodFilter, CHANNEL_OPTIONS } from "@/lib/types";
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

const COUNTRY_OPTIONS = [
  { value: "united states", label: "United States" },
  { value: "canada", label: "Canada" },
  { value: "mexico", label: "Mexico" },
];

function MultiCheckPopover({
  label,
  options,
  selected,
  onChange,
  allLabel,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const displayText =
    selected.length === 0
      ? allLabel
      : selected.length === options.length
        ? allLabel
        : selected
            .map((s) => options.find((o) => o.value === s)?.label || s)
            .join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-between h-9 px-4 text-[13px] font-medium min-w-[140px] max-w-[220px] rounded-full border border-[#1F2937] bg-[#11182B] text-[#C9D1DC] hover:border-[#1E6FFF]/50 hover:bg-[#1A2235] hover:text-white transition-colors cursor-pointer"
      >
        <span className="truncate">{displayText}</span>
        <svg
          className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-60"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2 bg-[#0E1422] border-[#1F2937]" align="start">
        <div className="space-y-1">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#1A2235] cursor-pointer text-sm text-[#C9D1DC]"
            >
              <Checkbox
                checked={
                  selected.length === 0 || selected.includes(opt.value)
                }
                onCheckedChange={() => toggle(opt.value)}
              />
              {opt.label}
            </label>
          ))}
          <div className="border-t border-[#1F2937] mt-1 pt-1">
            <button
              className="text-xs text-[#8B92A3] hover:text-white px-2 py-1"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

      <MultiCheckPopover
        label="Country"
        options={COUNTRY_OPTIONS}
        selected={countries}
        onChange={onCountriesChange}
        allLabel="All Countries"
      />

      <MultiCheckPopover
        label="Channel"
        options={CHANNEL_OPTIONS.map((c) => ({ value: c, label: c }))}
        selected={channels}
        onChange={onChannelsChange}
        allLabel="All Channels"
      />

      {loading && (
        <span className="text-sm text-[#1E6FFF] animate-pulse">
          Loading…
        </span>
      )}
    </div>
  );
}
