import { NextRequest, NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { fetchMetaInsights, fetchMetaAdDaily } from "@/lib/meta";
import { fetchRecentGoogleAdGroups, fetchGoogleAdsAdGroupInsights } from "@/lib/google";
import { matchContactToMetaCampaign, matchContactToGoogleAdGroup } from "@/lib/campaigns";
import {
  isSignup, hasDQ, isReadyToLaunch, everBecameRealCustomer,
  isPartnerReferral, isTestContact, resolvedDateRange,
} from "@/lib/funnel";
import type { HubSpotContact, PeriodFilter } from "@/lib/types";

/**
 * RTL Campaign Analysis — per campaign + per ad asset breakdown for
 * the selected dashboard window.
 *
 *   GET /api/rtl-campaign-analysis?period=custom&start=...&end=...
 *
 * Returns one row per campaign (Meta or Google), with a nested
 * adAssets[] list of the individual creatives / ad groups under it.
 * The card renders campaigns collapsed by default and expands to
 * show the assets on click.
 *
 * Attribution goes through the canonical dashboard helpers so numbers
 * cannot drift from Campaign Analysis / Ad Health. Partner + test
 * contacts excluded. `everBecameRealCustomer` used for the Customer
 * count (paid Amplify/Flex, excludes <2-day quick cancels).
 *
 * Ad-asset spend:
 *   Meta   — from fetchMetaAdDaily summed over the window, keyed by
 *            (campaign_name, ad_name).
 *   Google — from ad-group-level insights (fetchGoogleAdsAdGroupInsights)
 *            since Google Ads doesn't expose per-ad spend uniformly
 *            (Pmax has asset groups, not ads).
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Platform = "Meta" | "Google";

interface AdAssetRow {
  key: string;              // ad asset display name
  platform: Platform;
  spend: number;
  rtl: number;
  trials: number;
  customers: number;
}
interface CampaignRow {
  campaign: string;
  platform: Platform;
  spend: number;
  rtl: number;
  trials: number;
  customers: number;
  adAssets: AdAssetRow[];
}
interface Response {
  since: string;
  until: string;
  rows: CampaignRow[];
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function shortAd(x: string): string {
  if (!x) return "(no utm_content)";
  return x.replace(/^\d+\.\d+ \| /, "").replace(/ \| LP - [^|]+$/, "");
}

interface Bucket { rtl: number; trials: number; customers: number }
function emptyBucket(): Bucket { return { rtl: 0, trials: 0, customers: 0 }; }

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const period = (params.get("period") || "allTime") as PeriodFilter;
    const customStart = params.get("start") || undefined;
    const customEnd = params.get("end") || undefined;

    let since: string, until: string;
    if (period === "custom" && customStart && customEnd) {
      since = customStart; until = customEnd;
    } else {
      const { start, end } = resolvedDateRange(period);
      since = ymd(start); until = ymd(end);
    }
    const startDate = new Date(`${since}T00:00:00.000Z`);
    const endDate = new Date(`${until}T23:59:59.999Z`);
    const inWindow = (d: string | null | undefined): boolean => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= startDate.getTime() && t <= endDate.getTime();
    };

    const [contacts, mi, ga, metaAdDaily, gaInsights] = await Promise.all([
      fetchAllContacts(),
      fetchMetaInsights(since, until).catch(() => ({
        campaigns: [] as { name: string; spend: number }[],
      } as { campaigns: { name: string; spend: number }[] })),
      fetchRecentGoogleAdGroups(6).catch(() => [] as Awaited<ReturnType<typeof fetchRecentGoogleAdGroups>>),
      fetchMetaAdDaily(since, until).catch(() => [] as Awaited<ReturnType<typeof fetchMetaAdDaily>>),
      fetchGoogleAdsAdGroupInsights(since, until).catch(() => [] as Awaited<ReturnType<typeof fetchGoogleAdsAdGroupInsights>>),
    ]);
    const activeMeta = mi.campaigns.map((m) => m.name);

    // Meta campaign spend map (name → $)
    const metaCampSpend = new Map<string, number>();
    for (const c of mi.campaigns) metaCampSpend.set(c.name, c.spend);

    // Meta ad spend by (campaign, ad name)
    const metaAdSpend = new Map<string, number>();
    for (const r of metaAdDaily) {
      if (!r.campaign_name || !r.ad_name) continue;
      const key = `${r.campaign_name}::${r.ad_name}`;
      metaAdSpend.set(key, (metaAdSpend.get(key) || 0) + r.spend);
    }

    // Google spend maps
    const googleGroupSpend = new Map<string, number>();     // label → $ (ad-group / Pmax rollup)
    const googleCampSpend = new Map<string, number>();      // campaignName → $
    for (const r of gaInsights) {
      googleGroupSpend.set(r.label, (googleGroupSpend.get(r.label) || 0) + r.cost);
      // For campaign totals, sum across ad-groups sharing the same campaign name.
      googleCampSpend.set(r.campaignName, (googleCampSpend.get(r.campaignName) || 0) + r.cost);
    }
    // Also seed roster-only groups with 0 so paused-with-no-spend ones surface if attribution hits them
    for (const g of ga) if (!googleGroupSpend.has(g.label)) googleGroupSpend.set(g.label, 0);

    // Per-campaign roll-up. Key: campaign name (Meta) or campaignName from
    // the ad-group roster (Google). Also tracks per-ad-asset bucket.
    type CampAgg = {
      key: string;
      platform: Platform;
      total: Bucket;
      byAsset: Map<string, { key: string; b: Bucket }>;
    };
    const campaigns = new Map<string, CampAgg>();
    function getCamp(key: string, platform: Platform): CampAgg {
      let c = campaigns.get(key);
      if (!c) {
        c = { key, platform, total: emptyBucket(), byAsset: new Map() };
        campaigns.set(key, c);
      }
      return c;
    }

    for (const c of contacts) {
      if (isPartnerReferral(c) || isTestContact(c)) continue;

      // Attribute via canonical helpers.
      const meta = matchContactToMetaCampaign(c, activeMeta);
      let campKey: string | null = null;
      let platform: Platform = "Meta";
      let assetKey: string | null = null;

      if (meta) {
        campKey = meta;
        platform = "Meta";
        const utm = (c.first_touch_utm_content || "").trim();
        assetKey = utm ? shortAd(utm) : null;
      } else {
        const g = matchContactToGoogleAdGroup(c, ga);
        if (g) {
          // For Google we key the campaign at the ad-group / Pmax-rollup
          // label so it lines up with how Ad Health names them. Also
          // resolve the parent campaign for spend lookup.
          const adUnit = ga.find((u) => u.label === g);
          campKey = adUnit ? adUnit.campaignName : g;
          platform = "Google";
          // Ad asset for Google = the ad-group label itself (each label
          // is already one creative unit; Pmax rollup collapses to one).
          assetKey = g;
        }
      }
      if (!campKey) continue;

      const camp = getCamp(campKey, platform);
      let asset: { key: string; b: Bucket } | null = null;
      if (assetKey) {
        let a = camp.byAsset.get(assetKey);
        if (!a) {
          a = { key: assetKey, b: emptyBucket() };
          camp.byAsset.set(assetKey, a);
        }
        asset = a;
      }

      // RTL bucket — createdate in window, isSignup + !hasDQ + isRTL.
      if (c.createdate && inWindow(c.createdate) && isSignup(c) && !hasDQ(c) && isReadyToLaunch(c)) {
        camp.total.rtl++;
        if (asset) asset.b.rtl++;
      }
      // Trial bucket — trial-entry date in window.
      const td = c.hs_v2_date_entered_opportunity || c.trial__start_date;
      if (td && inWindow(td)) {
        camp.total.trials++;
        if (asset) asset.b.trials++;
      }
      // Customer bucket — customer-entry date in window, real paid.
      if (everBecameRealCustomer(c) && inWindow(c.hs_v2_date_entered_customer)) {
        camp.total.customers++;
        if (asset) asset.b.customers++;
      }
    }

    // Build the final rows. Attach spend from the appropriate map.
    const rows: CampaignRow[] = [];
    for (const c of campaigns.values()) {
      const spend = c.platform === "Meta"
        ? (metaCampSpend.get(c.key) || 0)
        : (googleCampSpend.get(c.key) || googleGroupSpend.get(c.key) || 0);
      const adAssets: AdAssetRow[] = Array.from(c.byAsset.values())
        .map((a) => {
          let assetSpend = 0;
          if (c.platform === "Meta") {
            assetSpend = metaAdSpend.get(`${c.key}::${a.key}`) || 0;
          } else {
            assetSpend = googleGroupSpend.get(a.key) || 0;
          }
          return {
            key: a.key, platform: c.platform, spend: assetSpend,
            rtl: a.b.rtl, trials: a.b.trials, customers: a.b.customers,
          };
        })
        .filter((a) => a.spend > 0 || a.rtl > 0 || a.trials > 0 || a.customers > 0)
        .sort((a, b) => (b.rtl - a.rtl) || (b.spend - a.spend));
      rows.push({
        campaign: c.key,
        platform: c.platform,
        spend,
        rtl: c.total.rtl,
        trials: c.total.trials,
        customers: c.total.customers,
        adAssets,
      });
    }
    // Also surface Meta / Google campaigns that had spend in the window
    // but no attributed contacts — mirrors CampaignAnalysisCard's behaviour
    // so no active campaign is silently missing.
    for (const [name, spend] of metaCampSpend) {
      if (rows.find((r) => r.campaign === name && r.platform === "Meta")) continue;
      rows.push({ campaign: name, platform: "Meta", spend, rtl: 0, trials: 0, customers: 0, adAssets: [] });
    }
    for (const [name, spend] of googleCampSpend) {
      if (rows.find((r) => r.campaign === name && r.platform === "Google")) continue;
      rows.push({ campaign: name, platform: "Google", spend, rtl: 0, trials: 0, customers: 0, adAssets: [] });
    }
    rows.sort((a, b) => {
      if (b.spend !== a.spend) return b.spend - a.spend;
      return a.campaign.localeCompare(b.campaign);
    });

    const body: Response = { since, until, rows };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/rtl-campaign-analysis] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
