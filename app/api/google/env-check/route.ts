import { NextResponse } from "next/server";

/**
 * Diagnostic endpoint — reports which Google Ads env vars are
 * DEFINED in the current runtime + makes a live API probe so we can
 * see what Google's API is actually saying back. Returns response
 * status and a snippet of the body so we can diagnose silent
 * failures (e.g. queries that succeed with 0 results, or auth
 * surfaces an error embedded in a 200 response).
 *
 * Once Google integration is stable this can be deleted.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const presence = {
    GOOGLE_ADS_DEVELOPER_TOKEN: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID: !!process.env.GOOGLE_ADS_CUSTOMER_ID,
    GOOGLE_ADS_CLIENT_ID: !!process.env.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: !!process.env.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN: !!process.env.GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: !!process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  };
  const lengths = Object.fromEntries(
    Object.keys(presence).map((k) => [k, (process.env[k] || "").length])
  );

  // Live probe — replicate exactly what fetchActiveGoogleCampaigns does
  // and report the raw response. Helps diagnose why production returns
  // 0 campaigns while local returns 7 with identical env values.
  const probe: Record<string, unknown> = {};
  try {
    const oauthRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    probe.oauthStatus = oauthRes.status;
    if (!oauthRes.ok) {
      probe.oauthBody = (await oauthRes.text()).slice(0, 400);
      return NextResponse.json({ presence, lengths, probe });
    }
    const { access_token } = (await oauthRes.json()) as { access_token: string };
    probe.accessTokenPrefix = access_token.slice(0, 12) + "...";

    const cust = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
    const login = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${access_token}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      "Content-Type": "application/json",
    };
    if (login) headers["login-customer-id"] = login;
    probe.headersUsed = {
      hasAuth: !!headers.Authorization,
      hasDevToken: !!headers["developer-token"],
      hasLoginCustomerId: !!headers["login-customer-id"],
      customerId: cust,
      loginCustomerId: login || "(not set)",
    };

    const url = `https://googleads.googleapis.com/v21/customers/${cust}/googleAds:searchStream`;
    const adsRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status = 'ENABLED'",
      }),
      cache: "no-store",
    });
    probe.adsStatus = adsRes.status;
    probe.adsBodySnippet = (await adsRes.text()).slice(0, 800);
  } catch (err) {
    probe.exception = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ presence, lengths, probe });
}
