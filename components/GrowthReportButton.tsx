"use client";

// Growth Report button. Sits in the dashboard header next to Download
// PDF / Download Data. Click opens /growth-report in a new tab with a
// date picker defaulting to yesterday ET.

import { FileTextIcon } from "lucide-react";

export default function GrowthReportButton() {
  return (
    <a
      href="/growth-report"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the daily growth report in a new tab"
      className="no-print inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#11182B] border border-[#1F2937] text-[13px] font-medium text-[#C9D1DC] hover:text-white hover:border-[#2A3650] hover:bg-[#161F33] transition-colors"
    >
      <FileTextIcon className="h-4 w-4" />
      Growth Report
    </a>
  );
}
