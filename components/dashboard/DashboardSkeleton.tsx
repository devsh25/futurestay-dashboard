/**
 * Dashboard loading skeleton — shown until the first-fold metrics
 * (KPI hero + rate cards + Run Rate chart) finish loading.
 *
 * The layout mirrors the real dashboard so the page doesn't reflow when
 * data arrives — same heights, same grid, same border radii. Each block
 * uses the .lp-shimmer class (defined in globals.css) for an electric-
 * blue gradient sweep that conveys "data is on its way" rather than
 * "page is broken".
 */
export default function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Methodology subtext placeholder */}
      <div className="lp-shimmer h-4 w-3/4 rounded-md" />

      {/* Section heading placeholder */}
      <div className="flex items-center gap-3 pt-2">
        <div className="lp-shimmer h-5 w-5 rounded" />
        <div className="lp-shimmer h-5 w-32 rounded-md" />
      </div>

      {/* KPI hero row — divided container layout */}
      <div className="bg-[#11182B] border border-[#1F2937] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#1F2937]">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="px-6 py-5 first:pl-7 last:pr-7">
              <div className="flex items-baseline justify-between mb-3">
                <div className="lp-shimmer h-12 w-24 rounded-lg" />
                <div className="lp-shimmer h-5 w-12 rounded-full" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="lp-shimmer h-3 w-28 rounded" />
                <div className="lp-shimmer h-6 w-16 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rate cards — 6 small cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-[#11182B] border border-[#1F2937] rounded-2xl px-5 py-4"
          >
            <div className="lp-shimmer h-3 w-20 rounded mb-3" />
            <div className="lp-shimmer h-8 w-14 rounded-md" />
          </div>
        ))}
      </div>

      {/* Run Rate chart — taller block with a subtle wave SVG inside */}
      <div className="bg-[#11182B] border border-[#1F2937] rounded-2xl">
        <div className="px-6 py-4 border-b border-[#1F2937] flex items-center justify-between">
          <div className="lp-shimmer h-5 w-28 rounded-md" />
          <div className="lp-shimmer h-5 w-32 rounded-full" />
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Toggle chips strip */}
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lp-shimmer h-8 w-32 rounded-full" />
            ))}
          </div>

          {/* Chart canvas with a wave hint to suggest "trend coming" */}
          <div className="relative h-[360px] rounded-xl overflow-hidden lp-shimmer">
            <svg
              className="absolute inset-0 w-full h-full opacity-20"
              viewBox="0 0 600 200"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="skel-grad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#1E6FFF" stopOpacity="0.4" />
                  <stop offset="1" stopColor="#1E6FFF" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,140 C 80,120 160,80 240,90 S 400,150 480,120 S 600,60 600,80 L 600,200 L 0,200 Z"
                fill="url(#skel-grad)"
              />
              <path
                d="M0,140 C 80,120 160,80 240,90 S 400,150 480,120 S 600,60 600,80"
                fill="none"
                stroke="#1E6FFF"
                strokeOpacity="0.6"
                strokeWidth="2.5"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
