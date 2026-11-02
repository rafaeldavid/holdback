import { encodeErrorResult, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { problemFromRevert, revertData } from './errors.js';

const abi = parseAbi([
  'error WrongStage(uint8 current)',
  'error BadSignature()',
  'error DeadlinePassed()',
  'error MessageExpired()',
  'error TooEarly()',
  'error BadSeed()',
  'error InvalidMessage()',
  'error InsufficientFreeBond(uint256 free, uint256 needed)',
  'error InsufficientBalance()',
  'error Error(string)',
]);
const data = (errorName: string, args: unknown[] = []) => encodeErrorResult({ abi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);

describe('contract reverts as SimChain problem types', () => {
  it.each([
    ['WrongStage', [1], 'invalid_state'],
    ['BadSignature', [], 'invalid_signature'],
    ['DeadlinePassed', [], 'deadline_passed'],
    ['MessageExpired', [], 'deadline_passed'],
    ['TooEarly', [], 'invalid_state'],
    ['BadSeed', [], 'seed_mismatch'],
    ['InvalidMessage', [], 'invalid_terms'],
    ['InsufficientFreeBond', [1n, 2n], 'coverage_exceeded'],
    ['InsufficientBalance', [], 'insufficient_funds'],
  ])('%s -> %s', (name, args, type) => {
    expect(problemFromRevert(abi, data(name, args)).type).toBe(type);
  });

  it('maps token revert strings', () => {
    expect(problemFromRevert(abi, data('Error', ['MockERC3009: invalid signature'])).type).toBe('invalid_signature');
    expect(problemFromRevert(abi, data('Error', ['MockERC3009: authorization is used'])).type).toBe('nonce_reused');
    expect(problemFromRevert(abi, data('Error', ['MockERC3009: authorization expired'])).type).toBe('deadline_passed');
  });

  it('never throws on unknown data', () => {
    expect(problemFromRevert(abi, '0xdeadbeef').type).toBe('invalid_state');
    expect(problemFromRevert(abi, undefined).type).toBe('invalid_state');
  });

  it('finds revert data nested in a client error', () => {
    expect(revertData({ cause: { cause: { data: '0x1234' } } })).toBe('0x1234');
    expect(revertData({ error: { data: { data: '0xabcd' } } })).toBe('0xabcd');
  });
});
