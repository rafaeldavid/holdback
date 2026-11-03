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

/** Ethereum Sepolia (chain id 11155111): the reviewed contracts and the test token tUSDC, deployed by T-206. */
export const SEPOLIA: DeploymentFile | null = {
  chainId: 11155111,
  commit: '23427569353845ab0c41b28830cb8a9c43e13031',
  fromBlock: 12055938,
  token: { address: '0x337f1463b59B4520EB12150476d68BF2A2AdB6E8', name: 'Crow Test USDC', version: '1', symbol: 'tUSDC', decimals: 6 },
  escrow: '0xa49454161ef41abC15090392a7A0fA085e3d2B42',
  erc3009Collector: '0xeBd6dD0d55B567DB7F7154aFE99770f2d1b9F990',
  permit2Collector: '0xF2Ee0DcB6a10C40fcA8903De361f32E4986441d8',
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  rules: '0x88fC5504dB03f0c4b927aFc2ceC8a19ec8C68C18',
  bonds: '0x53acE822948a8f657c90EF5D1840d0e77Ba17673',
  beacon: '0xB80524563eCef49EBef289D5899661338787fc6a',
  expiryMarginSec: 86400,
};
