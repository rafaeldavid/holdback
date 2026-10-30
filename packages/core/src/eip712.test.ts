import { readFileSync } from 'node:fs';
import { concat, encodeAbiParameters, keccak256, recoverAddress, stringToHex, type Hex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import {
  commitmentId,
  holdbackDomain,
  messageTypes,
  SIMCHAIN_VERIFYING_CONTRACT,
  signMessage,
  signTerms,
  termsOf,
  verifyCoSigned,
  verifyMessage,
  verifyMutualSettlement,
  verifyTerms,
  type UnsignedMessage,
} from './eip712.js';
import { parseCommitment, parseMessage } from './parse.js';
import type { CommitmentTerms } from './types.js';

// Deterministic test keys derived from labels. Never real keys.
const sellerKey = keccak256(stringToHex('holdback/test/seller'));
const otherKey = keccak256(stringToHex('holdback/test/other'));
const seller = privateKeyToAddress(sellerKey);

const domain = holdbackDomain(31337);

function loadExample(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../spec/examples/${file}`, import.meta.url), 'utf8'));
}

const parsed = parseCommitment(loadExample('commitment.example.json'));
if (!parsed.ok) throw new Error(parsed.error.detail);
const commitment = parsed.value;
const terms = termsOf(commitment);

// Pinned vectors. A change here changes every commitment ID and signature in the system: it needs an ADR.
const EXAMPLE_TERMS_ID = '0x46d5a182cc784a5c1d72d1c26081bd6c663894cfb197feddbc384cc1e51536a1';
const SELLER_ADDRESS = '0xDdC55D01F41A079E14F7Cbb3902ec14e1e8d3ce6';
const EXAMPLE_TERMS_SELLER_SIGNATURE =
  '0xe8d2025456ab65ebf2533742248ec18b09e5f6092e26d501a7c9adf4ddafd66372d5ea039dd9a3a3b2973198da267b1e82caeff51fd34fd21f05b6b4c8d327e11b';

// Distributes over unions, so removing `signature` from a SignedMessage keeps each variant.
function without<T extends object, K extends keyof T>(obj: T, key: K): T extends unknown ? Omit<T, K> : never {
  const copy: Partial<T> = { ...obj };
  delete copy[key];
  return copy as T extends unknown ? Omit<T, K> : never;
}

type Leaf = string | number | boolean;

// Every leaf path in the terms, so the "any term changes the ID" test cannot miss a field.
function leaves(value: unknown, path: string[] = []): Array<{ path: string[]; value: Leaf }> {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, String(i)]));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [{ path, value: value as Leaf }];
}

function mutate(v: Leaf): Leaf {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v + 1;
  if (/^0x[0-9a-fA-F]+$/.test(v)) return v.slice(0, -1) + (v.endsWith('0') ? '1' : '0');
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(Date.parse(v) + 1000).toISOString();
  if (/^\d+$/.test(v)) return (BigInt(v) + 1n).toString();
  return `${v}x`;
}

function setPath(obj: unknown, path: string[], v: Leaf): void {
  let cur = obj as Record<string, unknown>;
  for (const key of path.slice(0, -1)) cur = cur[key] as Record<string, unknown>;
  cur[path[path.length - 1]!] = v;
}

describe('domain', () => {
  it('is Holdback 0.5 with the SimChain placeholder contract by default', () => {
    expect(domain).toEqual({ name: 'Holdback', version: '0.5', chainId: 31337n, verifyingContract: SIMCHAIN_VERIFYING_CONTRACT });
    expect(SIMCHAIN_VERIFYING_CONTRACT).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('commitment ID', () => {
  it('binds the optimistic dispute timing (review of PR 23)', () => {
    const optimistic = (disputeBy: string) =>
      ({
        ...terms,
        settlement: { mode: 'optimistic', token: terms.settlement.token },
        timing: { ...terms.timing, disputeBy, disputeJudgeSec: 86400, disputeFallbackSec: 86400 },
      }) as never;
    const a = commitmentId(optimistic('2026-11-06T17:00:00Z'));
    expect(commitmentId(optimistic('2026-11-06T17:00:01Z'))).not.toBe(a);
    const judge = { ...(optimistic('2026-11-06T17:00:00Z') as { timing: object }), timing: { ...(optimistic('2026-11-06T17:00:00Z') as { timing: object }).timing, disputeJudgeSec: 86401 } };
    expect(commitmentId(judge as never)).not.toBe(a);
    const fallback = { ...(optimistic('2026-11-06T17:00:00Z') as { timing: object }), timing: { ...(optimistic('2026-11-06T17:00:00Z') as { timing: object }).timing, disputeFallbackSec: 86401 } };
    expect(commitmentId(fallback as never)).not.toBe(a);
  });

  it('is stable for the example terms', () => {
    expect(commitmentId(terms)).toBe(EXAMPLE_TERMS_ID);
  });

  it('excludes id, signatures and the adjudicator acceptance', () => {
    expect(commitmentId(termsOf({ ...without(commitment, 'adjudicatorAcceptance'), id: `0x${'00'.repeat(32)}`, signatures: { seller: `0x${'11'.repeat(65)}` } }))).toBe(
      commitmentId(terms),
    );
  });

  const paths = leaves(terms);
  it('walks every leaf of the terms', () => {
    expect(paths.length).toBeGreaterThan(50);
  });

  it.each(paths.map((p) => [p.path.join('.'), p] as const))('changes when %s changes', (_name, { path, value }) => {
    const changed = structuredClone(terms);
    setPath(changed, path, mutate(value));
    expect(commitmentId(changed)).not.toBe(commitmentId(terms));
  });

  it('changes when an optional term is removed', () => {
    expect(commitmentId({ ...terms, acceptance: without(terms.acceptance, 'sealedChecks') })).not.toBe(commitmentId(terms));
    expect(commitmentId({ ...terms, deliverable: without(terms.deliverable, 'inputs') })).not.toBe(commitmentId(terms));
  });

  it('refuses a term that cannot be encoded rather than hashing something ambiguous', () => {
    const subSecond: CommitmentTerms = { ...terms, createdAt: '2026-10-30T10:00:00.500Z' };
    expect(() => commitmentId(subSecond)).toThrow(RangeError);
  });
});

describe('terms signatures', () => {
  it('derives a fixed seller address from the fixed test key', () => {
    expect(seller).toBe(SELLER_ADDRESS);
  });

  it('produces a fixed signature and recovers the signer', async () => {
    const sig = await signTerms(sellerKey, domain, terms);
    expect(sig).toBe(EXAMPLE_TERMS_SELLER_SIGNATURE);
    expect(await verifyTerms(domain, terms, sig, seller)).toBe(true);
  });

  it('rejects the wrong signer, changed terms and another chain', async () => {
    const sig = await signTerms(sellerKey, domain, terms);
    expect(await verifyTerms(domain, terms, sig, privateKeyToAddress(otherKey))).toBe(false);
    expect(await verifyTerms(domain, { ...terms, price: { token: 'tUSD', amount: '1' as never } }, sig, seller)).toBe(false);
    expect(await verifyTerms(holdbackDomain(84532), terms, sig, seller)).toBe(false);
  });

  it('returns false for a malformed signature instead of throwing', async () => {
    expect(await verifyTerms(domain, terms, `0x${'ab'.repeat(65)}`, seller)).toBe(false);
  });
});

const messageFiles = ['messages.acceptance', 'messages.decision', 'messages.dispute', 'messages.funding', 'messages.member-admission'];

describe('message signatures', () => {
  it('verifies a mutual settlement only when buyer and seller both signed the identical struct', async () => {
    const r = parseMessage(loadExample('messages.mutual-settlement.example.json'));
    if (!r.ok || r.value.type !== 'MutualSettlement') throw new Error('expected a MutualSettlement');
    const { buyerSignature: _b, sellerSignature: _s, ...unsigned } = r.value;
    void _b;
    void _s;
    const buyerKey = otherKey;
    const buyer = privateKeyToAddress(buyerKey);
    const buyerSignature = await signMessage(buyerKey, domain, unsigned);
    const sellerSignature = await signMessage(sellerKey, domain, unsigned);
    const both = { ...unsigned, buyerSignature, sellerSignature };
    expect(await verifyMutualSettlement(domain, both, buyer, seller)).toBe(true);
    expect(await verifyMutualSettlement(domain, { ...both, sellerSignature: buyerSignature }, buyer, seller)).toBe(false);
    expect(await verifyMutualSettlement(domain, { ...both, sellerAmount: { token: 'tUSD', amount: '1' } as never }, buyer, seller)).toBe(false);
    expect(await verifyMutualSettlement(domain, { ...both, releaseKey: !both.releaseKey }, buyer, seller)).toBe(false);
  });

  it('verifies a Publish only when buyer and seller both signed it', async () => {
    const r = parseMessage(loadExample('messages.publish.example.json'));
    if (!r.ok || r.value.type !== 'Publish') throw new Error('expected a Publish');
    const { buyerSignature: _b, sellerSignature: _s, ...unsigned } = r.value;
    void _b;
    void _s;
    const buyer = privateKeyToAddress(otherKey);
    const both = { ...unsigned, buyerSignature: await signMessage(otherKey, domain, unsigned), sellerSignature: await signMessage(sellerKey, domain, unsigned) };
    expect(await verifyCoSigned(domain, both, buyer, seller)).toBe(true);
    expect(await verifyCoSigned(domain, { ...both, level: 'private' }, buyer, seller)).toBe(false);
    expect(await verifyCoSigned(domain, { ...both, buyerSignature: both.sellerSignature }, buyer, seller)).toBe(false);
  });

  it('defines EIP-712 types for all twelve messages plus Delivery, Appeal, Receipt and Mandate', () => {
    expect(Object.keys(messageTypes).sort()).toEqual(
      [
        'Offer',
        'Agree',
        'AdjudicatorAcceptance',
        'FundingAuthorization',
        'EarlyAccept',
        'Decision',
        'AgentRevocation',
        'MemberAdmission',
        'MemberRevocation',
        'Dispute',
        'MutualSettlement',
        'Publish',
        'Delivery',
        'Appeal',
        'Receipt',
        'Mandate',
      ].sort(),
    );
  });

  it.each(messageFiles)('signs and verifies %s', async (name) => {
    const r = parseMessage(loadExample(`${name}.example.json`));
    if (!r.ok) throw new Error(r.error.detail);
    if (r.value.type === 'MutualSettlement' || r.value.type === 'Publish') throw new Error('co-signed; covered below');
    const unsigned = without(r.value, 'signature');
    const sig = await signMessage(sellerKey, domain, unsigned);
    expect(await verifyMessage(domain, { ...unsigned, signature: sig }, seller)).toBe(true);
    expect(await verifyMessage(domain, { ...unsigned, signature: sig }, privateKeyToAddress(otherKey))).toBe(false);
    expect(await verifyMessage(domain, { ...unsigned, nonce: `0x${'00'.repeat(32)}`, signature: sig }, seller)).toBe(false);
  });

  const id = commitmentId(terms);
  const nonce: Hex = `0x${'01'.repeat(32)}`;
  const expiresAt = '2026-10-30T10:15:00Z';
  const scope = {
    roles: ['seller' as const],
    maxPerCommitment: { token: 'tUSD', amount: '5000000000' as never },
    maxDaily: { token: 'tUSD', amount: '9000000000' as never },
    expiresAt: '2027-01-01T00:00:00Z',
  };
  const others: UnsignedMessage[] = [
    { type: 'Offer', commitmentId: id, seller, nonce, expiresAt },
    { type: 'Agree', commitmentId: id, buyer: commitment.buyer, nonce, expiresAt },
    { type: 'EarlyAccept', commitmentId: id, buyer: commitment.buyer, attempt: 1, nonce, expiresAt },
    { type: 'AgentRevocation', agent: seller, principal: commitment.buyer, nonce, expiresAt },
    { type: 'MemberRevocation', clubId: 'data-services-v1', member: seller, operator: commitment.buyer, nonce, expiresAt },
    {
      type: 'Delivery',
      commitmentId: id,
      attempt: 1,
      ciphertext: { uri: 'file:///store/abc', sha256: `sha256:${'a'.repeat(64)}`, bytes: 1024, cipher: 'aes-256-gcm' },
      plaintextSha256: `sha256:${'b'.repeat(64)}`,
      plaintextMime: 'text/csv',
      encryptedKeys: [{ recipient: seller, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' }],
      submittedAt: '2026-11-01T09:00:00Z',
    },
    {
      type: 'Appeal',
      commitmentId: id,
      appellant: 'seller',
      appellantAddress: seller,
      grounds: 'wrong-outcome',
      bond: { token: 'tUSD', amount: '100000000' as never },
      filedAt: '2026-11-01T10:05:00Z',
    },
    { type: 'Mandate', principal: commitment.buyer, agent: seller, clubId: 'data-services-v1', scope, nonce, issuedAt: '2026-10-01T00:00:00Z' },
  ];

  it.each(others.map((m) => [m.type, m] as const))('signs and verifies %s', async (_type, unsigned) => {
    const sig = await signMessage(sellerKey, domain, unsigned);
    expect(await verifyMessage(domain, { ...unsigned, signature: sig } as never, seller)).toBe(true);
  });

  it('matches a hand-computed EIP-712 digest for an Offer', async () => {
    const hashType = (s: string) => keccak256(stringToHex(s));
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
        [hashType('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), hashType('Holdback'), hashType('0.5'), 31337n, SIMCHAIN_VERIFYING_CONTRACT],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }],
        [hashType('Offer(bytes32 commitmentId,address seller,bytes32 nonce,uint64 expiresAt)'), id, seller, nonce, BigInt(Date.parse(expiresAt) / 1000)],
      ),
    );
    const digest = keccak256(concat(['0x1901', domainSeparator, structHash]));
    const sig = await signMessage(sellerKey, domain, { type: 'Offer', commitmentId: id, seller, nonce, expiresAt });
    expect(await recoverAddress({ hash: digest, signature: sig })).toBe(seller);
  });

  it('binds the message type: an Agree signature does not verify as an Offer with the same fields', async () => {
    const agree: UnsignedMessage = { type: 'Agree', commitmentId: id, buyer: seller, nonce, expiresAt };
    const sig = await signMessage(sellerKey, domain, agree);
    expect(await verifyMessage(domain, { type: 'Offer', commitmentId: id, seller, nonce, expiresAt, signature: sig }, seller)).toBe(false);
  });

  it('distinguishes a Decision with and without a key for the buyer', async () => {
    const r = parseMessage(loadExample('messages.decision.example.json'));
    if (!r.ok || r.value.type !== 'Decision') throw new Error('bad example');
    const withKey = without(r.value, 'signature');
    const withoutKey = without(withKey, 'keyForBuyer');
    const sig = await signMessage(sellerKey, domain, withKey);
    expect(await verifyMessage(domain, { ...withoutKey, signature: sig }, seller)).toBe(false);
  });
});
