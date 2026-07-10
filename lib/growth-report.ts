// Daily Growth Report — core computation + two renderers.
//
// Originally a standalone scheduled-task script (~/.claude/scheduled-tasks/
// daily-growth-report/SKILL.md). Ported into the dashboard so a button
// on the UI can produce the same report on demand.
//
// One computation, two output shapes:
//   computeGrowthReport(date?)  →  GrowthReportData
//   renderGrowthReportSlack(d)  →  Slack-friendly text (asterisks, code
//                                  blocks, emojis)
//   renderGrowthReportHtml(d)   →  Self-contained HTML dashboard (inline
//                                  CSS, Futurestay palette)
//
// Both renderers are pure functions of the computed data, so they can
// never diverge.
//
// Uses the same dashboard-side helpers the rest of the app uses:
//   lib/hubspot.ts        fetchAllContacts
//   lib/meta.ts           fetchMetaInsights
//   lib/google.ts         fetchRecentGoogleAdGroups
//   lib/campaigns.ts      matchContactToMetaCampaign, matchContactToGoogleAdGroup
//
// Attribution rules and funnel definitions follow the source script and
// are documented alongside the code that enforces them.

import { fetchAllContacts } from "./hubspot";
import { fetchMetaInsights } from "./meta";
import { fetchRecentGoogleAdGroups, type GoogleAdsAdGroup } from "./google";
import { matchContactToMetaCampaign, matchContactToGoogleAdGroup } from "./campaigns";
import type { HubSpotContact } from "./types";

// ---------- Types --------------------------------------------------------

export type Signal = { score: number; label: string; dir: "good" | "bad" };

interface MetricsBundle {
  signups: number;
  dq: number;
  qualified: number;
  auth: number;
  rtl: number;
  trials: number;
  qSet: HubSpotContact[];
  all: HubSpotContact[];
}

interface MetricsAvg {
  signups: number;
  qualified: number;
  auth: number;
  rtl: number;
  trials: number;
}

export interface GrowthReportData {
  // Timekeeping
  generatedAt: string;          // ISO
  yesterday: string;            // YYYY-MM-DD (ET)
  dayOfWeek: string;            // e.g. "Wednesday"
  dowShort: string;             // "Wed"
  prettyDay: string;            // "Wednesday, July 9"
  genDay: string;               // "Jul 10, 2026"
  earlierSameWeek: string[];    // Mon-through-day-before-yesterday
  last14d: string[];

  // Cohort metrics
  Y: MetricsBundle;
  p7avg: MetricsAvg;
  dowAvg: MetricsAvg;

  // Trial counts on the KPI-tile basis
  Ytr: number;
  p7trAvg: number;
  dowTrAvg: number;

  // Within-week series (Mon → yesterday)
  sameWk: { day: string; m: MetricsBundle; dowName: string; ytr: number }[];

  // Trials + customers per day for the within-week bars in the HTML
  wkAll: { label: string; day: string; trials: number; customers: number; star: boolean }[];

  // 14-day funnel conversion averages, in %. Used by the HTML funnel
  // section for the "yesterday % vs 14d %" comparison.
  r14: { qual: number; auth: number; rtl: number; trials: number };

  // Attribution rollups (yesterday)
  utmMap: Record<string, string>;
  rtlByAd: Record<string, { n: number; camp: string; channel: string }>;
  trialByAd: Record<string, { n: number; camp: string; channel: string }>;
  byCamp: Record<string, { rtl: number; trials: number; channel: string }>;

  // Spend + efficiency
  yestSpend: number;
  p7SpendAvg: number;
  metaCampTop: { campaign_name: string; spend: number }[];

  // New launches
  newAds: { ad_id: string; ad_name: string; campaign_name: string; impressions: number; spend: number; created_time: string }[];

  // Zombies + young watchlist
  zombies: { adName: string; spend: number; camp: string; adId: string; created: string; ageDays: number; half1: number; half2: number }[];
  youngWatch: { adName: string; spend: number; camp: string; adId: string; created: string; ageDays: number }[];

  // Demographics
  chanAge: Record<string, Record<string, number>>;

  // Geo
  geoY: Record<string, number>;
  geoP: Record<string, number>;   // sum across prior 7 days

  // DQ
  dqY: Record<string, number>;
  dq7Total: Record<string, number>;
  dqRows: string[];

  // Sources
  srcY: Record<string, { signups: number; qualified: number; rtl: number; trials: number }>;
  src14: Record<string, number>;
  srcTop: [string, { signups: number; qualified: number; rtl: number; trials: number }][];
  newSrc: [string, { signups: number; qualified: number; rtl: number; trials: number }][];
  bigJumps: { k: string; y: number; avg: number }[];
  bigDrops: { k: string; y: number; avg: number }[];

  // Signals + narrative
  signals: Signal[];
  top5: Signal[];
  headlines: string[];
  sumOverall: string;
  sumInvestigate: string[];
  sumWatch: string[];
}

// ---------- Small helpers -----------------------------------------------

const SIGNUP_LIFECYCLES = new Set([
  "signup", "Trialist", "customer", "former.customer",
  "Customer/Limited Access", "Disqualfied",  // typo preserved — that's the actual HubSpot value
]);

const AGE_MID: Record<string, number> = {
  "18-24": 21, "25-34": 29.5, "35-44": 39.5, "45-54": 49.5, "55-64": 59.5, "65+": 70,
};

const ZOMBIE_MIN_AGE_DAYS = 10;

function etKey(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(d));
}

function nonPartner(c: HubSpotContact): boolean {
  const r = (c.referral_source || "").toUpperCase().trim();
  return r !== "WIX" && r !== "HOPPER";
}
function isSignup(c: HubSpotContact) { return SIGNUP_LIFECYCLES.has(c.account_lifecycle || ""); }
function hasDQ(c: HubSpotContact) { return !!(c.airbnbdqreason || "").trim(); }
function isAuth(c: HubSpotContact) {
  return c.airbnb_authorization_status === "COMPLETED" || c.airbnb_authorization_status === "REVOKED";
}
function isRTL(c: HubSpotContact) {
  return (c.property_ready_to_launch || "").toLowerCase() === "true";
}
function isTrialC(c: HubSpotContact) {
  return !!(c.hs_v2_date_entered_opportunity || c.trial__start_date);
}
function trialField(c: HubSpotContact): string | null {
  return c.hs_v2_date_entered_opportunity || c.trial__start_date;
}

async function fetchAllPages<T = Record<string, unknown>>(url: string): Promise<T[]> {
  const all: T[] = [];
  let u: string | undefined = url;
  while (u) {
    const r = await fetch(u);
    if (!r.ok) break;
    const j = (await r.json()) as { data?: T[]; paging?: { next?: string } };
    all.push(...(j.data || []));
    u = j.paging?.next;
  }
  return all;
}

// ---------- computeGrowthReport -----------------------------------------

export async function computeGrowthReport(dateOverride?: string): Promise<GrowthReportData> {
  const now = new Date();
  // "yesterday" is the previous ET calendar day by default; when the
  // caller passes an explicit ISO date we use that instead (e.g. viewing
  // an older report).
  const yesterday = dateOverride ? dateOverride : etKey(new Date(now.getTime() - 86_400_000));
  const yesterdayDate = new Date(yesterday + "T12:00:00Z");
  const dayOfWeek = yesterdayDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const dow = yesterdayDate.getUTCDay();
  const daysBackToMon = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(yesterdayDate.getTime() - daysBackToMon * 86_400_000);
  const earlierSameWeek: string[] = [];
  for (let i = 0; i < daysBackToMon; i++) {
    earlierSameWeek.push(etKey(new Date(weekStart.getTime() + i * 86_400_000)));
  }
  const prior7 = Array.from({ length: 7 }, (_, i) => etKey(new Date(yesterdayDate.getTime() - (i + 1) * 86_400_000)));
  const same4wk = Array.from({ length: 4 }, (_, i) => etKey(new Date(yesterdayDate.getTime() - (i + 1) * 7 * 86_400_000)));
  const last7d = [yesterday, ...prior7];
  const last14d = [...last7d, ...Array.from({ length: 7 }, (_, i) => etKey(new Date(yesterdayDate.getTime() - (i + 8) * 86_400_000)))];

  const [contacts, mi, ga] = await Promise.all([
    fetchAllContacts(),
    fetchMetaInsights("2024-01-01", etKey(now)).catch(() => ({ campaigns: [] as { name: string }[] } as { campaigns: { name: string }[] })),
    fetchRecentGoogleAdGroups(6).catch(() => [] as GoogleAdsAdGroup[]),
  ]);
  const activeMeta = mi.campaigns.map((m) => m.name);

  function cohort(day: string): HubSpotContact[] {
    return contacts.filter((c) => nonPartner(c) && c.createdate && etKey(c.createdate) === day);
  }
  function metrics(set: HubSpotContact[]): MetricsBundle {
    const s = set.filter(isSignup);
    const q = s.filter((c) => !hasDQ(c));
    return {
      signups: s.length,
      dq: s.length - q.length,
      qualified: q.length,
      auth: q.filter(isAuth).length,
      rtl: q.filter(isRTL).length,
      trials: q.filter(isTrialC).length,
      qSet: q,
      all: set,
    };
  }
  const Y = metrics(cohort(yesterday));
  const p7 = prior7.map((d) => metrics(cohort(d)));
  const sameDow = same4wk.map((d) => metrics(cohort(d)));

  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const p7avg: MetricsAvg = {
    signups: avg(p7.map((m) => m.signups)),
    qualified: avg(p7.map((m) => m.qualified)),
    auth: avg(p7.map((m) => m.auth)),
    rtl: avg(p7.map((m) => m.rtl)),
    trials: avg(p7.map((m) => m.trials)),
  };
  const dowAvg: MetricsAvg = {
    signups: avg(sameDow.map((m) => m.signups)),
    qualified: avg(sameDow.map((m) => m.qualified)),
    auth: avg(sameDow.map((m) => m.auth)),
    rtl: avg(sameDow.map((m) => m.rtl)),
    trials: avg(sameDow.map((m) => m.trials)),
  };

  // Trials — KPI-tile basis (activity-dated, partners excluded, no
  // lifecycle/qualified gate). This is the number the dashboard KPI
  // tile uses; the funnel section separately counts cohort-trials
  // (Y.trials) which is intentionally lower.
  const trialsStartedOn = (day: string): number =>
    contacts.filter((c) => nonPartner(c) && trialField(c) && etKey(trialField(c)!) === day).length;
  const Ytr = trialsStartedOn(yesterday);
  const p7trAvg = avg(prior7.map(trialsStartedOn));
  const dowTrAvg = avg(same4wk.map(trialsStartedOn));

  const sameWk = earlierSameWeek.map((d) => ({
    day: d,
    m: metrics(cohort(d)),
    dowName: new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    ytr: trialsStartedOn(d),
  }));

  const dpct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);

  // Signals accumulate through the sections below; ranked into top-5 at
  // the end.
  const signals: Signal[] = [];

  // baseline deltas → signals
  const record = (l: string, y: number, sev: number, dowV: number) => {
    const dD = dpct(y, dowV);
    if (Math.abs(dD) >= 20 && Math.abs(y - dowV) >= 2) {
      signals.push({
        score: Math.abs(dD) * (y + dowV),
        label: `${l} ${y} vs ${dayOfWeek} avg ${dowV.toFixed(1)} (${(dD >= 0 ? "+" : "") + dD.toFixed(0)}%)`,
        dir: dD >= 0 ? "good" : "bad",
      });
    }
  };
  record("Total signups", Y.signups, p7avg.signups, dowAvg.signups);
  record("Qualified", Y.qualified, p7avg.qualified, dowAvg.qualified);
  record("Airbnb auth", Y.auth, p7avg.auth, dowAvg.auth);
  record("Ready to Launch", Y.rtl, p7avg.rtl, dowAvg.rtl);
  record("Trials started", Ytr, p7trAvg, dowTrAvg);

  // Per-ad attribution (yesterday). first_touch_utm_content is already
  // on the contact record (added to CONTACT_PROPERTIES in lib/hubspot.ts),
  // so we skip the extra HubSpot batch-read the standalone script does.
  const shortAd = (x: string) => (!x ? "(no utm_content)" : x.replace(/^\d+\.\d+ \| /, "").replace(/ \| LP - [^|]+$/, ""));
  const shortCamp = (x: string) => (x || "").replace(/ \| US & CA/, "").replace(/ \| Campaign$/, "").slice(0, 32);

  const utmMap: Record<string, string> = {};
  for (const c of Y.qSet) utmMap[c.id] = c.first_touch_utm_content || "";

  const rtlByAd: GrowthReportData["rtlByAd"] = {};
  const trialByAd: GrowthReportData["trialByAd"] = {};
  const byCamp: GrowthReportData["byCamp"] = {};
  for (const c of Y.qSet) {
    const ad = shortAd(utmMap[c.id] || "");
    const m = matchContactToMetaCampaign(c, activeMeta);
    const g = matchContactToGoogleAdGroup(c, ga);
    const channel = m ? "Meta" : g ? "Google" : "Other";
    const camp = m ? shortCamp(m) : g ? g : (c.first_touch_utm_source || "direct");
    const campStr = typeof camp === "string" ? camp : "";
    if (isRTL(c)) {
      if (!rtlByAd[ad]) rtlByAd[ad] = { n: 0, camp: campStr, channel };
      rtlByAd[ad].n++;
      if (!byCamp[campStr]) byCamp[campStr] = { rtl: 0, trials: 0, channel };
      byCamp[campStr].rtl++;
    }
    if (isTrialC(c)) {
      if (!trialByAd[ad]) trialByAd[ad] = { n: 0, camp: campStr, channel };
      trialByAd[ad].n++;
      if (!byCamp[campStr]) byCamp[campStr] = { rtl: 0, trials: 0, channel };
      byCamp[campStr].trials++;
    }
  }
  const topRtlAd = Object.entries(rtlByAd).sort(([, a], [, b]) => b.n - a.n)[0];
  if (topRtlAd && topRtlAd[1].n >= 5) {
    signals.push({ score: topRtlAd[1].n * 30, label: `${topRtlAd[0]} drove ${topRtlAd[1].n} RTLs (top yesterday)`, dir: "good" });
  }

  // Spend from Meta Graph. We keep this outside the shared fetchMetaInsights
  // so we can request the exact 8-day window we need here.
  const tokM = process.env.META_ACCESS_TOKEN!;
  const acc = process.env.META_AD_ACCOUNT_ID!;
  const tr8 = encodeURIComponent(JSON.stringify({ since: prior7[prior7.length - 1], until: yesterday }));
  const metaDaily = await fetchAllPages<{ date_start?: string; spend?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=spend&level=account&time_increment=1&time_range=${tr8}&access_token=${tokM}`
  );
  const yestSpend = parseFloat(metaDaily.find((r) => r.date_start === yesterday)?.spend || "0");
  const p7SpendAvg = avg(metaDaily.filter((r) => r.date_start !== yesterday).map((r) => parseFloat(r.spend || "0")));

  const trY = encodeURIComponent(JSON.stringify({ since: yesterday, until: yesterday }));
  const metaCampRaw = await fetchAllPages<{ campaign_name?: string; spend?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=campaign_name,spend&level=campaign&time_range=${trY}&access_token=${tokM}`
  );
  const metaCampTop = metaCampRaw
    .map((r) => ({ campaign_name: r.campaign_name || "", spend: parseFloat(r.spend || "0") }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);

  if (Math.abs(dpct(yestSpend, p7SpendAvg)) >= 20) {
    const d = dpct(yestSpend, p7SpendAvg);
    signals.push({
      score: (Math.abs(d) * yestSpend) / 100,
      label: `Meta spend $${yestSpend.toFixed(0)} vs 7d avg $${p7SpendAvg.toFixed(0)} (${(d >= 0 ? "+" : "") + d.toFixed(0)}%)`,
      dir: "bad",
    });
  }

  // Ad-level metrics for new-launches + zombies
  const tr7 = tr8;
  const ins7 = await fetchAllPages<{ ad_id?: string; ad_name?: string; campaign_name?: string; impressions?: string; clicks?: string; spend?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=ad_id,ad_name,campaign_name,impressions,clicks,spend&level=ad&time_range=${tr7}&limit=500&access_token=${tokM}`
  );
  const tr90 = encodeURIComponent(JSON.stringify({ since: etKey(new Date(yesterdayDate.getTime() - 90 * 86_400_000)), until: yesterday }));
  const ins90 = await fetchAllPages<{ ad_id?: string; ad_name?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=ad_id,ad_name&level=ad&time_range=${tr90}&limit=500&access_token=${tokM}`
  );
  const adIds = Array.from(new Set([...ins7.map((r) => r.ad_id), ...ins90.map((r) => r.ad_id)].filter((x): x is string => !!x)));
  const adMeta: Record<string, { id?: string; name?: string; created_time?: string; effective_status?: string }> = {};
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    const r = await fetch(`https://graph.facebook.com/v21.0?ids=${chunk.join(",")}&fields=id,name,created_time,effective_status&access_token=${tokM}`);
    if (!r.ok) continue;
    const j = (await r.json()) as Record<string, { id?: string; name?: string; created_time?: string; effective_status?: string }>;
    for (const [k, v] of Object.entries(j)) adMeta[k] = v;
  }
  const cutoffMs = new Date(prior7[prior7.length - 1] + "T00:00:00Z").getTime();
  const isTest = (n: string) => /(^|[^a-z])test([^a-z]|$)/i.test(n || "");
  const newAdsRaw = ins7.filter((r) => {
    if (!r.ad_id) return false;
    const meta = adMeta[r.ad_id];
    if (!meta) return false;
    if (isTest(r.ad_name || "") || isTest(r.campaign_name || "")) return false;
    return Date.parse(meta.created_time || "") >= cutoffMs;
  }).sort((a, b) => parseInt(b.impressions || "0") - parseInt(a.impressions || "0"));
  const newAds = newAdsRaw.map((r) => ({
    ad_id: r.ad_id || "",
    ad_name: r.ad_name || "",
    campaign_name: r.campaign_name || "",
    impressions: parseInt(r.impressions || "0"),
    spend: parseFloat(r.spend || "0"),
    created_time: adMeta[r.ad_id || ""]?.created_time || "",
  }));

  // 14-day spend and split-halves for zombie detection
  const tr14 = encodeURIComponent(JSON.stringify({ since: last14d[last14d.length - 1], until: yesterday }));
  const ins14 = await fetchAllPages<{ ad_id?: string; ad_name?: string; campaign_name?: string; impressions?: string; spend?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=ad_id,ad_name,campaign_name,impressions,spend&level=ad&time_range=${tr14}&limit=500&access_token=${tokM}`
  );
  const ins14daily = await fetchAllPages<{ ad_id?: string; ad_name?: string; date_start?: string; spend?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=ad_id,ad_name,spend&level=ad&time_increment=1&time_range=${tr14}&limit=500&access_token=${tokM}`
  );
  const spend14: Record<string, { spend: number; impr: number; camp: string; adId: string }> = {};
  for (const r of ins14) {
    if (isTest(r.ad_name || "") || isTest(r.campaign_name || "")) continue;
    const k = r.ad_name || "(unnamed)";
    if (!spend14[k]) spend14[k] = { spend: 0, impr: 0, camp: r.campaign_name || "", adId: r.ad_id || "" };
    spend14[k].spend += parseFloat(r.spend || "0");
    spend14[k].impr += parseInt(r.impressions || "0");
  }
  const half1days = last14d.slice(7);
  const half2days = last14d.slice(0, 7);
  const half1S: Record<string, number> = {}, half2S: Record<string, number> = {};
  for (const r of ins14daily) {
    if (isTest(r.ad_name || "")) continue;
    const k = r.ad_name || "";
    if (r.date_start && half1days.includes(r.date_start)) half1S[k] = (half1S[k] || 0) + parseFloat(r.spend || "0");
    if (r.date_start && half2days.includes(r.date_start)) half2S[k] = (half2S[k] || 0) + parseFloat(r.spend || "0");
  }
  // Attribute HubSpot trials to Meta ads via fuzzy utm_content ↔ ad_name.
  // (Same normalized-substring match the standalone script uses.)
  const l14dContacts = contacts.filter((c) => nonPartner(c) && c.createdate && last14d.includes(etKey(c.createdate)));
  const norm = (x: string) => (x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const trials14: Record<string, number> = {};
  for (const c of l14dContacts) {
    if (!isSignup(c) || hasDQ(c) || !isTrialC(c)) continue;
    const utm = c.first_touch_utm_content || "";
    const uN = norm(utm.replace(/^\d+\.\d+ \| /, "").replace(/ \| LP - [^|]+$/, ""));
    if (!uN) continue;
    for (const adName of Object.keys(spend14)) {
      const aN = norm(adName);
      if (aN.includes(uN) || uN.includes(aN)) {
        trials14[adName] = (trials14[adName] || 0) + 1;
        break;
      }
    }
  }
  const nowMs = Date.now();
  const zombies = Object.entries(spend14).filter(([k, v]) => {
    if (v.spend < 100) return false;
    if ((trials14[k] || 0) > 0) return false;
    const created = Date.parse(adMeta[v.adId]?.created_time || "");
    if (isNaN(created)) return true;
    return (nowMs - created) / 86_400_000 >= ZOMBIE_MIN_AGE_DAYS;
  }).sort(([, a], [, b]) => b.spend - a.spend).map(([k, v]) => {
    const created = adMeta[v.adId]?.created_time || "";
    const cMs = Date.parse(created);
    const ageDays = isNaN(cMs) ? -1 : Math.round((nowMs - cMs) / 86_400_000);
    return { adName: k, spend: v.spend, camp: v.camp, adId: v.adId, created, ageDays, half1: half1S[k] || 0, half2: half2S[k] || 0 };
  });
  const youngWatch = Object.entries(spend14).filter(([k, v]) => {
    if (v.spend < 100) return false;
    if ((trials14[k] || 0) > 0) return false;
    const created = Date.parse(adMeta[v.adId]?.created_time || "");
    if (isNaN(created)) return false;
    return (nowMs - created) / 86_400_000 < ZOMBIE_MIN_AGE_DAYS;
  }).sort(([, a], [, b]) => b.spend - a.spend).map(([k, v]) => {
    const created = adMeta[v.adId]?.created_time || "";
    const ageDays = Math.round((nowMs - Date.parse(created)) / 86_400_000);
    return { adName: k, spend: v.spend, camp: v.camp, adId: v.adId, created, ageDays };
  });
  if (zombies.length > 0) {
    const zSpend = zombies.slice(0, 6).reduce((s, z) => s + z.spend, 0);
    signals.push({ score: zSpend, label: `${zombies.length} zombie ads burning $${zSpend.toFixed(0)}+ over 14d (worst 6)`, dir: "bad" });
  }

  // Demographics by channel family
  const chanFam = (name: string) => {
    const n = (name || "").toLowerCase();
    if (n.includes("syerena")) return "Meta: Syerena";
    if (n.includes("charles")) return "Meta: Charles";
    if (n.includes("retargeting")) return "Meta: Retargeting";
    if (n.includes("call")) return "Meta: DW Call";
    if (n.includes("airbnb optimization") || n.includes("airbnb listing")) return "Meta: Airbnb Opt";
    if (n.includes("subscribe event")) return "Meta: DWB Subscribe";
    if (n.includes("direct website booking")) return "Meta: DW Booking";
    return "Meta: Other";
  };
  const ageIns = await fetchAllPages<{ campaign_name?: string; age?: string; impressions?: string }>(
    `https://graph.facebook.com/v21.0/${acc}/insights?fields=campaign_name,impressions&level=campaign&breakdowns=age&time_range=${trY}&access_token=${tokM}`
  );
  const chanAge: Record<string, Record<string, number>> = {};
  for (const r of ageIns) {
    const fam = chanFam(r.campaign_name || "");
    if (!chanAge[fam]) chanAge[fam] = {};
    if (r.age) chanAge[fam][r.age] = (chanAge[fam][r.age] || 0) + parseInt(r.impressions || "0");
  }

  // Geo
  const geoY: Record<string, number> = {};
  const geoP: Record<string, number> = {};
  for (const c of Y.qSet) {
    const co = (c.country || c.ip_country || "unknown").trim();
    geoY[co] = (geoY[co] || 0) + 1;
  }
  for (const d of prior7) cohort(d).forEach((c) => {
    if (!isSignup(c) || hasDQ(c)) return;
    const co = (c.country || c.ip_country || "unknown").trim();
    geoP[co] = (geoP[co] || 0) + 1;
  });
  const unkPct = Y.qualified ? ((geoY["unknown"] || 0) / Y.qualified) * 100 : 0;
  if (unkPct >= 30) {
    signals.push({
      score: geoY["unknown"] || 0,
      label: `${geoY["unknown"] || 0}/${Y.qualified} (${unkPct.toFixed(0)}%) qualified signups have unknown country — data gap`,
      dir: "bad",
    });
  }

  // DQ
  const dqY: Record<string, number> = {};
  const dq7Total: Record<string, number> = {};
  cohort(yesterday).filter((c) => isSignup(c) && hasDQ(c)).forEach((c) => {
    const r = c.airbnbdqreason || "other";
    dqY[r] = (dqY[r] || 0) + 1;
  });
  for (const d of prior7) cohort(d).filter((c) => isSignup(c) && hasDQ(c)).forEach((c) => {
    const r = c.airbnbdqreason || "other";
    dq7Total[r] = (dq7Total[r] || 0) + 1;
  });
  const dqRows = Array.from(new Set([...Object.keys(dqY), ...Object.keys(dq7Total)]))
    .sort((a, b) => (dqY[b] || 0) - (dqY[a] || 0));
  dqRows.forEach((r) => {
    const y = dqY[r] || 0;
    const avgD = (dq7Total[r] || 0) / 7;
    const d = dpct(y, avgD);
    if (Math.abs(d) >= 100 && y >= 3) {
      signals.push({
        score: y * Math.abs(d),
        label: `DQ "${r}" ${y} yday vs daily avg ${avgD.toFixed(1)} (${(d >= 0 ? "+" : "") + d.toFixed(0)}%)`,
        dir: d > 0 ? "bad" : "good",
      });
    }
  });

  // Sources
  const sourceOf = (c: HubSpotContact) => {
    const src = (c.first_touch_utm_source || "").toLowerCase().trim();
    if (src) return src;
    const r = (c.referral_source || "").toLowerCase().trim();
    if (r && !["signup", "start", "direct-booking", "airbnb-opt", "hello", "tfv", "sorr"].includes(r)) return `ref:${r}`;
    return "direct";
  };
  const srcY: GrowthReportData["srcY"] = {};
  for (const c of cohort(yesterday)) {
    if (!isSignup(c)) continue;
    const src = sourceOf(c);
    if (!srcY[src]) srcY[src] = { signups: 0, qualified: 0, rtl: 0, trials: 0 };
    srcY[src].signups++;
    if (!hasDQ(c)) srcY[src].qualified++;
    if (!hasDQ(c) && isRTL(c)) srcY[src].rtl++;
    if (!hasDQ(c) && isTrialC(c)) srcY[src].trials++;
  }
  const src14: Record<string, number> = {};
  const srcPrior14seen = new Set<string>();
  for (const d of last14d) cohort(d).forEach((c) => {
    if (!isSignup(c)) return;
    const s = sourceOf(c);
    src14[s] = (src14[s] || 0) + 1;
  });
  const prior14start = new Date(yesterdayDate.getTime() - 28 * 86_400_000);
  for (let i = 0; i < 14; i++) {
    const d = etKey(new Date(prior14start.getTime() + i * 86_400_000));
    cohort(d).forEach((c) => {
      if (!isSignup(c)) return;
      srcPrior14seen.add(sourceOf(c));
    });
  }
  const srcTop: GrowthReportData["srcTop"] = Object.entries(srcY)
    .sort(([, a], [, b]) => b.qualified - a.qualified).slice(0, 7);
  const newSrc: GrowthReportData["newSrc"] = Object.entries(srcY).filter(([x]) => !srcPrior14seen.has(x));
  const existingShifts = Object.entries(srcY).filter(([k]) => srcPrior14seen.has(k));
  const bigJumps = existingShifts.map(([k, v]) => ({ k, y: v.signups, avg: (src14[k] || 0) / 14 }))
    .filter((r) => r.avg >= 1 && dpct(r.y, r.avg) >= 100 && r.y >= 3);
  const bigDrops = existingShifts.map(([k, v]) => ({ k, y: v.signups, avg: (src14[k] || 0) / 14 }))
    .filter((r) => r.avg >= 3 && dpct(r.y, r.avg) <= -50);
  newSrc.forEach(([sr, v]) => signals.push({
    score: v.signups * 10 + v.trials * 30,
    label: `🆕 New source "${sr}" — ${v.signups} signups, ${v.trials} trials`,
    dir: "good",
  }));
  bigJumps.forEach((r) => signals.push({
    score: r.y * Math.abs(dpct(r.y, r.avg)),
    label: `Source "${r.k}" surged: ${r.y} yday vs 14d-avg ${r.avg.toFixed(1)} (${(dpct(r.y, r.avg) >= 0 ? "+" : "") + dpct(r.y, r.avg).toFixed(0)}%)`,
    dir: "good",
  }));
  bigDrops.forEach((r) => signals.push({
    score: r.avg * Math.abs(dpct(r.y, r.avg)),
    label: `Source "${r.k}" dropped: ${r.y} yday vs 14d-avg ${r.avg.toFixed(1)} (${(dpct(r.y, r.avg) >= 0 ? "+" : "") + dpct(r.y, r.avg).toFixed(0)}%)`,
    dir: "bad",
  }));

  // Top-5 headlines
  const all = [...signals].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const top5: Signal[] = [];
  const headlines: string[] = [];
  for (const sig of all) {
    if (top5.length >= 5) break;
    if (seen.has(sig.label)) continue;
    seen.add(sig.label);
    top5.push(sig);
    const emoji = sig.dir === "good" ? "🟢" : "🔴";
    headlines.push(`${emoji} ${sig.label}`);
  }

  // Narrative summary
  const s = (p: number) => (p >= 0 ? "+" : "") + p.toFixed(0) + "%";
  const word = (p: number) => (Math.abs(p) < 10 ? "roughly flat" : p >= 0 ? `up ${Math.abs(p).toFixed(0)}%` : `down ${Math.abs(p).toFixed(0)}%`);
  const mny = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const sigDoW = dpct(Y.signups, dowAvg.signups);
  const sig7 = dpct(Y.signups, p7avg.signups);
  const authDoW = dpct(Y.auth, dowAvg.auth);
  const rtlDoW = dpct(Y.rtl, dowAvg.rtl);
  const trDoW = dpct(Ytr, dowTrAvg);
  const volLine = (Math.abs(sigDoW) < 15 && Math.abs(sig7) >= 20)
    ? `Signups landed at ${Y.signups}, ${word(sigDoW)} versus recent ${dayOfWeek}s. The ${s(sig7)} against the 7 day average is a level effect from stronger early week days, not a real same day drop.`
    : `Signups landed at ${Y.signups}, ${word(sigDoW)} versus recent ${dayOfWeek}s and ${word(sig7)} versus the 7 day average.`;
  const downBits = `Airbnb auth ${word(authDoW)}, Ready to Launch ${word(rtlDoW)}, trials ${word(trDoW)}`;
  const goodDown = authDoW >= -10 && rtlDoW >= -10;
  const downLine = goodDown
    ? `The rest of the funnel held on a same ${dayOfWeek} basis: ${downBits}.`
    : `Downstream was mixed versus recent ${dayOfWeek}s: ${downBits}.`;
  const sumOverall = `${volLine} ${downLine}`;

  const sumInvestigate: string[] = [];
  const sumWatch: string[] = [];
  if (zombies.length) {
    const zTop = zombies[0];
    const z6 = zombies.slice(0, 6).reduce((a, z) => a + z.spend, 0);
    sumInvestigate.push(`${zombies.length} zombie ads have burned about ${mny(z6)} over 14 days with no attributed trials. Review and pause the worst, starting with ${zTop.adName} at ${mny(zTop.spend)}.`);
  }
  bigDrops.forEach((r) => {
    if (r.avg >= 5) sumInvestigate.push(`Source "${r.k}" fell to ${r.y} signups from a 14 day average of ${r.avg.toFixed(1)} (${s(dpct(r.y, r.avg))}). Check spend and tracking on that channel.`);
    else sumWatch.push(`Source "${r.k}" dipped to ${r.y} signups versus a 14 day average of ${r.avg.toFixed(1)} (${s(dpct(r.y, r.avg))}), but the baseline is small, so give it a few days.`);
  });
  dqRows.forEach((r) => {
    const y = dqY[r] || 0;
    const avgD = (dq7Total[r] || 0) / 7;
    const d = dpct(y, avgD);
    if (d >= 100 && y >= 3) sumInvestigate.push(`Disqualifications for ${r.replace(/_/g, " ").toLowerCase()} rose to ${y} versus a daily average of ${avgD.toFixed(1)} (${s(d)}).`);
  });
  if (dpct(yestSpend, p7SpendAvg) >= 20) {
    sumInvestigate.push(`Meta spend (${mny(yestSpend)}) ran ${word(dpct(yestSpend, p7SpendAvg))} versus the 7 day average of ${mny(p7SpendAvg)}. Confirm the pacing is intentional.`);
  }
  if (trDoW <= -20 && Math.abs(Ytr - dowTrAvg) >= 2) {
    sumWatch.push(`Trials started (${Ytr}) came in ${word(trDoW)} versus recent ${dayOfWeek}s. One soft day is within the normal range; watch whether it persists.`);
  }
  if (unkPct >= 30) {
    const gd = dpct(geoY["unknown"] || 0, (geoP["unknown"] || 0) / 7);
    sumWatch.push(`${geoY["unknown"] || 0} of ${Y.qualified} qualified signups (${unkPct.toFixed(0)}%) have no country recorded. This is a tracking gap, not a growth problem, and yesterday it was ${gd < 0 ? "lower" : "higher"} than the recent daily average (${s(gd)}).`);
  }
  newSrc.forEach(([sr, v]) => sumWatch.push(`New source "${sr}" appeared with ${v.signups} signup(s) and ${v.trials} trial(s). Too early to judge; confirm it is real traffic and not a tagging change.`));
  bigJumps.forEach((r) => sumWatch.push(`Source "${r.k}" jumped to ${r.y} signups from a 14 day average of ${r.avg.toFixed(1)} (${s(dpct(r.y, r.avg))}). Encouraging, but confirm it holds over a few days.`));
  if (sumInvestigate.length === 0) sumInvestigate.push("Nothing urgent. No zombie ad, source, spend, or disqualification signal crossed the action threshold.");
  if (sumWatch.length === 0) sumWatch.push("No borderline signals to monitor right now.");

  // Within-week bars (trials + customers per day, activity-dated)
  const wkDays = [...earlierSameWeek, yesterday];
  const custDateOf = (c: HubSpotContact) => c.hs_v2_date_entered_customer;
  const wkAll = wkDays.map((day) => {
    let trials = 0, customers = 0;
    for (const c of contacts) {
      if (!nonPartner(c)) continue;
      const td = trialField(c);
      if (td && etKey(td) === day) trials++;
      const cd = custDateOf(c);
      if (cd && etKey(cd) === day) customers++;
    }
    const md = new Date(day + "T12:00:00Z");
    return {
      label: md.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day,
      trials,
      customers,
      star: day === yesterday,
    };
  });

  // 14-day funnel conversion averages (each stage as % of the stage
  // above), used for the "yesterday % vs 14d %" comparison in the HTML
  // funnel section. Reconstructed from per-day cohorts.
  const m14 = last14d.map((d) => metrics(cohort(d)));
  const T14 = (f: (m: MetricsBundle) => number) => m14.reduce((a, m) => a + f(m), 0);
  const t14s = T14((m) => m.signups);
  const t14q = T14((m) => m.qualified);
  const t14a = T14((m) => m.auth);
  const t14r = T14((m) => m.rtl);
  const t14t = T14((m) => m.trials);
  const r14 = {
    qual:   t14s ? (t14q / t14s) * 100 : 0,
    auth:   t14q ? (t14a / t14q) * 100 : 0,
    rtl:    t14q ? (t14r / t14q) * 100 : 0,
    trials: t14q ? (t14t / t14q) * 100 : 0,
  };

  return {
    generatedAt: now.toISOString(),
    yesterday,
    dayOfWeek,
    dowShort: dayOfWeek.slice(0, 3),
    prettyDay: yesterdayDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
    genDay: now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    earlierSameWeek,
    last14d,
    Y, p7avg, dowAvg,
    Ytr, p7trAvg, dowTrAvg,
    sameWk,
    wkAll,
    r14,
    utmMap, rtlByAd, trialByAd, byCamp,
    yestSpend, p7SpendAvg, metaCampTop,
    newAds,
    zombies, youngWatch,
    chanAge,
    geoY, geoP,
    dqY, dq7Total, dqRows,
    srcY, src14, srcTop, newSrc, bigJumps, bigDrops,
    signals, top5, headlines,
    sumOverall, sumInvestigate, sumWatch,
  };
}

// ---------- Slack renderer ----------------------------------------------

/** Produces the exact Slack-friendly text output the standalone script
 *  prints. Bold `*asterisks*`, backtick code blocks, emoji. Meant to be
 *  pasted into Slack unchanged. */
export function renderGrowthReportSlack(d: GrowthReportData): string {
  const {
    yesterday, dayOfWeek, Y, p7avg, dowAvg, Ytr, p7trAvg, dowTrAvg,
    sameWk, earlierSameWeek, rtlByAd, trialByAd, byCamp,
    yestSpend, p7SpendAvg, metaCampTop, newAds, zombies, youngWatch,
    chanAge, geoY, geoP, dqY, dq7Total, dqRows,
    srcY, src14, srcTop, newSrc, bigJumps, bigDrops,
    headlines, sumOverall, sumInvestigate, sumWatch, top5,
  } = d;

  const out: string[] = [];
  const wr = (x: string = "") => out.push(x);
  const dpct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
  const s = (p: number) => (p >= 0 ? "+" : "") + p.toFixed(0) + "%";
  const arr = (p: number) => (p >= 10 ? "🟢" : p <= -10 ? "🔴" : "⚪");
  void top5;   // narrated via `headlines`; kept in the data for the HTML

  // ---- Headline block ----
  wr(`*🎯 TOP 5 HEADLINES*`);
  if (headlines.length === 0) wr(`_No standout signals yesterday._`);
  else headlines.forEach((h, i) => wr(`  ${i + 1}. ${h}`));
  wr("");
  wr(`*🧭 SUMMARY*`);
  wr(`_${sumOverall}_`);
  wr("");
  wr(`*Worth investigating:*`);
  sumInvestigate.forEach((x) => wr(`  • ${x}`));
  wr("");
  wr(`*Keep an eye on (needs more days):*`);
  sumWatch.forEach((x) => wr(`  • ${x}`));
  wr("");
  wr("─".repeat(60));
  wr("");

  wr(`*📊 Futurestay Daily Growth Report* — ${new Date(d.generatedAt).toDateString()}`);
  wr(`Yesterday: *${yesterday}* (${dayOfWeek})`);

  // ---- 1. Baselines ----
  wr(`\n*1️⃣  Yesterday vs Baselines*`);
  wr("```");
  wr(`Metric              Yday   7d avg  Δ 7d      Last 4 ${dayOfWeek}s  Δ DoW`);
  wr("─".repeat(72));
  const bRow = (l: string, y: number, sev: number, dowV: number) => {
    const d7 = dpct(y, sev), dD = dpct(y, dowV);
    wr(`${l.padEnd(18)}  ${String(y).padStart(4)}   ${sev.toFixed(1).padStart(5)}  ${s(d7).padStart(5)} ${arr(d7)}   ${dowV.toFixed(1).padStart(5)}         ${s(dD).padStart(5)} ${arr(dD)}`);
  };
  bRow("Total signups", Y.signups, p7avg.signups, dowAvg.signups);
  bRow("Qualified", Y.qualified, p7avg.qualified, dowAvg.qualified);
  bRow("Airbnb auth", Y.auth, p7avg.auth, dowAvg.auth);
  bRow("Ready to Launch", Y.rtl, p7avg.rtl, dowAvg.rtl);
  bRow("Trials started", Ytr, p7trAvg, dowTrAvg);
  wr("```");

  if (earlierSameWeek.length > 0) {
    wr(`\n*Within-week* — Mon → ${dayOfWeek}:`);
    wr("```");
    wr(`Day                Signups  Qualified  Auth  RTL  Trials`);
    for (const w of sameWk) {
      wr(`  ${w.day} (${w.dowName})    ${String(w.m.signups).padStart(3)}    ${String(w.m.qualified).padStart(4)}    ${String(w.m.auth).padStart(3)}  ${String(w.m.rtl).padStart(3)}  ${String(w.ytr).padStart(3)}`);
    }
    wr(`  ${yesterday} (${dayOfWeek.slice(0, 3)}) ★    ${String(Y.signups).padStart(3)}    ${String(Y.qualified).padStart(4)}    ${String(Y.auth).padStart(3)}  ${String(Y.rtl).padStart(3)}  ${String(Ytr).padStart(3)}`);
    wr("```");
  }
  wr(`_Trials counted by trial-start date (dashboard KPI-tile definition: no lifecycle gate, partners excluded), so this is a complete count for the day. The funnel below counts trials from yesterday's signup cohort only (${Y.trials}), which is why it reads lower._`);

  // ---- 2. Funnel ----
  const pctQ = (n: number) => (Y.qualified ? (n / Y.qualified * 100).toFixed(1) + "%" : "-");
  wr(`\n*2️⃣  Funnel — Yesterday*`);
  wr("```");
  wr(`Total signups        ${Y.signups}   (${Y.dq} DQ'd → ${Y.qualified} qualified, DQ rate ${Y.signups ? (Y.dq / Y.signups * 100).toFixed(1) : 0}%)`);
  wr(`Qualified signups    ${Y.qualified}`);
  wr(`Airbnb authorized    ${Y.auth}   (${pctQ(Y.auth)} of qualified)`);
  wr(`Ready to Launch      ${Y.rtl}   (${pctQ(Y.rtl)} of qualified)`);
  wr(`Trials (from cohort) ${Y.trials}   (${pctQ(Y.trials)} of qualified; ${Ytr} trial-starts on the day on the KPI-tile basis)`);
  wr("```");

  // ---- 3. Top campaigns/creatives ----
  wr(`\n*3️⃣  Top Campaigns + Creatives*`);
  wr(`\n_Top 3 ad assets by RTL:_`);
  wr("```");
  Object.entries(rtlByAd).sort(([, a], [, b]) => b.n - a.n).slice(0, 3).forEach(([k, v], i) =>
    wr(`#${i + 1}  ${String(v.n).padStart(2)}  ${v.channel.padEnd(6)}  ${k.slice(0, 40).padEnd(40)}  ${v.camp.slice(0, 25)}`));
  wr("```");
  wr(`\n_Top 3 ad assets by Trial (from cohort):_`);
  wr("```");
  const trE = Object.entries(trialByAd).sort(([, a], [, b]) => b.n - a.n);
  if (trE.length === 0) wr(`(no trials attributed yet — cohort maturing)`);
  else trE.slice(0, 3).forEach(([k, v], i) =>
    wr(`#${i + 1}  ${String(v.n).padStart(2)}  ${v.channel.padEnd(6)}  ${k.slice(0, 40).padEnd(40)}  ${v.camp.slice(0, 25)}`));
  wr("```");
  wr(`\n_Top 3 campaigns by RTL:_`);
  wr("```");
  Object.entries(byCamp).sort(([, a], [, b]) => b.rtl - a.rtl).slice(0, 3).forEach(([k, v], i) =>
    wr(`#${i + 1}  RTL=${String(v.rtl).padStart(2)}  Trials=${String(v.trials).padStart(2)}  ${v.channel.padEnd(6)}  ${k}`));
  wr("```");

  // ---- 4. Spend + efficiency ----
  wr(`\n*4️⃣  Spend + Efficiency*`);
  wr("```");
  wr(`Meta spend yesterday: $${yestSpend.toFixed(0)}  (7d avg $${p7SpendAvg.toFixed(0)}, ${s(dpct(yestSpend, p7SpendAvg))})`);
  wr(`Blended CPS: $${Y.qualified ? (yestSpend / Y.qualified).toFixed(0) : "-"}   CPT: ${Ytr ? "$" + (yestSpend / Ytr).toFixed(0) : "n/a"}`);
  wr("");
  wr(`Top Meta campaigns by spend (yesterday):`);
  metaCampTop.forEach((r) => wr(`  $${r.spend.toFixed(0).padStart(5)}   ${(r.campaign_name || "").slice(0, 55)}`));
  wr("```");

  // ---- 5. New launches ----
  wr(`\n*5️⃣  New Launches (last 7d, with impressions)*`);
  if (newAds.length === 0) wr(`_None._`);
  else {
    wr("```");
    wr(`Created     Ad name                                       Impr    Spend`);
    newAds.slice(0, 6).forEach((r) => {
      wr(`${(r.created_time || "").slice(0, 10)}  ${(r.ad_name || "").slice(0, 42).padEnd(42)}  ${String(r.impressions).padStart(6)}  $${r.spend.toFixed(0).padStart(4)}`);
    });
    wr("```");
  }

  // ---- 6. Zombies ----
  wr(`\n*6️⃣  Zombie Ads — Worst 6* (≥10d old, $100+ spend, 0 trials in 14d)`);
  if (zombies.length === 0) wr(`✅ _None._`);
  else {
    wr("```");
    wr(`Ad name                                     Prev 7d  Last 7d   14d $    Age  Camp`);
    zombies.slice(0, 6).forEach((z) => {
      const ageDays = z.ageDays >= 0 ? String(z.ageDays) + "d" : "?d";
      wr(`${z.adName.slice(0, 42).padEnd(42)}  $${z.half1.toFixed(0).padStart(5)}   $${z.half2.toFixed(0).padStart(5)}  $${z.spend.toFixed(0).padStart(4)}  ${ageDays.padStart(4)}  ${z.camp.slice(0, 15)}`);
    });
    wr("```");
  }
  if (youngWatch.length > 0) {
    wr(`\n_Young-ad watchlist (<10d, $100+ spent, no trials yet)_:`);
    wr("```");
    youngWatch.slice(0, 4).forEach((z) => {
      const ageDays = z.ageDays >= 0 ? String(z.ageDays) + "d" : "?d";
      wr(`${z.adName.slice(0, 46).padEnd(46)}  $${z.spend.toFixed(0).padStart(5)}   ${ageDays}`);
    });
    wr("```");
  }

  // ---- 7. Demographics + Geo ----
  wr(`\n*7️⃣  Demographics + Geo*`);
  wr(`\n_Meta age mix by channel-family (impressions %):_`);
  wr("```");
  wr(`Channel                18-24  25-34  35-44  45-54  55-64  65+   Avg`);
  for (const [fam, ages] of Object.entries(chanAge)) {
    const total = Object.values(ages).reduce((s, v) => s + v, 0);
    if (total === 0) continue;
    let wSum = 0, wN = 0;
    for (const [a, i] of Object.entries(ages)) {
      const m = AGE_MID[a];
      if (m) { wSum += m * i; wN += i; }
    }
    const wAvg = wN ? wSum / wN : 0;
    const pcts = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((a) =>
      ((ages[a] || 0) / total * 100).toFixed(0).padStart(3) + "%");
    wr(`${fam.padEnd(22)} ${pcts.join("  ")}  ${wAvg.toFixed(1)}`);
  }
  wr("```");
  wr(`_Google Ads doesn't expose per-impression age — Meta only._`);

  wr(`\n_Qualified signups by country:_`);
  wr("```");
  wr(`Country              Yday   7d-avg/day   Δ`);
  const geoRows = Array.from(new Set([...Object.keys(geoY), ...Object.keys(geoP)]))
    .map((k) => ({ k, y: geoY[k] || 0, a: (geoP[k] || 0) / 7 }))
    .sort((a, b) => b.y - a.y).slice(0, 5);
  geoRows.forEach((r) => {
    wr(`  ${r.k.padEnd(18)}   ${String(r.y).padStart(3)}    ${r.a.toFixed(1).padStart(5)}      ${s(dpct(r.y, r.a))}`);
  });
  wr("```");

  // ---- 8. DQ ----
  wr(`\n*8️⃣  DQ Breakdown* — yesterday vs daily avg`);
  wr("```");
  wr(`Reason                          Yday   Daily avg    Δ`);
  dqRows.forEach((r) => {
    const y = dqY[r] || 0;
    const avgD = (dq7Total[r] || 0) / 7;
    const dP = dpct(y, avgD);
    const flag = Math.abs(dP) >= 50 && Math.abs(y - avgD) >= 1 ? (dP > 0 ? " 🔴" : " 🟢") : "";
    wr(`  ${r.slice(0, 30).padEnd(30)}  ${String(y).padStart(3)}    ${avgD.toFixed(1).padStart(4)}      ${s(dP).padStart(5)}${flag}`);
  });
  wr("```");

  // ---- 9. Sources ----
  wr(`\n*9️⃣  Source Insights*`);
  wr(`\n_Top sources yesterday:_`);
  wr("```");
  wr(`Source                    Signups  Qual  RTL  Trials  vs 7d-avg`);
  srcTop.forEach(([k, v]) => {
    const seven = (src14[k] || 0) / 14;
    const del = dpct(v.signups, seven);
    wr(`  ${k.slice(0, 24).padEnd(24)}  ${String(v.signups).padStart(4)}    ${String(v.qualified).padStart(3)}   ${String(v.rtl).padStart(2)}   ${String(v.trials).padStart(2)}    ${s(del).padStart(6)}`);
  });
  wr("```");
  void srcY;
  if (newSrc.length > 0) {
    wr(`\n🆕 *New sources* (not seen in prior 14 days):`);
    newSrc.forEach(([sr, v]) => wr(`  • \`${sr}\`: ${v.signups} signup(s), ${v.trials} trial(s)`));
  }
  if (bigJumps.length > 0) {
    wr(`\n📈 _Sources surging (>100% vs 14d-avg)_:`);
    bigJumps.forEach((r) => wr(`  • \`${r.k}\`: ${r.y} yday vs ${r.avg.toFixed(1)} (${s(dpct(r.y, r.avg))})`));
  }
  if (bigDrops.length > 0) {
    wr(`\n📉 _Sources dropping (>50% down vs 14d-avg)_:`);
    bigDrops.forEach((r) => wr(`  • \`${r.k}\`: ${r.y} yday vs ${r.avg.toFixed(1)} (${s(dpct(r.y, r.avg))})`));
  }

  return out.join("\n");
}

// ---------- HTML renderer -----------------------------------------------

const HTML_STYLE = `<style>
  :root{
    --ground:#F6F7FB;--card:#FFFFFF;--ink:#101728;--muted:#626C82;--faint:#E7EAF2;--faint2:#F0F2F8;
    --blue:#3963E7;--violet:#543CE8;--good:#109B57;--good-bg:#E6F5EE;--bad:#F05C61;--bad-bg:#FDECEC;
    --warn:#D98A00;--warn-bg:#FBF1DE;--grad:linear-gradient(90deg,#3963E7 0%,#543CE8 100%);
    --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
  .wrap{max-width:1120px;margin:0 auto;padding:40px 28px 72px}
  h1,h2,h3{margin:0;text-wrap:balance}
  .top{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;padding-bottom:20px;border-bottom:2px solid var(--ink)}
  .brand{display:flex;align-items:center;gap:12px}
  .dot{width:34px;height:34px;border-radius:9px;background:var(--grad);flex:none}
  .brand h1{font-size:23px;font-weight:800;letter-spacing:-.02em}
  .brand .sub{font-size:12px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase;font-weight:600}
  .datebox{text-align:right}
  .datebox .day{font-size:26px;font-weight:800;letter-spacing:-.02em}
  .datebox .meta{font-size:13px;color:var(--muted)}
  section{margin-top:38px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;display:flex;align-items:center;gap:10px}
  .eyebrow::after{content:"";flex:1;height:1px;background:var(--faint)}
  .headlines{background:var(--card);border:1px solid var(--faint);border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,23,40,.04)}
  .hl-head{padding:16px 22px;background:var(--ink);color:#fff;display:flex;align-items:center;gap:12px}
  .hl-head h2{font-size:15px;font-weight:700;letter-spacing:.02em}
  .hl-head .tag{margin-left:auto;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9AA6C4;font-weight:600}
  .hl-row{display:flex;align-items:flex-start;gap:14px;padding:15px 22px;border-top:1px solid var(--faint)}
  .hl-row:first-child{border-top:none}
  .hl-rank{font-family:var(--mono);font-size:13px;color:var(--muted);font-weight:600;min-width:20px}
  .hl-stripe{width:4px;align-self:stretch;border-radius:3px;flex:none}
  .hl-stripe.good{background:var(--good)}.hl-stripe.bad{background:var(--bad)}
  .hl-text{font-size:15px;font-weight:500}
  .sum-card{margin-top:14px}
  .sum-lead{font-size:15px;line-height:1.6;margin:0}
  .summary{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px;padding-top:18px;border-top:1px solid var(--faint)}
  .sum-box h4{font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 12px;display:flex;align-items:baseline;gap:8px}
  .sum-box h4 span{font-size:10px;letter-spacing:.02em;color:var(--muted);font-weight:600;text-transform:none}
  .sum-box.investigate h4{color:var(--bad)}
  .sum-box.watch h4{color:var(--blue)}
  .sum-box ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:11px}
  .sum-box li{font-size:13px;line-height:1.5;padding-left:18px;position:relative;color:var(--ink)}
  .sum-box li::before{content:"";position:absolute;left:2px;top:7px;width:7px;height:7px;border-radius:50%}
  .sum-box.investigate li::before{background:var(--bad)}
  .sum-box.watch li::before{background:var(--blue)}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
  .kpi{background:var(--card);border:1px solid var(--faint);border-radius:14px;padding:16px 16px 14px;box-shadow:0 1px 2px rgba(16,23,40,.04)}
  .kpi .lab{font-size:12px;color:var(--muted);font-weight:600}
  .kpi .num{font-size:38px;font-weight:800;letter-spacing:-.03em;line-height:1.05;margin:6px 0 10px}
  .chips{display:flex;flex-direction:column;gap:5px}
  .chip{display:flex;justify-content:space-between;align-items:center;font-size:11.5px}
  .chip .k{color:var(--muted)}
  .delta{font-weight:700;font-variant-numeric:tabular-nums}
  .delta.up{color:var(--good)}.delta.down{color:var(--bad)}.delta.flat{color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--faint);border-radius:14px;padding:20px 22px;box-shadow:0 1px 2px rgba(16,23,40,.04)}
  .card h3{font-size:15px;font-weight:700;margin-bottom:4px}
  .card .note{font-size:12px;color:var(--muted);margin-bottom:14px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .wk2-row{display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:center;padding:8px 0;border-top:1px solid var(--faint2)}
  .wk2-row:first-of-type{border-top:none}
  .wk2-row.star{background:linear-gradient(90deg,rgba(57,99,231,.06),transparent);border-radius:8px}
  .wk-day{font-size:12.5px;font-weight:600}
  .wk-day span{color:var(--muted);font-weight:500}
  .bar-track{height:22px;background:var(--faint2);border-radius:6px;overflow:hidden}
  .bar-fill{height:100%;border-radius:6px}
  .wk2-line{display:grid;grid-template-columns:1fr 22px;gap:8px;align-items:center;margin:3px 0}
  .wk2-line .bar-track{height:15px}
  .wk2-val{font-size:11.5px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
  .bar-fill.blue{background:linear-gradient(90deg,#3963E7,#6E8CEF)}
  .bar-fill.green{background:linear-gradient(90deg,#0E8A4D,#2FBF77)}
  .lg{display:inline-block;width:10px;height:10px;border-radius:3px;vertical-align:middle;margin-right:4px}
  .lg.blue{background:#3963E7}.lg.green{background:#109B57}
  .wk-legend{font-size:11px;color:var(--muted);margin-top:12px}
  .funnel{display:flex;flex-direction:column;gap:8px}
  .fn-row{display:grid;grid-template-columns:150px 1fr 132px;align-items:center;gap:14px}
  .fn-lab{font-size:13px;font-weight:600}
  .fn-lab span{display:block;font-size:11px;color:var(--muted);font-weight:500}
  .fn-bar{height:34px;border-radius:8px;background:var(--grad);display:flex;align-items:center;padding:0 14px;color:#fff;font-weight:800;font-size:15px;min-width:64px}
  .fn-bar.dim{opacity:.86}
  .fn-cmp{text-align:right}
  .fn-cmp b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}
  .fn-cmp span{display:block;font-size:10.5px;color:var(--muted)}
  .tbl-scroll{overflow-x:auto;margin:0 -4px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700;padding:0 12px 8px;border-bottom:1px solid var(--faint);white-space:nowrap}
  td{padding:9px 12px;border-bottom:1px solid var(--faint2);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .code{font-family:var(--mono);font-size:12px}
  .pill{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:20px}
  .pill.meta{color:var(--violet);background:#EEEBFD}
  .pill.google{color:#1667C9;background:#E4EFFD}
  .pill.other{color:var(--muted);background:var(--faint2)}
  .sev td:first-child{border-left:3px solid var(--bad)}
  .sev.warn td:first-child{border-left:3px solid var(--warn)}
  .agebar{display:flex;height:16px;border-radius:5px;overflow:hidden;min-width:150px}
  .agebar i{display:block;height:100%}
  .foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--faint);font-size:11.5px;color:var(--muted);line-height:1.7}
  .foot b{color:var(--ink)}
  @media(max-width:820px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .grid2,.summary{grid-template-columns:1fr}
    .wk2-row{grid-template-columns:60px 1fr}
    .fn-row{grid-template-columns:92px 1fr 92px}
    .datebox{text-align:left}
  }
</style>`;

function esc(x: unknown): string {
  return String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Renders the self-contained HTML report. Same visual template as the
 *  standalone script, driven off the same computed data. Return string is
 *  the full document body (no <html>/<head> wrapper — see the API route
 *  which supplies those). */
export function renderGrowthReportHtml(d: GrowthReportData): string {
  const {
    yesterday, dayOfWeek, dowShort, prettyDay, genDay,
    Y, p7avg, dowAvg, Ytr, p7trAvg, dowTrAvg,
    wkAll, r14, rtlByAd, trialByAd, byCamp,
    yestSpend, p7SpendAvg, metaCampTop, newAds,
    zombies, youngWatch, chanAge,
    dqY, dq7Total, dqRows,
    srcY, src14, srcTop, newSrc, bigJumps, bigDrops,
    top5, sumOverall, sumInvestigate, sumWatch,
  } = d;

  const dpct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
  const s = (p: number) => (p >= 0 ? "+" : "") + p.toFixed(0) + "%";
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const dcls = (pct: number, upGood = true) => (Math.abs(pct) < 10 ? "flat" : (pct >= 0) === upGood ? "up" : "down");
  const dspan = (pct: number, upGood = true) => `<span class="delta ${dcls(pct, upGood)}">${esc(s(pct))}</span>`;
  const chan = (c: string) => (c === "Meta" ? "meta" : c === "Google" ? "google" : "other");
  void srcY;
  void newSrc;

  // Within-week bars
  const wkMax = Math.max(1, ...wkAll.flatMap((w) => [w.trials, w.customers]));
  const wkRows = wkAll.map((w) => {
    const md = new Date(w.day + "T12:00:00Z");
    const mmdd = (md.getUTCMonth() + 1) + "/" + md.getUTCDate();
    const tw = (w.trials / wkMax * 100).toFixed(0);
    const cw = (w.customers / wkMax * 100).toFixed(0);
    return `<div class="wk2-row${w.star ? " star" : ""}">
      <div class="wk-day">${esc(w.label)} <span>${mmdd}${w.star ? " &#9733;" : ""}</span></div>
      <div>
        <div class="wk2-line"><div class="bar-track"><div class="bar-fill blue" style="width:${tw}%"></div></div><div class="wk2-val">${w.trials}</div></div>
        <div class="wk2-line"><div class="bar-track"><div class="bar-fill green" style="width:${cw}%"></div></div><div class="wk2-val">${w.customers}</div></div>
      </div>
    </div>`;
  }).join("");

  // Funnel bar widths
  const fnW = (n: number) => Math.max(9, Y.signups ? (n / Y.signups) * 100 : 0).toFixed(0);

  // Headlines
  const hlRows = top5.map((sig, i) => {
    const g = sig.dir === "good";
    return `<div class="hl-row"><div class="hl-rank">${i + 1}</div><div class="hl-stripe ${g ? "good" : "bad"}"></div>
      <div class="hl-text">${esc(sig.label)}</div></div>`;
  }).join("") || `<div class="hl-row"><div class="hl-text" style="color:var(--muted)">No standout signals yesterday.</div></div>`;

  const invItems = sumInvestigate.map((x) => `<li>${esc(x)}</li>`).join("");
  const watchItems = sumWatch.map((x) => `<li>${esc(x)}</li>`).join("");

  const rtlAdRows = Object.entries(rtlByAd).sort(([, a], [, b]) => b.n - a.n).slice(0, 3).map(([k, v]) =>
    `<tr><td class="code">${esc(k)}</td><td><span class="pill ${chan(v.channel)}">${esc(v.channel === "Other" ? (v.camp || "Other") : v.channel)}</span></td><td class="num">${v.n}</td><td class="num">${trialByAd[k]?.n || 0}</td></tr>`
  ).join("");
  const campRows = Object.entries(byCamp).sort(([, a], [, b]) => b.rtl - a.rtl).slice(0, 3).map(([k, v]) =>
    `<tr><td>${esc(k || "(direct)")}</td><td><span class="pill ${chan(v.channel)}">${esc(v.channel)}</span></td><td class="num">${v.rtl}</td><td class="num">${v.trials}</td></tr>`
  ).join("");
  const spendRows = metaCampTop.map((r) =>
    `<tr><td>${esc(r.campaign_name.replace(/ \| US & CA/g, " &middot;"))}</td><td class="num">${money(r.spend)}</td></tr>`
  ).join("");
  const launchRows = newAds.slice(0, 6).map((r) =>
    `<tr><td class="code">${esc((r.created_time || "").slice(0, 10))}</td><td class="code">${esc(r.ad_name || "")}</td><td class="num">${fmt(r.impressions)}</td><td class="num">${money(r.spend)}</td></tr>`
  ).join("") || `<tr><td colspan="4" style="color:var(--muted)">None in the last 7 days.</td></tr>`;

  const zMax = Math.max(1, ...zombies.slice(0, 6).map((z) => z.spend));
  const zombieRows = zombies.slice(0, 6).map((z) => {
    const age = z.ageDays >= 0 ? z.ageDays + "d" : "?";
    const sev = z.spend >= zMax * 0.75 ? "" : " warn";
    return `<tr class="sev${sev}"><td class="code">${esc(z.adName)}</td><td class="num">${money(z.half1)}</td><td class="num">${money(z.half2)}</td><td class="num">${money(z.spend)}</td><td class="num">${age}</td><td class="code">${esc((z.camp || "").replace(/ \| US & CA/g, " US &amp; CA").slice(0, 22))}</td></tr>`;
  }).join("") || `<tr><td colspan="6" style="color:var(--good)">None. No zombie ads yesterday.</td></tr>`;
  const watchStr = youngWatch.slice(0, 4).map((z) => {
    const age = z.ageDays >= 0 ? z.ageDays + "d" : "?";
    return `${esc(z.adName)} ${money(z.spend)} (${age})`;
  }).join(" &middot; ");

  const BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const BANDCOL = ["#C9D6FA", "#9DB4F5", "#6E8CEF", "#4E6BE9", "#3E51D9", "#543CE8"];
  const ageRows = Object.entries(chanAge).map(([fam, ages]) => {
    const total = Object.values(ages).reduce((a, b) => a + b, 0);
    if (!total) return "";
    let wSum = 0, wN = 0;
    for (const [a, i] of Object.entries(ages)) {
      const m = AGE_MID[a];
      if (m) { wSum += m * i; wN += i; }
    }
    const wAvg = wN ? wSum / wN : 0;
    const bars = BANDS.map((b, idx) =>
      `<i style="width:${((ages[b] || 0) / total * 100).toFixed(1)}%;background:${BANDCOL[idx]}"></i>`
    ).join("");
    return `<tr><td>${esc(fam.replace(/^Meta: /, ""))}</td><td><div class="agebar">${bars}</div></td><td class="num">${wAvg.toFixed(1)}</td></tr>`;
  }).filter(Boolean).join("");

  const dqHtmlRows = dqRows.map((r) => {
    const y = dqY[r] || 0;
    const avgD = (dq7Total[r] || 0) / 7;
    const dP = dpct(y, avgD);
    const label = r.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
    return `<tr><td>${esc(label)}</td><td class="num">${y}</td><td class="num">${avgD.toFixed(1)}</td><td class="num">${dspan(dP, false)}</td></tr>`;
  }).join("");

  const srcHtmlRows = srcTop.map(([k, v]) => {
    const del = dpct(v.signups, (src14[k] || 0) / 14);
    return `<tr><td>${esc(k)}</td><td class="num">${v.signups}</td><td class="num">${v.qualified}</td><td class="num">${v.rtl}</td><td class="num">${v.trials}</td><td class="num">${dspan(del, true)}</td></tr>`;
  }).join("");
  const srcNotes: string[] = [];
  newSrc.forEach(([sr, v]) => srcNotes.push(`<b style="color:var(--good)">New</b> ${esc(sr)}, first appearance in 14 days, ${v.signups} signups and ${v.trials} trials`));
  bigJumps.forEach((r) => srcNotes.push(`<b style="color:var(--good)">Surging</b> ${esc(r.k)} ${esc(s(dpct(r.y, r.avg)))}`));
  bigDrops.forEach((r) => srcNotes.push(`<b style="color:var(--bad)">Dropping</b> ${esc(r.k)} ${esc(s(dpct(r.y, r.avg)))}`));

  const kpi = (lab: string, num: number, extra: string, a7: number, dP7: number, aD: number, dPD: number) => `
    <div class="kpi"><div class="lab">${lab}${extra}</div><div class="num">${num}</div>
      <div class="chips">
        <div class="chip"><span class="k">vs 7d avg ${a7.toFixed(1)}</span>${dspan(dP7)}</div>
        <div class="chip"><span class="k">vs ${dowShort} ${aD.toFixed(1)}</span>${dspan(dPD)}</div>
      </div></div>`;

  // Yesterday's stage-conversion rates and the 14-day averages driven
  // by r14 from the computed data (see computeGrowthReport).
  const ry = {
    qual: Y.signups ? (Y.qualified / Y.signups) * 100 : 0,
    auth: Y.qualified ? (Y.auth / Y.qualified) * 100 : 0,
    rtl: Y.qualified ? (Y.rtl / Y.qualified) * 100 : 0,
    trials: Y.qualified ? (Y.trials / Y.qualified) * 100 : 0,
  };
  const fnCmp = (y: number, a: number) => {
    const dP = a ? ((y - a) / a * 100) : 0;
    const cls = Math.abs(dP) < 10 ? "flat" : dP >= 0 ? "up" : "down";
    return `<div class="fn-cmp"><b class="delta ${cls}">${y.toFixed(1)}%</b><span>14d ${a.toFixed(1)}%</span></div>`;
  };

  return `${HTML_STYLE}
<div class="wrap">
  <div class="top">
    <div class="brand"><div class="dot"></div>
      <div><h1>Futurestay Growth Report</h1><div class="sub">Daily Acquisition &amp; Funnel</div></div>
    </div>
    <div class="datebox"><div class="day">${esc(prettyDay)}</div>
      <div class="meta">Reporting day ${esc(yesterday)} &middot; Generated ${esc(genDay)} (ET)</div></div>
  </div>
  <section><div class="headlines">
    <div class="hl-head"><h2>Top Headlines</h2><span class="tag">Ranked by magnitude</span></div>
    ${hlRows}
  </div></section>
  <section>
    <div class="eyebrow">Summary</div>
    <div class="card sum-card">
      <p class="sum-lead">${esc(sumOverall)}</p>
      <div class="summary">
        <div class="sum-box investigate"><h4>Worth investigating</h4><ul>${invItems}</ul></div>
        <div class="sum-box watch"><h4>Keep an eye on <span>needs more days</span></h4><ul>${watchItems}</ul></div>
      </div>
    </div>
  </section>
  <section>
    <div class="eyebrow">Yesterday vs Baselines</div>
    <div class="kpis">
      ${kpi("Total signups", Y.signups, "", p7avg.signups, dpct(Y.signups, p7avg.signups), dowAvg.signups, dpct(Y.signups, dowAvg.signups))}
      ${kpi("Qualified", Y.qualified, "", p7avg.qualified, dpct(Y.qualified, p7avg.qualified), dowAvg.qualified, dpct(Y.qualified, dowAvg.qualified))}
      ${kpi("Airbnb auth", Y.auth, "", p7avg.auth, dpct(Y.auth, p7avg.auth), dowAvg.auth, dpct(Y.auth, dowAvg.auth))}
      ${kpi("Ready to Launch", Y.rtl, "", p7avg.rtl, dpct(Y.rtl, p7avg.rtl), dowAvg.rtl, dpct(Y.rtl, dowAvg.rtl))}
      ${kpi("Trials started", Ytr, "", p7trAvg, dpct(Ytr, p7trAvg), dowTrAvg, dpct(Ytr, dowTrAvg))}
    </div>
  </section>
  <section class="grid2">
    <div class="card"><h3>Within the week</h3><div class="note">Trials started and customers won each day, Monday through ${esc(dayOfWeek)}</div>
      ${wkRows}
      <div class="wk-legend"><span class="lg blue"></span>Trials started &middot; <span class="lg green"></span>Customers won &middot; counted by activity date, not signup date</div>
    </div>
    <div class="card"><h3>Funnel, yesterday</h3>
      <div class="note">Conversion at each stage, yesterday vs the 14 day average. Qualified is a share of signups; the rest are a share of qualified.</div>
      <div class="funnel">
        <div class="fn-row"><div class="fn-lab">Total signups</div><div class="fn-bar" style="width:100%">${Y.signups}</div><div class="fn-cmp"><span>${Y.dq} DQ, ${Y.signups ? (Y.dq / Y.signups * 100).toFixed(1) : 0}%</span></div></div>
        <div class="fn-row"><div class="fn-lab">Qualified</div><div class="fn-bar" style="width:${fnW(Y.qualified)}%">${Y.qualified}</div>${fnCmp(ry.qual, r14.qual)}</div>
        <div class="fn-row"><div class="fn-lab">Airbnb authorized</div><div class="fn-bar dim" style="width:${fnW(Y.auth)}%">${Y.auth}</div>${fnCmp(ry.auth, r14.auth)}</div>
        <div class="fn-row"><div class="fn-lab">Ready to launch</div><div class="fn-bar dim" style="width:${fnW(Y.rtl)}%">${Y.rtl}</div>${fnCmp(ry.rtl, r14.rtl)}</div>
        <div class="fn-row"><div class="fn-lab">Trials <span>from cohort</span></div><div class="fn-bar dim" style="width:${fnW(Y.trials)}%">${Y.trials}</div>${fnCmp(ry.trials, r14.trials)}</div>
      </div>
      <div class="wk-legend" style="margin-top:16px">This funnel counts trials from yesterday's signup cohort only (${Y.trials}), matching the dashboard funnel card. The headline Trials KPI above counts trial starts by activity date, the dashboard KPI-tile definition, which is why it reads ${Ytr}. Both are correct; they answer different questions.</div>
    </div>
  </section>
  <section class="grid2">
    <div class="card"><h3>Spend &amp; efficiency</h3>
      <div class="note">Meta spend ${money(yestSpend)}, ${dpct(yestSpend, p7SpendAvg) >= 0 ? "up" : "down"} ${Math.abs(dpct(yestSpend, p7SpendAvg)).toFixed(0)}% vs the 7 day average of ${money(p7SpendAvg)}</div>
      <div style="display:flex;gap:22px;margin-bottom:16px">
        <div><div class="lab" style="font-size:12px;color:var(--muted);font-weight:600">Blended CPS</div><div style="font-size:26px;font-weight:800;letter-spacing:-.02em">${Y.qualified ? money(yestSpend / Y.qualified) : "n/a"}</div></div>
        <div><div class="lab" style="font-size:12px;color:var(--muted);font-weight:600">Cost per trial</div><div style="font-size:26px;font-weight:800;letter-spacing:-.02em">${Ytr ? money(yestSpend / Ytr) : "n/a"}</div></div>
      </div>
      <div class="tbl-scroll"><table><thead><tr><th>Top Meta campaigns by spend</th><th class="num">Spend</th></tr></thead><tbody>${spendRows}</tbody></table></div>
    </div>
    <div class="card"><h3>Top creatives &amp; campaigns</h3><div class="note">Ranked by Ready to Launch, yesterday's cohort</div>
      <div class="tbl-scroll"><table><thead><tr><th>Ad asset</th><th></th><th class="num">RTL</th><th class="num">Trials</th></tr></thead><tbody>${rtlAdRows || `<tr><td colspan="4" style="color:var(--muted)">No RTL attribution yesterday.</td></tr>`}</tbody></table></div>
      <div class="tbl-scroll" style="margin-top:14px"><table><thead><tr><th>Campaign</th><th></th><th class="num">RTL</th><th class="num">Trials</th></tr></thead><tbody>${campRows}</tbody></table></div>
    </div>
  </section>
  <section>
    <div class="eyebrow">New Launches, last 7 days</div>
    <div class="card"><div class="tbl-scroll"><table><thead><tr><th>Created</th><th>Ad name</th><th class="num">Impressions</th><th class="num">Spend</th></tr></thead><tbody>${launchRows}</tbody></table></div></div>
  </section>
  <section>
    <div class="eyebrow">Zombie Ads, worst 6</div>
    <div class="card"><div class="note">10+ days old, $100+ spend, zero attributed trials in 14 days. Severity by 14 day burn.</div>
      <div class="tbl-scroll"><table><thead><tr><th>Ad name</th><th class="num">Prev 7d</th><th class="num">Last 7d</th><th class="num">14d spend</th><th class="num">Age</th><th>Campaign</th></tr></thead><tbody>${zombieRows}</tbody></table></div>
      ${watchStr ? `<div class="wk-legend" style="margin-top:14px"><b style="color:var(--warn)">Watchlist</b>, under 10 days old, $100+ spent, no trials yet: ${watchStr}</div>` : ""}
    </div>
  </section>
  <section class="grid2">
    <div class="card"><h3>Meta age mix by channel family</h3><div class="note">Share of impressions. Weighted average age at right.</div>
      <div class="tbl-scroll"><table><thead><tr><th>Channel</th><th>Distribution (18 to 65+)</th><th class="num">Avg</th></tr></thead><tbody>${ageRows || `<tr><td colspan="3" style="color:var(--muted)">No Meta impressions yesterday.</td></tr>`}</tbody></table></div>
      <div class="wk-legend" style="margin-top:12px">Bands light to dark: 18-24, 25-34, 35-44, 45-54, 55-64, 65+. Google does not expose per impression age.</div>
    </div>
    <div class="card"><h3>Disqualification reasons</h3><div class="note">Yesterday vs daily average over the prior 7 days</div>
      <div class="tbl-scroll"><table><thead><tr><th>Reason</th><th class="num">Yday</th><th class="num">Daily avg</th><th class="num">&Delta;</th></tr></thead><tbody>${dqHtmlRows || `<tr><td colspan="4" style="color:var(--good)">No disqualifications yesterday.</td></tr>`}</tbody></table></div>
    </div>
  </section>
  <section>
    <div class="card"><h3>Source insights</h3><div class="note">Top sources yesterday, with signups, quality and movement</div>
      <div class="tbl-scroll"><table><thead><tr><th>Source</th><th class="num">Signups</th><th class="num">Qual</th><th class="num">RTL</th><th class="num">Trials</th><th class="num">vs 7d</th></tr></thead><tbody>${srcHtmlRows}</tbody></table></div>
      ${srcNotes.length ? `<div class="wk-legend" style="margin-top:12px">${srcNotes.join(" &middot; ")}</div>` : ""}
    </div>
  </section>
  <div class="foot">
    <b>Definitions.</b> Qualified: signup with no Airbnb DQ reason. Headline trials are counted by trial-start date with no lifecycle gate (dashboard KPI-tile definition), so the day's figure is complete. The funnel counts trials from the day's signup cohort only, matching the dashboard funnel card. Baselines: 7 day rolling average and the last 4 same weekday values. All day bucketing in America/New_York.<br>
    <b>Sources.</b> HubSpot contacts and first touch attribution, Meta Marketing API insights, Google Ads ad group data. Channel attribution via the dashboard's campaign matching helpers.
  </div>
</div>`;
}
