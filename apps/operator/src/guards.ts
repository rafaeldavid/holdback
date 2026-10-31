// Hard rule "no real money" (CLAUDE.md): an operator refuses to start with a Stripe key that is not a test key,
// or off a test chain. Chain IDs are an allowlist, so a mainnet nobody listed fails closed. Keys are read by
// prefix only and never printed.

/** Local chains (Anvil/Hardhat, Ganache) and named testnets. */
export const TEST_CHAIN_IDS: ReadonlySet<number> = new Set([
  31337, // Anvil, Hardhat, SimChain
  1337, // Ganache, geth --dev
  11155111, // Sepolia
  17000, // Holesky
  84532, // Base Sepolia
  421614, // Arbitrum Sepolia
  11155420, // OP Sepolia
  80002, // Polygon Amoy
]);

/**
 * A few major mainnets, refused even when named in the opt-in list. This is a backstop, not the guard: the
 * allowlist is, so a mainnet missing here (Gnosis, Celo, Blast...) still fails closed.
 */
export const MAINNET_CHAIN_IDS: ReadonlySet<number> = new Set([1, 10, 56, 137, 324, 8453, 42161, 43114, 59144, 534352]);

/** Comma-separated chain IDs of further testnets an operator explicitly opts into. */
export const ALLOW_ENV = 'HOLDBACK_ALLOW_TEST_CHAIN_IDS';

/** Variables that must hold a Stripe test secret key. */
const SECRET_KEY_NAME = /^STRIPE_(?:SECRET_|API_)?KEY$/;
/** Values that look like a Stripe secret, restricted or publishable key. */
const STRIPE_KEY_VALUE = /^(?:sk|rk|pk)_/;
const ALLOWED_VALUE = /^(?:sk_test_|pk_test_)/;

export interface GuardInput {
  env: Readonly<Record<string, string | undefined>>;
  /** The settlement target's chain ID (SimChain's genesis chain ID). */
  chainId: number;
}

const CHAIN_ID = /^[1-9][0-9]{0,19}$/;

/** Throws when the operator must not start. */
export function startupGuards({ env, chainId }: GuardInput): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('STRIPE_') || value === undefined) continue;
    if (SECRET_KEY_NAME.test(name) && !value.startsWith('sk_test_')) throw new Error(`refusing to start: ${name} is not a Stripe test secret key (sk_test_...); hard rule: no real money`);
    if (STRIPE_KEY_VALUE.test(value) && !ALLOWED_VALUE.test(value)) throw new Error(`refusing to start: ${name} holds a Stripe key that is not a test key (sk_test_ or pk_test_); hard rule: no real money`);
  }

  const optIn = new Set<number>();
  const listed = env[ALLOW_ENV];
  if (listed !== undefined && listed.trim() !== '') {
    for (const part of listed.split(',').map((p) => p.trim())) {
      if (!CHAIN_ID.test(part)) throw new Error(`refusing to start: ${ALLOW_ENV} must list chain IDs separated by commas, got ${JSON.stringify(part)}`);
      optIn.add(Number(part));
    }
  }

  const ids = [chainId];
  const fromEnv = env['HOLDBACK_CHAIN_ID'];
  if (fromEnv !== undefined) {
    if (!CHAIN_ID.test(fromEnv)) throw new Error(`refusing to start: HOLDBACK_CHAIN_ID ${JSON.stringify(fromEnv)} is not a valid chain ID`);
    ids.push(Number(fromEnv));
  }
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`refusing to start: ${id} is not a valid chain ID`);
    if (MAINNET_CHAIN_IDS.has(id)) throw new Error(`refusing to start on mainnet chain ID ${id}; hard rule: no real money`);
    if (!TEST_CHAIN_IDS.has(id) && !optIn.has(id)) throw new Error(`refusing to start on chain ID ${id}: not on the test-chain allowlist; name it in ${ALLOW_ENV} if it is a testnet`);
  }
}
