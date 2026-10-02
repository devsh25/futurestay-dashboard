import { NextRequest, NextResponse } from "next/server";
import { head, list } from "@vercel/blob";

// Temporary diagnostic: list what's in the cache/ Blob prefix and
// time a HEAD + GET for the two canonical cache paths. Guarded by
// the same x-vercel-cron / CRON_SECRET auth as warm-cache so it isn't
// publicly accessible.

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") !== null) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (qs && qs === secret) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const paths = [
    "cache/hubspot/all-contacts-v1.json",
    "cache/hubspot/all-customers-v1.json",
    "cache/hubspot/all-owners-v1.json",
  ];

  // 1) list what's actually under cache/
  const listing = await list({ prefix: "cache/", limit: 50 });
  const listed = listing.blobs.map((b) => ({
    pathname: b.pathname,
    size: b.size,
    uploadedAt: b.uploadedAt,
  }));

  // 2) for each expected path, HEAD + fetch and time it
  const diagnostics: Record<string, unknown> = {};
  for (const path of paths) {
    const tHeadStart = Date.now();
    let info: { url?: string; size?: number } | null = null;
    try {
      info = await head(path);
    } catch (err) {
      diagnostics[path] = { headError: err instanceof Error ? err.message : String(err) };
      continue;
    }
    const headMs = Date.now() - tHeadStart;
    if (!info?.url) {
      diagnostics[path] = { headMs, missing: true };
      continue;
    }
    const tFetchStart = Date.now();
    let bytes = -1;
    let fetchStatus: number | string = "n/a";
    try {
      const res = await fetch(info.url, { cache: "no-store" });
      fetchStatus = res.status;
      const text = await res.text();
      bytes = text.length;
    } catch (err) {
      fetchStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    const fetchMs = Date.now() - tFetchStart;
    diagnostics[path] = { headMs, size: info.size, url: info.url, fetchStatus, fetchMs, bytes };
  }

  return NextResponse.json({ listing: listed, diagnostics });
}
