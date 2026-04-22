"use client";

import { PeriodFilter } from "@/lib/types";

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  last7d: "Last 7 days",
  last30d: "Last 30 days",
  thisWeek: "This week",
  thisMonth: "This month",
  thisQuarter: "This quarter",
  allTime: "Since Jan 2026",
  custom: "Custom range",
};

const COUNTRY_LABEL: Record<string, string> = {
  "united states": "United States",
  canada: "Canada",
  mexico: "Mexico",
};

function Chip({
  label,
  prefix,
  onRemove,
  variant = "default",
}: {
  label: string;
  prefix?: string;
  onRemove?: () => void;
  variant?: "default" | "period";
}) {
  const base =
    variant === "period"
      ? "bg-[#F1F4FF] text-[#3863E6] border-[#3863E6]/20"
      : "bg-white text-[#111111] border-[#E8EAF0]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-full border px-3 py-1 ${base}`}
    >
      {prefix && <span className="text-[#656C74] font-normal">{prefix}</span>}
      <span>{label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 text-[#B0B7BF] hover:text-[#111111] transition-colors"
          aria-label={`Remove ${label}`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

export default function ActiveFilterChips({
  period,
  customStart,
  customEnd,
  countries,
  channels,
  onCountriesChange,
  onChannelsChange,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
  countries: string[];
  channels: string[];
  onCountriesChange: (v: string[]) => void;
  onChannelsChange: (v: string[]) => void;
  onPeriodChange: (p: PeriodFilter) => void;
}) {
  const periodLabel =
    period === "custom" ? `${customStart} \u2192 ${customEnd}` : PERIOD_LABELS[period];

  const hasAnyFilter = countries.length > 0 || channels.length > 0;

  return (
    <div className="flex items-center flex-wrap gap-2">
      <Chip label={periodLabel} prefix="Period:" variant="period" />

      {countries.map((c) => (
        <Chip
          key={c}
          prefix="Country:"
          label={COUNTRY_LABEL[c] || c}
          onRemove={() => onCountriesChange(countries.filter((x) => x !== c))}
        />
      ))}

      {channels.map((c) => (
        <Chip
          key={c}
          prefix="Channel:"
          label={c}
          onRemove={() => onChannelsChange(channels.filter((x) => x !== c))}
        />
      ))}

      {hasAnyFilter && (
        <button
          onClick={() => {
            onCountriesChange([]);
            onChannelsChange([]);
          }}
          className="text-[12px] text-[#656C74] hover:text-[#111111] underline-offset-2 hover:underline ml-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
