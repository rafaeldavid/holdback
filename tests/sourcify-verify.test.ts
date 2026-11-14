// scripts/sourcify-verify.mjs without a chain or a network (T-410): the code comparison, Sourcify's answers as its
// API v2 documentation gives them, and the arguments. The tool on a chain, against a stand-in Sourcify server, is in
// packages/settlement/evm/deploy-script.test.ts.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script with no types
import { compare, isDevNode, matchLine, parseArgs, stripMetadata, submitOne, zeroImmutables, CONTRACTS, USER_AGENT } from '../scripts/sourcify-verify.mjs';

// A made-up runtime: 4 bytes of code, an 8-byte immutable at byte 4, then a 3-byte metadata tail and its length.
const tail = 'a1b2c3' + '0003';
const built = { creation: '6080aaaa' + tail, runtime: '60806040' + '0'.repeat(16) + '5b' + tail, immutableReferences: { '7': [{ start: 4, length: 8 }] } };
const deployed = '60806040' + '1122334455667788' + '5b' + tail;
const creationInput = `0x${built.creation}${'00'.repeat(32)}`;

describe('sourcify-verify: the comparison', () => {
  it('zeroes each immutable and cuts the metadata tail', () => {
    expect(zeroImmutables(deployed, built.immutableReferences)).toBe(built.runtime);
    expect(stripMetadata(built.runtime)).toBe('60806040' + '0'.repeat(16) + '5b');
  });

  it('is exact when the runtime (immutables aside) and the creation code both match, metadata included', () => {
    expect(compare({ runtime: `0x${deployed}`, creationInput, built })).toBe('exact');
  });

  it("is `code only` when only the metadata differs, the case Sourcify answers with a partial match", () => {
    const other = deployed.replace('a1b2c3', 'ffffff');
    expect(compare({ runtime: `0x${other}`, creationInput, built })).toBe('code only');
    expect(compare({ runtime: `0x${deployed}`, creationInput: creationInput.replace('a1b2c3', 'ffffff'), built })).toBe('code only');
  });

  it('DIFFERS when the code differs', () => {
    expect(compare({ runtime: `0x${deployed.replace('5b', '00')}`, creationInput, built })).toBe('DIFFERS');
    expect(compare({ runtime: '0x', creationInput, built })).toBe('DIFFERS');
  });
});

describe("sourcify-verify: Sourcify's answers", () => {
  const contract = CONTRACTS[0];
  const base = 'https://sourcify.test';
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
  const args = { base, chainId: 11155111, contract, address: '0x' + '1'.repeat(40), tx: '0x' + 'AB'.repeat(32), input: { language: 'Solidity', sources: {}, settings: {} }, compilerVersion: '0.8.28+commit.7893614a', pollMs: 1 };

  it('posts the documented body, then polls the job until it completes', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [reply(202, { verificationId: 'v1' }), reply(200, { isJobCompleted: false }), reply(200, { isJobCompleted: true, contract: { runtimeMatch: 'exact_match', creationMatch: 'exact_match' } })];
    const r = await submitOne({ ...args, pause: async () => {}, fetchImpl: async (url: string, init: RequestInit) => (calls.push({ url, init }), answers.shift()!) });
    expect(r.ok).toBe(true);
    expect(r.line).toContain('verified, runtime exact_match, creation exact_match (job v1)');
    expect(calls[0]!.url).toBe(`${base}/v2/verify/11155111/${args.address}`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ stdJsonInput: args.input, compilerVersion: args.compilerVersion, contractIdentifier: contract.id, creationTransactionHash: args.tx.toLowerCase() });
    expect((calls[0]!.init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    expect(calls.slice(1).map((c) => c.url)).toEqual([`${base}/v2/verify/v1`, `${base}/v2/verify/v1`]);
  });

  it('takes 409 already_verified as done; the lookup after it says whether the match is exact', async () => {
    const r = await submitOne({ ...args, pause: async () => {}, fetchImpl: async () => reply(409, { customCode: 'already_verified', message: 'x', errorId: 'e' }) });
    expect(r).toEqual({ ok: true, line: `  ${contract.name}: already verified (already_verified)` });
  });

  it('backs off on 429 as long as Retry-After says, then sends again', async () => {
    const waits: number[] = [];
    const answers = [reply(429, {}, { 'retry-after': '7' }), reply(202, { verificationId: 'v2' }), reply(200, { isJobCompleted: true, contract: { runtimeMatch: 'match', creationMatch: 'match' } })];
    const r = await submitOne({ ...args, pause: async (ms: number) => void waits.push(ms), fetchImpl: async () => answers.shift()! });
    expect(r.ok).toBe(true);
    expect(waits[0]).toBe(7000);
  });

  it("reports a refusal and a failed job with Sourcify's own code", async () => {
    const refused = await submitOne({ ...args, pause: async () => {}, fetchImpl: async () => reply(400, { customCode: 'invalid_parameter', message: 'bad input', errorId: 'e' }) });
    expect(refused).toEqual({ ok: false, line: `  ${contract.name}: refused, status 400: invalid_parameter bad input` });
    const answers = [reply(202, { verificationId: 'v3' }), reply(200, { isJobCompleted: true, error: { customCode: 'no_match', message: "The onchain and recompiled bytecodes don't match.", errorId: 'e' } })];
    const failed = await submitOne({ ...args, pause: async () => {}, fetchImpl: async () => answers.shift()! });
    expect(failed.ok).toBe(false);
    expect(failed.line).toContain('failed, no_match');
  });

  it('says plainly whether a lookup is an exact match', () => {
    expect(matchLine('X', '0xa', { match: 'exact_match', runtimeMatch: 'exact_match', creationMatch: 'exact_match' })).toEqual({ exact: true, line: 'X 0xa: exact match on Sourcify (runtime exact_match, creation exact_match)' });
    expect(matchLine('X', '0xa', { match: 'match', runtimeMatch: 'match', creationMatch: 'exact_match' }).line).toBe('X 0xa: NOT an exact match on Sourcify (runtime match, creation exact_match)');
    expect(matchLine('X', '0xa', null)).toEqual({ exact: false, line: 'X 0xa: NOT verified on Sourcify (runtime none, creation none)' });
  });
});

describe('sourcify-verify: arguments and nodes', () => {
  it('needs a record and an RPC, and takes no unknown flag', () => {
    expect(() => parseArgs(['--rpc', 'http://127.0.0.1:8545'])).toThrow(/usage/);
    expect(() => parseArgs(['--record', 'r.json', '--rpc', 'x', '--etherscan'])).toThrow('unknown argument --etherscan');
    expect(parseArgs(['--record', 'r.json', '--rpc', 'x', '--submit'])).toEqual({ record: 'r.json', rpc: 'x', submit: true });
  });

  it('knows a development node from a Sepolia client', () => {
    for (const c of ['anvil/v1.0.0', 'HardhatNetwork/2.22.0/@nomicfoundation/edr/0.6.0', 'Ganache/v7.9.1/EthereumJS TestRPC/v7.9.1/ethereum-js']) expect(isDevNode(c), c).toBe(true);
    for (const c of ['reth/v2.11.0-b9abbcc/x86_64-unknown-linux-gnu', 'Geth/v1.15.0-stable/linux-amd64/go1.23', '', undefined]) expect(isDevNode(c), String(c)).toBe(false);
  });
});
