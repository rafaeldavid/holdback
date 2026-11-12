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
  schemaVersion: '0.8',
  clubId: 'data-services-v1',
  rulebookHash: h('11'),
  buyer: B,
  seller: A,
  buyerPaymentAddress: B,
  sellerPayoutAddress: A,
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
    'CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,address buyerPaymentAddress,address sellerPayoutAddress,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,Disclosure disclosure,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)' +
    'Adjudication(address adjudicator,address fallbackAdjudicator,address appealAdjudicator,string policyId,TokenAmount fee,bytes32 registryHash,bytes32 policyHash)' +
    'Disclosure(string level)' +
    'Remedy(string onReject)Settlement(string mode,string token)' +
    'Timing(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,uint64 disputeJudgeSec,uint64 disputeFallbackSec)' +
    TOKEN,
};

// Digests of the fixtures above under holdbackDomain(31337).
const digestPins: Record<string, Hex> = {
  Offer: '0xc6e21e1a59dea35e3db69e6fe0bb403d01ed83b35b8f00dce86cc5450a267043',
  Agree: '0xd71e8d67e4814c5b3f3e136b61669d0d4046a758d9b8296f44e5cc34ef115e9d',
  AdjudicatorAcceptance: '0x1d618ff47e79c5d8866dd0203b47d6264651703b88195ae6c1dafd6ec2fa3d34',
  FundingAuthorization: '0x861bba02d6cd4a9e9c0af6eef931b0cc71e0131728197c2a9e688afeb8915c59',
  EarlyAccept: '0xe320a9e1e5b563f6712de7f605397e44bb3b2c327d09e5f43974fcf88f091de4',
  Decision: '0xcbc88b85518085967ff17aa0380fa625be10a3ed4d47d9170ddd93ddf1dca7b6',
  AgentRevocation: '0xef14c0c06c8ee1c92c42a1d5626121149f46e69bd3b53731912a78c6d3e09922',
  MemberAdmission: '0x93ec1c5488107a1f4667f6dfda18d076f15243484cbcdc95fb60596b04e3b218',
  MemberRevocation: '0xcbfde1e289953929b8c71d34a243ed382b551427a3f4e161be105a0fd59eb810',
  Dispute: '0x9bc11f46154e59dbf11bed04e8ec99ae052308bae6d009c9aa94ae3764b39e8b',
  Receipt: '0x7fd76f264f42127d85782fdbd4ee63131b9f9751b5fc2c0397e9a11e148aacbb',
  Publish: '0x4b35150e903160db30d980b6d742e8b9975e312d8942f46907e73df7987090dc',
  MutualSettlement: '0x82bce7df3f63ca86861d23c57bde6b09149375d6596b292527075ff055075a93',
  Delivery: '0x88ee48b6faf01a5641d4416fb018c80361a53e3e6fb372e332810551b444ba32',
  Appeal: '0xce716388f78f157c6dd6ee18572af9daf838cb4a244912f275f19e35bc3f88d1',
  Mandate: '0x5fa879cce8bda68119b5c417e3c87f5ac642a72adcd81db67baca930dd203e44',
  TransferAuthorization: '0x068da255be29a635ec06af2b32519aadd21c6183d29c32a329b4fc8720754e87',
  ReadToken: '0xaf6ff6a1bc7409b783fdaf82074ec496af27435b2d6a3ec02bd8539e833fd082',
  Delegation: '0x7c3c0b07bb158bebbe63bf9a2425c2990643c02c87e906dee07bf8b178e90928',
  KeyRegistration: '0xf69f65f7b28d45c092eec9f7b41e5fd19b4e1d0f71198ac2744a3379f82d7710',
  AdjudicatorRegistration: '0x6bc7c12b513432a57f7c08a80673bbaddf145fe0593a1d35371ed747213b1766',
  CommitmentTerms: '0x5e8149bb4b432dd21a4e334ccd8c8ca820d76fc09927cf09e16fd7ddeee20498',
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
    [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(stringToHex('Holdback')), keccak256(stringToHex('0.8')), 31337n, SIMCHAIN_VERIFYING_CONTRACT],
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
