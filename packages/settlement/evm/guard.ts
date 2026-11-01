// Startup guards for the EVM settlement adapter (hard rule: no real money; T-205 runs on anvil only).

/** Mainnet chain IDs the adapter refuses at startup: Ethereum, major L2s and sidechains. */
export const MAINNET_CHAIN_IDS: readonly number[] = [1, 10, 25, 56, 100, 130, 137, 250, 324, 1101, 5000, 8453, 34443, 42161, 42170, 42220, 43114, 59144, 81457, 534352, 7777777];

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
