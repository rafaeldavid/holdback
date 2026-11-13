#!/usr/bin/env node
// `pnpm sim`: starts a local world (SimChain, two operator nodes, three test adjudicators with fake judges) and
// prints where everything is. Usage: pnpm sim [--port 8780] [--operator-ports 8787,8788]. Ctrl-C stops it.
import { startSimWorld } from './sim-world.js';
import type { OperatorFeeSchedule } from '@holdback/core';
import { simStartText } from './sim-text.js';

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

/** The rules this sim runs, and the ones its start-up text describes (T-378, T-389). */
const PROFILE = 'phase_one' as const;

let world: Awaited<ReturnType<typeof startSimWorld>>;
try {
  // One developer owns every account here, so GET / lists their keys (a shared world turns this off: tools/sim). Phase
  // one's rules (T-378): the seller adapter's --sim and any agent rehearsing here is refused what the chain refuses.
  world = await startSimWorld({ port, operatorPorts, publishSecrets: true, profile: PROFILE });
} catch (e) {
  const err = e as NodeJS.ErrnoException & { port?: number };
  if (err.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${err.port ?? ''} is in use, probably by another sim. Stop it, or pick free ports: pnpm sim --port 9780 --operator-ports 9787,9788`);
  process.exit(1);
}
// The operator fee the nodes publish (fees.operator), so the first lines say what a deal costs here (T-389).
const discovery = (await (await fetch(`${world.info.operators[0]}/.well-known/holdback.json`)).json()) as { fees?: { operator?: OperatorFeeSchedule } };
console.log(simStartText(world.info, world.url, { profile: PROFILE, fee: discovery.fees?.operator ?? null }));

const stop = async () => {
  await world.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
