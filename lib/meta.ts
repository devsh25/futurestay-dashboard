// Meta Marketing API client
// Pulls campaign-level and daily spend/performance from Meta Ads.
// Docs: https://developers.facebook.com/docs/marketing-api/insights

import { MetaCampaignRow, MetaDailyPoint, MetaInsightsData } from "./types";

const GRAPH_VERSION = "v21.0";

// Dates are passed as YYYY-MM-DD strings directly from the route handler,
// so no Date→string formatting happens here.

type MetaRawInsight = {
  campaign_name?: string;
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  reach?: string;
  date_start?: string;
  date_stop?: string;
};

type MetaApiResponse<T> = {
  data: T[];
  paging?: { cursors?: { before: string; after: string }; next?: string };
  error?: { message: string; type: string; code: number };
};

async function graphGet<T>(url: string): Promise<MetaApiResponse<T>> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meta API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as MetaApiResponse<T>;
  if (json.error) {
    throw new Error(`Meta API error ${json.error.code}: ${json.error.message}`);
  }
  return json;
}

async function fetchAllPages<T>(initialUrl: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | undefined = initialUrl;
  while (url) {
    const page: MetaApiResponse<T> = await graphGet<T>(url);
    all.push(...page.data);
    url = page.paging?.next;
  }
  return all;
}

function n(v: string | undefined): number {
  if (!v) return 0;
  const f = parseFloat(v);
  return isNaN(f) ? 0 : f;
}

export async function fetchMetaInsights(
  since: string,
  until: string
): Promise<MetaInsightsData> {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID");
  }

  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  const base = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/insights`;
  const common = `time_range=${timeRange}&access_token=${token}&limit=200`;

  // Campaign-level (aggregated over range)
  const campaignFields =
    "campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,reach";
  const campaignUrl = `${base}?fields=${campaignFields}&level=campaign&${common}`;

  // Account-level daily (for trend chart)
  const dailyFields = "spend,impressions,clicks";
  const dailyUrl = `${base}?fields=${dailyFields}&level=account&time_increment=1&${common}`;

  const [campaignsRaw, dailyRaw] = await Promise.all([
    fetchAllPages<MetaRawInsight>(campaignUrl),
    fetchAllPages<MetaRawInsight>(dailyUrl),
  ]);

  const campaigns: MetaCampaignRow[] = campaignsRaw
    .map((r) => {
      const spend = n(r.spend);
      const impressions = n(r.impressions);
      const clicks = n(r.clicks);
      return {
        id: r.campaign_id || "",
        name: r.campaign_name || "(unnamed)",
        spend,
        impressions,
        clicks,
        ctr: n(r.ctr),
        cpc: n(r.cpc),
        reach: n(r.reach),
      } satisfies MetaCampaignRow;
    })
    .sort((a, b) => b.spend - a.spend);

  const daily: MetaDailyPoint[] = dailyRaw
    .map((r) => ({
      date: r.date_start || "",
      spend: n(r.spend),
      impressions: n(r.impressions),
      clicks: n(r.clicks),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const summary = campaigns.reduce(
    (acc, c) => {
      acc.spend += c.spend;
      acc.impressions += c.impressions;
      acc.clicks += c.clicks;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0 }
  );

  const ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
  const cpc = summary.clicks > 0 ? summary.spend / summary.clicks : 0;
  const cpm = summary.impressions > 0 ? (summary.spend / summary.impressions) * 1000 : 0;

  return {
    since,
    until,
    summary: { ...summary, ctr, cpc, cpm, campaignCount: campaigns.length },
    campaigns,
    daily,
  };
}
