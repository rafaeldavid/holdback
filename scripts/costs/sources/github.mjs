// GitHub metered usage for Rafa's account this month: GET /users/{username}/settings/billing/usage (GitHub REST
// "Billing usage", read 2026-11-03), with a fine-grained token holding the user permission Plan: read. Public-repo
// Actions on standard runners are free and not metered, so on this account most months show nothing.
import { addDecimals, dollarsToCents, makeLine } from '../money.mjs';
import { expectShape, getJson } from './http.mjs';

export const id = 'github';
export const credentials = ['CROW_COSTS_GITHUB_TOKEN'];

export async function collect(ctx) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${ctx.env.CROW_COSTS_GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'crow-costs',
  };
  const user = await getJson(ctx, 'https://api.github.com/user', { headers });
  expectShape(typeof user?.login === 'string' && /^[A-Za-z0-9-]+$/.test(user.login));
  const [year, month] = ctx.period.from.split('-');
  const q = new URLSearchParams({ year, month: String(Number.parseInt(month, 10)) });
  const body = await getJson(ctx, `https://api.github.com/users/${user.login}/settings/billing/usage?${q}`, { headers });
  expectShape(body && Array.isArray(body.usageItems));
  const groups = new Map();
  for (const item of body.usageItems) {
    expectShape(item && typeof item.product === 'string');
    const product = item.sku ? `${item.product}: ${item.sku}` : item.product;
    const unit = item.unitType ?? 'units';
    const key = JSON.stringify([product, unit]);
    const g = groups.get(key) ?? { product, unit, quantity: '0', dollars: '0' };
    g.quantity = addDecimals(g.quantity, item.quantity ?? '0');
    g.dollars = addDecimals(g.dollars, item.netAmount ?? '0');
    groups.set(key, g);
  }
  return [...groups.values()].map((g) =>
    makeLine({ source: id, product: g.product, unit: g.unit, quantity: g.quantity, amount: { cents: dollarsToCents(g.dollars), currency: 'USD' }, basis: 'billed', periodFrom: ctx.period.from, periodTo: ctx.period.to }),
  );
}
