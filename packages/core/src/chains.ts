// Hard rule "no real money" (CLAUDE.md): the one list of mainnet chain IDs. Three guards refuse every ID on it, each
// with its own message: the EVM settlement adapter (packages/settlement/evm/guard.ts), SimChain
// (packages/settlement/sim/simchain.ts) and the operator's startup guard (apps/operator/src/guards.ts).

/**
 * Mainnet chain IDs nothing here runs on: Ethereum, the major L2s and sidechains. A deny list refuses only the chains
 * someone listed, so add a mainnet here when it launches; the operator also keeps an allowlist of test chains, which
 * refuses a mainnet this list misses.
 */
export const MAINNET_CHAIN_IDS: readonly number[] = Object.freeze([
  1, // Ethereum
  10, // OP Mainnet
  25, // Cronos
  56, // BNB Smart Chain
  100, // Gnosis
  130, // Unichain
  137, // Polygon PoS
  250, // Fantom Opera
  324, // zkSync Era
  1101, // Polygon zkEVM
  5000, // Mantle
  8453, // Base
  34443, // Mode
  42161, // Arbitrum One
  42170, // Arbitrum Nova
  42220, // Celo
  43114, // Avalanche C-Chain
  59144, // Linea
  81457, // Blast
  534352, // Scroll
  7777777, // Zora
]);
