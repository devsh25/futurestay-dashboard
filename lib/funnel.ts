import {
  HubSpotContact,
  FunnelStage,
  CampaignRow,
  GeoRow,
  RepRow,
  KPIs,
  DQWeekly,
  CohortData,
  DashboardData,
  PeriodFilter,
} from "./types";
import {
  bucketContactToCampaign,
  matchContactToMetaCampaign,
  matchContactToGoogleAdGroup,
  isGoogleSourcedContact,
  isMetaAttributedContact,
} from "./campaigns";
import type { GoogleAdsAdGroup } from "./google";
import {
  tzStartOfDay, tzEndOfDay, tzAddDays, tzStartOfWeek,
  tzStartOfMonth, tzStartOfQuarter, tzDateKey,
} from "./timezone";

/** Sentinel campaign values for the Funnel filter dropdown.
 *  Prefixed with "@" so they never collide with a real Meta or
 *  Google campaign name.
 *
 *  PMAX / BRAND group all Google campaigns matching a name pattern
 *  (any "Pmax …" / any "Brand …" campaign). Useful because Google
 *  Ads campaigns are typically named by type-prefix in this account,
 *  so a single dropdown choice lets the user scope to a whole class
 *  rather than picking individual campaigns. */
export const ALL_META_SENTINEL     = "@all-meta";
export const ALL_GOOGLE_SENTINEL   = "@all-google";
export const GOOGLE_PMAX_SENTINEL  = "@google-pmax";
export const GOOGLE_BRAND_SENTINEL = "@google-brand";

/** Name predicates for the Google-family sentinels. Both case-
 *  insensitive, word-boundary-anchored so "PMax-Search-Brand"
 *  matches both. Kept side-by-side so it's obvious how to add new
 *  ones (e.g. "@google-search", "@google-display"). */
const GOOGLE_PMAX_NAME_REGEX  = /(^|[^a-z])pmax([^a-z]|$)/i;
const GOOGLE_BRAND_NAME_REGEX = /(^|[^a-z])brand([^a-z]|$)/i;

// ---- Date helpers ----

function getDateRange(period: PeriodFilter): { start: Date; end: Date } {
  // All boundaries computed in Eastern Time. "Last 7 days" means the
  // last 7 ET calendar days, "This week" means Monday 00:00 ET → now,
  // etc. — matches what a US user expects.
  const now = new Date();
  const end = tzEndOfDay(now);

  switch (period) {
    case "last7d": {
      const start = tzAddDays(now, -7);
      return { start, end };
    }
    case "last30d": {
      const start = tzAddDays(now, -30);
      return { start, end };
    }
    case "thisWeek": {
      const start = tzStartOfWeek(now);
      return { start, end };
    }
    case "lastWeek": {
      // Previous Monday → previous Sunday in ET.
      const thisMonday = tzStartOfWeek(now);
      const start = tzAddDays(thisMonday, -7);
      const lwEnd = tzEndOfDay(tzAddDays(start, 6));
      return { start, end: lwEnd };
    }
    case "thisMonth": {
      return { start: tzStartOfMonth(now), end };
    }
    case "thisQuarter": {
      return { start: tzStartOfQuarter(now), end };
    }
    case "allTime":
    default:
      return { start: tzStartOfDay(new Date("2026-01-01T12:00:00Z")), end };
  }
}

export function resolvedDateRange(
  period: PeriodFilter,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  if (period === "custom" && customStart && customEnd) {
    // Custom dates are YYYY-MM-DD strings — interpret them in ET so
    // the picker shows local-meaningful days.
    return {
      start: tzStartOfDay(new Date(customStart + "T12:00:00Z")),
      end: tzEndOfDay(new Date(customEnd + "T12:00:00Z")),
    };
  }
  return getDateRange(period);
}

function dateInRange(dateStr: string | null, start: Date, end: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

function filterBySignupDate(contacts: HubSpotContact[], start: Date, end: Date): HubSpotContact[] {
  return contacts.filter((c) => dateInRange(c.createdate, start, end));
}

// ---- Geo filter (multi-country) ----

function normalizeCountryValue(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (["united states", "us", "usa", "u.s.", "u.s.a."].includes(lower)) return "united states";
  if (["canada", "ca"].includes(lower)) return "canada";
  if (["mexico", "mx", "méxico"].includes(lower)) return "mexico";
  return lower;
}

function filterByCountries(contacts: HubSpotContact[], countries: string[]): HubSpotContact[] {
  if (!countries.length) return contacts;
  const set = new Set(countries.map((c) => c.toLowerCase()));
  return contacts.filter((c) => {
    const raw = c.country || c.ip_country || "";
    if (!raw.trim()) return false;
    return set.has(normalizeCountryValue(raw));
  });
}

// ---- Channel filter ----

function getChannel(c: HubSpotContact): string {
  const medium = (c.first_touch_utm_medium || "").toLowerCase();
  const source = (c.first_touch_utm_source || "").toLowerCase();
  if (medium === "paid_social" || medium === "paidsocial") return "Paid Social";
  if (medium === "paid" && (source === "google" || source === "bing")) return "Paid Search";
  if (medium === "email" || source === "email") return "Email";
  if (medium === "display" || medium === "cpm") return "Display";
  if (medium === "social" || source.includes("facebook") || source.includes("instagram")) return "Organic Social";
  if (medium === "organic" || source === "google" || source === "bing") return "Organic Search";
  return "Direct";
}

function filterByChannels(contacts: HubSpotContact[], channels: string[]): HubSpotContact[] {
  if (!channels.length) return contacts;
  const set = new Set(channels);
  return contacts.filter((c) => set.has(getChannel(c)));
}

// ---- Global exclusions ----

const EXCLUDED_REFERRAL_SOURCES = ["WIX", "HOPPER"];

/** Is this contact an internal Futurestay test account? Used to keep
 *  employee testing out of Run Rate, KPI, and Campaign Analysis counts.
 *
 *  Three signals, each independently sufficient:
 *    1. Email on a Futurestay-owned domain
 *    2. Plus-tag pattern in email local-part (+test / +trial / +demo /
 *       +qa / +staging / +dev — possibly suffixed with digits)
 *    3. Obvious test/QA/demo naming convention in firstname+lastname
 *
 *  Audited against the last 10 weeks of HubSpot data (2026-04-08 →
 *  2026-06-17): catches all 17 known test accounts (Filomena/Phil/AJ/
 *  Bianca/Kim/Erica/dev), 0 false positives. Test pollution was 0.6%
 *  of metric-counts overall, 1.2% of Trialists, with a spike to 36%
 *  on 2026-06-16 when 4 fmorales+trial[1-4] accounts triggered in
 *  a single batch.
 *
 *  Exported so non-funnel call-sites (Campaign Analysis, etc.) can
 *  share the same definition. */
export function isTestContact(c: HubSpotContact): boolean {
  const email = (c.email || "").toLowerCase().trim();
  if (email.endsWith("@futurestay.com") || email.endsWith("@futurestay.io")) return true;
  if (/\+(trial|test|demo|qa|staging|dev)\d*@/.test(email)) return true;
  const fullName = `${(c.firstname || "").trim()} ${(c.lastname || "").trim()}`.trim();
  if (/^(trial )?test\d*$/i.test(fullName)) return true;
  if (/^test (account|user|trial)/i.test(fullName)) return true;
  if (/^(qa|demo) /i.test(fullName)) return true;
  return false;
}

/** True if the contact came in via a partner integration (WIX or
 *  Hopper). These channels generate signups that aren't part of
 *  Futurestay's own funnel and would inflate every metric if counted. */
export function isPartnerReferral(c: HubSpotContact): boolean {
  const src = (c.referral_source || "").trim().toUpperCase();
  return EXCLUDED_REFERRAL_SOURCES.includes(src);
}

/** Strip partner-referral + internal-test contacts. The clean-up step
 *  that runs first in every Run Rate / KPI / funnel computation —
 *  what's left is contacts who actually represent real Futurestay-
 *  driven customer acquisition. Used to be called excludePartnerSources
 *  (partner-only); test exclusion added 2026-06-17 after a 10-week
 *  audit found employee tests creeping up to ~1% of weekly signups. */
function excludeArtifactContacts(contacts: HubSpotContact[]): HubSpotContact[] {
  return contacts.filter((c) => !isPartnerReferral(c) && !isTestContact(c));
}

// ---- Paid filter ----

function isPaid(c: HubSpotContact): boolean {
  return (c.first_touch_utm_medium || "").toLowerCase().includes("paid");
}

// ---- Funnel stage logic ----

function isAuth(c: HubSpotContact): boolean {
  return ["COMPLETED", "REVOKED"].includes(c.airbnb_authorization_status || "");
}

function hasDQ(c: HubSpotContact): boolean {
  return !!(c.airbnbdqreason && c.airbnbdqreason.trim());
}

function createdProps(c: HubSpotContact): boolean {
  try { return parseFloat(c.user_properties_created || "0") > 0; } catch { return false; }
}

function clickedLaunch(c: HubSpotContact): boolean {
  return c.user_clicked_launch_property === "yes";
}

// Property is fully set up and the user marked it Ready to Launch.
// More definitive signal than "Clicked Launch" — captures the final
// pre-trial setup step.
function isReadyToLaunch(c: HubSpotContact): boolean {
  return (c.property_ready_to_launch || "").toLowerCase() === "true";
}

const TRIAL_LIFECYCLES = ["Trialist", "customer", "former.customer", "Customer/Limited Access"];
const CUSTOMER_LIFECYCLES = ["customer", "Customer/Limited Access"];
const EVER_PAID_LIFECYCLES = ["customer", "former.customer", "Customer/Limited Access"];

// A "Signup" is a contact that has reached or passed the signup stage of
// account_lifecycle — they completed the Futurestay signup form. Excludes
// pure marketing leads (Lead), partner-imported contacts that never
// signed up (empty lifecycle), and other ghost contacts. Disqualified
// users ARE signups — they completed the form, just got rejected at the
// Airbnb-validation step.
//
// Note: HubSpot stores "Disqualfied" with a typo (missing one 'i').
// The set must match the actual stored value, not the correctly-spelled
// English word. Verified against live HubSpot data.
const SIGNUP_LIFECYCLES = new Set([
  "signup",
  "Trialist",
  "customer",
  "former.customer",
  "Customer/Limited Access",
  "Disqualfied",
]);

function isSignup(c: HubSpotContact): boolean {
  return SIGNUP_LIFECYCLES.has(c.account_lifecycle || "");
}

// ---- Paid plan detection ----
// Per Data Guide 3.0 + product rule: a Customer is someone on a *paid*
// plan (Amplify or Flex). FS Connect ("Connect") is free and NOT counted
// as a Customer in the dashboard.

const PAID_PLANS = new Set(["amplify", "flex"]);

function effectivePlan(c: HubSpotContact): string | null {
  // plan_name is the canonical enum but only ~30% populated.
  // don_t_use____plan_type is the legacy field with the most complete data
  // (still used by the Chargebee → HubSpot workflows as of 2026-04).
  return (
    c.plan_name ||
    c.plan_type_legacy ||
    c.plan_type_old ||
    null
  );
}

// Has (or had) a paid Amplify/Flex plan attached. For Limited Access users,
// we check limited_access_previous_plan — an LA user who previously paid is
// still counted as a Customer (per Data Guide: "considered a customer").
function hadPaidPlan(c: HubSpotContact): boolean {
  const plan = (effectivePlan(c) || "").trim().toLowerCase();
  if (PAID_PLANS.has(plan)) return true;
  const laPrev = (c.limited_access_previous_plan || "").toLowerCase();
  if (!laPrev) return false;
  // LA previous plan format: "Futurestay-Amplify-USD-Yearly", "Flex Monthly", etc.
  return laPrev.includes("amplify") || laPrev.includes("flex");
}

function everTrialed(c: HubSpotContact): boolean {
  return TRIAL_LIFECYCLES.includes(c.account_lifecycle || "");
}

// Customer = in customer/LA lifecycle AND has paid plan AND not a quick cancel.
// Excludes FS Connect (free) and quick-cancelled paid subs per product rule.
function isCustomer(c: HubSpotContact): boolean {
  if (!CUSTOMER_LIFECYCLES.includes(c.account_lifecycle || "")) return false;
  if (isQuickCancel(c)) return false;
  return hadPaidPlan(c);
}

// Trial length policy fallback (Futurestay trial = 14d). Used only when
// Chargebee's authoritative trial-end field is missing.
const TRIAL_LENGTH_DAYS = 14;

// Currently in trial. Problem: HubSpot's account_lifecycle=Trialist goes
// stale — we've observed trials from Feb/March still marked Trialist in
// late April because the Chargebee → HubSpot workflow didn't flip the
// lifecycle on expiry.
//
// Signal priority:
//   1. account_lifecycle must be "Trialist" (required)
//   2. cb_subcst_trial_end — Chargebee's authoritative trial end date.
//      Created 2026-04-15 so only trials started after that have it;
//      future date = active, past date = stale.
//   3. Fallback (no Chargebee date): trial age <= 14 days.
function isInTrial(c: HubSpotContact): boolean {
  if (c.account_lifecycle !== "Trialist") return false;
  const now = Date.now();

  if (c.cb_subcst_trial_end) {
    const end = new Date(c.cb_subcst_trial_end).getTime();
    if (!isNaN(end)) return end > now;
  }

  const td = getTrialEnteredDate(c);
  if (!td) return true; // trust lifecycle when we have no date to check
  const ageDays = (now - td.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= TRIAL_LENGTH_DAYS;
}

// Raw: any contact currently in former.customer lifecycle.
// Includes both real churns AND failed trialists — use isRealChurn /
// isFailedTrialist for dashboard semantics (per Futurestay Data Guide 3.0).
function isFormerCustomer(c: HubSpotContact): boolean {
  return c.account_lifecycle === "former.customer";
}

// Limited Access: cancelled paid/free sub but retains dashboard access
// for direct bookings. Per Data Guide: "Considered a Customer" in reporting.
function isLimitedAccess(c: HubSpotContact): boolean {
  return c.account_lifecycle === "Customer/Limited Access";
}

// Did this contact ever reach Customer lifecycle stage?
// Presence of hs_v2_date_entered_customer is HubSpot's canonical signal.
function everBecameCustomer(c: HubSpotContact): boolean {
  if (!c.hs_v2_date_entered_customer) return false;
  const d = new Date(c.hs_v2_date_entered_customer);
  return !isNaN(d.getTime());
}

// Quick Cancel: entered Customer stage but cancelled within 2 days.
// Per product rule: these are NOT real conversions — treat as Failed Trialist.
const QUICK_CANCEL_THRESHOLD_DAYS = 2;

function isQuickCancel(c: HubSpotContact): boolean {
  if (!c.hs_v2_date_entered_customer || !c.hs_v2_date_exited_customer) return false;
  const entered = new Date(c.hs_v2_date_entered_customer).getTime();
  const exited = new Date(c.hs_v2_date_exited_customer).getTime();
  if (isNaN(entered) || isNaN(exited)) return false;
  const diffDays = (exited - entered) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays < QUICK_CANCEL_THRESHOLD_DAYS;
}

// Real Churn (Data Guide): was a paid Customer (Amplify/Flex), now cancelled.
// Excludes failed trialists, quick cancels, and FS Connect (free) churns.
function isRealChurn(c: HubSpotContact): boolean {
  if (!isFormerCustomer(c)) return false;
  if (!everBecameCustomer(c)) return false;
  if (isQuickCancel(c)) return false;
  return hadPaidPlan(c);
}

// Failed Trialist (Data Guide): Trialist who cancelled BEFORE becoming a real
// paid customer. NOT counted as churn. In HubSpot this surfaces as
// former.customer either because (a) they never entered customer stage,
// (b) they entered and cancelled within 2 days (product rule), or (c) they
// "converted" to FS Connect (free) — also excluded per paid-customer rule.
function isFailedTrialist(c: HubSpotContact): boolean {
  if (!isFormerCustomer(c)) return false;
  if (!everBecameCustomer(c)) return true;
  if (isQuickCancel(c)) return true;
  return !hadPaidPlan(c);
}

// "Ever became a real paid customer" — entered the Customer stage on a paid
// (Amplify/Flex) plan and did NOT quick-cancel within 2 days. UNLIKE
// isCustomer, this ignores the *current* lifecycle stage, so someone who
// converted and later churned (now former.customer) still counts as a
// conversion, keyed by their customer-entry date.
//
// Use this for conversion metrics (Run Rate customers line, Trial→Customer %,
// Signup→Customer %, per-campaign / per-geo / per-rep conversion). Use
// isCustomer only where "currently a paying customer" is meant — e.g. the
// churn-rate denominator and the funnel's current-state Customer node (which
// has its own separate Churned branch, so counting churns there too would
// double-count them).
function everBecameRealCustomer(c: HubSpotContact): boolean {
  if (!everBecameCustomer(c)) return false;
  if (isQuickCancel(c)) return false;
  return hadPaidPlan(c);
}

// ---- Date-based trial/customer detection (using HubSpot lifecycle dates) ----

function getTrialEnteredDate(c: HubSpotContact): Date | null {
  // Primary: hs_v2_date_entered_opportunity (HubSpot canonical trial entry date)
  // Fallback: trial__start_date — only used when v2 date is absent to capture
  // older contacts that predate v2 lifecycle tracking.
  const raw = c.hs_v2_date_entered_opportunity || c.trial__start_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function getCustomerEnteredDate(c: HubSpotContact): Date | null {
  // Use hs_v2_date_entered_customer (definitive — HubSpot's canonical customer entry date).
  // No fallback: estimating from trial_start + 14 days creates phantom customers
  // when the contact's actual customer entry was outside the period.
  if (!c.hs_v2_date_entered_customer) return null;
  const d = new Date(c.hs_v2_date_entered_customer);
  return isNaN(d.getTime()) ? null : d;
}

// ---- Compute funnel (signup-cohort based for progression metrics) ----

function computeFunnel(qualified: HubSpotContact[], allSignups: HubSpotContact[]): FunnelStage[] {
  const qualifiedTotal = qualified.length;
  const totalSignups = allSignups.length;
  const dqCount = allSignups.filter(hasDQ).length;
  const authCount = qualified.filter(isAuth).length;
  const propsCount = qualified.filter(createdProps).length;
  const launchCount = qualified.filter(clickedLaunch).length;
  const readyCount = qualified.filter(isReadyToLaunch).length;
  const trialCount = qualified.filter(everTrialed).length;
  const inTrialCount = qualified.filter(isInTrial).length;
  const customerCount = qualified.filter(isCustomer).length;
  // Funnel "Churned" = real churns only (per Data Guide 3.0).
  // Failed trialists are shown as their own branch off Trial Started.
  const churnedCount = qualified.filter(isRealChurn).length;
  const failedTrialistCount = qualified.filter(isFailedTrialist).length;

  // Note: launchCount removed from funnel display per product request
  void launchCount;
  // Total Signups added as the new first stage. Drop from Total → Qualified
  // is the Airbnb DQ step (computed/labeled in the FunnelCard component).
  const mainStages: [string, number][] = [
    ["Total Signups", totalSignups],
    ["Qualified Signups", qualifiedTotal],
    ["Authorized Airbnb", authCount],
    ["Created Properties", propsCount],
    ["Ready to Launch", readyCount],
    ["Trial Started", trialCount],
    ["In Trial", inTrialCount],
    ["Failed Trialist", failedTrialistCount],
    ["Customer", customerCount],
    ["Churned", churnedCount],
  ];

  const funnel: FunnelStage[] = [];
  funnel.push({
    name: "AirbnbDQ", count: dqCount, lost: null,
    dropoff: totalSignups > 0 ? (dqCount / totalSignups) * 100 : null, stepConv: null,
  });

  for (let i = 0; i < mainStages.length; i++) {
    const [name, count] = mainStages[i];
    if (i === 0) {
      funnel.push({ name, count, lost: null, dropoff: null, stepConv: null });
    } else {
      // Branching per Futurestay Data Guide 3.0:
      //   Trial Started → {In Trial, Failed Trialist, Customer}  (parallel outcomes)
      //   Customer → Churned  (sequential; only real churns here)
      let prevIdx = i - 1;
      if (name === "In Trial" || name === "Customer" || name === "Failed Trialist") {
        prevIdx = mainStages.findIndex(([n]) => n === "Trial Started");
      } else if (name === "Churned") {
        prevIdx = mainStages.findIndex(([n]) => n === "Customer");
      }
      const prev = mainStages[prevIdx][1];
      const lost = prev - count;
      funnel.push({ name, count, lost, dropoff: prev > 0 ? (lost / prev) * 100 : null, stepConv: null });
    }
  }
  return funnel;
}

// ---- KPIs: period-based (actual activity during period) ----

function computeKPIs(
  allContacts: HubSpotContact[],
  signupFiltered: HubSpotContact[],
  qualifiedSignups: HubSpotContact[],
  start: Date,
  end: Date
): KPIs {
  // Qualified signups = total signups minus DQ. This is the headline metric.
  const totalQualifiedSignups = qualifiedSignups.length;
  const totalSignups = signupFiltered.length; // used only for DQ rate

  // Trials = entered trial during this period (hs_v2_date_entered_opportunity or fallback)
  const totalTrials = allContacts.filter((c) => {
    const td = getTrialEnteredDate(c);
    return td && td >= start && td <= end;
  }).length;

  // Customers = entered customer during this period AND became a real paid
  // customer (Amplify/Flex, not a <2-day quick cancel). Counts conversions by
  // entry date regardless of current lifecycle, so since-churned customers
  // still count. Per Data Guide + product rule.
  const totalCustomers = allContacts.filter((c) => {
    const cd = getCustomerEnteredDate(c);
    if (!cd || cd < start || cd > end) return false;
    return everBecameRealCustomer(c);
  }).length;

  // In Trial = entered trial during this period AND still currently in trial
  const totalInTrial = allContacts.filter((c) => {
    const td = getTrialEnteredDate(c);
    return td && td >= start && td <= end && isInTrial(c);
  }).length;

  const dqCount = signupFiltered.filter(hasDQ).length;
  // Airbnb-DQ rate denominated against successful Airbnb connects:
  // of contacts who completed OAuth (auth COMPLETED/REVOKED) within
  // the period's signup cohort, what % were subsequently
  // disqualified during Airbnb listing validation? This measures
  // the "Airbnb connect → Ready to Launch" loss specifically.
  const authedInWindow = signupFiltered.filter(isAuth).length;
  const dqAmongAuthed = signupFiltered.filter((c) => isAuth(c) && hasDQ(c)).length;

  // ---- Sparkline (14 daily buckets ending at period end) ----
  const SPARKLINE_DAYS = 14;
  const sparklineEnd = new Date(end);
  const sparklineStart = new Date(end);
  sparklineStart.setDate(sparklineStart.getDate() - (SPARKLINE_DAYS - 1));
  sparklineStart.setHours(0, 0, 0, 0);

  const days: string[] = [];
  const rawSignupsDaily = new Array(SPARKLINE_DAYS).fill(0);
  const signupsDaily = new Array(SPARKLINE_DAYS).fill(0);
  const trialsDaily = new Array(SPARKLINE_DAYS).fill(0);
  const customersDaily = new Array(SPARKLINE_DAYS).fill(0);
  const inTrialDaily = new Array(SPARKLINE_DAYS).fill(0);

  for (let i = 0; i < SPARKLINE_DAYS; i++) {
    const d = new Date(sparklineStart);
    d.setDate(sparklineStart.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const dayIndex = (d: Date): number => {
    const diffMs = d.getTime() - sparklineStart.getTime();
    const idx = Math.floor(diffMs / 86400000);
    return idx >= 0 && idx < SPARKLINE_DAYS ? idx : -1;
  };

  for (const c of allContacts) {
    // Total signups (raw — includes DQ'd, excludes leads/empty).
    if (isSignup(c) && c.createdate) {
      const idx = dayIndex(new Date(c.createdate));
      if (idx >= 0) rawSignupsDaily[idx]++;
    }
    // Qualified signups (matches the headline metric — excludes DQ'd).
    if (isSignup(c) && !hasDQ(c) && c.createdate) {
      const idx = dayIndex(new Date(c.createdate));
      if (idx >= 0) signupsDaily[idx]++;
    }
    // Trials entered
    const td = getTrialEnteredDate(c);
    if (td) {
      const idx = dayIndex(td);
      if (idx >= 0) trialsDaily[idx]++;
      // In Trial: entered AND still Trialist
      if (isInTrial(c) && idx >= 0) inTrialDaily[idx]++;
    }
    // Customers entered — real paid conversions (incl. since-churned),
    // matching the totalCustomers tile so the sparkline agrees with it.
    const cd = getCustomerEnteredDate(c);
    if (cd && everBecameRealCustomer(c)) {
      const idx = dayIndex(cd);
      if (idx >= 0) customersDaily[idx]++;
    }
  }

  // ---- Trend deltas (this period vs equal-length prior period) ----
  const periodMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - periodMs);

  const countInRange = (
    contacts: HubSpotContact[],
    extract: (c: HubSpotContact) => Date | null,
    s: Date,
    e: Date,
    extraFilter?: (c: HubSpotContact) => boolean
  ): number =>
    contacts.filter((c) => {
      if (extraFilter && !extraFilter(c)) return false;
      const d = extract(c);
      return d !== null && d >= s && d <= e;
    }).length;

  const createdateOf = (c: HubSpotContact): Date | null =>
    c.createdate ? new Date(c.createdate) : null;

  const prevRawSignups = countInRange(allContacts, createdateOf, prevStart, prevEnd, isSignup);
  const prevSignups = countInRange(allContacts, createdateOf, prevStart, prevEnd, (c) => isSignup(c) && !hasDQ(c));
  const prevTrials = countInRange(allContacts, getTrialEnteredDate, prevStart, prevEnd);
  const prevCustomers = countInRange(allContacts, getCustomerEnteredDate, prevStart, prevEnd, everBecameRealCustomer);
  const prevInTrial = countInRange(allContacts, getTrialEnteredDate, prevStart, prevEnd, isInTrial);

  const delta = (current: number, previous: number) => ({
    current, previous,
    pct: previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0),
  });

  // Ready to Launch — cohort-based count of qualified signups whose
  // property has been marked ready (mid-funnel activation signal).
  const totalReadyToLaunch = qualifiedSignups.filter(isReadyToLaunch).length;

  // Exit paths (cohort-based, from qualified signups in this period).
  // Per Data Guide 3.0: distinguish real Churns from Failed Trialists.
  const totalChurned = qualifiedSignups.filter(isRealChurn).length;
  const totalFailedTrialists = qualifiedSignups.filter(isFailedTrialist).length;
  const totalLimitedAccess = qualifiedSignups.filter(isLimitedAccess).length;
  // totalFormerCustomers retained for backwards compat = raw former.customer count
  // (= churned + failed trialists). UI prefers the split fields above.
  const totalFormerCustomers = totalChurned + totalFailedTrialists;
  // Churn rate (Data Guide): real churns / (active customers + real churns).
  // Failed trialists excluded — "Failed Trialists are not considered a Churn".
  // Limited Access already included in isCustomer (counted as Customer per Guide).
  const cohortActiveCustomers = qualifiedSignups.filter(isCustomer).length;
  const cohortEverPaid = cohortActiveCustomers + totalChurned;
  const churnRate = cohortEverPaid > 0 ? (totalChurned / cohortEverPaid) * 100 : 0;

  return {
    totalSignups: totalQualifiedSignups, // headline "Qualified Signups"
    totalRawSignups: totalSignups,
    totalTrials,
    totalInTrial,
    totalReadyToLaunch,
    totalCustomers,
    totalFormerCustomers,
    totalChurned,
    totalFailedTrialists,
    totalLimitedAccess,
    trialRate: totalQualifiedSignups > 0 ? (totalTrials / totalQualifiedSignups) * 100 : 0,
    customerRate: totalQualifiedSignups > 0 ? (totalCustomers / totalQualifiedSignups) * 100 : 0,
    trialToPayRate: totalTrials > 0 ? (totalCustomers / totalTrials) * 100 : 0,
    churnRate,
    dqRate: totalSignups > 0 ? (dqCount / totalSignups) * 100 : 0,
    airbnbDqRate: authedInWindow > 0 ? (dqAmongAuthed / authedInWindow) * 100 : 0,
    sparkline: {
      rawSignups: rawSignupsDaily,
      signups: signupsDaily,
      trials: trialsDaily,
      customers: customersDaily,
      inTrial: inTrialDaily,
      days,
    },
    deltas: {
      rawSignups: delta(totalSignups, prevRawSignups),
      signups: delta(totalQualifiedSignups, prevSignups),
      trials: delta(totalTrials, prevTrials),
      inTrial: delta(totalInTrial, prevInTrial),
      customers: delta(totalCustomers, prevCustomers),
    },
  };
}

// ---- Cohort analysis (signup-date based) ----

function computeCohort(contacts: HubSpotContact[]): CohortData {
  const n = contacts.length;
  const auth = contacts.filter(isAuth).length;
  const props = contacts.filter(createdProps).length;
  const launch = contacts.filter(clickedLaunch).length;
  const ready = contacts.filter(isReadyToLaunch).length;
  const trials = contacts.filter(everTrialed).length;
  const inTrial = contacts.filter(isInTrial).length;
  // Customers (conversion sense) = ever became a real paid customer, including
  // those who have since churned. This is a "did this cohort convert?" count,
  // so it must NOT gate on current lifecycle — otherwise churned customers
  // vanish from the numerator while still sitting in the trials denominator.
  const customers = contacts.filter(everBecameRealCustomer).length;
  const churned = contacts.filter(isRealChurn).length;
  const failedTrialists = contacts.filter(isFailedTrialist).length;
  const limitedAccess = contacts.filter(isLimitedAccess).length;
  // formerCustomers kept as churned + failed for backwards compat.
  const formerCustomers = churned + failedTrialists;

  return {
    signups: n,
    authorized: auth,
    createdProperties: props,
    clickedLaunch: launch,
    readyToLaunch: ready,
    trials,
    inTrial,
    customers,
    formerCustomers,
    churned,
    failedTrialists,
    limitedAccess,
    authRate: n > 0 ? (auth / n) * 100 : 0,
    propsRate: n > 0 ? (props / n) * 100 : 0,
    launchRate: n > 0 ? (launch / n) * 100 : 0,
    readyToLaunchRate: n > 0 ? (ready / n) * 100 : 0,
    trialRate: n > 0 ? (trials / n) * 100 : 0,
    inTrialRate: n > 0 ? (inTrial / n) * 100 : 0,
    customerRate: n > 0 ? (customers / n) * 100 : 0,
    formerCustomerRate: n > 0 ? (formerCustomers / n) * 100 : 0,
    churnedRate: n > 0 ? (churned / n) * 100 : 0,
    failedTrialistRate: n > 0 ? (failedTrialists / n) * 100 : 0,
    limitedAccessRate: n > 0 ? (limitedAccess / n) * 100 : 0,
    // Trial → Customer conversion (Data Guide): of those who started a trial,
    // what % became a real paid customer? `customers` here counts everyone who
    // ever converted (incl. since-churned) and excludes failed trialists and
    // ≤2-day quick cancels — so churn doesn't deflate the conversion rate.
    trialToCustomerRate: trials > 0 ? (customers / trials) * 100 : 0,
  };
}

// ---- Campaign breakdown (PAID ONLY) ----

function computeCampaigns(contacts: HubSpotContact[]): CampaignRow[] {
  const paidContacts = contacts.filter(isPaid);
  const groups: Record<string, HubSpotContact[]> = {};
  for (const c of paidContacts) {
    const campaign = c.first_touch_utm_campaign?.trim();
    if (!campaign) continue;
    if (!groups[campaign]) groups[campaign] = [];
    groups[campaign].push(c);
  }

  return Object.entries(groups)
    .map(([campaign, cs]) => {
      const signups = cs.length;
      const trials = cs.filter(everTrialed).length;
      const inTrial = cs.filter(isInTrial).length;
      // Conversion count: ever became a real paid customer (incl. since-churned).
      const customers = cs.filter(everBecameRealCustomer).length;
      const source = cs[0]?.first_touch_utm_source?.toLowerCase() || "unknown";
      return {
        campaign: campaign.length > 65 ? campaign.slice(0, 62) + "..." : campaign,
        source, signups, trials, inTrial, customers,
        signupToTrial: signups > 0 ? (trials / signups) * 100 : 0,
        trialToCustomer: trials > 0 ? (customers / trials) * 100 : null,
      };
    })
    .sort((a, b) => b.signups - a.signups);
}

// ---- Geo (US, Canada, Mexico) ----

function normalizeCountryDisplay(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (["united states", "us", "usa", "u.s.", "u.s.a."].includes(lower)) return "United States";
  if (["canada", "ca"].includes(lower)) return "Canada";
  if (["mexico", "mx", "méxico"].includes(lower)) return "Mexico";
  return null;
}

function computeGeo(contacts: HubSpotContact[]): GeoRow[] {
  const countryGroups: Record<string, HubSpotContact[]> = {};
  for (const c of contacts) {
    const raw = c.country || c.ip_country || "";
    if (!raw.trim()) continue;
    const normalized = normalizeCountryDisplay(raw);
    if (!normalized) continue;
    if (!countryGroups[normalized]) countryGroups[normalized] = [];
    countryGroups[normalized].push(c);
  }

  return Object.entries(countryGroups)
    .map(([country, cs]) => {
      const signups = cs.length;
      const authorized = cs.filter(isAuth).length;
      const props = cs.filter(createdProps).length;
      const launch = cs.filter(clickedLaunch).length;
      const trials = cs.filter(everTrialed).length;
      const inTrial = cs.filter(isInTrial).length;
      const customers = cs.filter(everBecameRealCustomer).length;

      const cityGroups: Record<string, HubSpotContact[]> = {};
      for (const c2 of cs) {
        const city = (c2.city || c2.ip_city || "").trim() || "(unknown)";
        if (!cityGroups[city]) cityGroups[city] = [];
        cityGroups[city].push(c2);
      }
      const cities = Object.entries(cityGroups)
        .filter(([city]) => city !== "(unknown)")
        .map(([city, cityCs]) => ({
          city, signups: cityCs.length,
          trials: cityCs.filter(everTrialed).length,
          inTrial: cityCs.filter(isInTrial).length,
          customers: cityCs.filter(everBecameRealCustomer).length,
        }))
        .sort((a, b) => b.signups - a.signups).slice(0, 20);

      return {
        country, signups, authorized, createdProperties: props, clickedLaunch: launch,
        trials, inTrial, customers, signupToTrial: signups > 0 ? (trials / signups) * 100 : 0, cities,
      };
    })
    .sort((a, b) => b.signups - a.signups);
}

// ---- Reps (Joe, Jeremiah, Chris) — period-based ----

const INCLUDED_REPS = ["Joe Cuenca", "Jeremiah Cureg", "Chris Martinez"];

function computeReps(
  allContacts: HubSpotContact[],
  ownerNames: Record<string, string>,
  start: Date,
  end: Date
): RepRow[] {
  // Group ALL contacts by rep (not just signup-filtered)
  const groups: Record<string, HubSpotContact[]> = {};
  for (const c of allContacts) {
    const ownerId = c.hubspot_owner_id;
    const name = ownerId ? ownerNames[ownerId] || `Owner ${ownerId}` : "(unassigned)";
    if (!INCLUDED_REPS.includes(name)) continue;
    if (!groups[name]) groups[name] = [];
    groups[name].push(c);
  }

  return Object.entries(groups)
    .map(([rep, cs]) => {
      // Contacts assigned to this rep (total book)
      const contactCount = cs.length;

      // Trials = entered trial stage during this period
      const trials = cs.filter((c) => {
        const td = getTrialEnteredDate(c);
        return td && td >= start && td <= end;
      }).length;

      // Customers = entered customer stage during this period AND became a real
      // paid customer (incl. since-churned; excludes <2-day quick cancels).
      const customers = cs.filter((c) => {
        const cd = getCustomerEnteredDate(c);
        return cd && cd >= start && cd <= end && everBecameRealCustomer(c);
      }).length;

      // In Trial = entered trial during period AND currently still in trial
      const inTrial = cs.filter((c) => {
        const td = getTrialEnteredDate(c);
        return td && td >= start && td <= end && isInTrial(c);
      }).length;

      return {
        rep,
        contacts: contactCount,
        trials,
        inTrial,
        customers,
        signupToTrial: contactCount > 0 ? (trials / contactCount) * 100 : 0,
        trialToCustomer: trials > 0 ? (customers / trials) * 100 : null,
        contactToCustomer: contactCount > 0 ? (customers / contactCount) * 100 : 0,
      };
    })
    .sort((a, b) => b.trials - a.trials);
}

// ---- Trial Outcomes: where did people who entered trial end up? ----
// Input = qualifiedSignups (people who signed up in the period, excl DQ)
// Output = breakdown of the trial cohort by current lifecycle.

function computeTrialOutcomes(qualifiedSignups: HubSpotContact[]) {
  const trialists = qualifiedSignups.filter(everTrialed);
  const inTrial = trialists.filter(isInTrial).length;
  // Customer = paid customer, excluding quick cancels (<2 day rule).
  const customer = trialists.filter(
    (c) => c.account_lifecycle === "customer" && !isQuickCancel(c)
  ).length;
  // Limited Access = still a Customer per Data Guide, shown separately for detail.
  const limitedAccess = trialists.filter(isLimitedAccess).length;
  // Churned = real churn (was customer >=2 days, now cancelled).
  const churned = trialists.filter(isRealChurn).length;
  // Failed Trialist = cancelled before becoming real customer (incl. quick cancels).
  const failedTrialist = trialists.filter(isFailedTrialist).length;
  const reverted =
    trialists.length - inTrial - customer - limitedAccess - churned - failedTrialist;
  return {
    total: trialists.length,
    inTrial,
    customer,
    limitedAccess,
    churned,
    failedTrialist,
    reverted: Math.max(0, reverted),
  };
}

// ---- DQ Weekly ----

const TOP_DQ_REASONS = ["UNSUPPORTED_COUNTRY", "INCOMPLETE_ADDRESS", "NO_PUBLISHED_LISTINGS_FOUND", "UNPUBLISHED_LISTING"];

function computeDQWeekly(contacts: HubSpotContact[]): DQWeekly[] {
  const dqContacts = contacts.filter(hasDQ);
  const weekMap: Record<string, { data: DQWeekly; sortKey: string }> = {};

  for (const c of dqContacts) {
    const d = new Date(c.createdate);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
    const weekKey = `${fmt(monday)}-${fmt(sunday)}`;
    // Sort key: YYYY-MM-DD of Monday for correct chronological sort
    const sortKey = monday.toISOString().slice(0, 10);

    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        sortKey,
        data: {
          week: weekKey, UNSUPPORTED_COUNTRY: 0, INCOMPLETE_ADDRESS: 0,
          NO_PUBLISHED_LISTINGS_FOUND: 0, UNPUBLISHED_LISTING: 0, OTHER: 0,
        },
      };
    }
    const reasons = (c.airbnbdqreason || "").trim().toUpperCase().split(";").map((r) => r.trim());
    for (const r of reasons) {
      if (TOP_DQ_REASONS.includes(r)) {
        weekMap[weekKey].data[r as keyof Omit<DQWeekly, "week">] += 1;
      } else if (r) {
        weekMap[weekKey].data.OTHER += 1;
      }
    }
  }
  return Object.values(weekMap)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((v) => v.data);
}

// ---- Per-campaign funnel scoping ----
//
// Returns the same FunnelStage[] shape as the main dashboard funnel,
// but scoped to contacts attributed to a single Meta campaign. Used by
// the FunnelCard's campaign-filter dropdown — lets the user see how
// each campaign's signups progress through the funnel independently.
//
// Bucketing reuses bucketContactToCampaign() from lib/campaigns.ts so
// the attribution logic (UTM ∪ source_data_2 ∪ URL fallback, with
// pre-launch exclusion) matches Campaign Analysis exactly.

export function computeFunnelByCampaign(
  contacts: HubSpotContact[],
  period: PeriodFilter,
  campaign: string | null,  // null = all campaigns (no filter)
  countries: string[],
  channels: string[],
  customStart?: string,
  customEnd?: string,
  // Optional list of currently-active Meta campaign names. When the
  // submitted `campaign` matches one of these, we use the per-Meta
  // attribution chain (ref_source / utm / src2) — same logic as
  // Campaign Analysis — so e.g. a Syerena filter excludes 05.03's
  // contacts that share the bucket. Falls back to bucket attribution
  // for legacy bucket-key params.
  activeMetaCampaigns: string[] = [],
  // Live Google Ads ad-group roster — used to resolve a submitted
  // Google ad-unit LABEL back to a contact-attribution decision. Each
  // entry represents an ad group (or, for Pmax / asset-group campaigns
  // that don't use ad groups, the campaign rollup). Pass an empty
  // array if the Google API isn't connected — the dropdown's Google
  // entries silently become inert in that case.
  activeGoogleAdGroups: GoogleAdsAdGroup[] = [],
): FunnelStage[] {
  const clean = excludeArtifactContacts(contacts);
  const { start, end } = resolvedDateRange(period, customStart, customEnd);

  // Same upstream filters as the main dashboard pipeline so the totals
  // line up for "All campaigns" mode.
  let signupFiltered = filterBySignupDate(clean, start, end);
  signupFiltered = signupFiltered.filter(isSignup);
  signupFiltered = filterByCountries(signupFiltered, countries);
  signupFiltered = filterByChannels(signupFiltered, channels);

  // Campaign filter — only applied if a campaign was specified.
  if (campaign) {
    // Seven attribution paths, checked in priority order:
    //   1. @all-meta        → contacts matched by ANY active Meta campaign
    //   2. @all-google      → contacts whose utm_source = google
    //   3. @google-pmax     → contacts attributed to any Google campaign
    //                         whose NAME matches the Pmax regex
    //   4. @google-brand    → same, for Brand campaigns
    //   5. Exact Google campaign name → utm_source + utm_campaign-ID lookup
    //   6. Exact Meta campaign name   → per-Meta matcher
    //   7. Legacy bucket key          → bucketContactToCampaign substring
    if (campaign === ALL_META_SENTINEL) {
      signupFiltered = signupFiltered.filter((c) =>
        isMetaAttributedContact(c, activeMetaCampaigns),
      );
    } else if (campaign === ALL_GOOGLE_SENTINEL) {
      signupFiltered = signupFiltered.filter(isGoogleSourcedContact);
    } else if (campaign === GOOGLE_PMAX_SENTINEL || campaign === GOOGLE_BRAND_SENTINEL) {
      // Filter Google ad units by campaign-name regex, then match
      // contacts attributed to ANY of those ad units. utm_source must
      // also be "google" (already enforced by matchContactToGoogleAdGroup).
      const re = campaign === GOOGLE_PMAX_SENTINEL ? GOOGLE_PMAX_NAME_REGEX : GOOGLE_BRAND_NAME_REGEX;
      const targetLabels = new Set(
        activeGoogleAdGroups.filter((u) => re.test(u.campaignName)).map((u) => u.label),
      );
      signupFiltered = signupFiltered.filter((c) => {
        const match = matchContactToGoogleAdGroup(c, activeGoogleAdGroups);
        return match !== null && targetLabels.has(match);
      });
    } else if (activeGoogleAdGroups.some((u) => u.label === campaign)) {
      signupFiltered = signupFiltered.filter(
        (c) => matchContactToGoogleAdGroup(c, activeGoogleAdGroups) === campaign,
      );
    } else if (activeMetaCampaigns.includes(campaign)) {
      signupFiltered = signupFiltered.filter(
        (c) => matchContactToMetaCampaign(c, activeMetaCampaigns) === campaign,
      );
    } else {
      signupFiltered = signupFiltered.filter((c) => bucketContactToCampaign(c) === campaign);
    }
  }

  const qualifiedSignups = signupFiltered.filter((c) => !hasDQ(c));
  return computeFunnel(qualifiedSignups, signupFiltered);
}

// ---- Main entry point ----

export function processDashboardData(
  contacts: HubSpotContact[],
  ownerNames: Record<string, string>,
  period: PeriodFilter,
  countries: string[],
  channels: string[],
  customStart?: string,
  customEnd?: string
): DashboardData {
  // Global exclusions first
  const clean = excludeArtifactContacts(contacts);

  // Resolve date range
  const { start, end } = resolvedDateRange(period, customStart, customEnd);

  // Filter by signup date — first by createdate-in-window, then by
  // account_lifecycle ≥ signup. The lifecycle check is the critical fix:
  // it excludes marketing leads, partner imports, and ghost contacts
  // that HubSpot created without the user actually completing the
  // Futurestay signup form. Without this filter, the Signup count is
  // ~38% inflated by non-signup contacts.
  let signupFiltered = filterBySignupDate(clean, start, end);
  signupFiltered = signupFiltered.filter(isSignup);
  signupFiltered = filterByCountries(signupFiltered, countries);
  signupFiltered = filterByChannels(signupFiltered, channels);

  // Qualified signups = signups without an Airbnb DQ reason.
  // (Disqualified-lifecycle contacts have airbnbdqreason set, so they
  // automatically drop out here.)
  const qualifiedSignups = signupFiltered.filter((c) => !hasDQ(c));

  // All clean contacts (for period-based trial/customer counts)
  let allFiltered = filterByCountries(clean, countries);
  allFiltered = filterByChannels(allFiltered, channels);

  return {
    funnel: computeFunnel(qualifiedSignups, signupFiltered),
    campaigns: computeCampaigns(qualifiedSignups),
    geo: computeGeo(qualifiedSignups),
    reps: computeReps(allFiltered, ownerNames, start, end),
    kpis: computeKPIs(allFiltered, signupFiltered, qualifiedSignups, start, end),
    dqWeekly: computeDQWeekly(signupFiltered),
    cohort: computeCohort(qualifiedSignups),
    trialOutcomes: computeTrialOutcomes(qualifiedSignups),
    period,
    totalContacts: qualifiedSignups.length,
  };
}

// ---- All-time daily timeseries (for the headline line chart) ----
//
// Buckets every contact into the day of the relevant event (createdate
// for activation milestones; trial / customer entry dates for the
// downstream lifecycle stages) and produces parallel arrays the chart
// can render directly.
//
// Bucketing rules per metric:
//   - signups:        createdate (Airbnb DQ excluded)
//   - airbnbConnects: createdate (HubSpot doesn't expose an auth-event
//                     timestamp; same-day proxy is correct for ≥95% of
//                     users since auth happens immediately after signup)
//   - readyToLaunch:  createdate (no event-date field exists)
//   - trials:         hs_v2_date_entered_opportunity, with trial__start_date
//                     as fallback (canonical priority, matches the KPI
//                     tile's definition — no lifecycle gate)
//   - customers:      hs_v2_date_entered_customer (real customer start)
//
// The trials/customers buckets therefore reflect WHEN those people
// became trials/customers, not when they signed up — which is what a
// time-series chart should show.
export interface TimeSeries {
  days: string[];
  signups: number[];
  airbnbConnects: number[];
  readyToLaunch: number[];
  trials: number[];
  customers: number[];
}

export function computeTimeSeries(contacts: HubSpotContact[]): TimeSeries {
  const clean = excludeArtifactContacts(contacts);

  // Find earliest event date across any metric — that's where the
  // x-axis should start. All bucketing is in Eastern Time so a contact
  // who signed up at 11pm ET appears on the same calendar day as one
  // who signed up at 9am ET, not the next UTC day.
  let minTs = Infinity;
  let maxTs = -Infinity;
  const todayTs = tzStartOfDay(new Date()).getTime();

  function consider(d: string | null) {
    if (!d) return;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return;
    const t = dt.getTime();
    if (t < minTs) minTs = t;
    if (t > maxTs) maxTs = t;
  }

  for (const c of clean) {
    if (isSignup(c) && !hasDQ(c)) consider(c.createdate);
    // Trials: match KPI semantics exactly — canonical date first
    // (hs_v2_date_entered_opportunity), trial__start_date as fallback.
    // No lifecycle gate: KPI's totalTrials counts any contact whose
    // trial-entry date is in the window, regardless of current
    // lifecycle. The Run Rate has to match or the chart and the KPI
    // tile disagree on the same week.
    consider(c.hs_v2_date_entered_opportunity || c.trial__start_date);
    // Conversions are keyed by customer-entry date and count anyone who ever
    // became a real paid customer — including those who later churned (see
    // everBecameRealCustomer). Gating on current lifecycle (isCustomer) here
    // would silently drop every churned customer from their entry date.
    if (everBecameRealCustomer(c)) consider(c.hs_v2_date_entered_customer);
  }

  if (!isFinite(minTs)) {
    return { days: [], signups: [], airbnbConnects: [], readyToLaunch: [], trials: [], customers: [] };
  }

  // Snap min to ET start-of-day; chart always extends to today (ET).
  //
  // We enumerate days using YYYY-MM-DD string arithmetic instead of
  // stepping Date objects through tzAddDays(). Why: tzAddDays calls
  // Intl.DateTimeFormat under the hood, and at ~520 iterations that
  // adds up to multi-second cost on Vercel serverless (it was hitting
  // the 300s function timeout). Simple calendar increment on the date
  // string is DST-safe — we're just enumerating calendar days, not
  // crossing time boundaries — and dramatically faster.
  //
  // Floor the x-axis at RUN_RATE_START. The account has signups going
  // back to January, but the chart is pinned to start March 1, 2026
  // (the meaningful start of the current paid-growth era). Events
  // before this date are dropped — they won't get a slot in dayIndex,
  // so bucketIndex returns -1 and they're skipped. Lexicographic max
  // works because both are YYYY-MM-DD.
  const RUN_RATE_START = "2026-03-01";
  const earliestKey = tzDateKey(new Date(minTs));
  const startKey = earliestKey > RUN_RATE_START ? earliestKey : RUN_RATE_START;
  const endKey = tzDateKey(new Date(todayTs));

  const days: string[] = [];
  const dayIndex = new Map<string, number>();
  let key = startKey;
  // Safety cap: even a 5-year window is < 2000 days. Prevents an
  // infinite loop if some edge case ever made nextDay() not advance.
  let safety = 4000;
  while (key <= endKey && safety-- > 0) {
    dayIndex.set(key, days.length);
    days.push(key);
    if (key === endKey) break;
    // Increment calendar date via UTC math (no DST issues for pure
    // calendar increment — Date.UTC normalizes month/year rollover).
    const y = parseInt(key.slice(0, 4), 10);
    const m = parseInt(key.slice(5, 7), 10);
    const d = parseInt(key.slice(8, 10), 10);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(next.getUTCDate()).padStart(2, "0");
    key = `${yy}-${mm}-${dd}`;
  }
  const dayCount = days.length;
  const signups: number[] = new Array(dayCount).fill(0);
  const airbnbConnects: number[] = new Array(dayCount).fill(0);
  const readyToLaunch: number[] = new Array(dayCount).fill(0);
  const trials: number[] = new Array(dayCount).fill(0);
  const customers: number[] = new Array(dayCount).fill(0);

  function bucketIndex(d: string | null): number {
    if (!d) return -1;
    const t = new Date(d);
    if (isNaN(t.getTime())) return -1;
    // Find the event's ET calendar day → look up its array index.
    const key = tzDateKey(t);
    const idx = dayIndex.get(key);
    return idx === undefined ? -1 : idx;
  }

  for (const c of clean) {
    // Qualified signups: must have reached signup lifecycle AND no DQ.
    // Without the lifecycle check this counts marketing leads / ghost
    // contacts as signups, inflating the daily count.
    if (isSignup(c) && !hasDQ(c)) {
      const i = bucketIndex(c.createdate);
      if (i >= 0) signups[i]++;
    }
    // Airbnb connects
    if (isAuth(c)) {
      const i = bucketIndex(c.createdate);
      if (i >= 0) airbnbConnects[i]++;
    }
    // Ready to launch
    if (isReadyToLaunch(c)) {
      const i = bucketIndex(c.createdate);
      if (i >= 0) readyToLaunch[i]++;
    }
    // Trials — by canonical trial-entry date (hs_v2_date_entered_opportunity,
    // trial__start_date as fallback). Matches computeKPIs() exactly so
    // the chart's weekly bucket equals the KPI tile for the same window;
    // previously the priority was reversed AND gated on everTrialed(),
    // which dropped contacts whose date field is set but whose current
    // lifecycle isn't in TRIAL_LIFECYCLES — diverged from KPI by 5+/wk.
    const trialDate = c.hs_v2_date_entered_opportunity || c.trial__start_date;
    if (trialDate) {
      const i = bucketIndex(trialDate);
      if (i >= 0) trials[i]++;
    }
    // Customers — by actual customer entry date. Counts everyone who ever
    // became a real paid customer (incl. since-churned), not just those
    // currently in the customer lifecycle.
    if (everBecameRealCustomer(c)) {
      const i = bucketIndex(c.hs_v2_date_entered_customer);
      if (i >= 0) customers[i]++;
    }
  }

  return { days, signups, airbnbConnects, readyToLaunch, trials, customers };
}
