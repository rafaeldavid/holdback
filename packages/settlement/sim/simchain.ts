// Placeholder so the tests compile before the implementation (test-first).
import type { Address, Club, EscrowState, Hex32, Mandate, SettlementEvent, Timestamp } from '@holdback/core';
import type { Submission, SubmitOptions, SubmitResult, DryRunSubmission } from '../src/interface.js';
export interface Genesis { start: Timestamp; simSeed: Hex32; chainId: number; token: string; clubs: Club[]; mandates: Mandate[]; members: Array<{ clubId: string; member: Address }>; balances: Record<Address, string>; bonds: Record<Address, { junior: string; senior: string }>; gasBuffer?: string }
export type JournalEntry = unknown;
const todo = (): never => { throw new Error('SimChain: not implemented'); };
export class SimChain {
  constructor(readonly genesis: Genesis) {}
  now(): Timestamp { return this.genesis.start; }
  advance(_s: number): void { todo(); }
  advanceTo(_t: Timestamp): void { todo(); }
  faucet(_a: Address, _n: bigint): void { todo(); }
  beacon(_r: number): Hex32 | null { return todo(); }
  escrowState(_id: Hex32): EscrowState | null { return todo(); }
  pool(_a: Address): { junior: bigint; senior: bigint; reserved: bigint } { return todo(); }
  ledger(): Record<string, bigint> { return todo(); }
  log(): SettlementEvent[] { return todo(); }
  journal(): JournalEntry[] { return todo(); }
  digest(): Hex32 { return todo(); }
  static verifyLog(_e: SettlementEvent[]): boolean { return todo(); }
  static async replay(_g: Genesis, _j: JournalEntry[]): Promise<SimChain> { return todo(); }
  async submit(_s: Submission, _o?: SubmitOptions): Promise<SubmitResult> { return todo(); }
  async validate(_s: DryRunSubmission): Promise<SubmitResult> { return todo(); }
  async state(_id: Hex32): Promise<null> { return todo(); }
  async balances(_a: readonly Address[]): Promise<Record<Address, { token: string; amount: string }>> { return todo(); }
  async keysFor(_id: Hex32, _r: Address): Promise<unknown[]> { return todo(); }
}
