// Cloudflare's usage-based charges for the current billing period: GET /accounts/{id}/billable-usage, a token
// with Billing Read (Cloudflare blog "Introducing the Billable Usage API"; API reference, read 2026-11-03).
// Rows are daily charge periods per product; amounts are JSON numbers, read here as exact decimal text.
import { addDecimals, dollarsToCents, makeLine } from '../money.mjs';
import { expectShape, getJson } from './http.mjs';

export const id = 'cloudflare-billing';
export const credentials = ['CROW_COSTS_CLOUDFLARE_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];

const dayOf = (t) => String(t).slice(0, 10);
/** A charge period ends at the next midnight; the last day it covers is the day before. */
const lastDayOf = (t) => {
  const s = String(t);
  if (!/T00:00:00(\.0+)?Z$/.test(s)) return dayOf(s);
  return new Date(Date.parse(s) - 1).toISOString().slice(0, 10);
};

export async function collect(ctx) {
  const account = ctx.env.CLOUDFLARE_ACCOUNT_ID;
  expectShape(/^[0-9a-f]{32}$/.test(account));
  const body = await getJson(ctx, `https://api.cloudflare.com/client/v4/accounts/${account}/billable-usage`, {
    headers: { Authorization: `Bearer ${ctx.env.CROW_COSTS_CLOUDFLARE_TOKEN}`, Accept: 'application/json' },
  });
  expectShape(body && body.success === true && Array.isArray(body.result));
  const groups = new Map();
  for (const row of body.result) {
    expectShape(row && typeof row.ServiceName === 'string');
    const unit = row.ConsumedUnit ?? row.PricingUnit ?? 'Count';
    const currency = row.BillingCurrency ?? 'USD';
    const key = JSON.stringify([row.ServiceName, unit, currency]);
    const g = groups.get(key) ?? { product: row.ServiceName, unit, currency, quantity: '0', dollars: '0', from: null, to: null };
    g.quantity = addDecimals(g.quantity, row.ConsumedQuantity ?? '0');
    g.dollars = addDecimals(g.dollars, row.BilledCost ?? '0');
    const from = dayOf(row.ChargePeriodStart ?? ctx.period.from);
    const to = row.ChargePeriodEnd ? lastDayOf(row.ChargePeriodEnd) : ctx.period.to;
    if (!g.from || from < g.from) g.from = from;
    if (!g.to || to > g.to) g.to = to;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) =>
    makeLine({ source: id, product: g.product, unit: g.unit, quantity: g.quantity, amount: { cents: dollarsToCents(g.dollars), currency: g.currency }, basis: 'billed', periodFrom: g.from, periodTo: g.to }),
  );
}
