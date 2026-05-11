import { HubSpotContact } from "./types";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const BASE_URL = "https://api.hubapi.com";

const CONTACT_PROPERTIES = [
  "account_lifecycle",
  "airbnb_authorization_status",
  "airbnbdqreason",
  "user_properties_created",
  "user_clicked_launch_property",
  "property_ready_to_launch",
  "trial__start_date",
  // Chargebee's authoritative trial end date. Preferred over a hardcoded
  // trial length because it honors extensions, failed renewals, etc.
  "cb_subcst_trial_end",
  "subscription_status",
  "subscription_type",
  "plan_name",
  // These legacy "don't use" fields hold the only reliable plan_type data
  // across FS Connect / Amplify / Flex / Limited — required to distinguish
  // paid customers (Amplify, Flex) from free FS Connect.
  "don_t_use____plan_type",
  "don_t_use_____old_plan_type",
  "limited_access_previous_plan",
  "first_touch_utm_campaign",
  "first_touch_utm_source",
  "first_touch_utm_medium",
  "first_touch_utm_term",
  "hs_analytics_first_url",
  "hs_analytics_source_data_2",
  "engagements_last_meeting_booked",
  "sales_call_outcome",
  "aircall_last_call_at",
  "last_aircall_call_outcome",
  "hubspot_owner_id",
  "country",
  "city",
  "ip_country",
  "ip_city",
  "referral_source",
  "createdate",
  "hs_v2_date_entered_opportunity",
  "hs_v2_date_exited_opportunity",
  "hs_v2_date_entered_customer",
  "hs_v2_date_exited_customer",
];

// Simple in-memory cache
let contactsCache: { data: HubSpotContact[]; timestamp: number } | null = null;
let ownersCache: { data: Record<string, string>; timestamp: number } | null =
  null;
let customersCache: { data: HubSpotContact[]; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-flight promises so concurrent callers share one fetch instead of
// each starting their own (cache stampede). Critical when the dashboard
// loads 4+ endpoints in parallel and they all want the same data on a
// cold cache.
let contactsInFlight: Promise<HubSpotContact[]> | null = null;
let customersInFlight: Promise<HubSpotContact[]> | null = null;
let ownersInFlight: Promise<Record<string, string>> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hubspotFetch(
  url: string,
  options?: RequestInit,
  retries = 5
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (res.status === 429) {
      // Rate limited. Honour Retry-After header if HubSpot provided one,
      // else exponential backoff capped at 30s. Bigger ceiling than the
      // old 10s because cold-start request stampedes can need more time
      // for HubSpot's bucket to refill.
      const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
      const headerWait = retryAfter > 0 ? retryAfter * 1000 : 0;
      const backoff = Math.min(1500 * Math.pow(2, attempt), 30000);
      const waitMs = Math.max(headerWait, backoff);
      console.log(`HubSpot 429: waiting ${waitMs}ms (attempt ${attempt + 1}/${retries + 1})`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  throw new Error("HubSpot API rate limit — please refresh in ~30 seconds");
}

export async function fetchAllContacts(): Promise<HubSpotContact[]> {
  // Check cache
  if (contactsCache && Date.now() - contactsCache.timestamp < CACHE_TTL) {
    return contactsCache.data;
  }
  // If another caller is already fetching, wait for that fetch instead
  // of starting our own. Single-flight prevents cache stampede when
  // multiple endpoints load simultaneously on a cold cache.
  if (contactsInFlight) {
    return contactsInFlight;
  }
  contactsInFlight = doFetchAllContacts().finally(() => {
    contactsInFlight = null;
  });
  return contactsInFlight;
}

async function doFetchAllContacts(): Promise<HubSpotContact[]> {
  const allContacts: HubSpotContact[] = [];
  let after: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 100; // 10,000 contacts max (HubSpot search limit)

  // Only fetch contacts created since Jan 1, 2026
  const SINCE_DATE = "2026-01-01T00:00:00.000Z";

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "createdate",
              operator: "GTE",
              value: new Date(SINCE_DATE).getTime().toString(),
            },
          ],
        },
      ],
      sorts: [
        {
          propertyName: "createdate",
          direction: "DESCENDING",
        },
      ],
      properties: CONTACT_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    };

    const data = await hubspotFetch(
      `${BASE_URL}/crm/v3/objects/contacts/search`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    const results = (data.results || []) as Array<{
      id: string;
      properties: Record<string, string | null>;
    }>;
    for (const result of results) {
      const p = result.properties;
      allContacts.push({
        id: result.id,
        createdate: p.createdate || "",
        account_lifecycle: p.account_lifecycle || null,
        airbnb_authorization_status: p.airbnb_authorization_status || null,
        airbnbdqreason: p.airbnbdqreason || null,
        user_properties_created: p.user_properties_created || null,
        user_clicked_launch_property: p.user_clicked_launch_property || null,
        property_ready_to_launch: p.property_ready_to_launch || null,
        trial__start_date: p.trial__start_date || null,
        cb_subcst_trial_end: p.cb_subcst_trial_end || null,
        subscription_status: p.subscription_status || null,
        subscription_type: p.subscription_type || null,
        plan_name: p.plan_name || null,
        plan_type_legacy: p["don_t_use____plan_type"] || null,
        plan_type_old: p["don_t_use_____old_plan_type"] || null,
        limited_access_previous_plan: p.limited_access_previous_plan || null,
        first_touch_utm_campaign: p.first_touch_utm_campaign || null,
        first_touch_utm_source: p.first_touch_utm_source || null,
        first_touch_utm_medium: p.first_touch_utm_medium || null,
        first_touch_utm_term: p.first_touch_utm_term || null,
        hs_analytics_first_url: p.hs_analytics_first_url || null,
        hs_analytics_source_data_2: p.hs_analytics_source_data_2 || null,
        engagements_last_meeting_booked: p.engagements_last_meeting_booked || null,
        sales_call_outcome: p.sales_call_outcome || null,
        aircall_last_call_at: p.aircall_last_call_at || null,
        last_aircall_call_outcome: p.last_aircall_call_outcome || null,
        hubspot_owner_id: p.hubspot_owner_id || null,
        country: p.country || null,
        city: p.city || null,
        ip_country: p.ip_country || null,
        ip_city: p.ip_city || null,
        referral_source: p.referral_source || null,
        hs_v2_date_entered_opportunity: p.hs_v2_date_entered_opportunity || null,
        hs_v2_date_exited_opportunity: p.hs_v2_date_exited_opportunity || null,
        hs_v2_date_entered_customer: p.hs_v2_date_entered_customer || null,
        hs_v2_date_exited_customer: p.hs_v2_date_exited_customer || null,
      });
    }

    after = (data.paging as Record<string, Record<string, string>>)?.next
      ?.after;
    pageCount++;

    // Small delay between pages to avoid rate limits
    if (after) await sleep(150);
  } while (after && pageCount < MAX_PAGES);

  // Update cache
  contactsCache = { data: allContacts, timestamp: Date.now() };
  return allContacts;
}

/**
 * Fetch every paying-customer-lifecycle contact regardless of createdate.
 *
 * Why this is separate from fetchAllContacts():
 *   fetchAllContacts() is scoped to contacts created since 2026-01-01 to
 *   keep the page-load fetch fast and bounded. But the Retention Curve
 *   needs the FULL paid-customer history — including the ~300 customers
 *   who became customer in 2024/2025 before the createdate cutoff.
 *   Filtering by createdate misses them entirely.
 *
 * Filter: account_lifecycle ∈ {customer, former.customer, Customer/Limited Access}
 *         No date filter. Excludes WIX/HOPPER via the caller (same as
 *         every other dashboard query).
 *
 * The data shape is the same as fetchAllContacts() — same field set.
 */
export async function fetchAllCustomers(): Promise<HubSpotContact[]> {
  if (customersCache && Date.now() - customersCache.timestamp < CACHE_TTL) {
    return customersCache.data;
  }
  if (customersInFlight) return customersInFlight;
  customersInFlight = doFetchAllCustomers().finally(() => {
    customersInFlight = null;
  });
  return customersInFlight;
}

async function doFetchAllCustomers(): Promise<HubSpotContact[]> {
  const all: HubSpotContact[] = [];
  let after: string | undefined;
  const MAX_PAGES = 50;
  let pageCount = 0;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "account_lifecycle",
              operator: "IN",
              values: ["customer", "former.customer", "Customer/Limited Access"],
            },
          ],
        },
      ],
      sorts: [{ propertyName: "hs_v2_date_entered_customer", direction: "DESCENDING" }],
      properties: CONTACT_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    };

    const data = await hubspotFetch(`${BASE_URL}/crm/v3/objects/contacts/search`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const results = (data.results || []) as Array<{
      id: string;
      properties: Record<string, string | null>;
    }>;
    for (const result of results) {
      const p = result.properties;
      all.push({
        id: result.id,
        createdate: p.createdate || "",
        account_lifecycle: p.account_lifecycle || null,
        airbnb_authorization_status: p.airbnb_authorization_status || null,
        airbnbdqreason: p.airbnbdqreason || null,
        user_properties_created: p.user_properties_created || null,
        user_clicked_launch_property: p.user_clicked_launch_property || null,
        property_ready_to_launch: p.property_ready_to_launch || null,
        trial__start_date: p.trial__start_date || null,
        cb_subcst_trial_end: p.cb_subcst_trial_end || null,
        subscription_status: p.subscription_status || null,
        subscription_type: p.subscription_type || null,
        plan_name: p.plan_name || null,
        plan_type_legacy: p["don_t_use____plan_type"] || null,
        plan_type_old: p["don_t_use_____old_plan_type"] || null,
        limited_access_previous_plan: p.limited_access_previous_plan || null,
        first_touch_utm_campaign: p.first_touch_utm_campaign || null,
        first_touch_utm_source: p.first_touch_utm_source || null,
        first_touch_utm_medium: p.first_touch_utm_medium || null,
        first_touch_utm_term: p.first_touch_utm_term || null,
        hs_analytics_first_url: p.hs_analytics_first_url || null,
        hs_analytics_source_data_2: p.hs_analytics_source_data_2 || null,
        engagements_last_meeting_booked: p.engagements_last_meeting_booked || null,
        sales_call_outcome: p.sales_call_outcome || null,
        aircall_last_call_at: p.aircall_last_call_at || null,
        last_aircall_call_outcome: p.last_aircall_call_outcome || null,
        hubspot_owner_id: p.hubspot_owner_id || null,
        country: p.country || null,
        city: p.city || null,
        ip_country: p.ip_country || null,
        ip_city: p.ip_city || null,
        referral_source: p.referral_source || null,
        hs_v2_date_entered_opportunity: p.hs_v2_date_entered_opportunity || null,
        hs_v2_date_exited_opportunity: p.hs_v2_date_exited_opportunity || null,
        hs_v2_date_entered_customer: p.hs_v2_date_entered_customer || null,
        hs_v2_date_exited_customer: p.hs_v2_date_exited_customer || null,
      });
    }
    after = (data.paging as Record<string, Record<string, string>>)?.next?.after;
    pageCount++;
    if (after) await sleep(150);
  } while (after && pageCount < MAX_PAGES);

  customersCache = { data: all, timestamp: Date.now() };
  return all;
}

export async function fetchOwnerNames(): Promise<Record<string, string>> {
  if (ownersCache && Date.now() - ownersCache.timestamp < CACHE_TTL) {
    return ownersCache.data;
  }
  if (ownersInFlight) return ownersInFlight;
  ownersInFlight = doFetchOwnerNames().finally(() => {
    ownersInFlight = null;
  });
  return ownersInFlight;
}

async function doFetchOwnerNames(): Promise<Record<string, string>> {
  const data = await hubspotFetch(`${BASE_URL}/crm/v3/owners?limit=100`);
  const map: Record<string, string> = {};
  const ownerResults = (data.results || []) as Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  }>;

  for (const owner of ownerResults) {
    const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
    map[owner.id] = name || owner.email || owner.id;
  }

  ownersCache = { data: map, timestamp: Date.now() };
  return map;
}

export function invalidateCache() {
  contactsCache = null;
  ownersCache = null;
}
