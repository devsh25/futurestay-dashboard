// Campaign Analysis — joins Meta spend with HubSpot contacts to give
// per-campaign performance for the 6 known Meta campaigns.

import { HubSpotContact, CampaignAnalysisRow, CampaignAnalysisData } from "./types";
import { fetchMetaInsights } from "./meta";
import { fetchActiveGoogleCampaigns, fetchGoogleAdsInsights } from "./google";

// HubSpot Notes API token reused from env
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const HS_BASE = "https://api.hubapi.com";

// Aircall outcome enum values (from HubSpot enumeration property)
const AIRCALL_NO_ANSWER = new Set([
  "9d9162e7-6cf3-4944-bf63-4dff82258764",  // Busy
  "73a0d17f-1163-4015-bdd5-ec830791da20",  // No answer
  "17b47fee-58de-441e-a44c-c6300d46f273",  // Wrong number
  "b2cf5968-551e-4856-9783-52b3da59a7d0",  // Left voicemail
]);

// Lifecycles that count as "Signup" — has reached or passed the signup
// stage. Note "Disqualfied" is HubSpot's actual stored value (typo'd,
// missing one 'i') — DQ'd contacts ARE signups, they just got rejected
// at the Airbnb-validation step. They're then excluded from Qualified
// Signups via the airbnbdqreason check downstream. Keep both lib/
// funnel.ts and lib/campaigns.ts in sync — they share the same
// definition of Signup across the dashboard.
const SIGNUP_LIFECYCLES = new Set([
  "signup",
  "Trialist",
  "customer",
  "former.customer",
  "Customer/Limited Access",
  "Disqualfied",
]);

const PAID_PLANS = new Set(["amplify", "flex"]);

// 6 Meta campaigns + their type / optimization signal / launch date
export const CAMPAIGN_DEFS: {
  key: string;
  type: "call" | "self";
  optSignal: string;
  launch: string;
}[] = [
  { key: "Airbnb Optimization Call",            type: "call", optSignal: "meetings",          launch: "2026-03-26" },
  { key: "Direct Website Call",                 type: "call", optSignal: "meetings",          launch: "2026-04-20" },
  { key: "DW Booking — Static & Video",         type: "self", optSignal: "signups",           launch: "2026-03-05" },
  { key: "DW Booking — Subscribe Event",        type: "self", optSignal: "airbnb_connected",  launch: "2026-03-16" },
  { key: "Airbnb Listing Opt — Subscribe Event",type: "self", optSignal: "airbnb_connected",  launch: "2026-03-16" },
  { key: "Airbnb Listing Opt — Static & Video", type: "self", optSignal: "signups",           launch: "2026-03-10" },
];

// ---- Bucketing ----

/** Referral-source overrides for Tier 0 attribution. Landing pages for
 *  some campaigns (typically influencer / custom-LP campaigns) set a
 *  distinctive ref code that uniquely identifies the campaign. The
 *  first_touch_utm_campaign can later get overwritten by a sibling
 *  Meta ad click, while ref_source persists — so for these codes we
 *  trust ref_source over UTM.
 *
 *  Add entries as new custom-LP campaigns launch.
 *    key   = referral_source value (uppercase, trimmed)
 *    value = case-insensitive substring that MUST appear in the
 *            Meta campaign's name (so we still respect the active
 *            campaign roster — if the targeted campaign isn't
 *            currently active, the override is a no-op). */
export const REF_SOURCE_TO_CAMPAIGN_HINT: Record<string, string> = {
  SORR: "Syerena",   // Syerena Orr influencer LP
};

/** Attribute a HubSpot contact to a specific Meta campaign (by name).
 *
 *  Tier 0: ref_source override (handles UTM-overwritten contacts where
 *    the LP set a distinctive ref code).
 *  Tier 1a: prefix-match first_touch_utm_campaign against active Meta
 *    campaign names. Allows for HubSpot's ~60-char UTM truncation.
 *  Tier 1b: same prefix-match against hs_analytics_source_data_2 (some
 *    HubSpot integrations only populate src2, not utm_campaign).
 *
 *  Returns the full Meta campaign name, or null if no attribution. */
export function matchContactToMetaCampaign(
  c: HubSpotContact,
  activeCampaignNames: string[],
): string | null {
  // Tier 0 — ref_source override
  const ref = (c.referral_source || "").toUpperCase().trim();
  if (ref && REF_SOURCE_TO_CAMPAIGN_HINT[ref]) {
    const hint = REF_SOURCE_TO_CAMPAIGN_HINT[ref].toLowerCase();
    for (const n of activeCampaignNames) {
      if (n.toLowerCase().includes(hint)) return n;
    }
    // Hint didn't match any active campaign — fall through to UTM.
  }

  // Prefix match a utm-shaped string against the active Meta names.
  // Returns the longest matching Meta name, or null. Requires ≥10
  // chars of overlap to avoid false-positives from generic short
  // tokens like "brand" or "signup".
  function tryPrefix(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let u = raw.trim();
    if (!u || u === "{campaignname}" || u === "{{campaign.name}}") return null;
    if (u.includes("%")) {
      try { u = decodeURIComponent(u); } catch { /* leave as-is */ }
    }
    const uLower = u.toLowerCase();
    let best: string | null = null;
    let bestLen = 0;
    for (const n of activeCampaignNames) {
      const nLower = n.toLowerCase();
      const minLen = Math.min(uLower.length, nLower.length);
      if (minLen < 10) continue;
      if (uLower.slice(0, minLen) === nLower.slice(0, minLen)) {
        // Prefer the longest Meta name on a tie (two campaigns starting
        // with the same prefix — e.g. two 16.03 launches — and one's
        // name is a strict prefix of the other).
        if (n.length > bestLen) { best = n; bestLen = n.length; }
      }
    }
    return best;
  }

  // Tier 1a then 1b.
  return tryPrefix(c.first_touch_utm_campaign) || tryPrefix(c.hs_analytics_source_data_2);
}

/** Attribute a HubSpot contact to a specific Google Ads campaign.
 *
 *  Google's HubSpot UTM convention (post tracking-template fix on
 *  ~May 25): `first_touch_utm_campaign` holds the numeric Google
 *  Ads campaign ID, and `first_touch_utm_source` is literally
 *  "google". We match the numeric ID directly against the live
 *  Google Ads campaign roster and return the campaign's human-
 *  readable name.
 *
 *  Edge cases not handled here:
 *    - utm_campaign = "brand" — manually-labelled Brand campaign;
 *      attributable to "Google (all)" via utm_source but not to a
 *      specific Google campaign (no ID to match against). Falls
 *      through to null and the contact still flows into the
 *      `@all-google` filter.
 *    - utm_campaign = "{campaignname}" — pre-fix placeholder. Also
 *      returns null. Contact still counts in `@all-google`. */
export function matchContactToGoogleCampaign(
  c: HubSpotContact,
  activeGoogleCampaigns: { id: string; name: string }[],
): string | null {
  const src = (c.first_touch_utm_source || "").toLowerCase().trim();
  if (src !== "google") return null;

  // Look at BOTH first_touch_utm_campaign and hs_analytics_source_data_2 —
  // some HubSpot integrations populate only src2, so checking utm_campaign
  // alone (the old behaviour) dropped those contacts entirely.
  const candidates = [c.first_touch_utm_campaign, c.hs_analytics_source_data_2];

  // Tier 1 — numeric campaign-ID match (most reliable; post tracking-
  // template-fix convention).
  for (const raw of candidates) {
    const v = (raw || "").trim();
    if (/^\d{8,}$/.test(v)) {
      const match = activeGoogleCampaigns.find((g) => g.id === v);
      if (match) return match.name;
    }
  }

  // Tier 2 — campaign-NAME match. Recovers pre-template-fix contacts whose
  // utm_campaign / src2 carries the campaign name text rather than the
  // numeric ID. Prefix-match (≥10 chars of overlap, longest name wins) —
  // same shape as the Meta matcher, so generic tokens like "brand" (too
  // short) and the literal "{campaignname}" placeholder are skipped.
  for (const raw of candidates) {
    let v = (raw || "").trim();
    if (!v || v === "{campaignname}" || v === "{campaignid}") continue;
    if (v.includes("%")) {
      try { v = decodeURIComponent(v); } catch { /* leave as-is */ }
    }
    const vNorm = v.toLowerCase().replace(/\s+/g, " ").trim();
    let best: string | null = null;
    let bestLen = 0;
    for (const g of activeGoogleCampaigns) {
      const nNorm = g.name.toLowerCase().replace(/\s+/g, " ").trim();
      const minLen = Math.min(vNorm.length, nNorm.length);
      if (minLen < 10) continue;
      if (vNorm.slice(0, minLen) === nNorm.slice(0, minLen)) {
        if (g.name.length > bestLen) { best = g.name; bestLen = g.name.length; }
      }
    }
    if (best) return best;
  }

  return null;
}

/** Did the contact come from Google Ads at all? Used for the
 *  "Google (all campaigns)" funnel filter, which doesn't require
 *  matching to a specific campaign — just the source field. */
export function isGoogleSourcedContact(c: HubSpotContact): boolean {
  return (c.first_touch_utm_source || "").toLowerCase().trim() === "google";
}

/** Did the contact come from any active Meta campaign? Used for the
 *  "Meta (all campaigns)" filter. Different from matchContactToMetaCampaign
 *  only in that it doesn't care WHICH campaign, just that one matches. */
export function isMetaAttributedContact(
  c: HubSpotContact,
  activeMetaCampaignNames: string[],
): boolean {
  return matchContactToMetaCampaign(c, activeMetaCampaignNames) !== null;
}

/** Map a Meta campaign name to one of the 6 known bucket keys. Returns
 *  null if no UTM substring rule matches (e.g. "Retargeting Ads").
 *
 *  Exported so the funnel API can resolve a user-submitted Meta name
 *  back to the bucket that owns the HubSpot funnel data — without
 *  duplicating the substring rules on the client. */
export function bucketMetaCampaign(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("airbnb optimization call")) return "Airbnb Optimization Call";
  if (n.includes("direct website call")) return "Direct Website Call";
  if (n.includes("direct website booking") && n.includes("subscribe")) return "DW Booking — Subscribe Event";
  if (n.includes("direct website booking")) return "DW Booking — Static & Video";
  if (n.includes("airbnb listing optimization") && n.includes("subscribe")) return "Airbnb Listing Opt — Subscribe Event";
  if (n.includes("airbnb listing optimization")) return "Airbnb Listing Opt — Static & Video";
  return null;
}

export function bucketContactToCampaign(c: HubSpotContact): string | null {
  // Primary: UTM campaign field (or HubSpot's parsed source_data_2)
  const raw = `${c.first_touch_utm_campaign || ""} ${c.hs_analytics_source_data_2 || ""}`.toLowerCase();
  const hasSubscribe = raw.includes("subscribe");
  if (raw.includes("airbnb optimization call")) return "Airbnb Optimization Call";
  if (raw.includes("direct website call")) return "Direct Website Call";
  if (raw.includes("direct website booking") && hasSubscribe) return "DW Booking — Subscribe Event";
  if (raw.includes("direct website booking")) return "DW Booking — Static & Video";
  if (raw.includes("airbnb listing optimization") && hasSubscribe) return "Airbnb Listing Opt — Subscribe Event";
  if (raw.includes("airbnb listing optimization")) return "Airbnb Listing Opt — Static & Video";

  // Fallback: landing-page URL slug + URL utm_campaign param
  const url = (c.hs_analytics_first_url || "").toLowerCase();
  let urlUtm = "";
  try {
    const q = new URL(url).searchParams;
    urlUtm = (q.get("utm_campaign") || "").toLowerCase();
  } catch {
    // ignore
  }
  const full = `${urlUtm} ${url}`;
  if (url.includes("airbnb-optimization-call") || urlUtm.includes("airbnb optimization call")) return "Airbnb Optimization Call";
  if (url.includes("direct-booking-sales") || urlUtm.includes("direct website call")) return "Direct Website Call";
  if (url.includes("direct-booking-website") || urlUtm.includes("direct website booking")) {
    return full.includes("subscribe") ? "DW Booking — Subscribe Event" : "DW Booking — Static & Video";
  }
  if (url.includes("airbnb-listing-optimization") || urlUtm.includes("airbnb listing optimization")) {
    return full.includes("subscribe") ? "Airbnb Listing Opt — Subscribe Event" : "Airbnb Listing Opt — Static & Video";
  }
  return null;
}

// ---- Helpers ----

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function hadPaidPlan(c: HubSpotContact): boolean {
  const plan = ((c.plan_name || c.plan_type_legacy || c.plan_type_old) || "").trim().toLowerCase();
  if (PAID_PLANS.has(plan)) return true;
  const laPrev = (c.limited_access_previous_plan || "").toLowerCase();
  return laPrev.includes("amplify") || laPrev.includes("flex");
}

function isQuickCancel(c: HubSpotContact): boolean {
  const e = parseDate(c.hs_v2_date_entered_customer);
  const x = parseDate(c.hs_v2_date_exited_customer);
  if (!e || !x) return false;
  return (x.getTime() - e.getTime()) / 86_400_000 < 2;
}

// ---- Outcome classification (call campaigns only) ----

type Outcome = "no_show" | "interested" | "not_interested" | "dq" | null;

function classifyExplicit(o: string | null): Outcome {
  if (!o) return null;
  const v = o.trim();
  if (v === "Meeting Scheduled" || v === "Interested - No Meeting Scheduled" || v === "Closed Sale") return "interested";
  if (v === "Not Moving Forward") return "not_interested";
  if (v === "Did Not Reach" || v === "Did Not Reach Left Message") return "no_show";
  if (v === "Disqualified" || v === "DQ - Invalid Number") return "dq";
  return null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function classifyNote(body: string): Outcome {
  const text = stripHtml(body).toLowerCase();
  // Skip post-conversion audit templates and outreach SMS templates
  if (text.includes("new customer audit") || text.includes("id verify status") || text.includes("property audit result")) return null;
  if (text.includes("this is joe from futurestay") || text.includes("this is chris from futurestay") || text.includes("this is jeremiah")) return null;
  // No-show signals.
  // "vm" / "voicemail" / "left vm" / "lvm" all mean the rep called and
  // nobody picked up — same outcome class as a no-show. Match on word
  // boundary so we don't false-positive on things like "rvm" inside
  // longer tokens. Also catch the common "n/s" shorthand reps use.
  const text2 = ` ${text} `;  // pad so word-boundary regex catches edge tokens
  const vmRegex = /(^|[^a-z])(vm|lvm|l\/vm|n\/s|n\.s\.)([^a-z]|$)/;
  if (vmRegex.test(text2)) return "no_show";
  const noShowKeys = ["no show", "no-show", "noshow", "didn't show", "did not show", "ghosted", "never showed", "missed the call", "missed call", "did not attend", "didn't attend", "voicemail", "voice mail", "left voicemail", "left a voicemail", "left a vm", "left vm", "no answer", "no-answer", "didn't pick up", "did not pick up", "did not answer", "didn't answer"];
  if (noShowKeys.some((k) => text.includes(k))) return "no_show";
  // DQ
  const dqKeys = ["disqualif", "not a fit", "invalid number", "wrong number", "fake number", "spam", "fraud", "not potential", "unsupport", "no str", "no english", "do not call", "mistakenly signed", "signed up by mistake", "booked because she thought", "no airbnb", "language barrier", "wants to attend a class"];
  if (dqKeys.some((k) => text.includes(k))) return "dq";
  // Closed/Interested
  if (text.includes("closed sale") || text.includes("closed-won") || text.includes("closed won") || text.includes("converted to amplify") || text.includes("converted to flex")) return "interested";
  const intKeys = ["interested", "next meeting", "follow up", "follow-up", "demo scheduled", "scheduled another", "2nd meeting", "second meeting", "will trial", "going to sign", "wants to start", "setting up", "set up call", "will sign up"];
  if (intKeys.some((k) => text.includes(k))) return "interested";
  const niKeys = ["not interested", "not moving forward", "declined", "passed", "too expensive", "not the right time", "not a priority", "not for them"];
  if (niKeys.some((k) => text.includes(k))) return "not_interested";
  return null;
}

function classifyAircall(c: HubSpotContact, meetingStart: Date | null): Outcome {
  if (!meetingStart) return null;
  const ac = parseDate(c.aircall_last_call_at);
  if (!ac || ac < meetingStart) return null;
  const id = c.last_aircall_call_outcome || "";
  if (AIRCALL_NO_ANSWER.has(id)) return "no_show";
  return null;
}

// ---- HubSpot Notes fetcher (for call-funnel contacts) ----

async function hsFetch<T = unknown>(path: string, init?: RequestInit, retries = 5): Promise<T> {
  // Same backoff strategy as lib/hubspot.ts. The notes/meetings batch
  // endpoints used by Campaign Analysis hit HubSpot once per chunk of
  // 100, and a single Campaign Analysis call can fire 5–10 such
  // batches. Without retry on 429 the whole card errors out the moment
  // any chunk gets unlucky.
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${HS_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
      const headerWait = retryAfter > 0 ? retryAfter * 1000 : 0;
      const backoff = Math.min(1500 * Math.pow(2, attempt), 30000);
      const waitMs = Math.max(headerWait, backoff);
      console.log(`[campaigns] HubSpot 429: waiting ${waitMs}ms (attempt ${attempt + 1}/${retries + 1})`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error("HubSpot API rate limit — please refresh in ~30 seconds");
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchNotesForContacts(contactIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (contactIds.length === 0) return result;
  for (const chunk of chunked(contactIds, 100)) {
    const body = { inputs: chunk.map((id) => ({ id })) };
    type Resp = { results?: Array<{ from: { id: string }; to: Array<{ id: string }> }> };
    try {
      const d = await hsFetch<Resp>("/crm/v3/associations/contacts/notes/batch/read", {
        method: "POST",
        body: JSON.stringify(body),
      });
      for (const row of d.results ?? []) {
        result.set(row.from.id, row.to.map((t) => t.id));
      }
    } catch {
      // Non-fatal: skip this chunk
    }
  }
  return result;
}

async function fetchNoteBodies(noteIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (noteIds.length === 0) return out;
  for (const chunk of chunked(noteIds, 100)) {
    const body = { inputs: chunk.map((id) => ({ id })), properties: ["hs_note_body"] };
    type Resp = { results?: Array<{ id: string; properties: { hs_note_body?: string } }> };
    try {
      const d = await hsFetch<Resp>("/crm/v3/objects/notes/batch/read", {
        method: "POST",
        body: JSON.stringify(body),
      });
      for (const row of d.results ?? []) {
        out.set(row.id, row.properties?.hs_note_body || "");
      }
    } catch {
      // skip
    }
  }
  return out;
}

// Classify all call-funnel contacts who had meetings in window using
// 3-source priority chain.
async function classifyCallContacts(
  contacts: HubSpotContact[],
  startMs: number,
  endMs: number,
): Promise<Map<string, Outcome>> {
  // 1) Fetch meetings within window
  type Meeting = { id: string; properties: { hs_meeting_start_time?: string } };
  const meetings: Meeting[] = [];
  let after: string | undefined;
  for (let i = 0; i < 40; i++) {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(startMs) },
          { propertyName: "hs_meeting_start_time", operator: "LTE", value: String(endMs) },
        ],
      }],
      properties: ["hs_meeting_start_time"],
      limit: 100,
      ...(after ? { after } : {}),
    };
    type Resp = { results?: Meeting[]; paging?: { next?: { after?: string } } };
    let d: Resp;
    try {
      d = await hsFetch<Resp>("/crm/v3/objects/meetings/search", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch {
      break;
    }
    meetings.push(...(d.results ?? []));
    after = d.paging?.next?.after;
    if (!after) break;
  }

  if (meetings.length === 0) return new Map();

  // 2) Associations meeting → contact
  const m2c = new Map<string, string>();
  for (const chunk of chunked(meetings, 100)) {
    const body = { inputs: chunk.map((m) => ({ id: m.id })) };
    type Resp = { results?: Array<{ from: { id: string }; to: Array<{ id: string }> }> };
    try {
      const d = await hsFetch<Resp>("/crm/v3/associations/meetings/contacts/batch/read", {
        method: "POST",
        body: JSON.stringify(body),
      });
      for (const row of d.results ?? []) {
        const cs = row.to ?? [];
        if (cs.length > 0) m2c.set(row.from.id, cs[0].id);
      }
    } catch {
      // skip
    }
  }

  // 3) Build set of call-funnel contacts (with their latest meeting time)
  const contactById = new Map<string, HubSpotContact>();
  for (const c of contacts) contactById.set(c.id, c);
  // Some contacts may have been created outside the window — fetch their props if missing
  // For now we only classify contacts already in the contacts array (those in window).
  // Meetings outside window are silently ignored if their contact isn't here.

  const callContactMeeting = new Map<string, Date>();
  for (const m of meetings) {
    const cid = m2c.get(m.id);
    if (!cid) continue;
    const c = contactById.get(cid);
    if (!c) continue;
    const ref = (c.referral_source || "").toUpperCase().trim();
    if (ref === "WIX" || ref === "HOPPER") continue;
    if ((c.airbnbdqreason || "").trim()) continue;
    const url = (c.hs_analytics_first_url || "").toLowerCase();
    const isCall = ["optimization-call", "direct-booking-sales", "website-call", "direct-booking-call", "/sales"]
      .some((k) => url.includes(k));
    if (!isCall) continue;
    const held = parseDate(m.properties?.hs_meeting_start_time || null);
    if (!held) continue;
    const existing = callContactMeeting.get(cid);
    if (!existing || held > existing) callContactMeeting.set(cid, held);
  }

  if (callContactMeeting.size === 0) return new Map();

  // 4) Fetch notes
  const noteAssoc = await fetchNotesForContacts(Array.from(callContactMeeting.keys()));
  const allNoteIds = new Set<string>();
  for (const ids of noteAssoc.values()) for (const nid of ids) allNoteIds.add(nid);
  const noteBodies = await fetchNoteBodies(Array.from(allNoteIds));

  // 5) Classify
  const classifications = new Map<string, Outcome>();
  for (const [cid, held] of callContactMeeting) {
    const c = contactById.get(cid);
    if (!c) continue;

    let cls: Outcome = classifyExplicit(c.sales_call_outcome);
    if (!cls) {
      for (const nid of noteAssoc.get(cid) ?? []) {
        const m = classifyNote(noteBodies.get(nid) ?? "");
        if (m) {
          cls = m;
          break;
        }
      }
    }
    if (!cls) cls = classifyAircall(c, held);

    classifications.set(cid, cls);
  }
  return classifications;
}

// ---- Main analysis function ----

export async function computeCampaignAnalysis(
  contacts: HubSpotContact[],
  since: string, // YYYY-MM-DD
  until: string, // YYYY-MM-DD inclusive
): Promise<CampaignAnalysisData> {
  // Convert window to Date range (inclusive end)
  const start = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T23:59:59.999Z`);

  // Fetch Meta spend + Google spend (roster + insights) in parallel.
  // Google failures degrade gracefully — we just show no Google rows
  // rather than killing the whole Campaign Analysis card.
  const [metaInsights, googleRoster, googleInsightsRaw] = await Promise.all([
    fetchMetaInsights(since, until),
    fetchActiveGoogleCampaigns().catch((err) => {
      console.error("[campaigns] fetchActiveGoogleCampaigns failed:", err);
      return [] as { id: string; name: string; status: string }[];
    }),
    fetchGoogleAdsInsights(since, until).catch((err) => {
      console.error("[campaigns] fetchGoogleAdsInsights failed:", err);
      return [] as Awaited<ReturnType<typeof fetchGoogleAdsInsights>>;
    }),
  ]);

  // Merge Google insights with active roster — same pattern as Meta:
  // active campaigns missing from insights (zero spend in window) are
  // surfaced so freshly-launched campaigns still appear in the table.
  const googleInsightsById = new Map(googleInsightsRaw.map((g) => [g.id, g]));
  type GoogleCampaignRecord = { id: string; name: string; spend: number };
  const googleCampaigns: GoogleCampaignRecord[] = googleRoster.map((r) => {
    const ins = googleInsightsById.get(r.id);
    return { id: r.id, name: r.name, spend: ins?.cost ?? 0 };
  });
  // Also include any campaign that appeared in insights but not the
  // current ENABLED roster (e.g. paused this morning but spent yesterday).
  const rosterIds = new Set(googleRoster.map((r) => r.id));
  for (const ins of googleInsightsRaw) {
    if (!rosterIds.has(ins.id) && ins.cost > 0) {
      googleCampaigns.push({ id: ins.id, name: ins.name, spend: ins.cost });
    }
  }
  const activeGoogleCampaigns = googleCampaigns.map((g) => ({ id: g.id, name: g.name }));

  // Aggregate Meta spend per bucket
  const spendByBucket: Record<string, number> = {};
  for (const c of metaInsights.campaigns) {
    const bk = bucketMetaCampaign(c.name);
    if (!bk) continue;
    spendByBucket[bk] = (spendByBucket[bk] || 0) + c.spend;
  }

  // Classify call-funnel contacts via sales_call_outcome → notes → aircall
  const startMs = new Date(`${since}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${until}T23:59:59.999Z`).getTime();
  const callClassifications = await classifyCallContacts(contacts, startMs, endMs);

  // Aggregate HubSpot contacts per bucket
  type Agg = {
    leads: number;
    signups: number;
    airbnbDq: number;
    auth: number;
    ready: number;
    meeting: number;
    trial: number;
    cust: number;
    // Outcome classification (call funnels only)
    clsNoShow: number;
    clsInterested: number;
    clsNotInterested: number;
    clsDq: number;
  };
  const empty = (): Agg => ({
    leads: 0, signups: 0, airbnbDq: 0, auth: 0, ready: 0, meeting: 0,
    trial: 0, cust: 0,
    clsNoShow: 0, clsInterested: 0, clsNotInterested: 0, clsDq: 0,
  });

  // ---- Attribution model ----
  //
  // Single-tier exact attribution: a contact is bumped into a Meta
  // campaign's aggregate iff matchContactToMetaCampaign returns the
  // campaign's name (ref_source override → first_touch_utm_campaign
  // prefix → hs_analytics_source_data_2 prefix). Contacts that fail
  // all three are silently dropped from the campaign-analysis rows.
  //
  // Why no bucket fallback: previously we surfaced a "— Unattributed
  // (no UTM)" residual row per bucket for those URL-only / source-
  // only landings, but the user found those rows noisy and asked us
  // to drop them. The unattributed cohort still shows up in the
  // dashboard's KPI tile (which is contact-level, not campaign-level)
  // and in the funnel card when no campaign filter is selected.

  // Snapshot active Meta campaign names for the shared matcher.
  // (See matchContactToMetaCampaign at module top.)
  const activeMetaNames = metaInsights.campaigns.map((m) => m.name);
  const matchMetaCampaign = (c: HubSpotContact) => matchContactToMetaCampaign(c, activeMetaNames);

  // Per-Meta-campaign exact attribution. UTM-less / bucket-residual
  // contacts are no longer collected (the "— Unattributed (no UTM)"
  // rows that used to be emitted were removed by user request).
  const metaAgg: Record<string, ReturnType<typeof empty>> = {};   // keyed by exact Meta name
  // Per-Google-campaign exact attribution (utm_source=google +
  // utm_campaign matches the numeric Google campaign ID).
  const googleAgg: Record<string, ReturnType<typeof empty>> = {}; // keyed by exact Google name

  function bumpAgg(a: ReturnType<typeof empty>, c: HubSpotContact) {
    a.leads += 1;
    if (SIGNUP_LIFECYCLES.has(c.account_lifecycle || "")) a.signups += 1;
    if ((c.airbnbdqreason || "").trim()) a.airbnbDq += 1;
    if (c.airbnb_authorization_status === "COMPLETED" || c.airbnb_authorization_status === "REVOKED") a.auth += 1;
    if ((c.property_ready_to_launch || "").toLowerCase() === "true") a.ready += 1;
    if (c.engagements_last_meeting_booked) a.meeting += 1;
    if (c.hs_v2_date_entered_opportunity || c.trial__start_date) a.trial += 1;
    if (c.hs_v2_date_entered_customer && hadPaidPlan(c) && !isQuickCancel(c)) a.cust += 1;
    const cls = callClassifications.get(c.id);
    if (cls === "no_show") a.clsNoShow += 1;
    else if (cls === "interested") a.clsInterested += 1;
    else if (cls === "not_interested") a.clsNotInterested += 1;
    else if (cls === "dq") a.clsDq += 1;
  }

  for (const c of contacts) {
    const ref = (c.referral_source || "").toUpperCase().trim();
    if (ref === "WIX" || ref === "HOPPER") continue;

    const created = parseDate(c.createdate);
    if (!created || created < start || created > end) continue;

    // Exact Meta-campaign match via UTM / src2 / ref_source override.
    // If hit, attribute to the SPECIFIC Meta campaign and stop.
    const metaMatch = matchMetaCampaign(c);
    if (metaMatch) {
      (metaAgg[metaMatch] ||= empty());
      bumpAgg(metaAgg[metaMatch], c);
      continue;
    }
    // Then try Google: utm_source = "google" + utm_campaign matches
    // a numeric Google campaign ID in the active roster.
    const googleMatch = matchContactToGoogleCampaign(c, activeGoogleCampaigns);
    if (googleMatch) {
      (googleAgg[googleMatch] ||= empty());
      bumpAgg(googleAgg[googleMatch], c);
      continue;
    }
    // Neither matched — drop. (Same "no residual rows" behaviour as
    // before. The unattributed cohort is visible in the funnel card.)
  }

  // ---- Per-Meta-campaign row generation ----
  //
  // One row per active Meta campaign. HubSpot funnel counts come from
  // exact attribution (UTM / src2 / ref_source) — matching what an
  // analyst gets by searching HubSpot for contacts whose first-touch
  // signal points to the Meta campaign name. UTM-less / URL-only
  // contacts are dropped from this table (per user request to remove
  // "— Unattributed (no UTM)" rows).

  // Group Meta campaigns by bucket
  const metaByBucket: Record<string, typeof metaInsights.campaigns> = {};
  const unbucketedMeta: typeof metaInsights.campaigns = [];
  for (const m of metaInsights.campaigns) {
    const bk = bucketMetaCampaign(m.name);
    if (bk) {
      (metaByBucket[bk] ||= []).push(m);
    } else {
      unbucketedMeta.push(m);
    }
  }

  // Map of bucket key → CAMPAIGN_DEFS entry, for type / optSignal lookup
  const defByBucket: Record<string, typeof CAMPAIGN_DEFS[number]> = {};
  for (const def of CAMPAIGN_DEFS) defByBucket[def.key] = def;

  // Build the row factory: given an agg + spend + optional name override,
  // produce a CampaignAnalysisRow with rates re-derived from THIS row's
  // own spend (not the bucket spend). Otherwise CPT/CPC would be the
  // bucket average across all sub-campaigns instead of the campaign's
  // own efficiency.
  function buildRow(
    def: typeof CAMPAIGN_DEFS[number],
    a: Agg,
    sp: number,
    nameOverride?: string,
  ): CampaignAnalysisRow {
    const isCall = def.type === "call";

    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    const cpa = (n: number) => (n > 0 ? sp / n : null);

    // Meetings Held = Meetings Booked − classified no-shows.
    // Uses the 3-source classifier (sales_call_outcome ∪ note keywords
    // ∪ Aircall after-meeting no-answer) to remove no-shows from the
    // booked count. Unclassified meetings are conservatively counted
    // as held (since reps tend to log no-shows more than successes
    // in this account, but coverage is climbing — caveat: when
    // outcomeCoverage is low, meetingsHeld is an upper bound).
    const meetingsHeld = isCall ? Math.max(0, a.meeting - a.clsNoShow) : null;
    const meetingToTrialRate = isCall && meetingsHeld && meetingsHeld > 0
      ? (a.trial / meetingsHeld) * 100
      : null;

    return {
      campaign: nameOverride ?? def.key,
      type: def.type,
      spend: sp,
      optSignal: def.optSignal,
      leads: a.leads,
      meetingsBooked: isCall ? a.meeting : null,
      meetingsHeld,
      signups: a.signups,
      qualifiedSignups: a.signups - a.airbnbDq,
      airbnbConnected: a.auth,
      readyToLaunch: a.ready,
      airbnbDqRate: pct(a.airbnbDq, a.leads),
      formToMeetingRate: isCall ? pct(a.meeting, a.leads) : null,
      costPerMeeting: isCall ? cpa(a.meeting) : null,
      // Outcome rates expressed as % of meetings booked (the right denom for call campaigns)
      noShowMtgRate: isCall ? pct(a.clsNoShow, a.meeting) : null,
      dqMtgRate: isCall ? pct(a.clsDq, a.meeting) : null,
      interestedMtgRate: isCall ? pct(a.clsInterested, a.meeting) : null,
      notInterestedMtgRate: isCall ? pct(a.clsNotInterested, a.meeting) : null,
      outcomeCoverage: isCall ? pct(a.clsNoShow + a.clsInterested + a.clsNotInterested + a.clsDq, a.meeting) : null,
      trials: a.trial,
      costPerTrial: cpa(a.trial),
      customers: a.cust,
      costPerCustomer: cpa(a.cust),
      meetingToTrialRate,
      // QS conversion rates: of Qualified Signups (signups − Airbnb DQ),
      // what % progressed to trial / customer? Cohort-based.
      qsToTrialRate: (a.signups - a.airbnbDq) > 0 ? (a.trial / (a.signups - a.airbnbDq)) * 100 : null,
      qsToCustomerRate: (a.signups - a.airbnbDq) > 0 ? (a.cust / (a.signups - a.airbnbDq)) * 100 : null,
    };
  }

  // Assemble rows: exact UTM-only per Meta campaign + a separate
  // residual row per bucket so the unattributed contacts are visible
  // without being misallocated.
  //
  // Why not split the residual proportionally by spend? Because spend
  // is a poor predictor of which specific Meta campaign drove a
  // UTM-less contact within a family. Doing so undercounts
  // high-converting small-spend campaigns and overcounts large-spend
  // siblings (the original Syerena bug). The honest answer is "we
  // don't know which one" — so we surface it as its own row.
  const rows: CampaignAnalysisRow[] = [];

  // Emit exact-attribution rows for every active Meta campaign, in
  // any bucket. Each row's count = ONLY contacts whose
  // first_touch_utm_campaign matched this Meta name via prefix.
  for (const def of CAMPAIGN_DEFS) {
    const metas = metaByBucket[def.key] ?? [];
    for (const m of metas) {
      const own = metaAgg[m.name] ?? empty();
      rows.push(buildRow(def, own, m.spend, m.name));
    }
  }

  // (Removed: per-bucket "— Unattributed (no UTM)" residual rows.
  // These were too noisy in the table. UTM-less contacts that fell
  // through to bucket attribution are silently dropped from the
  // visible rows; bucket-level totals are no longer reported here.
  // If you need the residual cohort for diagnostics, use the funnel
  // card with the bucket key selected, or check the HubSpot UI.)

  // Unbucketed active Meta campaigns (no UTM substring rule maps their
  // name to a CAMPAIGN_DEFS bucket — e.g. "Retargeting Ads"). They can
  // STILL pick up HubSpot attribution if a contact's utm_campaign
  // matches the Meta name exactly via Tier 1, so we surface metaAgg
  // here. If the campaign also doesn't show up in any contact's UTM,
  // the row reads zeros (honest result for an unbucketed campaign with
  // no UTM coverage).
  for (const m of unbucketedMeta) {
    const isCall = /\bcall\b/i.test(m.name);
    const a = metaAgg[m.name] ?? empty();
    const sp = m.spend;
    const cpa = (n: number) => (n > 0 ? sp / n : null);
    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    const meetingsHeld = isCall ? Math.max(0, a.meeting - a.clsNoShow) : null;
    const meetingToTrialRate = isCall && meetingsHeld && meetingsHeld > 0
      ? (a.trial / meetingsHeld) * 100
      : null;
    rows.push({
      campaign: m.name,
      type: isCall ? "call" : "self",
      spend: sp,
      optSignal: "unknown",
      leads: a.leads,
      meetingsBooked: isCall ? a.meeting : null,
      meetingsHeld,
      signups: a.signups,
      qualifiedSignups: a.signups - a.airbnbDq,
      airbnbConnected: a.auth,
      readyToLaunch: a.ready,
      airbnbDqRate: pct(a.airbnbDq, a.leads),
      formToMeetingRate: isCall ? pct(a.meeting, a.leads) : null,
      costPerMeeting: isCall ? cpa(a.meeting) : null,
      noShowMtgRate: isCall ? pct(a.clsNoShow, a.meeting) : null,
      dqMtgRate: isCall ? pct(a.clsDq, a.meeting) : null,
      interestedMtgRate: isCall ? pct(a.clsInterested, a.meeting) : null,
      notInterestedMtgRate: isCall ? pct(a.clsNotInterested, a.meeting) : null,
      outcomeCoverage: isCall ? pct(a.clsNoShow + a.clsInterested + a.clsNotInterested + a.clsDq, a.meeting) : null,
      trials: a.trial,
      costPerTrial: cpa(a.trial),
      customers: a.cust,
      costPerCustomer: cpa(a.cust),
      meetingToTrialRate,
      qsToTrialRate: (a.signups - a.airbnbDq) > 0 ? (a.trial / (a.signups - a.airbnbDq)) * 100 : null,
      qsToCustomerRate: (a.signups - a.airbnbDq) > 0 ? (a.cust / (a.signups - a.airbnbDq)) * 100 : null,
    });
  }

  // Google campaigns — one row each. All are treated as type="self"
  // since they're search / display / Pmax (no equivalent of the Meta
  // "call campaigns" path). optSignal = "google" so the table column
  // shows a clear platform distinction. Same column set as Meta self-
  // serve rows — Airbnb Connected, Ready to Launch, Trials, Customers
  // all read from HubSpot, so they apply uniformly across platforms.
  for (const g of googleCampaigns) {
    const a = googleAgg[g.name] ?? empty();
    const sp = g.spend;
    const cpa = (n: number) => (n > 0 ? sp / n : null);
    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    rows.push({
      campaign: g.name,
      type: "self",
      spend: sp,
      optSignal: "google",
      leads: a.leads,
      meetingsBooked: null,   // not applicable — Google funnels are self-serve here
      meetingsHeld: null,
      signups: a.signups,
      qualifiedSignups: a.signups - a.airbnbDq,
      airbnbConnected: a.auth,
      readyToLaunch: a.ready,
      airbnbDqRate: pct(a.airbnbDq, a.leads),
      formToMeetingRate: null,
      costPerMeeting: null,
      noShowMtgRate: null,
      dqMtgRate: null,
      interestedMtgRate: null,
      notInterestedMtgRate: null,
      outcomeCoverage: null,
      trials: a.trial,
      costPerTrial: cpa(a.trial),
      customers: a.cust,
      costPerCustomer: cpa(a.cust),
      meetingToTrialRate: null,
      qsToTrialRate: (a.signups - a.airbnbDq) > 0 ? (a.trial / (a.signups - a.airbnbDq)) * 100 : null,
      qsToCustomerRate: (a.signups - a.airbnbDq) > 0 ? (a.cust / (a.signups - a.airbnbDq)) * 100 : null,
    });
  }

  // Sort: highest spend first, then by name for $0-spend ties (so newly-
  // launched campaigns with no spend yet group together at the bottom
  // in a predictable order).
  rows.sort((a, b) => {
    if (b.spend !== a.spend) return b.spend - a.spend;
    return a.campaign.localeCompare(b.campaign);
  });

  return { rows, since, until };
}

// ============================================================
// Meetings Run Rate — daily timeseries by path (Airbnb vs Direct)
// ============================================================

export interface MeetingsTimeseriesPath {
  meetingsBooked: number[];
  meetingsHeld: number[];
  trialists: number[];
  customers: number[];
}

export interface MeetingsTimeseries {
  days: string[];        // ISO YYYY-MM-DD, oldest → newest
  airbnb: MeetingsTimeseriesPath;
  direct: MeetingsTimeseriesPath;
}

/** Path classification — which "side" of the funnel each campaign sits on.
 *  Airbnb path = campaigns whose LP/objective is the Airbnb-connected
 *  flow (Airbnb Optimization Call + Airbnb Listing Opt variants).
 *  Direct path = campaigns selling the direct-booking website
 *  (Direct Website Call + DW Booking variants). */
function pathFor(campaignKey: string): "airbnb" | "direct" | null {
  if (campaignKey.startsWith("Airbnb")) return "airbnb";
  if (campaignKey.startsWith("Direct") || campaignKey.startsWith("DW")) return "direct";
  return null;
}

export async function computeMeetingsTimeseries(
  contacts: HubSpotContact[],
  daysBack = 60
): Promise<MeetingsTimeseries> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startMs = today.getTime() - daysBack * 86_400_000;
  const endMs = today.getTime();
  const dayMs = 86_400_000;
  const dayCount = daysBack + 1;

  const days: string[] = [];
  for (let i = 0; i < dayCount; i++) {
    days.push(new Date(startMs + i * dayMs).toISOString().slice(0, 10));
  }

  function bucketIndex(d: string | null): number {
    if (!d) return -1;
    const t = new Date(d).getTime();
    if (isNaN(t)) return -1;
    const dayStart = new Date(new Date(t).toISOString().slice(0, 10) + "T00:00:00Z").getTime();
    const idx = Math.floor((dayStart - startMs) / dayMs);
    return idx >= 0 && idx < dayCount ? idx : -1;
  }

  const empty = (): MeetingsTimeseriesPath => ({
    meetingsBooked: new Array(dayCount).fill(0),
    meetingsHeld: new Array(dayCount).fill(0),
    trialists: new Array(dayCount).fill(0),
    customers: new Array(dayCount).fill(0),
  });
  const airbnb = empty();
  const direct = empty();

  // For meetings_held we need the no-show classification. The full
  // 3-source classifier (notes + Aircall + outcome field) requires
  // fetching notes which is expensive. For the timeseries we use the
  // explicit sales_call_outcome field only (note classification is
  // limited to the call-funnel cohort fetcher in the main analysis
  // path) — the explicit field captures most no-shows since reps now
  // have ~41% logging coverage. Acceptable trade-off for a daily chart.
  const isExplicitNoShow = (c: HubSpotContact) => {
    const v = (c.sales_call_outcome || "").trim();
    return v === "Did Not Reach" || v === "Did Not Reach Left Message";
  };

  // Pre-compute campaign launches so we can exclude pre-launch fallback
  const launchByBucket: Record<string, Date> = {};
  for (const def of CAMPAIGN_DEFS) {
    launchByBucket[def.key] = new Date(`${def.launch}T00:00:00.000Z`);
  }

  for (const c of contacts) {
    const ref = (c.referral_source || "").toUpperCase().trim();
    if (ref === "WIX" || ref === "HOPPER") continue;

    const bk = bucketContactToCampaign(c);
    if (!bk) continue;
    const path = pathFor(bk);
    if (!path) continue;
    const target = path === "airbnb" ? airbnb : direct;

    // Pre-launch fallback exclusion
    const created = c.createdate ? new Date(c.createdate) : null;
    const launch = launchByBucket[bk];
    if (created && launch && created < launch) continue;

    // Meetings booked / held — bucket by meeting date (when scheduled)
    const mtgDate = c.engagements_last_meeting_booked;
    if (mtgDate) {
      const i = bucketIndex(mtgDate);
      if (i >= 0) {
        target.meetingsBooked[i] += 1;
        if (!isExplicitNoShow(c)) target.meetingsHeld[i] += 1;
      }
    }

    // Trialists — bucket by trial start date
    const trialDate = c.trial__start_date || c.hs_v2_date_entered_opportunity;
    if (trialDate) {
      const i = bucketIndex(trialDate);
      if (i >= 0) target.trialists[i] += 1;
    }

    // Customers — bucket by customer entry date
    const custDate = c.hs_v2_date_entered_customer;
    if (custDate) {
      const i = bucketIndex(custDate);
      if (i >= 0) target.customers[i] += 1;
    }
  }

  return { days, airbnb, direct };
}
