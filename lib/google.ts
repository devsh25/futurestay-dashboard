// Google Ads Marketing API client.
//
// Mirrors lib/meta.ts in shape so the same patterns
// (fetchActive… + fetchInsights…) feed Funnel filtering and a future
// "Google Ads — Spend & Performance" card.
//
// Auth model:
//   - developer token (free-tier or paid, account-level) → header
//   - OAuth2 refresh_token exchanged at runtime for a short-lived
//     access_token → Authorization: Bearer …
//   - login-customer-id header optional; required if the target
//     customer sits under an MCC (manager) account.
//
// Why direct fetch instead of pulling the google-ads-api npm package:
// the SDK is heavy, brings a gRPC/protobuf stack into the Vercel
// runtime, and we only need 2 endpoints (campaigns + insights). REST
// + GAQL is enough and keeps the cold-start small.

import type { CampaignRow } from "./types";

// Bump this when Google rolls a new GA version. Quarterly cadence.
// v17/v18/v19 returned HTTP 404 in production probe (decommissioned);
// v20/v21 are the active versions as of probe date. Sticking to v21
// since it's the newer of the two — released 2025.
const GOOGLE_ADS_API_VERSION = "v21";

void ({} as CampaignRow);  // suppress unused-import nit until consumed by a card

/** A Google Ads campaign from the live roster. Matches the structure
 *  returned by /lib/meta.ts → fetchActiveCampaigns(). */
export interface GoogleAdsCampaign {
  id: string;          // Google Ads campaign ID (numeric string)
  name: string;        // human-readable campaign name
  status: string;      // ENABLED / PAUSED / REMOVED — we only return ENABLED
  /** URL pathnames the campaign's ads land on (from ad_group_ad.ad.finalUrls).
   *  Used as a strong attribution signal for HubSpot contacts whose
   *  utm_campaign was broken/empty pre-tracking-template-fix —
   *  if their hs_analytics_first_url path matches one of these,
   *  we can attribute them to this campaign. Excludes "/" (too generic). */
  landingPages: string[];
}

/** Per-campaign performance over a date window. cost is in dollars
 *  (Google returns micros; we divide by 1e6 before exposing). */
export interface GoogleAdsCampaignInsight extends GoogleAdsCampaign {
  cost: number;          // $ spend
  impressions: number;
  clicks: number;
  conversions: number;   // count of conversion actions Google attributes
  conversionValue: number; // $ value (if conversion tracking has values set)
  ctr: number;            // derived %
  cpc: number;            // derived $
}

// ---- OAuth token exchange ----

interface CachedToken { token: string; expiresAt: number }
let cachedAccessToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Ads OAuth not configured. Set GOOGLE_ADS_CLIENT_ID, " +
      "GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_REFRESH_TOKEN in .env.local."
    );
  }
  // Cache the access token for its lifetime minus a safety buffer.
  // Google issues hour-long tokens; we cache for 50 minutes to avoid
  // mid-request expiry.
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 30_000) {
    return cachedAccessToken.token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google OAuth refresh failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (data.expires_in ?? 3000) * 1000;
  cachedAccessToken = { token: data.access_token, expiresAt: now + Math.min(ttlMs, 50 * 60 * 1000) };
  return cachedAccessToken.token;
}

// ---- Low-level GAQL search ----

type SearchStreamChunk = { results?: Record<string, unknown>[] };

async function googleAdsSearch(query: string): Promise<Record<string, unknown>[]> {
  const devToken    = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId  = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
  const loginCustId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
  // Specific error so we know exactly which var is missing in prod
  // (Vercel hides values; we can only diagnose by name).
  const missing: string[] = [];
  if (!devToken)   missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!customerId) missing.push("GOOGLE_ADS_CUSTOMER_ID");
  if (missing.length > 0 || !devToken || !customerId) {
    throw new Error(`Missing env var(s): ${missing.join(", ")}`);
  }
  // After the guard above, devToken is guaranteed present — assert so TS
  // narrows it from `string | undefined` to `string` for the header below.
  const developerToken: string = devToken!;
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustId) headers["login-customer-id"] = loginCustId;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Ads API ${res.status}: ${body.slice(0, 500)}`);
  }
  const raw = (await res.json()) as SearchStreamChunk | SearchStreamChunk[];
  // searchStream returns an array of chunks, each with .results. Some
  // SDKs return the raw array; older proxies sometimes return a single
  // object. Handle both.
  const chunks = Array.isArray(raw) ? raw : [raw];
  return chunks.flatMap((c) => c.results ?? []);
}

// ---- Public: roster of active campaigns (campaign list only) ----

function isTestCampaign(name: string): boolean {
  return /(^|[^a-z])test([^a-z]|$)/i.test(name || "");
}

export async function fetchActiveGoogleCampaigns(): Promise<GoogleAdsCampaign[]> {
  // GAQL: ENABLED status only, exclude REMOVED + PAUSED. Test-name
  // filtering happens after (consistent with the Meta-side rule).
  //
  // NOTE: most dashboard callers should use fetchRecentGoogleCampaigns
  // instead — that includes paused campaigns that were active in the
  // recent window. This function is kept for callers that genuinely
  // need only currently-running campaigns.
  const query = `
    SELECT campaign.id, campaign.name, campaign.status
    FROM campaign
    WHERE campaign.status = 'ENABLED'
  `;
  const results = await googleAdsSearch(query);
  return results
    .map((r) => {
      const c = (r.campaign || {}) as { id?: string | number; name?: string; status?: string };
      return {
        id: String(c.id ?? ""),
        name: c.name ?? "",
        status: c.status ?? "",
        landingPages: [] as string[],  // not populated by this path
      };
    })
    .filter((c) => c.id && c.name && !isTestCampaign(c.name));
}

/** Campaigns with ANY activity (spend, impressions, or clicks > 0) in
 *  the trailing `monthsBack` window. Includes paused/removed campaigns
 *  if they spent money in the window — useful for the funnel attribution
 *  (a contact may have come from a campaign that was paused yesterday).
 *
 *  Dedupes by campaign ID (the query returns one row per day per
 *  campaign by default). Test-named campaigns filtered out. */
export async function fetchRecentGoogleCampaigns(monthsBack = 6): Promise<GoogleAdsCampaign[]> {
  const today = new Date();
  const past = new Date(today);
  past.setMonth(past.getMonth() - monthsBack);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const since = ymd(past);
  const until = ymd(today);

  // GAQL with segments.date emits one row per day a campaign was
  // alive. Campaigns with literally zero activity won't return rows.
  // We dedupe per campaign ID and require ANY of cost / impressions
  // / clicks > 0 (some campaigns get rows with all-zero metrics on
  // days they were enabled but didn't serve).
  const query = `
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.cost_micros, metrics.impressions, metrics.clicks
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `;
  const results = await googleAdsSearch(query);

  const seen = new Map<string, GoogleAdsCampaign>();
  for (const r of results) {
    const c = (r.campaign || {}) as { id?: string | number; name?: string; status?: string };
    const m = (r.metrics  || {}) as { costMicros?: string | number; impressions?: string | number; clicks?: string | number };
    const id = String(c.id ?? "");
    if (!id) continue;
    const name = c.name ?? "";
    if (isTestCampaign(name)) continue;
    const n = (v: string | number | undefined) =>
      v === undefined || v === null ? 0 : typeof v === "number" ? v : parseFloat(String(v)) || 0;
    const hasActivity = n(m.costMicros) > 0 || n(m.impressions) > 0 || n(m.clicks) > 0;
    if (!hasActivity) continue;
    if (!seen.has(id)) {
      seen.set(id, { id, name, status: c.status ?? "", landingPages: [] });
    }
  }
  const campaigns = Array.from(seen.values());

  // Best-effort enrichment: attach landing-page URL paths per campaign.
  // Used as a Tier-4 attribution fallback for HubSpot contacts whose
  // pre-tracking-template-fix UTM params were broken/empty — their
  // hs_analytics_first_url path is matched against these.
  // Failure is non-fatal: the contact just doesn't gain URL-attribution.
  try {
    const ids = campaigns.map((c) => c.id);
    const lpByCampaign = await fetchLandingPagesByCampaign(ids);
    for (const c of campaigns) {
      c.landingPages = lpByCampaign.get(c.id) ?? [];
    }
  } catch (err) {
    console.error("[fetchRecentGoogleCampaigns] landing-page enrichment failed:", err);
  }
  return campaigns;
}

/** Map of campaign ID → URL pathnames its ads link to. Source is
 *  ad_group_ad.ad.final_urls (the live landing-page URL configured on
 *  every approved ad). We strip protocol+host and dedupe paths.
 *
 *  The "/" path is excluded — it's too generic (Brand-Search lands at
 *  "/", but so do many organic + paid touches) and would over-attribute. */
async function fetchLandingPagesByCampaign(campaignIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (campaignIds.length === 0) return result;
  // GAQL: pull every approved ad's final URLs, scoped to the campaigns
  // we already know are active in the window. Single query — even with
  // ~30 active campaigns it's a small response.
  const idList = campaignIds.map((id) => `'${id}'`).join(",");
  const query = `
    SELECT campaign.id, ad_group_ad.ad.final_urls
    FROM ad_group_ad
    WHERE campaign.id IN (${idList})
      AND ad_group_ad.status != 'REMOVED'
  `;
  const rows = await googleAdsSearch(query);
  const byCampaign = new Map<string, Set<string>>();
  for (const r of rows) {
    const camp = (r.campaign || {}) as { id?: string | number };
    const ad = ((r.adGroupAd || {}) as { ad?: { finalUrls?: string[] } }).ad || {};
    const id = String(camp.id ?? "");
    const urls = ad.finalUrls || [];
    if (!id || urls.length === 0) continue;
    let set = byCampaign.get(id);
    if (!set) { set = new Set<string>(); byCampaign.set(id, set); }
    for (const u of urls) {
      try {
        const path = new URL(u).pathname.replace(/\/+$/, "") || "/";
        if (path === "/") continue;  // too generic
        set.add(path);
      } catch {
        // skip malformed URLs
      }
    }
  }
  for (const [id, set] of byCampaign) {
    result.set(id, Array.from(set));
  }
  return result;
}

// ---- Public: daily account-level spend (for Run Rate budget line) ----

export interface GoogleAdsDailyPoint {
  date: string; // YYYY-MM-DD (Google account's reporting timezone)
  cost: number; // $ spend (micros ÷ 1e6)
}

export async function fetchGoogleAdsDaily(
  since: string,  // YYYY-MM-DD
  until: string,  // YYYY-MM-DD inclusive
): Promise<GoogleAdsDailyPoint[]> {
  // Query the customer resource (account-level aggregate across all
  // campaigns) segmented by date — one row per day. Used by the
  // Run Rate chart's "Budget Spent" line, summed with the Meta side
  // to show daily total ad spend.
  //
  // NOTE: under Explorer access metrics.cost_micros returns 0 (Google
  // gates cost behind Basic Access). The dashboard will read 0 here
  // until Basic Access is granted; once it is, no code change needed.
  const query = `
    SELECT segments.date, metrics.cost_micros
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `;
  const results = await googleAdsSearch(query);
  // Note: the GAQL query uses snake_case field names (metrics.cost_micros)
  // but Google's REST response converts everything to camelCase
  // (metrics.costMicros). Reading the snake_case form here returns
  // undefined and silently zeros out spend — that single oversight cost
  // a day of debugging when Basic Access was first turned on.
  const byDate = new Map<string, number>();
  for (const r of results) {
    const seg = (r.segments || {}) as { date?: string };
    const m   = (r.metrics  || {}) as { costMicros?: string | number };
    const date = seg.date;
    if (!date) continue;
    const micros = typeof m.costMicros === "number"
      ? m.costMicros
      : parseFloat(String(m.costMicros ?? "0"));
    if (isNaN(micros)) continue;
    byDate.set(date, (byDate.get(date) || 0) + micros / 1_000_000);
  }
  return Array.from(byDate.entries())
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Public: campaign-level performance over a date window ----

export async function fetchGoogleAdsInsights(
  since: string,  // YYYY-MM-DD
  until: string,  // YYYY-MM-DD inclusive
): Promise<GoogleAdsCampaignInsight[]> {
  // GAQL aggregates over the window because we omit segments.date.
  // Including campaign.status = ENABLED would HIDE recently-paused
  // campaigns that DID spend in the window — we want those rows. We
  // filter to "currently active" downstream if needed.
  const query = `
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `;
  const results = await googleAdsSearch(query);

  // Aggregate (campaign.id) across any per-day or per-network split
  // Google might still emit even with no segments. Cost micros → $.
  const byId = new Map<string, GoogleAdsCampaignInsight>();
  for (const r of results) {
    const camp = (r.campaign || {}) as { id?: string | number; name?: string; status?: string };
    // Same snake_case-vs-camelCase gotcha as fetchGoogleAdsDaily: GAQL
    // selects use cost_micros / conversions_value but the JSON response
    // keys those as costMicros / conversionsValue.
    const m = (r.metrics || {}) as {
      costMicros?: string | number;
      impressions?: string | number;
      clicks?: string | number;
      conversions?: string | number;
      conversionsValue?: string | number;
    };
    const id = String(camp.id ?? "");
    if (!id || isTestCampaign(camp.name || "")) continue;
    const n = (v: string | number | undefined) =>
      v === undefined || v === null ? 0 : typeof v === "number" ? v : parseFloat(v) || 0;
    let row = byId.get(id);
    if (!row) {
      row = {
        id, name: camp.name ?? "", status: camp.status ?? "", landingPages: [],
        cost: 0, impressions: 0, clicks: 0, conversions: 0,
        conversionValue: 0, ctr: 0, cpc: 0,
      };
      byId.set(id, row);
    }
    row.cost            += n(m.costMicros) / 1_000_000;
    row.impressions     += n(m.impressions);
    row.clicks          += n(m.clicks);
    row.conversions     += n(m.conversions);
    row.conversionValue += n(m.conversionsValue);
  }
  for (const r of byId.values()) {
    r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
    r.cpc = r.clicks > 0 ? r.cost / r.clicks : 0;
  }
  return Array.from(byId.values()).sort((a, b) => b.cost - a.cost);
}
