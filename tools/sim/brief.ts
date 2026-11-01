// Renders a party brief from briefs/<role>.md and catalogue.json for one party of a run. A brief carries
// only what an outsider would know (the allowed docs, this world's public endpoints, the party's own account,
// the counterparty's address) plus its job and behaviour profile. Never the audit endpoint, another party's
// key, or anything about how the sim checks the run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldFile } from './world.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const MAIL_TOOL = join(HERE, 'bin', 'mail.ts');

export interface Catalogue {
  version: number;
  models: string[];
  jobs: Array<{ id: string; title: string; seller: string; buyer: string; terms: Record<string, unknown> }>;
  profiles: Array<{ id: string; brief: string; tactics?: Record<'buyer' | 'seller', string[]> }>;
  pairings: Array<{ run: string; job: string; buyer: { model: string; profile: string }; seller: { model: string; profile: string } }>;
}

export function loadCatalogue(): Catalogue {
  return JSON.parse(readFileSync(join(HERE, 'catalogue.json'), 'utf8')) as Catalogue;
}

export interface BriefRequest {
  world: WorldFile;
  party: string;
  counterparty: string;
  role: 'buyer' | 'seller';
  job: string;
  profile: string;
  model?: string;
}

export function renderBrief(r: BriefRequest, catalogue: Catalogue = loadCatalogue()): string {
  const me = r.world.parties[r.party];
  const them = r.world.parties[r.counterparty];
  if (!me) throw new Error(`no party ${r.party} in run ${r.world.runId} (parties: ${Object.keys(r.world.parties).join(', ')})`);
  if (!them || r.counterparty === r.party) throw new Error(`no counterparty ${r.counterparty} in run ${r.world.runId}`);
  const job = catalogue.jobs.find((j) => j.id === r.job) ?? fail(`no job ${r.job} (jobs: ${catalogue.jobs.map((j) => j.id).join(', ')})`);
  const profile = catalogue.profiles.find((p) => p.id === r.profile) ?? fail(`no profile ${r.profile} (profiles: ${catalogue.profiles.map((p) => p.id).join(', ')})`);
  const adj = (role: string) => r.world.adjudicators.find((a) => a.role === role)?.address ?? fail(`no ${role} adjudicator`);
  const tactics = profile.tactics?.[r.role] ?? [];
  const values: Record<string, string> = {
    runId: r.world.runId,
    party: r.party,
    role: r.role,
    model: r.model ?? 'unknown',
    operators: r.world.operators.map((o) => `\`${o}\``).join(' and '),
    operator1: r.world.operators[0]!,
    operatorsCsv: r.world.operators.join(','),
    sim: `\`${r.world.sim}\``,
    clubId: r.world.clubId,
    primary: adj('primary'),
    fallback: adj('fallback'),
    appeal: adj('appeal'),
    domainVersion: r.world.pinnedDomain.version,
    chainId: String(r.world.pinnedDomain.chainId),
    verifyingContract: r.world.pinnedDomain.verifyingContract,
    address: me.address,
    balance: me.balance,
    privateKey: me.privateKey,
    encryptionPublicKey: me.encryptionPublicKey,
    encryptionSecretKey: me.encryptionSecretKey,
    counterparty: r.counterparty,
    counterpartyAddress: them.address,
    workdir: me.workdir,
    worldFile: join(r.world.coordinator.runDir, 'world.json'),
    mailTool: MAIL_TOOL,
    reportPath: join(r.world.coordinator.reports, `${r.party}.json`),
    profile: profile.id,
    profileBrief: profile.brief,
    tactics: tactics.length ? `\nTactics to try as the ${r.role}:\n\n${tactics.map((t) => `- ${t}`).join('\n')}\n` : '',
    jobBuyer: job.buyer,
    jobSeller: job.seller,
    terms: JSON.stringify(job.terms, null, 2),
  };
  const template = readFileSync(join(HERE, 'briefs', `${r.role}.md`), 'utf8').replace('{{common}}', readFileSync(join(HERE, 'briefs', 'common.md'), 'utf8'));
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => values[k] ?? fail(`brief placeholder {{${k}}} has no value`));
}

function fail(message: string): never {
  throw new Error(message);
}
