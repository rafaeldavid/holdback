// pnpm sim:brief <run-id> <party> --role buyer|seller --with <counterparty> --job <id> --profile <id> [--model <m>]
// Prints the party's brief (the whole prompt for its subagent) and saves it to runs/<run-id>/briefs/<party>.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBrief } from '../brief.ts';
import { RUNS_DIR, validRunId, type WorldFile } from '../world.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [runId = '', party = ''] = args;
const role = opt('role');
const counterparty = opt('with');
const job = opt('job');
const profile = opt('profile');
if (!validRunId(runId) || !party || (role !== 'buyer' && role !== 'seller') || !counterparty || !job || !profile) {
  console.error('usage: pnpm sim:brief <run-id> <party> --role buyer|seller --with <counterparty> --job <job> --profile <profile> [--model <model>]');
  process.exit(2);
}
const dir = join(RUNS_DIR, runId);
const world = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldFile;
const model = opt('model');
const brief = renderBrief({ world, party, counterparty, role, job, profile, ...(model ? { model } : {}) });
mkdirSync(join(dir, 'briefs'), { recursive: true });
writeFileSync(join(dir, 'briefs', `${party}.md`), brief);
console.log(brief);
