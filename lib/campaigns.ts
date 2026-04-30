// Campaign Analysis — joins Meta spend with HubSpot contacts to give
// per-campaign performance for the 6 known Meta campaigns.

import { HubSpotContact, CampaignAnalysisRow, CampaignAnalysisData } from "./types";
import { fetchMetaInsights } from "./meta";

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

const SIGNUP_LIFECYCLES = new Set([
  "signup",
  "Trialist",
  "customer",
  "former.customer",
  "Customer/Limited Access",
]);

const PAID_PLANS = new Set(["amplify", "flex"]);

// 6 Meta campaigns + their type / optimization signal / launch date
const CAMPAIGN_DEFS: {
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

function bucketMetaCampaign(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("airbnb optimization call")) return "Airbnb Optimization Call";
  if (n.includes("direct website call")) return "Direct Website Call";
  if (n.includes("direct website booking") && n.includes("subscribe")) return "DW Booking — Subscribe Event";
  if (n.includes("direct website booking")) return "DW Booking — Static & Video";
  if (n.includes("airbnb listing optimization") && n.includes("subscribe")) return "Airbnb Listing Opt — Subscribe Event";
  if (n.includes("airbnb listing optimization")) return "Airbnb Listing Opt — Static & Video";
  return null;
}

function bucketContactToCampaign(c: HubSpotContact): string | null {
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

async function hsFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
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

  // Fetch Meta spend for the same window
  const metaInsights = await fetchMetaInsights(since, until);

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
  const agg: Record<string, Agg> = {};

  const launchByBucket: Record<string, Date> = {};
  for (const def of CAMPAIGN_DEFS) {
    launchByBucket[def.key] = new Date(`${def.launch}T00:00:00.000Z`);
  }

  // Cohort-based aggregation: every metric is counted for contacts whose
  // createdate falls in the window. This preserves the causal link between
  // campaign spend and outcomes for that cohort. Note: recent leads (within
  // ~14 days of the cohort end) may not have matured to customer yet —
  // the dashboard surfaces a maturity warning when that's the case.
  for (const c of contacts) {
    // Standard exclusions
    const ref = (c.referral_source || "").toUpperCase().trim();
    if (ref === "WIX" || ref === "HOPPER") continue;

    // Date range (cohort: filter by createdate)
    const created = parseDate(c.createdate);
    if (!created || created < start || created > end) continue;

    // Bucket
    const bk = bucketContactToCampaign(c);
    if (!bk) continue;

    // Pre-launch fallback exclusion
    const launch = launchByBucket[bk];
    if (launch && created < launch) continue;

    if (!agg[bk]) agg[bk] = empty();
    const a = agg[bk];

    a.leads += 1;
    if (SIGNUP_LIFECYCLES.has(c.account_lifecycle || "")) a.signups += 1;
    if ((c.airbnbdqreason || "").trim()) a.airbnbDq += 1;
    if (c.airbnb_authorization_status === "COMPLETED" || c.airbnb_authorization_status === "REVOKED") a.auth += 1;
    if ((c.property_ready_to_launch || "").toLowerCase() === "true") a.ready += 1;
    if (c.engagements_last_meeting_booked) a.meeting += 1;
    if (c.hs_v2_date_entered_opportunity || c.trial__start_date) a.trial += 1;
    if (c.hs_v2_date_entered_customer && hadPaidPlan(c) && !isQuickCancel(c)) a.cust += 1;

    // Apply derived classification (call funnel only — uses 3-source classifier
    // from classifyCallContacts: sales_call_outcome ∪ note keywords ∪ Aircall)
    const cls = callClassifications.get(c.id);
    if (cls === "no_show") a.clsNoShow += 1;
    else if (cls === "interested") a.clsInterested += 1;
    else if (cls === "not_interested") a.clsNotInterested += 1;
    else if (cls === "dq") a.clsDq += 1;
  }

  // Build rows in defined campaign order
  const rows: CampaignAnalysisRow[] = CAMPAIGN_DEFS.map((def) => {
    const a = agg[def.key] ?? empty();
    const sp = spendByBucket[def.key] ?? 0;
    const isCall = def.type === "call";

    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    const cpa = (n: number) => (n > 0 ? sp / n : null);

    return {
      campaign: def.key,
      type: def.type,
      spend: sp,
      optSignal: def.optSignal,
      leads: a.leads,
      meetingsBooked: isCall ? a.meeting : null,
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
      // QS conversion rates: of Qualified Signups (signups − Airbnb DQ),
      // what % progressed to trial / customer? Cohort-based.
      qsToTrialRate: (a.signups - a.airbnbDq) > 0 ? (a.trial / (a.signups - a.airbnbDq)) * 100 : null,
      qsToCustomerRate: (a.signups - a.airbnbDq) > 0 ? (a.cust / (a.signups - a.airbnbDq)) * 100 : null,
    };
  });

  return { rows, since, until };
}
