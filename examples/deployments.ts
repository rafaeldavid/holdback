// The contract deployments these examples pin (ADR-0028). An agent signs for a settlement layer it configured itself,
// never one an operator names, so the addresses are copied here from contracts/deployments/<network>.json, and
// deployments.test.ts fails when the copy and the file differ.

/** contracts/deployments/<network>.json, as the testnet deployment writes it (T-206). */
export type DeploymentFile = {
  chainId: number;
  commit?: string;
  fromBlock: number | string;
  token: { address: string; name: string; version: string; symbol: string; decimals: number };
  escrow: string;
  erc3009Collector: string;
  permit2Collector: string;
  multicall: string;
  rules: string;
  bonds: string;
  beacon: string;
  expiryMarginSec?: number;
};

/** Ethereum Sepolia (chain id 11155111): null until the reviewed contracts are deployed there (T-206). */
export const SEPOLIA: DeploymentFile | null = null;
