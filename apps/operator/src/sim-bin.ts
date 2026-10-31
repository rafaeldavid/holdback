#!/usr/bin/env node
// `pnpm sim`: starts a local world (SimChain, two operator nodes, three test adjudicators with fake judges) and
// prints where everything is. Usage: pnpm sim [--port 8780] [--operator-ports 8787,8788]. Ctrl-C stops it.
import { startSimWorld } from './sim-world.js';
import { formatTusd } from './units.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const port = Number(arg('port', '8780'));
const operatorPorts = arg('operator-ports', '8787,8788').split(',').map(Number);
if (!Number.isInteger(port) || operatorPorts.some((p) => !Number.isInteger(p))) {
  console.error('usage: pnpm sim [--port 8780] [--operator-ports 8787,8788]');
  process.exit(2);
}

let world: Awaited<ReturnType<typeof startSimWorld>>;
try {
  world = await startSimWorld({ port, operatorPorts });
} catch (e) {
  const err = e as NodeJS.ErrnoException & { port?: number };
  if (err.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${err.port ?? ''} is in use, probably by another sim. Stop it, or pick free ports: pnpm sim --port 9780 --operator-ports 9787,9788`);
  process.exit(1);
}
const { info } = world;
const e = info.economics;
const pct = (bps: string) => `${Number(bps) / 100}%`;
const lines = [
  'Holdback sim: SimChain (chain 31337), test token tUSD with 6 decimals. Fake judges. No real money.',
  '',
  ...info.operators.map((u, i) => `  operator ${i + 1}    ${u}   REST API; start at GET ${u}/.well-known/holdback.json`),
  `  sim service   ${world.url}   test accounts with keys (GET /), clock (GET /clock, POST /advance)`,
  `  club          ${info.clubId}   rules at GET ${info.operators[0]}/v1/clubs/${info.clubId}`,
  '',
  'EIP-712 domain to pin in your agent (verify every prepared message against it, not against an operator):',
  `  name Holdback, version ${info.domain.version}, chainId ${info.domain.chainId}, verifyingContract ${info.domain.verifyingContract}`,
  '',
  'Adjudicators (test adjudicators; fake judges, no model runs):',
  ...info.adjudicators.map((a) => `  ${a.role.padEnd(9)} ${a.name.padEnd(32)} ${a.address}`),
  `  each bonded ${formatTusd(e['adjudicatorBond']!)}, minimum fee ${formatTusd(e['adjudicationFeeMin']!)}`,
  '',
  `Funded test accounts. TEST KEYS ONLY: each derives from a public label. Encryption keys at GET ${world.url}/`,
  ...info.accounts.map((a) => `  ${a.label.padEnd(9)} ${a.address}  ${formatTusd(a.balance)}  signing key ${a.privateKey}`),
  '',
  'Economics (club rulebook):',
  `  the adjudication fee is paid on a refund too: a refunded buyer gets the price back, not the fee`,
  `  appeal: bond ${pct(e['appealBondRateBps']!)} of the price (rounded up) plus a ${formatTusd(e['appealFee']!)} fee`,
  `  default outcome (no adjudicator decided in time): the buyer is refunded and the seller is compensated ${pct(e['defaultOutcomeSellerCompensationRateBps']!)} of the price`,
  '',
  `Fresh funded accounts: POST ${world.url}/accounts. Work containing FAIL-ME fails the fake judges. Silence an adjudicator: POST ${world.url}/adjudicators/primary {"silent": true}.`,
  '',
  'Run an example in another terminal: pnpm example buy-dataset  (docs/quickstart.md). Ctrl-C stops the sim.',
];
console.log(lines.join('\n'));

const stop = async () => {
  await world.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
