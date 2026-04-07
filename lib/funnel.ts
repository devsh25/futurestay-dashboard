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

function resolvedDateRange(
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

// ---- Date-based trial/customer detection (using HubSpot lifecycle dates) ----

function getTrialEnteredDate(c: HubSpotContact): Date | null {
  // Primary: hs_v2_date_entered_opportunity (definitive)
  // Fallback: trial__start_date
  const raw = c.hs_v2_date_entered_opportunity || c.trial__start_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function getCustomerEnteredDate(c: HubSpotContact): Date | null {
  // Primary: hs_v2_date_entered_customer (definitive)
  // Fallback: trial entered date + 14 days (estimation)
  if (c.hs_v2_date_entered_customer) {
    const d = new Date(c.hs_v2_date_entered_customer);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback for contacts without the lifecycle date
  const trialDate = getTrialEnteredDate(c);
  if (trialDate && EVER_PAID_LIFECYCLES.includes(c.account_lifecycle || "")) {
    const est = new Date(trialDate);
    est.setDate(est.getDate() + 14);
    return est;
  }
  return null;
}

// ---- Compute funnel (signup-cohort based for progression metrics) ----

function computeFunnel(contacts: HubSpotContact[]): FunnelStage[] {
  const total = contacts.length;
  const dqCount = contacts.filter(hasDQ).length;
  const authCount = contacts.filter(isAuth).length;
  const propsCount = contacts.filter(createdProps).length;
  const launchCount = contacts.filter(clickedLaunch).length;
  const trialCount = contacts.filter(everTrialed).length;
  const customerCount = contacts.filter(isCustomer).length;

  const mainStages: [string, number][] = [
    ["Signed Up", total],
    ["Authorized Airbnb", authCount],
    ["Created Properties", propsCount],
    ["Clicked Launch", launchCount],
    ["Trial Started", trialCount],
    ["Customer", customerCount],
  ];

  const funnel: FunnelStage[] = [];
  funnel.push({
    name: "AirbnbDQ", count: dqCount, lost: null,
    dropoff: total > 0 ? (dqCount / total) * 100 : null, stepConv: null,
  });

  for (let i = 0; i < mainStages.length; i++) {
    const [name, count] = mainStages[i];
    if (i === 0) {
      funnel.push({ name, count, lost: null, dropoff: null, stepConv: null });
    } else {
      const prev = mainStages[i - 1][1];
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
  start: Date,
  end: Date
): KPIs {
  // Signups = created during this period
  const totalSignups = signupFiltered.length;

  // Trials = entered trial during this period (hs_v2_date_entered_opportunity or fallback)
  const totalTrials = allContacts.filter((c) => {
    const td = getTrialEnteredDate(c);
    return td && td >= start && td <= end;
  }).length;

  // Customers = entered customer during this period (hs_v2_date_entered_customer or fallback)
  const totalCustomers = allContacts.filter((c) => {
    const cd = getCustomerEnteredDate(c);
    return cd && cd >= start && cd <= end;
  }).length;

  const dqCount = signupFiltered.filter(hasDQ).length;

  return {
    totalSignups,
    totalTrials,
    totalCustomers,
    trialRate: totalSignups > 0 ? (totalTrials / totalSignups) * 100 : 0,
    customerRate: totalSignups > 0 ? (totalCustomers / totalSignups) * 100 : 0,
    trialToPayRate: totalTrials > 0 ? (totalCustomers / totalTrials) * 100 : 0,
    dqRate: totalSignups > 0 ? (dqCount / totalSignups) * 100 : 0,
  };
}

// ---- Cohort analysis (signup-date based) ----

function computeCohort(contacts: HubSpotContact[]): CohortData {
  const n = contacts.length;
  const auth = contacts.filter(isAuth).length;
  const props = contacts.filter(createdProps).length;
  const launch = contacts.filter(clickedLaunch).length;
  const trials = contacts.filter(everTrialed).length;
  const customers = contacts.filter(isCustomer).length;

  return {
    signups: n,
    authorized: auth,
    createdProperties: props,
    clickedLaunch: launch,
    trials,
    customers,
    authRate: n > 0 ? (auth / n) * 100 : 0,
    propsRate: n > 0 ? (props / n) * 100 : 0,
    launchRate: n > 0 ? (launch / n) * 100 : 0,
    trialRate: n > 0 ? (trials / n) * 100 : 0,
    customerRate: n > 0 ? (customers / n) * 100 : 0,
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
      const customers = cs.filter(isCustomer).length;
      const source = cs[0]?.first_touch_utm_source?.toLowerCase() || "unknown";
      return {
        campaign: campaign.length > 65 ? campaign.slice(0, 62) + "..." : campaign,
        source, signups, trials, customers,
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
          customers: cityCs.filter(isCustomer).length,
        }))
        .sort((a, b) => b.signups - a.signups).slice(0, 20);

      return {
        country, signups, authorized, createdProperties: props, clickedLaunch: launch,
        trials, customers, signupToTrial: signups > 0 ? (trials / signups) * 100 : 0, cities,
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

      return {
        rep,
        contacts: contactCount,
        trials,
        customers,
        signupToTrial: contactCount > 0 ? (trials / contactCount) * 100 : 0,
        trialToCustomer: trials > 0 ? (customers / trials) * 100 : null,
        contactToCustomer: contactCount > 0 ? (customers / contactCount) * 100 : 0,
      };
    })
    .sort((a, b) => b.trials - a.trials);
}

// ---- DQ Weekly ----

const TOP_DQ_REASONS = ["UNSUPPORTED_COUNTRY", "INCOMPLETE_ADDRESS", "NO_PUBLISHED_LISTINGS_FOUND", "UNPUBLISHED_LISTING"];

function computeDQWeekly(contacts: HubSpotContact[]): DQWeekly[] {
  const dqContacts = contacts.filter(hasDQ);
  const weekMap: Record<string, DQWeekly> = {};

  for (const c of dqContacts) {
    const d = new Date(c.createdate);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
    const weekKey = `${fmt(monday)}-${fmt(sunday)}`;

    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        week: weekKey, UNSUPPORTED_COUNTRY: 0, INCOMPLETE_ADDRESS: 0,
        NO_PUBLISHED_LISTINGS_FOUND: 0, UNPUBLISHED_LISTING: 0, OTHER: 0,
      };
    }
    const reasons = (c.airbnbdqreason || "").trim().toUpperCase().split(";").map((r) => r.trim());
    for (const r of reasons) {
      if (TOP_DQ_REASONS.includes(r)) {
        weekMap[weekKey][r as keyof Omit<DQWeekly, "week">] += 1;
      } else if (r) {
        weekMap[weekKey].OTHER += 1;
      }
    }
  }
  return Object.values(weekMap).sort((a, b) => a.week.localeCompare(b.week, undefined, { numeric: true }));
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

  // All clean contacts (for period-based trial/customer counts)
  let allFiltered = filterByCountries(clean, countries);
  allFiltered = filterByChannels(allFiltered, channels);

  return {
    funnel: computeFunnel(signupFiltered),
    campaigns: computeCampaigns(signupFiltered),
    geo: computeGeo(signupFiltered),
    reps: computeReps(allFiltered, ownerNames, start, end),
    kpis: computeKPIs(allFiltered, signupFiltered, start, end),
    dqWeekly: computeDQWeekly(signupFiltered),
    cohort: computeCohort(signupFiltered),
    period,
    totalContacts: signupFiltered.length,
  };
}
