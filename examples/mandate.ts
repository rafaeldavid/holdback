// The mandate tool (T-438): builds the three messages a company's principal or its agent signs, for a signature made
// elsewhere, and verifies a signed one. It takes no private key, reads none and makes none: in real use the principal
// signs a mandate or a revocation on a hardware wallet, and the agent's standing key signs a delegation. Test tokens only.
//   node examples/mandate.ts mandate <principal> <agent> <club> <buyer|seller> <the most per deal, base units> <the most per day, base units> [--days <n> | --expires-at <ISO>] [--sim]
//       a Mandate (mandate.schema.json): the principal lets the agent's key act in one club and one role, up to the caps, for <n> days (default 7)
//   node examples/mandate.ts delegation <principal> <agent> <deal key> <deal encryption key> <club> <buyer|seller> <the most for this deal, base units> <expires at, ISO> [--sim]
//       a Delegation (ADR-0024 section 7): the agent's standing key certifies one deal's signing and encryption keys; the agent's key signs it
//   node examples/mandate.ts revocation <principal> <agent> [--expires-at <ISO>] [--sim]
//       an AgentRevocation (ADR-0038 section 4): it ends every mandate the principal gave the agent while it is in effect; it lasts until 9999-12-31T23:59:59Z unless you say otherwise
//   node examples/mandate.ts verify <typed-data file> <signature> [--principal <address>] [--mandate <file>] [--at <ISO>] [--sim]
//       checks the file is exactly one of the three messages under the pinned domain, that the signature recovers to the key that must sign it,
//       and that it is in effect at --at (default now). --principal: the principal you expect, which a key that names itself cannot forge.
//       --mandate (required for a delegation): the signed mandate, as this command prints it or as its document; then a delegation must fit it,
//       and a revocation must end it. Prints the signed document in its schema's form, with the digest, the domain hash and the message hash.
// Each build command prints the typed-data file (the form eth_signTypedData_v4 takes) on stdout, and on stderr its three hashes and one sentence.
// The domain: Sepolia's deployment (examples/deployments.ts), HOLDBACK_DEPLOYMENT (a deployment file's JSON, a local chain), or SimChain with --sim.
// Exit status 0 when done, 2 on a wrong call, 3 on a refusal. It enforces nothing: a mandate binds only those who check it (ADR-0038).
import { readFileSync } from 'node:fs';
import { getTypesForEIP712Domain, hashDomain, hashStruct, hashTypedData, isAddressEqual, recoverTypedDataAddress, type Hex } from 'viem';
import { SEPOLIA, type DeploymentFile } from './deployments.ts';
import { isMain } from './entry.ts';
import { digestOfFile, jcs, pinOf, Refusal, SIMCHAIN_DOMAIN, strictTypedDataFile, TYPES, typedDataFile, type Domain, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The three messages this tool builds and checks. */
export type Kind = 'Mandate' | 'Delegation' | 'AgentRevocation';
/** The default end of a revocation: the last whole second of year 9999 in UTC (ADR-0038 section 4: the last representable time). */
export const LAST_TIME = '9999-12-31T23:59:59Z';
/** The chains this tool pins: Ethereum Sepolia and a local chain (SimChain's domain uses 31337 too). Every other chain is refused. */
export const PINNED_CHAINS = [11155111, 31337];
/** How far ahead of the checker's clock a mandate's issuedAt may be, in seconds: clocks differ. */
export const ISSUED_AHEAD_SEC = 300;
/** secp256k1's order halved: a signature with a larger s is the malleable twin of one with a smaller s, and is refused. */
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
/** The last second a timestamp can show in UTC as YYYY-MM-DDTHH:MM:SSZ. */
const LAST_SEC = 253402300799n;

const f = (name: string, type: string) => ({ name, type });
/** The EIP-712 types of schema 0.11, domain version 0.8 (packages/core/src/eip712.ts), pinned here. mandate.test.ts hashes every kind against the core's messageDigest. */
export const MANDATE_TYPES = {
  TokenAmount: TYPES.TokenAmount,
  Scope: TYPES.Scope,
  Delegation: TYPES.Delegation,
  Mandate: [f('principal', 'address'), f('agent', 'address'), f('clubId', 'string'), f('scope', 'Scope'), f('nonce', 'bytes32'), f('issuedAt', 'uint64')],
  AgentRevocation: [f('agent', 'address'), f('principal', 'address'), f('nonce', 'bytes32'), f('expiresAt', 'uint64')],
};
/** Who must sign each kind. */
const SIGNER: Record<Kind, 'principal' | 'agent'> = { Mandate: 'principal', Delegation: 'agent', AgentRevocation: 'principal' };
/** The fields of each signed document, as its schema names them (mandate.schema.json; messages.schema.json). */
const FIELDS: Record<Kind, string[]> = {
  Mandate: ['principal', 'agent', 'clubId', 'scope', 'nonce', 'issuedAt'],
  Delegation: ['type', 'principal', 'agent', 'dealKey', 'dealEncryptionKey', 'clubId', 'scope', 'nonce', 'expiresAt'],
  AgentRevocation: ['type', 'agent', 'principal', 'nonce', 'expiresAt'],
};

const refuse = (why: string): never => {
  throw new Refusal(`refusing: ${why}`);
};
/** A revocation this tool cannot read. A caller that relies on revocations should treat it as a stop, never as "not revoked". */
export class RevocationUnreadable extends Refusal {}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/, HEX32 = /^0x[0-9a-f]{64}$/, CLUB = /^[a-z0-9-]{3,64}$/, DEC = /^(0|[1-9][0-9]{0,77})$/, B64URL = /^[A-Za-z0-9_-]{43}$/, SIG = /^0x[0-9a-fA-F]{130}$/;
/** A date-time as the schema allows it (RFC 3339, with Z or an offset); it must fall on a whole second from 1970 to 9999. */
const DATE_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/;
/** A value fit to repeat in a message: short and printable. Anything else, a key pasted by mistake included, is not shown. */
const shown = (v: J) => (typeof v === 'string' && v.length <= 42 && /^[\x20-\x7e]*$/.test(v) ? JSON.stringify(v) : '(value not shown)');
/** Text fit for a terminal: no control or invisible character can rewrite what a person reads. */
const printable = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');
const iso = (sec: bigint) => (sec >= 0n && sec <= LAST_SEC ? new Date(Number(sec) * 1000).toISOString().replace('.000Z', 'Z') : refuse(`the time ${sec} s lies outside 1970 to 9999: this tool cannot show it as a date`));
const secs = (ts: string) => BigInt(Date.parse(ts) / 1000);
/** A timestamp: any RFC 3339 form on a whole second; the document then shows it in UTC, which signs the same integer. */
const time = (v: J, name: string): string => {
  const at = typeof v === 'string' && DATE_TIME.test(v) ? Date.parse(v) : NaN;
  if (!Number.isFinite(at) || at % 1000 !== 0 || at < 0) refuse(`${name} ${shown(v)} is not a date-time on a whole second from 1970, such as 2026-11-21T09:00:00Z`);
  return iso(BigInt(at / 1000));
};
const address = (v: J, name: string): string => (typeof v === 'string' && ADDRESS.test(v) ? v.toLowerCase() : refuse(`${name} ${shown(v)} is not an address: 0x and 40 hex characters`));
const amountOf = (v: J, name: string): string => (typeof v === 'string' && DEC.test(v) && BigInt(v) < 2n ** 256n ? v : refuse(`${name} ${shown(v)} is not base units as a decimal string below 2^256`));
const exactKeys = (v: J, keys: string[], name: string, optional: string[] = []) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse(`${name} is not an object`);
  const extra = Object.keys(v).filter((k) => !keys.includes(k) && !optional.includes(k)), missing = keys.filter((k) => !Object.hasOwn(v, k) || v[k] === undefined);
  if (extra.length || missing.length) refuse(`${name} ${extra.length ? `has fields its type does not: ${extra.map(printable).join(', ')}` : `lacks ${missing.join(', ')}`}`);
};
/** Two tokens are one when equal, or when both are addresses that differ only in letter case. */
const sameToken = (a: string, b: string) => a === b || (ADDRESS.test(a) && ADDRESS.test(b) && a.toLowerCase() === b.toLowerCase());
/** A fresh random nonce: 32 bytes, lowercase hex. */
export const freshNonce = (): string => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;

/**
 * JSON as a person reads the file: refused when an object names one key twice (the parser keeps the last, so the file
 * a person reviews could show another value than the one used), and when a key is __proto__.
 */
export function parseStrictJson(text: string, name = 'the file'): J {
  let i = 0;
  const ws = () => {
    while (/\s/.test(text[i] ?? '')) i++;
  };
  const str = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const keys = new Set<string>();
      ws();
      if (text[i] === '}') return void i++;
      for (;;) {
        ws();
        const k = str();
        if (keys.has(k)) refuse(`${name} names the key ${shown(k)} twice in one object`);
        if (k === '__proto__') refuse(`${name} uses the key __proto__`);
        keys.add(k);
        ws();
        i++; // ':'
        value();
        ws();
        if (text[i++] === '}') return;
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (text[i++] === ']') return;
      }
    }
    if (c === '"') return void str();
    while (i < text.length && /[^,\]}\s]/.test(text[i]!)) i++;
  };
  let parsed: J;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse(`${name} is not JSON`);
  }
  value();
  return parsed;
}

/** A pinned settlement layer this tool signs for: Sepolia, a local chain, or SimChain. Refuses every other chain. */
export function pinFor(o: { sim?: boolean; deployment?: string | undefined } = {}): Pin {
  if (o.sim) return { domain: SIMCHAIN_DOMAIN, token: { id: 'tUSD', symbol: 'tUSD', decimals: 6 } };
  let d: DeploymentFile | null = SEPOLIA;
  if (o.deployment) d = parseStrictJson(o.deployment, 'HOLDBACK_DEPLOYMENT') as DeploymentFile;
  if (!d) return refuse('no deployment pinned: set HOLDBACK_DEPLOYMENT, or pass --sim');
  if (typeof d.chainId !== 'number') refuse(`the chain ID ${shown(String(d.chainId))} is not a number`);
  if (!PINNED_CHAINS.includes(d.chainId)) refuse(`chain ${d.chainId} is not Ethereum Sepolia (11155111) or a local chain (31337): test tokens only`);
  return pinOf(d);
}
/** The domain a check runs under: Holdback 0.8 on a pinned chain only. */
const pinnedDomain = (d: Domain) => {
  if (d?.name !== 'Holdback' || d.version !== '0.8' || !PINNED_CHAINS.includes(d.chainId)) refuse(`the domain ${printable(jcs(d))} is not Holdback 0.8 on Ethereum Sepolia or a local chain`);
};

/** The scope's typed-data message. An absent `categories` encodes as hasCategories false and an empty list, as the operators encode it. */
const scopeMessage = (s: J) => ({
  roles: s.roles, maxPerCommitment: { token: s.maxPerCommitment.token, amount: BigInt(s.maxPerCommitment.amount) }, maxDaily: { token: s.maxDaily.token, amount: BigInt(s.maxDaily.amount) },
  hasCategories: s.categories !== undefined, categories: s.categories ?? [], expiresAt: secs(time(s.expiresAt, 'scope.expiresAt')),
});
const checkScope = (s: J, name: string) => {
  exactKeys(s, ['roles', 'maxPerCommitment', 'maxDaily', 'expiresAt'], name, ['categories']);
  if (!Array.isArray(s.roles) || s.roles.length === 0 || new Set(s.roles).size !== s.roles.length || s.roles.some((r: J) => r !== 'buyer' && r !== 'seller')) refuse(`${name}.roles must list buyer, seller or both, each once`);
  for (const k of ['maxPerCommitment', 'maxDaily']) {
    exactKeys(s[k], ['token', 'amount'], `${name}.${k}`);
    if (typeof s[k].token !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(s[k].token)) refuse(`${name}.${k}.token is not a token identifier: 1 to 64 printable characters`);
    amountOf(s[k].amount, `${name}.${k}.amount`);
  }
  if (s.categories !== undefined && (!Array.isArray(s.categories) || s.categories.some((c: J) => typeof c !== 'string'))) refuse(`${name}.categories is not a list of strings`);
  time(s.expiresAt, `${name}.expiresAt`);
};

/** Checks an unsigned document of `kind` field by field, and returns its typed-data message. Throws Refusal naming the field. */
export function messageOf(kind: Kind, doc: J): J {
  exactKeys(doc, FIELDS[kind], kind);
  if (kind !== 'Mandate' && doc.type !== kind) refuse(`the document's type is ${shown(doc.type)}, not ${kind}`);
  if (typeof doc.nonce !== 'string' || !HEX32.test(doc.nonce)) refuse('nonce is not 32 bytes as lowercase hex');
  for (const k of ['principal', 'agent', ...(kind === 'Delegation' ? ['dealKey'] : [])]) address(doc[k], k);
  if (kind === 'AgentRevocation') return { agent: doc.agent, principal: doc.principal, nonce: doc.nonce, expiresAt: secs(time(doc.expiresAt, 'expiresAt')) };
  if (typeof doc.clubId !== 'string' || !CLUB.test(doc.clubId)) refuse(`clubId ${shown(doc.clubId)} is not a club ID: 3 to 64 of a-z, 0-9 and -`);
  checkScope(doc.scope, 'scope');
  if (kind === 'Mandate') {
    if (Date.parse(time(doc.issuedAt, 'issuedAt')) >= Date.parse(time(doc.scope.expiresAt, 'scope.expiresAt'))) refuse('the mandate ends before it is issued');
    return { principal: doc.principal, agent: doc.agent, clubId: doc.clubId, scope: scopeMessage(doc.scope), nonce: doc.nonce, issuedAt: secs(time(doc.issuedAt, 'issuedAt')) };
  }
  if (typeof doc.dealEncryptionKey !== 'string' || !B64URL.test(doc.dealEncryptionKey)) refuse('dealEncryptionKey is not an x25519 public key as 43 base64url characters');
  return { principal: doc.principal, agent: doc.agent, dealKey: doc.dealKey, dealEncryptionKey: doc.dealEncryptionKey, clubId: doc.clubId, scope: scopeMessage(doc.scope), nonce: doc.nonce, expiresAt: secs(time(doc.expiresAt, 'expiresAt')) };
}

/** The typed data of an unsigned document under `domain`, as viem signs and hashes it. */
export const typedOf = (kind: Kind, doc: J, domain: Domain): J => ({ domain, types: MANDATE_TYPES, primaryType: kind, message: messageOf(kind, doc) });
/** The standard typed-data file a wallet signs (eth_signTypedData_v4). */
export const fileOf = (kind: Kind, doc: J, domain: Domain): J => typedDataFile(typedOf(kind, doc, domain));
/** The EIP-712 digest of an unsigned document: what is signed, and the one value that names it. */
export const digestOf = (kind: Kind, doc: J, domain: Domain): Hex => hashTypedData(typedOf(kind, doc, domain));
/** The digest, and the two hashes a hardware wallet shows when it cannot display the fields: the domain's and the message's. */
export function hashesOf(kind: Kind, doc: J, domain: Domain): { digest: Hex; domainHash: Hex; messageHash: Hex } {
  const t = typedOf(kind, doc, domain);
  return { digest: hashTypedData(t), domainHash: hashDomain({ domain, types: { EIP712Domain: getTypesForEIP712Domain({ domain }) } } as J), messageHash: hashStruct({ primaryType: kind, types: MANDATE_TYPES, data: t.message }) };
}

/** The document a typed-data file carries, read back from the file's message, after the file passes the strict check under `domain`. */
export function documentOfFile(file: J, domain: Domain): { kind: Kind; doc: J } {
  strictTypedDataFile(file);
  const kind = file.primaryType as Kind;
  if (!Object.hasOwn(SIGNER, kind)) refuse(`the file signs a ${shown(file.primaryType)}, not a Mandate, a Delegation or an AgentRevocation`);
  const lower = (d: J) => ({ ...d, ...(typeof d.verifyingContract === 'string' ? { verifyingContract: d.verifyingContract.toLowerCase() } : {}) });
  if (jcs(lower(file.domain)) !== jcs(lower(domain))) refuse(`the file is for the domain ${printable(jcs(file.domain))}, not your pinned ${jcs(domain)}: another chain or rules contract`);
  const m = file.message;
  const when = (v: J) => {
    try {
      return iso(BigInt(v));
    } catch (e) {
      if (kind === 'AgentRevocation') throw new RevocationUnreadable(`refusing: the revocation's time ${shown(String(v))} cannot be read as a date; it may still be in effect, so treat it as a stop`);
      throw e;
    }
  };
  const scope = (s: J) => ({ roles: s.roles, maxPerCommitment: s.maxPerCommitment, maxDaily: s.maxDaily, ...(s.hasCategories ? { categories: s.categories } : {}), expiresAt: when(s.expiresAt) });
  if (m.scope && m.scope.hasCategories === false && Array.isArray(m.scope.categories) && m.scope.categories.length > 0) refuse('the scope lists categories with hasCategories false: two messages would read as one');
  const doc =
    kind === 'Mandate'
      ? { principal: m.principal, agent: m.agent, clubId: m.clubId, scope: scope(m.scope), nonce: m.nonce, issuedAt: when(m.issuedAt) }
      : kind === 'Delegation'
        ? { type: kind, principal: m.principal, agent: m.agent, dealKey: m.dealKey, dealEncryptionKey: m.dealEncryptionKey, clubId: m.clubId, scope: scope(m.scope), nonce: m.nonce, expiresAt: when(m.expiresAt) }
        : { type: kind, agent: m.agent, principal: m.principal, nonce: m.nonce, expiresAt: when(m.expiresAt) };
  // The file must be exactly the message its document gives: types, domain and every field (no type the file names differently).
  if (digestOfFile(file) !== digestOf(kind, doc, domain)) refuse('the file is not the message its own fields give under the pinned types');
  return { kind, doc };
}

/** One sentence: what the message grants or ends, read from the document. Free text in it is shown printable only. */
export function sentenceOf(kind: Kind, d: J, token?: Pin['token']): string {
  const money = (a: J) => {
    const dec = token && sameToken(token.id, String(a.token)) ? BigInt(token.decimals) : 0n;
    const v = BigInt(a.amount);
    return `${a.amount} base units${dec > 0n ? ` (${v / 10n ** dec}.${(v % 10n ** dec).toString().padStart(Number(dec), '0')} ${token!.symbol})` : ''} of ${a.token}`;
  };
  const categories = d.scope?.categories ? ` It lists the categories ${JSON.stringify(d.scope.categories)}, which nothing checks (ADR-0038 section 2).` : '';
  const text =
    kind === 'Mandate'
      ? `${d.principal} lets ${d.agent} act as ${d.scope.roles.join(' and ')} in club ${d.clubId}, at most ${money(d.scope.maxPerCommitment)} a deal and ${money(d.scope.maxDaily)} a day, from ${d.issuedAt} until ${d.scope.expiresAt}.${categories} It binds only those who check it.`
      : kind === 'Delegation'
        ? `${d.agent}, for principal ${d.principal}, certifies deal key ${d.dealKey} (encryption key ${d.dealEncryptionKey}) as ${d.scope.roles.join(' and ')} in club ${d.clubId}, at most ${money(d.scope.maxPerCommitment)}, until ${d.expiresAt}.${categories} It names no deal.`
        : `${d.principal} ends every mandate it gave ${d.agent}, in every club, until ${d.expiresAt}. Funded deals are not touched.`;
  return printable(text);
}

/** A mandate's unsigned document, with a fresh nonce, issued at `now` (whole seconds), for `days` or until `expiresAt`. */
export function buildMandate(o: { principal: string; agent: string; clubId: string; role: 'buyer' | 'seller'; maxPerDeal: string; maxPerDay: string; token: string; days?: number; expiresAt?: string; now?: number }): J {
  const days = o.days ?? 7;
  if (!Number.isSafeInteger(days) || days < 1) refuse('--days is a whole number of days, 1 or more');
  const issued = BigInt(Math.floor((o.now ?? Date.now()) / 1000));
  const doc = {
    principal: address(o.principal, 'principal'), agent: address(o.agent, 'agent'), clubId: o.clubId,
    scope: { roles: [o.role], maxPerCommitment: { token: o.token, amount: amountOf(o.maxPerDeal, 'the most per deal') }, maxDaily: { token: o.token, amount: amountOf(o.maxPerDay, 'the most per day') }, expiresAt: o.expiresAt !== undefined ? time(o.expiresAt, '--expires-at') : iso(issued + BigInt(days) * 86_400n) },
    nonce: freshNonce(), issuedAt: iso(issued),
  };
  messageOf('Mandate', doc);
  return doc;
}

/** A delegation's unsigned document: the agent certifies one deal's keys, with a cap of `cap` and an end of `expiresAt`. */
export function buildDelegation(o: { principal: string; agent: string; dealKey: string; dealEncryptionKey: string; clubId: string; role: 'buyer' | 'seller'; cap: string; token: string; expiresAt: string }): J {
  const until = time(o.expiresAt, 'expires at');
  const doc = {
    type: 'Delegation', principal: address(o.principal, 'principal'), agent: address(o.agent, 'agent'), dealKey: address(o.dealKey, 'deal key'), dealEncryptionKey: o.dealEncryptionKey, clubId: o.clubId,
    scope: { roles: [o.role], maxPerCommitment: { token: o.token, amount: amountOf(o.cap, 'the most for this deal') }, maxDaily: { token: o.token, amount: o.cap }, expiresAt: until },
    nonce: freshNonce(), expiresAt: until,
  };
  messageOf('Delegation', doc);
  return doc;
}

/** A revocation's unsigned document, in effect until `expiresAt` (default LAST_TIME). */
export function buildRevocation(o: { principal: string; agent: string; expiresAt?: string }): J {
  const doc = { type: 'AgentRevocation', agent: address(o.agent, 'agent'), principal: address(o.principal, 'principal'), nonce: freshNonce(), expiresAt: time(o.expiresAt ?? LAST_TIME, 'expires at') };
  messageOf('AgentRevocation', doc);
  return doc;
}

export type Verified = { kind: Kind; signer: string; digest: Hex; domainHash: Hex; messageHash: Hex; inEffectUntil: string; document: J; revokesMandate?: boolean };
export type VerifyOptions = {
  /** The time to check at, in ms; default now. */
  at?: number;
  /** The signed mandate a delegation must fit or a revocation must end (required for a delegation). */
  mandate?: J;
  /** The principal the caller expects: a mandate, a revocation or a delegation naming another is refused. */
  principal?: string;
};

/** The signature in its one canonical form (v 27 or 28, low s), or a refusal: a twin of a valid signature is never a second one. */
function canonicalSignature(sig: J): Hex {
  if (typeof sig !== 'string' || !SIG.test(sig)) return refuse('the signature is not 65 bytes as 0x and 130 hex characters');
  const s = BigInt(`0x${sig.slice(66, 130)}`), v = parseInt(sig.slice(130), 16);
  if (s > HALF_N) refuse('the signature has a high s: it is the malleable twin of a valid one, and is refused');
  if (![0, 1, 27, 28].includes(v)) refuse(`the signature's v is ${v}, not 27 or 28`);
  return `${sig.slice(0, 130).toLowerCase()}${(v < 27 ? v + 27 : v).toString(16)}` as Hex;
}

/**
 * Verifies a signed document of `kind` (the unsigned fields plus `signature`) under `domain` at the time `o.at` (ms):
 * the signature recovers to the key that must sign it (the principal for a mandate or a revocation, the agent for a
 * delegation), and it is in effect then. A delegation is checked against `o.mandate` and must fit it; a revocation
 * given `o.mandate` must end it. With `o.principal`, the principal must be that one. Throws Refusal naming the reason.
 */
export async function verifyDocument(kind: Kind, signed: J, domain: Domain, o: VerifyOptions = {}): Promise<Verified> {
  pinnedDomain(domain);
  if (!Object.hasOwn(SIGNER, kind)) refuse(`${shown(kind)} is not a Mandate, a Delegation or an AgentRevocation`);
  if (!signed || typeof signed !== 'object' || Array.isArray(signed)) return refuse(`the ${kind} is not a JSON object`);
  const { signature: given, ...raw } = signed;
  const signature = canonicalSignature(given);
  messageOf(kind, raw);
  // Times in UTC: the same signed integers, one spelling.
  const doc = { ...raw, ...(raw.issuedAt ? { issuedAt: time(raw.issuedAt, 'issuedAt') } : {}), ...(raw.expiresAt ? { expiresAt: time(raw.expiresAt, 'expiresAt') } : {}), ...(raw.scope ? { scope: { ...raw.scope, expiresAt: time(raw.scope.expiresAt, 'scope.expiresAt') } } : {}) };
  const typed = typedOf(kind, doc, domain);
  const who = String(doc[SIGNER[kind]]).toLowerCase();
  let signer: string;
  try {
    signer = (await recoverTypedDataAddress({ ...typed, signature })).toLowerCase();
  } catch {
    return refuse('the signature recovers to no address');
  }
  if (!isAddressEqual(signer as Hex, who as Hex)) refuse(`the ${kind} is signed by ${signer}, not by its ${SIGNER[kind]} ${who}`);
  if (o.principal !== undefined && String(doc.principal).toLowerCase() !== address(o.principal, 'the expected principal')) refuse(`the ${kind} names principal ${String(doc.principal).toLowerCase()}, not the ${o.principal.toLowerCase()} you expect`);
  const at = o.at ?? Date.now();
  const until = kind === 'Mandate' ? doc.scope.expiresAt : kind === 'Delegation' ? (Date.parse(doc.scope.expiresAt) < Date.parse(doc.expiresAt) ? doc.scope.expiresAt : doc.expiresAt) : doc.expiresAt;
  const now = iso(BigInt(Math.floor(at / 1000)));
  if (!(at < Date.parse(until))) refuse(`the ${kind} ended at ${until}, before ${now}`);
  if (kind === 'Mandate' && Date.parse(doc.issuedAt) > at + ISSUED_AHEAD_SEC * 1000) refuse(`the mandate is issued at ${doc.issuedAt}, more than ${ISSUED_AHEAD_SEC} s after ${now}`);
  if (kind === 'Delegation' && o.mandate === undefined) refuse('a delegation counts only under its mandate: give the signed mandate it hangs from (--mandate)');
  let revokesMandate: boolean | undefined;
  if (o.mandate !== undefined) {
    if (kind === 'Mandate') refuse('--mandate checks a delegation or a revocation against a mandate, not a mandate');
    const m = (await verifyDocument('Mandate', o.mandate, domain, { at, ...(o.principal !== undefined ? { principal: o.principal } : {}) })).document;
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (!same(doc.principal, m.principal)) refuse(`the ${kind} names principal ${doc.principal}, and the mandate's principal is ${m.principal}: ${kind === 'AgentRevocation' ? 'it revokes nothing in this mandate' : 'it is not under this mandate'}`);
    if (!same(doc.agent, m.agent)) refuse(`the ${kind} names agent ${doc.agent}, and the mandate is for ${m.agent}`);
    if (kind === 'AgentRevocation') revokesMandate = true;
    if (kind === 'Delegation') {
      if (doc.clubId !== m.clubId) refuse(`the delegation is for club ${doc.clubId}, and the mandate for ${m.clubId}`);
      const extra = doc.scope.roles.filter((r: string) => !m.scope.roles.includes(r));
      if (extra.length) refuse(`the delegation allows the ${extra.join(' and ')} role, which the mandate does not`);
      for (const k of ['maxPerCommitment', 'maxDaily'] as const) {
        if (!sameToken(doc.scope[k].token, m.scope[k].token)) refuse(`the delegation's ${k} is in ${printable(doc.scope[k].token)}, and the mandate's in ${printable(m.scope[k].token)}`);
        if (BigInt(doc.scope[k].amount) > BigInt(m.scope[k].amount)) refuse(`the delegation's ${k} ${doc.scope[k].amount} is above the mandate's ${m.scope[k].amount}`);
      }
      if (Date.parse(until) > Date.parse(m.scope.expiresAt)) refuse(`the delegation lasts until ${until}, after the mandate ends at ${m.scope.expiresAt}`);
    }
  }
  return { kind, signer, ...hashesOf(kind, doc, domain), inEffectUntil: until, document: { ...doc, signature }, ...(revokesMandate ? { revokesMandate } : {}) };
}

/** Verifies a typed-data file and the signature a wallet made over it (see verifyDocument). */
export async function verifyFile(file: J, signature: string, domain: Domain, o: VerifyOptions = {}): Promise<Verified> {
  pinnedDomain(domain);
  const { kind, doc } = documentOfFile(file, domain);
  return verifyDocument(kind, { ...doc, signature }, domain, o);
}

/** A signed mandate as a person hands it over: its document, or what `verify` printed for it. */
export const mandateDocument = (x: J): J => (x && typeof x === 'object' && x.ok === true && x.kind === 'Mandate' && x.document ? x.document : x);

const USAGE = `node examples/mandate.ts mandate <principal> <agent> <club> <buyer|seller> <the most per deal, base units> <the most per day, base units> [--days <n> | --expires-at <ISO>] [--sim]
node examples/mandate.ts delegation <principal> <agent> <deal key> <deal encryption key> <club> <buyer|seller> <the most for this deal, base units> <expires at, ISO> [--sim]
node examples/mandate.ts revocation <principal> <agent> [--expires-at <ISO>] [--sim]
node examples/mandate.ts verify <typed-data file> <signature> [--principal <address>] [--mandate <file>] [--at <ISO>] [--sim]
Builds a message for a signature made elsewhere (a hardware wallet) and verifies a signed one. It takes no private key.`;

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const flag = (name: string, n: number) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, n + 1).slice(1);
  };
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE), 0;
  // Rung 1: this tool holds no key. A 32-byte hex value among the arguments is most likely one pasted by mistake.
  if (args.some((a) => /^(0[xX])?[0-9a-fA-F]{64}$/.test(a.trim()))) return refuse('an argument is 32 bytes of hex, the size of a private key: this tool takes no key, and builds the nonce itself');
  const sim = flag('--sim', 0) !== undefined, days = flag('--days', 1), expiresAt = flag('--expires-at', 1), at = flag('--at', 1), mandateFile = flag('--mandate', 1), principal = flag('--principal', 1);
  const pin = pinFor({ sim, deployment: process.env['HOLDBACK_DEPLOYMENT'] });
  const [command, ...rest] = args;
  const emit = (kind: Kind, doc: J) => {
    const h = hashesOf(kind, doc, pin.domain);
    console.log(JSON.stringify(fileOf(kind, doc, pin.domain), null, 2));
    console.error(`digest ${h.digest} (domain hash ${h.domainHash}, message hash ${h.messageHash}): ${sentenceOf(kind, doc, pin.token)} Sign the file where the ${SIGNER[kind]}'s key is, then run: node examples/mandate.ts verify <file> <signature>${sim ? ' --sim' : ''}`);
    return 0;
  };
  const role = (r: string | undefined) => (r === 'buyer' || r === 'seller' ? r : refuse(`the role is buyer or seller, not ${shown(r)}`));
  if (command === 'mandate' && rest.length === 6) {
    const [p, agent, clubId, r, perDeal, perDay] = rest as [string, string, string, string, string, string];
    if (days && !/^[1-9][0-9]{0,6}$/.test(days[0] ?? '')) refuse('--days is a whole number of days, 1 or more');
    if (days && expiresAt) refuse('give --days or --expires-at, not both');
    return emit('Mandate', buildMandate({ principal: p, agent, clubId, role: role(r), maxPerDeal: perDeal, maxPerDay: perDay, token: pin.token.id, ...(days ? { days: Number(days[0]) } : {}), ...(expiresAt ? { expiresAt: expiresAt[0]! } : {}) }));
  }
  if (command === 'delegation' && rest.length === 8) {
    const [p, agent, dealKey, dealEncryptionKey, clubId, r, cap, until] = rest as [string, string, string, string, string, string, string, string];
    return emit('Delegation', buildDelegation({ principal: p, agent, dealKey, dealEncryptionKey, clubId, role: role(r), cap, token: pin.token.id, expiresAt: until }));
  }
  if (command === 'revocation' && rest.length === 2) return emit('AgentRevocation', buildRevocation({ principal: rest[0]!, agent: rest[1]!, ...(expiresAt ? { expiresAt: expiresAt[0]! } : {}) }));
  if (command === 'verify' && rest.length === 2) {
    const file = parseStrictJson(readFileSync(rest[0]!, 'utf8'), rest[0]);
    const when = at ? Date.parse(time(at[0], '--at')) : undefined;
    const mandate = mandateFile ? mandateDocument(parseStrictJson(readFileSync(mandateFile[0]!, 'utf8'), mandateFile[0])) : undefined;
    const v = await verifyFile(file, rest[1]!, pin.domain, { ...(when !== undefined ? { at: when } : {}), ...(mandate ? { mandate } : {}), ...(principal ? { principal: principal[0]! } : {}) });
    console.log(JSON.stringify({ ok: true, kind: v.kind, signer: v.signer, digest: v.digest, domainHash: v.domainHash, messageHash: v.messageHash, inEffectUntil: v.inEffectUntil, ...(principal ? { principalChecked: true } : { principalChecked: false }), ...(v.kind === 'Delegation' ? { fitsMandate: true } : {}), ...(v.revokesMandate ? { revokesMandate: true } : {}), document: v.document }));
    console.error(`${sentenceOf(v.kind, v.document, pin.token)}${principal || v.kind === 'Delegation' ? '' : ' The principal was not checked against one you expect: pass --principal.'}`);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (isMain(import.meta.url, 'mandate')) {
  main(process.argv.slice(2)).then(
    (code) => void (process.exitCode = code),
    (e: unknown) => {
      console.error(printable((e as Error).message));
      process.exitCode = e instanceof Refusal ? 3 : 1;
    },
  );
}
