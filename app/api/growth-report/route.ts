import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { computeGrowthReport, renderGrowthReportHtml, renderGrowthReportSlack, type GrowthReportData } from "@/lib/growth-report";

/**
 * Daily Growth Report — API endpoint.
 *
 *   GET /api/growth-report?date=YYYY-MM-DD&format=html|slack|json
 *
 * All three formats come from the same `computeGrowthReport` call, so the
 * numbers can never disagree.
 *
 *   format=html   → self-contained HTML document with inline styles.
 *                   Meant for embedding via <iframe src=...>.
 *   format=slack  → plain text with asterisks/backticks/emoji, ready to
 *                   paste into Slack unchanged.
 *   format=json   → the raw computed data object.
 *
 * Default format is HTML because the primary consumer is the /growth-report
 * page's iframe. Default date is the previous ET calendar day.
 *
 * Server-side cache keyed by date: same-date requests within 10 minutes
 * skip the 30-60s recompute. The underlying fetchAllContacts() has its
 * own 5-min cache too, which further speeds up first cold hits.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cold compute pulls HubSpot contacts + 6 Meta Graph windows + 2
// Google Ads queries and can take 40 to 60 seconds. Vercel's default
// function timeout is 60s on Pro / 10s on Hobby. Bump to 300 so cold
// runs finish inside the window instead of getting killed mid-flight.
// If deployed on Hobby the runtime ignores anything over 10 seconds;
// switch this deployment to Pro (or precompute the report via a cron
// snapshot) if the request keeps timing out.
export const maxDuration = 300;
export const runtime = "nodejs";

type Format = "html" | "slack" | "json";

interface CachedReport {
  data: GrowthReportData;
  at: number;
}
const CACHE_TTL_MS = 10 * 60 * 1000;
const reportCache = new Map<string, CachedReport>();

function etYesterday(): string {
  const now = new Date();
  const y = new Date(now.getTime() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(y);
}

async function getReport(date: string): Promise<GrowthReportData> {
  const now = Date.now();
  const cached = reportCache.get(date);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;
  const data = await computeGrowthReport(date);
  reportCache.set(date, { data, at: now });
  return data;
}

/** Look up the precomputed report artefact for a given date in Vercel Blob.
 *  Returns a fetchable URL if the file exists, or null. Silently returns
 *  null if the Blob store isn't configured (no BLOB_READ_WRITE_TOKEN) so
 *  local dev and pre-provisioned environments keep working. */
async function precomputedUrl(date: string, ext: "json" | "html" | "txt"): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const key = `growth-report/${date}/report.${ext}`;
    const res = await list({ prefix: key, limit: 1 });
    const hit = res.blobs.find((b) => b.pathname === key);
    return hit ? hit.url : null;
  } catch (err) {
    console.error("[growth-report] Blob lookup failed:", err);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const rawDate = params.get("date") || etYesterday();
    // Validate the date param so callers can't inject junk into cache keys.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return NextResponse.json({ error: "Invalid date. Expected YYYY-MM-DD." }, { status: 400 });
    }
    const format = ((params.get("format") || "html").toLowerCase()) as Format;
    // `?live=1` bypasses the precomputed artefact and forces a fresh
    // compute. Useful for verifying that the daily snapshot matches
    // what a live run would produce.
    const forceLive = params.get("live") === "1";

    // Fast path: if the daily cron has already written a precomputed
    // artefact for this date, serve it verbatim. Snapshot HTML/text is
    // byte-identical to what a live compute would render, since both
    // renderers are pure functions of the same computed data.
    if (!forceLive) {
      const ext = format === "slack" ? "txt" : format === "json" ? "json" : "html";
      const url = await precomputedUrl(rawDate, ext);
      if (url) {
        const upstream = await fetch(url, { cache: "no-store" });
        if (upstream.ok) {
          const body = await upstream.arrayBuffer();
          const contentType =
            format === "slack" ? "text/plain; charset=utf-8"
            : format === "json" ? "application/json"
            : "text/html; charset=utf-8";
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "no-store",
              "x-growth-report-source": "precomputed",
            },
          });
        }
      }
    }

    const data = await getReport(rawDate);

    if (format === "slack") {
      const text = renderGrowthReportSlack(data);
      return new Response(text, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (format === "json") {
      return NextResponse.json(data);
    }
    // Default: HTML
    const body = renderGrowthReportHtml(data);
    // Wrap the body fragment (which contains only <style> + <div>) in a
    // real document. Font is left to system-ui via the inline stylesheet.
    const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Futurestay Growth Report ${data.yesterday}</title></head><body>${body}</body></html>`;
    return new Response(doc, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/growth-report] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
