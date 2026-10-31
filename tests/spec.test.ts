import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { loadSpec, validateExamples } from '../scripts/spec.mjs';

const V = 'https://holdback.dev/schemas/v0.5';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const example = (name: string): any => structuredClone(loadSpec().examples.find((e: { name: string }) => e.name === name).data);

describe('spec/', () => {
  it('validates every example against the schema of the same name', () => {
    const results = validateExamples();
    expect(results.length).toBeGreaterThanOrEqual(15);
    expect(results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
  });

  it('rejects a fractional token amount', () => {
    const { ajv } = loadSpec();
    const validate = ajv.getSchema(`${V}/common.schema.json#/$defs/TokenAmount`);
    expect(validate).toBeDefined();
    expect(validate({ token: 'tUSD', amount: '2050000000' })).toBe(true);
    expect(validate({ token: 'tUSD', amount: '2050.5' })).toBe(false);
  });

  it.each(['registryHash', 'policyHash'])('requires a commitment to bind adjudication.%s', (field) => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/commitment.schema.json`);
    const commitment = structuredClone(examples.find((e: { name: string }) => e.name === 'commitment').data);
    expect(validate(commitment)).toBe(true);
    delete commitment.adjudication[field];
    expect(validate(commitment)).toBe(false);
  });

  it('requires each verdict to carry both the template hash and the input hash', () => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/judgment.schema.json`);
    const judgment = structuredClone(examples.find((e: { name: string }) => e.name === 'judgment').data);
    expect(validate(judgment)).toBe(true);
    delete judgment.panel.members[0].inputHash;
    expect(validate(judgment)).toBe(false);
  });

  it('keeps the panel commitment out of the commitment terms, so the ID is not circular', () => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/commitment.schema.json`);
    const commitment = structuredClone(examples.find((e: { name: string }) => e.name === 'commitment').data);
    commitment.adjudication.panelCommitment = commitment.adjudicatorAcceptance.seedCommitment;
    expect(validate(commitment)).toBe(false);
  });

  it.each([
    ['messages.decision', 'seed'],
    ['messages.acceptance', 'seedCommitment'],
  ])('rejects a %s message without %s', (name, field) => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/messages.schema.json`);
    const message = structuredClone(examples.find((e: { name: string }) => e.name === name).data);
    expect(validate(message)).toBe(true);
    delete message[field];
    expect(validate(message)).toBe(false);
  });

  it('moves every schema $id and the commitment schemaVersion to v0.5', () => {
    const { schemas, ajv } = loadSpec();
    for (const id of schemas.values()) expect(id).toMatch(/\/schemas\/v0\.5\//);
    const validate = ajv.getSchema(`${V}/commitment.schema.json`);
    const c = example('commitment');
    expect(c.schemaVersion).toBe('0.5');
    c.schemaVersion = '0.4';
    expect(validate(c)).toBe(false);
  });

  it.each(['page', 'operator-status', 'receipt', 'messages.dispute'])('has a valid %s example', (name) => {
    const r = validateExamples().find((x: { file: string }) => x.file === `${name}.example.json`);
    expect(r).toBeDefined();
    expect(r.ok).toBe(true);
  });

  it.each(['operator', 'eventSeq', 'eventHash', 'signature'])('requires a receipt to carry %s', (field) => {
    const validate = loadSpec().ajv.getSchema(`${V}/receipt.schema.json`);
    const r = example('receipt');
    expect(validate(r)).toBe(true);
    delete r[field];
    expect(validate(r)).toBe(false);
  });

  it('pages carry items and a nextCursor that is null at the end', () => {
    const validate = loadSpec().ajv.getSchema(`${V}/page.schema.json`);
    const p = example('page');
    expect(validate(p)).toBe(true);
    expect(validate({ ...p, nextCursor: null })).toBe(true);
    const missing = structuredClone(p);
    delete missing.nextCursor;
    expect(validate(missing)).toBe(false);
  });

  it('publishes the EIP-712 domain and receipt signer in operator status', () => {
    const validate = loadSpec().ajv.getSchema(`${V}/operator-status.schema.json`);
    const s = example('operator-status');
    expect(validate(s)).toBe(true);
    for (const field of ['domain', 'receiptSigner']) {
      const bad = structuredClone(s);
      delete bad[field];
      expect(validate(bad)).toBe(false);
    }
  });

  describe('optimistic timing (ADR-0015)', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/commitment.schema.json`);
    const dispute = { disputeBy: '2026-11-06T17:00:00Z', disputeJudgeSec: 86400, disputeFallbackSec: 86400 };
    it('requires the dispute fields in optimistic mode', () => {
      const c = example('commitment');
      c.settlement.mode = 'optimistic';
      expect(validate()(c)).toBe(false);
      Object.assign(c.timing, dispute);
      expect(validate()(c)).toBe(true);
    });
    it('forbids the dispute fields in the other modes', () => {
      const c = example('commitment');
      Object.assign(c.timing, dispute);
      expect(validate()(c)).toBe(false);
    });
  });

  describe('club rulebook', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/club.schema.json`);
    it('admits only the listed randomness sources, and a beacon source names its chain', () => {
      const c = example('club');
      expect(c.rulebook.randomness).toEqual({ source: 'sim' });
      c.rulebook.randomness = { source: 'coinflip' };
      expect(validate()(c)).toBe(false);
      c.rulebook.randomness = { source: 'drand-quicknet' };
      expect(validate()(c)).toBe(false);
      c.rulebook.randomness = { source: 'drand-quicknet', chainHash: '0x' + '52'.repeat(32) };
      expect(validate()(c)).toBe(true);
    });
    it('needs an optimistic default outcome once optimistic mode is allowed', () => {
      const c = example('club');
      c.rulebook.allowedSettlementModes = ['guaranteed_on_decision', 'optimistic'];
      delete c.rulebook.defaultOutcome.optimistic;
      expect(validate()(c)).toBe(false);
    });
    it.each(['firstLossShareMinBps', 'bondNoticePeriodMinSec', 'randomness', 'minInspectionWindowSec', 'disputeBond'])('requires %s', (field) => {
      const c = example('club');
      expect(validate()(c)).toBe(true);
      delete c.rulebook[field];
      expect(validate()(c)).toBe(false);
    });
  });

  describe('adjudicator pool (ADR-0014)', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/adjudicator.schema.json`);
    it('binds pool terms by poolTermsHash and keeps the capital charge out of fee', () => {
      const a = example('adjudicator');
      expect(validate()(a)).toBe(true);
      expect(a.pool.terms.capitalChargeRateBps).toBeDefined();
      const noHash = structuredClone(a);
      delete noHash.poolTermsHash;
      expect(validate()(noHash)).toBe(false);
      const oldFee = structuredClone(a);
      oldFee.fee.capitalChargeRateBps = 400;
      expect(validate()(oldFee)).toBe(false);
    });
  });

  describe('panel seed (ADR-0018)', () => {
    it('requires a signed beacon proof unless the source is the SimChain beacon', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/messages.schema.json`);
      const d = example('messages.decision');
      d.role = 'fallback';
      d.beacon = { source: 'sim', round: 1200, value: '0x' + '11'.repeat(32) };
      expect(validate(d)).toBe(true);
      d.beacon.source = 'drand-quicknet';
      expect(validate(d)).toBe(false);
      d.beacon.signature = '0x' + 'ab'.repeat(48);
      expect(validate(d)).toBe(true);
    });
    it('records a beacon round instead of a seed commitment for beacon-seeded panels', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/judgment.schema.json`);
      const j = example('judgment');
      expect(j.panel.seedSource).toBe('commit-reveal');
      delete j.panel.seedCommitment;
      expect(validate(j)).toBe(false);
      j.panel.seedSource = 'beacon';
      expect(validate(j)).toBe(false);
      j.panel.beaconRound = 1200;
      expect(validate(j)).toBe(true);
    });
  });

  // ADR-0017 §9, review of PR 23 item 3: every free-text string is either marked untrusted or constrained.
  // A string with no date-time format, pattern, enum or const can carry anything, so a consumer must treat it as
  // content, never instructions. Identifiers get a pattern instead. The allowlist is empty; adding to
  // it needs a reason here and a note in the PR.
  const ALLOWED_UNMARKED: string[] = [];
  it('marks or constrains every free-text string field', () => {
    const { ajv, schemas } = loadSpec();
    const unmarked: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any, path: string, file: string): void => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}/${i}`, file));
      if (node === null || typeof node !== 'object') return;
      // Only date-time constrains a string's content; a uri can still carry prose (second review, item 3).
      const free = node.type === 'string' && node.format !== 'date-time' && !['pattern', 'enum', 'const'].some((k) => k in node);
      if (free && node['x-holdback-untrusted'] !== true && !ALLOWED_UNMARKED.includes(`${file}${path}`)) unmarked.push(`${file}${path}`);
      for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`, file);
    };
    for (const [file, id] of schemas) walk(ajv.getSchema(id).schema, '', file);
    expect(unmarked).toEqual([]);
  });

  it.each([
    ['commitment', '/properties/deliverable/properties/description'],
    ['commitment', '/$defs/Criterion/properties/anchors/properties/0'],
    ['judge-verdict', '/properties/rationale'],
    ['judgment', '/properties/aggregate/properties/reasons/items'],
    ['messages', '/$defs/Dispute/properties/grounds'],
  ])('marks %s %s as untrusted, not merely constrained', (file, pointer) => {
    const { ajv, schemas } = loadSpec();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = pointer.split('/').slice(1).reduce((n: any, k: string) => n?.[k], ajv.getSchema(schemas.get(file)).schema);
    expect(node?.['x-holdback-untrusted']).toBe(true);
  });

  describe('mutual settlement (ADR-0019)', () => {
    const messages = () => loadSpec().ajv.getSchema(`${V}/messages.schema.json`);
    it('has a valid co-signed example', () => {
      const r = validateExamples().find((x: { file: string }) => x.file === 'messages.mutual-settlement.example.json');
      expect(r?.ok).toBe(true);
    });
    it.each(['sellerAmount', 'buyerSignature', 'sellerSignature', 'releaseKey', 'deliveryHash'])('requires %s', (field) => {
      const m = example('messages.mutual-settlement');
      expect(messages()(m)).toBe(true);
      delete m[field];
      expect(messages()(m)).toBe(false);
    });
    it('takes a null deliveryHash before delivery and refuses a non-boolean releaseKey', () => {
      const m = example('messages.mutual-settlement');
      m.deliveryHash = null;
      m.releaseKey = false;
      expect(messages()(m)).toBe(true);
      m.releaseKey = 'yes';
      expect(messages()(m)).toBe(false);
    });
    it('refuses releasing a key when nothing was delivered (ADR-0019)', () => {
      const m = example('messages.mutual-settlement');
      m.deliveryHash = null;
      m.releaseKey = true;
      expect(messages()(m)).toBe(false);
    });
    it('records the split and key release on a Settled commitment', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/commitment-state.schema.json`);
      const s = example('commitment-state');
      s.escrowState = 'Settled';
      expect(validate(s)).toBe(false);
      s.settled = { sellerAmount: { token: 'tUSD', amount: '1200000000' }, buyerAmount: { token: 'tUSD', amount: '850000000' }, keyReleased: true };
      expect(validate(s)).toBe(true);
    });
    it('lets a club allow or refuse mutual settlement, with an integer basis-point fee share', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/club.schema.json`);
      const c = example('club');
      expect(Number.isInteger(c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps)).toBe(true);
      c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps = 0.5;
      expect(validate(c)).toBe(false);
      c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps = 10001;
      expect(validate(c)).toBe(false);
      delete c.rulebook.mutualSettlement;
      expect(validate(c)).toBe(false);
    });
    it('emits commitment.settled with the split', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/event.schema.json`);
      const e = example('event');
      e.type = 'commitment.settled';
      e.payload = { sellerAmount: { token: 'tUSD', amount: '1200000000' }, buyerAmount: { token: 'tUSD', amount: '850000000' }, keyReleased: true };
      expect(validate(e)).toBe(true);
      e.payload = { note: 'split' };
      expect(validate(e)).toBe(false);
    });
  });

  describe('privacy, Phase 1 shape (ADR-0020, D16)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    const key = (recipient: string) => ({ recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' });
    const A = '0x1111111111111111111111111111111111111111';

    it('binds a disclosure level in the terms and reserves privateTerms', () => {
      const c = example('commitment');
      expect(c.disclosure).toEqual({ level: 'public' });
      const validate = schema('commitment');
      expect(validate(c)).toBe(true);
      c.disclosure.level = 'secret';
      expect(validate(c)).toBe(false);
      c.disclosure.level = 'private';
      c.privateTerms = { hash: '0x' + '21'.repeat(32), envelopes: [key(A)] };
      expect(validate(c)).toBe(true);
      delete c.disclosure;
      expect(validate(c)).toBe(false);
    });

    it('lets a delivery key wait for a beacon round', () => {
      const d = example('delivery');
      d.encryptedKeys[0].unlock = { kind: 'beacon-round' };
      expect(schema('delivery')(d)).toBe(false);
      d.encryptedKeys[0].unlock = { kind: 'beacon-round', round: 1200 };
      expect(schema('delivery')(d)).toBe(true);
      d.encryptedKeys[0].unlock = { kind: 'none' };
      expect(schema('delivery')(d)).toBe(true);
    });

    it('requires an escalating Decision to carry keys for the appeal adjudicator, and only then', () => {
      const validate = schema('messages');
      const d = example('messages.decision');
      d.outcome = 'escalate';
      delete d.keyForBuyer;
      expect(validate(d)).toBe(false);
      d.encryptedKeys = [key(A)];
      expect(validate(d)).toBe(true);
      d.outcome = 'reject';
      expect(validate(d)).toBe(false);
    });

    it('requires a Dispute to carry adjudicator keys', () => {
      const validate = schema('messages');
      const d = example('messages.dispute');
      expect(d.encryptedKeys.length).toBeGreaterThanOrEqual(1);
      delete d.encryptedKeys;
      expect(validate(d)).toBe(false);
    });

    it.each(['level', 'buyerSignature', 'sellerSignature'])('requires %s on a co-signed Publish', (field) => {
      const validate = schema('messages');
      const p = example('messages.publish');
      expect(validate(p)).toBe(true);
      delete p[field];
      expect(validate(p)).toBe(false);
    });

    it.each([
      ['commitment.offered', 'termsHash'],
      ['commitment.agreed', 'termsHash'],
      ['judgment.decided', 'recordHash'],
      ['appeal.decided', 'recordHash'],
    ])('%s always carries %s, with the body optional', (type, field) => {
      const validate = schema('event');
      const e = example('event');
      e.type = type;
      e.payload = {};
      expect(validate(e)).toBe(false);
      e.payload = { [field]: '0x' + '31'.repeat(32) };
      expect(validate(e)).toBe(true);
    });

    it('has a valid offered-event example carrying the terms hash', () => {
      const r = validateExamples().find((x: { file: string }) => x.file === 'event.offered.example.json');
      expect(r?.ok).toBe(true);
    });

    it('takes an optional private judgment record', () => {
      const j = example('judgment');
      j.privateRecord = { hash: '0x' + '41'.repeat(32), envelopes: [key(A)] };
      expect(schema('judgment')(j)).toBe(true);
      delete j.privateRecord.hash;
      expect(schema('judgment')(j)).toBe(false);
    });

    it('names the identity modes long-term and pseudonymous (ADR-0020 §7)', () => {
      const c = example('club');
      c.rulebook.identityModes = ['long-term', 'pseudonymous'];
      expect(schema('club')(c)).toBe(true);
      c.rulebook.identityModes = ['long-term', 'per-commitment'];
      expect(schema('club')(c)).toBe(false);
    });

    it.each(['disclosureMin', 'identityModes'])('requires rulebook %s', (field) => {
      const c = example('club');
      expect(schema('club')(c)).toBe(true);
      delete c.rulebook[field];
      expect(schema('club')(c)).toBe(false);
    });

    it.each([
      ['providerPrivacy', 'cloud'],
      ['disclosureMin', 'secret'],
    ])('requires and constrains adjudicator policy %s', (field, bad) => {
      const a = example('adjudicator');
      expect(schema('adjudicator')(a)).toBe(true);
      a.policy[field] = bad;
      expect(schema('adjudicator')(a)).toBe(false);
      delete a.policy[field];
      expect(schema('adjudicator')(a)).toBe(false);
    });
  });

  describe('review of PR 23: items 4, 5, 7 and 8', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    it('describes messages under domain version 0.5', () => {
      expect(schema('messages').schema.description).toContain('version 0.5');
      expect(schema('messages').schema.description).not.toContain('0.4');
    });
    it.each([
      ['odd-length hex', { source: 'drand-quicknet', round: 1, value: '0x' + '11'.repeat(32), signature: '0xabc' }],
      ['uppercase hex', { source: 'drand-quicknet', round: 1, value: '0x' + '11'.repeat(32), signature: '0xABCD' }],
      ['a signature on a sim beacon', { source: 'sim', round: 1, value: '0x' + '11'.repeat(32), signature: '0xabcd' }],
    ])('refuses a beacon with %s', (_label, beacon) => {
      const d = example('messages.decision');
      d.role = 'fallback';
      d.beacon = beacon;
      expect(schema('messages')(d)).toBe(false);
    });
    it.each([
      ['a 32-byte hash', 'commitmentId', 'AB'],
      ['a signature', 'signature', 'CD'],
    ])('gives %s exactly one spelling (lowercase)', (_label, field, upper) => {
      const m = example('messages.acceptance');
      expect(schema('messages')(m)).toBe(true);
      m[field] = m[field].slice(0, -2) + upper;
      expect(schema('messages')(m)).toBe(false);
    });
    it('keeps the bond in the pool only, so a read cannot disagree with itself', () => {
      const a = example('adjudicator');
      expect(a.bond).toBeUndefined();
      expect(a.openExposure).toBeUndefined();
      a.bond = a.pool.junior;
      expect(schema('adjudicator')(a)).toBe(false);
    });
    it('lets a receipt omit the commitment for events that have none', () => {
      const r = example('receipt');
      delete r.commitmentId;
      expect(schema('receipt')(r)).toBe(true);
    });
  });

  // Review of PR 23, item 2: every rule in the v0.5 additions has a case that fails without it.
  describe('rejects each mutant the review found, and the same for later additions', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    const t = (amount: string) => ({ token: 'tUSD', amount });
    const h = (b: string) => '0x' + b.repeat(32);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Edit = (x: any) => void;
    const cases: Array<[string, string, string, Edit]> = [
      ['adjudicator without a pool', 'adjudicator', 'adjudicator', (a) => delete a.pool],
      ['pool terms with an extra field', 'adjudicator', 'adjudicator', (a) => (a.pool.terms.extra = 1)],
      ['pool terms without noticePeriodSec', 'adjudicator', 'adjudicator', (a) => delete a.pool.terms.noticePeriodSec],
      ['a bond.slashed event without per-tranche amounts', 'event', 'event.bond-slashed', (e) => delete e.payload.senior],
      ['a bond.slashed event with an unknown reason', 'event', 'event.bond-slashed', (e) => (e.payload.reason = 'whim')],
      ['an unknown event type', 'event', 'event', (e) => (e.type = 'bond.borrowed')],
      ['an unknown escrow state', 'commitment-state', 'commitment-state', (s) => (s.escrowState = 'Paused')],
      ['a judgment panel without seedSource', 'judgment', 'judgment', (j) => delete j.panel.seedSource],
      ['an optimistic default that does not release', 'club', 'club', (c) => (c.rulebook.defaultOutcome.optimistic = { release: false, buyerCompensationRateBps: 10000 })],
      ['an optimistic default without buyerCompensationRate', 'club', 'club', (c) => (c.rulebook.defaultOutcome.optimistic = { release: true })],
      ['a chain settlement without chainId', 'operator-status', 'operator-status', (s) => (s.settlement = { kind: 'chain' })],
      ['operator head without lagSec', 'operator-status', 'operator-status', (s) => delete s.head.lagSec],
      ['a page of more than 200 items', 'page', 'page', (p) => (p.items = Array(201).fill(p.items[0]))],
      ['an empty cursor', 'page', 'page', (p) => (p.nextCursor = '')],
      ['a Dispute without a bond', 'messages', 'messages.dispute', (d) => delete d.bond],
      ['a Dispute with an extra field', 'messages', 'messages.dispute', (d) => (d.extra = 1)],
      ['a Dispute with keys for fewer than three adjudicators', 'messages', 'messages.dispute', (d) => d.encryptedKeys.pop()],
      ['a zero disputeJudgeSec', 'commitment', 'commitment', (c) => { c.settlement.mode = 'optimistic'; Object.assign(c.timing, { disputeBy: '2026-11-06T17:00:00Z', disputeJudgeSec: 0, disputeFallbackSec: 86400 }); }],
      ['an unknown randomness source', 'club', 'club', (c) => (c.rulebook.randomness = { source: 'dice' })],
      ['a MutualSettlement with an extra field', 'messages', 'messages.mutual-settlement', (m) => (m.extra = 1)],
      ['a MutualSettlement sellerAmount that is not money', 'messages', 'messages.mutual-settlement', (m) => (m.sellerAmount = { token: 'tUSD', amount: '1.5' })],
      ['a settled split on a commitment that is not Settled', 'commitment-state', 'commitment-state', (s) => (s.settled = { sellerAmount: t('1'), buyerAmount: t('1'), keyReleased: false })],
      ['a commitment.settled event without keyReleased', 'event', 'event', (e) => { e.type = 'commitment.settled'; e.payload = { sellerAmount: t('1'), buyerAmount: t('1') }; }],
      ['a mutualSettlement rule without allowed', 'club', 'club', (c) => delete c.rulebook.mutualSettlement.allowed],
      ['a Publish to an unknown level', 'messages', 'messages.publish', (p) => (p.level = 'secret')],
      ['a Publish with an extra field', 'messages', 'messages.publish', (p) => (p.extra = 1)],
      ['a key unlock with a round but no beacon', 'delivery', 'delivery', (d) => (d.encryptedKeys[0].unlock = { kind: 'none', round: 5 })],
      ['a private judgment record with no envelopes', 'judgment', 'judgment', (j) => (j.privateRecord = { hash: h('41'), envelopes: [] })],
      ['an unknown identity mode', 'club', 'club', (c) => (c.rulebook.identityModes = ['anonymous'])],
      ['a club disclosure minimum outside the levels', 'club', 'club', (c) => (c.rulebook.disclosureMin = 'secret')],
      ['an offered event whose termsHash is not a hash', 'event', 'event.offered', (e) => (e.payload.termsHash = 'abc')],
    ];
    it.each(cases)('rejects %s', (_label, file, name, edit) => {
      const x = example(name);
      expect(schema(file)(x)).toBe(true);
      edit(x);
      expect(schema(file)(x)).toBe(false);
    });
    it.each([
      ['prevrandao', 'club', 'club', (c: { rulebook: { randomness: object } }) => (c.rulebook.randomness = { source: 'prevrandao' })],
      ['the Disputed state', 'commitment-state', 'commitment-state', (s: { escrowState: string }) => (s.escrowState = 'Disputed')],
      ['a dispute.opened event', 'event', 'event', (e: { type: string }) => (e.type = 'dispute.opened')],
    ] as const)('accepts %s', (_label, file, name, edit) => {
      const x = example(name);
      edit(x as never);
      expect(schema(file)(x)).toBe(true);
    });
  });

  describe('hidden-character check and screen signals (ADR-0021, D17)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    const check = (max: unknown, extra: object = {}) => ({ id: 'hidden', type: 'hidden_characters_max', required: true, max, ...extra });
    const withCheck = (c: unknown) => {
      const x = example('commitment');
      x.acceptance.deterministicChecks = [c];
      return x;
    };
    it('ships an example commitment that uses the check', () => {
      const x = example('commitment');
      expect(x.acceptance.deterministicChecks.some((c: { type: string }) => c.type === 'hidden_characters_max')).toBe(true);
    });
    it.each([
      ['a total maximum', { total: 0 }],
      ['per-class maximums', { tag: 0, bidi: 0, variationSelector: 2, otherIgnorable: 5 }],
    ])('accepts %s', (_label, max) => {
      expect(schema('commitment')(withCheck(check(max)))).toBe(true);
    });
    it.each([
      ['no maximum at all', {}],
      ['an unknown class', { emoji: 1 }],
      ['a fractional maximum', { total: 0.5 }],
      ['a negative maximum', { tag: -1 }],
    ])('rejects %s', (_label, max) => {
      expect(schema('commitment')(withCheck(check(max)))).toBe(false);
    });
    it('requires the required flag and refuses extra fields', () => {
      const noFlag: Record<string, unknown> = check({ total: 0 });
      delete noFlag['required'];
      expect(schema('commitment')(withCheck(noFlag))).toBe(false);
      expect(schema('commitment')(withCheck(check({ total: 0 }, { normalize: true })))).toBe(false);
    });
    it.each(['nfkc_changed', 'variation_selector_run', 'mixed_script', 'hidden_characters'])('accepts screen signal %s', (kind) => {
      const j = example('judgment');
      j.screen.signals = [{ kind }];
      expect(schema('judgment')(j)).toBe(true);
    });
    it('keeps the screen signal enum closed', () => {
      const j = example('judgment');
      j.screen.signals = [{ kind: 'homoglyph' }];
      expect(schema('judgment')(j)).toBe(false);
    });
  });

  describe('integer rates (ADR-0022, D18)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type At = (x: any) => any;
    const bps: Array<[string, string, At, string]> = [
      ['club', 'club', (c) => c.rulebook, 'appealBondRateBps'],
      ['club', 'club', (c) => c.rulebook, 'windowCoverageRatioBps'],
      ['club', 'club', (c) => c.rulebook, 'firstLossShareMinBps'],
      ['club', 'club', (c) => c.rulebook, 'sealedChecksMaxWeightBps'],
      ['club', 'club', (c) => c.rulebook.defaultOutcome.judged, 'sellerCompensationRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.pool.terms, 'capitalChargeRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.pool.terms, 'capitalChargeToPoolRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.pool.terms, 'firstLossShareBps'],
      ['adjudicator', 'adjudicator', (a) => a.metrics, 'falseAcceptRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.metrics, 'falseRejectRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.metrics, 'escalationRateBps'],
    ];
    it.each(bps)('%s %s rejects fractional, negative and over-10000 values', (file, name, at, field) => {
      for (const bad of [0.5, -1, 10001]) {
        const x = example(name);
        at(x)[field] = 500;
        expect(schema(file)(x)).toBe(true);
        at(x)[field] = bad;
        expect(schema(file)(x)).toBe(false);
      }
    });
    it('defines Bps and Fraction and no floating Rate', () => {
      const defs = schema('common').schema.$defs;
      expect(defs.Rate).toBeUndefined();
      expect(defs.Bps).toEqual(expect.objectContaining({ type: 'integer', minimum: 0, maximum: 10000 }));
      expect(defs.Fraction.additionalProperties).toBe(false);
    });
    it.each([
      ['a zero denominator', { numerator: 0, denominator: 0 }],
      ['a denominator above 100', { numerator: 2, denominator: 101 }],
      ['a fractional numerator', { numerator: 1.5, denominator: 3 }],
      ['an extra field', { numerator: 2, denominator: 3, value: 0.667 }],
    ])('rejects a supermajority with %s', (_label, f) => {
      const a = example('adjudicator');
      expect(a.policy.acceptSupermajority).toEqual({ numerator: 2, denominator: 3 });
      a.policy.acceptSupermajority = f;
      expect(schema('adjudicator')(a)).toBe(false);
    });
    it.each([
      ['a criterion weight of 0', (c: { acceptance: { rubric: { criteria: Array<{ weight: number }> } } }) => (c.acceptance.rubric.criteria[0]!.weight = 0)],
      ['a fractional criterion weight', (c: { acceptance: { rubric: { criteria: Array<{ weight: number }> } } }) => (c.acceptance.rubric.criteria[0]!.weight = 0.4)],
      ['a pass threshold above 400 hundredths', (c: { acceptance: { rubric: { passThreshold: number } } }) => (c.acceptance.rubric.passThreshold = 401)],
      ['a fractional pass threshold', (c: { acceptance: { rubric: { passThreshold: number } } }) => (c.acceptance.rubric.passThreshold = 3.5)],
      ['a fractional regex match minimum', (c: { acceptance: { deterministicChecks: Array<Record<string, unknown>> } }) => (c.acceptance.deterministicChecks.find((k) => 'minBps' in k)!['minBps'] = 0.97)],
    ] as const)('rejects %s', (_label, edit) => {
      const c = example('commitment');
      expect(schema('commitment')(c)).toBe(true);
      edit(c as never);
      expect(schema('commitment')(c)).toBe(false);
    });
    it('records aggregate counts and an integer weighted score in hundredths', () => {
      const j = example('judgment');
      expect(Number.isInteger(j.aggregate.passCount)).toBe(true);
      expect(j.aggregate.passShare).toBeUndefined();
      j.aggregate.weightedScore = 3.4;
      expect(schema('judgment')(j)).toBe(false);
      j.aggregate.weightedScore = 340;
      expect(schema('judgment')(j)).toBe(true);
    });
  });
});
