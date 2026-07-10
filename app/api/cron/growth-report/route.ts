import { NextRequest, NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { computeGrowthReport, renderGrowthReportHtml, renderGrowthReportSlack } from "@/lib/growth-report";

/**
 * Daily precompute of the growth report. Runs on a Vercel cron
 * (see vercel.json) around 08:15 ET each morning, writes yesterday's
 * report as three artefacts to Vercel Blob:
 *
 *   growth-report/YYYY-MM-DD/report.json
 *   growth-report/YYYY-MM-DD/report.html
 *   growth-report/YYYY-MM-DD/report.txt   (Slack-friendly text)
 *
 * These become the fast path for /api/growth-report — a button click
 * returns the precomputed HTML instantly instead of running the
 * 40-60s live compute inside the request.
 *
 * Auth: Vercel automatically sets an `x-vercel-cron` header on invocations
 * from its scheduler. We also accept a `?secret=` query parameter for
 * manual re-runs — set CRON_SECRET in the environment.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;
export const runtime = "nodejs";

function etDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function isAuthorized(req: NextRequest): boolean {
  // Vercel cron requests include this header, signed by Vercel — the
  // simplest way to verify a request came from the scheduler.
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (isVercelCron) return true;

  // Manual re-runs: require ?secret=<CRON_SECRET>. Also accept the
  // Authorization: Bearer <CRON_SECRET> shape for convenience.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (qs && qs === secret) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Manual override for regenerating a specific date. Default is
  // "yesterday ET" which is what the daily 8am run wants.
  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : etDate(-1);

  try {
    const startedAt = Date.now();
    const data = await computeGrowthReport(date);
    const computedMs = Date.now() - startedAt;

    const html = renderGrowthReportHtml(data);
    const wrappedHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Futurestay Growth Report ${data.yesterday}</title></head><body>${html}</body></html>`;
    const slack = renderGrowthReportSlack(data);
    const json = JSON.stringify(data);

    // Write all three artefacts in parallel. `allowOverwrite` lets us
    // re-run for the same date without erroring.
    const base = `growth-report/${date}`;
    const [jsonBlob, htmlBlob, txtBlob] = await Promise.all([
      put(`${base}/report.json`, json, {
        access: "public", contentType: "application/json", allowOverwrite: true, addRandomSuffix: false,
      }),
      put(`${base}/report.html`, wrappedHtml, {
        access: "public", contentType: "text/html; charset=utf-8", allowOverwrite: true, addRandomSuffix: false,
      }),
      put(`${base}/report.txt`, slack, {
        access: "public", contentType: "text/plain; charset=utf-8", allowOverwrite: true, addRandomSuffix: false,
      }),
    ]);

    return NextResponse.json({
      ok: true, date,
      computedMs,
      urls: { json: jsonBlob.url, html: htmlBlob.url, txt: txtBlob.url },
    });
  } catch (err) {
    console.error("[cron/growth-report] failed:", err);
    return NextResponse.json(
      { ok: false, date, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Convenience: expose the most-recently-listed report so the read side
// can quickly find "latest" without needing to compute today's ET date.
// Not currently used by the read path but useful for diagnostics.
export async function HEAD() {
  try {
    const res = await list({ prefix: "growth-report/" });
    return new Response(null, {
      status: 200,
      headers: { "x-blob-count": String(res.blobs.length) },
    });
  } catch {
    return new Response(null, { status: 200 });
  }
}
