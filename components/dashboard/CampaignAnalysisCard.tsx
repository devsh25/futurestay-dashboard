"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CampaignAnalysisData, CampaignAnalysisRow, PeriodFilter } from "@/lib/types";

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0";
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(1)}%`;
}
function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

const TYPE_BADGE = {
  call: { bg: "bg-[#1E6FFF]/15", text: "text-[#1E6FFF]", border: "border-[#1E6FFF]/30" },
  self: { bg: "bg-[#60A5FA]/15", text: "text-[#60A5FA]", border: "border-[#60A5FA]/30" },
} as const;

const OPT_LABEL: Record<string, string> = {
  meetings: "meetings",
  signups: "signups",
  airbnb_connected: "airbnb_conn",
  google: "google ads",
};

function isGoogleRow(optSignal: string) {
  return optSignal === "google";
}

function dqColor(rate: number) {
  if (rate >= 20) return "text-[#F87171]";
  return "text-[#8B92A3]";
}

function shortCampaign(name: string): string {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return name;
  const filtered = parts.filter((p, i) => {
    if (p.toLowerCase() === "us & ca") return false;
    if (i === parts.length - 1 && p.toLowerCase() === "campaign") return false;
    return true;
  });
  return filtered.join(" | ");
}

// ---- Sort plumbing ----------------------------------------------------
//
// Each column has a key, a label (header text), an accessor that returns
// a number-or-string for ordering, and an alignment hint for header +
// cell rendering. Defining the table this way (instead of as 27 hard-
// coded TableHead elements) lets the header click handler stay generic:
// sortKey changes, accessor swaps, sort runs.

type SortDir = "asc" | "desc";
type ColAccessor = (r: CampaignAnalysisRow) => number | string | null;
interface Col {
  key: string;
  label: string;
  align: "left" | "right";
  title?: string;          // tooltip on the header
  accessor: ColAccessor;
  render: (r: CampaignAnalysisRow) => React.ReactNode;
}

const COLS: Col[] = [
  {
    key: "campaign", label: "Campaign", align: "left",
    accessor: (r) => r.campaign.toLowerCase(),
    render: (r) => (
      <TableCell className="font-medium text-[12px] text-white whitespace-nowrap" title={r.campaign}>
        {shortCampaign(r.campaign)}
      </TableCell>
    ),
  },
  {
    key: "type", label: "Type", align: "left",
    accessor: (r) => (isGoogleRow(r.optSignal) ? "google" : r.type),
    render: (r) => {
      const isGoogle = isGoogleRow(r.optSignal);
      const tb = isGoogle
        ? { bg: "bg-[#A78BFA]/15", text: "text-[#A78BFA]", border: "border-[#A78BFA]/30" }
        : TYPE_BADGE[r.type];
      const typeLabel = isGoogle ? "google" : r.type;
      return (
        <TableCell>
          <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${tb.bg} ${tb.text} ${tb.border}`}>
            {typeLabel}
          </span>
        </TableCell>
      );
    },
  },
  {
    key: "spend", label: "Spend", align: "right",
    accessor: (r) => r.spend,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtMoney(r.spend)}</TableCell>,
  },
  {
    key: "optSignal", label: "Opt Signal", align: "left",
    accessor: (r) => OPT_LABEL[r.optSignal] || r.optSignal,
    render: (r) => <TableCell className="text-[10px] text-[#8B92A3] whitespace-nowrap">{OPT_LABEL[r.optSignal] || r.optSignal}</TableCell>,
  },
  {
    key: "leads", label: "Leads", align: "right",
    accessor: (r) => r.leads,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtNum(r.leads)}</TableCell>,
  },
  {
    key: "meetingsBooked", label: "Mtgs Bkd", align: "right",
    accessor: (r) => r.meetingsBooked,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtNum(r.meetingsBooked)}</TableCell>,
  },
  {
    key: "meetingsHeld", label: "Mtgs Held", align: "right",
    title: "Booked minus classified no-shows (sales_call_outcome ∪ note keywords ∪ Aircall no-answer)",
    accessor: (r) => r.meetingsHeld,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-white">{fmtNum(r.meetingsHeld)}</TableCell>,
  },
  {
    key: "signups", label: "Signups", align: "right",
    accessor: (r) => r.signups,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtNum(r.signups)}</TableCell>,
  },
  {
    key: "qualifiedSignups", label: "Qual Sgnp", align: "right",
    accessor: (r) => r.qualifiedSignups,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtNum(r.qualifiedSignups)}</TableCell>,
  },
  {
    key: "airbnbConnected", label: "Airbnb Conn", align: "right",
    accessor: (r) => r.airbnbConnected,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#60A5FA]">{fmtNum(r.airbnbConnected)}</TableCell>,
  },
  {
    key: "readyToLaunch", label: "🚀 Ready", align: "right",
    accessor: (r) => r.readyToLaunch,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8B92A3]">{fmtNum(r.readyToLaunch)}</TableCell>,
  },
  {
    key: "airbnbDqRate", label: "A-DQ %", align: "right",
    accessor: (r) => r.airbnbDqRate,
    render: (r) => <TableCell className={`text-right font-mono text-[12px] tabular-nums ${dqColor(r.airbnbDqRate)}`}>{fmtPct(r.airbnbDqRate)}</TableCell>,
  },
  {
    key: "noShowMtgRate", label: "No-show % mtgs", align: "right",
    accessor: (r) => r.noShowMtgRate,
    render: (r) => <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.noShowMtgRate !== null && r.noShowMtgRate >= 30 ? "text-[#F87171]" : "text-[#8B92A3]"}`}>{fmtPct(r.noShowMtgRate)}</TableCell>,
  },
  {
    key: "dqMtgRate", label: "DQ % mtgs", align: "right",
    accessor: (r) => r.dqMtgRate,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8B92A3]">{fmtPct(r.dqMtgRate)}</TableCell>,
  },
  {
    key: "interestedMtgRate", label: "Int % mtgs", align: "right",
    accessor: (r) => r.interestedMtgRate,
    render: (r) => <TableCell className={`text-right font-mono text-[12px] tabular-nums ${r.interestedMtgRate !== null && r.interestedMtgRate >= 10 ? "text-[#60A5FA]" : "text-[#8B92A3]"}`}>{fmtPct(r.interestedMtgRate)}</TableCell>,
  },
  {
    key: "notInterestedMtgRate", label: "NotInt % mtgs", align: "right",
    accessor: (r) => r.notInterestedMtgRate,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8B92A3]">{fmtPct(r.notInterestedMtgRate)}</TableCell>,
  },
  {
    key: "outcomeCoverage", label: "Coverage % mtgs", align: "right",
    accessor: (r) => r.outcomeCoverage,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#1E6FFF]">{fmtPct(r.outcomeCoverage)}</TableCell>,
  },
  {
    key: "formToMeetingRate", label: "Form→Mtg %", align: "right",
    accessor: (r) => r.formToMeetingRate,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#8B92A3]">{fmtPct(r.formToMeetingRate)}</TableCell>,
  },
  {
    key: "costPerMeeting", label: "$/Mtg", align: "right",
    accessor: (r) => r.costPerMeeting,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(r.costPerMeeting)}</TableCell>,
  },
  {
    key: "trials", label: "Trials", align: "right",
    accessor: (r) => r.trials,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtNum(r.trials)}</TableCell>,
  },
  {
    key: "costPerTrial", label: "$/Trial", align: "right",
    accessor: (r) => r.costPerTrial,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#C9D1DC]">{fmtMoney(r.costPerTrial)}</TableCell>,
  },
  {
    key: "meetingToTrialRate", label: "Mtg → T", align: "right",
    title: "Trials / Meetings Held — call-funnel close rate",
    accessor: (r) => r.meetingToTrialRate,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#60A5FA]">{fmtPct(r.meetingToTrialRate)}</TableCell>,
  },
  {
    key: "qsToTrialRate", label: "QS → T", align: "right",
    accessor: (r) => r.qsToTrialRate,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#1E6FFF]">{fmtPct(r.qsToTrialRate)}</TableCell>,
  },
  {
    key: "customers", label: "Cust", align: "right",
    accessor: (r) => r.customers,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtNum(r.customers)}</TableCell>,
  },
  {
    key: "costPerCustomer", label: "$/Cust", align: "right",
    accessor: (r) => r.costPerCustomer,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-white font-semibold">{fmtMoney(r.costPerCustomer)}</TableCell>,
  },
  {
    key: "qsToCustomerRate", label: "QS → C", align: "right",
    accessor: (r) => r.qsToCustomerRate,
    render: (r) => <TableCell className="text-right font-mono text-[12px] tabular-nums text-[#60A5FA]">{fmtPct(r.qsToCustomerRate)}</TableCell>,
  },
];

/** Compare two accessor results, putting nulls last regardless of dir
 *  (a null cell shouldn't bubble to the top just because the sort flipped). */
function compareVals(a: number | string | null, b: number | string | null, dir: SortDir): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b));
  return dir === "asc" ? cmp : -cmp;
}

export default function CampaignAnalysisCard({
  period,
  customStart,
  customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [data, setData] = useState<CampaignAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Filter + sort UI state ----
  // Defaults chosen for the most common job-to-be-done: "show me what's
  // actually spending money, sorted highest first." Anything else is a
  // click away.
  const [platform, setPlatform] = useState<"all" | "meta" | "google">("all");
  const [hideZeroSpend, setHideZeroSpend] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    fetch(`/api/campaigns/analysis?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d: CampaignAnalysisData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [period, customStart, customEnd]);

  // Compute the filtered + sorted rows. Memo so a sort flip doesn't
  // re-run the search filter (and vice versa).
  const displayRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (platform === "meta")   rows = rows.filter((r) => !isGoogleRow(r.optSignal));
    if (platform === "google") rows = rows.filter((r) =>  isGoogleRow(r.optSignal));
    if (hideZeroSpend) rows = rows.filter((r) => r.spend > 0);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.campaign.toLowerCase().includes(q));
    const col = COLS.find((c) => c.key === sortKey);
    if (col) {
      rows = [...rows].sort((a, b) => compareVals(col.accessor(a), col.accessor(b), sortDir));
    }
    return rows;
  }, [data, platform, hideZeroSpend, search, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default: descending for numbers (highest first is
      // almost always what you want); ascending for the name column.
      setSortDir(key === "campaign" || key === "type" || key === "optSignal" ? "asc" : "desc");
    }
  };

  const totalCount = data?.rows.length ?? 0;
  const shownCount = displayRows.length;

  return (
    <Card className="bg-[#11182B] border border-[#1F2937] rounded-2xl shadow-none">
      <CardHeader className="pb-3 border-b border-[#1F2937]">
        <CardTitle className="flex items-center justify-between text-[15px] font-semibold text-white tracking-tight">
          <span>Campaign Analysis</span>
          <Badge className="bg-[#1877F2]/15 text-[#60A5FA] border-[#1877F2]/25 text-[10px] font-medium">
            Meta + Google × HubSpot funnel
          </Badge>
        </CardTitle>
        <p className="text-[13px] text-[#8B92A3] mt-1.5 leading-relaxed">
          <span className="text-[#1E6FFF] font-medium">Cohort-based.</span>{" "}
          Spend (Meta + Google APIs) joined to HubSpot contacts whose <code className="text-[#C9C9D1]">createdate</code> is in the window AND who attribute to the campaign / ad group via <code className="text-[#C9C9D1]">first_touch_utm_campaign</code> ∪ <code className="text-[#C9C9D1]">hs_analytics_source_data_2</code> ∪ landing-page URL fallback. QS → T and QS → C are conversion rates from <span className="text-white">Qualified Signups</span> (signups − Airbnb DQ) to Trial / Customer for that cohort.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data && (
          <p className="text-[12px] text-[#8B92A3] py-8 text-center">Loading campaign analysis…</p>
        )}
        {error && (
          <div className="bg-[#2D1B21] border border-[#EF4444]/30 rounded-xl p-3 text-[#FCA5A5] text-[12px]">
            <p className="font-semibold">Couldn&apos;t load campaign analysis</p>
            <p className="text-[11px] mt-1">{error}</p>
          </div>
        )}
        {data && (
          <>
            <p className="text-[12px] text-[#8B92A3] mb-3">
              Window: <span className="text-white font-mono">{data.since}</span> → <span className="text-white font-mono">{data.until}</span>
              <span className="ml-3 text-[11px] text-[#5B6478]">
                Spend = ad-platform API · Funnel metrics = HubSpot · WIX/HOPPER + pre-launch fallback victims excluded
              </span>
            </p>

            {/* Filter row — pills + search + counter. Matches the FunnelCard
                dropdown's pill geometry (h-8, rounded-full, dark bg). */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <PillGroup
                value={platform}
                onChange={setPlatform}
                options={[
                  { value: "all", label: "All" },
                  { value: "meta", label: "Meta" },
                  { value: "google", label: "Google" },
                ]}
              />
              <button
                type="button"
                onClick={() => setHideZeroSpend((v) => !v)}
                className={`h-8 px-3 rounded-full text-[12px] font-medium transition-colors cursor-pointer outline-none border ${
                  hideZeroSpend
                    ? "bg-[#1E6FFF]/15 border-[#1E6FFF]/40 text-[#60A5FA] hover:border-[#1E6FFF]/60"
                    : "bg-[#0E1422] border-[#1F2937] text-[#8B92A3] hover:border-[#1E6FFF]/50 hover:text-white"
                }`}
                aria-pressed={hideZeroSpend}
              >
                {hideZeroSpend ? "✓ " : ""}Hide $0 spend
              </button>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search campaigns…"
                className="h-8 px-3 rounded-full text-[12px] font-medium bg-[#0E1422] border border-[#1F2937] text-white placeholder:text-[#5B6478] hover:border-[#1E6FFF]/50 transition-colors outline-none focus:border-[#1E6FFF]/60 w-48"
              />
              {(platform !== "all" || hideZeroSpend || search.trim()) && (
                <button
                  type="button"
                  onClick={() => { setPlatform("all"); setHideZeroSpend(false); setSearch(""); }}
                  className="h-8 px-3 rounded-full text-[12px] font-medium bg-transparent border border-transparent text-[#5B6478] hover:text-white transition-colors cursor-pointer outline-none"
                >
                  Reset
                </button>
              )}
              <span className="text-[11px] text-[#5B6478] ml-auto">
                <span className="text-white font-mono">{shownCount}</span> of <span className="font-mono">{totalCount}</span> {totalCount === 1 ? "campaign" : "campaigns"}
              </span>
            </div>

            <div className="overflow-x-auto -mx-2">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#1F2937] hover:bg-transparent">
                    {COLS.map((col) => {
                      const active = sortKey === col.key;
                      return (
                        <TableHead
                          key={col.key}
                          title={col.title}
                          onClick={() => onSort(col.key)}
                          className={`text-[10px] uppercase tracking-wider font-semibold cursor-pointer select-none transition-colors ${
                            col.align === "right" ? "text-right" : ""
                          } ${active ? "text-[#1E6FFF]" : "text-[#8B92A3] hover:text-white"}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.align === "right" && <SortArrow active={active} dir={sortDir} />}
                            <span>{col.label}</span>
                            {col.align === "left" && <SortArrow active={active} dir={sortDir} />}
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((r) => (
                    <TableRow key={r.campaign} className="border-[#1F2937] hover:bg-[#0E1422] transition-colors">
                      {COLS.map((col) => (
                        <React.Fragment key={col.key}>{col.render(r)}</React.Fragment>
                      ))}
                    </TableRow>
                  ))}
                  {displayRows.length === 0 && (
                    <TableRow className="border-[#1F2937]">
                      <TableCell colSpan={COLS.length} className="text-center text-[12px] text-[#8B92A3] py-8">
                        No campaigns match these filters.
                        <button onClick={() => { setPlatform("all"); setHideZeroSpend(false); setSearch(""); }} className="ml-2 text-[#60A5FA] hover:text-white underline">Reset filters</button>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 pt-3 border-t border-[#1F2937] flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[#5B6478]">
              <span><span className="text-[#1E6FFF] font-semibold">call</span> = Meta optimizes for meetings</span>
              <span><span className="text-[#60A5FA] font-semibold">self</span> = Meta optimizes for signups or airbnb_connected</span>
              <span><span className="text-[#A78BFA] font-semibold">google</span> = Google Ads ad group (or Pmax rollup)</span>
              <span>Qual Sgnp = Signups − Airbnb DQ</span>
              <span>Customers = real paid (Amplify/Flex), excl. &lt;2-day cancels</span>
              <span>Click any column header to sort</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Small UI helpers ------------------------------------------------

function PillGroup<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  // Segmented-control style: single rounded container with internal
  // dividers, active segment filled with the accent.
  return (
    <div className="inline-flex h-8 rounded-full bg-[#0E1422] border border-[#1F2937] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3 rounded-full text-[12px] font-medium transition-colors cursor-pointer outline-none ${
              active
                ? "bg-[#1E6FFF] text-white"
                : "text-[#8B92A3] hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  // Subtle by default, accent-colored when active. The down arrow
  // (▼) means "highest at top" (descending) which is the dashboard's
  // dominant default — keep that convention so the arrow direction
  // matches a user's mental model of "biggest stuff first."
  if (!active) return <span className="text-[#3A4254] text-[8px]" aria-hidden>▾</span>;
  return <span className="text-[#1E6FFF] text-[8px]" aria-hidden>{dir === "desc" ? "▼" : "▲"}</span>;
}
