import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { fetchMetaInsights, fetchMetaAdDaily } from "@/lib/meta";
import { fetchRecentGoogleAdGroups } from "@/lib/google";
import { matchContactToMetaCampaign, matchContactToGoogleAdGroup } from "@/lib/campaigns";
import { isSignup, hasDQ, isReadyToLaunch, isPartnerReferral, isTestContact } from "@/lib/funnel";
import { tzDateKey, tzStartOfDay, tzAddDays } from "@/lib/timezone";
import type { HubSpotContact } from "@/lib/types";

/**
 * Ad Health — one endpoint, both windows, all downstream lists computed.
 *
 *   GET /api/ad-health
 *
 * Two cards consume this: AdHealthSignalsCard (Actions/Winners/Dying)
 * and AdHealthDetailCard (Campaigns and Ad Assets tables). The signal
 * lists are deterministic once the numbers are computed, so we compute
 * them server-side to keep the cards dumb and consistent.
 *
 * Windows: yesterday-ET is the `until` for both.
 *   d14 = last 14 days ending yesterday
 *   d7  = last 7  days ending yesterday
 * Today is excluded so the numbers reflect complete days only.
 *
 * Cache: 5 minutes keyed by "today-ET" so multiple dashboard views
 * within a few minutes reuse the compute. The heaviest cost is the
 * Meta Graph pagination (14 days × ~150 ads = ~1s).
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WindowMetrics = { qualified: number; rtl: number; trials: number };
type Channel = "Meta" | "Google" | "Organic" | "Paid-Other";
type AssetChannel = "Meta" | "Google" | "Other";
type Rule = "A" | "B" | "C" | "X" | "Y" | "Z";

interface AdHealthData {
  since14d: string; until14d: string;
  since7d: string;  until7d: string;
  campaigns: Array<{ key: string; channel: Channel; d14: WindowMetrics; d7: WindowMetrics }>;
  adAssets: Array<{ key: string; channel: AssetChannel; campaign: string; ageDays: number | null; d14: WindowMetrics; d7: WindowMetrics; spend14d: number }>;
  winners: Array<{ key: string; channel: AssetChannel; campaign: string; d7: WindowMetrics; ageDays: number | null; rule: "A" | "B" | "C"; action: string }>;
  dying: Array<{ key: string; channel: AssetChannel; campaign: string; d14: WindowMetrics; ageDays: number | null; spend14d: number; rule: "X" | "Y" | "Z"; action: string }>;
  actions: Array<{ priority: "High" | "Medium" | "Low"; text: string; why: string }>;
  wastedSpend14d: number;
}

let cache: { key: string; data: AdHealthData; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function empty(): WindowMetrics { return { qualified: 0, rtl: 0, trials: 0 }; }
function shortAd(x: string): string {
  if (!x) return "(no utm_content)";
  return x.replace(/^\d+\.\d+ \| /, "").replace(/ \| LP - [^|]+$/, "");
}
function shortCamp(x: string): string {
  return (x || "").replace(/ \| US & CA/, "").replace(/ \| Campaign$/, "").slice(0, 60);
}

function classify(c: HubSpotContact, activeMeta: string[], ga: Awaited<ReturnType<typeof fetchRecentGoogleAdGroups>>): {
  channel: Channel; assetChannel: AssetChannel; campaign: string; adKey: string | null;
} {
  const m = matchContactToMetaCampaign(c, activeMeta);
  if (m) {
    const ad = (c.first_touch_utm_content || "").trim();
    return {
      channel: "Meta", assetChannel: "Meta",
      campaign: shortCamp(m),
      adKey: ad ? shortAd(ad) : null,
    };
  }
  const g = matchContactToGoogleAdGroup(c, ga);
  if (g) {
    // Google ad key: prefer hsa_ad URL param (Search), fall back to
    // utm_content (Pmax asset id).
    let ad: string | null = null;
    const url = c.hs_analytics_first_url || "";
    if (url) {
      try {
        const v = new URL(url).searchParams.get("hsa_ad");
        if (v && v.trim()) ad = v.trim();
      } catch { /* skip */ }
    }
    if (!ad) {
      const utm = (c.first_touch_utm_content || "").trim();
      if (utm) ad = utm;
    }
    return { channel: "Google", assetChannel: "Google", campaign: g, adKey: ad };
  }
  const src = (c.first_touch_utm_source || "").toLowerCase().trim();
  const medium = (c.first_touch_utm_medium || "").toLowerCase().trim();
  const isPaidOther = medium.includes("paid");
  const channel: Channel = src ? (isPaidOther ? "Paid-Other" : "Organic") : "Organic";
  return { channel, assetChannel: "Other", campaign: src || "direct", adKey: null };
}

async function computeAdHealth(): Promise<AdHealthData> {
  // Window keys — ET, excluding today. Yesterday-ET is `until`.
  const nowEt = tzStartOfDay(new Date());
  const untilEt = tzAddDays(nowEt, -1);
  const until14dKey = tzDateKey(untilEt);
  const since14dEt = tzAddDays(untilEt, -13);
  const since7dEt = tzAddDays(untilEt, -6);
  const since14dKey = tzDateKey(since14dEt);
  const since7dKey = tzDateKey(since7dEt);
  const in14d = new Set<string>();
  const in7d = new Set<string>();
  for (let i = 0; i < 14; i++) in14d.add(tzDateKey(tzAddDays(since14dEt, i)));
  for (let i = 0; i < 7; i++) in7d.add(tzDateKey(tzAddDays(since7dEt, i)));

  const [contacts, mi, ga, metaAdDaily] = await Promise.all([
    fetchAllContacts(),
    fetchMetaInsights("2024-01-01", tzDateKey(new Date())).catch(() => ({ campaigns: [] as { name: string }[] })),
    fetchRecentGoogleAdGroups(6).catch(() => [] as Awaited<ReturnType<typeof fetchRecentGoogleAdGroups>>),
    fetchMetaAdDaily(since14dKey, until14dKey).catch(() => [] as Awaited<ReturnType<typeof fetchMetaAdDaily>>),
  ]);
  const activeMeta = mi.campaigns.map((m) => m.name);

  // Meta ad-level: build spend14d by ad name + a rough age proxy
  // (earliest date_start we see in the 90-day window). fetchMetaAdDaily
  // returns per (date, ad) rows — sum spend, track earliest date.
  const spend14d = new Map<string, number>();
  const earliestDate = new Map<string, string>();
  for (const r of metaAdDaily) {
    if (!r.ad_name || !r.date) continue;
    spend14d.set(r.ad_name, (spend14d.get(r.ad_name) || 0) + r.spend);
    const cur = earliestDate.get(r.ad_name);
    if (!cur || r.date < cur) earliestDate.set(r.ad_name, r.date);
  }
  // Age in days from the earliest observation. If an ad's earliest
  // date is more than 13 days before yesterday, it definitely existed
  // ≥ 14 days ago (upper bound; real created_time would give a tighter
  // number, but we don't need pinpoint precision for the Dying rules).
  const nowMs = Date.now();
  function ageFor(adName: string): number | null {
    const d = earliestDate.get(adName);
    if (!d) return null;
    return Math.max(0, Math.round((nowMs - new Date(d + "T12:00:00Z").getTime()) / 86_400_000));
  }

  // Contact-level attribution + per-window bump.
  const campKey = (channel: Channel, camp: string) => `${channel}::${camp}`;
  const campaignsMap = new Map<string, { channel: Channel; campaign: string; d14: WindowMetrics; d7: WindowMetrics }>();
  const assetKey = (channel: AssetChannel, camp: string, ad: string) => `${channel}::${camp}::${ad}`;
  const assetsMap = new Map<string, { channel: AssetChannel; campaign: string; ad: string; d14: WindowMetrics; d7: WindowMetrics }>();

  for (const c of contacts) {
    if (isPartnerReferral(c) || isTestContact(c)) continue;
    const cd = c.createdate ? tzDateKey(c.createdate) : null;
    const td = (c.hs_v2_date_entered_opportunity || c.trial__start_date);
    const tdKey = td ? tzDateKey(td) : null;
    const inCreate14 = cd ? in14d.has(cd) : false;
    const inCreate7 = cd ? in7d.has(cd) : false;
    const inTrial14 = tdKey ? in14d.has(tdKey) : false;
    const inTrial7 = tdKey ? in7d.has(tdKey) : false;
    if (!inCreate14 && !inCreate7 && !inTrial14 && !inTrial7) continue;

    const { channel, assetChannel, campaign, adKey } = classify(c, activeMeta, ga);
    const isQ = isSignup(c) && !hasDQ(c);
    const isR = isQ && isReadyToLaunch(c);

    // Campaign roll-up
    const ck = campKey(channel, campaign);
    let cRow = campaignsMap.get(ck);
    if (!cRow) {
      cRow = { channel, campaign, d14: empty(), d7: empty() };
      campaignsMap.set(ck, cRow);
    }
    if (isQ && inCreate14) cRow.d14.qualified++;
    if (isQ && inCreate7) cRow.d7.qualified++;
    if (isR && inCreate14) cRow.d14.rtl++;
    if (isR && inCreate7) cRow.d7.rtl++;
    if (inTrial14) cRow.d14.trials++;
    if (inTrial7) cRow.d7.trials++;

    // Ad-asset roll-up (only when we have an ad key)
    if (adKey) {
      const ak = assetKey(assetChannel, campaign, adKey);
      let aRow = assetsMap.get(ak);
      if (!aRow) {
        aRow = { channel: assetChannel, campaign, ad: adKey, d14: empty(), d7: empty() };
        assetsMap.set(ak, aRow);
      }
      if (isQ && inCreate14) aRow.d14.qualified++;
      if (isQ && inCreate7) aRow.d7.qualified++;
      if (isR && inCreate14) aRow.d14.rtl++;
      if (isR && inCreate7) aRow.d7.rtl++;
      if (inTrial14) aRow.d14.trials++;
      if (inTrial7) aRow.d7.trials++;
    }
  }

  // Turn into arrays, filter to entries with d14.rtl >= 3, sort by d14.rtl desc.
  const campaigns = Array.from(campaignsMap.values())
    .filter((c) => c.d14.rtl >= 3)
    .map((c) => ({ key: c.campaign, channel: c.channel, d14: c.d14, d7: c.d7 }))
    .sort((a, b) => b.d14.rtl - a.d14.rtl);

  const adAssets = Array.from(assetsMap.values())
    .filter((a) => a.d14.rtl >= 3)
    .map((a) => ({
      key: a.ad,
      channel: a.channel,
      campaign: a.campaign,
      ageDays: a.channel === "Meta" ? ageFor(a.ad) : null,
      d14: a.d14, d7: a.d7,
      spend14d: a.channel === "Meta" ? (spend14d.get(a.ad) || 0) : 0,
    }))
    .sort((a, b) => b.d14.rtl - a.d14.rtl);

  // Winners — per ad asset, first matching rule wins.
  const winners: AdHealthData["winners"] = [];
  for (const a of adAssets) {
    const r14 = a.d14.rtl > 0 ? a.d14.trials / a.d14.rtl : 0;
    const r7  = a.d7.rtl  > 0 ? a.d7.trials  / a.d7.rtl  : 0;
    let rule: "A" | "B" | "C" | null = null;
    if (r14 >= 0.40 && a.d14.trials >= 3) rule = "A";
    else if (r7 >= 0.50 && a.d7.trials >= 2) rule = "B";
    else if (a.d7.rtl >= 3 && (r7 - r14) >= 0.05) rule = "C";
    if (rule) {
      winners.push({
        key: a.key, channel: a.channel, campaign: a.campaign,
        d7: a.d7, ageDays: a.ageDays, rule,
        action: "Scale budget on this creative",
      });
    }
  }

  // Dying — per ad asset, requires d14.rtl >= 3 AND age >= 10 (or null).
  const dying: AdHealthData["dying"] = [];
  for (const a of adAssets) {
    if (!(a.ageDays === null || a.ageDays >= 10)) continue;
    const r14 = a.d14.rtl > 0 ? a.d14.trials / a.d14.rtl : 0;
    const r7  = a.d7.rtl  > 0 ? a.d7.trials  / a.d7.rtl  : 0;
    let rule: "X" | "Y" | "Z" | null = null;
    if (a.d14.trials === 0) rule = "X";
    else if (r14 <= 0.05) rule = "Y";
    else if (a.d7.rtl >= 3 && (r14 - r7) >= 0.15 && r7 < 0.15) rule = "Z";
    if (rule) {
      dying.push({
        key: a.key, channel: a.channel, campaign: a.campaign,
        d14: a.d14, ageDays: a.ageDays,
        spend14d: a.spend14d, rule,
        action: "Pause or refresh",
      });
    }
  }

  const wastedSpend14d = dying.reduce((s, d) => s + d.spend14d, 0);

  // Actions — generated + ranked. Numeric magnitude for tie-break.
  type Ranked = { priority: "High" | "Medium" | "Low"; text: string; why: string; magnitude: number };
  const actionsRaw: Ranked[] = [];

  for (const d of dying) {
    const priority: "High" | "Medium" | "Low" =
      d.spend14d >= 1000 ? "High" : d.spend14d >= 300 ? "Medium" : "Low";
    const r14 = d.d14.rtl > 0 ? d.d14.trials / d.d14.rtl : 0;
    actionsRaw.push({
      priority,
      text: `Pause or refresh: ${d.key}`,
      why: `Rule ${d.rule}: ${d.d14.rtl} RTLs, ${d.d14.trials} trials over 14d (${(r14 * 100).toFixed(0)}%). Spent $${Math.round(d.spend14d)}.`,
      magnitude: d.spend14d,
    });
  }
  for (const w of winners) {
    const pct = w.d7.rtl > 0 ? (w.d7.trials / w.d7.rtl) * 100 : 0;
    actionsRaw.push({
      priority: "Medium",
      text: `Scale budget on ${w.key}`,
      why: `Rule ${w.rule}: converting at ${pct.toFixed(0)}% RTL→Trial in 7d.`,
      magnitude: w.d7.rtl + w.d7.trials * 3,
    });
  }
  // High-priority Meta-saturation rollup
  const metaCampaigns = campaigns.filter((c) => c.channel === "Meta");
  const totalMetaRtl14 = metaCampaigns.reduce((s, c) => s + c.d14.rtl, 0);
  for (const c of metaCampaigns) {
    if (totalMetaRtl14 === 0) break;
    const share = c.d14.rtl / totalMetaRtl14;
    const rate = c.d14.rtl > 0 ? c.d14.trials / c.d14.rtl : 0;
    if (share >= 0.30 && rate < 0.20) {
      actionsRaw.push({
        priority: "High",
        text: `Investigate ${c.key} — ${(share * 100).toFixed(0)}% of Meta RTLs converting at ${(rate * 100).toFixed(0)}%. Likely audience saturation from over-scaled spend.`,
        why: `Meta campaign ${c.key}: ${c.d14.rtl} RTLs over 14d, ${c.d14.trials} trials.`,
        magnitude: c.d14.rtl * 100,
      });
    }
  }
  if (wastedSpend14d >= 5000) {
    actionsRaw.push({
      priority: "High",
      text: `Reallocate $${Math.round(wastedSpend14d)} going to dying ads — 0 trials produced in 14d.`,
      why: `Sum of Dying ad spend14d.`,
      magnitude: wastedSpend14d,
    });
  }
  const pri = { High: 0, Medium: 1, Low: 2 };
  actionsRaw.sort((a, b) => pri[a.priority] - pri[b.priority] || b.magnitude - a.magnitude);
  const actions = actionsRaw.map(({ priority, text, why }) => ({ priority, text, why }));

  return {
    since14d: since14dKey, until14d: until14dKey,
    since7d: since7dKey, until7d: until14dKey,
    campaigns, adAssets, winners, dying, actions, wastedSpend14d,
  };
}

export async function GET() {
  try {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }
    const data = await computeAdHealth();
    cache = { key, data, at: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    console.error("[/api/ad-health] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
