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

  it.each(['operator', 'eventSeq', 'eventHash', 'commitmentId', 'signature'])('requires a receipt to carry %s', (field) => {
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
    it.each(['firstLossShareMin', 'bondNoticePeriodMinSec', 'randomness', 'minInspectionWindowSec', 'disputeBond'])('requires %s', (field) => {
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
      expect(a.pool.terms.capitalChargeRate).toBeDefined();
      const noHash = structuredClone(a);
      delete noHash.poolTermsHash;
      expect(validate()(noHash)).toBe(false);
      const oldFee = structuredClone(a);
      oldFee.fee.capitalChargeRate = 0.04;
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

  // ADR-0017 §9: party-authored text is marked so every consumer treats it as content, never instructions.
  it.each([
    ['commitment', '/properties/deliverable/properties/description'],
    ['commitment', '/$defs/Criterion/properties/description'],
    ['commitment', '/$defs/Criterion/properties/anchors/properties/0'],
    ['commitment', '/$defs/Criterion/properties/anchors/properties/4'],
    ['commitment', '/$defs/DeterministicCheck/oneOf/4/properties/pattern'],
    ['appeal', '/properties/grounds'],
    ['messages', '/$defs/Dispute/properties/grounds'],
    ['adjudicator', '/properties/name'],
    ['club', '/properties/name'],
    ['agent', '/properties/memberId'],
  ])('marks %s %s as untrusted', (file, pointer) => {
    const { ajv, schemas } = loadSpec();
    const schema = ajv.getSchema(schemas.get(file)).schema;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = pointer.split('/').slice(1).reduce((n: any, k: string) => n?.[k.replace('~1', '/')], schema);
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
      expect(messages()(m)).toBe(true);
      m.releaseKey = 'yes';
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
});
