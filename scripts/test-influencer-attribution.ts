// Regression test for the influencer ref-source attribution fix in
// lib/campaigns.ts. Exercises matchContactToMetaCampaign against the
// fixtures the bug report called out. Exits non-zero on any failure.
//
// Run: npx tsx scripts/test-influencer-attribution.ts

import { matchContactToMetaCampaign } from "../lib/campaigns";
import type { HubSpotContact } from "../lib/types";

// Baseline HubSpotContact — every property required by the interface,
// most set to null. Individual tests override the fields they care
// about via `...base`.
const base: HubSpotContact = {
  id: "0",
  createdate: "2026-07-01T00:00:00.000Z",
  account_lifecycle: "signup",
  airbnb_authorization_status: null,
  airbnbdqreason: null,
  user_properties_created: null,
  user_clicked_launch_property: null,
  property_ready_to_launch: null,
  trial__start_date: null,
  cb_subcst_trial_end: null,
  subscription_status: null,
  subscription_type: null,
  plan_name: null,
  plan_type_legacy: null,
  plan_type_old: null,
  limited_access_previous_plan: null,
  cb_product: null,
  first_touch_utm_campaign: null,
  first_touch_utm_source: null,
  first_touch_utm_medium: null,
  first_touch_utm_term: null,
  first_touch_utm_content: null,
  hs_analytics_first_url: null,
  hs_analytics_source_data_2: null,
  engagements_last_meeting_booked: null,
  sales_call_outcome: null,
  aircall_last_call_at: null,
  last_aircall_call_outcome: null,
  hubspot_owner_id: null,
  country: null,
  city: null,
  ip_country: null,
  ip_city: null,
  referral_source: null,
  email: null,
  firstname: null,
  lastname: null,
  hs_v2_date_entered_opportunity: null,
  hs_v2_date_exited_opportunity: null,
  hs_v2_date_entered_customer: null,
  hs_v2_date_exited_customer: null,
};

// Active-Meta roster — includes the three influencer campaigns plus
// a couple of sibling ad campaigns to prove the override moves a
// contact off them when ref_source demands it.
const activeMeta = [
  "12.05 | US & CA | Syerena | Direct Website Booking | Video | Campaign",
  "14.07 | US & CA | Kendra | The Key Resource | Video | Campaign",
  "29.05 | US & CA | Charles | Direct Website Booking | Video | Campaign",
  "16.03 | US & CA | Direct Website Booking | Subscribe Event | Static & Video Ads | Campaign",
  "05.03 | US & CA | Direct Website Booking | Static & Video Ads | Campaign",
  "07.07 | US & CA | Airbnb Listing Optimization | Subscribe Event | Static & Video Ads | Campaign",
];

let failed = 0;
function expect(label: string, actual: string | null, expected: RegExp | string | null) {
  const pass = expected === null
    ? actual === null
    : typeof expected === "string"
      ? actual === expected
      : (typeof actual === "string" && expected.test(actual));
  const symbol = pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${symbol} ${label}`);
  if (!pass) {
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
    failed++;
  }
}

console.log("\nKendra fixtures");
// mystayready@yahoo.com — Tier-1 src2 that should have matched but doesn't,
// so we need Tier 0 via referral_source = KENDRA.
expect(
  "src2 with 'whitelisting, kendra' + referral_source=KENDRA -> Kendra campaign",
  matchContactToMetaCampaign({
    ...base,
    email: "mystayready@yahoo.com",
    referral_source: "KENDRA",
    hs_analytics_source_data_2: "14.07 | us & ca | whitelisting, kendra | x the key resource | video | campaign",
  }, activeMeta),
  /\bKendra\b/,
);

// sarahmmessiah@gmail.com — coupon URL, no src2. Tier 0 is the only way.
expect(
  "coupon URL, no src2, referral_source=KENDRA -> Kendra campaign",
  matchContactToMetaCampaign({
    ...base,
    email: "sarahmmessiah@gmail.com",
    referral_source: "KENDRA",
    hs_analytics_first_url: "https://app.futurestay.com/auth/signup?message=kendra&coupon-code=KENDRA20",
  }, activeMeta),
  /\bKendra\b/,
);

// ezeocha63@aol.com — same coupon URL shape.
expect(
  "coupon URL, no src2, no utm_campaign, referral_source=KENDRA -> Kendra campaign",
  matchContactToMetaCampaign({
    ...base,
    email: "ezeocha63@aol.com",
    referral_source: "KENDRA",
    hs_analytics_first_url: "https://app.futurestay.com/auth/signup?coupon-code=KENDRA20",
  }, activeMeta),
  /\bKendra\b/,
);

// Src2 = "3187162" or "GOOGLE" contacts — the noise should be ignored,
// Tier 0 override still wins.
expect(
  "numeric src2 '3187162' + referral_source=KENDRA -> Kendra campaign",
  matchContactToMetaCampaign({
    ...base,
    referral_source: "KENDRA",
    hs_analytics_source_data_2: "3187162",
  }, activeMeta),
  /\bKendra\b/,
);
expect(
  "src2 'GOOGLE' + referral_source=KENDRA -> Kendra campaign",
  matchContactToMetaCampaign({
    ...base,
    referral_source: "KENDRA",
    hs_analytics_source_data_2: "GOOGLE",
  }, activeMeta),
  /\bKendra\b/,
);

console.log("\nCharles fixtures");
// dterrellwash80@gmail.com — clean URL-based attribution to Charles.
expect(
  "URL '/futurestay-x-charles-lamplough' + referral_source=CHARLES -> Charles campaign",
  matchContactToMetaCampaign({
    ...base,
    email: "dterrellwash80@gmail.com",
    referral_source: "CHARLES",
    hs_analytics_first_url: "https://hello.futurestay.com/futurestay-x-charles-lamplough",
  }, activeMeta),
  /\bCharles\b/,
);

// tinaarmonline@yahoo.com — Ambiguous case. Ref = CHARLES but src2 points
// at 16.03 (Subscribe Event). Design decision is OVERRIDE: influencer
// gets credit even when the contact clicked through a sibling ad.
expect(
  "referral_source=CHARLES with src2 pointing at 16.03 -> Charles campaign (override)",
  matchContactToMetaCampaign({
    ...base,
    email: "tinaarmonline@yahoo.com",
    referral_source: "CHARLES",
    hs_analytics_source_data_2: "16.03 | US & CA | Direct Website Booking | Subscribe Event | Static & Video Ads | Campaign",
  }, activeMeta),
  /\bCharles\b/,
);

// allesiaferguson@gmail.com — Same override behaviour with src2 = 05.03.
expect(
  "referral_source=CHARLES with src2 pointing at 05.03 -> Charles campaign (override)",
  matchContactToMetaCampaign({
    ...base,
    email: "allesiaferguson@gmail.com",
    referral_source: "CHARLES",
    hs_analytics_source_data_2: "05.03 | US & CA | Direct Website Booking | Static & Video Ads | Campaign",
  }, activeMeta),
  /\bCharles\b/,
);

console.log("\nSyerena regression (must not change)");
expect(
  "referral_source=SORR still attributes to Syerena",
  matchContactToMetaCampaign({
    ...base,
    referral_source: "SORR",
    hs_analytics_source_data_2: "05.03 | US & CA | Direct Website Booking | ...",
  }, activeMeta),
  /\bSyerena\b/,
);

console.log("\nNegative checks (Tier 0 must not fire without a ref_source)");
// referral_source empty + normal src2 -> normal Tier 1 behaviour.
expect(
  "no referral_source, src2 = 16.03 -> 16.03 campaign, NOT Charles",
  matchContactToMetaCampaign({
    ...base,
    hs_analytics_source_data_2: "16.03 | US & CA | Direct Website Booking | Subscribe Event | Static & Video Ads | Campaign",
  }, activeMeta),
  /\b16\.03\b/,
);

// TATI must NOT be in the hint map (would misattribute "Static" campaigns).
expect(
  "referral_source=TATI is NOT in the hint map (would collide with 'Static')",
  matchContactToMetaCampaign({
    ...base,
    referral_source: "TATI",
    hs_analytics_source_data_2: "05.03 | US & CA | Direct Website Booking | Static & Video Ads | Campaign",
  }, activeMeta),
  // Should fall through to Tier 1 prefix match and land on the 05.03 campaign,
  // NOT on any campaign containing "tati" as a substring.
  "05.03 | US & CA | Direct Website Booking | Static & Video Ads | Campaign",
);

console.log("");
if (failed > 0) {
  console.log(`\x1b[31m${failed} test(s) failed\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32mAll tests passed\x1b[0m");
