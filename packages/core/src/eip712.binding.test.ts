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
};

export const terms: CommitmentTerms = {
  schemaVersion: '0.6',
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
  EarlyAccept: 'EarlyAccept(bytes32 commitmentId,address buyer,uint8 attempt,bytes32 nonce,uint64 expiresAt)',
  Decision:
    'Decision(bytes32 commitmentId,uint8 attempt,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,Beacon beacon,EncryptedKey[] encryptedKeys,bytes32 nonce,uint64 expiresAt)' +
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
  Offer: '0x6556874e4fe09c1d5380bb80b52cdfb2e3f934c96c0bc576ebb0399e9918258b',
  Agree: '0x224c5b608bbceb2eceeee04860c0ec00f4283922a4a4a908389f7ffe00ab6660',
  AdjudicatorAcceptance: '0x78999d9306e0e4cd6c1f45b815e10b660c97698c13c6fc7ed9b5337f21c006f6',
  FundingAuthorization: '0x23cdeb00d6a7d7992aec2961658f11ee0cc7d456370888c2f201ce47c631b69b',
  EarlyAccept: '0xa24f6800602f25651af58f39b3045324c97c42d26dbdda9d03c66a90286bee8d',
  Decision: '0x4bbe91e10f92eae5d5182acc01d1394ae1c5cc1d52a90ca5cd491d030c0b1277',
  AgentRevocation: '0x96c8844e514d2a4119eba1bce1fa14f1e70c08895fca499a68253c30e380abf6',
  MemberAdmission: '0xa0907ae2902f15ff24c453ab5a6733f138efffa7d316e977c924e042b2547300',
  MemberRevocation: '0x4056b4f6b26a349f0d91bf8763b70b079cb1a94fb36146407e9e5a5a339de4a4',
  Dispute: '0xd66ded91568fee5014b754a94cd40f612c552f62b0e7df19c7179c360ccf9d62',
  Receipt: '0x8ebafd23f09e5aee09946caf098f1558126926ac2f08472d66535014883d96e4',
  Publish: '0xe41ef334d238e97abb356097ad5954609c78abea0e9bfd271906afda156bd394',
  MutualSettlement: '0x86fc0a151e2fe6492a8f4c6fc5322e6305002fc3cc35d805e82b8b673bb33073',
  Delivery: '0x1e78504be610bba1912938d2702966c9017940080ef99151c153953eaa85415d',
  Appeal: '0x53756af3b2e9a4652147aca18d8bc38ed160582557b369b88abbb1b6b028fab2',
  Mandate: '0xa5a6a54ee851f75067ccc68bda24d7c0bfb2a07d7d59e9c2f547f26c47485810',
  TransferAuthorization: '0xb2e8984c0ce76dbd7fea8509adc39ef2e768ad76d0c2c131ebbea2aab8552e30',
  ReadToken: '0x3814babd5a49153ba050993c0594bd639b2489601462786db8020e491589f2ca',
  Delegation: '0xe840edc31600e705579a98925d4a09959e74c8bbd798b75ee8e246f9997a63ec',
  KeyRegistration: '0xd2bf594edb8e7f6ae5b2e1a9082e4cd90d109fa136a8024da4a28ebfbf6a276a',
  CommitmentTerms: '0xd98b1700753aec82b1ecc322fbd3f07bb83c6abe4f0bb1a94022b22732662092',
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
    [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak256(stringToHex('Holdback')), keccak256(stringToHex('0.6')), 31337n, SIMCHAIN_VERIFYING_CONTRACT],
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
