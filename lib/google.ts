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
      };
    })
    .filter((c) => c.id && c.name && !isTestCampaign(c.name));
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
    const m = (r.metrics || {}) as {
      cost_micros?: string | number;
      impressions?: string | number;
      clicks?: string | number;
      conversions?: string | number;
      conversions_value?: string | number;
    };
    const id = String(camp.id ?? "");
    if (!id || isTestCampaign(camp.name || "")) continue;
    const n = (v: string | number | undefined) =>
      v === undefined || v === null ? 0 : typeof v === "number" ? v : parseFloat(v) || 0;
    let row = byId.get(id);
    if (!row) {
      row = {
        id, name: camp.name ?? "", status: camp.status ?? "",
        cost: 0, impressions: 0, clicks: 0, conversions: 0,
        conversionValue: 0, ctr: 0, cpc: 0,
      };
      byId.set(id, row);
    }
    row.cost            += n(m.cost_micros) / 1_000_000;
    row.impressions     += n(m.impressions);
    row.clicks          += n(m.clicks);
    row.conversions     += n(m.conversions);
    row.conversionValue += n(m.conversions_value);
  }
  for (const r of byId.values()) {
    r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
    r.cpc = r.clicks > 0 ? r.cost / r.clicks : 0;
  }
  return Array.from(byId.values()).sort((a, b) => b.cost - a.cost);
}
