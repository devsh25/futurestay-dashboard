"use client";

import { useCallback, useState } from "react";
import { TableIcon, LoaderIcon } from "lucide-react";
import type { PeriodFilter } from "@/lib/types";

/**
 * Download Data button — sits next to Download PDF.
 *
 * Hits /api/export with the dashboard's current period selection and
 * triggers a browser download of the resulting zip. The zip contains
 * three CSVs (campaign analysis, daily run-rate, funnel overview) plus
 * a README — see the route handler for the column dictionary.
 *
 * Designed for handoff to an external analyst (or Claude) — every file
 * is pre-aggregated, no PII, methodology documented in the README.
 */
export default function DownloadDataButton({
  period,
  customStart,
  customEnd,
}: {
  period: PeriodFilter;
  customStart: string;
  customEnd: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("start", customStart);
        params.set("end", customEnd);
      }
      const res = await fetch(`/api/export?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      // Trigger the browser download — keep the server's filename if
      // it set one, else fall back to today's date stamp.
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `futurestay-dashboard-export-${new Date().toISOString().slice(0, 10)}.zip`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
      // Auto-clear the error so the next click works without page reload
      setTimeout(() => setError(null), 5000);
    } finally {
      setDownloading(false);
    }
  }, [downloading, period, customStart, customEnd]);

  return (
    <button
      type="button"
      onClick={handle}
      disabled={downloading}
      aria-label="Download dashboard data as CSV bundle"
      aria-busy={downloading}
      title={error || "Download all dashboard data as a CSV bundle (campaign analysis, daily run-rate, funnel overview, README)"}
      className={`no-print inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#11182B] border text-[13px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        error
          ? "border-[#F87171]/50 text-[#FCA5A5]"
          : "border-[#1F2937] text-[#C9D1DC] hover:text-white hover:border-[#2A3650] hover:bg-[#161F33]"
      }`}
    >
      {downloading ? (
        <LoaderIcon className="h-4 w-4 animate-spin" />
      ) : (
        <TableIcon className="h-4 w-4" />
      )}
      {downloading ? "Bundling…" : error ? "Try again" : "Download Data"}
    </button>
  );
}
