import { NextResponse } from "next/server";
import { fetchAllCustomers } from "@/lib/hubspot";
import { computeRetention } from "@/lib/retention";

// Dynamic — see /api/rtl-run-rate for the ISR-vs-cold-cache note.
// The warm-cache cron pre-populates fetchAllCustomers; this route
// then takes 1-5s warm, ~18s cold worst case.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

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
