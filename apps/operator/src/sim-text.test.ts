// What `pnpm sim` prints at start (sim-text.ts): true of the profile it runs, and the operator fee its nodes publish.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OperatorFeeSchedule } from '@holdback/core';
import { operatorFeeLine, simStartText } from './sim-text.js';
import { startSimWorld, type SimWorld } from './sim-world.js';

let world: SimWorld;
beforeAll(async () => {
  world = await startSimWorld({ accounts: ['buyer-1'], env: {}, onError: () => {}, publishSecrets: true, profile: 'phase_one' });
});
afterAll(async () => {
  await world.close();
});
const fee = async (): Promise<OperatorFeeSchedule | null> => ((await (await fetch(`${world.info.operators[0]}/.well-known/holdback.json`)).json()) as { fees?: { operator?: OperatorFeeSchedule } }).fees?.operator ?? null;

describe('pnpm sim start-up text (T-389)', () => {
  it('on phase one: says so in one line, and names no bond or appeal figure', async () => {
    const text = simStartText(world.info, world.url, { profile: 'phase_one', fee: await fee() });
    const lines = text.split('\n');
    expect(lines[1]).toBe('Phase-one rules, as the contracts on chain: no bonds and no party appeals; the first decision, by the primary or the fallback adjudicator, is final.');
    expect(text).not.toMatch(/bond(ed)? [0-9]|appeal: bond|compensated/);
    expect(text).toContain('  minimum fee 1 tUSD each');
    expect(text).toContain('  the adjudication fee is paid on a judged refund: the buyer gets the price back, not the fee');
    expect(text).toContain('  default outcome (no adjudicator decided in time): the buyer gets the price and the adjudication fee back; nothing compensates the seller');
    // The sim's nodes publish no fee by default: the third line says so.
    expect(lines[2]).toBe('Operator fee: none (the nodes publish no fees.operator): a buyer pays the price plus the adjudication fee.');
  });

  it('on the full profile: keeps the bond and the appeal economics', () => {
    const text = simStartText(world.info, world.url, { profile: 'full', fee: null });
    expect(text).not.toContain('Phase-one rules');
    expect(text).toContain('  each bonded 25,000 tUSD, minimum fee 1 tUSD');
    expect(text).toMatch(/ {2}appeal: bond [0-9.]+% of the price \(rounded up\) plus a [0-9.,]+ tUSD fee/);
    expect(text).toMatch(/default outcome \(no adjudicator decided in time\): the buyer gets the price and the adjudication fee back, and the seller is compensated [0-9.]+% of the price from the bond/);
  });

  it('names the operator fee as published: at 0, and above 0', () => {
    const base = { to: `0x${'ab'.repeat(20)}`, token: 'tUSD', max: null, appliesAt: 'agree-and-fund', refundable: false } as unknown as OperatorFeeSchedule;
    expect(operatorFeeLine({ ...base, bps: 0, min: '0' } as OperatorFeeSchedule)).toBe('Operator fee: 0 (fees.operator published at 0): a buyer pays the price plus the adjudication fee; no fee signature is asked for.');
    expect(operatorFeeLine({ ...base, bps: 1, min: '10000' } as OperatorFeeSchedule)).toBe(`Operator fee: 1 bp of the price rounded up, at least 0.01 tUSD, paid to 0x${'ab'.repeat(20)} with the funded agreement, outside the hold and not refunded (fees.operator).`);
  });
});
