// Pins what every signature binds. A field dropped from both a type and its encoder changes the
// encodeType string and the digest, so these tests fail. Changing a pin changes every signature of
// that type in the system: it needs an ADR.
import { concat, encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  eip712Types,
  holdbackDomain,
  messageDigest,
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
  EarlyAccept: { type: 'EarlyAccept', commitmentId: h('01'), buyer: B, attempt: 1, nonce: h('09'), expiresAt: at },
  Decision: {
    type: 'Decision',
    commitmentId: h('01'),
    attempt: 1,
    adjudicator: C,
    role: 'appeal',
    outcome: 'accept',
    seed: h('0a'),
    policyHash: h('05'),
    registryHash: h('06'),
    judgmentRecordHash: h('0b'),
    keyForBuyer: { scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' },
    appealGround: 'wrong-outcome',
    beacon: { source: 'sim', round: 1200, value: h('13'), signature: '0xabcd' },
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
    nonce: h('14'),
    expiresAt: at,
  },
  Receipt: { type: 'Receipt', operator: A, eventSeq: 42, eventHash: h('15'), commitmentId: h('01') },
  MutualSettlement: {
    type: 'MutualSettlement',
    commitmentId: h('01'),
    deliveryHash: h('16'),
    sellerAmount: tusd('1200000000'),
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
      { recipient: C, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5MQ' },
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
};

export const terms: CommitmentTerms = {
  schemaVersion: '0.5',
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
  EarlyAccept: 'EarlyAccept(bytes32 commitmentId,address buyer,uint8 attempt,bytes32 nonce,uint64 expiresAt)',
  Decision:
    'Decision(bytes32 commitmentId,uint8 attempt,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,Beacon beacon,bytes32 nonce,uint64 expiresAt)' +
    'Beacon(string source,uint64 round,bytes32 value,bytes signature)SealedKey(string scheme,string ciphertext)',
  AgentRevocation: 'AgentRevocation(address agent,address principal,bytes32 nonce,uint64 expiresAt)',
  MemberAdmission: 'MemberAdmission(string clubId,address member,address operator,uint64 validUntil,bytes32 nonce,uint64 expiresAt)',
  MemberRevocation: 'MemberRevocation(string clubId,address member,address operator,bytes32 nonce,uint64 expiresAt)',
  Dispute: `Dispute(bytes32 commitmentId,address buyer,uint8 attempt,string grounds,TokenAmount bond,TokenAmount fee,bytes32 nonce,uint64 expiresAt)${TOKEN}`,
  Receipt: 'Receipt(address operator,uint64 eventSeq,bytes32 eventHash,bytes32 commitmentId)',
  MutualSettlement: `MutualSettlement(bytes32 commitmentId,bool hasDelivery,bytes32 deliveryHash,TokenAmount sellerAmount,bool releaseKey,bytes32 nonce,uint64 expiresAt)${TOKEN}`,
  Delivery:
    'Delivery(bytes32 commitmentId,uint8 attempt,Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,uint64 submittedAt)Ciphertext(string uri,string sha256,uint64 bytes,string cipher)EncryptedKey(address recipient,string scheme,string ciphertext)',
  Appeal: `Appeal(bytes32 commitmentId,string appellant,address appellantAddress,string grounds,TokenAmount bond,uint64 filedAt)${TOKEN}`,
  Mandate: `Mandate(address principal,address agent,string clubId,Scope scope,bytes32 nonce,uint64 issuedAt)Scope(string[] roles,TokenAmount maxPerCommitment,TokenAmount maxDaily,bool hasCategories,string[] categories,uint64 expiresAt)${TOKEN}`,
  CommitmentTerms:
    'CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)' +
    'Adjudication(address adjudicator,address fallbackAdjudicator,address appealAdjudicator,string policyId,TokenAmount fee,bytes32 registryHash,bytes32 policyHash)' +
    'Remedy(string onReject)Settlement(string mode,string token)' +
    'Timing(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions)' +
    TOKEN,
};

// Digests of the fixtures above under holdbackDomain(31337).
const digestPins: Record<string, Hex> = {
  Offer: '0x53289189a8ac9be37596868110da55b156946d4c6b409ce0b1c9add04165a800',
  Agree: '0x09c88607bff51077f239276582bb9df286a0311ab6f267311accbedf332b03da',
  AdjudicatorAcceptance: '0xacebf6ff92584830d13c78792efa6f7ef1f13c1edd6b94d2c3bd04153cfc46f6',
  FundingAuthorization: '0x75fc9c7b8284cb6b70e544cb8834bc693890fa6685999dd677072dd01c5118f9',
  EarlyAccept: '0xa78699f7b715d180b6e82f0655eb8b0db0a1d6d02230541d4833bb7651ec475e',
  Decision: '0xe388a2bb386d5c15bd6d8e4f38b7959c2bae3e8170d4d80363e2375c2927979d',
  AgentRevocation: '0x2e8948f37dd24a8f489f4892f45717e7d0b4e95e1e0031cc4726ac580634b6cc',
  MemberAdmission: '0x4c287d8c7afb55bbf264277e57cbc299aea5a7a42bdab1bae239d38fa0c34f89',
  MemberRevocation: '0x36305a20b58be29c84691558569d4cecb1b4b70deec0bb0da55c8520b3b5d0c7',
  Dispute: '0x96020a61b91f318e7b9119b288615065f1956694715a7995b32e3347a3813afa',
  Receipt: '0xb4f8e3fe53f0c7f60d3c9f1fa5cd1d05645f238fe22387bbbd53dd59bd08c8ca',
  MutualSettlement: '0xf67d31c60eafbed91f9861b505e20daa4c0cd50f2a427b256ce2dcdd34fbb257',
  Delivery: '0x79264ed942cc6530155b2a73ef9869ffc7b89936d9320b12376695713b553ba6',
  Appeal: '0x3e03f3cd8fc63ce6cbc48fd61d0f601f6cb70f264e19b9857216a669855ad86d',
  Mandate: '0xa088db37eba2b2334bbe9bce8b65934596b122f5b861d2be73384ef5876f9497',
  CommitmentTerms: '0xe2cb63c91a82889c237019a2439aebd9cc48cdd7c3384caf966e7ab647e7947c',
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
    [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(stringToHex('Holdback')), keccak256(stringToHex('0.5')), 31337n, SIMCHAIN_VERIFYING_CONTRACT],
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
  it('has a fixture for every primary message type', () => {
    expect(names.sort()).toEqual(Object.keys(encodeTypePins).filter((n) => n !== 'CommitmentTerms').sort());
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

  it('distinguishes absent categories from an empty list in a Mandate scope', () => {
    const m = fixtures['Mandate'] as Extract<UnsignedMessage, { type: 'Mandate' }>;
    const { categories: _c, ...noCategories } = m.scope;
    void _c;
    const absent: UnsignedMessage = { ...m, scope: noCategories };
    const empty: UnsignedMessage = { ...m, scope: { ...noCategories, categories: [] } };
    expect(messageDigest(domain, absent)).not.toBe(messageDigest(domain, empty));
  });
});
