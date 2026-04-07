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
  { value: "thisWeek", label: "This week" },
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
        className="inline-flex items-center justify-between h-9 px-3 text-[13px] font-medium min-w-[140px] max-w-[220px] rounded-lg border border-[#E8EAF0] bg-white text-[#111111] hover:border-[#3863E6]/40 transition-colors cursor-pointer"
      >
        <span className="truncate">{displayText}</span>
        <svg
          className="ml-1 h-4 w-4 shrink-0 opacity-50"
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
      <PopoverContent className="w-[200px] p-2" align="start">
        <div className="space-y-1">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
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
          <div className="border-t mt-1 pt-1">
            <button
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
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
        <SelectTrigger className="w-[150px] h-9">
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {period === "custom" && (
        <>
          <input
            type="date"
            value={customStart}
            onChange={(e) => onCustomStartChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => onCustomEndChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
        </>
      )}

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
        <span className="text-sm text-muted-foreground animate-pulse">
          Loading...
        </span>
      )}
    </div>
  );
}
