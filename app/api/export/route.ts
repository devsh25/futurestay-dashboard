import { NextRequest } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeCampaignAnalysis } from "@/lib/campaigns";
import {
  computeTimeSeries, computeFunnelByCampaign, resolvedDateRange,
  isPartnerReferral, isTestContact, isSignup, hasDQ, isAuth, isReadyToLaunch,
  everBecameRealCustomer,
} from "@/lib/funnel";
import { fetchMetaInsights, fetchMetaAdDaily } from "@/lib/meta";
import { fetchGoogleAdsDaily, fetchGoogleAdsAdDaily } from "@/lib/google";
import type { PeriodFilter, HubSpotContact } from "@/lib/types";

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

// ---- HubSpot-by-ad attribution -------------------------------------
//
// For per-ad daily CSVs, we need to count HubSpot funnel stages
// attributed to each (ad, date) cell. The attribution key per platform:
//
//   Meta:   first_touch_utm_content (= Meta ad ID when {{ad.id}} is
//           set on the tracking template, which this account does)
//   Google: hsa_ad URL parameter (set by Google's auto-tagging for
//           Search / Display ads). Falls back to utm_content (carries
//           Pmax asset ID).
//
// If the join key doesn't match an ad in the platform-side data, the
// contact silently doesn't contribute — same conservative attribution
// stance the campaign-level matcher uses. README documents the join.

type AdFunnelCell = {
  total_signups: number; qualified_signups: number;
  airbnb_connects: number; ready_to_launch: number;
  trials: number; customers: number;
};
function emptyCell(): AdFunnelCell {
  return { total_signups: 0, qualified_signups: 0, airbnb_connects: 0, ready_to_launch: 0, trials: 0, customers: 0 };
}

/** Day key for the contact's relevant date field. Uses the leading
 *  YYYY-MM-DD from the ISO string — that's UTC, not ET. Note: platform
 *  daily breakdowns also bucket by ad-account timezone, which may not
 *  be ET either, so all daily comparisons in the per-ad CSVs are
 *  "approximate same calendar day." Documented in the README. */
function dayKey(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.slice(0, 10) || null;
}

/** Meta join key from a HubSpot contact. Meta's tracking template in
 *  this account puts the AD NAME (not ad_id) in utm_content, so the
 *  join is on the human-readable ad name. Scoped by campaign name
 *  because the same ad name can run under multiple campaigns and we
 *  don't want to over-attribute across them. */
function metaAdKey(c: HubSpotContact): string | null {
  const src = (c.first_touch_utm_source || "").toLowerCase();
  if (src !== "facebook" && src !== "meta") return null;
  const camp = (c.first_touch_utm_campaign || "").trim();
  const ad = (c.first_touch_utm_content || "").trim();
  if (!camp || !ad) return null;
  return `${camp}::${ad}`;
}

/** Extract Google ad ID — hsa_ad URL param first (Search ads), then
 *  utm_content (Pmax asset ID). */
function googleAdKey(c: HubSpotContact): string | null {
  const src = (c.first_touch_utm_source || "").toLowerCase();
  if (src !== "google") return null;
  const url = c.hs_analytics_first_url || "";
  if (url) {
    try {
      const v = new URL(url).searchParams.get("hsa_ad");
      if (v && v.trim()) return v.trim();
    } catch { /* malformed URL — fall through */ }
  }
  const utm = (c.first_touch_utm_content || "").trim();
  return utm || null;
}

/** Index contacts into (adId, date) → funnel cell. One pass over all
 *  contacts, building a nested map. Each contact may contribute to
 *  THREE different date buckets (createdate / trial / customer entry)
 *  for the same adId — they live in different rows in the output. */
function buildAdFunnelIndex(
  contacts: HubSpotContact[],
  keyFor: (c: HubSpotContact) => string | null,
): Map<string, Map<string, AdFunnelCell>> {
  const idx = new Map<string, Map<string, AdFunnelCell>>();
  function get(adId: string, date: string): AdFunnelCell {
    let byDay = idx.get(adId);
    if (!byDay) { byDay = new Map(); idx.set(adId, byDay); }
    let cell = byDay.get(date);
    if (!cell) { cell = emptyCell(); byDay.set(date, cell); }
    return cell;
  }
  for (const c of contacts) {
    if (isPartnerReferral(c) || isTestContact(c)) continue;
    const adId = keyFor(c);
    if (!adId) continue;
    // Signup-cohort metrics — keyed on createdate
    const cKey = dayKey(c.createdate);
    if (cKey) {
      if (isSignup(c)) {
        const cell = get(adId, cKey);
        cell.total_signups++;
        if (!hasDQ(c)) cell.qualified_signups++;
      }
      if (isAuth(c))           get(adId, cKey).airbnb_connects++;
      if (isReadyToLaunch(c))  get(adId, cKey).ready_to_launch++;
    }
    // Trials — keyed on trial-entry date
    const tDate = c.hs_v2_date_entered_opportunity || c.trial__start_date;
    const tKey = dayKey(tDate);
    if (tKey) get(adId, tKey).trials++;
    // Customers — keyed on customer-entry date, paid-only
    if (everBecameRealCustomer(c)) {
      const custKey = dayKey(c.hs_v2_date_entered_customer);
      if (custKey) get(adId, custKey).customers++;
    }
  }
  return idx;
}

function getCell(idx: Map<string, Map<string, AdFunnelCell>>, adId: string | null, date: string): AdFunnelCell {
  if (!adId) return emptyCell();
  return idx.get(adId)?.get(date) || emptyCell();
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

### \`meta_ad_daily.csv\`
One row per **Meta ad × day** for the selected window. Combines
Meta's own metrics (impressions, clicks, spend, CTR, CPC, Meta-tracked
events) with HubSpot funnel counts attributed to the same ad on the
same day.

**Grain:** one row per (date, campaign, ad name). Meta lets the same
ad name run under multiple ad_ids/adsets; those are summed into one
row so the HubSpot signup count (which keys off the ad name) doesn't
double-count.

Columns: \`date\`, \`campaign_id\`, \`campaign_name\`, \`ad_name\`,
\`distinct_ad_ids\` (how many ad_ids share this name in this campaign
on this day — typically 1, higher when the same creative was
duplicated across adsets), \`spend\`, \`impressions\`, \`clicks\`,
\`ctr_pct\`, \`cpc\`, \`reach\`, \`meta_subscribes\` (Subscribe custom event =
Airbnb connected), \`meta_leads_event\` (\`lead\` + \`onsite_web_lead\`,
call-campaign signal), \`meta_complete_registration_event\`
(self-serve signup), \`hs_total_signups\`, \`hs_qualified_signups\`,
\`hs_airbnb_connects\`, \`hs_ready_to_launch\`, \`hs_trials\`, \`hs_customers\`.

### \`google_ad_daily.csv\`
One row per **Google ad × day** for the selected window. For Pmax
campaigns (which have no traditional ad units), one row per
**asset group × day** instead — \`ad_id\` is blank, \`asset_group_id\`
is set, and \`channel_type\` reads \`PERFORMANCE_MAX\`.

Columns: \`date\`, \`campaign_id\`, \`campaign_name\`, \`channel_type\`
(\`SEARCH\` / \`DISPLAY\` / \`PERFORMANCE_MAX\` / …), \`ad_group_id\`,
\`ad_group_name\` (blank for Pmax), \`ad_id\`, \`ad_name\` (ad_id blank
for Pmax), \`asset_group_id\` (Pmax only), \`spend\`, \`impressions\`,
\`clicks\`, \`ctr_pct\`, \`cpc\`, \`google_conversions\`,
\`google_conversion_value\`, \`hs_total_signups\`, \`hs_qualified_signups\`,
\`hs_airbnb_connects\`, \`hs_ready_to_launch\`, \`hs_trials\`,
\`hs_customers\`.

### Per-ad HubSpot attribution — how the join works

Each (ad, day) row's \`hs_*\` columns join HubSpot contacts to the
platform's tracking key:

- **Meta:** contact's (\`first_touch_utm_campaign\`, \`first_touch_utm_content\`)
  matches the platform row's (\`campaign_name\`, \`ad_name\`). This account's
  Meta tracking template puts the human-readable AD NAME in utm_content
  (not the numeric ad_id), so the join is on names. Campaign scope avoids
  over-attribution when the same ad name runs in multiple campaigns.
- **Google Search/Display:** contact's \`hsa_ad\` URL parameter
  (set by Google auto-tagging) matches the row's \`ad_id\`.
- **Google Pmax:** contact's \`utm_content\` (Pmax stores the asset
  ID there) matches the row's \`asset_group_id\`.

The contact's date matched against the row's \`date\`:
- \`hs_total_signups\` / \`hs_qualified_signups\` / \`hs_airbnb_connects\` /
  \`hs_ready_to_launch\` — contact's \`createdate\`
- \`hs_trials\` — contact's trial-entry date
- \`hs_customers\` — contact's customer-entry date

So a contact who clicked an ad on May 1, signed up May 1, started
trial June 15, and became a customer July 1 lands in **three different
rows** for the same ad: \`hs_total_signups=1\` on May 1, \`hs_trials=1\`
on June 15, \`hs_customers=1\` on July 1.

**Caveat — timezone:** Meta and Google bucket dates in the ad
account's timezone. HubSpot stores UTC. The per-ad CSVs compare the
leading \`YYYY-MM-DD\` of each timestamp directly. A contact created
at 11pm ET on May 1 will bucket as May 2 in the CSV even though
Meta's May 1 row counted the click. Typically within ±1 day. For
window-level totals this washes out; for single-ad spot checks,
expect minor edge-of-day skew.

## Methodology

- **Two attribution conventions in this export.** Don't sum across files expecting them to agree:
  - \`campaign_analysis.csv\` is **cohort-based** — a row's \`customers\` count includes only contacts whose \`createdate\` is in the window AND who ever became a paid customer. A contact who signed up in March and converted in May appears in the March cohort, never in May.
  - \`meta_ad_daily.csv\` / \`google_ad_daily.csv\` / \`run_rate_daily.csv\` are **period-based** — \`hs_customers\` is bucketed by \`hs_v2_date_entered_customer\`, so the same March-signup-to-May-customer contact lands on the May row.
  - Both are correct for different questions: cohort = "how many of THIS week's signups become customers?"; period = "how many customers did we add THIS week?". The KPI tile uses period-based for Customers/Trials and cohort-based for Signups/QS — matches the per-day CSVs by metric.
- **Cohort vs period for individual metrics:** Signups/QS use \`createdate\` (cohort); Trials and Customers use their entry dates (period). A customer who signed up 60 days ago and converted today counts in Customers for today's window but in Signups for the 60-days-ago window.
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

    // 3. Per-ad daily — Meta + Google in parallel. Each row is one
    //    (ad, day) cell with platform-tracked metrics + HubSpot funnel
    //    counts attributed via the platform's tracking key. Catches
    //    ad-level perf differences the campaign-level CSVs can't show.
    const [metaAdRows, googleAdRows] = await Promise.all([
      fetchMetaAdDaily(since, until).catch((err) => {
        console.error("[export] fetchMetaAdDaily failed:", err);
        return [] as Awaited<ReturnType<typeof fetchMetaAdDaily>>;
      }),
      fetchGoogleAdsAdDaily(since, until).catch((err) => {
        console.error("[export] fetchGoogleAdsAdDaily failed:", err);
        return [] as Awaited<ReturnType<typeof fetchGoogleAdsAdDaily>>;
      }),
    ]);

    // Build the per-platform (ad, day) funnel indexes once. The same
    // map is read for every output row — no per-row HubSpot scan.
    const metaIdx   = buildAdFunnelIndex(contacts, metaAdKey);
    const googleIdx = buildAdFunnelIndex(contacts, googleAdKey);

    // Meta lets the same ad_name exist under multiple ad_ids and
    // adsets. Since HubSpot's utm_content carries the ad NAME (not
    // ID), our HubSpot join is many-to-one against ad_id — emitting
    // a row per ad_id would replicate the same hs_* count across
    // siblings and over-count when summed.
    //
    // Aggregate platform metrics at (date, campaign, ad_name) so each
    // row matches one row in the HubSpot index. ad_id and adset get
    // collapsed (id_count = how many ad_ids share this name+campaign).
    type MetaAggKey = string;
    type MetaAgg = {
      date: string; campaign_id: string; campaign_name: string;
      ad_name: string; ad_id_count: number;
      spend: number; impressions: number; clicks: number; reach: number;
      subscribes: number; leads: number; signups_event: number;
    };
    const metaAggMap = new Map<MetaAggKey, MetaAgg>();
    for (const r of metaAdRows) {
      const key = `${r.date}|${r.campaign_id}|${r.ad_name}`;
      let a = metaAggMap.get(key);
      if (!a) {
        a = {
          date: r.date, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
          ad_name: r.ad_name, ad_id_count: 0,
          spend: 0, impressions: 0, clicks: 0, reach: 0,
          subscribes: 0, leads: 0, signups_event: 0,
        };
        metaAggMap.set(key, a);
      }
      a.ad_id_count   += 1;
      a.spend         += r.spend;
      a.impressions   += r.impressions;
      a.clicks        += r.clicks;
      a.reach         += r.reach;
      a.subscribes    += r.subscribes;
      a.leads         += r.leads;
      a.signups_event += r.signups_event;
    }
    const metaAggregated = Array.from(metaAggMap.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.campaign_name !== b.campaign_name) return a.campaign_name.localeCompare(b.campaign_name);
      return a.ad_name.localeCompare(b.ad_name);
    });

    const metaCsv = csvFromRows(
      metaAggregated.map((r) => {
        const platformKey = r.campaign_name && r.ad_name ? `${r.campaign_name}::${r.ad_name}` : null;
        const hs = getCell(metaIdx, platformKey, r.date);
        const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
        const cpc = r.clicks > 0 ? r.spend / r.clicks : 0;
        return {
          ...r,
          ctr_pct: ctr,
          cpc,
          hs_total_signups:     hs.total_signups,
          hs_qualified_signups: hs.qualified_signups,
          hs_airbnb_connects:   hs.airbnb_connects,
          hs_ready_to_launch:   hs.ready_to_launch,
          hs_trials:            hs.trials,
          hs_customers:         hs.customers,
        };
      }),
      [
        { key: "date",                 header: "date" },
        { key: "campaign_id",          header: "campaign_id" },
        { key: "campaign_name",        header: "campaign_name" },
        { key: "ad_name",              header: "ad_name" },
        { key: "ad_id_count",          header: "distinct_ad_ids" },
        { key: "spend",                header: "spend" },
        { key: "impressions",          header: "impressions" },
        { key: "clicks",               header: "clicks" },
        { key: "ctr_pct",              header: "ctr_pct" },
        { key: "cpc",                  header: "cpc" },
        { key: "reach",                header: "reach" },
        { key: "subscribes",           header: "meta_subscribes" },
        { key: "leads",                header: "meta_leads_event" },
        { key: "signups_event",        header: "meta_complete_registration_event" },
        { key: "hs_total_signups",     header: "hs_total_signups" },
        { key: "hs_qualified_signups", header: "hs_qualified_signups" },
        { key: "hs_airbnb_connects",   header: "hs_airbnb_connects" },
        { key: "hs_ready_to_launch",   header: "hs_ready_to_launch" },
        { key: "hs_trials",            header: "hs_trials" },
        { key: "hs_customers",         header: "hs_customers" },
      ],
    );

    const googleCsv = csvFromRows(
      googleAdRows.map((r) => {
        // Google's HubSpot join: ad_id first (Search), asset_group_id
        // for Pmax (utm_content = asset ID). Both flow through the
        // same googleAdKey helper, so we just look up by whichever
        // ID the platform row exposes.
        const lookupKey = r.ad_id || r.asset_group_id;
        const hs = getCell(googleIdx, lookupKey, r.date);
        return {
          ...r,
          hs_total_signups:     hs.total_signups,
          hs_qualified_signups: hs.qualified_signups,
          hs_airbnb_connects:   hs.airbnb_connects,
          hs_ready_to_launch:   hs.ready_to_launch,
          hs_trials:            hs.trials,
          hs_customers:         hs.customers,
        };
      }),
      [
        { key: "date",                 header: "date" },
        { key: "campaign_id",          header: "campaign_id" },
        { key: "campaign_name",        header: "campaign_name" },
        { key: "channel_type",         header: "channel_type" },
        { key: "ad_group_id",          header: "ad_group_id" },
        { key: "ad_group_name",        header: "ad_group_name" },
        { key: "ad_id",                header: "ad_id" },
        { key: "ad_name",              header: "ad_name" },
        { key: "asset_group_id",       header: "asset_group_id" },
        { key: "cost",                 header: "spend" },
        { key: "impressions",          header: "impressions" },
        { key: "clicks",               header: "clicks" },
        { key: "ctr",                  header: "ctr_pct" },
        { key: "cpc",                  header: "cpc" },
        { key: "conversions",          header: "google_conversions" },
        { key: "conversion_value",     header: "google_conversion_value" },
        { key: "hs_total_signups",     header: "hs_total_signups" },
        { key: "hs_qualified_signups", header: "hs_qualified_signups" },
        { key: "hs_airbnb_connects",   header: "hs_airbnb_connects" },
        { key: "hs_ready_to_launch",   header: "hs_ready_to_launch" },
        { key: "hs_trials",            header: "hs_trials" },
        { key: "hs_customers",         header: "hs_customers" },
      ],
    );

    // 4. Funnel overview for the period (no campaign filter — global)
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
      "meta_ad_daily.csv":     strToU8(metaCsv),
      "google_ad_daily.csv":   strToU8(googleCsv),
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
