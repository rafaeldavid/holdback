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
  /** The Permit2 collector of a deployment from before phase one; a phase-one record has none (ADR-0031 §3). */
  permit2Collector?: string;
  permit2?: string;
  multicall: string;
  rules: string;
  /** The bond vault of a deployment from before phase one; a phase-one record has none (ADR-0031 §8). */
  bonds?: string;
  beacon: string;
  expiryMarginSec?: number;
  /** What the deploy script checked on chain, such as the beacon's code hash. */
  checks?: Record<string, string | boolean>;
  /** Each contract's address, transaction, block and constructor arguments. */
  contracts?: Record<string, { address: string; tx: string; block: number; args: string[]; [extra: string]: unknown }>;
};

/**
 * Ethereum Sepolia (chain id 11155111): the EIP-712 domain 0.7 contracts (ADR-0029), deployed 2026-11-04 from the
 * reviewed contracts at 64be1f1. The domain 0.6 deployment that deals opened before then still settle on is in
 * contracts/deployments/sepolia-2026-11-03-domain-0.6.json.
 */
export const SEPOLIA: DeploymentFile | null = {
  chainId: 11155111,
  commit: '64be1f176ab45cca94a2cd398981c2a6664bc98a',
  compiler: { solc: '0.8.28', viaIR: true, optimizer: true, optimizerRuns: 200, evmVersion: 'prague' },
  deployer: '0x1A4435488eaF1A37d2327d44Fe67e97d83203B64',
  fromBlock: 12061237,
  escrow: '0x2d9ad608DE707aC470111B73c693020D9c9342cC',
  erc3009Collector: '0xA7c26BA572DCe83AB4466379fC8AEE84345888E7',
  permit2Collector: '0x8d68172322D04c9aE1C42Da4DC859699E06E6C48',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  rules: '0xF38287e5C5C1F20c6D03be500EDBF8A244f27cFA',
  bonds: '0x83F3a2615A2BE9a7DadcA924ed9952ec85749aD1',
  beacon: '0xBe80ad8Ba4E49bc985ef43caD71740351EE4Cc10',
  expiryMarginSec: 86400,
  token: {
    address: '0x5029787d7E141F2D51788035cc23903652d196B6',
    name: 'Crow Test USDC',
    version: '1',
    symbol: 'tUSDC',
    decimals: 6,
    domainSeparator: '0x6a0916d68ac92d43cb06305c2c91406949ec695185c34fd06cb0e37f04d731c5',
    tx: '0xdad17f3fb7e7a99c28ddc9ba4a2353347b00cfef0646a61f73a99a9d6f22ce9c',
    block: 12061243,
  },
  checks: {
    creationCodeMatchesBuild: true,
    permit2CodeHash: '0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751',
    multicallCodeHash: '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
    beaconCodeHash: '0x7ff87f8365d5c7ae3ed184771df2a51e5818c2270e61e97241a3acb93d71d3cc',
    beaconRound1000Value: '0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
    beaconRefusesOutsideG1: true,
    beaconRefusesAnotherRound: true,
  },
  contracts: {
    AuthCaptureEscrow: {
      address: '0x2d9ad608DE707aC470111B73c693020D9c9342cC',
      tx: '0xe3229fd3d0e51007472de48ff6dad226706c4465442125a3737239210946d06e',
      block: 12061237,
      args: [],
      tokenStoreImplementation: '0x93362F3D46981c13A0f7fFeF44Aad335cd228c34',
    },
    ERC3009PaymentCollector: {
      address: '0xA7c26BA572DCe83AB4466379fC8AEE84345888E7',
      tx: '0x58b2175f4534fa14a896dfc545b819cc12c41968246039d4a328668dd6c8d7e4',
      block: 12061238,
      args: ['0x2d9ad608DE707aC470111B73c693020D9c9342cC', '0xcA11bde05977b3631167028862bE2a173976CA11'],
    },
    Permit2PaymentCollector: {
      address: '0x8d68172322D04c9aE1C42Da4DC859699E06E6C48',
      tx: '0xe5412ebab850a18db8cd513375935bde50281341f6d5092a50b2869af0ae78d4',
      block: 12061239,
      args: [
        '0x2d9ad608DE707aC470111B73c693020D9c9342cC',
        '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        '0xcA11bde05977b3631167028862bE2a173976CA11',
      ],
    },
    DrandQuicknetBeacon: {
      address: '0xBe80ad8Ba4E49bc985ef43caD71740351EE4Cc10',
      tx: '0x95cc19a85daac20bab87819917cac4f7fcdf880dca8c31d5b771c137d62555c9',
      block: 12061240,
      args: [],
    },
    HoldbackRules: {
      address: '0xF38287e5C5C1F20c6D03be500EDBF8A244f27cFA',
      tx: '0xacebb2ffe8418c50acdddcb223d6211a0cca647e67a3757f1afbe9e7c8927929',
      block: 12061242,
      args: [
        '0x2d9ad608DE707aC470111B73c693020D9c9342cC',
        '0xA7c26BA572DCe83AB4466379fC8AEE84345888E7',
        '0x8d68172322D04c9aE1C42Da4DC859699E06E6C48',
        '86400',
        '0xBe80ad8Ba4E49bc985ef43caD71740351EE4Cc10',
      ],
    },
    HoldbackBonds: {
      address: '0x83F3a2615A2BE9a7DadcA924ed9952ec85749aD1',
      tx: '0xacebb2ffe8418c50acdddcb223d6211a0cca647e67a3757f1afbe9e7c8927929',
      block: 12061242,
      args: [],
      createdBy: 'HoldbackRules constructor',
    },
  },
};
