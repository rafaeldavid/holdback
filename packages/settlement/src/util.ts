// Helpers both settlement adapters (sim/ and evm/) share. Not part of the package's API.
import { problem, type Problem, type ProblemType } from '@holdback/core';

/**
 * A refused submission. The adapters throw it inside a transaction and return its problem from submit. `revert` is the
 * contract error's name when the refusal came from a contract.
 */
export class Refusal extends Error {
  constructor(
    readonly problem: Problem,
    readonly revert?: string,
  ) {
    super(problem.detail);
  }
}

export const refuse = (type: ProblemType, detail: string): never => {
  throw new Refusal(problem(type, detail));
};

/** A JSON value with every bigint as its decimal string. */
export const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)));
