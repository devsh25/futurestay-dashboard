import { NextResponse } from "next/server";

/**
 * Diagnostic endpoint — reports which Google Ads env vars are
 * DEFINED in the current runtime, without leaking values. Used to
 * debug "credentials set in Vercel but the function can't see them"
 * scoping issues.
 *
 * Returns booleans only. Once Google integration is stable this can
 * be deleted.
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
  // Also report the LENGTH of each defined value so we can detect
  // empty-string accidents (Vercel allows saving "" as a value).
  const lengths = Object.fromEntries(
    Object.keys(presence).map((k) => [k, (process.env[k] || "").length])
  );
  return NextResponse.json({ presence, lengths });
}
