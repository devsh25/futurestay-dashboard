export interface HubSpotContact {
  id: string;
  createdate: string;
  account_lifecycle: string | null;
  airbnb_authorization_status: string | null;
  airbnbdqreason: string | null;
  user_properties_created: string | null;
  user_clicked_launch_property: string | null;
  property_ready_to_launch: string | null;  // "true" / "false" / null
  trial__start_date: string | null;
  cb_subcst_trial_end: string | null; // Chargebee trial end — authoritative
  subscription_status: string | null;
  subscription_type: string | null;
  plan_name: string | null;                    // canonical enum {Amplify, Flex} — sparse
  plan_type_legacy: string | null;             // from don_t_use____plan_type — most complete
  plan_type_old: string | null;                // from don_t_use_____old_plan_type
  limited_access_previous_plan: string | null; // e.g., "Futurestay-Amplify-USD-Yearly"
  first_touch_utm_campaign: string | null;
  first_touch_utm_source: string | null;
  first_touch_utm_medium: string | null;
  first_touch_utm_term: string | null;
  hs_analytics_first_url: string | null;
  hs_analytics_source_data_2: string | null;
  engagements_last_meeting_booked: string | null;
  sales_call_outcome: string | null;
  aircall_last_call_at: string | null;
  last_aircall_call_outcome: string | null;
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
  totalReadyToLaunch: number;     // contacts with property_ready_to_launch=true
  totalCustomers: number;         // Real conversions (excludes <2-day quick cancels)
  totalFormerCustomers: number;   // Raw former.customer count (= churned + failed)
  totalChurned: number;           // Real churns (Data Guide: was customer ≥2 days, now cancelled)
  totalFailedTrialists: number;   // Trialists who cancelled before real conversion
  totalLimitedAccess: number;     // Still counted as Customer per Data Guide
  trialRate: number;         // Qualified Signup → Trial
  customerRate: number;      // Qualified Signup → Customer
  trialToPayRate: number;
  churnRate: number;         // Churned / (Active Customers + Churned) — excludes failed trialists
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
  customer: number;         // became real paid customer (excl. quick cancels)
  limitedAccess: number;    // Customer/Limited Access (counts as Customer per Guide)
  churned: number;          // real churn: was customer ≥2 days, now cancelled
  failedTrialist: number;   // cancelled trial before real conversion (or <2-day cancel)
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
  readyToLaunch: number;       // Property marked ready to launch
  trials: number;
  inTrial: number;
  customers: number;           // Customer + Limited Access (per Data Guide)
  formerCustomers: number;     // Raw: churned + failed trialists (compat)
  churned: number;             // Real churns only
  failedTrialists: number;     // Trialists who cancelled before real conversion
  limitedAccess: number;
  authRate: number;
  propsRate: number;
  launchRate: number;
  readyToLaunchRate: number;
  trialRate: number;
  inTrialRate: number;
  customerRate: number;
  formerCustomerRate: number;
  churnedRate: number;         // % of qualified signups who became a real churn
  failedTrialistRate: number;  // % of qualified signups who failed trial
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

// ---- Campaign Analysis (the 6-campaign Meta + HubSpot join) ----

export interface CampaignAnalysisRow {
  campaign: string;
  type: "call" | "self";
  spend: number;
  optSignal: string;          // "meetings" | "signups" | "airbnb_connected"

  leads: number;              // form submissions on landing page
  meetingsBooked: number | null;  // call only
  signups: number;            // lifecycle reached "signup" or beyond
  qualifiedSignups: number;   // signups - airbnb DQ
  airbnbConnected: number;    // auth status COMPLETED/REVOKED
  readyToLaunch: number;      // property_ready_to_launch = "true"

  airbnbDqRate: number;       // %
  formToMeetingRate: number | null; // % (call only)

  costPerMeeting: number | null;  // call only
  // Outcome classification (call only) — derived from sales_call_outcome,
  // notes keyword matching, and Aircall after-meeting no-answer signals
  noShowMtgRate: number | null;       // % of meetings that were no-shows
  dqMtgRate: number | null;           // % of meetings disqualified
  interestedMtgRate: number | null;   // % of meetings tagged interested
  notInterestedMtgRate: number | null;
  outcomeCoverage: number | null;     // % of meetings with any classification
  trials: number;
  costPerTrial: number | null;
  customers: number;
  costPerCustomer: number | null;
  qsToTrialRate: number | null;     // Qualified Signups → Trial %
  qsToCustomerRate: number | null;  // Qualified Signups → Customer %
}

export interface CampaignAnalysisData {
  rows: CampaignAnalysisRow[];
  since: string;  // YYYY-MM-DD
  until: string;  // YYYY-MM-DD
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
  | "lastWeek"
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
