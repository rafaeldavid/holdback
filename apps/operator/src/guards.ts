// Hard rule "no real money" (CLAUDE.md): an operator refuses to start with a Stripe key that is not a test
// secret key, or on a mainnet chain ID. It reads the keys' prefixes only and never prints a key.

/** Mainnet chain IDs (Ethereum, OP, BNB, Polygon, zkSync, Base, Arbitrum, Avalanche, Linea, Scroll). */
export const MAINNET_CHAIN_IDS: ReadonlySet<number> = new Set([1, 10, 56, 137, 324, 8453, 42161, 43114, 59144, 534352]);

const STRIPE_KEY = /^STRIPE_.*KEY$/;

export interface GuardInput {
  env: Readonly<Record<string, string | undefined>>;
  /** The settlement target's chain ID (SimChain's genesis chain ID). */
  chainId: number;
}

/** Throws when the operator must not start. */
export function startupGuards({ env, chainId }: GuardInput): void {
  for (const [name, value] of Object.entries(env)) {
    if (!STRIPE_KEY.test(name) || value === undefined) continue;
    if (!value.startsWith('sk_test_')) throw new Error(`refusing to start: ${name} is not a Stripe test secret key (sk_test_...); hard rule: no real money`);
  }
  const ids = [chainId];
  const fromEnv = env['HOLDBACK_CHAIN_ID'];
  if (fromEnv !== undefined) {
    if (!/^[1-9][0-9]{0,19}$/.test(fromEnv)) throw new Error(`refusing to start: HOLDBACK_CHAIN_ID ${JSON.stringify(fromEnv)} is not a valid chain ID`);
    ids.push(Number(fromEnv));
  }
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`refusing to start: ${id} is not a valid chain ID`);
    if (MAINNET_CHAIN_IDS.has(id)) throw new Error(`refusing to start on mainnet chain ID ${id}; hard rule: no real money`);
  }
}
