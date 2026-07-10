// Generate one day's growth report and upload it to Vercel Blob.
//
// Runs OUTSIDE Vercel serverless (locally, or in GitHub Actions) so the
// 10s Hobby-tier function timeout doesn't matter. The Vercel read side
// only fetches the precomputed blob, which is fast enough to fit inside
// any function limit.
//
// Env vars needed:
//   HUBSPOT_ACCESS_TOKEN, META_ACCESS_TOKEN, META_AD_ACCOUNT_ID,
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
//   GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
//   GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID,
//   BLOB_READ_WRITE_TOKEN
//
// Locally: `npx tsx scripts/generate-growth-report.ts [YYYY-MM-DD]`
// Defaults to yesterday ET.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { put } from "@vercel/blob";
import { computeGrowthReport, renderGrowthReportHtml, renderGrowthReportSlack } from "../lib/growth-report";

function etDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

async function main() {
  const argDate = process.argv[2];
  const date = argDate && /^\d{4}-\d{2}-\d{2}$/.test(argDate) ? argDate : etDate(-1);

  const required = [
    "HUBSPOT_ACCESS_TOKEN", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID",
    "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "BLOB_READ_WRITE_TOKEN",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(2);
  }

  console.log(`[${new Date().toISOString()}] Computing growth report for ${date}...`);
  const t0 = Date.now();
  const data = await computeGrowthReport(date);
  const computedMs = Date.now() - t0;
  console.log(`Computed in ${(computedMs / 1000).toFixed(1)}s. Rendering + uploading...`);

  const html = renderGrowthReportHtml(data);
  const wrappedHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Futurestay Growth Report ${data.yesterday}</title></head><body>${html}</body></html>`;
  const slack = renderGrowthReportSlack(data);
  const json = JSON.stringify(data);

  const base = `growth-report/${date}`;
  const [j, h, t] = await Promise.all([
    put(`${base}/report.json`, json, {
      access: "public", contentType: "application/json",
      allowOverwrite: true, addRandomSuffix: false,
    }),
    put(`${base}/report.html`, wrappedHtml, {
      access: "public", contentType: "text/html; charset=utf-8",
      allowOverwrite: true, addRandomSuffix: false,
    }),
    put(`${base}/report.txt`, slack, {
      access: "public", contentType: "text/plain; charset=utf-8",
      allowOverwrite: true, addRandomSuffix: false,
    }),
  ]);

  console.log(`Uploaded 3 artefacts for ${date}:`);
  console.log(`  json: ${j.url}`);
  console.log(`  html: ${h.url}`);
  console.log(`  txt : ${t.url}`);
  console.log(`Total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});
