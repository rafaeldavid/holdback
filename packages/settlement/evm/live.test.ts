// LiveChain refuses to start against a rules contract that signs under another EIP-712 domain (ADR-0029 §8): a 0.7
// build pointed at the deployed 0.6 contract would see every agreeAndFund revert BadSignature. A local JSON-RPC stub
// stands in for the chain, so no node is needed: it serves the chain ID, code at the rules address, and the two reads
// LiveChain.verify makes.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { holdbackDomain } from '@holdback/core';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domainMismatch, LIVE_ABIS, LiveChain, type DeploymentFile } from './live.js';

const RULES = '0x00000000000000000000000000000000000000a1';
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
/** anvil's first well-known dev key (public; guards no value). */
const RELAYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const deployment: DeploymentFile = {
  chainId: 31337,
  fromBlock: 0,
  token: { address: addr(0xbeef), name: 'Crow Test USDC', version: '1', symbol: 'tUSDC', decimals: 6 },
  escrow: addr(1),
  erc3009Collector: addr(2),
  permit2Collector: addr(3),
  multicall: addr(4),
  rules: RULES,
  bonds: addr(5),
  beacon: addr(6),
  expiryMarginSec: 86_400,
};

/** What the stub's rules contract answers for eip712Domain(). */
let onChain = { name: 'Holdback', version: '0.6' };

function answer(method: string, params: unknown[]): unknown {
  if (method === 'eth_chainId') return '0x7a69';
  if (method === 'eth_getCode') return '0x6080';
  if (method === 'eth_call') {
    const call = params[0] as { data?: Hex; input?: Hex };
    const { functionName } = decodeFunctionData({ abi: LIVE_ABIS.rules, data: (call.data ?? call.input)! });
    if (functionName === 'eip712Domain') {
      return encodeFunctionResult({ abi: LIVE_ABIS.rules, functionName, result: ['0x0f', onChain.name, onChain.version, 31337n, RULES, `0x${'00'.repeat(32)}`, []] });
    }
    if (functionName === 'EXPIRY_MARGIN') return encodeFunctionResult({ abi: LIVE_ABIS.rules, functionName, result: 86_400n });
  }
  throw new Error(`the stub does not answer ${method}`);
}

describe('LiveChain refuses a rules contract under another EIP-712 domain (ADR-0029 §8)', () => {
  let server: Server;
  let rpc: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      const one = (r: { id: number; method: string; params?: unknown[] }) => {
        try {
          return { jsonrpc: '2.0', id: r.id, result: answer(r.method, r.params ?? []) };
        } catch (e) {
          return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: (e as Error).message } };
        }
      };
      const out = Array.isArray(body) ? body.map(one) : one(body as { id: number; method: string; params?: unknown[] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    rpc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const chainOf = () => new LiveChain({ deployment, rpcUrls: [rpc], relayerKey: RELAYER });

  it('refuses the deployed 0.6 contract with a message that names the redeploy', async () => {
    onChain = { name: 'Holdback', version: '0.6' };
    await expect(chainOf().verify()).rejects.toThrow(/signs under EIP-712 domain "Holdback" 0\.6, this build under "Holdback" 0\.7: every message would revert BadSignature\. Deploy the 0\.7 contracts/);
  });

  it("starts against a contract under core's domain", async () => {
    onChain = { name: 'Holdback', version: holdbackDomain(31337).version };
    await expect(chainOf().verify()).resolves.toBeUndefined();
  });

  it('compares the name too', () => {
    expect(domainMismatch({ name: 'Other', version: '0.7' }, holdbackDomain(31337))).toMatch(/"Other" 0\.7/);
    expect(domainMismatch({ name: 'Holdback', version: '0.7' }, holdbackDomain(31337))).toBeNull();
  });
});
