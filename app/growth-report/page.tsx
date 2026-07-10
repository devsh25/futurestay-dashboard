"use client";

// Daily Growth Report — standalone page. Opens in a new tab from the
// dashboard "Growth Report" button. The report itself is a self-
// contained HTML document served by /api/growth-report; this page
// wraps it in a tiny chrome (date picker + status).
//
// The iframe uses the API URL directly rather than fetching HTML into
// srcdoc. That lets the browser show its native progress state during
// the 30–60s cold compute, and it keeps this component small.

import { useEffect, useState, useRef } from "react";

function etYesterday(): string {
  // Compute in the browser's local time then reformat to America/New_York.
  const now = new Date();
  const y = new Date(now.getTime() - 86_400_000);
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
  // Read initial date from URL if present; else yesterday ET.
  const [date, setDate] = useState<string>(() => {
    if (typeof window === "undefined") return etYesterday();
    const url = new URL(window.location.href);
    return url.searchParams.get("date") || etYesterday();
  });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string>("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Keep the URL in sync with the selected date so it's shareable.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState({}, "", url.toString());
  }, [date]);

  // Kick a load whenever the date changes.
  useEffect(() => {
    setStatus("loading");
    setErrMsg("");
    // Ping the API separately (as JSON) purely to surface errors + know
    // when the compute finishes. The iframe below loads in parallel and
    // renders the HTML directly.
    let cancelled = false;
    fetch(`/api/growth-report?date=${date}&format=json`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((e: Error) => {
        if (!cancelled) { setErrMsg(e.message); setStatus("error"); }
      });
    return () => { cancelled = true; };
  }, [date]);

  const iframeSrc = `/api/growth-report?date=${encodeURIComponent(date)}&format=html`;
  const slackHref = `/api/growth-report?date=${encodeURIComponent(date)}&format=slack`;

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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <a
            href={slackHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12, color: "#3963E7", textDecoration: "none", fontWeight: 600,
              padding: "6px 10px", borderRadius: 8, border: "1px solid #E7EAF2", background: "#FFFFFF",
            }}
          >
            View Slack text
          </a>
          <span style={{ fontSize: 12, color: status === "error" ? "#F05C61" : "#626C82" }}>
            {status === "loading" && `Computing… (up to 60s on a cold cache)`}
            {status === "ready" && `Ready`}
            {status === "error" && `Error: ${errMsg}`}
            {status === "idle" && ""}
          </span>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title={`Growth report for ${date}`}
        style={{ width: "100%", height: "calc(100vh - 66px)", border: "none", background: "#F6F7FB" }}
      />
    </div>
  );
}
