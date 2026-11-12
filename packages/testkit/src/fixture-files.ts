// Club and terms fixture files (fixtures/clubs, fixtures/terms). Both are declarative YAML read with the core
// schema only (no custom tags, bounded aliases), like scenario files, so they can describe a club or a job but
// never carry code. A club file is a club.schema.json object without rulebookHash, which is computed here.
// A terms file is a terms template: the commitment fields that describe the job, with windows in seconds
// instead of absolute times and without parties, adjudicator addresses, keys or nonces. termsFromTemplate
// fills those in; every load is validated against spec/schemas through @holdback/core's parsers.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  commitmentId,
  parseClub,
  parseCommitment,
  plusSeconds,
  rulebookHash,
  type AcceptanceSpec,
  type Address,
  type Base64Url,
  type Club,
  type CommitmentTerms,
  type Deliverable,
  type Hex32,
  type Timestamp,
  type TokenAmount,
} from '@holdback/core';
import { parseDocument } from 'yaml';
import { ScenarioError } from './scenario.js';

/** Windows in whole seconds: the first three count from createdAt, judge from deliverBy, fallback from judgeBy. */
export interface RelativeTiming {
  offerExpiresInSec: number;
  fundWithinSec: number;
  deliverWithinSec: number;
  judgeWithinSec: number;
  fallbackWithinSec: number;
  appealWindowSec: number;
  appealDecideSec: number;
  maxSubmissions: CommitmentTerms['timing']['maxSubmissions'];
}

export interface TermsTemplate {
  schemaVersion: '0.8';
  clubId: string;
  deliverable: Deliverable;
  acceptance: AcceptanceSpec;
  price: TokenAmount;
  adjudication: { policyId: string; fee: TokenAmount };
  timing: RelativeTiming;
  settlement: CommitmentTerms['settlement'];
  remedy: CommitmentTerms['remedy'];
  disclosure: CommitmentTerms['disclosure'];
}

/** What an offer adds to a template: who, which club, the adjudicator's bound hashes, and when. */
export interface TermsParams {
  club: Club;
  buyer: Address;
  seller: Address;
  /** ADR-0033: the buyer's payment address and the seller's payout address; each defaults to its signing address. */
  buyerPaymentAddress?: Address;
  sellerPayoutAddress?: Address;
  adjudicator: Address;
  fallbackAdjudicator: Address;
  appealAdjudicator: Address;
  policyHash: Hex32;
  registryHash: Hex32;
  buyerEncryptionPublicKey: Base64Url;
  nonce: Hex32;
  /** Whole seconds. */
  createdAt: Timestamp;
}

const TEMPLATE_KEYS = ['schemaVersion', 'clubId', 'deliverable', 'acceptance', 'price', 'adjudication', 'timing', 'settlement', 'remedy', 'disclosure'] as const;
const ADJUDICATION_KEYS = ['policyId', 'fee'] as const;
const TIMING_KEYS = ['offerExpiresInSec', 'fundWithinSec', 'deliverWithinSec', 'judgeWithinSec', 'fallbackWithinSec', 'appealWindowSec', 'appealDecideSec', 'maxSubmissions'] as const;

const fail = (file: string, detail: string): never => {
  throw new ScenarioError(`${file}: ${detail}`);
};

function readYaml(source: string, file: string): Record<string, unknown> {
  const doc = parseDocument(source, { schema: 'core', customTags: [], uniqueKeys: true, prettyErrors: false, strict: true });
  if (doc.errors.length) fail(file, doc.errors[0]!.message);
  if (doc.warnings.length) fail(file, doc.warnings[0]!.message);
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 20 });
  } catch (e) {
    fail(file, (e as Error).message);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail(file, 'must be a mapping');
  return data as Record<string, unknown>;
}

function closed(o: unknown, where: string, file: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) fail(file, `${where} must be a mapping`);
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (!keys.includes(k)) fail(file, `${where}.${k} is not a known key (allowed: ${keys.join(', ')})`);
  for (const k of keys) if (!(k in rec)) fail(file, `${where}.${k} is required`);
  return rec;
}

/** A club file: club.schema.json without rulebookHash, which is computed from the rulebook. */
export function parseClubYaml(source: string, file: string): Club {
  const data = readYaml(source, file);
  if ('rulebookHash' in data) fail(file, 'rulebookHash is computed by the loader; do not write it in the file');
  const rulebook = data['rulebook'];
  const club = { ...data, rulebookHash: rulebookHash(typeof rulebook === 'object' && rulebook !== null ? rulebook : {}) };
  const r = parseClub(club);
  if (!r.ok) fail(file, r.error.detail);
  return r.ok ? r.value : (undefined as never);
}

export const loadClubFile = (path: string): Club => parseClubYaml(readFileSync(path, 'utf8'), basename(path));

/** Fills a template in. Throws when the club is not the one the template names. */
export function termsFromTemplate(t: TermsTemplate, p: TermsParams): CommitmentTerms {
  if (p.club.id !== t.clubId) throw new ScenarioError(`terms name clubId ${t.clubId}, but the club supplied is ${p.club.id}`);
  const ms = Date.parse(p.createdAt);
  if (!Number.isFinite(ms) || ms % 1000 !== 0) throw new ScenarioError(`createdAt ${p.createdAt} must be a whole-second timestamp`);
  const createdAt = plusSeconds(p.createdAt, 0);
  const deliverBy = plusSeconds(createdAt, t.timing.deliverWithinSec);
  const judgeBy = plusSeconds(deliverBy, t.timing.judgeWithinSec);
  return {
    schemaVersion: t.schemaVersion,
    clubId: t.clubId,
    rulebookHash: p.club.rulebookHash,
    buyer: p.buyer,
    seller: p.seller,
    buyerPaymentAddress: p.buyerPaymentAddress ?? p.buyer,
    sellerPayoutAddress: p.sellerPayoutAddress ?? p.seller,
    deliverable: structuredClone(t.deliverable),
    acceptance: structuredClone(t.acceptance),
    price: { ...t.price },
    adjudication: {
      adjudicator: p.adjudicator,
      fallbackAdjudicator: p.fallbackAdjudicator,
      appealAdjudicator: p.appealAdjudicator,
      policyId: t.adjudication.policyId,
      fee: { ...t.adjudication.fee },
      registryHash: p.registryHash,
      policyHash: p.policyHash,
    },
    timing: {
      offerExpiresAt: plusSeconds(createdAt, t.timing.offerExpiresInSec),
      fundBy: plusSeconds(createdAt, t.timing.fundWithinSec),
      deliverBy,
      judgeBy,
      fallbackBy: plusSeconds(judgeBy, t.timing.fallbackWithinSec),
      appealWindowSec: t.timing.appealWindowSec,
      appealDecideSec: t.timing.appealDecideSec,
      maxSubmissions: t.timing.maxSubmissions,
    },
    settlement: { ...t.settlement },
    remedy: { ...t.remedy },
    disclosure: { ...t.disclosure },
    buyerEncryptionPublicKey: p.buyerEncryptionPublicKey,
    nonce: p.nonce,
    createdAt,
  };
}

// Placeholder parties and times, used only to validate a template against commitment.schema.json at load.
const PLACEHOLDER_SIGNATURE = `0x${'11'.repeat(65)}` as const;
const placeholderAddress = (b: string): Address => `0x${b.repeat(20)}` as Address;

/** A terms file: the job's commitment fields with relative windows. Validated as a full commitment. */
export function parseTermsYaml(source: string, file: string): TermsTemplate {
  const data = closed(readYaml(source, file), 'terms', file, TEMPLATE_KEYS);
  closed(data['adjudication'], 'adjudication', file, ADJUDICATION_KEYS);
  const timing = closed(data['timing'], 'timing', file, TIMING_KEYS);
  for (const k of TIMING_KEYS) {
    const v = timing[k];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(file, `timing.${k} must be a whole number of seconds, got ${String(v)}`);
  }
  const template = data as unknown as TermsTemplate;
  const club: Club = { id: template.clubId, name: 'placeholder', operator: placeholderAddress('00'), rulebook: {} as Club['rulebook'], rulebookHash: `0x${'00'.repeat(32)}` as Hex32 };
  let terms: CommitmentTerms;
  let id: Hex32;
  try {
    terms = termsFromTemplate(template, {
      club,
      buyer: placeholderAddress('b1'),
      seller: placeholderAddress('5e'),
      adjudicator: placeholderAddress('a1'),
      fallbackAdjudicator: placeholderAddress('a2'),
      appealAdjudicator: placeholderAddress('a3'),
      policyHash: `0x${'01'.repeat(32)}` as Hex32,
      registryHash: `0x${'02'.repeat(32)}` as Hex32,
      buyerEncryptionPublicKey: 'AAAA',
      nonce: `0x${'03'.repeat(32)}` as Hex32,
      createdAt: '2026-01-01T00:00:00Z',
    });
    // Validate the shape first: hashing a malformed value can throw before the schema names the field.
    const shape = parseCommitment({ ...terms, id: `0x${'00'.repeat(32)}`, signatures: { seller: PLACEHOLDER_SIGNATURE } });
    if (!shape.ok) return fail(file, shape.error.detail);
    id = commitmentId(terms);
  } catch (e) {
    if (e instanceof ScenarioError) throw e;
    return fail(file, (e as Error).message);
  }
  const r = parseCommitment({ ...terms, id, signatures: { seller: PLACEHOLDER_SIGNATURE } });
  if (!r.ok) fail(file, r.error.detail);
  return structuredClone(template);
}

export const loadTermsFile = (path: string): TermsTemplate => parseTermsYaml(readFileSync(path, 'utf8'), basename(path));
