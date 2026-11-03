// Anthropic API spend and tokens, month to date, from the Admin API (legacy Usage and Cost endpoints, still
// supported; read 2026-11-03): cost_report gives USD cents as decimal strings, daily buckets; usage_report/messages
// gives tokens. Needs an Admin key, which has full organization access (docs/costs.md), so it lives only in
// .env.costs in the dedicated clone.
import { addDecimals, makeLine } from '../money.mjs';
import { expectShape, getJson } from './http.mjs';

export const id = 'anthropic';
export const credentials = ['CROW_COSTS_ANTHROPIC_ADMIN_KEY'];

const BASE = 'https://api.anthropic.com/v1/organizations';
const MAX_PAGES = 20;

async function pages(ctx, path, params) {
  const headers = { 'x-api-key': ctx.env.CROW_COSTS_ANTHROPIC_ADMIN_KEY, 'anthropic-version': '2023-06-01' };
  const buckets = [];
  let page = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const q = new URLSearchParams(params);
    if (page) q.set('page', page);
    const body = await getJson(ctx, `${BASE}/${path}?${q}`, { headers });
    expectShape(body && Array.isArray(body.data));
    buckets.push(...body.data);
    if (!body.has_more || !body.next_page) return buckets;
    page = body.next_page;
  }
  return buckets;
}

const workspace = (w) => w ?? 'Default workspace';

export async function collect(ctx) {
  // No ending_at: it is optional, and the report then runs to now.
  const range = [['starting_at', `${ctx.period.from}T00:00:00Z`], ['bucket_width', '1d'], ['limit', '31']];
  const line = (product, unit, quantity, amount, basis) =>
    makeLine({ source: id, product, unit, quantity, amount, basis, periodFrom: ctx.period.from, periodTo: ctx.period.to });

  const costs = new Map();
  for (const bucket of await pages(ctx, 'cost_report', [...range, ['group_by[]', 'workspace_id'], ['group_by[]', 'description']])) {
    expectShape(Array.isArray(bucket?.results));
    for (const r of bucket.results) {
      expectShape(typeof r?.amount === 'string');
      const product = `${r.description ?? r.model ?? r.cost_type ?? 'other'} [${workspace(r.workspace_id)}]`;
      const key = JSON.stringify([product, r.currency ?? 'USD']);
      const g = costs.get(key) ?? { product, currency: r.currency ?? 'USD', cents: '0' };
      g.cents = addDecimals(g.cents, r.amount);
      costs.set(key, g);
    }
  }

  const tokens = new Map();
  const add = (product, unit, n) => {
    if (n === undefined || n === null) return;
    const key = JSON.stringify([product, unit]);
    tokens.set(key, { product, unit, quantity: addDecimals(tokens.get(key)?.quantity ?? '0', n) });
  };
  // Grouped by key too, so T-054 can see a key that did not appear last month.
  for (const bucket of await pages(ctx, 'usage_report/messages', [...range, ['group_by[]', 'workspace_id'], ['group_by[]', 'model'], ['group_by[]', 'api_key_id']])) {
    expectShape(Array.isArray(bucket?.results));
    for (const r of bucket.results) {
      const product = `${r.model ?? 'unknown model'} [${workspace(r.workspace_id)}] [key ${r.api_key_id ?? 'Console'}]`;
      add(product, 'input_tokens', r.uncached_input_tokens);
      add(product, 'output_tokens', r.output_tokens);
      add(product, 'cache_read_input_tokens', r.cache_read_input_tokens);
      add(product, 'cache_write_5m_input_tokens', r.cache_creation?.ephemeral_5m_input_tokens);
      add(product, 'cache_write_1h_input_tokens', r.cache_creation?.ephemeral_1h_input_tokens);
      add(product, 'web_search_requests', r.server_tool_use?.web_search_requests);
    }
  }

  return [
    ...[...costs.values()].map((g) => line(g.product, 'charge', '1', { cents: g.cents, currency: g.currency }, 'billed')),
    ...[...tokens.values()].map((t) => line(t.product, t.unit, t.quantity, null, 'estimated')),
  ];
}
