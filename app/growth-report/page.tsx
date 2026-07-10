"use client";

// Daily Growth Report — standalone page.
//
// Serves the pre-generated HTML files that ship in the repo under
// public/growth-reports/. The scheduled task on the operator's laptop
// generates these locally each morning and commits them to the repo,
// so Vercel serves them as static assets. No serverless compute path
// is touched here.
//
// If a date's snapshot isn't in the repo the iframe shows a 404 body
// from Next.js; we detect that with a HEAD probe and fall back to
// /growth-reports/latest.html.

import { useEffect, useState } from "react";

function etYesterday(): string {
  const y = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(y);
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default function GrowthReportPage() {
  const [date, setDate] = useState<string>(() => {
    if (typeof window === "undefined") return etYesterday();
    const url = new URL(window.location.href);
    return url.searchParams.get("date") || etYesterday();
  });
  const [iframeSrc, setIframeSrc] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "ready" | "fallback" | "missing">("loading");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState({}, "", url.toString());
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const dated = `/growth-reports/growth-report-${date}.html`;
    // Try the dated file. If it isn't in the repo yet (missed run, or
    // a date the user picked ahead of the daily generator), fall back
    // to latest.html which is always the most recent snapshot.
    fetch(dated, { method: "HEAD" }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setIframeSrc(dated);
        setStatus("ready");
      } else {
        return fetch("/growth-reports/latest.html", { method: "HEAD" }).then((r2) => {
          if (cancelled) return;
          if (r2.ok) {
            setIframeSrc("/growth-reports/latest.html");
            setStatus("fallback");
          } else {
            setIframeSrc("");
            setStatus("missing");
          }
        });
      }
    }).catch(() => {
      if (!cancelled) { setIframeSrc(""); setStatus("missing"); }
    });
    return () => { cancelled = true; };
  }, [date]);

  return (
    <div style={{ minHeight: "100vh", background: "#F6F7FB" }}>
      <div style={{
        maxWidth: 1120, margin: "0 auto", padding: "18px 28px",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        borderBottom: "1px solid #E7EAF2", background: "#FFFFFF",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(90deg,#3963E7,#543CE8)" }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#101728", letterSpacing: "-0.01em" }}>Growth Report</div>
            <div style={{ fontSize: 11, color: "#626C82", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600 }}>Daily</div>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#626C82" }}>
          Reporting day
          <input
            type="date"
            value={date}
            max={todayET()}
            onChange={(e) => setDate(e.target.value)}
            style={{
              padding: "6px 10px", borderRadius: 8, border: "1px solid #E7EAF2",
              fontSize: 13, color: "#101728", background: "#FFFFFF",
              fontFamily: "system-ui,-apple-system,sans-serif", fontVariantNumeric: "tabular-nums",
            }}
          />
        </label>
        <div style={{ marginLeft: "auto", fontSize: 12, color: status === "missing" ? "#F05C61" : "#626C82" }}>
          {status === "loading" && "Loading…"}
          {status === "ready" && `Snapshot for ${date}`}
          {status === "fallback" && `No snapshot for ${date}. Showing the latest available.`}
          {status === "missing" && "No snapshots have been generated yet."}
        </div>
      </div>
      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          title={`Growth report for ${date}`}
          style={{ width: "100%", height: "calc(100vh - 66px)", border: "none", background: "#F6F7FB" }}
        />
      ) : (
        <div style={{ maxWidth: 720, margin: "80px auto", padding: 20, fontSize: 14, color: "#626C82", lineHeight: 1.6 }}>
          <p style={{ fontSize: 16, color: "#101728", fontWeight: 600, marginBottom: 12 }}>No growth report snapshots yet.</p>
          <p>The daily generator writes files to <code>public/growth-reports/</code> in this repo. If you just deployed and haven't generated one yet, run the scheduled task on your machine or generate a snapshot manually and commit it.</p>
        </div>
      )}
    </div>
  );
}
