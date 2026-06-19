import { NextRequest } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeCampaignAnalysis } from "@/lib/campaigns";
import { computeTimeSeries, computeFunnelByCampaign, resolvedDateRange } from "@/lib/funnel";
import { fetchMetaInsights } from "@/lib/meta";
import { fetchGoogleAdsDaily } from "@/lib/google";
import type { PeriodFilter } from "@/lib/types";

/**
 * Data export for external analysis.
 *
 *   GET /api/export?period=custom&start=2026-05-01&end=2026-06-15
 *
 * Bundles the dashboard's pre-aggregated outputs as a single zip, ready
 * to hand to an analyst (or feed directly into Claude / Excel / Sheets).
 * Every CSV is generated from the same code paths the dashboard uses,
 * so the numbers match what the user sees on screen.
 *
 * Contents:
 *   campaign_analysis.csv  — one row per campaign / ad-group, all funnel metrics
 *   run_rate_daily.csv     — one row per day, every Run Rate metric + Meta/Google spend
 *   funnel_overview.csv    — funnel-stage drop-off for the selected period
 *   README.md              — column dictionary, methodology notes, exclusions
 *
 * No PII: every output is aggregated. Internal Futurestay test accounts
 * and WIX/HOPPER partner referrals are excluded upstream (see
 * lib/funnel.ts > excludeArtifactContacts).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---- CSV helpers -----------------------------------------------------

/** RFC 4180 — quote values containing comma/quote/newline; double inner quotes.
 *  null / undefined → empty cell (NOT "null" string). */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvFromRows<T>(rows: T[], cols: { key: keyof T; header: string }[]): string {
  const head = cols.map((c) => csvCell(c.header)).join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c.key as string])).join(","))
    .join("\n");
  return body ? `${head}\n${body}\n` : `${head}\n`;
}

// ---- Date helpers ----------------------------------------------------

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---- README content --------------------------------------------------

function readmeMarkdown(since: string, until: string, generatedAt: string): string {
  return `# Futurestay Growth Dashboard — Data Export

Generated: ${generatedAt}
Period (Campaign Analysis + Funnel Overview): **${since} → ${until}**
Period (Run Rate Daily): always since **2026-03-01** through today.

Numbers in these files match exactly what the live dashboard shows for
the same window. Source: HubSpot CRM + Meta Marketing API + Google Ads API.
No PII — every output is aggregated.

## Files

### \`campaign_analysis.csv\`
One row per Meta campaign + Google ad-group (or Pmax campaign rollup).
HubSpot funnel metrics are cohort-based: contacts whose \`createdate\`
falls inside the period AND who attribute to the campaign via
\`first_touch_utm_campaign\` ∪ \`hs_analytics_source_data_2\` ∪ landing-page
URL fallback. Trials and Customers are counted by their respective
entry dates.

Columns:
- \`campaign\` — campaign name (or "Campaign › Ad Group" for multi-ad-group Google campaigns)
- \`type\` — \`call\` (Meta optimized for meetings), \`self\` (optimized for signups or airbnb_connected)
- \`spend\` — ad-platform spend in USD for the period
- \`opt_signal\` — what the campaign is optimizing for; \`google\` is a platform tag for Google ad units
- \`leads\` — total contacts attributed (incl. Airbnb DQ)
- \`meetings_booked\`, \`meetings_held\` — call-campaign-only; held = booked − classified no-shows
- \`signups\` — contacts whose lifecycle reached signup (incl. Airbnb DQ)
- \`qualified_signups\` — signups − Airbnb DQ
- \`airbnb_connected\` — Airbnb auth status COMPLETED or REVOKED
- \`ready_to_launch\` — \`property_ready_to_launch=true\`
- \`airbnb_dq_pct\` — Airbnb DQ rate of leads (%)
- \`no_show_pct_mtgs\`, \`dq_pct_mtgs\`, \`interested_pct_mtgs\`, \`not_interested_pct_mtgs\` — call outcomes, % of meetings booked
- \`outcome_coverage_pct_mtgs\` — % of meetings with any classification (sanity check on the outcome %s)
- \`form_to_meeting_pct\` — call-campaign conversion from form fill to booked meeting
- \`cost_per_meeting\` — call-campaign-only
- \`trials\`, \`cost_per_trial\`
- \`mtg_to_trial_pct\` — Trials / Meetings Held (call-funnel close rate)
- \`qs_to_trial_pct\` — Trials / Qualified Signups
- \`customers\` — real paid (Amplify or Flex), excludes <2-day cancels
- \`cost_per_customer\` — CAC
- \`qs_to_customer_pct\` — Customers / Qualified Signups

### \`run_rate_daily.csv\`
One row per ET calendar day since 2026-03-01. Use this to plot trends,
compute week-over-week deltas, or aggregate to any window.

Columns:
- \`date\` — YYYY-MM-DD, Eastern Time
- \`total_signups\` — contacts whose createdate landed that day AND lifecycle reached signup (includes Airbnb DQ)
- \`qualified_signups\` — same, minus Airbnb DQ
- \`airbnb_connects\` — Airbnb auth COMPLETED or REVOKED
- \`ready_to_launch\` — \`property_ready_to_launch=true\`
- \`trials\` — by trial-entry date (hs_v2_date_entered_opportunity ∪ trial__start_date)
- \`customers\` — by customer-entry date, real paid customers only (ever-became-paid)
- \`meta_spend_usd\` — Meta API daily account-level spend
- \`google_spend_usd\` — Google Ads daily account-level spend

### \`funnel_overview.csv\`
Funnel-stage drop-off for the selected period. Linear waterfall:
Total Signups → Qualified Signups → Authorized Airbnb → Created Properties →
Ready to Launch → Trial Started → (In Trial / Failed Trialist / Customer) → Churned.

Columns:
- \`stage\` — stage name
- \`count\` — contacts at that stage
- \`dropoff_pct\` — % lost from the previous stage
- \`lost\` — absolute drop from the previous stage

## Methodology

- **Cohort vs period:** Signups/QS use \`createdate\` (cohort), Trials and Customers use their entry dates (period). A customer who signed up 60 days ago and converted today counts in Customers for today's window but in Signups for the 60-days-ago window.
- **Excluded:** WIX/HOPPER partner referrals + Futurestay internal test accounts (employee \`@futurestay.com\` emails, \`+test/+trial/+demo/+qa/+staging/+dev\` plus-tag patterns, obvious test/QA/demo names). Same exclusion every dashboard card applies.
- **Customers definition:** "real paid customer" = currently or formerly on Amplify or Flex AND did NOT cancel within 2 days of entry (quick-cancel filter). Churned customers ARE counted (they were real once).
- **Attribution chain (Google):** numeric campaign ID → name prefix → legacy short-label hint → landing-page URL fallback, with ENABLED ad units preferred over PAUSED. Pmax campaigns use \`asset_group.final_urls\` for landing pages.
`;
}

// ---- Route handler ---------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const period = (params.get("period") || "allTime") as PeriodFilter;
    const customStart = params.get("start") || undefined;
    const customEnd = params.get("end") || undefined;

    // Resolve the analysis window the same way every other endpoint does
    // so the export agrees with the dashboard for the same controls.
    let since: string;
    let until: string;
    if (period === "custom" && customStart && customEnd) {
      since = customStart;
      until = customEnd;
    } else {
      const { start, end } = resolvedDateRange(period, customStart, customEnd);
      since = ymd(start);
      until = ymd(end);
    }

    // Fetch once and pass into the compute helpers — fetchAllContacts
    // is cached, so this is cheap on warm cache.
    const contacts = await fetchAllContacts();

    // 1. Campaign Analysis (period-scoped)
    const ca = await computeCampaignAnalysis(contacts, since, until);
    const campaignCsv = csvFromRows(ca.rows, [
      { key: "campaign",                  header: "campaign" },
      { key: "type",                      header: "type" },
      { key: "spend",                     header: "spend" },
      { key: "optSignal",                 header: "opt_signal" },
      { key: "leads",                     header: "leads" },
      { key: "meetingsBooked",            header: "meetings_booked" },
      { key: "meetingsHeld",              header: "meetings_held" },
      { key: "signups",                   header: "signups" },
      { key: "qualifiedSignups",          header: "qualified_signups" },
      { key: "airbnbConnected",           header: "airbnb_connected" },
      { key: "readyToLaunch",             header: "ready_to_launch" },
      { key: "airbnbDqRate",              header: "airbnb_dq_pct" },
      { key: "noShowMtgRate",             header: "no_show_pct_mtgs" },
      { key: "dqMtgRate",                 header: "dq_pct_mtgs" },
      { key: "interestedMtgRate",         header: "interested_pct_mtgs" },
      { key: "notInterestedMtgRate",      header: "not_interested_pct_mtgs" },
      { key: "outcomeCoverage",           header: "outcome_coverage_pct_mtgs" },
      { key: "formToMeetingRate",         header: "form_to_meeting_pct" },
      { key: "costPerMeeting",            header: "cost_per_meeting" },
      { key: "trials",                    header: "trials" },
      { key: "costPerTrial",              header: "cost_per_trial" },
      { key: "meetingToTrialRate",        header: "mtg_to_trial_pct" },
      { key: "qsToTrialRate",             header: "qs_to_trial_pct" },
      { key: "customers",                 header: "customers" },
      { key: "costPerCustomer",           header: "cost_per_customer" },
      { key: "qsToCustomerRate",          header: "qs_to_customer_pct" },
    ]);

    // 2. Run Rate daily — all-time since RUN_RATE_START, with spend
    //    merged in by date (single sequential awaits to stay polite on
    //    HubSpot's secondly rate limit when external APIs hit too).
    const series = computeTimeSeries(contacts);
    const seriesStart = series.days[0] || since;
    const seriesEnd = series.days[series.days.length - 1] || until;
    const [metaDaily, googleDaily] = await Promise.all([
      fetchMetaInsights(seriesStart, seriesEnd).then((d) => d.daily).catch(() => [] as { date: string; spend: number }[]),
      fetchGoogleAdsDaily(seriesStart, seriesEnd).catch(() => [] as { date: string; cost: number }[]),
    ]);
    const metaByDate   = new Map(metaDaily.map((d) => [d.date, d.spend] as const));
    const googleByDate = new Map(googleDaily.map((d) => [d.date, d.cost]  as const));
    const round2 = (v: number) => Math.round(v * 100) / 100;
    const runRateRows = series.days.map((d, i) => ({
      date:              d,
      total_signups:     series.totalSignups[i],
      qualified_signups: series.signups[i],
      airbnb_connects:   series.airbnbConnects[i],
      ready_to_launch:   series.readyToLaunch[i],
      trials:            series.trials[i],
      customers:         series.customers[i],
      meta_spend_usd:    round2(metaByDate.get(d)   || 0),
      google_spend_usd:  round2(googleByDate.get(d) || 0),
    }));
    const runRateCsv = csvFromRows(runRateRows, [
      { key: "date",              header: "date" },
      { key: "total_signups",     header: "total_signups" },
      { key: "qualified_signups", header: "qualified_signups" },
      { key: "airbnb_connects",   header: "airbnb_connects" },
      { key: "ready_to_launch",   header: "ready_to_launch" },
      { key: "trials",            header: "trials" },
      { key: "customers",         header: "customers" },
      { key: "meta_spend_usd",    header: "meta_spend_usd" },
      { key: "google_spend_usd",  header: "google_spend_usd" },
    ]);

    // 3. Funnel overview for the period (no campaign filter — global)
    const funnel = computeFunnelByCampaign(
      contacts,
      period,
      null,
      [],
      [],
      customStart,
      customEnd,
      [],   // no Meta-campaign-name list; we're not filtering
      [],   // no Google ad-group list
    );
    const funnelCsv = csvFromRows(funnel, [
      { key: "name",     header: "stage" },
      { key: "count",    header: "count" },
      { key: "dropoff",  header: "dropoff_pct" },
      { key: "lost",     header: "lost" },
    ]);

    // 4. README
    const generatedAt = new Date().toISOString();
    const readme = readmeMarkdown(since, until, generatedAt);

    // Pack into a zip.
    const files: Record<string, Uint8Array> = {
      "campaign_analysis.csv": strToU8(campaignCsv),
      "run_rate_daily.csv":    strToU8(runRateCsv),
      "funnel_overview.csv":   strToU8(funnelCsv),
      "README.md":             strToU8(readme),
    };
    const zip = zipSync(files, { level: 6 });

    const stamp = ymd(new Date());
    const filename = `futurestay-dashboard-export-${stamp}.zip`;
    // Convert Uint8Array to ArrayBuffer for the Response body so TS
    // accepts it cleanly (BodyInit doesn't include bare Uint8Array).
    const body = new Uint8Array(zip).buffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/export] failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
