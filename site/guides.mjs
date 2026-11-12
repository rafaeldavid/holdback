// The agent guides (T-393): the front door (llms.txt), one page per role (buy.txt, sell.txt) and the reference files
// under ref/. An agent reads the front door and its role's page for one ordinary deal, and fetches a reference file
// only when a step names it. This module states the budget for that path, counts it, and holds the pure checks
// site/check.mjs runs on the guides. Plain JavaScript with no dependencies, so the check runs without a build.
import { readdirSync, readFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);

/**
 * The budget, in one place: what one role's first deal may cost an agent in Crow's docs, the front door plus that
 * role's page, in tokens. The count is the provider's own (Anthropic's count_tokens) for the pinned model the
 * two-agent run plays by default (tools/duet, config/judges-live.yaml) when a key is set, and otherwise bytes divided
 * by four, a stated estimate.
 */
export const FIRST_DEAL_BUDGET = {
  tokens: 5000,
  model: 'claude-opus-5-5',
  keyEnv: 'HOLDBACK_AGENT_ANTHROPIC_API_KEY',
  paths: { buyer: ['llms.txt', 'buy.txt'], seller: ['llms.txt', 'sell.txt'] },
};

/** The reference files, by their published path (`ref/<name>.txt`), sorted. */
export function referenceFiles(dir = here('./ref/')) {
  return readdirSync(dir).filter((f) => /^[a-z0-9-]+\.txt$/.test(f)).sort().map((f) => `ref/${f}`);
}

/** Every guide an agent can fetch, by published path: the front door, the two role pages, the reference files. */
export function guideFiles() {
  return ['llms.txt', 'buy.txt', 'sell.txt', ...referenceFiles()];
}

/** A guide's source text, editor notes and all. */
export const guideSource = (path) => readFileSync(here(`./${path}`), 'utf8');

/** Bytes divided by four, rounded up: the stated estimate when no provider counter is at hand. */
export const estimateTokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);

/**
 * Tokens in `text` as one user message, counted by Anthropic's count_tokens for `model`. The count includes the
 * message's few framing tokens, so it errs high. Throws on any answer but 200 with a whole number.
 */
export async function countTokens(text, { key, model = FIRST_DEAL_BUDGET.model, fetch: f = fetch } = {}) {
  const res = await f('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || !Number.isInteger(body?.input_tokens)) throw new Error(`count_tokens answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}`);
  return body.input_tokens;
}

/**
 * Each role's first-deal path, measured: `{role, files, bytes, estimate, counted, tokens, method}`. `estimate` is
 * always bytes divided by four; `counted` is the provider's count when a key is set, else null. `tokens` is what the
 * budget holds: the provider's count when there is one, the estimate otherwise; `method` says which.
 */
export async function measurePaths(published, { key = process.env[FIRST_DEAL_BUDGET.keyEnv], fetch: f } = {}) {
  const out = [];
  for (const [role, files] of Object.entries(FIRST_DEAL_BUDGET.paths)) {
    const text = files.map((p) => published.get(p)).join('\n');
    const bytes = Buffer.byteLength(text, 'utf8');
    const estimate = estimateTokens(text);
    const counted = key ? await countTokens(text, { key, ...(f ? { fetch: f } : {}) }) : null;
    out.push({ role, files, bytes, estimate, counted, tokens: counted ?? estimate, method: key ? `count_tokens for ${FIRST_DEAL_BUDGET.model}` : 'estimate, bytes divided by four: no key set' });
  }
  return out;
}

/** The text a reader sees as prose: fenced code blocks gone. */
const prose = (text) => text.replace(/```[\s\S]*?```/g, '');

/**
 * Sentences that appear in more than one guide, as `{sentence, files}`. A sentence counts when it has at least six
 * words outside inline code; list markers and emphasis are ignored, case and spacing too.
 */
export function duplicateSentences(guides) {
  const where = new Map();
  for (const [file, text] of guides) {
    for (const line of prose(text).split('\n')) {
      const body = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/\*\*/g, '').trim();
      for (const s of body.split(/(?<=[.!?:])\s+(?=[A-Z`"(])/)) {
        const words = s.replace(/`[^`]*`/g, ' ').split(/\s+/).filter((w) => /[a-z]/i.test(w));
        if (words.length < 6) continue;
        const key = s.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!where.has(key)) where.set(key, new Set());
        where.get(key).add(file);
      }
    }
  }
  return [...where].filter(([, files]) => files.size > 1).map(([sentence, files]) => ({ sentence, files: [...files].sort() }));
}

/**
 * The routes docs/api.md describes, as `METHOD /path` with each `{param}` as `{x}`: from inline code such as
 * `POST /v1/faucet` and from its route tables (`| POST | \`/v1/prepare/{kind}\` |`).
 */
export function apiRoutes(apiMd) {
  const norm = (m, p) => `${m} ${p.split('?')[0].replace(/\{[A-Za-z]+\}/g, '{x}')}`;
  const routes = new Set();
  for (const [, m, p] of apiMd.matchAll(/`(GET|POST|PUT|DELETE) (\/[^`\s]*)`/g)) routes.add(norm(m, p));
  for (const [, m, p] of apiMd.matchAll(/\| (GET|POST|PUT|DELETE) \| `(\/[^`\s]*)`/g)) routes.add(norm(m, p));
  return routes;
}

/**
 * The calls a guide names: `GET /…` or `POST /…` in prose or code, and `curl` lines against `$OP1`/`$OP2`, each as
 * `METHOD /path` with the query left out. A path segment in angle brackets, or a sample value such as `0x…`, is a
 * parameter.
 */
export function namedCalls(text) {
  const calls = new Set();
  const clean = (p) => p.split('?')[0].replace(/[.,;:)]+$/, '');
  for (const [, m, p] of text.matchAll(/\b(GET|POST) (\/(?:v1|\.well-known)[^\s`"'<]*(?:<[^>]+>[^\s`"'<]*)*)/g)) calls.add(`${m} ${clean(p)}`);
  for (const line of text.split('\n')) {
    const c = /curl\s+(?:-s\s+)?(?:(-X POST)\s+)?"?\$OP[12](\/[^\s"'`]+)/.exec(line);
    if (c) calls.add(`${c[1] || /\s-d\s|--data|content-type/.test(line) ? 'POST' : 'GET'} ${clean(c[2])}`);
  }
  return [...calls];
}

/** Whether `call` (`METHOD /path`) is one of `routes`: a `{x}` segment matches any one segment. */
export function routeKnown(call, routes) {
  const [method, path] = call.split(' ');
  const segs = path.replace(/<[^>]+>/g, '{x}').replace(/0x[0-9a-f…]+/gi, '{x}').split('/');
  for (const r of routes) {
    const [rm, rp] = r.split(' ');
    const rs = rp.split('/');
    if (rm === method && rs.length === segs.length && rs.every((s, i) => s === '{x}' || s === segs[i] || segs[i] === '{x}')) return true;
  }
  return false;
}

/** The reference files a guide names, as `ref/<name>.txt` (inline or as a crow.direct link). */
export const namedReferences = (text) => [...new Set([...text.matchAll(/\bref\/([a-z0-9-]+\.txt)\b/g)].map((m) => `ref/${m[1]}`))];

/**
 * The sections a guide cites by name, as `{file, title}`: "`ref/<name>.txt`, \"<title>\"" and the front door's
 * "\"<title>\"" after `llms.txt` or "the front door's". A title is a heading (`## ` or `### `) of that file, or the
 * bold lead of a paragraph or list item (`**<title>.**`).
 */
export function citedSections(text) {
  const out = [];
  for (const [, file, title] of text.matchAll(/`(ref\/[a-z0-9-]+\.txt)`, "([^"]+)"/g)) out.push({ file, title });
  for (const [, title] of text.matchAll(/front door's "([^"]+)"/g)) out.push({ file: 'llms.txt', title });
  return out;
}

/** Whether `title` is a heading or a bold lead in `text`. */
export const hasSection = (text, title) => text.split('\n').some((l) => l === `## ${title}` || l === `### ${title}` || l.startsWith(`## ${title}: `) || l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').startsWith(`**${title}.**`) || l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').startsWith(`**${title}**`));

