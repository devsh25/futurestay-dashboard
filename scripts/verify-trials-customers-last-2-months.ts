// Emits two CSVs listing every trial and every paid-customer conversion
// the dashboard recognizes over the last 2 months (60 days ending today).
// Same helpers the dashboard uses at runtime — no re-implementation.
//
// Run: npx tsx scripts/verify-trials-customers-last-2-months.ts

import { fetchAllContacts, fetchAllCustomers, fetchOwnerNames } from "../lib/hubspot";
import {
  isPartnerReferral, isTestContact, everBecameRealCustomer,
} from "../lib/funnel";
import { tzDateKey } from "../lib/timezone";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT_DIR = path.resolve(process.cwd(), "verify-output");
fs.mkdirSync(OUT_DIR, { recursive: true });

const now = new Date();
const cutoff = new Date(now.getTime() - 60 * 86_400_000);

function inWindow(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && t >= cutoff.getTime() && t <= now.getTime();
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  console.log(`Window: ${tzDateKey(cutoff)} .. ${tzDateKey(now)} (ET calendar days)`);
  console.log("Pulling contacts, customers, and owners from HubSpot...");

  const [contacts, customersFull, ownerMap] = await Promise.all([
    fetchAllContacts(),
    fetchAllCustomers(),
    fetchOwnerNames(),
  ]);

  // Merge: fetchAllContacts is date-scoped, fetchAllCustomers grabs the
  // full customer history including hosts who became customers before the
  // date-scope cutoff. Dedupe by contact id.
  const seen = new Set<string>();
  const all = [] as typeof contacts;
  for (const c of contacts) { if (!seen.has(c.id)) { seen.add(c.id); all.push(c); } }
  for (const c of customersFull) { if (!seen.has(c.id)) { seen.add(c.id); all.push(c); } }
  console.log(`Contacts fetched: ${all.length} (${contacts.length} main + ${customersFull.length - (all.length - contacts.length)} customer-only)`);

  // Filter internal test + partner-referral once.
  const clean = all.filter((c) => !isPartnerReferral(c) && !isTestContact(c));
  console.log(`After partner/test exclusion: ${clean.length}`);

  // Trials — same rule as /api/rtl-run-rate and KPI Trials tile.
  const trialRows: Array<Record<string, unknown>> = [];
  for (const c of clean) {
    const td = c.hs_v2_date_entered_opportunity || c.trial__start_date;
    if (!inWindow(td)) continue;
    trialRows.push({
      hubspot_id: c.id,
      trial_date_et: tzDateKey(td!),
      trial_timestamp_iso: td,
      email: c.email,
      first_name: c.firstname,
      last_name: c.lastname,
      account_lifecycle: c.account_lifecycle,
      cb_product: c.cb_product,
      plan_name: c.plan_name,
      subscription_status: c.subscription_status,
      cb_subcst_trial_end: c.cb_subcst_trial_end,
      trial_start_date_field: c.trial__start_date,
      hs_v2_date_entered_opportunity: c.hs_v2_date_entered_opportunity,
      hubspot_owner_id: c.hubspot_owner_id,
      sales_owner_name: c.hubspot_owner_id ? (ownerMap[c.hubspot_owner_id] || "") : "",
      createdate: c.createdate,
      first_touch_utm_source: c.first_touch_utm_source,
      first_touch_utm_medium: c.first_touch_utm_medium,
      first_touch_utm_campaign: c.first_touch_utm_campaign,
      referral_source: c.referral_source,
      hubspot_url: `https://app.hubspot.com/contacts/41507364/record/0-1/${c.id}`,
    });
  }
  trialRows.sort((a, b) => String(a.trial_date_et).localeCompare(String(b.trial_date_et)));

  // Customers — same rule as the RealCustomer line: has customer-entry
  // date, not a quick-cancel, was on a paid plan.
  const customerRows: Array<Record<string, unknown>> = [];
  for (const c of clean) {
    const cd = c.hs_v2_date_entered_customer;
    if (!inWindow(cd)) continue;
    if (!everBecameRealCustomer(c)) continue;
    customerRows.push({
      hubspot_id: c.id,
      customer_date_et: tzDateKey(cd!),
      customer_timestamp_iso: cd,
      email: c.email,
      first_name: c.firstname,
      last_name: c.lastname,
      account_lifecycle: c.account_lifecycle,
      cb_product: c.cb_product,
      plan_name: c.plan_name,
      plan_type_legacy: c.plan_type_legacy,
      plan_type_old: c.plan_type_old,
      limited_access_previous_plan: c.limited_access_previous_plan,
      subscription_status: c.subscription_status,
      hs_v2_date_entered_customer: c.hs_v2_date_entered_customer,
      hs_v2_date_exited_customer: c.hs_v2_date_exited_customer,
      hs_v2_date_entered_opportunity: c.hs_v2_date_entered_opportunity,
      trial_start_date_field: c.trial__start_date,
      hubspot_owner_id: c.hubspot_owner_id,
      sales_owner_name: c.hubspot_owner_id ? (ownerMap[c.hubspot_owner_id] || "") : "",
      createdate: c.createdate,
      first_touch_utm_source: c.first_touch_utm_source,
      first_touch_utm_medium: c.first_touch_utm_medium,
      first_touch_utm_campaign: c.first_touch_utm_campaign,
      referral_source: c.referral_source,
      hubspot_url: `https://app.hubspot.com/contacts/41507364/record/0-1/${c.id}`,
    });
  }
  customerRows.sort((a, b) => String(a.customer_date_et).localeCompare(String(b.customer_date_et)));

  function write(name: string, rows: Array<Record<string, unknown>>) {
    if (!rows.length) { console.log(`  ${name}: 0 rows, skipping`); return; }
    const cols = Object.keys(rows[0]);
    const lines = [cols.join(",")];
    for (const r of rows) lines.push(cols.map((k) => csvEscape(r[k])).join(","));
    const p = path.join(OUT_DIR, name);
    fs.writeFileSync(p, lines.join("\n") + "\n");
    console.log(`  ${name}: ${rows.length} rows -> ${p}`);
  }

  console.log("\nWriting CSVs:");
  const stamp = tzDateKey(now);
  write(`trials_last_60d_${stamp}.csv`, trialRows);
  write(`customers_last_60d_${stamp}.csv`, customerRows);

  console.log("\nSummary");
  console.log(`  Trials (dashboard count):    ${trialRows.length}`);
  console.log(`  Customers (dashboard count): ${customerRows.length}`);
  console.log(`  Window: ${tzDateKey(cutoff)} through ${tzDateKey(now)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
