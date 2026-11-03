// Test world: one SimChain, a cast, a deal, and any number of operator nodes over that one chain.
import type { Hex32 } from '@holdback/core';
import type { Submission } from '@holdback/settlement';
import { Deal, SimChain, simActor, simCast, simClub, simGenesis, type Cast } from '@holdback/settlement/sim';
import type { Operation } from '@holdback/sdk';
import { simRegistry, startOperator, type OperatorOptions, type RunningOperator } from './index.js';

export const START = '2026-11-01T09:00:00Z';
export const BOND = 25_000_000_000n;

export interface World {
  chain: SimChain;
  cast: Cast;
  deal: Deal;
  club: ReturnType<typeof simClub>;
  operators: RunningOperator[];
  /** Starts another operator node on the same chain. */
  operator(id: string, over?: Partial<OperatorOptions>): Promise<RunningOperator>;
  close(): Promise<void>;
}

export async function world(): Promise<World> {
  const cast = simCast();
  const club = simClub(simActor('club-operator').address);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n, seller: 1_000_000_000n }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } });
  const chain = new SimChain(genesis);
  const deal = new Deal(chain, cast, { club });
  const operators: RunningOperator[] = [];
  const operator = async (id: string, over: Partial<OperatorOptions> = {}) => {
    const op = await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor(id, 'operator').key, operatorId: id, env: {}, ...over });
    operators.push(op);
    return op;
  };
  return { chain, cast, deal, club, operators, operator, close: async () => void (await Promise.all(operators.map((o) => o.close()))) };
}

/** A settlement submission as the SDK operation that becomes it. */
export function asOperation(s: Submission): Operation {
  switch (s.kind) {
    case 'offer':
      return { kind: 'offer', commitment: s.commitment };
    case 'adjudicator_accept':
      return { kind: 'acceptance', message: s.message };
    case 'agree':
      return { kind: 'agree', message: s.message };
    case 'agree_and_fund':
      return { kind: 'agree', message: s.agree, fund: s.funding };
    case 'fund':
      return { kind: 'fund', message: s.message };
    case 'deliver':
      return { kind: 'deliver', delivery: s.delivery };
    case 'early_accept':
      return { kind: 'early_accept', message: s.message };
    case 'decide':
      return { kind: 'decide', message: s.message };
    case 'appeal':
      return { kind: 'appeal', appeal: s.appeal };
    case 'mutual_settle':
      return { kind: 'settle', message: s.message };
    case 'trigger':
      return { kind: 'trigger', commitmentId: s.commitmentId, timeout: s.timeout };
  }
}

/** The one-shot hold for a deal: offer, adjudicator acceptance, agreement and funding in one call. */
export async function holdOf(deal: Deal): Promise<Extract<Operation, { kind: 'hold' }>> {
  const offer = await deal.offer();
  const accept = await deal.accept();
  const af = await deal.agreeAndFund();
  if (offer.kind !== 'offer' || accept.kind !== 'adjudicator_accept' || af.kind !== 'agree_and_fund') throw new Error('unexpected submission kinds');
  return { kind: 'hold', commitment: offer.commitment, acceptance: accept.message, agree: af.agree, funding: af.funding };
}

export const hex32 = (byte: string): Hex32 => `0x${byte.repeat(32)}` as Hex32;
