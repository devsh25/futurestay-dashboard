import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { fetchMetaInsights } from "@/lib/meta";
import { fetchRecentGoogleAdGroups } from "@/lib/google";
import {
  matchContactToMetaCampaign, matchContactToGoogleAdGroup,
} from "@/lib/campaigns";
import {
  isSignup, hasDQ, isReadyToLaunch, isPartnerReferral, isTestContact,
} from "@/lib/funnel";
import { tzDateKey } from "@/lib/timezone";
import type { HubSpotContact } from "@/lib/types";

/**
 * RTL → Trial conversion timeseries by ad asset.
 *
 *   GET /api/rtl-trial-conversion
 *
 * For each of the top 7 ad assets by RTL volume (last 90 days), returns
 * daily counts of RTL and Trial contacts attributed to that asset. The
 * chart component computes conversion % per bucket client-side and
 * offers daily / weekly / monthly aggregation via a toggle.
 *
 * Attribution rules exactly match the rest of the dashboard:
 *   Meta ads:   (utm_campaign, utm_content) → (campaign_name, ad_name)
 *   Google:    hsa_ad URL param first, then utm_content (Pmax asset id)
 *
 * Contacts are counted:
 *   - RTL:    bucketed by createdate. isRTL + isSignup + !hasDQ.
 *   - Trial:  bucketed by trial-entry date. Same asset attribution.
 * The "cohort" question this chart answers is "for RTLs from this day,
 * how many of them are converting to trials?" but by activity date on
 * both stages, so recent days don't undercount because trials keep
 * arriving in the trial-date bucket regardless of when signup happened.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Same convention lib/growth-report.ts uses for its ad-asset short name.
function shortAd(x: string): string {
  if (!x) return "(no utm_content)";
  return x.replace(/^\d+\.\d+ \| /, "").replace(/ \| LP - [^|]+$/, "");
}
function shortCamp(x: string): string {
  return (x || "").replace(/ \| US & CA/, "").replace(/ \| Campaign$/, "").slice(0, 32);
}

function metaAssetOf(c: HubSpotContact): { key: string; channel: "Meta"; campaign: string } | null {
  const src = (c.first_touch_utm_source || "").toLowerCase();
  if (src !== "facebook" && src !== "meta") return null;
  const ad = (c.first_touch_utm_content || "").trim();
  const camp = (c.first_touch_utm_campaign || "").trim();
  if (!ad || !camp) return null;
  return { key: shortAd(ad), channel: "Meta", campaign: shortCamp(camp) };
}
function googleAssetOf(c: HubSpotContact, googleAdGroupLabelOf: (c: HubSpotContact) => string | null): { key: string; channel: "Google"; campaign: string } | null {
  const src = (c.first_touch_utm_source || "").toLowerCase();
  if (src !== "google") return null;
  const url = c.hs_analytics_first_url || "";
  let key = "";
  if (url) {
    try {
      const v = new URL(url).searchParams.get("hsa_ad");
      if (v) key = v.trim();
    } catch { /* skip */ }
  }
  if (!key) key = (c.first_touch_utm_content || "").trim();
  if (!key) return null;
  const camp = googleAdGroupLabelOf(c) || "(google)";
  return { key, channel: "Google", campaign: camp };
}

interface AssetSeries {
  key: string;                    // display label for the dropdown + line
  channel: "Meta" | "Google";
  campaign: string;
  dailyRtl: number[];             // aligned to `days`
  dailyTrials: number[];
  totalRtl: number;               // used for the top-7 rank
  totalTrials: number;
}

export async function GET() {
  try {
    // 90-day window ending today ET so lines have enough history for
    // meaningful daily/weekly/monthly bucketing.
    const nowMs = Date.now();
    const daysBack = 90;
    const days: string[] = [];
    for (let i = daysBack; i >= 0; i--) {
      days.push(tzDateKey(new Date(nowMs - i * 86_400_000)));
    }
    const dayIndex = new Map(days.map((d, i) => [d, i] as const));

    const [contacts, mi, ga] = await Promise.all([
      fetchAllContacts(),
      fetchMetaInsights("2024-01-01", tzDateKey(new Date())).catch(() => ({ campaigns: [] as { name: string }[] })),
      fetchRecentGoogleAdGroups(6).catch(() => [] as Awaited<ReturnType<typeof fetchRecentGoogleAdGroups>>),
    ]);
    const activeMeta = mi.campaigns.map((m) => m.name);
    const googleLabelOf = (c: HubSpotContact) => matchContactToGoogleAdGroup(c, ga);
    void matchContactToMetaCampaign;   // reserved for future refinement of Meta campaign labels

    const byKey = new Map<string, AssetSeries>();
    function seed(key: string, channel: "Meta" | "Google", campaign: string): AssetSeries {
      let s = byKey.get(key);
      if (!s) {
        s = {
          key, channel, campaign,
          dailyRtl: new Array(days.length).fill(0),
          dailyTrials: new Array(days.length).fill(0),
          totalRtl: 0, totalTrials: 0,
        };
        byKey.set(key, s);
      }
      return s;
    }

    for (const c of contacts) {
      if (isPartnerReferral(c) || isTestContact(c)) continue;

      const asset = metaAssetOf(c) || googleAssetOf(c, googleLabelOf);
      if (!asset) continue;
      const s = seed(asset.key, asset.channel, asset.campaign);

      // RTL bucket — createdate. Requires signup lifecycle, no DQ,
      // property_ready_to_launch=true.
      if (c.createdate && isSignup(c) && !hasDQ(c) && isReadyToLaunch(c)) {
        const key = tzDateKey(c.createdate);
        const i = dayIndex.get(key);
        if (i !== undefined) {
          s.dailyRtl[i]++;
          s.totalRtl++;
        }
      }
      // Trial bucket — trial-entry date (v2 first, fallback trial_start_date).
      const tDate = c.hs_v2_date_entered_opportunity || c.trial__start_date;
      if (tDate) {
        const key = tzDateKey(tDate);
        const i = dayIndex.get(key);
        if (i !== undefined) {
          s.dailyTrials[i]++;
          s.totalTrials++;
        }
      }
      // Google campaign labels are populated after seed so late-arriving
      // labels don't matter — we only used `asset.campaign` at seed time.
      void activeMeta;
    }

    // Rank by total RTL desc, keep top 7 that actually have any RTL.
    // Assets with zero RTL over 90 days would leave a flat-zero line;
    // trimming keeps the chart legible.
    const top = Array.from(byKey.values())
      .filter((s) => s.totalRtl > 0)
      .sort((a, b) => b.totalRtl - a.totalRtl)
      .slice(0, 7);

    return NextResponse.json({ days, assets: top });
  } catch (err) {
    console.error("[/api/rtl-trial-conversion] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error", days: [], assets: [] },
      { status: 500 },
    );
  }
}
