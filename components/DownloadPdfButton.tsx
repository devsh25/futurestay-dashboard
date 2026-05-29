"use client";

import { useCallback, useState } from "react";
import { DownloadIcon, LoaderIcon } from "lucide-react";

/**
 * Download PDF button.
 *
 * Generates the PDF in-app with an explicit landscape orientation rather
 * than going through the browser's print dialog. This matters because CSS
 * `@page { size: landscape }` is only honored by Chrome/Edge — Safari,
 * Firefox, and macOS Preview ignore it, so print-to-PDF could not
 * guarantee landscape. Here landscape is a hard parameter on the jsPDF
 * document, so the export is always landscape on every browser.
 *
 * The dashboard is rasterized at a forced 1440px desktop width so the
 * capture uses the dense multi-column layout (KPI band, rate grid, chart
 * columns) instead of collapsing to the mobile single-column stack that a
 * narrow print page would trigger.
 */
export default function DownloadPdfButton() {
  const [generating, setGenerating] = useState(false);

  const handleDownload = useCallback(async () => {
    if (generating) return;
    const root = document.getElementById("dashboard-root");
    if (!root) return;

    setGenerating(true);
    // Hide the interactive chrome (this button + the filter bar) from the
    // capture; everything tagged `no-print` is removed while this class is
    // on the document.
    document.documentElement.classList.add("pdf-capturing");

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(root, {
        backgroundColor: "#0A0F1A",
        // 2× for crisp text; force a desktop-width viewport in the clone so
        // Tailwind's lg/xl layout (multi-column) renders instead of mobile.
        scale: 2,
        windowWidth: 1440,
        useCORS: true,
        logging: false,
      });

      // A4 landscape, millimetres.
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();   // 297
      const pageH = pdf.internal.pageSize.getHeight();  // 210
      const margin = 8;
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;

      const imgW = contentW;
      const imgH = (canvas.height * imgW) / canvas.width;
      const pageCount = Math.max(1, Math.ceil(imgH / contentH));
      const imgData = canvas.toDataURL("image/png");

      for (let page = 0; page < pageCount; page++) {
        if (page > 0) pdf.addPage();
        // Paint the dark background first so the page margins/gaps aren't
        // left white around the captured image.
        pdf.setFillColor(10, 15, 26); // #0A0F1A
        pdf.rect(0, 0, pageW, pageH, "F");
        // Draw the full image shifted up by one page each iteration; the
        // viewer clips whatever falls outside the page box.
        pdf.addImage(imgData, "PNG", margin, margin - page * contentH, imgW, imgH, undefined, "FAST");
      }

      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`Futurestay Growth Dashboard — ${stamp}.pdf`);
    } finally {
      document.documentElement.classList.remove("pdf-capturing");
      setGenerating(false);
    }
  }, [generating]);

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={generating}
      aria-label="Download dashboard as PDF"
      aria-busy={generating}
      className="no-print inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#11182B] border border-[#1F2937] text-[13px] font-medium text-[#C9D1DC] hover:text-white hover:border-[#2A3650] hover:bg-[#161F33] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {generating ? (
        <LoaderIcon className="h-4 w-4 animate-spin" />
      ) : (
        <DownloadIcon className="h-4 w-4" />
      )}
      {generating ? "Generating…" : "Download PDF"}
    </button>
  );
}
