// A hosted seller's bundle (T-435, ADR-0037 section 4): what the deploy script builds from the seller's private
// folder and bundles into its own Worker. It holds the seller's slug, the card its page shows, its adapter
// configuration in the shape of examples/seller-adapter.config.json, and the files that configuration names (its
// template, its report mapping) as text. It never holds a secret: the keys are Worker secrets, read by name.
// Nothing in it runs. This file checks a bundle and names what is wrong.
import { createHash } from 'node:crypto';
import { configFrom, SHELL_VARIABLES, type SellerAdapterConfig } from '../../../examples/seller-adapter-core.ts';
import { jcs } from '../../../examples/verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The bundle as the deploy script writes it. */
export interface HostedBundle {
  /** The seller's name in its address, crow.direct/agents/<slug>: lowercase letters, digits and single hyphens. */
  slug: string;
  /** What the seller's page shows: its name, the item it sells, and one optional sentence about it. */
  card: { name: string; item: string; description?: string };
  /** The adapter configuration, as a seller writes it; `template` and `reportMapping` name entries of `files`. */
  config: unknown;
  /** The files the configuration names, by name, as text. */
  files: Record<string, string>;
}

/** A bundle checked: the configuration as the core takes it, and what the Worker reads from it. */
export interface HostedSeller {
  slug: string;
  card: { name: string; item: string; description?: string };
  config: SellerAdapterConfig;
  files: Record<string, string>;
  /** SHA-256 of the bundle in canonical JSON, hex: the deploy script prints it, and the card and /health show it. */
  configSha256: string;
  /** The environment variables the configuration names for its credentials. The Worker hands the core these and no others. */
  credentialVars: string[];
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Paths Crow's own agents hold: a seller's routes, /agents/<slug> and /agents/<slug>/*, never overlap them. */
const RESERVED_SLUGS = ['test-seller', 'test-buyer'];
/** The Worker's own bindings and variables: no configuration names one as a credential. */
export const WORKER_VARIABLES: readonly string[] = ['SELLER', 'OPERATOR_URLS', 'SELLER_URL', 'BUILD_COMMIT'];
/** Fields of a Node configuration the Worker has no use for: it keeps no journal file, opens no port, writes no event file. */
const NODE_ONLY = ['journal', 'port', 'events'];
const isRecord = (v: J): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: J, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && !/[\0-\x1f\x7f]/.test(v);

/** The SHA-256 a bundle is known by, hex: the same bytes the deploy script hashes. */
export function bundleSha256(b: HostedBundle): string {
  return createHash('sha256').update(jcs({ slug: b.slug, card: b.card, config: b.config, files: b.files }), 'utf8').digest('hex');
}

/** Checks a bundle. Throws, naming the field, on anything malformed; the Worker then serves nothing for the seller. */
export function checkBundle(raw: unknown): HostedSeller {
  if (!isRecord(raw)) throw new Error('the bundle must be one JSON object: slug, card, config and files');
  const b = raw as HostedBundle;
  for (const k of Object.keys(b)) if (!['slug', 'card', 'config', 'files'].includes(k)) throw new Error(`the bundle has a field the Worker does not take: ${String(k).slice(0, 40)}`);
  if (typeof b.slug !== 'string' || b.slug.length > 40 || !SLUG.test(b.slug)) throw new Error('slug must be 1 to 40 lowercase letters, digits and single hyphens, such as "acme-audits"');
  if (RESERVED_SLUGS.some((r) => b.slug === r || b.slug.startsWith(`${r}-`))) throw new Error(`slug ${b.slug} would share a path with Crow's ${b.slug.startsWith('test-buyer') ? 'test buyer' : 'test seller'}: choose another`);
  const card = b.card as J;
  if (!isRecord(card)) throw new Error('card must be an object: name, item and an optional description');
  for (const k of Object.keys(card)) if (!['name', 'item', 'description'].includes(k)) throw new Error(`card has a field the Worker does not take: ${String(k).slice(0, 40)}`);
  if (!text(card.name, 80)) throw new Error('card.name must be 1 to 80 characters of text');
  if (typeof card.item !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(card.item)) throw new Error('card.item must be 1 to 80 letters, digits, dots, hyphens or underscores');
  if (card.description !== undefined && !text(card.description, 500)) throw new Error('card.description must be 1 to 500 characters of text');
  const files = b.files as J;
  if (!isRecord(files) || !Object.values(files).every((t) => typeof t === 'string')) throw new Error('files must map each file name to its text');
  const c = b.config as J;
  if (!isRecord(c)) throw new Error('config must be one JSON object: the adapter configuration');
  for (const k of NODE_ONLY) if (c[k] !== undefined) throw new Error(`config.${k} is for the adapter on Node: a hosted seller keeps its journal in its Durable Object; remove the field`);
  if (c.template === undefined) throw new Error('config.template is required: a hosted seller names its own template, bundled in files');
  const has = (name: string) => Object.hasOwn(files, name);
  const config = configFrom(c, `the ${b.slug} configuration`, {
    beside: (name) => {
      if (!has(name)) throw new Error(`the ${b.slug} configuration names ${name.slice(0, 80)}, and the bundle holds no such file`);
      return name;
    },
    readText: (name) => {
      if (!has(name)) throw Object.assign(new Error(`the bundle holds no file ${name.slice(0, 80)}`), { code: 'ENOENT' });
      return files[name] as string;
    },
    shippedTemplate: '', // a hosted seller ships no template of Crow's: a file name is never empty
  });
  const credentialVars = [
    isRecord(c.sellerApi) && isRecord(c.sellerApi.auth) ? c.sellerApi.auth.env : undefined,
    c.quoteAuth?.env,
    c.alerts?.secretEnv,
    c.redelivery?.readyAuth?.env,
  ].filter((v): v is string => typeof v === 'string');
  for (const v of credentialVars) {
    if (v.startsWith('HOLDBACK_') || SHELL_VARIABLES.includes(v) || WORKER_VARIABLES.includes(v)) throw new Error(`the ${b.slug} configuration names ${v} for a credential, which the Worker keeps for itself: name a variable of its own`);
  }
  return { slug: b.slug, card: { name: card.name, item: card.item, ...(card.description === undefined ? {} : { description: card.description }) }, config, files, configSha256: bundleSha256(b), credentialVars };
}
