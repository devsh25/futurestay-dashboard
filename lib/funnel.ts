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

// ---- Date helpers ----

function getDateRange(period: PeriodFilter): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case "last7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "last30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "thisWeek": {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end };
    }
    case "thisQuarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qMonth, 1);
      return { start, end };
    }
    case "allTime":
    default:
      return { start: new Date(2026, 0, 1), end };
  }
}

export function resolvedDateRange(
  period: PeriodFilter,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  if (period === "custom" && customStart && customEnd) {
    const end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
    return { start: new Date(customStart), end };
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

function excludePartnerSources(contacts: HubSpotContact[]): HubSpotContact[] {
  return contacts.filter((c) => {
    const src = (c.referral_source || "").trim().toUpperCase();
    return !EXCLUDED_REFERRAL_SOURCES.includes(src);
  });
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

const TRIAL_LIFECYCLES = ["Trialist", "customer", "former.customer", "Customer/Limited Access"];
const CUSTOMER_LIFECYCLES = ["customer", "Customer/Limited Access"];
const EVER_PAID_LIFECYCLES = ["customer", "former.customer", "Customer/Limited Access"];

function everTrialed(c: HubSpotContact): boolean {
  return TRIAL_LIFECYCLES.includes(c.account_lifecycle || "");
}

function isCustomer(c: HubSpotContact): boolean {
  return CUSTOMER_LIFECYCLES.includes(c.account_lifecycle || "");
}

// Currently in trial = account_lifecycle === "Trialist"
// This is HubSpot's definitive signal. We don't infer from dates
// because it creates phantom in-trial contacts.
function isInTrial(c: HubSpotContact): boolean {
  return c.account_lifecycle === "Trialist";
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

// Real Churn (Data Guide): was a real Customer, now cancelled.
// Excludes failed trialists and quick cancels.
function isRealChurn(c: HubSpotContact): boolean {
  return isFormerCustomer(c) && everBecameCustomer(c) && !isQuickCancel(c);
}

// Failed Trialist (Data Guide): Trialist who cancelled BEFORE becoming a real
// customer. NOT counted as churn. In HubSpot this surfaces as former.customer
// either because (a) they never entered customer stage, or (b) they entered
// and cancelled within 2 days (per product rule).
function isFailedTrialist(c: HubSpotContact): boolean {
  if (!isFormerCustomer(c)) return false;
  if (!everBecameCustomer(c)) return true;
  return isQuickCancel(c);
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
  const trialCount = qualified.filter(everTrialed).length;
  const inTrialCount = qualified.filter(isInTrial).length;
  const customerCount = qualified.filter(isCustomer).length;
  // Funnel "Churned" = real churns only (per Data Guide 3.0).
  // Failed trialists are shown as their own branch off Trial Started.
  const churnedCount = qualified.filter(isRealChurn).length;
  const failedTrialistCount = qualified.filter(isFailedTrialist).length;

  // Note: launchCount removed from funnel display per product request
  void launchCount;
  const mainStages: [string, number][] = [
    ["Qualified Signups", qualifiedTotal],
    ["Authorized Airbnb", authCount],
    ["Created Properties", propsCount],
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

  // Customers = entered customer during this period AND not a quick cancel (<2 days).
  // Per Data Guide + product rule: cancellations within 2 days aren't real conversions.
  const totalCustomers = allContacts.filter((c) => {
    const cd = getCustomerEnteredDate(c);
    if (!cd || cd < start || cd > end) return false;
    return !isQuickCancel(c);
  }).length;

  // In Trial = entered trial during this period AND still currently in trial
  const totalInTrial = allContacts.filter((c) => {
    const td = getTrialEnteredDate(c);
    return td && td >= start && td <= end && isInTrial(c);
  }).length;

  const dqCount = signupFiltered.filter(hasDQ).length;

  // ---- Sparkline (14 daily buckets ending at period end) ----
  const SPARKLINE_DAYS = 14;
  const sparklineEnd = new Date(end);
  const sparklineStart = new Date(end);
  sparklineStart.setDate(sparklineStart.getDate() - (SPARKLINE_DAYS - 1));
  sparklineStart.setHours(0, 0, 0, 0);

  const days: string[] = [];
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
    // Signups (qualified only, matching the headline metric)
    if (!hasDQ(c) && c.createdate) {
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
    // Customers entered
    const cd = getCustomerEnteredDate(c);
    if (cd) {
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

  const prevSignups = countInRange(allContacts, createdateOf, prevStart, prevEnd, (c) => !hasDQ(c));
  const prevTrials = countInRange(allContacts, getTrialEnteredDate, prevStart, prevEnd);
  const prevCustomers = countInRange(allContacts, getCustomerEnteredDate, prevStart, prevEnd);
  const prevInTrial = countInRange(allContacts, getTrialEnteredDate, prevStart, prevEnd, isInTrial);

  const delta = (current: number, previous: number) => ({
    current, previous,
    pct: previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0),
  });

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
    sparkline: {
      signups: signupsDaily,
      trials: trialsDaily,
      customers: customersDaily,
      inTrial: inTrialDaily,
      days,
    },
    deltas: {
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
  const trials = contacts.filter(everTrialed).length;
  const inTrial = contacts.filter(isInTrial).length;
  // Customers = current "customer" OR "Customer/Limited Access" — both count
  // per Data Guide 3.0. isCustomer already matches CUSTOMER_LIFECYCLES.
  const customers = contacts.filter(isCustomer).length;
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
    trialRate: n > 0 ? (trials / n) * 100 : 0,
    inTrialRate: n > 0 ? (inTrial / n) * 100 : 0,
    customerRate: n > 0 ? (customers / n) * 100 : 0,
    formerCustomerRate: n > 0 ? (formerCustomers / n) * 100 : 0,
    churnedRate: n > 0 ? (churned / n) * 100 : 0,
    failedTrialistRate: n > 0 ? (failedTrialists / n) * 100 : 0,
    limitedAccessRate: n > 0 ? (limitedAccess / n) * 100 : 0,
    // Trial → Customer conversion (Data Guide): of those who started a trial,
    // what % became a real customer? Excludes failed trialists and quick cancels
    // naturally because `customers` uses current customer lifecycle.
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
      const customers = cs.filter(isCustomer).length;
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
      const customers = cs.filter(isCustomer).length;

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
          customers: cityCs.filter(isCustomer).length,
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

      // Customers = entered customer stage during this period
      const customers = cs.filter((c) => {
        const cd = getCustomerEnteredDate(c);
        return cd && cd >= start && cd <= end;
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
  const clean = excludePartnerSources(contacts);

  // Resolve date range
  const { start, end } = resolvedDateRange(period, customStart, customEnd);

  // Filter by signup date for most cards
  let signupFiltered = filterBySignupDate(clean, start, end);
  signupFiltered = filterByCountries(signupFiltered, countries);
  signupFiltered = filterByChannels(signupFiltered, channels);

  // Qualified signups = signups without an Airbnb DQ reason.
  // This is what most funnel/cohort/campaign/geo cards operate on.
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
