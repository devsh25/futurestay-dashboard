import { NextRequest, NextResponse } from "next/server";
import { fetchMetaInsights } from "@/lib/meta";
import { resolvedDateRange } from "@/lib/funnel";
import { PeriodFilter } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const period = (params.get("period") || "allTime") as PeriodFilter;
    const customStart = params.get("start") || undefined;
    const customEnd = params.get("end") || undefined;

    // For custom periods, pass the user-typed YYYY-MM-DD strings through
    // directly — Meta's ads timezone is stable so no conversion needed.
    // For preset periods, derive from resolvedDateRange.
    let since: string;
    let until: string;
    if (period === "custom" && customStart && customEnd) {
      since = customStart;
      until = customEnd;
    } else {
      const { start, end } = resolvedDateRange(period);
      since = ymd(start);
      until = ymd(end);
    }

    const data = await fetchMetaInsights(since, until);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Meta API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
