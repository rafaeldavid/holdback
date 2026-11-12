// Startup guards for the EVM settlement adapter (hard rule: no real money). The adapter runs on anvil and, since
// ADR-0028, on Sepolia; live.ts narrows a live settlement to those two chain IDs.
import { MAINNET_CHAIN_IDS } from '@holdback/core';

/** Mainnet chain IDs the adapter refuses at startup: the one list in @holdback/core (T-313), under this module's name. */
export { MAINNET_CHAIN_IDS };

/** Throws on any listed mainnet chain ID. */
export function assertSafeChain(chainId: number | bigint): void {
  const id = Number(chainId);
  if (MAINNET_CHAIN_IDS.includes(id)) throw new RangeError(`the EVM settlement adapter refuses mainnet chain id ${id} (hard rule: no real money)`);
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** `kind: 'local'` talks to this machine only: no public RPC. */
export function assertLocalRpc(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new RangeError(`${url} is not a URL`);
  }
  if (!LOCAL_HOSTS.has(host)) throw new RangeError(`${url} is not a local RPC; kind local runs against anvil on this machine only`);
}
