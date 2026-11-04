// Month-to-date Workers and Durable Objects usage from Cloudflare's GraphQL Analytics API, a token with Account
// Analytics Read (Cloudflare docs, read 2026-11-03). Cloudflare says these datasets are not its billing measure,
// so every line here is usage with no amount (basis "estimated"); the billed figures come from cloudflare-billing.
import { addDecimals, canonicalDecimal, makeLine } from '../money.mjs';
import { SourceError, expectShape, getJson, safeWord } from './http.mjs';

export const id = 'cloudflare-analytics';
export const credentials = ['CROW_COSTS_CLOUDFLARE_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];

// Variables are typed `string`, as in Cloudflare's own Workers tutorial query.
const QUERY = `query CrowCosts($account: string, $from: string, $to: string, $dayBefore: string) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workers: workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $from, datetime_leq: $to }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP99 }
        dimensions { scriptName }
      }
      durableObjects: durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: { date_gt: $dayBefore }) {
        sum { requests }
      }
      storage: durableObjectsStorageGroups(limit: 1000, filter: { date_gt: $dayBefore }) {
        max { storedBytes }
      }
    }
  }
}`;

// Cloudflare's documented error messages (analytics/graphql-api/errors, read 2026-11-04), each mapped to a fixed
// word. Only the word reaches the output; the message never does, since it can name the account. An unmatched
// message falls back to Cloudflare's own `extensions.code` when that is a short lowercase word, then to `other`.
const ERROR_KINDS = [
  ['permission', /not authorized|does not have access/i],
  ['query', /error parsing args|unknown field|must have (no )?selections|query contains error/i],
  ['time-range', /older than|time range is too large/i],
  ['limits', /number of fields|limit must be/i],
  ['rate-limit', /rate limit|too many nodes|excessive resources/i],
  ['unavailable', /unable to execute|in progress|internal server error/i],
];
// An error's path names a dataset by its alias here, or by its own name.
const DATASETS = {
  workers: ['workers', 'workersInvocationsAdaptive'],
  durableObjects: ['durableObjects', 'durableObjectsInvocationsAdaptiveGroups'],
  storage: ['storage', 'durableObjectsStorageGroups'],
};

/** The first error's kind, then `:` and the dataset when its path names one of the query's. */
export function graphqlCode(errors) {
  const e = errors[0];
  const message = typeof e?.message === 'string' ? e.message.slice(0, 500) : '';
  const kind = ERROR_KINDS.find(([, re]) => re.test(message))?.[0] ?? safeWord(e?.extensions?.code) ?? 'other';
  const path = Array.isArray(e?.path) ? e.path : [];
  const dataset = Object.keys(DATASETS).find((d) => DATASETS[d].some((name) => path.includes(name)));
  return dataset ? `${kind}:${dataset}` : kind;
}

export async function collect(ctx) {
  const account = ctx.env.CLOUDFLARE_ACCOUNT_ID;
  expectShape(/^[0-9a-f]{32}$/.test(account));
  const dayBefore = new Date(Date.parse(`${ctx.period.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const body = await getJson(ctx, 'https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.env.CROW_COSTS_CLOUDFLARE_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { account, from: `${ctx.period.from}T00:00:00Z`, to: ctx.now.toISOString(), dayBefore } }),
  });
  if (body && Array.isArray(body.errors) && body.errors.length) throw new SourceError('graphql', null, graphqlCode(body.errors));
  const acct = body?.data?.viewer?.accounts?.[0];
  expectShape(acct && Array.isArray(acct.workers));
  const line = (product, unit, quantity) =>
    makeLine({ source: id, product, unit, quantity, basis: 'estimated', periodFrom: ctx.period.from, periodTo: ctx.period.to });
  const lines = [];
  for (const w of acct.workers) {
    const name = w?.dimensions?.scriptName ?? 'unknown';
    lines.push(line(`Worker ${name}`, 'requests', w?.sum?.requests ?? '0'));
    lines.push(line(`Worker ${name}`, 'errors', w?.sum?.errors ?? '0'));
    lines.push(line(`Worker ${name}`, 'subrequests', w?.sum?.subrequests ?? '0'));
    if (w?.quantiles?.cpuTimeP99 != null) lines.push(line(`Worker ${name}`, 'cpu-time-p99-microseconds', canonicalDecimal(w.quantiles.cpuTimeP99)));
  }
  if (Array.isArray(acct.durableObjects)) {
    lines.push(line('Durable Objects', 'requests', addDecimals(...acct.durableObjects.map((g) => g?.sum?.requests ?? '0'))));
  }
  if (Array.isArray(acct.storage) && acct.storage.length) {
    const stored = acct.storage.map((g) => g?.max?.storedBytes ?? '0').reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a), '0');
    lines.push(line('Durable Objects', 'stored-bytes-max', stored));
  }
  return lines;
}
