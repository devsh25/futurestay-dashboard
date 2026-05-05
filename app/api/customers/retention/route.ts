import { NextResponse } from "next/server";
import { fetchAllContacts } from "@/lib/hubspot";
import { computeRetention } from "@/lib/retention";

/**
 * Retention curve data — % of paying-customer cohort retained at
 * each milestone post-entry, segmented by plan family (Amplify / Flex).
 *
 * Uses the cached fetchAllContacts() so it doesn't add to the cold-
 * start request burden. The expensive bit is the property-history
 * batch fetch inside computeRetention(), which is gated by an
 * in-route response cache via Next.js Route Handler caching.
 */
export async function GET() {
  try {
    const contacts = await fetchAllContacts();
    const data = await computeRetention(contacts);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Retention API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
