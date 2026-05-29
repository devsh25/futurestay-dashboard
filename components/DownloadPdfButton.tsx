"use client";

import { useCallback, useState } from "react";
import { DownloadIcon, LoaderIcon } from "lucide-react";

/**
 * Download PDF button.
 *
 * Generates the PDF in-app with an explicit landscape orientation rather
 * than going through the browser's print dialog (CSS `@page` orientation is
 * ignored by Safari/Firefox/macOS Preview, so print-to-PDF could not
 * guarantee landscape). Here landscape is a hard parameter on the jsPDF
 * document, so the export is always landscape on every browser.
 *
 * The dashboard is rasterized at a forced 1440px desktop width so the
 * capture uses the dense multi-column layout instead of the mobile stack.
 *
 * Pagination is card-aware: rather than slicing the tall capture at fixed
 * intervals (which cut charts and tables in half across page breaks), we
 * measure where each card/section begins and ends — in the same 1440px
 * layout that gets captured, via html2canvas's `onclone` — and only break a
 * page in the gap between cards. A block taller than a single page is the
 * only thing that still splits, and that only happens for very long tables.
 */
export default function DownloadPdfButton() {
  const [generating, setGenerating] = useState(false);

  const handleDownload = useCallback(async () => {
    if (generating) return;
    const root = document.getElementById("dashboard-root");
    if (!root) return;

    setGenerating(true);
    document.documentElement.classList.add("pdf-capturing");

    // Filled in during onclone: safe Y positions (px, relative to the root's
    // top, measured in the 1440px clone layout) where a page break will land
    // in a gap between cards rather than through one. cloneRootH is that
    // layout's full content height, used to map these into canvas pixels.
    let breakYs: number[] = [];
    let cloneRootH = 0;

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(root, {
        backgroundColor: "#0A0F1A",
        scale: 2,
        windowWidth: 1440,
        useCORS: true,
        logging: false,
        onclone: (_doc: Document, clonedRoot: HTMLElement) => {
          const rootTop = clonedRoot.getBoundingClientRect().top;
          cloneRootH = clonedRoot.scrollHeight;

          // Candidate break points = the bottom edge of every "block": the
          // header banner, each direct child of the content column (section
          // headings, KPI band, charts), and every card within them. Their
          // bottoms are exactly the safe gaps to break on.
          const blocks: Element[] = [];
          const header = clonedRoot.querySelector("header");
          if (header) blocks.push(header);
          const content = clonedRoot.querySelector("#dashboard-content");
          if (content) {
            blocks.push(...Array.from(content.children));
            blocks.push(...Array.from(content.querySelectorAll('[data-slot="card"]')));
          }

          const set = new Set<number>();
          for (const el of blocks) {
            const bottom = el.getBoundingClientRect().bottom - rootTop;
            if (bottom > 0) set.add(Math.round(bottom));
          }
          breakYs = Array.from(set).sort((a, b) => a - b);
        },
      });

      // A4 landscape, millimetres.
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();   // 297
      const pageH = pdf.internal.pageSize.getHeight();  // 210
      const margin = 8;
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;

      // The image is scaled so its full width maps to contentW mm; derive how
      // many canvas pixels make up one page's printable height.
      const pxPerMm = canvas.width / contentW;
      const pagePx = contentH * pxPerMm;

      // Map clone-space break positions into canvas pixels.
      const scaleY = cloneRootH > 0 ? canvas.height / cloneRootH : 1;
      const breaks = breakYs
        .map((y) => y * scaleY)
        .filter((y) => y > 0 && y < canvas.height);

      // Greedy pagination: each page is as tall as fits (<= pagePx) and ends
      // on a break boundary so no card is sliced. If no boundary fits (a block
      // taller than a whole page), fall back to a hard cut at the page limit.
      const slices: Array<[number, number]> = [];
      let start = 0;
      while (start < canvas.height - 1) {
        // Whatever remains fits on one page — emit it whole (also avoids
        // breaking early on a low boundary when nothing follows it).
        if (canvas.height - start <= pagePx + 1) {
          slices.push([start, canvas.height]);
          break;
        }
        const limit = start + pagePx;
        let end = -1;
        for (const b of breaks) {
          if (b > start + 4 && b <= limit) end = b;
          else if (b > limit) break;
        }
        if (end < 0) end = Math.min(limit, canvas.height);
        slices.push([start, Math.round(end)]);
        start = Math.round(end);
      }

      // Render each slice onto its own page via a scratch canvas.
      const scratch = document.createElement("canvas");
      const sctx = scratch.getContext("2d");
      for (let i = 0; i < slices.length; i++) {
        const [y0, y1] = slices[i];
        const h = Math.max(1, y1 - y0);
        scratch.width = canvas.width;
        scratch.height = h;
        if (sctx) {
          sctx.clearRect(0, 0, scratch.width, scratch.height);
          sctx.drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);
        }
        const imgData = scratch.toDataURL("image/png");
        const imgH = h / pxPerMm; // slice height in mm

        if (i > 0) pdf.addPage();
        pdf.setFillColor(10, 15, 26); // #0A0F1A — page background
        pdf.rect(0, 0, pageW, pageH, "F");
        pdf.addImage(imgData, "PNG", margin, margin, contentW, imgH, undefined, "FAST");
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
