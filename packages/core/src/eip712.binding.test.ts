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
    nonce: h('0c'),
    expiresAt: at,
  },
  AgentRevocation: { type: 'AgentRevocation', agent: A, principal: B, nonce: h('0d'), expiresAt: at },
  MemberAdmission: { type: 'MemberAdmission', clubId: 'data-services-v1', member: B, operator: C, validUntil: '2027-10-30T00:00:00Z', nonce: h('0e'), expiresAt: at },
  MemberRevocation: { type: 'MemberRevocation', clubId: 'data-services-v1', member: B, operator: C, nonce: h('0f'), expiresAt: at },
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
  schemaVersion: '0.4',
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
    'Decision(bytes32 commitmentId,uint8 attempt,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,bytes32 nonce,uint64 expiresAt)SealedKey(string scheme,string ciphertext)',
  AgentRevocation: 'AgentRevocation(address agent,address principal,bytes32 nonce,uint64 expiresAt)',
  MemberAdmission: 'MemberAdmission(string clubId,address member,address operator,uint64 validUntil,bytes32 nonce,uint64 expiresAt)',
  MemberRevocation: 'MemberRevocation(string clubId,address member,address operator,bytes32 nonce,uint64 expiresAt)',
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
  Offer: '0x955c9970fbc91bbd9ce6e6ded3e89e8c5526ac05c3ae84e1a422d78c3082e998',
  Agree: '0x15125494535bb03176a5aea2687d917dceb5938ab6307a9d8f21a25f21a2af6a',
  AdjudicatorAcceptance: '0x2bad3c1d2fb7a2dd6c9e15a91983fbaae90c8c4a21bdc1f2def977258b4d0a8b',
  FundingAuthorization: '0x9552ec4b85605235e8f6586366b51ab48f33410819285b1b7dcf484471337601',
  EarlyAccept: '0xa041d0e7508181bca73be105938785aae7c2b20d26e89902407e4862ba905d19',
  Decision: '0xe471e1b89abcbd850fd5ca97b1e172e1afc7cdf16f5ded3003a13af87e481ca4',
  AgentRevocation: '0x7de4edce60d921e5b4656d55743247f6efb37daa5809dafb7bfc6b8266fd6814',
  MemberAdmission: '0xdf2c959634749e1edb1167e364d94b22f01168332f5415da1b2044d3f36110ff',
  MemberRevocation: '0x92bb6284a7e841c937568ec626d29d74b1d8d8b1d4b2e49ef0d77e5481735983',
  Delivery: '0x3354cb51c8a78c42aac7baae35cdda7e23c7b79cd3f30f478af2f3cb7af2a038',
  Appeal: '0x686ce179a67cb2584a602d6d69e3919420ce451444c28432c7007f1f1844e377',
  Mandate: '0xe7eede61a631600749076e687233b6f4817f9593dc41e04b821ea67b59794e3e',
  CommitmentTerms: '0x8123d602f4f5de187c90c48a7365ce10f66cb28a9c8caa017a77f27a00cf4474',
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
  return encodeAbiParameters([{ type }], [value]);
}

function hashStruct(type: string, data: Record<string, unknown>): Hex {
  const fields = types[type]!;
  return keccak256(concat([keccak256(stringToHex(encodeType(type))), ...fields.map((f) => word(f.type, data[f.name]))]));
}

const domainSeparator = keccak256(
  encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(stringToHex('Holdback')), keccak256(stringToHex('0.4')), 31337n, SIMCHAIN_VERIFYING_CONTRACT],
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
  ] as const)('changes the digest when %s is removed', (_label, name, key) => {
    const changed = structuredClone(fixtures[name]!) as Record<string, unknown>;
    delete changed[key];
    expect(messageDigest(domain, changed as UnsignedMessage)).not.toBe(messageDigest(domain, fixtures[name]!));
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
