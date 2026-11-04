// Pins what every signature binds. A field dropped from both a type and its encoder changes the
// encodeType string and the digest, so these tests fail. Changing a pin changes every signature of
// that type in the system: it needs an ADR.
import { concat, encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  eip712Types,
  holdbackDomain,
  messageDigest,
  messageTypes,
  SIMCHAIN_VERIFYING_CONTRACT,
  termsDigest,
  typedDataOf,
  typedTermsOf,
  type UnsignedMessage,
} from './eip712.js';
import type { CommitmentTerms } from './types.js';

const domain = holdbackDomain(31337);
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const h = (byte: string): Hex => `0x${byte.repeat(32)}`;
const tusd = (amount: string) => ({ token: 'tUSD', amount: amount as never });
const at = '2026-10-30T10:15:00Z';

export const fixtures: Record<string, UnsignedMessage> = {
  Offer: { type: 'Offer', commitmentId: h('01'), seller: A, nonce: h('02'), expiresAt: at },
  Agree: { type: 'Agree', commitmentId: h('01'), buyer: B, nonce: h('03'), expiresAt: at },
  AdjudicatorAcceptance: {
    type: 'AdjudicatorAcceptance',
    commitmentId: h('01'),
    adjudicator: C,
    seedCommitment: h('04'),
    policyHash: h('05'),
    registryHash: h('06'),
    fee: tusd('50000000'),
    bondReserved: tusd('2000000000'),
    nonce: h('07'),
    expiresAt: at,
  },
  FundingAuthorization: {
    type: 'FundingAuthorization',
    scheme: 'erc3009',
    commitmentId: h('01'),
    from: B,
    value: '2050000000',
    token: 'tUSD',
    validAfter: '2026-10-30T10:00:00Z',
    validBefore: '2026-10-30T10:30:00Z',
    nonce: h('08'),
    expiresAt: at,
  },
  EarlyAccept: { type: 'EarlyAccept', commitmentId: h('01'), buyer: B, attempt: 1, deliveryHash: h('1d'), nonce: h('09'), expiresAt: at },
  Decision: {
    type: 'Decision',
    commitmentId: h('01'),
    attempt: 1,
    deliveryHash: h('1d'),
    adjudicator: C,
    role: 'appeal',
    outcome: 'accept',
    seed: h('0a'),
    policyHash: h('05'),
    registryHash: h('06'),
    judgmentRecordHash: h('0b'),
    keyForBuyer: { scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' },
    appealGround: 'wrong-outcome',
    beacon: { source: 'drand-quicknet', round: 1200, value: h('13'), signature: '0xabcd' },
    // The schema allows encryptedKeys on escalate only; this fixture pins the encoding, not that rule.
    encryptedKeys: [{ recipient: B, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5Mw', unlock: { kind: 'beacon-round', round: 1300 } }],
    nonce: h('0c'),
    expiresAt: at,
  },
  AgentRevocation: { type: 'AgentRevocation', agent: A, principal: B, nonce: h('0d'), expiresAt: at },
  MemberAdmission: { type: 'MemberAdmission', clubId: 'data-services-v1', member: B, operator: C, validUntil: '2027-10-30T00:00:00Z', nonce: h('0e'), expiresAt: at },
  MemberRevocation: { type: 'MemberRevocation', clubId: 'data-services-v1', member: B, operator: C, nonce: h('0f'), expiresAt: at },
  Dispute: {
    type: 'Dispute',
    commitmentId: h('01'),
    buyer: B,
    attempt: 1,
    grounds: 'duplicate keys',
    bond: tusd('25000000'),
    fee: tusd('50000000'),
    encryptedKeys: [{ recipient: C, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5NA' }],
    nonce: h('14'),
    expiresAt: at,
  },
  Receipt: { type: 'Receipt', operator: A, eventSeq: 42, eventHash: h('15'), commitmentId: h('01') },
  Publish: { type: 'Publish', commitmentId: h('01'), level: 'judgment', nonce: h('18'), expiresAt: at },
  MutualSettlement: {
    type: 'MutualSettlement',
    commitmentId: h('01'),
    deliveryHash: h('16'),
    payouts: [
      { to: B, amount: tusd('1200000000') },
      { to: '0x9999999999999999999999999999999999999999', amount: tusd('800000000') },
    ],
    releaseKey: true,
    nonce: h('17'),
    expiresAt: at,
  },
  Delivery: {
    type: 'Delivery',
    commitmentId: h('01'),
    attempt: 1,
    ciphertext: { uri: 'file:///store/abc', sha256: `sha256:${'a'.repeat(64)}`, bytes: 1024, cipher: 'aes-256-gcm' },
    plaintextSha256: `sha256:${'b'.repeat(64)}`,
    plaintextMime: 'text/csv',
    encryptedKeys: [
      { recipient: C, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5MQ', unlock: { kind: 'beacon-round', round: 1250 } },
      { recipient: B, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5Mg' },
    ],
    submittedAt: '2026-11-01T09:00:00Z',
  },
  Appeal: { type: 'Appeal', commitmentId: h('01'), appellant: 'buyer', appellantAddress: B, grounds: 'wrong-outcome', bond: tusd('100000000'), filedAt: '2026-11-01T10:05:00Z' },
  Mandate: {
    type: 'Mandate',
    principal: B,
    agent: A,
    clubId: 'data-services-v1',
    scope: { roles: ['buyer', 'seller'], maxPerCommitment: tusd('5000000000'), maxDaily: tusd('9000000000'), categories: ['data'], expiresAt: '2027-01-01T00:00:00Z' },
    nonce: h('10'),
    issuedAt: '2026-10-01T00:00:00Z',
  },
  TransferAuthorization: {
    type: 'TransferAuthorization',
    scheme: 'erc3009',
    purpose: 'operator_fee',
    commitmentId: h('01'),
    from: B,
    to: C,
    value: '200000',
    token: 'tUSD',
    validAfter: '2026-10-30T10:00:00Z',
    validBefore: '2026-10-30T10:30:00Z',
    nonce: h('19'),
    expiresAt: at,
  },
  ReadToken: { type: 'ReadToken', viewer: B, commitmentId: h('01'), audience: C, nonce: h('1a'), expiresAt: at },
  Delegation: {
    type: 'Delegation',
    principal: B,
    agent: A,
    dealKey: C,
    dealEncryptionKey: 'a2V5NQ',
    clubId: 'data-services-v1',
    scope: { roles: ['seller'], maxPerCommitment: tusd('5000000000'), maxDaily: tusd('9000000000'), categories: ['data'], expiresAt: '2027-01-01T00:00:00Z' },
    nonce: h('1b'),
    expiresAt: at,
  },
  KeyRegistration: { type: 'KeyRegistration', adjudicator: C, encryptionPublicKey: 'a2V5Ng', keyId: 'bench-a/2026-11', nonce: h('1c'), expiresAt: at },
  // ADR-0030: a new type in schema 0.10, so the domain stays 0.7.
  AdjudicatorRegistration: {
    type: 'AdjudicatorRegistration',
    adjudicator: C,
    encryptionPublicKey: 'a2V5Nw',
    keyId: 'bench-a/2026-11',
    policyHash: h('05'),
    registryHash: h('06'),
    fee: tusd('25000000'),
    poolTermsHash: h('1d'),
    bodyHash: h('1e'),
    issuedAt: '2026-10-30T10:00:00Z',
    nonce: h('1f'),
    expiresAt: at,
  },
};

export const terms: CommitmentTerms = {
  schemaVersion: '0.7',
  clubId: 'data-services-v1',
  rulebookHash: h('11'),
  buyer: B,
  seller: A,
  deliverable: { kind: 'dataset', description: 'Clean customers.csv', format: 'text/csv' },
  acceptance: { deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id'] }], rubric: { criteria: [], passThreshold: 3 } },
  price: tusd('2000000000'),
  adjudication: { adjudicator: C, fallbackAdjudicator: A, appealAdjudicator: B, policyId: 'p1', fee: tusd('50000000'), registryHash: h('06'), policyHash: h('05') },
  timing: {
    offerExpiresAt: at,
    fundBy: '2026-10-30T10:30:00Z',
    deliverBy: '2026-11-01T10:00:00Z',
    judgeBy: '2026-11-01T10:02:00Z',
    fallbackBy: '2026-11-01T10:04:00Z',
    appealWindowSec: 300,
    appealDecideSec: 300,
    maxSubmissions: 1,
  },
  settlement: { mode: 'guaranteed_on_decision', token: 'tUSD' },
  remedy: { onReject: 'full_refund' },
  disclosure: { level: 'public' },
  buyerEncryptionPublicKey: 'a2V5',
  nonce: h('12'),
  createdAt: '2026-10-30T10:00:00Z',
};

const TOKEN = 'TokenAmount(string token,uint256 amount)';
const encodeTypePins: Record<string, string> = {
  Offer: 'Offer(bytes32 commitmentId,address seller,bytes32 nonce,uint64 expiresAt)',
  Agree: 'Agree(bytes32 commitmentId,address buyer,bytes32 nonce,uint64 expiresAt)',
  AdjudicatorAcceptance: `AdjudicatorAcceptance(bytes32 commitmentId,address adjudicator,bytes32 seedCommitment,bytes32 policyHash,bytes32 registryHash,TokenAmount fee,TokenAmount bondReserved,bytes32 nonce,uint64 expiresAt)${TOKEN}`,
  FundingAuthorization:
    'FundingAuthorization(string scheme,bytes32 commitmentId,address from,uint256 value,string token,uint64 validAfter,uint64 validBefore,bytes32 nonce,uint64 expiresAt)',
  EarlyAccept: 'EarlyAccept(bytes32 commitmentId,address buyer,uint8 attempt,bytes32 deliveryHash,bytes32 nonce,uint64 expiresAt)',
  Decision:
    'Decision(bytes32 commitmentId,uint8 attempt,bytes32 deliveryHash,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,Beacon beacon,EncryptedKey[] encryptedKeys,bytes32 nonce,uint64 expiresAt)' +
    'Beacon(string source,uint64 round,bytes32 value,bytes signature)EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)KeyUnlock(string kind,uint64 round)SealedKey(string scheme,string ciphertext)',
  AgentRevocation: 'AgentRevocation(address agent,address principal,bytes32 nonce,uint64 expiresAt)',
  MemberAdmission: 'MemberAdmission(string clubId,address member,address operator,uint64 validUntil,bytes32 nonce,uint64 expiresAt)',
  MemberRevocation: 'MemberRevocation(string clubId,address member,address operator,bytes32 nonce,uint64 expiresAt)',
  Dispute: `Dispute(bytes32 commitmentId,address buyer,uint8 attempt,string grounds,TokenAmount bond,TokenAmount fee,EncryptedKey[] encryptedKeys,bytes32 nonce,uint64 expiresAt)EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)KeyUnlock(string kind,uint64 round)${TOKEN}`,
  Publish: 'Publish(bytes32 commitmentId,string level,bytes32 nonce,uint64 expiresAt)',
  Receipt: 'Receipt(address operator,uint64 eventSeq,bytes32 eventHash,bool hasCommitment,bytes32 commitmentId)',
  MutualSettlement: 'MutualSettlement(bytes32 commitmentId,bool hasDelivery,bytes32 deliveryHash,Payout[] payouts,bool releaseKey,bytes32 nonce,uint64 expiresAt)Payout(address to,TokenAmount amount)TokenAmount(string token,uint256 amount)',
  Delivery:
    'Delivery(bytes32 commitmentId,uint8 attempt,Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,uint64 submittedAt)Ciphertext(string uri,string sha256,uint64 bytes,string cipher)EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)KeyUnlock(string kind,uint64 round)',
  Appeal: `Appeal(bytes32 commitmentId,string appellant,address appellantAddress,string grounds,TokenAmount bond,uint64 filedAt)${TOKEN}`,
  Mandate: `Mandate(address principal,address agent,string clubId,Scope scope,bytes32 nonce,uint64 issuedAt)Scope(string[] roles,TokenAmount maxPerCommitment,TokenAmount maxDaily,bool hasCategories,string[] categories,uint64 expiresAt)${TOKEN}`,
  TransferAuthorization:
    'TransferAuthorization(string scheme,string purpose,bytes32 commitmentId,address from,address to,uint256 value,string token,uint64 validAfter,uint64 validBefore,bytes32 nonce,uint64 expiresAt)',
  ReadToken: 'ReadToken(address viewer,bytes32 commitmentId,bool hasAudience,address audience,bytes32 nonce,uint64 expiresAt)',
  Delegation: `Delegation(address principal,address agent,address dealKey,string dealEncryptionKey,string clubId,Scope scope,bytes32 nonce,uint64 expiresAt)Scope(string[] roles,TokenAmount maxPerCommitment,TokenAmount maxDaily,bool hasCategories,string[] categories,uint64 expiresAt)${TOKEN}`,
  KeyRegistration: 'KeyRegistration(address adjudicator,string encryptionPublicKey,string keyId,bytes32 nonce,uint64 expiresAt)',
  AdjudicatorRegistration: `AdjudicatorRegistration(address adjudicator,string encryptionPublicKey,string keyId,bytes32 policyHash,bytes32 registryHash,TokenAmount fee,bytes32 poolTermsHash,bytes32 bodyHash,uint64 issuedAt,bytes32 nonce,uint64 expiresAt)${TOKEN}`,
  CommitmentTerms:
    'CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,Disclosure disclosure,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)' +
    'Adjudication(address adjudicator,address fallbackAdjudicator,address appealAdjudicator,string policyId,TokenAmount fee,bytes32 registryHash,bytes32 policyHash)' +
    'Disclosure(string level)' +
    'Remedy(string onReject)Settlement(string mode,string token)' +
    'Timing(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,uint64 disputeJudgeSec,uint64 disputeFallbackSec)' +
    TOKEN,
};

// Digests of the fixtures above under holdbackDomain(31337).
const digestPins: Record<string, Hex> = {
  Offer: '0x22c26504d40fe5e8c720ebf44c657e53225aece83935f83e6f30716dcf336e64',
  Agree: '0xc01dd708daf9b7dca1073587e01cc580938eabe07a80ae3bf43a9ae50651f851',
  AdjudicatorAcceptance: '0x36ad2ebe15c7421dd89d244b60bdd61e9cba5a08f958f29bbfdcf121378fc01d',
  FundingAuthorization: '0x691f1ec03351d75ef7ef4c2514ff9be1cc43d640272817ad4bb9a3316d6f935d',
  EarlyAccept: '0x903934dbb678e3103924d708bdc1c0013a6a28df8fa02c25da1281291373cec5',
  Decision: '0x29f39a52154bd2cbf477392ce424b8b6e741e70960164aebe647708573d35b20',
  AgentRevocation: '0x69bdde5116fed175411e60bc11aa4203f7c0fc19b26f0da71f31c5feec23bf3e',
  MemberAdmission: '0xd50b50791f99207a1bacbd051265bdf87a2c154b8d7d31a945de60bdbee3b31f',
  MemberRevocation: '0x8fdff2f935c3e39862878ae3445fb674ae1f637ffc3334ee76295a8f4f57e05c',
  Dispute: '0xfb0d307fed62abc138682698fc23c98880f06966f3cf1264a011b25c06a7242f',
  Receipt: '0xdf30b8716ef19c659b2b69354134635c26d91ed75666ef867e98da92627308c3',
  Publish: '0x9dfa9972dbd187eb7cf5d21e31ecb769c5c5e9d08f8f904c1a99aaa2ca77221a',
  MutualSettlement: '0xbde7a6e5536eb429ee21215afd08fe08c794d4afccab2abea3606c0181f087ad',
  Delivery: '0xbf4c97a3297c3b441097739acfd6616400dcd1eea8c3dbac076766e8a97dca97',
  Appeal: '0x54080ee0cc8c92a61588df9c49495294aa58be046c1fc15cd616352f69a05fa8',
  Mandate: '0x10bb5c72e481809cedb23b4d52fd6b16f6dd816116396b1905890d949f06a63c',
  TransferAuthorization: '0x3d5a2f5281bce38ffe49ba1643fb34bb8f5a80eb4e72fef0c3973035f8cdaf42',
  ReadToken: '0x8d7e74363e4f5f5adc3a66faaf441f26fe4fe0d8abe21cedf2f8307f27986bf2',
  Delegation: '0xe54275c69e54db3999f5fb1db14340ccb942b507cf50e2b48aa8858dd8232525',
  KeyRegistration: '0x05549f3b21a613695d0e150061bd5e67eb8f433bf59a2eac1738c888eae46e0e',
  AdjudicatorRegistration: '0xab599c0bcba50a87775692f12518353aeb459cc698db479b713456c5b3e98a38',
  CommitmentTerms: '0x0efe5c62867daa76f58889d43b424ab16d2a4a48fa03aa4511288f9bf9d45d75',
};

// A second, hand-written EIP-712 implementation (encodeType, encodeData, hashStruct, domain separator)
// using only keccak256 and ABI encoding, to cross-check viem's typed-data hashing.
type Fields = ReadonlyArray<{ name: string; type: string }>;
const types = eip712Types as unknown as Record<string, Fields>;

function deps(type: string, found = new Set<string>()): Set<string> {
  for (const f of types[type] ?? []) {
    const base = f.type.replace(/\[\]$/, '');
    if (types[base] && !found.has(base)) {
      found.add(base);
      deps(base, found);
    }
  }
  return found;
}

function encodeType(primary: string): string {
  const fmt = (t: string) => `${t}(${(types[t] ?? []).map((f) => `${f.type} ${f.name}`).join(',')})`;
  return [primary, ...[...deps(primary)].filter((d) => d !== primary).sort()].map(fmt).join('');
}

function word(type: string, value: unknown): Hex {
  if (type.endsWith('[]')) {
    const inner = type.slice(0, -2);
    return keccak256(concat((value as unknown[]).map((v) => word(inner, v))));
  }
  if (types[type]) return hashStruct(type, value as Record<string, unknown>);
  if (type === 'string') return keccak256(stringToHex(value as string));
  // EIP-712 hashes dynamic bytes like strings, by their contents.
  if (type === 'bytes') return keccak256(value as Hex);
  return encodeAbiParameters([{ type }], [value]);
}

function hashStruct(type: string, data: Record<string, unknown>): Hex {
  const fields = types[type]!;
  return keccak256(concat([keccak256(stringToHex(encodeType(type))), ...fields.map((f) => word(f.type, data[f.name]))]));
}

const domainSeparator = keccak256(
  encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(stringToHex('Holdback')), keccak256(stringToHex('0.7')), 31337n, SIMCHAIN_VERIFYING_CONTRACT],
  ),
);
const handDigest = (primaryType: string, message: Record<string, unknown>): Hex => keccak256(concat(['0x1901', domainSeparator, hashStruct(primaryType, message)]));

type Leaf = string | number | boolean;
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

const names = Object.keys(fixtures);

describe('EIP-712 bindings', () => {
  it('has a fixture and an encodeType pin for every message type', () => {
    expect([...names].sort()).toEqual(Object.keys(messageTypes).sort());
    expect(Object.keys(encodeTypePins).sort()).toEqual([...Object.keys(messageTypes), 'CommitmentTerms'].sort());
  });

  it.each(Object.entries(encodeTypePins))('pins the encodeType of %s', (name, pinned) => {
    expect(encodeType(name)).toBe(pinned);
  });

  it.each(names)('pins the digest of %s', (name) => {
    expect(messageDigest(domain, fixtures[name]!)).toBe(digestPins[name]);
  });

  it('pins the digest of the terms', () => {
    expect(termsDigest(domain, terms)).toBe(digestPins['CommitmentTerms']);
  });

  it.each(names)('agrees with a hand-written EIP-712 implementation for %s', (name) => {
    const t = typedDataOf(fixtures[name]!);
    expect(handDigest(t.primaryType, t.message)).toBe(messageDigest(domain, fixtures[name]!));
  });

  it('agrees with a hand-written EIP-712 implementation for the terms', () => {
    expect(handDigest('CommitmentTerms', typedTermsOf(terms))).toBe(termsDigest(domain, terms));
  });

  const cases = names.flatMap((name) =>
    leaves(fixtures[name])
      .filter((l) => l.path[0] !== 'type')
      .map((l) => [`${name}.${l.path.join('.')}`, name, l] as const),
  );

  it.each(cases)('changes the digest when %s changes', (_label, name, { path, value }) => {
    const changed = structuredClone(fixtures[name]!);
    setPath(changed, path, mutate(value));
    expect(messageDigest(domain, changed)).not.toBe(messageDigest(domain, fixtures[name]!));
  });

  it.each([
    ['Decision.keyForBuyer', 'Decision', 'keyForBuyer'],
    ['Decision.appealGround', 'Decision', 'appealGround'],
    ['Decision.beacon', 'Decision', 'beacon'],
    ['Decision.encryptedKeys', 'Decision', 'encryptedKeys'],
  ] as const)('changes the digest when %s is removed', (_label, name, key) => {
    const changed = structuredClone(fixtures[name]!) as Record<string, unknown>;
    delete changed[key];
    expect(messageDigest(domain, changed as UnsignedMessage)).not.toBe(messageDigest(domain, fixtures[name]!));
  });

  it('binds the beacon signature when present', () => {
    const d = fixtures['Decision'] as Extract<UnsignedMessage, { type: 'Decision' }>;
    const { signature: _s, ...unsigned } = d.beacon!;
    void _s;
    expect(messageDigest(domain, { ...d, beacon: unsigned })).not.toBe(messageDigest(domain, d));
  });

  it('distinguishes a settlement before delivery (null deliveryHash) from a zero delivery hash', () => {
    const m = fixtures['MutualSettlement'] as Extract<UnsignedMessage, { type: 'MutualSettlement' }>;
    const before: UnsignedMessage = { ...m, deliveryHash: null };
    const zero: UnsignedMessage = { ...m, deliveryHash: `0x${'0'.repeat(64)}` };
    expect(messageDigest(domain, before)).not.toBe(messageDigest(domain, zero));
  });

  it('distinguishes a receipt with no commitment from one for a zero commitment ID', () => {
    const r = fixtures['Receipt'] as Extract<UnsignedMessage, { type: 'Receipt' }>;
    const { commitmentId: _c, ...none } = r;
    void _c;
    expect(messageDigest(domain, none)).not.toBe(messageDigest(domain, { ...r, commitmentId: `0x${'0'.repeat(64)}` }));
  });

  it('distinguishes absent categories from an empty list in a Mandate scope', () => {
    const m = fixtures['Mandate'] as Extract<UnsignedMessage, { type: 'Mandate' }>;
    const { categories: _c, ...noCategories } = m.scope;
    void _c;
    const absent: UnsignedMessage = { ...m, scope: noCategories };
    const empty: UnsignedMessage = { ...m, scope: { ...noCategories, categories: [] } };
    expect(messageDigest(domain, absent)).not.toBe(messageDigest(domain, empty));
  });
});
