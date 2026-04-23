export interface HubSpotContact {
  id: string;
  createdate: string;
  account_lifecycle: string | null;
  airbnb_authorization_status: string | null;
  airbnbdqreason: string | null;
  user_properties_created: string | null;
  user_clicked_launch_property: string | null;
  trial__start_date: string | null;
  subscription_status: string | null;
  subscription_type: string | null;
  first_touch_utm_campaign: string | null;
  first_touch_utm_source: string | null;
  first_touch_utm_medium: string | null;
  first_touch_utm_term: string | null;
  hubspot_owner_id: string | null;
  country: string | null;
  city: string | null;
  ip_country: string | null;
  ip_city: string | null;
  referral_source: string | null;
  hs_v2_date_entered_opportunity: string | null; // date entered Trial
  hs_v2_date_exited_opportunity: string | null;  // date exited Trial
  hs_v2_date_entered_customer: string | null;    // date entered Customer
  hs_v2_date_exited_customer: string | null;     // date exited Customer
}

export interface FunnelStage {
  name: string;
  count: number;
  lost: number | null;
  dropoff: number | null;
  stepConv: number | null;
}

export interface CampaignRow {
  campaign: string;
  source: string;
  signups: number;
  trials: number;
  inTrial: number;
  customers: number;
  signupToTrial: number;
  trialToCustomer: number | null;
}

export interface GeoRow {
  country: string;
  signups: number;
  authorized: number;
  createdProperties: number;
  clickedLaunch: number;
  trials: number;
  inTrial: number;
  customers: number;
  signupToTrial: number;
  cities: {
    city: string;
    signups: number;
    trials: number;
    inTrial: number;
    customers: number;
  }[];
}

export interface RepRow {
  rep: string;
  contacts: number;
  trials: number;
  inTrial: number;
  customers: number;
  signupToTrial: number;
  trialToCustomer: number | null;
  contactToCustomer: number;
}

export interface SparklineSeries {
  signups: number[];    // daily counts, oldest → newest
  trials: number[];
  customers: number[];
  inTrial: number[];
  days: string[];       // ISO date labels
}

export interface TrendDelta {
  current: number;      // this period total
  previous: number;     // same-length prior period total
  pct: number;          // % change; positive = up
}

export interface KPIs {
  totalSignups: number;      // Qualified Signups (excludes DQ'd)
  totalRawSignups: number;   // All signups including DQ'd — used only for DQ rate
  totalTrials: number;
  totalInTrial: number;
  totalCustomers: number;
  totalFormerCustomers: number;   // churned paying customers
  totalLimitedAccess: number;     // limited tier paying customers
  trialRate: number;         // Qualified Signup → Trial
  customerRate: number;      // Qualified Signup → Customer
  trialToPayRate: number;
  churnRate: number;         // Former / (Customer + Former + Limited) — % of ever-paid who churned
  dqRate: number;
  sparkline: SparklineSeries;
  deltas: {
    signups: TrendDelta;
    trials: TrendDelta;
    inTrial: TrendDelta;
    customers: TrendDelta;
  };
}

export interface TrialOutcomes {
  total: number;            // total people who entered trial (cohort)
  inTrial: number;          // currently Trialist
  customer: number;         // currently customer
  formerCustomer: number;   // churned
  limitedAccess: number;    // Customer/Limited Access
  reverted: number;         // rare: reverted to signup/other
}

export interface DQWeekly {
  week: string;
  UNSUPPORTED_COUNTRY: number;
  INCOMPLETE_ADDRESS: number;
  NO_PUBLISHED_LISTINGS_FOUND: number;
  UNPUBLISHED_LISTING: number;
  OTHER: number;
}

export interface GA4Channel {
  channel: string;
  users: number;
  newUsers: number;
  returningUsers: number;
  avgEngagement: string;
  sessionsPerUser: number;
}

export interface CohortData {
  signups: number;
  authorized: number;
  createdProperties: number;
  clickedLaunch: number;
  trials: number;
  inTrial: number;
  customers: number;
  formerCustomers: number;
  limitedAccess: number;
  authRate: number;
  propsRate: number;
  launchRate: number;
  trialRate: number;
  inTrialRate: number;
  customerRate: number;
  formerCustomerRate: number;  // % of qualified signups
  limitedAccessRate: number;
  trialToCustomerRate: number;
}

export interface DashboardData {
  funnel: FunnelStage[];
  campaigns: CampaignRow[];
  geo: GeoRow[];
  reps: RepRow[];
  kpis: KPIs;
  dqWeekly: DQWeekly[];
  cohort: CohortData;
  trialOutcomes: TrialOutcomes;
  period: string;
  totalContacts: number;
}

// ---- Meta Ads ----

export interface MetaCampaignRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;   // %, Meta returns this directly
  cpc: number;   // $, Meta returns this directly
  reach: number;
}

export interface MetaDailyPoint {
  date: string;       // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
}

export interface MetaInsightsData {
  since: string;
  until: string;
  summary: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;         // derived %
    cpc: number;         // derived $
    cpm: number;         // derived $ per 1000 impr
    campaignCount: number;
  };
  campaigns: MetaCampaignRow[];
  daily: MetaDailyPoint[];
}

export type PeriodFilter =
  | "last7d"
  | "last30d"
  | "thisWeek"
  | "thisMonth"
  | "thisQuarter"
  | "allTime"
  | "custom";

export const CHANNEL_OPTIONS = [
  "Direct",
  "Paid Social",
  "Organic Social",
  "Paid Search",
  "Organic Search",
  "Email",
  "Display",
] as const;
