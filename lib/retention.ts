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

/** Four-way plan segment classifier: {Amplify, Flex} × {Yearly, Monthly}.
 *
 *  Primary source is the Chargebee `cb_product` plan code, which is
 *  100% populated for paid customers in this account and carries
 *  BOTH family and cycle (e.g., "Futurestay-Amplify-USD-Yearly",
 *  "Futurestay-Flex-USD-Monthly"). Limited-Access SKUs fall back to
 *  the customer's previous plan and assume Monthly (LA contracts in
 *  this account are all monthly).
 *
 *  Fallback for the rare contact without cb_product: legacy fields
 *  (plan_name, plan_type_legacy, etc.). Cycle defaults to null in
 *  that case — the contact is excluded from the retention chart
 *  (we don't want to misclassify by guessing). */
export type PlanSegment =
  | "Amplify Yearly"
  | "Amplify Monthly"
  | "Flex Yearly"
  | "Flex Monthly";

function planSegment(c: HubSpotContact): PlanSegment | null {
  // Tier 1: cb_product (preferred)
  const cb = (c.cb_product || "").toLowerCase();
  if (cb) {
    const cycle: "Yearly" | "Monthly" | null = cb.includes("yearly") || cb.includes("annual")
      ? "Yearly"
      : cb.includes("monthly")
        ? "Monthly"
        : null;
    if (cycle) {
      if (cb.includes("amplify")) return `Amplify ${cycle}`;
      if (cb.includes("flex"))    return `Flex ${cycle}`;
      // Limited-Access SKU: classify by previous plan, cycle stays whatever
      // the LA SKU says (which is usually Monthly in this account).
      if (cb.includes("limited-access")) {
        const prev = (c.limited_access_previous_plan || "").toLowerCase();
        if (prev.includes("amplify")) return `Amplify ${cycle}`;
        if (prev.includes("flex"))    return `Flex ${cycle}`;
      }
    }
  }
  // Tier 2: legacy plan fields — family only, no cycle. Returns null
  // because we don't want to fake a cycle classification.
  return null;
}

/** Plan family ignoring cycle — used for the "ever a paid customer"
 *  test, which doesn't care about cycle. Has a wider fallback chain
 *  to catch legacy contacts whose cb_product never got synced. */
function planFamily(c: HubSpotContact): "Amplify" | "Flex" | null {
  const cb = (c.cb_product || "").toLowerCase();
  if (cb.includes("amplify")) return "Amplify";
  if (cb.includes("flex"))    return "Flex";
  if (cb.includes("limited-access")) {
    const prev = (c.limited_access_previous_plan || "").toLowerCase();
    if (prev.includes("amplify")) return "Amplify";
    if (prev.includes("flex"))    return "Flex";
  }
  const blob = [
    c.plan_name, c.plan_type_legacy, c.plan_type_old,
    c.limited_access_previous_plan, c.subscription_type,
  ].filter(Boolean).join(" ").toLowerCase();
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

/** Per-contact lifecycle dates derived from HubSpot's property history.
 *  - entryMs: most-recent transition INTO a customer-style lifecycle
 *    (customer / Customer/Limited Access). Used to recover entry-date
 *    for the ~270 old contacts whose hs_v2_date_entered_customer is
 *    not populated.
 *  - cancelMs: most-recent transition into former.customer. Null if
 *    the contact has never cancelled (currently active customer).
 *
 *  Both are taken from the SAME history array, which HubSpot returns
 *  newest-first by default. */
interface LifecycleTimes {
  entryMs: number | null;
  cancelMs: number | null;
}

async function fetchLifecycleTimes(
  contactIds: string[]
): Promise<Map<string, LifecycleTimes>> {
  const result = new Map<string, LifecycleTimes>();
  if (contactIds.length === 0) return result;

  // HubSpot batch-read with propertiesWithHistory has a *50-per-request*
  // limit (the normal batch-read limit of 100 doesn't apply here).
  // Sending 100 silently truncates to 50, which produced incomplete
  // results in the first version of this code. Chunk at 50 strictly.
  const CHUNK = 50;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const chunk = contactIds.slice(i, i + CHUNK);
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
      console.warn(`Retention batch read failed for chunk starting at ${i}: ${res.status}`);
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
      let entryMs: number | null = null;
      let cancelMs: number | null = null;
      // Iterate newest → oldest. Take the most-recent transition for
      // each target lifecycle value.
      for (const h of history) {
        if (cancelMs === null && h.value === "former.customer") {
          const t = new Date(h.timestamp).getTime();
          if (!isNaN(t)) cancelMs = t;
        }
        if (entryMs === null && (h.value === "customer" || h.value === "Customer/Limited Access")) {
          const t = new Date(h.timestamp).getTime();
          if (!isNaN(t)) entryMs = t;
        }
        if (entryMs !== null && cancelMs !== null) break;
      }
      result.set(row.id, { entryMs, cancelMs });
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

/** Earliest customer-entry date the retention curve will consider.
 *  Older customers are pre-2026 long-tail and aren't relevant for
 *  the user's current decision-making — they distort the curve with
 *  multi-year survivorship from a different product era. */
const COHORT_START_MS = new Date("2026-03-01T00:00:00.000Z").getTime();

export async function computeRetention(
  contacts: HubSpotContact[]
): Promise<RetentionData> {
  // Filter to paid customers only (Amplify or Flex). Exclude
  // WIX/HOPPER partner referrals (same exclusion every other card uses).
  const paidCustomers = contacts.filter((c) => {
    const ref = (c.referral_source || "").trim().toUpperCase();
    if (ref === "WIX" || ref === "HOPPER") return false;
    return wasPaidCustomer(c);
  });

  // Fetch property history for EVERY paying customer — not just the
  // former.customers — so we can recover entry-date for the ~270
  // legacy contacts whose hs_v2_date_entered_customer is empty.
  const allIds = paidCustomers.map((c) => c.id);
  const lifecycleTimes = await fetchLifecycleTimes(allIds);

  // Group customers by (plan family × billing cycle) and compute one
  // retention curve per segment. Limited-Access SKUs are folded back
  // into their previous plan family by `planSegment`. Contacts without
  // a cb_product cycle marker are dropped from this chart entirely so
  // we don't misclassify them — the totals shown elsewhere on the
  // dashboard still count them as customers.
  const today = Date.now();
  const segments: RetentionSegment[] = [];

  const SEGMENTS: PlanSegment[] = [
    "Amplify Yearly", "Amplify Monthly", "Flex Yearly", "Flex Monthly",
  ];
  for (const segName of SEGMENTS) {
    const customers = paidCustomers.filter((c) => planSegment(c) === segName);
    const totalCohort = customers.length;

    // For each customer: derive (entryMs, cancelMs).
    //   entryMs:  prefer hs_v2_date_entered_customer (more accurate
    //             when it exists), fall back to property history's
    //             most-recent customer transition for legacy contacts
    //             where the field is empty.
    //   cancelMs: from property history (the hs_v2 exit-date field
    //             is empty in this account, so history is the only
    //             reliable source). Only set if currently
    //             former.customer — re-subscribers (currently customer
    //             but were former.customer in the past) are treated
    //             as active, which is correct: they ARE active again.
    const records: { entryMs: number; cancelMs: number | null }[] = customers
      .map((c) => {
        const history = lifecycleTimes.get(c.id);
        // Prefer the property field; fall back to history.
        let entryMs: number | null = null;
        if (c.hs_v2_date_entered_customer) {
          const t = new Date(c.hs_v2_date_entered_customer).getTime();
          if (!isNaN(t)) entryMs = t;
        }
        if (entryMs === null) entryMs = history?.entryMs ?? null;
        if (entryMs === null) return null;

        // Cohort window: customers who entered AFTER March 1, 2026.
        // Pre-March cohorts represent a different product era and
        // distort the curve with multi-year survivorship bias.
        if (entryMs < COHORT_START_MS) return null;

        const cancelMs =
          c.account_lifecycle === "former.customer"
            ? history?.cancelMs ?? null
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

    segments.push({ segment: segName, totalCohort, points });
  }

  return {
    asOf: new Date().toISOString().slice(0, 10),
    segments,
    milestones: MILESTONES,
  };
}
