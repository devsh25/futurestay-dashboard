import { NextResponse } from "next/server";
import { fetchAllCustomers } from "@/lib/hubspot";
import { computeRetention } from "@/lib/retention";

// ISR: cache the retention JSON for 5 minutes. Retention curves move
// slowly (customer-month granularity) so a 5-minute staleness is a
// non-issue, and cached hits bypass the ~18s cold handler entirely.
export const revalidate = 300;

/**
 * Retention curve data — % of paying-customer cohort retained at
 * each milestone post-entry, segmented by plan family (Amplify / Flex).
 *
 * Uses fetchAllCustomers() (not fetchAllContacts) because we need
 * EVERY paying customer regardless of createdate. fetchAllContacts is
 * scoped to contacts created since 2026-01-01, which would silently
 * drop the ~300 customers who became customer in 2024/2025 — exactly
 * the long-tail cohort that's most valuable for retention analysis.
 */
export async function GET() {
  try {
    const customers = await fetchAllCustomers();
    const data = await computeRetention(customers);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Retention API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
