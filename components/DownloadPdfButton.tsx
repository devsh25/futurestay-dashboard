"use client";

import { useCallback } from "react";
import { DownloadIcon } from "lucide-react";

/**
 * Download PDF button.
 *
 * Uses the browser's native print-to-PDF rather than a canvas-snapshot
 * library (html2canvas/jsPDF). That keeps the export pixel-perfect — the
 * recharts SVGs, the dark theme, and Tailwind v4's oklch-based colors all
 * render through the real browser engine instead of a fragile re-paint.
 * The actual layout for the exported document lives in the `@media print`
 * block in app/globals.css.
 */
export default function DownloadPdfButton() {
  const handleDownload = useCallback(() => {
    // Browsers seed the "Save as PDF" filename from document.title, so
    // swap in a descriptive, dated title for the duration of the print
    // dialog and restore it once printing is done (or cancelled).
    const originalTitle = document.title;
    const stamp = new Date().toISOString().slice(0, 10);
    document.title = `Futurestay Growth Dashboard — ${stamp}`;

    const restore = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);

    window.print();
  }, []);

  return (
    <button
      type="button"
      onClick={handleDownload}
      aria-label="Download dashboard as PDF"
      className="no-print inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#11182B] border border-[#1F2937] text-[13px] font-medium text-[#C9D1DC] hover:text-white hover:border-[#2A3650] hover:bg-[#161F33] transition-colors"
    >
      <DownloadIcon className="h-4 w-4" />
      Download PDF
    </button>
  );
}
