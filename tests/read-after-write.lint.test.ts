// T-232: proves the read-after-write lint rule in eslint.config.js fires, so the check in docs/team.md ("A chain read
// after a transaction sees that transaction") is real. A read of a live chain's state that names no block fails lint in
// the settlement adapter and the apps; one that names its block, or says why on an eslint-disable line, passes.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url).pathname;
const eslint = new ESLint({ cwd: root });

async function messages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const inAdapter = 'packages/settlement/evm/probe.ts';
const head = 'declare const chain: any; declare const client: any; declare const publicClient: any; declare const b: bigint;\n';

describe('read-after-write lint rule (T-232)', () => {
  it.each([
    ['a contract read', 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "dealOf", args: [] });'],
    ['a gas estimate (the relay simulation)', 'chain.publicClient.estimateGas({ account: "0x", to: "0x", data: "0x" });'],
    ['an eth_call', 'chain.publicClient.call({ to: "0x", data: "0x" });'],
    ['a balance', 'chain.publicClient.getBalance({ address: "0x" });'],
    ['a nonce count', 'chain.publicClient.getTransactionCount({ address: "0x", blockTag: "pending" });'],
    ['a read on a client named client', 'client.readContract({ address: "0x", abi: [], functionName: "x" });'],
    ['a read on a bare publicClient', 'publicClient.simulateContract({ address: "0x", abi: [], functionName: "x" });'],
    ['a read at the latest block by tag', 'chain.publicClient.readContract({ address: "0x", abi: [], functionName: "x", blockTag: "latest" });'],
  ])('rejects %s that names no block', async (_name, code) => {
    expect(await messages(`${head}${code}\n`, inAdapter)).not.toEqual([]);
  });

  it('accepts a read that names its block, directly or from the chain’s pinned read', async () => {
    const code = `${head}chain.publicClient.readContract({ address: "0x", abi: [], functionName: "x", blockNumber: b });
chain.pinned((blockNumber: bigint) => chain.publicClient.estimateGas({ account: "0x", to: "0x", data: "0x", blockNumber }));
`;
    expect(await messages(code, inAdapter)).toEqual([]);
  });

  it('accepts a read that says why it names no block', async () => {
    const code = `${head}// eslint-disable-next-line no-restricted-syntax -- read before any write: a constant of the deployed contract.
chain.publicClient.readContract({ address: "0x", abi: [], functionName: "EXPIRY_MARGIN" });
`;
    expect(await messages(code, inAdapter)).toEqual([]);
  });

  it('applies to the apps (the operators, the faucet, the adjudicator, the test seller)', async () => {
    for (const app of ['demo-cloud', 'operator', 'adjudicator', 'test-agents']) {
      expect(await messages(`${head}chain.publicClient.readContract({ address: "0x", abi: [], functionName: "x" });\n`, `apps/${app}/src/probe.ts`)).not.toEqual([]);
    }
  });

  it("does not apply to tests or to anvil's world, one node that mines each transaction before its receipt returns", async () => {
    const code = `${head}chain.publicClient.readContract({ address: "0x", abi: [], functionName: "x" });\n`;
    expect(await messages(code, 'packages/settlement/evm/probe.test.ts')).toEqual([]);
    expect(await messages(code, 'packages/settlement/evm/world.ts')).toEqual([]);
    expect(await messages(code, 'apps/demo-cloud/src/probe.test.ts')).toEqual([]);
  });

  it('leaves other calls named call alone', async () => {
    expect(await messages(`${head}declare const agent: any; agent.call("GET", "/v1/status"); Function.prototype.call.call(() => 0);\n`, inAdapter)).toEqual([]);
  });
});
