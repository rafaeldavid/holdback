// Contract reverts as the problem types SimChain returns (docs/api.md). The mapping is by error name, so a revert
// from HoldbackRules, HoldbackBonds, CPP or the token reads the same to an agent on either backend.
import { problem, type Problem, type ProblemType } from '@holdback/core';
import { decodeErrorResult, type Abi, type Hex } from 'viem';

const BY_NAME: Record<string, ProblemType> = {
  // HoldbackRules
  WrongStage: 'invalid_state',
  WrongAppealState: 'invalid_state',
  TooEarly: 'invalid_state', // core: a timeout before its deadline is invalid_state
  BadSignature: 'invalid_signature',
  DeadlinePassed: 'deadline_passed',
  MessageExpired: 'deadline_passed',
  Unrepresentable: 'invalid_terms',
  InvalidMessage: 'invalid_terms',
  BadKeyProof: 'invalid_terms',
  BadSeed: 'seed_mismatch',
  // HoldbackBonds
  InsufficientFreeBond: 'coverage_exceeded',
  AppealBondTooLarge: 'invalid_terms',
  AppealBondExists: 'invalid_state',
  NotRules: 'invalid_state',
  // ERC-20 (solady)
  InsufficientBalance: 'insufficient_funds',
  InsufficientAllowance: 'insufficient_funds',
  // CPP AuthCaptureEscrow / collectors
  AfterPreApprovalExpiry: 'deadline_passed',
  AfterAuthorizationExpiry: 'deadline_passed',
  PaymentAlreadyCollected: 'nonce_reused',
  InvalidSignature: 'invalid_signature',
};

const BY_MESSAGE: Array<[RegExp, ProblemType]> = [
  [/invalid signature/i, 'invalid_signature'],
  [/authorization is used/i, 'nonce_reused'],
  [/expired|not yet valid/i, 'deadline_passed'],
  [/exceeds balance|insufficient/i, 'insufficient_funds'],
];

/** A decoded revert as a problem; unknown reverts are invalid_state with the raw selector. */
export function problemFromRevert(abi: Abi, data: Hex | undefined): Problem {
  if (!data || data === '0x') return problem('invalid_state', 'the contract reverted without data');
  let name: string;
  let args: readonly unknown[] = [];
  try {
    const r = decodeErrorResult({ abi, data });
    name = r.errorName;
    args = r.args ?? [];
  } catch {
    return problem('invalid_state', `the contract reverted with unknown error ${data.slice(0, 10)}`);
  }
  const detail = `contract revert ${name}(${args.map((a) => String(a)).join(', ')})`;
  if (name === 'Error') {
    const msg = String(args[0] ?? '');
    const hit = BY_MESSAGE.find(([re]) => re.test(msg));
    return problem(hit ? hit[1] : 'invalid_state', detail);
  }
  return problem(BY_NAME[name] ?? 'invalid_state', detail);
}

/** The contract error's name in revert data, if the ABI knows it. */
export function revertName(abi: Abi, data: Hex | undefined): string | undefined {
  if (!data || data === '0x') return undefined;
  try {
    return decodeErrorResult({ abi, data }).errorName;
  } catch {
    return undefined;
  }
}

/** The revert data inside a viem or JSON-RPC error, wherever the client put it. */
export function revertData(e: unknown): Hex | undefined {
  const seen = new Set<unknown>();
  const walk = (x: unknown): Hex | undefined => {
    if (!x || typeof x !== 'object' || seen.has(x)) return undefined;
    seen.add(x);
    const o = x as Record<string, unknown>;
    for (const k of ['data', 'raw']) {
      const v = o[k];
      if (typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v)) return v as Hex;
      if (v && typeof v === 'object') {
        const inner = walk(v);
        if (inner) return inner;
      }
    }
    return walk(o['cause']) ?? walk(o['error']);
  };
  return walk(e);
}
