// Meta Marketing API client
// Pulls campaign-level and daily spend/performance from Meta Ads.
// Docs: https://developers.facebook.com/docs/marketing-api/insights

import { MetaCampaignRow, MetaDailyPoint, MetaInsightsData } from "./types";

const GRAPH_VERSION = "v21.0";

// Dates are passed as YYYY-MM-DD strings directly from the route handler,
// so no Date→string formatting happens here.

type MetaActionItem = { action_type: string; value: string };

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
  /** Per-event counts. action_type values seen in this account:
   *    "subscribe", "lead", "contact_total", "complete_registration",
   *    plus "offsite_conversion.fb_pixel_*" duplicates. */
  actions?: MetaActionItem[];
  /** Cost-per-action — same structure, value = $ per event. */
  cost_per_action_type?: MetaActionItem[];
};

/** Semantic mapping for this Meta account, verified against live data:
 *
 *    Meta event                                            ⇢ Funnel meaning
 *    ──────────────────────────────────────────────────────────────────────
 *    offsite_conversion.custom.464002702740061             ⇢ Airbnb Connected
 *      (the "Subscribe" custom event — fires on auth COMPLETED)
 *    complete_registration                                 ⇢ Signup
 *    lead / onsite_web_lead                                ⇢ Meeting Booked
 *
 *  RESULT_ACTION_TYPES is what we pick from for the campaign's "Result"
 *  column (the optimization signal). Highest count wins, so:
 *    - Call campaigns (optimize on lead) → "Meeting Booked"
 *    - Self-serve campaigns (optimize on signup/subscribe) → "Signup" */
const RESULT_ACTION_TYPES = [
  "lead",                   // call campaigns ⇢ Meeting Booked
  "onsite_web_lead",        // duplicate of `lead` (on-site form)
  "complete_registration",  // self-serve ⇢ Signup
] as const;

const RESULT_LABELS: Record<string, string> = {
  lead: "Meeting Booked",
  onsite_web_lead: "Meeting Booked",
  complete_registration: "Signup",
};

/** Action type ID for the "Subscribe" custom event in this account.
 *  Confirmed by matching live Meta data (11 events for Airbnb
 *  Optimization Call in Mar 15–Apr 30) against the screenshot's
 *  Subscriptions column for the same campaign.  Semantically:
 *  Subscribe event fires when a user completes Airbnb authorization. */
const SUBSCRIBE_ACTION_TYPE = "offsite_conversion.custom.464002702740061";

function pickAction(items: MetaActionItem[] | undefined, type: string): number {
  if (!items) return 0;
  const item = items.find((i) => i.action_type === type);
  return item ? n(item.value) : 0;
}

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

/** A campaign is "test" if its name contains the literal token. We use
 *  word-boundary matching so we don't accidentally drop a real campaign
 *  whose name happens to contain "testimonial" or similar. */
function isTestCampaign(name: string): boolean {
  return /(^|[^a-z])test([^a-z]|$)/i.test(name || "");
}

type ActiveCampaign = { id: string; name: string };

/**
 * List currently-active campaigns from the Meta Ads account.
 *
 * This is INTENTIONALLY separate from /insights. The insights endpoint
 * only returns campaigns that had activity (spend/impressions) in the
 * requested time_range — so a campaign launched today with no spend
 * yesterday is invisible in a "last week" filter. The dashboard needs
 * to always show currently-active campaigns regardless of whether
 * they're spending in the chosen window, so we fetch the campaign
 * roster directly and merge it into the insights result downstream.
 *
 * Filters applied here:
 *   - effective_status === ACTIVE (Meta exposes the rolled-up state
 *     including ad-set / ad pauses + budget exhaustion)
 *   - name doesn't match the "test" word boundary (per product rule)
 */
export async function fetchActiveCampaigns(): Promise<ActiveCampaign[]> {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID");
  }
  // Filter to ACTIVE on the server so we don't paginate through years
  // of archived/paused campaigns just to throw most of them away.
  const filtering = encodeURIComponent(JSON.stringify([
    { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
  ]));
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/campaigns?fields=id,name&filtering=${filtering}&limit=200&access_token=${token}`;
  const raw = await fetchAllPages<{ id: string; name: string }>(url);
  return raw
    .filter((c) => c.name && !isTestCampaign(c.name))
    .map((c) => ({ id: c.id, name: c.name }));
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

  // Campaign-level (aggregated over range). `actions` returns the
  // per-action-type counts (subscribe / lead / contact / complete_reg);
  // `cost_per_action_type` returns the matching $/event so we don't have
  // to recompute it from spend. Without these two extra fields the card
  // can't show Subscriptions / Results / $-per columns the user wants.
  const campaignFields =
    "campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,reach,actions,cost_per_action_type";
  const campaignUrl = `${base}?fields=${campaignFields}&level=campaign&${common}`;

  // Account-level daily (for trend chart)
  const dailyFields = "spend,impressions,clicks";
  const dailyUrl = `${base}?fields=${dailyFields}&level=account&time_increment=1&${common}`;

  // Fetch insights AND the live active-campaign roster in parallel.
  // Roster is needed so that brand-new campaigns (or active ones that
  // happen to have $0 spend in this window) still show up on the
  // dashboard. Without this merge, the user's "I don't see my new
  // campaign" complaint is reproducible: Meta's /insights endpoint
  // only returns campaigns with data in the window.
  const [campaignsRaw, dailyRaw, activeRoster] = await Promise.all([
    fetchAllPages<MetaRawInsight>(campaignUrl),
    fetchAllPages<MetaRawInsight>(dailyUrl),
    fetchActiveCampaigns().catch((err) => {
      // Don't fail the whole insights pull if the roster call hiccups —
      // the existing in-window campaigns still render.
      console.error("[meta] fetchActiveCampaigns failed:", err);
      return [] as ActiveCampaign[];
    }),
  ]);

  // Drop test campaigns from insights, same rule as the roster — so a
  // "Test" campaign that DID have spend still gets filtered out here.
  const campaignsRawFiltered = campaignsRaw.filter(
    (r) => !isTestCampaign(r.campaign_name || "")
  );

  const campaigns: MetaCampaignRow[] = campaignsRawFiltered
    .map((r) => {
      const spend = n(r.spend);
      const impressions = n(r.impressions);
      const clicks = n(r.clicks);

      // Subscriptions = "Subscribe" custom event = Airbnb Connected.
      // Single source of truth across all campaigns since this event
      // fires only when a user completes Airbnb authorization.
      const subscriptions = pickAction(r.actions, SUBSCRIBE_ACTION_TYPE);
      const costPerSub = pickAction(r.cost_per_action_type, SUBSCRIBE_ACTION_TYPE);

      // The "Result" column in Meta UI is the optimization signal for
      // that campaign. Different campaigns optimize for different
      // events: call campaigns optimize on Website Contacts/Leads;
      // self-serve campaigns optimize on Subscribes or Completed
      // Registration. Pick whichever action_type has the most events —
      // that's the one Meta is reporting in the Results column.
      let resultType: string | null = null;
      let resultValue = 0;
      let resultCost = 0;
      for (const at of RESULT_ACTION_TYPES) {
        const v = pickAction(r.actions, at);
        if (v > resultValue) {
          resultValue = v;
          resultType = at;
          resultCost = pickAction(r.cost_per_action_type, at);
        }
      }

      return {
        id: r.campaign_id || "",
        name: r.campaign_name || "(unnamed)",
        spend,
        impressions,
        clicks,
        ctr: n(r.ctr),
        cpc: n(r.cpc),
        reach: n(r.reach),
        subscriptions,
        costPerSub,
        resultType,
        resultLabel: resultType ? RESULT_LABELS[resultType] : null,
        resultValue,
        resultCost,
      } satisfies MetaCampaignRow;
    });

  // Merge in active-roster campaigns missing from insights. These are
  // currently-active campaigns that had NO spend / activity in the
  // selected window (e.g., a campaign launched today when the filter
  // is "Last week"). We surface them with zeros so the user can see
  // "yes my new campaign exists" instead of silently hiding it.
  const presentIds = new Set(campaigns.map((c) => c.id));
  for (const a of activeRoster) {
    if (presentIds.has(a.id)) continue;
    campaigns.push({
      id: a.id,
      name: a.name,
      spend: 0,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      cpc: 0,
      reach: 0,
      subscriptions: 0,
      costPerSub: 0,
      resultType: null,
      resultLabel: null,
      resultValue: 0,
      resultCost: 0,
    });
  }

  // Sort: active-with-spend first (by spend desc), then $0-spend
  // (active but idle in window) at the bottom alphabetically.
  campaigns.sort((a, b) => {
    if (b.spend !== a.spend) return b.spend - a.spend;
    return a.name.localeCompare(b.name);
  });

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
