// The contract deployments these examples pin (ADR-0028). An agent signs for a settlement layer it configured itself,
// never one an operator names, so the addresses are copied here from contracts/deployments/<network>.json, and
// deployments.test.ts fails when the copy and the file differ.

/** contracts/deployments/<network>.json, as the testnet deployment writes it (T-206). */
export type DeploymentFile = {
  chainId: number;
  commit?: string;
  compiler?: { solc: string; viaIR: boolean; optimizer: boolean; optimizerRuns: number; evmVersion: string };
  deployer?: string;
  fromBlock: number | string;
  /** The UTC time of the deployment's first block (ISO), which names its dated copy; records from before T-383 have none. */
  deployedAt?: string;
  token: {
    address: string;
    name: string;
    version: string;
    symbol: string;
    decimals: number;
    domainSeparator?: string;
    tx?: string;
    block?: number;
  };
  escrow: string;
  erc3009Collector: string;
  /** The Permit2 collector of a deployment from before phase one; a phase-one record has none (ADR-0031 section 3). */
  permit2Collector?: string;
  permit2?: string;
  multicall: string;
  rules: string;
  /** The bond vault of a deployment from before phase one; a phase-one record has none (ADR-0031 section 8). */
  bonds?: string;
  beacon: string;
  expiryMarginSec?: number;
  /** The rules contract's beacon margin in seconds (ADR-0032); records from before phase one have none. */
  beaconMarginSec?: number;
  /** What the deploy script checked on chain, such as the beacon's code hash. */
  checks?: Record<string, string | boolean>;
  /** Each contract's address, transaction, block and constructor arguments. */
  contracts?: Record<string, { address: string; tx: string; block: number; args: string[]; [extra: string]: unknown }>;
};

/**
 * Ethereum Sepolia (chain id 11155111): the deployment in contracts/deployments/sepolia.json, from the contracts at
 * 938c3fc. Written by scripts/record-copies.mjs; earlier deployments are the dated records beside it.
 */
export const SEPOLIA: DeploymentFile | null = {
  chainId: 11155111,
  commit: '938c3fc6b2797c61a3a53a7b00679fbee1cc2906',
  compiler: {
    solc: '0.8.28',
    viaIR: true,
    optimizer: true,
    optimizerRuns: 200,
    evmVersion: 'prague',
  },
  deployer: '0x1A4435488eaF1A37d2327d44Fe67e97d83203B64',
  fromBlock: 12123907,
  deployedAt: '2026-11-13T05:32:12Z',
  escrow: '0x8ef2b0Bc9304Fd4D506b5410B35Cc1e2D2BB4357',
  erc3009Collector: '0x959CA9929ea2c47c6390199Ab07639F307c0e3ef',
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  rules: '0x3BE45128565ABBc35DbD4660716b703Ff489f1b4',
  beacon: '0x1Eca7edB6531231C73fA0eb875816cEBd70c0645',
  expiryMarginSec: 86400,
  beaconMarginSec: 29,
  token: {
    address: '0x0b3d947f594B59Fc1Fb7D02E62C6795F8118cA6D',
    name: 'Crow Test USDC',
    version: '1',
    symbol: 'tUSDC',
    decimals: 6,
    domainSeparator: '0x7d333ead9877f0a32ed08ff9704f6a4a7f9a2e1430104d0d2a77242e973b17f3',
    tx: '0x1cb8f915be2a31decf83145546d7eeabc57255e26dce61f541339e333cd592b5',
    block: 12123911,
  },
  checks: {
    creationCodeMatchesBuild: true,
    multicallCodeHash: '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
    beaconCodeHash: '0xdaf0a431b7ae64f9503671f25293c0ed210a3997590be6e2d82d63a12a005388',
    beaconRound1000Value: '0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
    beaconRefusesOutsideG1: true,
    beaconRefusesAnotherRound: true,
  },
  contracts: {
    AuthCaptureEscrow: {
      address: '0x8ef2b0Bc9304Fd4D506b5410B35Cc1e2D2BB4357',
      tx: '0x64877f781bd84ba308f78e990e96486b5c78325e6a0d098cfe5bf402a3b41d09',
      block: 12123907,
      args: [],
      tokenStoreImplementation: '0x23758f2CF3B46e63b865995AaA42a0a1fEF859c3',
    },
    ERC3009PaymentCollector: {
      address: '0x959CA9929ea2c47c6390199Ab07639F307c0e3ef',
      tx: '0x9597e575869577d55e30aaddbd486e9c0da6c95737528c1a2a08bc6cdc2b93f5',
      block: 12123908,
      args: [
        '0x8ef2b0Bc9304Fd4D506b5410B35Cc1e2D2BB4357',
        '0xcA11bde05977b3631167028862bE2a173976CA11',
      ],
    },
    DrandQuicknetBeacon: {
      address: '0x1Eca7edB6531231C73fA0eb875816cEBd70c0645',
      tx: '0x8edd7d0aa0ca7db7c1e096d001f8c3c978a6aee6ee28a12c9b1cad7463c98aee',
      block: 12123909,
      args: [],
    },
    HoldbackRules: {
      address: '0x3BE45128565ABBc35DbD4660716b703Ff489f1b4',
      tx: '0xa1b199ce9198515d17e9fa76e504148ad3f67055f67aa53d63058fc476628f87',
      block: 12123913,
      args: [
        '0x8ef2b0Bc9304Fd4D506b5410B35Cc1e2D2BB4357',
        '0x959CA9929ea2c47c6390199Ab07639F307c0e3ef',
        '86400',
        '0x1Eca7edB6531231C73fA0eb875816cEBd70c0645',
        '0x0b3d947f594B59Fc1Fb7D02E62C6795F8118cA6D',
        '29',
      ],
    },
  },
};
