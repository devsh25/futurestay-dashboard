/**
 * Retention curve computation — % of paying-customer cohort still
 * active at each week post-entry, segmented by plan family.
 *
 * The cancel timestamp is pulled from HubSpot's property-history
 * endpoint (account_lifecycle → former.customer transition) because
 * hs_v2_date_exited_customer is empty for every contact in this
 * account. Property history is the only reliable source for "when
 * did this person actually cancel" given current data.
 *
 * Cohort math (single-cohort survival — fixed denominator):
 *   1. Pick a per-segment observation horizon = the longest milestone
 *      where (customers with ≥ that tenure) ≥ MIN_COHORT_SIZE.
 *   2. Anchor the cohort at that horizon: cohort = customers whose
 *      tenure ≥ horizon.
 *   3. For every milestone W ≤ horizon:
 *        retainedAtW = customers in the anchor cohort who had NOT
 *                      cancelled before day W
 *        retention(W) = retainedAtW / cohort.length
 *
 *   Why fixed-cohort instead of rolling-window:
 *   The rolling-window approach (where the denominator was different
 *   at each milestone — "everyone with ≥W tenure") produced a
 *   non-monotonic curve because newer cohorts churn at different
 *   rates than older cohorts. With a fixed cohort, every milestone
 *   measures the SAME set of people, so the curve is guaranteed
 *   monotonically decreasing — what a retention curve is supposed
 *   to show.
 *
 *   Trade-off: the cohort is smaller (only customers with ≥horizon
 *   tenure count), but the result is statistically meaningful instead
 *   of statistically misleading.
 */

import type { HubSpotContact } from "./types";

const HS_BASE = "https://api.hubapi.com";
const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

export interface RetentionPoint {
  /** Days since customer entry. 0 anchors the curve at 100%. */
  day: number;
  /** Human-readable milestone label, e.g. "Week 1", "30 days". */
  label: string;
  /** % of cohort still active at this point. */
  retentionPct: number;
  /** Number of customers in the cohort with ≥ this much tenure. */
  cohortSize: number;
}

export interface RetentionSegment {
  segment: string;       // e.g., "Amplify", "Flex"
  totalCohort: number;   // total customers in this plan family ever
  points: RetentionPoint[];
}

export interface RetentionData {
  asOf: string;
  segments: RetentionSegment[];
  /** Milestone days the curve is sampled at. */
  milestones: { day: number; label: string }[];
}

/** Plan family classifier. Searches multiple plan fields because plan
 *  data is scattered (plan_name often empty, plan_type_legacy more
 *  populated, limited_access_previous_plan covers historical paid
 *  customers, etc.). */
function planFamily(c: HubSpotContact): "Amplify" | "Flex" | null {
  const blob = [
    c.plan_name,
    c.plan_type_legacy,
    c.plan_type_old,
    c.limited_access_previous_plan,
    c.subscription_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (blob.includes("flex")) return "Flex";
  if (blob.includes("amplify")) return "Amplify";
  return null;
}

/** Was this contact ever a paying customer? */
function wasPaidCustomer(c: HubSpotContact): boolean {
  const lc = c.account_lifecycle || "";
  if (lc === "customer" || lc === "former.customer" || lc === "Customer/Limited Access") {
    // also require they had a paid plan, not just FS Connect (free)
    return planFamily(c) !== null;
  }
  return false;
}

/** Batch-fetch property history for a list of contact IDs. Returns a
 *  Map keyed by contact ID with the timestamp (ms) at which their
 *  account_lifecycle transitioned to "former.customer", or null if no
 *  such transition exists.
 *
 *  Uses HubSpot's batch read endpoint with propertiesWithHistory —
 *  one API call per 100 contacts, instead of one call per contact.
 *  Critical for keeping this card cheap to refresh. */
async function fetchCancelTimestamps(
  contactIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (contactIds.length === 0) return result;

  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100);
    const body = {
      inputs: chunk.map((id) => ({ id })),
      propertiesWithHistory: ["account_lifecycle"],
    };

    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      // Don't fail the whole computation — skip this chunk and keep
      // going. The result for those contacts will just be missing,
      // which we'll treat as "currently active" (best available
      // assumption when we can't determine cancel time).
      console.warn(`Retention batch read failed for chunk: ${res.status}`);
      continue;
    }

    type Resp = {
      results?: Array<{
        id: string;
        propertiesWithHistory?: {
          account_lifecycle?: Array<{ value: string; timestamp: string }>;
        };
      }>;
    };
    const d = (await res.json()) as Resp;
    for (const row of d.results ?? []) {
      const history = row.propertiesWithHistory?.account_lifecycle ?? [];
      // Most-recent transition to former.customer
      for (const h of history) {
        if (h.value === "former.customer") {
          const t = new Date(h.timestamp).getTime();
          if (!isNaN(t)) {
            result.set(row.id, t);
            break;
          }
        }
      }
    }
  }

  return result;
}

const MILESTONES: { day: number; label: string }[] = [
  { day: 0,   label: "Day 0" },
  { day: 7,   label: "Week 1" },
  { day: 14,  label: "Week 2" },
  { day: 21,  label: "Week 3" },
  { day: 28,  label: "Week 4" },
  { day: 42,  label: "Week 6" },
  { day: 56,  label: "Week 8" },
  { day: 84,  label: "Week 12" },
  { day: 168, label: "Week 24" },
  { day: 365, label: "1 Year" },
];

/** Minimum cohort size to plot a milestone — below this, the % is
 *  too noisy to display (one cancellation moves the line by 10%+). */
const MIN_COHORT_SIZE = 10;

export async function computeRetention(
  contacts: HubSpotContact[]
): Promise<RetentionData> {
  // Filter to paid customers only (Amplify or Flex)
  const paidCustomers = contacts.filter(wasPaidCustomer);

  // Identify former.customers we need cancel timestamps for
  const cancelledIds = paidCustomers
    .filter((c) => c.account_lifecycle === "former.customer")
    .map((c) => c.id);

  const cancelTimestamps = await fetchCancelTimestamps(cancelledIds);

  // Group customers by plan family + compute retention curves
  const today = Date.now();
  const segments: RetentionSegment[] = [];

  for (const family of ["Amplify", "Flex"] as const) {
    const customers = paidCustomers.filter((c) => planFamily(c) === family);
    const totalCohort = customers.length;

    // For each customer: compute (entryMs, cancelMs|null)
    const records: { entryMs: number; cancelMs: number | null }[] = customers
      .map((c) => {
        if (!c.hs_v2_date_entered_customer) return null;
        const entryMs = new Date(c.hs_v2_date_entered_customer).getTime();
        if (isNaN(entryMs)) return null;
        const cancelMs =
          c.account_lifecycle === "former.customer"
            ? cancelTimestamps.get(c.id) ?? null
            : null;
        return { entryMs, cancelMs };
      })
      .filter((r): r is { entryMs: number; cancelMs: number | null } => r !== null);

    // Step 1: find the longest milestone for which we have a usable
    // cohort (≥ MIN_COHORT_SIZE customers with that tenure).
    let horizonDay = 0;
    let anchorCohort: { entryMs: number; cancelMs: number | null }[] = [];
    for (const m of MILESTONES) {
      const requiredTenureMs = m.day * 86_400_000;
      const c = records.filter((r) => today - r.entryMs >= requiredTenureMs);
      if (c.length >= MIN_COHORT_SIZE) {
        horizonDay = m.day;
        anchorCohort = c;
      } else {
        break; // milestones only get further out — once we drop below threshold we're done
      }
    }

    // Step 2: compute retention at each milestone ≤ horizon using the
    // SAME anchor cohort. Curve is monotonically decreasing.
    const points: RetentionPoint[] = [];
    for (const m of MILESTONES) {
      if (m.day > horizonDay) break;
      const requiredTenureMs = m.day * 86_400_000;
      const retained = anchorCohort.filter((r) => {
        if (r.cancelMs === null) return true; // still active = still retained
        const tenureAtCancelMs = r.cancelMs - r.entryMs;
        return tenureAtCancelMs >= requiredTenureMs;
      }).length;
      points.push({
        day: m.day,
        label: m.label,
        retentionPct: anchorCohort.length > 0 ? (retained / anchorCohort.length) * 100 : 0,
        cohortSize: anchorCohort.length,
      });
    }

    segments.push({ segment: family, totalCohort, points });
  }

  return {
    asOf: new Date().toISOString().slice(0, 10),
    segments,
    milestones: MILESTONES,
  };
}
